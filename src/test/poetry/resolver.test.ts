import * as assert from "assert";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { nodeHost } from "../../host";
import { createResolver } from "../../interpreter";

const BIN = process.platform === "win32" ? "Scripts" : "bin";
const PYTHON = process.platform === "win32" ? "python.exe" : "python";

function poetryAvailable() {
  try {
    execFileSync("poetry", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function makeMonorepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "poetry-monorepo-e2e-"));
  for (const name of ["api", "web"]) {
    const dir = path.join(root, "packages", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "pyproject.toml"),
      [
        "[tool.poetry]",
        `name = "${name}"`,
        'version = "0.1.0"',
        'description = ""',
        "authors = []",
        "package-mode = false",
        "",
        "[tool.poetry.dependencies]",
        'python = "^3.9"',
        "",
        "[build-system]",
        'requires = ["poetry-core"]',
        'build-backend = "poetry.core.masonry.api"',
      ].join("\n"),
    );
  }
  return root;
}

function poetry(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  execFileSync("poetry", args, {
    cwd,
    stdio: "ignore",
    env: { ...process.env, ...env },
  });
}

suite("resolver against a real pyenv layout", function () {
  this.timeout(120_000);

  let root: string;
  let pyenvRoot: string;

  setup(() => {
    root = makeMonorepo();
    pyenvRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyenv-root-"));
    process.env.PYENV_ROOT = pyenvRoot;
  });

  teardown(() => {
    delete process.env.PYENV_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(pyenvRoot, { recursive: true, force: true });
  });

  test("resolves the virtualenv named in .python-version", async () => {
    const prefix = path.join(pyenvRoot, "versions", "api-3.11");
    execFileSync(process.platform === "win32" ? "python" : "python3", [
      "-m",
      "venv",
      prefix,
    ]);
    const api = path.join(root, "packages", "api");
    fs.writeFileSync(path.join(api, ".python-version"), "api-3.11\n");

    const found = await createResolver(nodeHost).resolve(api, root);

    assert.strictEqual(found?.source, "pyenv");
    assert.strictEqual(found?.path, path.join(prefix, BIN, PYTHON));
  });

  test("ignores a plain version, which is not a virtualenv", async () => {
    const prefix = path.join(pyenvRoot, "versions", "3.11.12");
    fs.mkdirSync(path.join(prefix, BIN), { recursive: true });
    fs.writeFileSync(path.join(prefix, BIN, PYTHON), "");
    const api = path.join(root, "packages", "api");
    fs.writeFileSync(path.join(api, ".python-version"), "3.11.12\n");

    assert.strictEqual(
      await createResolver(nodeHost).resolve(api, root),
      undefined,
    );
  });
});

suite("resolver against real poetry", function () {
  this.timeout(300_000);

  let root: string;
  let venvs: string;

  suiteSetup(function () {
    if (!poetryAvailable()) {
      this.skip();
    }
  });

  setup(() => {
    root = makeMonorepo();
    venvs = fs.mkdtempSync(path.join(os.tmpdir(), "poetry-venvs-"));
    process.env.POETRY_VIRTUALENVS_PATH = venvs;
    process.env.POETRY_CACHE_DIR = path.join(venvs, "cache");
  });

  teardown(() => {
    delete process.env.POETRY_VIRTUALENVS_PATH;
    delete process.env.POETRY_CACHE_DIR;
    delete process.env.VIRTUAL_ENV;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(venvs, { recursive: true, force: true });
  });

  test("leaves a project with no virtualenv alone", async () => {
    const api = path.join(root, "packages", "api");

    assert.strictEqual(
      await createResolver(nodeHost).resolve(api, root),
      undefined,
      "a project with no virtualenv must not resolve to the base interpreter",
    );
  });

  test("finds an in-project .venv without running poetry", async () => {
    const api = path.join(root, "packages", "api");
    poetry(["env", "use", "python3"], api, {
      POETRY_VIRTUALENVS_IN_PROJECT: "true",
    });

    const found = await createResolver(nodeHost).resolve(api, root);

    assert.strictEqual(found?.source, "in-project");
    assert.strictEqual(found?.path, path.join(api, ".venv", BIN, PYTHON));
  });

  test("finds a virtualenv poetry keeps outside the project", async () => {
    const api = path.join(root, "packages", "api");
    poetry(["env", "use", "python3"], api, {
      POETRY_VIRTUALENVS_IN_PROJECT: "false",
    });

    const found = await createResolver(nodeHost).resolve(api, root);

    assert.strictEqual(found?.source, "poetry");
    assert.ok(
      found!.path.startsWith(venvs),
      `${found!.path} should live under ${venvs}`,
    );
    assert.ok(fs.existsSync(found!.path));
  });

  test("keeps each package in the monorepo on its own virtualenv", async () => {
    const api = path.join(root, "packages", "api");
    const web = path.join(root, "packages", "web");
    for (const dir of [api, web]) {
      poetry(["env", "use", "python3"], dir, {
        POETRY_VIRTUALENVS_IN_PROJECT: "false",
      });
    }

    const resolver = createResolver(nodeHost);
    const forApi = await resolver.resolve(api, root);
    const forWeb = await resolver.resolve(web, root);

    assert.ok(forApi && forWeb);
    assert.notStrictEqual(
      forApi.path,
      forWeb.path,
      "packages must not share an interpreter",
    );
  });

  test("ignores an activated virtualenv leaking in from the environment", async () => {
    const api = path.join(root, "packages", "api");
    const web = path.join(root, "packages", "web");
    for (const dir of [api, web]) {
      poetry(["env", "use", "python3"], dir, {
        POETRY_VIRTUALENVS_IN_PROJECT: "false",
      });
    }

    const resolver = createResolver(nodeHost);
    const forWeb = await resolver.resolve(web, root);
    assert.ok(forWeb);

    // As if VS Code were launched from a shell with web's venv activated.
    process.env.VIRTUAL_ENV = path.dirname(path.dirname(forWeb.path));
    const forApi = await createResolver(nodeHost).resolve(api, root);

    assert.ok(forApi);
    assert.notStrictEqual(forApi.path, forWeb.path);
  });
});
