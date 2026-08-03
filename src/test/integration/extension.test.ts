import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import type * as VscodePython from "@vscode/python-extension";

const EXTENSION_ID = "ameenahsanma.poetry-monorepo";

function workspaceRoot() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "test workspace folder is missing");
  return folder.uri;
}

function python() {
  return vscode.workspace.getConfiguration("python", workspaceRoot());
}

function poetryMonorepo() {
  return vscode.workspace.getConfiguration("poetryMonorepo", workspaceRoot());
}

function extraPaths() {
  return python().get<string[]>("analysis.extraPaths");
}

async function openPackage(name: string) {
  const file = vscode.Uri.file(
    path.join(workspaceRoot().fsPath, "packages", name, name, "main.py"),
  );
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(file),
  );
}

// The Python extension can be slow to come up on a cold CI runner, so allow
// well past the point where a working setup would have settled. Readers may be
// async -- reading a file is -- and a sync one awaits to itself.
async function waitFor<T>(
  read: () => T | Promise<T>,
  predicate: (value: T) => boolean,
): Promise<T> {
  for (let i = 0; i < 250; i++) {
    const value = await read();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return read();
}

suite("Extension", () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
    await extension.activate();
  });

  // Showing a document that is already active fires no change event.
  setup(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("activates", () => {
    assert.strictEqual(
      vscode.extensions.getExtension(EXTENSION_ID)?.isActive,
      true,
    );
  });

  // The path written is the directory below pyproject.toml on the way to the
  // file, which is what 0.0.1 shipped.
  test("sets extraPaths from the active file", async () => {
    await openPackage("api");
    const paths = await waitFor(
      extraPaths,
      (v) => v?.[0] === "packages/api/api",
    );

    assert.deepStrictEqual(paths, ["packages/api/api"]);
  });

  // A test imports the package by name, so it needs the project on the path
  // rather than tests/, which is what 0.1.0 wrote.
  test("uses the project, not tests/, for a file under tests", async () => {
    const file = vscode.Uri.file(
      path.join(
        workspaceRoot().fsPath,
        "packages",
        "api",
        "tests",
        "test_main.py",
      ),
    );
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(file),
    );

    assert.deepStrictEqual(
      await waitFor(extraPaths, (v) => v?.[0] === "packages/api"),
      ["packages/api"],
    );
  });

  test("follows the active file between packages in the monorepo", async () => {
    await openPackage("api");
    await waitFor(extraPaths, (v) => v?.[0] === "packages/api/api");

    await openPackage("web");
    assert.deepStrictEqual(
      await waitFor(extraPaths, (v) => v?.[0] === "packages/web/web"),
      ["packages/web/web"],
    );

    await openPackage("api");
    assert.deepStrictEqual(
      await waitFor(extraPaths, (v) => v?.[0] === "packages/api/api"),
      ["packages/api/api"],
    );
  });

  // The fixture's Scripts/python.exe is a placeholder, so only the POSIX
  // layout can actually be selected.
  (process.platform === "win32" ? suite.skip : suite)("interpreter", () => {
    function activeInterpreter() {
      return vscode.extensions
        .getExtension<VscodePython.PythonExtension>("ms-python.python")
        ?.exports.environments.getActiveEnvironmentPath().path;
    }

    function venvOf(name: string) {
      return path.join(
        workspaceRoot().fsPath,
        "packages",
        name,
        ".venv",
        "bin",
        "python",
      );
    }

    test("follows the active file between packages", async () => {
      await openPackage("api");
      assert.strictEqual(
        await waitFor(activeInterpreter, (v) => v === venvOf("api")),
        venvOf("api"),
      );

      await openPackage("web");
      assert.strictEqual(
        await waitFor(activeInterpreter, (v) => v === venvOf("web")),
        venvOf("web"),
      );
    });
  });

  suite("with pytest support enabled", () => {
    setup(async () => {
      await poetryMonorepo().update("pytest.enabled", true);
    });

    teardown(async () => {
      await poetryMonorepo().update("pytest.enabled", undefined);
      await python().update("testing.cwd", undefined);
    });

    test("points the test working directory at the Poetry project", async () => {
      const testingCwd = () => python().get<string>("testing.cwd");

      await openPackage("api");
      assert.strictEqual(
        await waitFor(
          testingCwd,
          (v) => v === "${workspaceFolder}/packages/api",
        ),
        "${workspaceFolder}/packages/api",
      );

      await openPackage("web");
      assert.strictEqual(
        await waitFor(
          testingCwd,
          (v) => v === "${workspaceFolder}/packages/web",
        ),
        "${workspaceFolder}/packages/web",
      );
    });
  });

  // Pyright reads these itself, per file, so settings.json stops being
  // rewritten as the active file moves between projects (#2).
  suite("with pyrightconfig generation enabled", () => {
    const sentinel = ["untouched"];

    function pyrightConfigUri() {
      return vscode.Uri.joinPath(workspaceRoot(), "pyrightconfig.json");
    }

    async function readPyrightConfig() {
      try {
        return JSON.parse(
          Buffer.from(
            await vscode.workspace.fs.readFile(pyrightConfigUri()),
          ).toString("utf8"),
        );
      } catch {
        return undefined;
      }
    }

    setup(async () => {
      await python().update("analysis.extraPaths", sentinel);
      await poetryMonorepo().update("generatePyrightConfig", true);
    });

    teardown(async () => {
      await poetryMonorepo().update("generatePyrightConfig", undefined);
      await python().update("analysis.extraPaths", []);
      try {
        await vscode.workspace.fs.delete(pyrightConfigUri());
      } catch {
        // Nothing to clean up if the test never got as far as writing it.
      }
    });

    test("writes an execution environment per Poetry project", async () => {
      const config = await waitFor(
        readPyrightConfig,
        (value) => value?.executionEnvironments?.length === 2,
      );

      assert.deepStrictEqual(config.executionEnvironments, [
        {
          root: "packages/api",
          extraPaths: ["packages/api", "packages/api/api"],
        },
        {
          root: "packages/web",
          extraPaths: ["packages/web", "packages/web/web"],
        },
      ]);
    });

    test("stops writing python.analysis.extraPaths", async () => {
      await waitFor(
        readPyrightConfig,
        (value) => value?.executionEnvironments?.length === 2,
      );

      await openPackage("api");
      await openPackage("web");

      assert.deepStrictEqual(extraPaths(), sentinel);
    });
  });

  suite("with the deprecated appendExtraPaths set", () => {
    setup(async () => {
      await poetryMonorepo().update("appendExtraPaths", true);
      await python().update("analysis.extraPaths", ["keep/me"]);
    });

    teardown(async () => {
      await poetryMonorepo().update("appendExtraPaths", undefined);
      await python().update("analysis.extraPaths", []);
    });

    test("keeps existing paths, as it did in 0.0.1", async () => {
      await openPackage("api");

      assert.deepStrictEqual(
        await waitFor(extraPaths, (v) => v?.[0] === "packages/api/api"),
        ["packages/api/api", "keep/me"],
      );
    });

    test("accumulates as the active file moves between packages", async () => {
      await openPackage("api");
      await waitFor(extraPaths, (v) => v?.[0] === "packages/api/api");

      await openPackage("web");

      assert.deepStrictEqual(
        await waitFor(extraPaths, (v) => v?.[0] === "packages/web/web"),
        ["packages/web/web", "packages/api/api", "keep/me"],
      );
    });
  });
});
