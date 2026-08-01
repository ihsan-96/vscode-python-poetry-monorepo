import * as assert from "assert";
import * as path from "path";
import {
  findClosestPyProjectToml,
  nextExtraPaths,
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
      fakeExists([path.join(api, "pyproject.toml")])
    );

    assert.deepStrictEqual(found, [api, path.join(api, "api")]);
  });

  test("uses the poetry dir itself when the file sits beside pyproject.toml", () => {
    const found = findClosestPyProjectToml(
      path.join(api, "main.py"),
      root,
      fakeExists([path.join(api, "pyproject.toml")])
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
      ])
    );

    assert.deepStrictEqual(found?.[0], api);
  });

  test("finds a pyproject.toml at the workspace root", () => {
    const found = findClosestPyProjectToml(
      path.join(root, "src", "main.py"),
      root,
      fakeExists([path.join(root, "pyproject.toml")])
    );

    assert.deepStrictEqual(found, [root, path.join(root, "src")]);
  });

  test("returns undefined when there is none", () => {
    assert.strictEqual(
      findClosestPyProjectToml(path.join(api, "main.py"), root, fakeExists([])),
      undefined
    );
  });

  test("terminates when the file is outside the workspace root", () => {
    assert.strictEqual(
      findClosestPyProjectToml(
        path.resolve("/elsewhere/main.py"),
        root,
        fakeExists([])
      ),
      undefined
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
      ["pkg/api", "a", "b"]
    );
  });

  test("writes nothing when disabled", () => {
    assert.strictEqual(nextExtraPaths("disable", "pkg/api", ["a"]), undefined);
  });

  test("writes nothing when the value is already correct", () => {
    assert.strictEqual(nextExtraPaths("replace", "pkg/api", ["pkg/api"]), undefined);
    assert.strictEqual(
      nextExtraPaths("append", "pkg/api", ["pkg/api", "a"]),
      undefined
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
      "${workspaceFolder}/packages/api"
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
      "packages/api"
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
      samePath("C:\\p\\.venv\\Scripts\\python.exe", "c:/p/.venv/Scripts/python.exe", "win32")
    );
  });
});
