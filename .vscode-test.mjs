import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

// The tests drive the extension, which writes settings.json. Run against a
// copy so a failed run cannot leave the fixture dirty.
const workspaceFolder = join(mkdtempSync(join(tmpdir(), 'poetry-monorepo-')), 'monorepo');
cpSync('src/test/fixtures/monorepo', workspaceFolder, { recursive: true });

export default defineConfig({
	files: 'out/test/integration/**/*.test.js',
	workspaceFolder,
	mocha: { timeout: 30000 },
});
