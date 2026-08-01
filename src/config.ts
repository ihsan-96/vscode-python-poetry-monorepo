import * as vscode from "vscode";
import { InterpreterSource } from "./interpreter";
import { ExtraPathsMode, resolveExtraPathsMode } from "./paths";

export interface Settings {
  extraPathsMode: ExtraPathsMode;
  venvDiscovery: InterpreterSource[];
  pytestEnabled: boolean;
}

export interface ConfigService {
  readonly settings: Settings;
  readonly extraPaths: string[];
  readonly testingCwd: string | undefined;
  setExtraPaths(paths: string[]): Promise<void>;
  setTestingCwd(cwd: string): Promise<void>;
}

const DEFAULT_DISCOVERY: InterpreterSource[] = [
  "in-project",
  "poetry",
  "pyenv",
];

export function readSettings(scope: vscode.Uri): Settings {
  const config = vscode.workspace.getConfiguration("poetryMonorepo", scope);
  const inspected = config.inspect<ExtraPathsMode>(
    "updatePythonAnalysisExtraPaths"
  );

  return {
    extraPathsMode: resolveExtraPathsMode(
      inspected?.workspaceFolderValue ??
        inspected?.workspaceValue ??
        inspected?.globalValue,
      config.get<boolean>("appendExtraPaths")
    ),
    venvDiscovery:
      config.get<InterpreterSource[]>("venvDiscovery") ?? DEFAULT_DISCOVERY,
    pytestEnabled: config.get<boolean>("pytest.enabled") ?? false,
  };
}

export class VscodeConfigService implements ConfigService {
  constructor(private readonly scope: vscode.Uri) {}

  get settings(): Settings {
    return readSettings(this.scope);
  }

  get extraPaths(): string[] {
    return this.python().get<string[]>("analysis.extraPaths") ?? [];
  }

  get testingCwd(): string | undefined {
    return this.python().get<string>("testing.cwd") ?? undefined;
  }

  async setExtraPaths(paths: string[]) {
    await this.python().update("analysis.extraPaths", paths);
  }

  async setTestingCwd(cwd: string) {
    await this.python().update("testing.cwd", cwd);
  }

  private python() {
    return vscode.workspace.getConfiguration("python", this.scope);
  }
}
