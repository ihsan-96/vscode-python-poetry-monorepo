import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

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
    path.join(workspaceRoot().fsPath, "packages", name, name, "main.py")
  );
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(file)
  );
}

async function waitFor<T>(read: () => T, predicate: (value: T) => boolean) {
  for (let i = 0; i < 100; i++) {
    const value = read();
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
      true
    );
  });

  // The path written is the directory below pyproject.toml on the way to the
  // file, which is what 0.0.1 shipped.
  test("sets extraPaths from the active file", async () => {
    await openPackage("api");
    const paths = await waitFor(extraPaths, (v) => v?.[0] === "packages/api/api");

    assert.deepStrictEqual(paths, ["packages/api/api"]);
  });

  test("follows the active file between packages in the monorepo", async () => {
    await openPackage("api");
    await waitFor(extraPaths, (v) => v?.[0] === "packages/api/api");

    await openPackage("web");
    assert.deepStrictEqual(
      await waitFor(extraPaths, (v) => v?.[0] === "packages/web/web"),
      ["packages/web/web"]
    );

    await openPackage("api");
    assert.deepStrictEqual(
      await waitFor(extraPaths, (v) => v?.[0] === "packages/api/api"),
      ["packages/api/api"]
    );
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
        ["packages/api/api", "keep/me"]
      );
    });

    test("accumulates as the active file moves between packages", async () => {
      await openPackage("api");
      await waitFor(extraPaths, (v) => v?.[0] === "packages/api/api");

      await openPackage("web");

      assert.deepStrictEqual(
        await waitFor(extraPaths, (v) => v?.[0] === "packages/web/web"),
        ["packages/web/web", "packages/api/api", "keep/me"]
      );
    });
  });
});
