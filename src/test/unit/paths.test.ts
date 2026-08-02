import * as assert from "assert";
import * as path from "path";
import {
  extraPathDirFor,
  findClosestPyProjectToml,
  nextExtraPaths,
  packageDirsFor,
  resolveExtraPathsMode,
  samePath,
  testingCwdFor,
  toSettingPath,
} from "../../paths";

function fakeExists(present: string[]) {
  const set = new Set(present);
  return (target: string) => set.has(target);
}

suite("findClosestPyProjectToml", () => {
  const root = path.resolve("/repo");
  const api = path.join(root, "packages", "api");

  test("returns the poetry dir and the package dir below it", () => {
    const found = findClosestPyProjectToml(
      path.join(api, "api", "main.py"),
      root,
      fakeExists([path.join(api, "pyproject.toml")]),
    );

    assert.deepStrictEqual(found, [api, path.join(api, "api")]);
  });

  test("uses the poetry dir itself when the file sits beside pyproject.toml", () => {
    const found = findClosestPyProjectToml(
      path.join(api, "main.py"),
      root,
      fakeExists([path.join(api, "pyproject.toml")]),
    );

    assert.deepStrictEqual(found, [api, api]);
  });

  test("picks the closest pyproject.toml, not the workspace one", () => {
    const found = findClosestPyProjectToml(
      path.join(api, "api", "main.py"),
      root,
      fakeExists([
        path.join(api, "pyproject.toml"),
        path.join(root, "pyproject.toml"),
      ]),
    );

    assert.deepStrictEqual(found?.[0], api);
  });

  test("finds a pyproject.toml at the workspace root", () => {
    const found = findClosestPyProjectToml(
      path.join(root, "src", "main.py"),
      root,
      fakeExists([path.join(root, "pyproject.toml")]),
    );

    assert.deepStrictEqual(found, [root, path.join(root, "src")]);
  });

  test("returns undefined when there is none", () => {
    assert.strictEqual(
      findClosestPyProjectToml(path.join(api, "main.py"), root, fakeExists([])),
      undefined,
    );
  });

  test("terminates when the file is outside the workspace root", () => {
    assert.strictEqual(
      findClosestPyProjectToml(
        path.resolve("/elsewhere/main.py"),
        root,
        fakeExists([]),
      ),
      undefined,
    );
  });
});

suite("nextExtraPaths", () => {
  test("replaces by default", () => {
    assert.deepStrictEqual(nextExtraPaths("replace", "pkg/api", ["old"]), [
      "pkg/api",
    ]);
  });

  test("appends ahead of existing entries", () => {
    assert.deepStrictEqual(nextExtraPaths("append", "pkg/api", ["a", "b"]), [
      "pkg/api",
      "a",
      "b",
    ]);
  });

  test("moves an existing entry to the front rather than duplicating it", () => {
    assert.deepStrictEqual(
      nextExtraPaths("append", "pkg/api", ["a", "pkg/api", "b"]),
      ["pkg/api", "a", "b"],
    );
  });

  test("writes nothing when disabled", () => {
    assert.strictEqual(nextExtraPaths("disable", "pkg/api", ["a"]), undefined);
  });

  test("writes nothing when the value is already correct", () => {
    assert.strictEqual(
      nextExtraPaths("replace", "pkg/api", ["pkg/api"]),
      undefined,
    );
    assert.strictEqual(
      nextExtraPaths("append", "pkg/api", ["pkg/api", "a"]),
      undefined,
    );
  });

  test("switching packages rewrites the entry", () => {
    assert.deepStrictEqual(nextExtraPaths("replace", "pkg/web", ["pkg/api"]), [
      "pkg/web",
    ]);
  });
});

suite("resolveExtraPathsMode", () => {
  test("defaults to replace", () => {
    assert.strictEqual(resolveExtraPathsMode(undefined, undefined), "replace");
    assert.strictEqual(resolveExtraPathsMode(undefined, false), "replace");
  });

  test("honours appendExtraPaths from 0.0.1", () => {
    assert.strictEqual(resolveExtraPathsMode(undefined, true), "append");
  });

  test("prefers the new setting once it is set", () => {
    assert.strictEqual(resolveExtraPathsMode("replace", true), "replace");
    assert.strictEqual(resolveExtraPathsMode("disable", true), "disable");
    assert.strictEqual(resolveExtraPathsMode("append", false), "append");
  });
});

suite("testingCwdFor", () => {
  test("qualifies a single segment so the Python extension resolves it", () => {
    assert.strictEqual(testingCwdFor("backend"), "${workspaceFolder}/backend");
  });

  test("qualifies a nested path", () => {
    assert.strictEqual(
      testingCwdFor("packages/api"),
      "${workspaceFolder}/packages/api",
    );
  });

  test("handles the poetry project being the workspace root", () => {
    assert.strictEqual(testingCwdFor(""), "${workspaceFolder}");
  });
});

suite("toSettingPath", () => {
  test("emits forward slashes", () => {
    const root = path.resolve("/repo");
    assert.strictEqual(
      toSettingPath(root, path.join(root, "packages", "api")),
      "packages/api",
    );
  });
});

suite("samePath", () => {
  test("is exact off win32", () => {
    assert.ok(samePath("/a/python", "/a/python", "linux"));
    assert.ok(!samePath("/a/Python", "/a/python", "linux"));
  });

  test("ignores case and separator direction on win32", () => {
    assert.ok(
      samePath(
        "C:\\p\\.venv\\Scripts\\python.exe",
        "c:/p/.venv/Scripts/python.exe",
        "win32",
      ),
    );
  });
});

