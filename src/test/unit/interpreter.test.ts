import * as assert from "assert";
import { createResolver, interpreterIn } from "../../interpreter";
import { fakeHost } from "./fakeHost";

const ROOT = "/repo";
const API = "/repo/packages/api";
const WEB = "/repo/packages/web";

suite("interpreterIn", () => {
  test("uses bin/python off win32", () => {
    assert.strictEqual(
      interpreterIn("/p/.venv", "linux"),
      "/p/.venv/bin/python",
    );
  });

  test("uses Scripts/python.exe on win32", () => {
    assert.strictEqual(
      interpreterIn("C:\\p\\.venv", "win32"),
      "C:\\p\\.venv\\Scripts\\python.exe",
    );
  });
});

suite("in-project venv", () => {
  test("wins without running anything", async () => {
    const host = fakeHost({ paths: [`${API}/.venv/bin/python`] });
    const found = await createResolver(host).resolve(API, ROOT);

    assert.deepStrictEqual(found, {
      path: `${API}/.venv/bin/python`,
      source: "in-project",
    });
    assert.strictEqual(host.execCalls.length, 0);
  });

  test("does not require pyvenv.cfg, matching 0.0.1", async () => {
    const host = fakeHost({ paths: [`${API}/.venv/bin/python`] });
    const found = await createResolver(host).resolve(API, ROOT);

    assert.strictEqual(found?.source, "in-project");
  });

  test("is never cached, so a newly created venv is picked up", async () => {
    const paths: string[] = [];
    const host = fakeHost({ paths });
    const resolver = createResolver(host);

    assert.strictEqual(await resolver.resolve(API, ROOT), undefined);
    paths.push(`${API}/.venv/bin/python`);
    assert.strictEqual(
      (await resolver.resolve(API, ROOT))?.source,
      "in-project",
    );
  });

  test("resolves per package in a monorepo", async () => {
    const host = fakeHost({
      paths: [`${API}/.venv/bin/python`, `${WEB}/.venv/bin/python`],
    });
    const resolver = createResolver(host);

    assert.strictEqual(
      (await resolver.resolve(API, ROOT))?.path,
      `${API}/.venv/bin/python`,
    );
    assert.strictEqual(
      (await resolver.resolve(WEB, ROOT))?.path,
      `${WEB}/.venv/bin/python`,
    );
  });
});

suite("poetry", () => {
  const cached = "/cache/virtualenvs/api-abc-py3.11";

  function poetryHost(stdout: string, extra: string[] = []) {
    return fakeHost({
      paths: [`${cached}/pyvenv.cfg`, `${cached}/bin/python`, ...extra],
      exec: () => ({ ok: true, stdout }),
    });
  }

  test("resolves a cached venv", async () => {
    const host = poetryHost(`${cached}\n`);
    const found = await createResolver(host).resolve(API, ROOT);

    assert.deepStrictEqual(found, {
      path: `${cached}/bin/python`,
      source: "poetry",
    });
    assert.deepStrictEqual(host.execCalls[0], {
      file: "poetry",
      args: ["env", "info", "--path"],
      cwd: API,
    });
  });

  test("rejects the base interpreter returned when no venv exists", async () => {
    const base = "/home/u/.pyenv/versions/3.11.12";
    const host = fakeHost({
      paths: [`${base}/bin/python`],
      exec: () => ({ ok: true, stdout: `${base}\n` }),
    });

    assert.strictEqual(
      await createResolver(host).resolve(API, ROOT),
      undefined,
    );
  });

  test("rejects empty output", async () => {
    const host = fakeHost({ exec: () => ({ ok: true, stdout: "\n" }) });
    assert.strictEqual(
      await createResolver(host).resolve(API, ROOT),
      undefined,
    );
  });

  test("rejects a non-zero exit even when a path was printed", async () => {
    const host = fakeHost({
      paths: [`${cached}/pyvenv.cfg`, `${cached}/bin/python`],
      exec: () => ({ ok: false }),
    });

    assert.strictEqual(
      await createResolver(host).resolve(API, ROOT),
      undefined,
    );
  });

  test("ignores a warning banner printed before the path", async () => {
    const host = poetryHost(`Warning: something\n${cached}\n`);
    assert.strictEqual(
      (await createResolver(host).resolve(API, ROOT))?.path,
      `${cached}/bin/python`,
    );
  });

  test("keeps monorepo packages on their own venvs", async () => {
    const apiEnv = "/cache/virtualenvs/api-abc-py3.11";
    const webEnv = "/cache/virtualenvs/web-def-py3.11";
    const host = fakeHost({
      paths: [
        `${apiEnv}/pyvenv.cfg`,
        `${apiEnv}/bin/python`,
        `${webEnv}/pyvenv.cfg`,
        `${webEnv}/bin/python`,
      ],
      exec: (call) => ({
        ok: true,
        stdout: call.cwd === API ? apiEnv : webEnv,
      }),
    });
    const resolver = createResolver(host);

    assert.strictEqual(
      (await resolver.resolve(API, ROOT))?.path,
      `${apiEnv}/bin/python`,
    );
    assert.strictEqual(
      (await resolver.resolve(WEB, ROOT))?.path,
      `${webEnv}/bin/python`,
    );
  });

  test("uses Scripts/python.exe on win32", async () => {
    const env = "C:\\cache\\api-abc";
    const host = fakeHost({
      platform: "win32",
      paths: [`${env}\\pyvenv.cfg`, `${env}\\Scripts\\python.exe`],
      exec: () => ({ ok: true, stdout: env }),
    });

    assert.strictEqual(
      (await createResolver(host).resolve("C:\\repo\\api", "C:\\repo"))?.path,
      `${env}\\Scripts\\python.exe`,
    );
  });
});

