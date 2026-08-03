"use strict";
import * as VscodePython from "@vscode/python-extension";
import * as path from "path";
import * as vscode from "vscode";
import { ConfigService, VscodeConfigService } from "./config";
import { nodeHost } from "./host";
import { createResolver, Resolver } from "./interpreter";
import { Logger } from "./log";
import {
  extraPathDirFor,
  findClosestPyProjectToml,
  nextExtraPaths,
  packageDirsFor,
  samePath,
  testingCwdFor,
  toSettingPath,
} from "./paths";
import {
  ExecutionEnvironment,
  executionEnvironmentsFor,
  mergePyrightConfig,
  Project,
} from "./pyrightConfig";

const PYRIGHT_CONFIG = "pyrightconfig.json";
const SHOW_LOGS = "Show Logs";

export async function activate(context: vscode.ExtensionContext) {
  // Created before anything that can fail, so a failure has somewhere to go.
  const channel = vscode.window.createOutputChannel("Poetry Monorepo", {
    log: true,
  });
  const logger: Logger = channel;

  const pythonExtension = await VscodePython.PythonExtension.api();
  const resolver = createResolver(nodeHost, logger);

  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{pyproject.toml,poetry.toml,.python-version}",
  );
  const onProjectChange = async () => {
    resolver.invalidate();
    await generatePyrightConfigs(context, logger, {});
  };
  watcher.onDidCreate(onProjectChange);
  watcher.onDidChange(onProjectChange);
  watcher.onDidDelete(onProjectChange);

  const disposable = vscode.window.onDidChangeActiveTextEditor((editor) =>
    onActiveTextEditorChange(editor, pythonExtension, resolver, logger),
  );

  // A changed poetryPath or venvDiscovery makes every cached answer suspect,
  // and turning generation on should not wait for a reload.
  const onSettingsChange = vscode.workspace.onDidChangeConfiguration(
    async (event) => {
      if (!event.affectsConfiguration("poetryMonorepo")) {
        return;
      }
      resolver.invalidate();
      await generatePyrightConfigs(context, logger, {});
    },
  );

  context.subscriptions.push(
    channel,
    watcher,
    disposable,
    onSettingsChange,
    vscode.commands.registerCommand("poetryMonorepo.showLogs", () =>
      channel.show(),
    ),
    vscode.commands.registerCommand(
      "poetryMonorepo.generatePyrightConfig",
      () => generatePyrightConfigs(context, logger, { explicit: true }),
    ),
  );

  await generatePyrightConfigs(context, logger, {});

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    await onActiveTextEditorChange(
      activeEditor,
      pythonExtension,
      resolver,
      logger,
    );
  }
}

// Resolving an interpreter may spawn poetry, by which time the user can have
// moved to a file in another package. Only the newest run is allowed to write.
let generation = 0;

// Both of these say their piece once. A message on every editor change would
// be noise, and the thing being reported does not change within a session.
let warnedPoetryMissing = false;
const warnedConfigWins = new Set<string>();

