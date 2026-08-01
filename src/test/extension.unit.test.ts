import * as assert from "assert";
import { ExtensionConfig, IConfigService } from "../config";
import {
  updatePytestSettings,
  updatePythonAnalysisExtraPaths,
} from "../extension";

suite("Extension Unit Test Suite", () => {
  let configService: IConfigService;

  class MockConfigService implements IConfigService {
    public config: ExtensionConfig;

    constructor() {
      this.config = {
        poetryMonorepo: {
          updatePythonAnalysisExtraPaths: "replace",
          pytest: { enabled: false },
        },
        python: {
          analysis: { extraPaths: [] },
          testing: { cwd: "path_test_wd" },
        },
      };
    }

    async setPythonAnalysisExtraPaths(paths: string[]) {
      this.config.python.analysis.extraPaths = paths;
    }

    async setPythonTestingWorkingDirectory(arg: string) {
      this.config.python.testing.cwd = arg;
    }
  }

  setup(() => {
    configService = new MockConfigService();
  });

  suite("updatePytestSettings()", () => {
    suite("When enabled", () => {
      setup(() => {
        configService.config.poetryMonorepo.pytest.enabled = true;
      });

      test("Should update pytest settings when enabled", () => {
        updatePytestSettings("git/root/src/package", "git/root", configService);
        assert.deepEqual(
          configService.config.python.testing.cwd,
          "src/package"
        );
      });
    });

    suite("When disabled", () => {
      setup(() => {
        configService.config.poetryMonorepo.pytest.enabled = false;
      });

      test("Should not update test settings when disabled", () => {
        updatePytestSettings("git/root/src/package", "git/root", configService);
        assert.deepEqual(
          configService.config.python.testing.cwd,
          "path_test_wd"
        );
      });
    });
  });

  suite("updatePythonAnalysisExtraPaths()", () => {
    setup(() => {
      configService = new MockConfigService();
      configService.config.python.analysis = { extraPaths: ["path1", "path2"] };
    });

    suite("When set to replace", () => {
      setup(() => {
        configService.config.poetryMonorepo.updatePythonAnalysisExtraPaths =
          "replace";
      });

      test("Should replace the extra paths when set to replace", () => {
        updatePythonAnalysisExtraPaths(
          "git/root/src/package/package",
          "git/root",
          configService
        );
        assert.deepEqual(configService.config.python.analysis.extraPaths, [
          "src/package/package",
        ]);
      });
    });

    suite("When set to append", () => {
      setup(() => {
        configService.config.poetryMonorepo.updatePythonAnalysisExtraPaths =
          "append";
      });

      test("Should append the extra paths when set to append", () => {
        updatePythonAnalysisExtraPaths(
          "git/root/src/package/package",
          "git/root",
          configService
        );
        assert.deepEqual(configService.config.python.analysis.extraPaths, [
          "src/package/package",
          "path1",
          "path2",
        ]);
      });

      test("Should not append the extra path when set to append and already in paths", () => {
        configService.config.python.analysis.extraPaths = [
          "path1",
          "path2",
          "src/package/package",
        ];
        updatePythonAnalysisExtraPaths(
          "git/root/src/package/package",
          "git/root",
          configService
        );
        assert.deepEqual(configService.config.python.analysis.extraPaths, [
          "src/package/package",
          "path1",
          "path2",
        ]);
      });
    });

    suite("When set to disable", () => {
      setup(() => {
        configService.config.poetryMonorepo.updatePythonAnalysisExtraPaths =
          "disable";
      });

      test("Should not update the extra paths when set to disable", () => {
        updatePythonAnalysisExtraPaths(
          "git/root/src/package/package",
          "git/root",
          configService
        );
        assert.deepEqual(configService.config.python.analysis.extraPaths, [
          "path1",
          "path2",
        ]);
      });
    });
  });
});