// A virtualenv's bin/python is a symlink to the Python it was built against,
// so it dangles once that Python is gone or the environment moves to another
// home directory. Every source rejects it, correctly, and used to do so
// without a word.
suite("a virtualenv whose interpreter is missing", () => {
  function loggingHost(paths: string[]) {
    const warnings: string[] = [];
    const host = fakeHost({ paths });
    const logger = {
      debug() {},
      info() {},
      warn: (message: string) => warnings.push(message),
    };
    return { host, logger, warnings };
  }

  test("says so rather than doing nothing quietly", async () => {
    const { host, logger, warnings } = loggingHost([`${API}/.venv`]);

    assert.strictEqual(
      await createResolver(host, logger).resolve(API, ROOT),
      undefined,
    );
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes(`${API}/.venv`));
    assert.ok(warnings[0].includes("poetry install"));
  });

  test("says it once, not on every editor change", async () => {
    const { host, logger, warnings } = loggingHost([`${API}/.venv`]);
    const resolver = createResolver(host, logger);

    await resolver.resolve(API, ROOT);
    await resolver.resolve(API, ROOT);
    await resolver.resolve(API, ROOT);

    assert.strictEqual(warnings.length, 1);
  });

  test("says it again after invalidate, once the venv may have been rebuilt", async () => {
    const { host, logger, warnings } = loggingHost([`${API}/.venv`]);
    const resolver = createResolver(host, logger);

    await resolver.resolve(API, ROOT);
    resolver.invalidate();
    await resolver.resolve(API, ROOT);

    assert.strictEqual(warnings.length, 2);
  });

  test("stays quiet when there is simply no venv", async () => {
    const { host, logger, warnings } = loggingHost([]);

    assert.strictEqual(
      await createResolver(host, logger).resolve(API, ROOT),
      undefined,
    );
    assert.deepStrictEqual(warnings, []);
  });

  test("covers a virtualenv poetry keeps outside the project", async () => {
    const outside = "/cache/virtualenvs/api-abc-py3.11";
    const warnings: string[] = [];
    const host = fakeHost({
      paths: [outside, `${outside}/pyvenv.cfg`],
      exec: () => ({ ok: true, stdout: `${outside}\n` }),
    });
    const logger = {
      debug() {},
      info() {},
      warn: (message: string) => warnings.push(message),
    };

    assert.strictEqual(
      await createResolver(host, logger).resolve(API, ROOT),
      undefined,
    );
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes(outside));
  });
});