async function onActiveTextEditorChange(
  editor: vscode.TextEditor | undefined,
  pythonExtension: VscodePython.PythonExtension,
  resolver: Resolver,
  logger: Logger,
) {
  if (!editor || editor.document.languageId !== "python") {
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(
    editor.document.uri,
  );
  if (!workspaceFolder) {
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const filePath = editor.document.uri.fsPath;
  const found = findClosestPyProjectToml(filePath, workspaceRoot);
  if (!found) {
    logger.debug(`no pyproject.toml at or above ${filePath}`);
    return;
  }

  const [projectDir, dirBelowProject] = found;
  logger.debug(`${filePath} belongs to ${projectDir}`);
  const packageDirPath = extraPathDirFor(
    filePath,
    dirBelowProject,
    packageDirsFor(projectDir),
  );
  const config = new VscodeConfigService(workspaceFolder.uri);
  const token = ++generation;

  await setPythonInterpreter(
    projectDir,
    workspaceRoot,
    config,
    pythonExtension,
    resolver,
    logger,
    () => token === generation,
  );
  await updateExtraPaths(
    packageDirPath,
    workspaceRoot,
    workspaceFolder,
    config,
    logger,
  );
  await updateTestingCwd(projectDir, workspaceRoot, config, logger);
}

async function setPythonInterpreter(
  projectDir: string,
  workspaceRoot: string,
  config: ConfigService,
  pythonExtension: VscodePython.PythonExtension,
  resolver: Resolver,
  logger: Logger,
  isCurrent: () => boolean,
) {
  const settings = config.settings;
  const sources = settings.venvDiscovery;
  if (sources.length === 0) {
    logger.debug("venvDiscovery is empty, so the interpreter is left alone");
    return;
  }

  const interpreter = await resolver.resolve(
    projectDir,
    workspaceRoot,
    settings.poetryPath,
  );
  if (!interpreter) {
    logger.debug(`no interpreter found for ${projectDir}`);
    if (sources.includes("poetry") && resolver.poetryMissing()) {
      await warnPoetryMissing();
    }
    return;
  }
  if (!isCurrent()) {
    logger.debug(`${projectDir} resolved late; a newer file is active`);
    return;
  }
  if (!sources.includes(interpreter.source)) {
    logger.debug(
      `${interpreter.source} is not in venvDiscovery, so ${interpreter.path} is ignored`,
    );
    return;
  }

  const current = pythonExtension.environments.getActiveEnvironmentPath().path;
  if (samePath(interpreter.path, current, process.platform)) {
    logger.debug(`interpreter already ${interpreter.path}`);
    return;
  }

  logger.info(`interpreter -> ${interpreter.path} (${interpreter.source})`);
  await pythonExtension.environments.updateActiveEnvironmentPath(
    interpreter.path,
  );
  vscode.window.showInformationMessage(
    `Python interpreter changed.\n\nInterpreter: ${interpreter.path}`,
  );
}

async function warnPoetryMissing() {
  if (warnedPoetryMissing) {
    return;
  }
  warnedPoetryMissing = true;
  const choice = await vscode.window.showWarningMessage(
    "Poetry Monorepo could not find poetry. Set poetryMonorepo.poetryPath to " +
      "its full path, or make sure poetry is on the PATH the editor runs with.",
    SHOW_LOGS,
  );
  if (choice === SHOW_LOGS) {
    await vscode.commands.executeCommand("poetryMonorepo.showLogs");
  }
}

async function updateExtraPaths(
  packagePath: string,
  workspaceRoot: string,
  workspaceFolder: vscode.WorkspaceFolder,
  config: ConfigService,
  logger: Logger,
) {
  if (config.settings.generatePyrightConfig) {
    logger.debug(
      `${PYRIGHT_CONFIG} carries the paths, so extraPaths is left alone`,
    );
    return;
  }

  const next = nextExtraPaths(
    config.settings.extraPathsMode,
    toSettingPath(workspaceRoot, packagePath),
    config.extraPaths,
  );
  if (!next) {
    logger.debug("extraPaths already correct");
    await warnIfPyrightConfigWins(workspaceFolder, logger);
    return;
  }

  logger.info(`python.analysis.extraPaths -> ${next.join(", ")}`);
  await config.setExtraPaths(next);
  await warnIfPyrightConfigWins(workspaceFolder, logger);
}

/**
 * A pyrightconfig.json makes Pylance ignore every python.analysis.* setting,
 * so writes that look like they worked do nothing at all. Say so rather than
 * letting it read as the extension being broken.
 */
async function warnIfPyrightConfigWins(
  workspaceFolder: vscode.WorkspaceFolder,
  logger: Logger,
) {
  const key = workspaceFolder.uri.toString();
  if (warnedConfigWins.has(key)) {
    return;
  }
  warnedConfigWins.add(key);

  const config = vscode.Uri.joinPath(workspaceFolder.uri, PYRIGHT_CONFIG);
  const owner = (await readText(config))
    ? PYRIGHT_CONFIG
    : (await hasPyrightTable(workspaceFolder))
      ? "pyproject.toml [tool.pyright]"
      : undefined;
  if (!owner) {
    return;
  }

  logger.warn(
    `${owner} is present, so Pylance ignores python.analysis.extraPaths. ` +
      "Turn on poetryMonorepo.generatePyrightConfig to have this extension " +
      "keep that file's executionEnvironments up to date instead.",
  );
}

async function hasPyrightTable(workspaceFolder: vscode.WorkspaceFolder) {
  const text = await readText(
    vscode.Uri.joinPath(workspaceFolder.uri, "pyproject.toml"),
  );
  return text !== undefined && /^\s*\[tool\.pyright[\].]/m.test(text);
}

async function updateTestingCwd(
  projectDir: string,
  workspaceRoot: string,
  config: ConfigService,
  logger: Logger,
) {
  if (!config.settings.pytestEnabled) {
    return;
  }

  const cwd = testingCwdFor(toSettingPath(workspaceRoot, projectDir));
  if (cwd === config.testingCwd) {
    logger.debug("python.testing.cwd already correct");
    return;
  }
  logger.info(`python.testing.cwd -> ${cwd}`);
  await config.setTestingCwd(cwd);
}

async function generatePyrightConfigs(
  context: vscode.ExtensionContext,
  logger: Logger,
  options: { explicit?: boolean; force?: boolean },
) {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    await generatePyrightConfigFor(folder, context, logger, options);
  }
}

async function generatePyrightConfigFor(
  folder: vscode.WorkspaceFolder,
  context: vscode.ExtensionContext,
  logger: Logger,
  options: { explicit?: boolean; force?: boolean },
) {
  const enabled = vscode.workspace
    .getConfiguration("poetryMonorepo", folder.uri)
    .get<boolean>("generatePyrightConfig");
  if (!enabled && !options.explicit) {
    return;
  }

  const started = Date.now();
  const projects = await findProjects(folder);
  if (projects.length === 0) {
    logger.debug(`no pyproject.toml under ${folder.uri.fsPath}`);
    if (options.explicit) {
      vscode.window.showInformationMessage(
        "Poetry Monorepo found no pyproject.toml in this workspace.",
      );
    }
    return;
  }

  const environments = executionEnvironmentsFor(folder.uri.fsPath, projects);
  logger.debug(
    `${projects.length} project(s) under ${folder.uri.fsPath} in ${
      Date.now() - started
    }ms`,
  );

  const file = vscode.Uri.joinPath(folder.uri, PYRIGHT_CONFIG);
  const key = `pyrightConfig:${folder.uri.toString()}`;
  const result = mergePyrightConfig(await readText(file), environments, {
    previous: context.workspaceState.get<ExecutionEnvironment[]>(key),
    force: options.force,
  });

  switch (result.status) {
    case "write":
      await vscode.workspace.fs.writeFile(
        file,
        Buffer.from(result.text, "utf8"),
      );
      await context.workspaceState.update(key, environments);
      logger.info(
        `${PYRIGHT_CONFIG} -> ${environments.map((e) => e.root).join(", ")}`,
      );
      return;

    case "unchanged":
      await context.workspaceState.update(key, environments);
      logger.debug(`${PYRIGHT_CONFIG} already correct`);
      return;

    case "invalid":
      logger.warn(
        `${PYRIGHT_CONFIG} is not valid JSON, so it was left alone. Fix or ` +
          "delete it and run Poetry Monorepo: Generate pyrightconfig.json.",
      );
      if (options.explicit) {
        await showProblem(`${PYRIGHT_CONFIG} is not valid JSON.`);
      }
      return;

    case "conflict":
      await onConflict(folder, context, logger, options);
      return;
  }
}

/**
 * The executionEnvironments in the file are not the ones this extension wrote
 * last, so somebody edited them. Overwriting is only ever done on request.
 */
async function onConflict(
  folder: vscode.WorkspaceFolder,
  context: vscode.ExtensionContext,
  logger: Logger,
  options: { explicit?: boolean; force?: boolean },
) {
  logger.warn(
    `${PYRIGHT_CONFIG} has executionEnvironments this extension did not write, ` +
      "so it was left alone.",
  );
  if (!options.explicit) {
    return;
  }

  const overwrite = "Overwrite";
  const choice = await vscode.window.showWarningMessage(
    `${PYRIGHT_CONFIG} already has executionEnvironments that were not written ` +
      "by Poetry Monorepo. Replace them?",
    { modal: true },
    overwrite,
  );
  if (choice === overwrite) {
    await generatePyrightConfigFor(folder, context, logger, {
      explicit: true,
      force: true,
    });
  }
}

async function showProblem(message: string) {
  const choice = await vscode.window.showWarningMessage(message, SHOW_LOGS);
  if (choice === SHOW_LOGS) {
    await vscode.commands.executeCommand("poetryMonorepo.showLogs");
  }
}

async function findProjects(
  folder: vscode.WorkspaceFolder,
): Promise<Project[]> {
  const found = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, "**/pyproject.toml"),
    "**/{.venv,venv,node_modules,.git,.tox,.nox,.mypy_cache,dist,build,site-packages}/**",
  );
  return found.map((uri) => {
    const dir = path.dirname(uri.fsPath);
    return { dir, packageDirs: packageDirsFor(dir) };
  });
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(
      "utf8",
    );
  } catch {
    return undefined;
  }
}

export function deactivate() {}
