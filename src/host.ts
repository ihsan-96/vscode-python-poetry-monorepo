import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ExecOutcome, Host } from "./interpreter";

const TIMEOUT_MS = 10_000;

export const nodeHost: Host = {
  platform: process.platform,
  now: () => Date.now(),
  pyenvRoot: () => process.env.PYENV_ROOT ?? path.join(os.homedir(), ".pyenv"),

  async exists(target) {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  },

  async readFile(target) {
    try {
      return await fs.readFile(target, "utf8");
    } catch {
      return undefined;
    }
  },

  exec(file, args, cwd) {
    return new Promise<ExecOutcome>((resolve) => {
      execFile(
        file,
        args,
        { cwd, timeout: TIMEOUT_MS, windowsHide: true, env: childEnv() },
        (error, stdout) => {
          resolve(error ? { ok: false } : { ok: true, stdout });
        },
      );
    });
  },
};

// An activated virtualenv leaks in through the extension host's environment,
// and poetry honours it -- which would resolve every project in the monorepo
// to that one venv.
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.VIRTUAL_ENV;
  delete env.POETRY_ACTIVE;
  return env;
}
