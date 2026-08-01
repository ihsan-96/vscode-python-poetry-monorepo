import * as vscode from "vscode";
import * as assert from "assert";
import { ConfigService } from "../config";
import { readFileSync, writeFileSync } from "fs";

suite("ConfigService test", () => {
  const configPath = "src/test/testWorkspace/.vscode/settings.json";
  let originalConfigJson: string;

  setup(() => {
    // Save settings.json so that we can recover after tests
    originalConfigJson = readFileSync(configPath, "utf8");
  });

  teardown(() => {
    writeFileSync(configPath, originalConfigJson);
  });

  suite("On instantiation", () => {
    test("Should fetch configured values from file", () => {
      let configService = new ConfigService();
      assert.deepEqual(configService.config.python.analysis.extraPaths, [
        "src/python/libs/mylib",
        "src/python/libs/anotherlib",
      ]);
    });

    test("Should fetch default values if not configured", () => {
      let configService = new ConfigService();
      assert.equal(
        configService.config.poetryMonorepo.updatePythonAnalysisExtraPaths,
        "replace"
      );
    });
  });

  suite("setPythonAnalysisExtraPaths()", () => {
    test("Should set the extraPaths value", async () => {
      let configService = new ConfigService();
      await configService.setPythonAnalysisExtraPaths([
        "src/python/libs/mylib",
      ]);
      assert.deepEqual(configService.config.python.analysis.extraPaths, [
        "src/python/libs/mylib",
      ]);
    });

    test("Should store the extraPaths value for later retrieval", async () => {
      let configService = new ConfigService();
      await configService.setPythonAnalysisExtraPaths([
        "src/python/libs/mylib",
      ]);
      let configService2 = new ConfigService();
      assert.deepEqual(configService2.config.python.analysis.extraPaths, [
        "src/python/libs/mylib",
      ]);
    });
  });

  suite("setPythonTestingWorkingDirectory()", () => {
    test("Should set the cwd value", async () => {
      let configService = new ConfigService();
      await configService.setPythonTestingWorkingDirectory(
        "src/python/libs/mylib"
      );
      assert.deepEqual(
        configService.config.python.testing.cwd,
        "src/python/libs/mylib"
      );
    });

    test("Should store the pytestArgs value for later retrieval", async () => {
      let configService = new ConfigService();
      await configService.setPythonTestingWorkingDirectory(
        "src/python/libs/mylib"
      );
      let configService2 = new ConfigService();
      assert.deepEqual(
        configService2.config.python.testing.cwd,
        "src/python/libs/mylib"
      );
    });
  });
});
