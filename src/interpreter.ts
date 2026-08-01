import * as path from "path";

export type InterpreterSource = "in-project" | "poetry" | "pyenv";

export type ExecOutcome = { ok: true; stdout: string } | { ok: false };

export interface Host {
  platform: NodeJS.Platform;
  now(): number;
  pyenvRoot(): string;
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
    poetryPath: string,
    workspaceRoot: string,
  ): Promise<Interpreter | undefined>;
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

async function candidateIn(
  host: Host,
  venvPath: string,
  source: InterpreterSource,
): Promise<Interpreter | undefined> {
  const candidate = interpreterIn(venvPath, host.platform);
  return (await host.exists(candidate))
    ? { path: candidate, source }
    : undefined;
}

async function fromInProjectVenv(
  host: Host,
  poetryPath: string,
): Promise<Interpreter | undefined> {
  const venvPath = pathFor(host.platform).join(poetryPath, ".venv");
  return candidateIn(host, venvPath, "in-project");
}

async function fromPoetry(
  host: Host,
  poetryPath: string,
): Promise<Interpreter | undefined> {
  const outcome = await host.exec(
    "poetry",
    ["env", "info", "--path"],
    poetryPath,
  );
  if (!outcome.ok) {
    return undefined;
  }

  const venvPath = lastLine(outcome.stdout);
  if (!venvPath || !(await isVirtualEnv(host, venvPath))) {
    return undefined;
  }
  return candidateIn(host, venvPath, "poetry");
}

async function fromPyenv(
  host: Host,
  poetryPath: string,
  workspaceRoot: string,
): Promise<Interpreter | undefined> {
  const name = await readPythonVersion(host, poetryPath, workspaceRoot);
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
        : await pyenvPrefix(host, name, poetryPath);
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
  poetryPath: string,
  workspaceRoot: string,
): Promise<string | undefined> {
  const p = pathFor(host.platform);
  let currentDir = poetryPath;
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

interface Entry {
  promise: Promise<Interpreter | undefined>;
  expiresAt: number;
}

export function createResolver(host: Host): Resolver {
  const cache = new Map<string, Entry>();

  async function discover(poetryPath: string, workspaceRoot: string) {
    return (
      (await fromPoetry(host, poetryPath)) ??
      (await fromPyenv(host, poetryPath, workspaceRoot))
    );
  }

  return {
    async resolve(poetryPath, workspaceRoot) {
      const inProject = await fromInProjectVenv(host, poetryPath);
      if (inProject) {
        return inProject;
      }

      const cached = cache.get(poetryPath);
      if (cached && cached.expiresAt > host.now()) {
        return cached.promise;
      }

      // expiresAt stays Infinity until the lookup settles, so concurrent
      // editor switches into the same project share one subprocess.
      const entry: Entry = {
        promise: discover(poetryPath, workspaceRoot),
        expiresAt: Infinity,
      };
      cache.set(poetryPath, entry);
      entry.promise.then(
        () => {
          entry.expiresAt = host.now() + TTL_MS;
        },
        () => {
          cache.delete(poetryPath);
        },
      );
      return entry.promise;
    },

    invalidate() {
      cache.clear();
    },
  };
}
