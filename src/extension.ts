"use strict";
import * as VscodePython from "@vscode/python-extension";
import * as vscode from "vscode";
import { ConfigService, VscodeConfigService } from "./config";
import { nodeHost } from "./host";
import { createResolver, Resolver } from "./interpreter";
import {
  extraPathDirFor,
  findClosestPyProjectToml,
  nextExtraPaths,
  packageDirsFor,
  samePath,
  testingCwdFor,
  toSettingPath,
} from "./paths";

export async function activate(context: vscode.ExtensionContext) {
  const pythonExtension = await VscodePython.PythonExtension.api();
  const resolver = createResolver(nodeHost);

  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{pyproject.toml,poetry.toml,.python-version}",
  );
  watcher.onDidCreate(() => resolver.invalidate());
  watcher.onDidChange(() => resolver.invalidate());
  watcher.onDidDelete(() => resolver.invalidate());

  const disposable = vscode.window.onDidChangeActiveTextEditor((editor) =>
    onActiveTextEditorChange(editor, pythonExtension, resolver),
  );

  context.subscriptions.push(watcher, disposable);

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    await onActiveTextEditorChange(activeEditor, pythonExtension, resolver);
  }
}

// Resolving an interpreter may spawn poetry, by which time the user can have
// moved to a file in another package. Only the newest run is allowed to write.
let generation = 0;

async function onActiveTextEditorChange(
  editor: vscode.TextEditor | undefined,
  pythonExtension: VscodePython.PythonExtension,
  resolver: Resolver,
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
  const found = findClosestPyProjectToml(
    editor.document.uri.fsPath,
    workspaceRoot,
  );
  if (!found) {
    return;
  }

  const [poetryPath, dirBelowProject] = found;
  const packageDirPath = extraPathDirFor(
    editor.document.uri.fsPath,
    dirBelowProject,
    packageDirsFor(poetryPath),
  );
  const config = new VscodeConfigService(workspaceFolder.uri);
  const token = ++generation;

  await setPythonInterpreter(
    poetryPath,
    workspaceRoot,
    config,
    pythonExtension,
    resolver,
    () => token === generation,
  );
  await updateExtraPaths(packageDirPath, workspaceRoot, config);
  await updateTestingCwd(poetryPath, workspaceRoot, config);
}

async function setPythonInterpreter(
  poetryPath: string,
  workspaceRoot: string,
  config: ConfigService,
  pythonExtension: VscodePython.PythonExtension,
  resolver: Resolver,
  isCurrent: () => boolean,
) {
  const sources = config.settings.venvDiscovery;
  if (sources.length === 0) {
    return;
  }

  const interpreter = await resolver.resolve(poetryPath, workspaceRoot);
  if (!interpreter || !isCurrent() || !sources.includes(interpreter.source)) {
    return;
  }

  const current = pythonExtension.environments.getActiveEnvironmentPath().path;
  if (samePath(interpreter.path, current, process.platform)) {
    return;
  }

  await pythonExtension.environments.updateActiveEnvironmentPath(
    interpreter.path,
  );
  vscode.window.showInformationMessage(
    `Python interpreter changed.\n\nInterpreter: ${interpreter.path}`,
  );
}

async function updateExtraPaths(
  packagePath: string,
  workspaceRoot: string,
  config: ConfigService,
) {
  const next = nextExtraPaths(
    config.settings.extraPathsMode,
    toSettingPath(workspaceRoot, packagePath),
    config.extraPaths,
  );
  if (next) {
    await config.setExtraPaths(next);
  }
}

async function updateTestingCwd(
  poetryPath: string,
  workspaceRoot: string,
  config: ConfigService,
) {
  if (!config.settings.pytestEnabled) {
    return;
  }

  const cwd = testingCwdFor(toSettingPath(workspaceRoot, poetryPath));
  if (cwd !== config.testingCwd) {
    await config.setTestingCwd(cwd);
  }
}

export function deactivate() {}
