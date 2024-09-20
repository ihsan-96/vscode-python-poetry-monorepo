'use strict';
import * as VscodePython from "@vscode/python-extension";
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';

export async function activate(context: vscode.ExtensionContext) {

    const activeEditor = vscode.window.activeTextEditor;
    const pythonExtension = await VscodePython.PythonExtension.api()

    activeEditor && await onActiveTextEditorChange(activeEditor, pythonExtension);

    let disposable = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        editor && await onActiveTextEditorChange(editor, pythonExtension)
    });

    context.subscriptions.push(disposable);
}

async function onActiveTextEditorChange(editor: vscode.TextEditor | undefined, pythonExtension: VscodePython.PythonExtension) {
    if (!editor || editor.document.languageId !== 'python') return;

    const pythonFile = editor.document.uri.fsPath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(pythonFile));
    if (!workspaceFolder) return;

    let paths = FindClosestPyProjectTomlInPath(pythonFile, workspaceFolder.uri.fsPath);
    if (!paths) return;

    const [poetryPath, packageDirPath] = paths;

    setPythonInterpreter(poetryPath, packageDirPath, pythonExtension, workspaceFolder);
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

async function getPyEnvInterpreterPath(poetryPath: string, pyEnvNamePath: string) {
    const pyEnvName = fs.readFileSync(pyEnvNamePath, 'utf-8').trim();
    
    try {
        return await new Promise<string>((resolve, reject) => {
            exec(`pyenv prefix ${pyEnvName}`, { cwd: poetryPath }, (error, stdout, stderr) => {
                if (error) {
                    reject(`Error executing pyenv which: ${stderr}`);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    } catch (e) {
        return null;
    }
}

async function setPythonInterpreter(poetryPath: string, poetryPackagePath: string, pythonExtension: VscodePython.PythonExtension, workspaceFolder: vscode.WorkspaceFolder) {
    let pythonInterpreterPath: string | null = null;

    const pyEnvNamePath = path.join(poetryPath, '.python-version');
    if (fs.existsSync(pyEnvNamePath)) {
        pythonInterpreterPath = await getPyEnvInterpreterPath(poetryPath, pyEnvNamePath);
    }

    pythonInterpreterPath = pythonInterpreterPath ?? path.join(poetryPath, '.venv', 'bin', 'python');
    const currentInterpreter = pythonExtension.environments.getActiveEnvironmentPath().path
    if (pythonInterpreterPath !== currentInterpreter && fs.existsSync(pythonInterpreterPath)) {
        await pythonExtension.environments.updateActiveEnvironmentPath(pythonInterpreterPath);

        const appendExtraPath = vscode.workspace.getConfiguration('poetryMonorepo').get('appendExtraPaths');
        if (appendExtraPath) {
            setExtraPathsAppend(poetryPackagePath, workspaceFolder.uri.fsPath);
        } else {
            setExtraPaths(poetryPackagePath, workspaceFolder.uri.fsPath);
        }
        vscode.window.showInformationMessage(`Python interpreter and extra path changed.\n\nInterpreter: ${pythonInterpreterPath}.\n\nPath: ${poetryPackagePath}`)
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

export function deactivate() {}
