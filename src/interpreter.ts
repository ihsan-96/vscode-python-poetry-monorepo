import { Logger, silentLogger } from "./log";
import * as path from "path";

export type InterpreterSource = "in-project" | "poetry" | "pyenv";

/**
 * `reason` separates a missing executable from a command that ran and failed.
 * It is optional so that an outcome without one still reads as "ran, failed",
 * which is what every caller meant before the distinction existed.
 */
export type ExecOutcome =
  { ok: true; stdout: string } | { ok: false; reason?: "not-found" };

export interface Host {
  platform: NodeJS.Platform;
  now(): number;
  pyenvRoot(): string;
  homeDir(): string;
  env(name: string): string | undefined;
  exists(target: string): Promise<boolean>;
  readFile(target: string): Promise<string | undefined>;
  exec(file: string, args: string[], cwd: string): Promise<ExecOutcome>;
}

export interface Interpreter {
  path: string;
  source: InterpreterSource;
}

export interface Resolver {
  resolve(
    projectDir: string,
    workspaceRoot: string,
    poetryPath?: string,
  ): Promise<Interpreter | undefined>;
  /** True once poetry has been looked for and not found anywhere. */
  poetryMissing(): boolean;
  invalidate(): void;
}

const TTL_MS = 60_000;

// pyenv accepts both a bare name and the "3.11.12/envs/api" form, so slashes
// are allowed. Anything starting with "-" would be read by pyenv as a flag.
const PYENV_NAME = /^[A-Za-z0-9][\w./+-]*$/;

function pathFor(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

export function interpreterIn(
  venvPath: string,
  platform: NodeJS.Platform,
): string {
  const p = pathFor(platform);
  return platform === "win32"
    ? p.join(venvPath, "Scripts", "python.exe")
    : p.join(venvPath, "bin", "python");
}

// A real virtualenv always has pyvenv.cfg. A bare interpreter prefix does not,
// which is what `poetry env info --path` returns when no venv has been created
// and what `pyenv prefix` returns for a plain version like "3.11.12".
async function isVirtualEnv(host: Host, venvPath: string): Promise<boolean> {
  return host.exists(pathFor(host.platform).join(venvPath, "pyvenv.cfg"));
}

/** Reports a thing worth saying once per project, not once per keystroke. */
export type WarnOnce = (key: string, message: string) => void;

const noWarn: WarnOnce = () => {};

async function candidateIn(
  host: Host,
  venvPath: string,
  source: InterpreterSource,
  warnOnce: WarnOnce = noWarn,
): Promise<Interpreter | undefined> {
  const candidate = interpreterIn(venvPath, host.platform);
  if (await host.exists(candidate)) {
    return { path: candidate, source };
  }

  // A virtualenv that is there but has no interpreter in it is worth saying
  // out loud. Its python is a symlink to the Python it was built against, so
  // this is what a removed interpreter, or an environment built under another
  // home directory, looks like from here. Silence reads as the extension
  // being broken when the environment is.
  if (await host.exists(venvPath)) {
    warnOnce(
      venvPath,
      `${venvPath} has no interpreter: ${candidate} does not resolve. Its ` +
        "python is a symlink to the Python the environment was built " +
        "against, so this usually means that Python is gone or the " +
        "environment was created under a different home directory. " +
        "Recreate it with `poetry install`; the interpreter is left alone " +
        "until then.",
    );
  }
  return undefined;
}

async function fromInProjectVenv(
  host: Host,
  projectDir: string,
  warnOnce: WarnOnce = noWarn,
): Promise<Interpreter | undefined> {
  const venvPath = pathFor(host.platform).join(projectDir, ".venv");
  return candidateIn(host, venvPath, "in-project", warnOnce);
}

async function fromPoetry(
  host: Host,
  projectDir: string,
  logger: Logger,
  runPoetry: (projectDir: string) => Promise<ExecOutcome>,
  warnOnce: WarnOnce = noWarn,
): Promise<Interpreter | undefined> {
  const outcome = await runPoetry(projectDir);
  if (!outcome.ok) {
    logger.debug(`poetry reported no environment for ${projectDir}`);
    return undefined;
  }

  const venvPath = lastLine(outcome.stdout);
  if (!venvPath) {
    logger.debug(`poetry printed no path for ${projectDir}`);
    return undefined;
  }
  if (!(await isVirtualEnv(host, venvPath))) {
    // `poetry env info --path` answers with the base interpreter's prefix when
    // the project has no virtualenv yet, and switching to that would drop the
    // editor onto the system Python.
    logger.debug(
      `${venvPath} is not a virtualenv, so ${projectDir} is left alone`,
    );
    return undefined;
  }
  return candidateIn(host, venvPath, "poetry", warnOnce);
}

async function fromPyenv(
  host: Host,
  projectDir: string,
  workspaceRoot: string,
): Promise<Interpreter | undefined> {
  const name = await readPythonVersion(host, projectDir, workspaceRoot);
  if (!name) {
    return undefined;
  }

  const p = pathFor(host.platform);
  let prefix: string | undefined = p.join(host.pyenvRoot(), "versions", name);
  if (!(await host.exists(prefix))) {
    // execFile cannot launch pyenv.bat on Windows, and pyenv-virtualenv does
    // not exist there anyway.
    prefix =
      host.platform === "win32"
        ? undefined
        : await pyenvPrefix(host, name, projectDir);
  }
  if (!prefix || !(await isVirtualEnv(host, prefix))) {
    return undefined;
  }
  return candidateIn(host, prefix, "pyenv");
}

async function pyenvPrefix(
  host: Host,
  name: string,
  cwd: string,
): Promise<string | undefined> {
  const outcome = await host.exec("pyenv", ["prefix", name], cwd);
  return outcome.ok ? lastLine(outcome.stdout) : undefined;
}

async function readPythonVersion(
  host: Host,
  projectDir: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  const p = pathFor(host.platform);
  let currentDir = projectDir;
  let prevDir: string | undefined;
  while (currentDir !== prevDir) {
    const contents = await host.readFile(p.join(currentDir, ".python-version"));
    const name = contents && firstLine(contents);
    if (name && PYENV_NAME.test(name) && !name.split("/").includes("..")) {
      return name;
    }
    if (currentDir === workspaceRoot) {
      return undefined;
    }
    prevDir = currentDir;
    currentDir = p.dirname(currentDir);
  }
  return undefined;
}

function firstLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");
}

function lastLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .pop();
}

const ENV_INFO = ["env", "info", "--path"];

/**
 * Where poetry ends up when it is installed the ways that do not put it in the
 * environment the editor runs in. Containers are the common case: pipx and the
 * official installer both extend PATH from a shell profile, which the
 * extension host never sources, so a bare `poetry` is not found even though
 * the integrated terminal finds it (#10).
 */
export function poetryCandidates(host: Host): string[] {
  const p = pathFor(host.platform);
  const home = host.homeDir();
  const poetryHome = host.env("POETRY_HOME");
  const candidates: string[] = [];

  if (host.platform === "win32") {
    const appData = host.env("APPDATA");
    if (poetryHome) {
      candidates.push(p.join(poetryHome, "Scripts", "poetry.exe"));
    }
    if (appData) {
      candidates.push(
        p.join(appData, "pypoetry", "venv", "Scripts", "poetry.exe"),
      );
    }
    candidates.push(p.join(home, ".local", "bin", "poetry.exe"));
    return candidates;
  }

  if (poetryHome) {
    candidates.push(p.join(poetryHome, "bin", "poetry"));
  }
  candidates.push(
    p.join(home, ".local", "bin", "poetry"),
    // The Python devcontainer feature's pipx bin directory.
    "/usr/local/py-utils/bin/poetry",
    "/usr/local/bin/poetry",
    "/opt/poetry/bin/poetry",
    // The installer poetry retired in 1.2, still on plenty of machines.
    p.join(home, ".poetry", "bin", "poetry"),
  );
  return candidates;
}

interface Entry {
  promise: Promise<Interpreter | undefined>;
  expiresAt: number;
}

export function createResolver(
  host: Host,
  logger: Logger = silentLogger,
): Resolver {
  const cache = new Map<string, Entry>();

  // An unusable environment stays unusable until something changes, and the
  // in-project lookup runs on every editor change, so say it once.
  const warned = new Set<string>();
  const warnOnce: WarnOnce = (key, message) => {
    if (warned.has(key)) {
      return;
    }
    warned.add(key);
    logger.warn(message);
  };

  // The executable that answered last, kept for the session. null means poetry
  // is on neither PATH nor any known install location, and re-checking that on
  // every editor change would buy nothing.
  let executable: string | null | undefined;

  async function runPoetry(
    projectDir: string,
    configured: string | undefined,
  ): Promise<ExecOutcome> {
    if (configured) {
      return host.exec(configured, ENV_INFO, projectDir);
    }
    if (executable === null) {
      return { ok: false, reason: "not-found" };
    }
    if (executable) {
      return host.exec(executable, ENV_INFO, projectDir);
    }

    const outcome = await host.exec("poetry", ENV_INFO, projectDir);
    if (outcome.ok || outcome.reason !== "not-found") {
      // poetry ran. Whether it liked this project is a separate question.
      executable = "poetry";
      return outcome;
    }

    for (const candidate of poetryCandidates(host)) {
      if (await host.exists(candidate)) {
        logger.info(`poetry is not on PATH; using ${candidate}`);
        executable = candidate;
        return host.exec(candidate, ENV_INFO, projectDir);
      }
    }

    logger.warn(
      "poetry was not found on PATH or in any of the usual install locations. " +
        "Set poetryMonorepo.poetryPath to its full path, or put it on the PATH " +
        "the editor itself runs with -- a shell profile is not enough.",
    );
    executable = null;
    return { ok: false, reason: "not-found" };
  }

  async function discover(
    projectDir: string,
    workspaceRoot: string,
    poetryPath: string | undefined,
  ) {
    return (
      (await fromPoetry(
        host,
        projectDir,
        logger,
        (dir) => runPoetry(dir, poetryPath),
        warnOnce,
      )) ?? (await fromPyenv(host, projectDir, workspaceRoot))
    );
  }

  return {
    async resolve(projectDir, workspaceRoot, poetryPath) {
      const inProject = await fromInProjectVenv(host, projectDir, warnOnce);
      if (inProject) {
        return inProject;
      }

      const cached = cache.get(projectDir);
      if (cached && cached.expiresAt > host.now()) {
        return cached.promise;
      }

      // expiresAt stays Infinity until the lookup settles, so concurrent
      // editor switches into the same project share one subprocess.
      const entry: Entry = {
        promise: discover(projectDir, workspaceRoot, poetryPath),
        expiresAt: Infinity,
      };
      cache.set(projectDir, entry);
      entry.promise.then(
        () => {
          entry.expiresAt = host.now() + TTL_MS;
        },
        () => {
          cache.delete(projectDir);
        },
      );
      return entry.promise;
    },

    poetryMissing() {
      return executable === null;
    },

    invalidate() {
      cache.clear();
      warned.clear();
      executable = undefined;
    },
  };
}
