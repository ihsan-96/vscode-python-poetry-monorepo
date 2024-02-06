# Poetry Monorepo

Welcome to the README for the "poetry-monorepo" Visual Studio Code extension. This extension is designed to assist in setting the proper interpreter and adding package paths to work seamlessly with Poetry on a monorepo, where multiple Poetry projects coexist.

## Features

The "poetry-monorepo" extension offers the following features:

- Automatically sets the Python interpreter based on the closest `pyproject.toml` file in the workspace.
- Adds package paths to ensure proper functionality with Poetry in a monorepo setup, linking Python custom modules for improved IDE support.

**Note:** Screenshots or animations of the extension in action would be added here.

## Requirements

Before using this extension, make sure you have the following requirements:

- Visual Studio Code version 1.85.0 or higher.
- [VS Code Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) version 1.0.5 or higher.

## Extension Settings

This extension contributes the following settings:

- `poetryMonorepo.appendExtraPaths`: Option to append extra paths instead of replacing. Set to `true` to retain any extra paths you need. Only set this if you need any other extraPaths retained.

## Installation

1. Install the extension by searching for "poetry-monorepo" in the Visual Studio Code Extensions view.
2. Reload or restart Visual Studio Code.

## Known Issues

No known issues at the moment.

## Release Notes

### 0.0.1

- Initial release.

## Getting Started

1. Open a Python file within your monorepo workspace.
2. The extension will automatically set the Python interpreter based on the closest `pyproject.toml` file for any active python file.
3. Optionally, append extra paths by configuring the `poetryMonorepo.appendExtraPaths` setting, Set this only if you need other extraPaths retained.
4. Enjoy improved IDE support with linked Python custom modules and correct interpreter.

## Contribution

If you encounter any issues or have suggestions, feel free to contribute by opening an issue on the [GitHub repository](https://github.com/ihsan-96/vscode-python-poetry-monorepo).

## License

This extension is licensed under the [MIT License](LICENSE).

## Acknowledgments

Special thanks to the [Visual Studio Code team](https://code.visualstudio.com/) for providing a robust extension platform.

**Enjoy!**