// A container installs poetry with pipx or the official installer, both of
// which extend PATH from a shell profile the editor never sources, so the bare
// name is not found even though the terminal finds it (#10).
suite("finding poetry when it is not on PATH", () => {
  const cached = "/cache/virtualenvs/api-abc-py3.11";
  const local = "/home/u/.local/bin/poetry";

  /** A host where only `at` exists, and only that executable answers. */
  function hostWith(at: string | undefined, extra: string[] = []) {
    return fakeHost({
      paths: [
        `${cached}/pyvenv.cfg`,
        `${cached}/bin/python`,
        ...(at ? [at] : []),
        ...extra,
      ],
      exec: (call) =>
        call.file === at
          ? { ok: true, stdout: `${cached}\n` }
          : { ok: false, reason: "not-found" },
    });
  }

  test("falls back to the usual install locations", async () => {
    const host = hostWith(local);
    const found = await createResolver(host).resolve(API, ROOT);

    assert.strictEqual(found?.path, `${cached}/bin/python`);
    assert.deepStrictEqual(
      host.execCalls.map((call) => call.file),
      ["poetry", local],
    );
  });

  test("prefers the first location that exists", async () => {
    const host = fakeHost({
      paths: [
        `${cached}/pyvenv.cfg`,
        `${cached}/bin/python`,
        "/home/u/.poetry/bin/poetry",
        local,
      ],
      exec: (call) =>
        call.file === "poetry"
          ? { ok: false, reason: "not-found" }
          : { ok: true, stdout: `${cached}\n` },
    });
    await createResolver(host).resolve(API, ROOT);

    assert.deepStrictEqual(
      host.execCalls.map((call) => call.file),
      ["poetry", local],
    );
  });

  test("looks under POETRY_HOME first of all", async () => {
    const home = "/opt/pypoetry/bin/poetry";
    const host = fakeHost({
      paths: [`${cached}/pyvenv.cfg`, `${cached}/bin/python`, home, local],
      env: { POETRY_HOME: "/opt/pypoetry" },
      exec: (call) =>
        call.file === "poetry"
          ? { ok: false, reason: "not-found" }
          : { ok: true, stdout: `${cached}\n` },
    });
    await createResolver(host).resolve(API, ROOT);

    assert.deepStrictEqual(
      host.execCalls.map((call) => call.file),
      ["poetry", home],
    );
  });

  test("keeps the executable it found, rather than probing again", async () => {
    const host = hostWith(local);
    const resolver = createResolver(host);

    await resolver.resolve(API, ROOT);
    await resolver.resolve(WEB, ROOT);

    assert.deepStrictEqual(
      host.execCalls.map((call) => call.file),
      ["poetry", local, local],
    );
  });

  test("does not probe when poetry ran and simply failed", async () => {
    const host = fakeHost({
      paths: [local],
      exec: () => ({ ok: false }),
    });

    assert.strictEqual(
      await createResolver(host).resolve(API, ROOT),
      undefined,
    );
    assert.deepStrictEqual(
      host.execCalls.map((call) => call.file),
      ["poetry"],
    );
  });

  test("gives up once, not on every project", async () => {
    const host = hostWith(undefined);
    const resolver = createResolver(host);

    await resolver.resolve(API, ROOT);
    await resolver.resolve(WEB, ROOT);

    assert.deepStrictEqual(
      host.execCalls.map((call) => call.file),
      ["poetry"],
    );
    assert.strictEqual(resolver.poetryMissing(), true);
  });

  test("looks again after invalidate, so an install is picked up", async () => {
    const host = hostWith(undefined);
    const resolver = createResolver(host);

    await resolver.resolve(API, ROOT);
    resolver.invalidate();
    await resolver.resolve(API, ROOT);

    assert.strictEqual(host.execCalls.length, 2);
    assert.strictEqual(resolver.poetryMissing(), true);
  });

  test("uses a configured path verbatim, without probing", async () => {
    const configured = "/opt/custom/poetry";
    const host = hostWith(configured, [local]);
    const found = await createResolver(host).resolve(API, ROOT, configured);

    assert.strictEqual(found?.path, `${cached}/bin/python`);
    assert.deepStrictEqual(
      host.execCalls.map((call) => call.file),
      [configured],
    );
  });

  test("reports a configured path that does not work, rather than guessing", async () => {
    const host = hostWith(local);
    const resolver = createResolver(host);

    assert.strictEqual(
      await resolver.resolve(API, ROOT, "/opt/wrong/poetry"),
      undefined,
    );
    assert.deepStrictEqual(
      host.execCalls.map((call) => call.file),
      ["/opt/wrong/poetry"],
    );
  });

  test("looks in the Windows locations on win32", async () => {
    const installed =
      "C:\\Users\\u\\AppData\\Roaming\\pypoetry\\venv\\Scripts\\poetry.exe";
    const env = "C:\\cache\\api-abc";
    const host = fakeHost({
      platform: "win32",
      homeDir: "C:\\Users\\u",
      env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" },
      paths: [`${env}\\pyvenv.cfg`, `${env}\\Scripts\\python.exe`, installed],
      exec: (call) =>
        call.file === installed
          ? { ok: true, stdout: env }
          : { ok: false, reason: "not-found" },
    });

    assert.strictEqual(
      (await createResolver(host).resolve("C:\\repo\\api", "C:\\repo"))?.path,
      `${env}\\Scripts\\python.exe`,
    );
  });
});

