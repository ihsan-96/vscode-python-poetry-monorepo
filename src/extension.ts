// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json

	// let disposable_command = vscode.commands.registerCommand('poetry-monorepo-helper.helloWorld', () => {
	// 	// The code you place here will be executed every time your command is executed
	// 	// Display a message box to the user
	// 	vscode.window.showInformationMessage('Changed environment and paths for poetry');
	// });

	let disposable = vscode.window.onDidChangeActiveTextEditor(onActiveTextEditorChange);

	context.subscriptions.push(disposable);
}

function onActiveTextEditorChange(editor: vscode.TextEditor | undefined) {
    if (!editor || editor.document.languageId !== 'python') return;

    const pythonFile = editor.document.uri.fsPath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(pythonFile));
    if (!workspaceFolder) return;

    let paths = FindClosestPyProjectTomlInPath(pythonFile, workspaceFolder.uri.fsPath)
    if (!paths) return;

    const [poetryPath, packageDirPath] = paths;

    setPythonInterpreter(poetryPath);
    setExtraPaths(packageDirPath, workspaceFolder.uri.fsPath);
    // vscode.window.showInformationMessage('Python environment set successfully.');
}

function FindClosestPyProjectTomlInPath(pythonFile: string, workspaceRoot: string) {
    let currentDir = pythonFile;
    let prevDir;
    do {
        currentDir = path.dirname(currentDir);
        const pyprojectTomlPath = path.join(currentDir, 'pyproject.toml');
        if (fs.existsSync(pyprojectTomlPath)) {
            return [currentDir, prevDir || currentDir];
        }
        prevDir = currentDir;
    } while (currentDir !== workspaceRoot)
    return undefined;
}

function setPythonInterpreter(poetryPath: string) {
    const pythonInterpreterPath = path.join(poetryPath, '.venv', 'bin', 'python');
    // const currentDefaultInterpreter = vscode.workspace.getConfiguration('python').get('defaultInterpreterPath')
    const currentInterpreter = vscode.extensions.getExtension('ms-python.python')?.exports.environments.getActiveEnvironmentPath().path
    if (pythonInterpreterPath !== currentInterpreter && fs.existsSync(pythonInterpreterPath)) {
        vscode.workspace.getConfiguration('python').update('defaultInterpreterPath', pythonInterpreterPath).then(_ => {
            vscode.commands.executeCommand('python.setInterpreter')
        });
    }
}

function setExtraPathsAppend(packagePath: string, workspaceRoot: string) {
    const packageRelativePath = path.relative(workspaceRoot, packagePath);
    const pythonConfig = vscode.workspace.getConfiguration('python')
    let extraPaths: string[] = pythonConfig.get('analysis.extraPaths') || [];
    const index = extraPaths.indexOf(packageRelativePath)
    if (index < 0) {
        extraPaths.unshift(packageRelativePath)
    } else if (index > 0) {
        extraPaths = extraPaths.filter(path => path !== packageRelativePath)
        extraPaths.unshift(packageRelativePath)
    }
    pythonConfig.update('analysis.extraPaths', extraPaths)
}

function setExtraPaths(packagePath: string, workspaceRoot: string) {
    const packageRelativePath = path.relative(workspaceRoot, packagePath);
    vscode.workspace.getConfiguration('python').update('analysis.extraPaths', [packageRelativePath])
}

// This method is called when your extension is deactivated
export function deactivate() {}
