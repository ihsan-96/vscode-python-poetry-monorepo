import { ExecOutcome, Host } from "../../interpreter";

export interface ExecCall {
  file: string;
  args: string[];
  cwd: string;
}

export interface FakeHost extends Host {
  execCalls: ExecCall[];
  clock: { value: number };
}

export interface FakeHostOptions {
  platform?: NodeJS.Platform;
  /** Paths that exist. Directories are implied by their contents. */
  paths?: string[];
  files?: Record<string, string>;
  pyenvRoot?: string;
  homeDir?: string;
  env?: Record<string, string>;
  exec?: (call: ExecCall) => ExecOutcome;
}

export function fakeHost(options: FakeHostOptions = {}): FakeHost {
  const platform = options.platform ?? "linux";
  const files = options.files ?? {};
  const paths = options.paths ?? [];
  const execCalls: ExecCall[] = [];
  const clock = { value: 1_000 };

  return {
    platform,
    execCalls,
    clock,
    now: () => clock.value,
    pyenvRoot: () => options.pyenvRoot ?? "/home/u/.pyenv",
    homeDir: () => options.homeDir ?? "/home/u",
    env: (name) => options.env?.[name],
    // Read through, so a test can add a path mid-run.
    async exists(target) {
      return paths.includes(target) || target in files;
    },
    async readFile(target) {
      return files[target];
    },
    async exec(file, args, cwd) {
      const call = { file, args, cwd };
      execCalls.push(call);
      return options.exec ? options.exec(call) : { ok: false };
    },
  };
}
