import * as fs from "fs";
import * as path from "path";
export type ExtraPathsMode = "replace" | "append" | "disable";

/**
 * appendExtraPaths is the only setting 0.0.1 shipped, so it keeps working for
 * anyone who set it and never touched its replacement.
 */
export function resolveExtraPathsMode(
  explicit: ExtraPathsMode | undefined,
  legacyAppend: boolean | undefined,
): ExtraPathsMode {
  if (explicit) {
    return explicit;
  }
  return legacyAppend ? "append" : "replace";
}

/**
 * Nearest pyproject.toml at or above the file, plus the directory one level
 * below it -- the package directory that goes on python.analysis.extraPaths.
 */
export function findClosestPyProjectToml(
  pythonFile: string,
  workspaceRoot: string,
  exists: (target: string) => boolean = fs.existsSync,
): [string, string] | undefined {
  let currentDir = path.dirname(pythonFile);
  let prevDir: string | undefined;
  // dirname is a fixed point at "/", "C:\" and "\\server\share", so compare
  // against the previous value rather than trusting the root check alone.
  while (currentDir !== prevDir) {
    if (exists(path.join(currentDir, "pyproject.toml"))) {
      return [currentDir, prevDir ?? currentDir];
    }
    if (currentDir === workspaceRoot) {
      return undefined;
    }
    prevDir = currentDir;
    currentDir = path.dirname(currentDir);
  }
  return undefined;
}

// settings.json is routinely committed and shared across platforms, so keep
// separators portable rather than emitting Windows backslashes.
export function toSettingPath(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

/** The extraPaths to write, or undefined when nothing needs to change. */
export function nextExtraPaths(
  mode: ExtraPathsMode,
  packageRelativePath: string,
  existing: string[],
): string[] | undefined {
  if (mode === "disable") {
    return undefined;
  }

  const kept = mode === "append" ? existing : [];
  const next = [
    packageRelativePath,
    ...kept.filter((entry) => entry !== packageRelativePath),
  ];

  return sameList(next, existing) ? undefined : next;
}

/**
 * The Python extension leaves a relative cwd untouched unless it contains a
 * separator, so a single-segment "backend" would never resolve against the
 * workspace root. ${workspaceFolder} is expanded before that check.
 */
export function testingCwdFor(poetryRelativePath: string): string {
  return poetryRelativePath
    ? `\${workspaceFolder}/${poetryRelativePath}`
    : "${workspaceFolder}";
}

export function samePath(a: string, b: string, platform: NodeJS.Platform) {
  if (platform !== "win32") {
    return a === b;
  }
  return normalizeWindows(a) === normalizeWindows(b);
}

function normalizeWindows(target: string) {
  return path.win32.normalize(target).toLowerCase();
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}