suite("packageDirsFor", () => {
  const project = path.resolve("/repo", "packages", "api");
  const toml = path.join(project, "pyproject.toml");

  function fakes(source: string | undefined, dirs: string[]) {
    const set = new Set(dirs);
    return [
      (target: string) => (target === toml ? source : undefined),
      (target: string) => set.has(target),
    ] as const;
  }

  test("derives the package dir from the poetry name", () => {
    const [read, isDir] = fakes(
      '[tool.poetry]\nname = "contact-sync-to-hubspot"\n',
      [path.join(project, "contact_sync_to_hubspot")],
    );

    assert.deepStrictEqual(packageDirsFor(project, read, isDir), [
      path.join(project, "contact_sync_to_hubspot"),
    ]);
  });

  test("finds a src layout", () => {
    const [read, isDir] = fakes('[project]\nname = "api"\n', [
      path.join(project, "src", "api"),
    ]);

    assert.deepStrictEqual(packageDirsFor(project, read, isDir), [
      path.join(project, "src", "api"),
    ]);
  });

  test("returns every declared package", () => {
    const [read, isDir] = fakes(
      '[tool.poetry]\nname = "api"\npackages = [{ include = "one" }, { include = "two", from = "lib" }]\n',
      [path.join(project, "one"), path.join(project, "lib", "two")],
    );

    assert.deepStrictEqual(packageDirsFor(project, read, isDir), [
      path.join(project, "one"),
      path.join(project, "lib", "two"),
    ]);
  });

  test("does not guess from the name once packages are declared", () => {
    const [read, isDir] = fakes(
      '[tool.poetry]\nname = "api"\npackages = [{ include = "one" }]\n',
      [path.join(project, "one"), path.join(project, "api")],
    );

    assert.deepStrictEqual(packageDirsFor(project, read, isDir), [
      path.join(project, "one"),
    ]);
  });

  test("reads a packages array spanning several lines", () => {
    const [read, isDir] = fakes(
      '[tool.poetry]\npackages = [\n  { include = "one" },\n  { include = "two" },\n]\n',
      [path.join(project, "two")],
    );

    assert.deepStrictEqual(packageDirsFor(project, read, isDir), [
      path.join(project, "two"),
    ]);
  });

  test("ignores a name outside tool.poetry and project", () => {
    const [read, isDir] = fakes(
      '[tool.black]\nname = "wrong"\n[tool.poetry]\nname = "api"\n',
      [path.join(project, "api"), path.join(project, "wrong")],
    );

    assert.deepStrictEqual(packageDirsFor(project, read, isDir), [
      path.join(project, "api"),
    ]);
  });

  test("ignores a commented out name", () => {
    const [read, isDir] = fakes('[tool.poetry]\n# name = "wrong"\n', [
      path.join(project, "wrong"),
    ]);

    assert.deepStrictEqual(packageDirsFor(project, read, isDir), []);
  });

  test("gives up when the derived directory is absent", () => {
    const [read, isDir] = fakes('[tool.poetry]\nname = "api"\n', []);

    assert.deepStrictEqual(packageDirsFor(project, read, isDir), []);
  });

  test("gives up when there is no pyproject.toml to read", () => {
    const [read, isDir] = fakes(undefined, [path.join(project, "api")]);

    assert.deepStrictEqual(packageDirsFor(project, read, isDir), []);
  });
});

suite("extraPathDirFor", () => {
  const project = path.resolve("/repo", "packages", "api");
  const pkg = path.join(project, "api");

  test("keeps the package for a file inside it", () => {
    assert.strictEqual(
      extraPathDirFor(path.join(pkg, "main.py"), pkg, [pkg]),
      pkg,
    );
  });

  test("keeps the package for a file nested deep inside it", () => {
    assert.strictEqual(
      extraPathDirFor(path.join(pkg, "a", "b", "main.py"), pkg, [pkg]),
      pkg,
    );
  });

  test("uses the package's parent for a file under tests", () => {
    const tests = path.join(project, "tests");
    assert.strictEqual(
      extraPathDirFor(path.join(tests, "test_main.py"), tests, [pkg]),
      project,
    );
  });

  // Nothing here knows the word "tests" -- any directory that is not a package
  // gets the same treatment.
  test("treats every other directory the same way", () => {
    for (const name of ["scripts", "migrations", "docs", "benchmarks"]) {
      const dir = path.join(project, name);
      assert.strictEqual(
        extraPathDirFor(path.join(dir, "thing.py"), dir, [pkg]),
        project,
        name,
      );
    }
  });

  test("uses the package's parent for a file beside pyproject.toml", () => {
    assert.strictEqual(
      extraPathDirFor(path.join(project, "main.py"), project, [pkg]),
      project,
    );
  });

  // A src layout keeps its 0.0.1 answer inside the package, and tests get
  // src/ rather than the project, since that is where the package sits.
  test("handles a src layout", () => {
    const src = path.join(project, "src");
    const srcPkg = path.join(src, "api");

    assert.strictEqual(
      extraPathDirFor(path.join(srcPkg, "main.py"), src, [srcPkg]),
      src,
    );
    assert.strictEqual(
      extraPathDirFor(
        path.join(project, "tests", "test_main.py"),
        path.join(project, "tests"),
        [srcPkg],
      ),
      src,
    );
  });

  test("recognises any of several packages", () => {
    const one = path.join(project, "one");
    const two = path.join(project, "two");

    assert.strictEqual(
      extraPathDirFor(path.join(two, "main.py"), two, [one, two]),
      two,
    );
  });

  test("keeps the 0.0.1 answer when no package can be found", () => {
    const tests = path.join(project, "tests");
    assert.strictEqual(
      extraPathDirFor(path.join(tests, "test_main.py"), tests, []),
      tests,
    );
  });
});