suite("pyenv", () => {
  const prefix = "/home/u/.pyenv/versions/api";

  function pyenvHost(contents: string, at = `${API}/.python-version`) {
    return fakeHost({
      paths: [prefix, `${prefix}/pyvenv.cfg`, `${prefix}/bin/python`],
      files: { [at]: contents },
    });
  }

  test("resolves a virtualenv named in .python-version", async () => {
    const host = pyenvHost("api\n");
    const found = await createResolver(host).resolve(API, ROOT);

    assert.deepStrictEqual(found, {
      path: `${prefix}/bin/python`,
      source: "pyenv",
    });
  });

  test("resolves from the filesystem without running pyenv", async () => {
    const host = pyenvHost("api\n");
    await createResolver(host).resolve(API, ROOT);

    assert.deepStrictEqual(
      host.execCalls.map((call) => call.file),
      ["poetry"],
    );
  });

  test("walks up to the workspace root", async () => {
    const host = pyenvHost("api\n", `${ROOT}/.python-version`);
    assert.strictEqual(
      (await createResolver(host).resolve(API, ROOT))?.source,
      "pyenv",
    );
  });

  test("does not read above the workspace root", async () => {
    const host = pyenvHost("api\n", "/.python-version");
    assert.strictEqual(
      await createResolver(host).resolve(API, ROOT),
      undefined,
    );
  });

  test("takes the first line of a multi-version file", async () => {
    const host = pyenvHost("api\n3.11.12\n");
    assert.strictEqual(
      (await createResolver(host).resolve(API, ROOT))?.source,
      "pyenv",
    );
  });

  test("accepts the versions/envs form", async () => {
    const nested = "/home/u/.pyenv/versions/3.11.12/envs/api";
    const host = fakeHost({
      paths: [nested, `${nested}/pyvenv.cfg`, `${nested}/bin/python`],
      files: { [`${API}/.python-version`]: "3.11.12/envs/api\n" },
    });

    assert.strictEqual(
      (await createResolver(host).resolve(API, ROOT))?.path,
      `${nested}/bin/python`,
    );
  });

  test("rejects a plain version, which is not a virtualenv", async () => {
    const base = "/home/u/.pyenv/versions/3.11.12";
    const host = fakeHost({
      paths: [base, `${base}/bin/python`],
      files: { [`${API}/.python-version`]: "3.11.12\n" },
    });

    assert.strictEqual(
      await createResolver(host).resolve(API, ROOT),
      undefined,
    );
  });

  test("rejects a name that would be read as a flag", async () => {
    const host = pyenvHost("--version\n");
    await createResolver(host).resolve(API, ROOT);

    assert.ok(!host.execCalls.some((call) => call.file === "pyenv"));
  });

  test("never shells out to pyenv on win32", async () => {
    const host = fakeHost({
      platform: "win32",
      files: { "C:\\repo\\api\\.python-version": "api\n" },
    });
    await createResolver(host).resolve("C:\\repo\\api", "C:\\repo");

    assert.ok(!host.execCalls.some((call) => call.file === "pyenv"));
  });

  test("falls back to pyenv prefix for a non-default PYENV_ROOT", async () => {
    const elsewhere = "/opt/envs/api";
    const host = fakeHost({
      paths: [elsewhere, `${elsewhere}/pyvenv.cfg`, `${elsewhere}/bin/python`],
      files: { [`${API}/.python-version`]: "api\n" },
      exec: (call) =>
        call.file === "pyenv"
          ? { ok: true, stdout: `${elsewhere}\n` }
          : { ok: false },
    });

    assert.strictEqual(
      (await createResolver(host).resolve(API, ROOT))?.path,
      `${elsewhere}/bin/python`,
    );
  });
});

suite("caching", () => {
  const cached = "/cache/api";

  function countingHost() {
    return fakeHost({
      paths: [`${cached}/pyvenv.cfg`, `${cached}/bin/python`],
      exec: () => ({ ok: true, stdout: cached }),
    });
  }

  test("dedupes concurrent lookups into one subprocess", async () => {
    const host = countingHost();
    const resolver = createResolver(host);

    const [a, b] = await Promise.all([
      resolver.resolve(API, ROOT),
      resolver.resolve(API, ROOT),
    ]);

    assert.strictEqual(host.execCalls.length, 1);
    assert.strictEqual(a, b);
  });

  test("reuses the result until it expires", async () => {
    const host = countingHost();
    const resolver = createResolver(host);

    await resolver.resolve(API, ROOT);
    await resolver.resolve(API, ROOT);
    assert.strictEqual(host.execCalls.length, 1);

    host.clock.value += 60_001;
    await resolver.resolve(API, ROOT);
    assert.strictEqual(host.execCalls.length, 2);
  });

  test("caches per package, not globally", async () => {
    const host = countingHost();
    const resolver = createResolver(host);

    await resolver.resolve(API, ROOT);
    await resolver.resolve(WEB, ROOT);

    assert.deepStrictEqual(
      host.execCalls.map((call) => call.cwd),
      [API, WEB],
    );
  });

  test("invalidate forces a fresh lookup", async () => {
    const host = countingHost();
    const resolver = createResolver(host);

    await resolver.resolve(API, ROOT);
    resolver.invalidate();
    await resolver.resolve(API, ROOT);

    assert.strictEqual(host.execCalls.length, 2);
  });
});
