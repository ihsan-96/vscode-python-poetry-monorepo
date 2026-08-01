// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
"use strict";
import * as VscodePython from "@vscode/python-extension";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { IConfigService, UpdatePythonAnalysisExtraPathsConfig } from "./config";
import { ConfigService } from "./config";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  const activeEditor = vscode.window.activeTextEditor;
  const pythonExtension = await VscodePython.PythonExtension.api();

  activeEditor &&
    (await onActiveTextEditorChange(activeEditor, pythonExtension));

  let disposable = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    editor && (await onActiveTextEditorChange(editor, pythonExtension));
  });

  context.subscriptions.push(disposable);

  // let disposable_command = vscode.commands.registerCommand('poetry-monorepo.helloWorld', () => {
  // 	// The code you place here will be executed every time your command is executed
  // 	// Display a message box to the user
  // 	vscode.window.showInformationMessage('Changed environment and paths for poetry');
  // });
}

async function onActiveTextEditorChange(
  editor: vscode.TextEditor | undefined,
  pythonExtension: VscodePython.PythonExtension
) {
  if (!editor || editor.document.languageId !== "python") return;

  const pythonFile = editor.document.uri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(
    vscode.Uri.file(pythonFile)
  );
  const config = new ConfigService();

  if (!workspaceFolder) return;

  let paths = FindClosestPyProjectTomlInPath(
    pythonFile,
    workspaceFolder.uri.fsPath
  );
  if (!paths) return;

  const [poetryPath, packageDirPath] = paths;

  await setPythonInterpreter(
    poetryPath,
    packageDirPath,
    pythonExtension,
    workspaceFolder
  );
  updatePythonAnalysisExtraPaths(
    packageDirPath,
    workspaceFolder.uri.fsPath,
    config
  );
  updatePytestSettings(poetryPath, workspaceFolder.uri.fsPath, config);
}

function FindClosestPyProjectTomlInPath(
  pythonFile: string,
  workspaceRoot: string
) {
  let currentDir = pythonFile;
  let prevDir;
  do {
    currentDir = path.dirname(currentDir);
    const pyprojectTomlPath = path.join(currentDir, "pyproject.toml");
    if (fs.existsSync(pyprojectTomlPath)) {
      return [currentDir, prevDir || currentDir];
    }
    prevDir = currentDir;
  } while (currentDir !== workspaceRoot);
  return undefined;
}

async function setPythonInterpreter(
  poetryPath: string,
  poetryPackagePath: string,
  pythonExtension: VscodePython.PythonExtension,
  workspaceFolder: vscode.WorkspaceFolder
) {
  const binDir = process.platform === "win32" ? "Scripts" : "bin";
  const pythonExecutable =
    process.platform === "win32" ? "python.exe" : "python";
  const pythonInterpreterPath = path.join(
    poetryPath,
    ".venv",
    binDir,
    pythonExecutable
  );
  const currentInterpreter =
    pythonExtension.environments.getActiveEnvironmentPath().path;

  if (
    pythonInterpreterPath !== currentInterpreter &&
    fs.existsSync(pythonInterpreterPath)
  ) {
    await pythonExtension.environments.updateActiveEnvironmentPath(
      pythonInterpreterPath
    );
    vscode.window.showInformationMessage(
      `Python interpreter changed.\n\nInterpreter: ${pythonInterpreterPath}.\n\nPath: ${poetryPackagePath}`
    );
  }
}

export async function updatePythonAnalysisExtraPaths(
  packagePath: string,
  workspaceRoot: string,
  config: IConfigService
) {
  if (config.config.poetryMonorepo.updatePythonAnalysisExtraPaths === "disable")
    return;

  const packageRelativePath = path.relative(workspaceRoot, packagePath);
  let extraPaths: string[] = [];

  if (
    config.config.poetryMonorepo.updatePythonAnalysisExtraPaths === "append"
  ) {
    extraPaths = config.config.python.analysis.extraPaths.filter(
      (path) => path !== packageRelativePath
    );
  }

  extraPaths.unshift(packageRelativePath);
  await config.setPythonAnalysisExtraPaths(extraPaths);
}

export async function updatePytestSettings(
  poetryPath: string,
  workspaceRoot: string,
  config: IConfigService
) {
  if (!config.config.poetryMonorepo.pytest.enabled) return;

  const packageRelativePath = path.relative(workspaceRoot, poetryPath);

  await config.setPythonTestingWorkingDirectory(packageRelativePath);
}

// This method is called when your extension is deactivated
export function deactivate() {}
