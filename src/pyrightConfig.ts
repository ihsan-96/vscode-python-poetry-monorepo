import { toSettingPath } from "./paths";

/**
 * Pyright's per-directory answer to what this extension otherwise expresses by
 * rewriting python.analysis.extraPaths on every editor change: one entry per
 * project, matched against the file being analysed. Written once, so
 * settings.json stops moving (#2).
 */
export interface ExecutionEnvironment {
  root: string;
  extraPaths: string[];
}

export interface Project {
  /** The directory holding pyproject.toml. */
  dir: string;
  /** Its importable package directories, from packageDirsFor. */
  packageDirs: string[];
}

export type MergeResult =
  | { status: "write"; text: string }
  | { status: "unchanged" }
  /** The file holds executionEnvironments this extension did not write. */
  | { status: "conflict" }
  | { status: "invalid" };

/**
 * The project directory resolves `from <package> import ...` from tests/ and
 * scripts/; the package directories resolve a sibling module from inside the
 * package. Both are listed rather than leaning on root being an implicit
 * search path, which pyright documents only in passing.
 */
export function executionEnvironmentsFor(
  workspaceRoot: string,
  projects: Project[],
): ExecutionEnvironment[] {
  const environments = projects.map((project) => {
    const root = relative(workspaceRoot, project.dir);
    const extraPaths = [
      root,
      ...project.packageDirs.map((dir) => relative(workspaceRoot, dir)),
    ];
    return { root, extraPaths: [...new Set(extraPaths)] };
  });

  // Pyright takes the first environment whose root contains the file, so a
  // nested project has to come before the project it sits in or the outer one
  // swallows it.
  return environments.sort(
    (a, b) => depth(b.root) - depth(a.root) || a.root.localeCompare(b.root),
  );
}

/**
 * Replaces executionEnvironments and leaves the rest of the file alone, so a
 * hand-written typeCheckingMode or exclude survives. `previous` is the block
 * this extension wrote last time; anything else in the file is someone's own
 * work and is refused rather than overwritten.
 */
export function mergePyrightConfig(
  existingText: string | undefined,
  environments: ExecutionEnvironment[],
  options: { previous?: ExecutionEnvironment[]; force?: boolean } = {},
): MergeResult {
  if (existingText === undefined) {
    return {
      status: "write",
      text: serialize({ executionEnvironments: environments }),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existingText);
  } catch {
    return { status: "invalid" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { status: "invalid" };
  }

  const config = parsed as Record<string, unknown>;
  const current = config.executionEnvironments;
  if (
    current !== undefined &&
    !options.force &&
    !isOurs(current, options.previous)
  ) {
    return { status: "conflict" };
  }

  // Spreading keeps executionEnvironments where it already was, and appends it
  // at the end when the file did not have one.
  const text = serialize({ ...config, executionEnvironments: environments });
  return text === existingText
    ? { status: "unchanged" }
    : { status: "write", text };
}

function isOurs(
  current: unknown,
  previous: ExecutionEnvironment[] | undefined,
): boolean {
  return previous !== undefined && stringify(current) === stringify(previous);
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function serialize(config: Record<string, unknown>): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** A project at the workspace root relativises to "", which is not a path. */
function relative(workspaceRoot: string, target: string): string {
  return toSettingPath(workspaceRoot, target) || ".";
}

function depth(root: string): number {
  return root === "." ? 0 : root.split("/").length;
}
