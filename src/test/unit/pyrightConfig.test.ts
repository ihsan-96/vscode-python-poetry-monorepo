import * as assert from "assert";
import {
  ExecutionEnvironment,
  executionEnvironmentsFor,
  mergePyrightConfig,
} from "../../pyrightConfig";

const ROOT = "/repo";

suite("executionEnvironmentsFor", () => {
  test("gives each project its own entry", () => {
    const environments = executionEnvironmentsFor(ROOT, [
      { dir: "/repo/packages/api", packageDirs: ["/repo/packages/api/api"] },
      { dir: "/repo/packages/web", packageDirs: ["/repo/packages/web/web"] },
    ]);

    assert.deepStrictEqual(environments, [
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

  // The project dir resolves `from api import ...` from tests/, the package
  // dir resolves a sibling module from inside the package.
  test("lists the project and the package, which resolve different imports", () => {
    const [environment] = executionEnvironmentsFor(ROOT, [
      { dir: "/repo/api", packageDirs: ["/repo/api/api"] },
    ]);

    assert.deepStrictEqual(environment.extraPaths, ["api", "api/api"]);
  });

  test("handles a src layout", () => {
    const [environment] = executionEnvironmentsFor(ROOT, [
      { dir: "/repo/api", packageDirs: ["/repo/api/src/api"] },
    ]);

    assert.deepStrictEqual(environment.extraPaths, ["api", "api/src/api"]);
  });

  test("lists every declared package", () => {
    const [environment] = executionEnvironmentsFor(ROOT, [
      { dir: "/repo/api", packageDirs: ["/repo/api/api", "/repo/api/shared"] },
    ]);

    assert.deepStrictEqual(environment.extraPaths, [
      "api",
      "api/api",
      "api/shared",
    ]);
  });

  test("falls back to the project when no package can be found", () => {
    const [environment] = executionEnvironmentsFor(ROOT, [
      { dir: "/repo/api", packageDirs: [] },
    ]);

    assert.deepStrictEqual(environment, { root: "api", extraPaths: ["api"] });
  });

  // Pyright takes the first environment whose root contains the file, so an
  // outer project listed first would swallow every project inside it.
  test("puts a nested project ahead of the project it sits in", () => {
    const environments = executionEnvironmentsFor(ROOT, [
      { dir: "/repo", packageDirs: ["/repo/root_pkg"] },
      { dir: "/repo/packages/api", packageDirs: [] },
      { dir: "/repo/packages/api/plugins/auth", packageDirs: [] },
    ]);

    assert.deepStrictEqual(
      environments.map((environment) => environment.root),
      ["packages/api/plugins/auth", "packages/api", "."],
    );
  });

  test("names a project at the workspace root, which has no relative path", () => {
    const [environment] = executionEnvironmentsFor(ROOT, [
      { dir: "/repo", packageDirs: ["/repo/api"] },
    ]);

    assert.deepStrictEqual(environment, {
      root: ".",
      extraPaths: [".", "api"],
    });
  });

  test("orders projects at the same depth predictably", () => {
    const environments = executionEnvironmentsFor(ROOT, [
      { dir: "/repo/packages/web", packageDirs: [] },
      { dir: "/repo/packages/api", packageDirs: [] },
    ]);

    assert.deepStrictEqual(
      environments.map((environment) => environment.root),
      ["packages/api", "packages/web"],
    );
  });
});

suite("mergePyrightConfig", () => {
  const environments: ExecutionEnvironment[] = [
    { root: "packages/api", extraPaths: ["packages/api", "packages/api/api"] },
  ];

  function text(config: unknown) {
    return `${JSON.stringify(config, null, 2)}\n`;
  }

  test("writes a new file", () => {
    const result = mergePyrightConfig(undefined, environments);

    assert.deepStrictEqual(result, {
      status: "write",
      text: text({ executionEnvironments: environments }),
    });
  });

  test("keeps settings the file already had", () => {
    const existing = text({
      typeCheckingMode: "strict",
      exclude: ["**/node_modules"],
    });
    const result = mergePyrightConfig(existing, environments);

    assert.strictEqual(result.status, "write");
    assert.deepStrictEqual(JSON.parse((result as { text: string }).text), {
      typeCheckingMode: "strict",
      exclude: ["**/node_modules"],
      executionEnvironments: environments,
    });
  });

  test("writes nothing when the file already says this", () => {
    const existing = text({ executionEnvironments: environments });

    assert.deepStrictEqual(
      mergePyrightConfig(existing, environments, { previous: environments }),
      { status: "unchanged" },
    );
  });

  test("refuses environments this extension did not write", () => {
    const existing = text({
      executionEnvironments: [{ root: "mine", extraPaths: ["mine"] }],
    });

    assert.deepStrictEqual(mergePyrightConfig(existing, environments), {
      status: "conflict",
    });
  });

  test("refuses environments that changed since it wrote them", () => {
    const existing = text({
      executionEnvironments: [{ root: "edited", extraPaths: ["edited"] }],
    });

    assert.deepStrictEqual(
      mergePyrightConfig(existing, environments, { previous: environments }),
      { status: "conflict" },
    );
  });

  test("replaces them anyway when told to", () => {
    const existing = text({
      executionEnvironments: [{ root: "mine", extraPaths: ["mine"] }],
    });
    const result = mergePyrightConfig(existing, environments, { force: true });

    assert.deepStrictEqual(result, {
      status: "write",
      text: text({ executionEnvironments: environments }),
    });
  });

  test("updates its own entry in place", () => {
    const stale: ExecutionEnvironment[] = [
      { root: "old", extraPaths: ["old"] },
    ];
    const existing = text({
      typeCheckingMode: "basic",
      executionEnvironments: stale,
    });
    const result = mergePyrightConfig(existing, environments, {
      previous: stale,
    });

    assert.strictEqual(result.status, "write");
    assert.deepStrictEqual(JSON.parse((result as { text: string }).text), {
      typeCheckingMode: "basic",
      executionEnvironments: environments,
    });
  });

  test("leaves a file it cannot parse alone", () => {
    assert.deepStrictEqual(mergePyrightConfig("{ not json", environments), {
      status: "invalid",
    });
  });

  test("leaves a file that is not an object alone", () => {
    assert.deepStrictEqual(mergePyrightConfig("[]", environments), {
      status: "invalid",
    });
  });
});
