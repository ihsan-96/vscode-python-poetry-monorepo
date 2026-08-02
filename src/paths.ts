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

export interface PyProject {
  name?: string;
  packages: { include: string; from?: string }[];
}

/**
 * Enough of pyproject.toml to locate the package directory. Anything it fails
 * to understand leaves the caller on the 0.0.1 path, so a parse miss costs the
 * fix rather than breaking the behaviour that already works.
 */
export function parsePyProject(source: string): PyProject {
  const parsed: PyProject = { packages: [] };
  const lines = source.split(/\r?\n/);
  let table = "";

  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]).trim();
    const header = /^\[\[?\s*([^\]]+?)\s*\]?\]$/.exec(line);
    if (header) {
      table = header[1];
      continue;
    }
    if (table !== "tool.poetry" && table !== "project") {
      continue;
    }

    const name = /^name\s*=\s*["']([^"']+)["']/.exec(line);
    if (name) {
      parsed.name ??= name[1];
      continue;
    }

    if (table === "tool.poetry" && /^packages\s*=/.test(line)) {
      let block = line;
      while (unclosed(block) && i + 1 < lines.length) {
        block += ` ${stripComment(lines[++i])}`;
      }
      for (const [entry] of block.matchAll(/\{[^}]*\}/g)) {
        const include = /include\s*=\s*["']([^"']+)["']/.exec(entry);
        const from = /from\s*=\s*["']([^"']+)["']/.exec(entry);
        if (include) {
          parsed.packages.push({ include: include[1], from: from?.[1] });
        }
      }
    }
  }

  return parsed;
}

/**
 * The directory to put on python.analysis.extraPaths.
 *
 * Editing inside a package keeps the 0.0.1 answer, so sibling modules resolve
 * exactly as they always have. Everywhere else in the project -- tests/,
 * scripts/, migrations/, a file beside pyproject.toml -- the answer is the
 * directory the package sits in, which is what makes `from <package> import
 * ...` resolve. No directory name is special; what matters is whether the file
 * is inside a package. With no package to go on, 0.0.1 behaviour stands.
 */
export function extraPathDirFor(
  pythonFile: string,
  dirBelowProject: string,
  packageDirs: string[],
): string {
  if (packageDirs.length === 0) {
    return dirBelowProject;
  }
  if (packageDirs.some((dir) => contains(dir, pythonFile))) {
    return dirBelowProject;
  }
  return path.dirname(packageDirs[0]);
}

function contains(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** The project's importable package directories, from pyproject.toml. */
export function packageDirsFor(
  projectDir: string,
  readFile: (target: string) => string | undefined = readFileSafe,
  isDirectory: (target: string) => boolean = isDirectorySafe,
): string[] {
  const source = readFile(path.join(projectDir, "pyproject.toml"));
  if (source === undefined) {
    return [];
  }

  const parsed = parsePyProject(source);
  const candidates = parsed.packages.map((pkg) =>
    path.join(projectDir, pkg.from ?? "", pkg.include),
  );

  // A project that lists its packages has said all there is to say. Only guess
  // from the name when it has not.
  if (candidates.length === 0 && parsed.name) {
    const moduleName = parsed.name.replace(/[-.]/g, "_");
    candidates.push(
      path.join(projectDir, moduleName),
      path.join(projectDir, "src", moduleName),
    );
  }

  return candidates.filter(isDirectory);
}

function stripComment(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

function unclosed(block: string): boolean {
  const open = (block.match(/\[/g) ?? []).length;
  return open > (block.match(/\]/g) ?? []).length;
}

function readFileSafe(target: string): string | undefined {
  try {
    return fs.readFileSync(target, "utf8");
  } catch {
    return undefined;
  }
}

function isDirectorySafe(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
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
