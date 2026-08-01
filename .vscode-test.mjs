import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@vscode/test-cli";

// The tests drive the extension, which writes settings.json. Run against a
// copy so a failed run cannot leave the fixture dirty.
const scratch = mkdtempSync(join(tmpdir(), "poetry-monorepo-"));
const workspaceFolder = join(scratch, "monorepo");
cpSync("src/test/fixtures/monorepo", workspaceFolder, { recursive: true });

export default defineConfig({
  files: "out/test/integration/**/*.test.js",
  workspaceFolder,
  // VS Code's IPC socket lives under the user data dir and macOS caps the path
  // at 103 characters, which a checkout path alone can exhaust.
  launchArgs: ["--user-data-dir", join(scratch, "u")],
  mocha: { timeout: 30000 },
});
