# Poetry Monorepo

A [Visual Studio Code extension](https://marketplace.visualstudio.com/items?itemName=ameenahsanma.poetry-monorepo) for repositories that hold more than one Poetry project.

VS Code assumes one Python environment per workspace. In a monorepo that is wrong: each Poetry project has its own virtualenv and its own set of importable packages. This extension keeps the interpreter and the analysis paths pointed at whichever project the file you are editing belongs to, so imports resolve and completions work as you move around the repo.

## What it does

When you open or switch to a Python file, the extension finds the nearest `pyproject.toml` at or above it and then:

- sets the Python interpreter to that project's virtualenv;
- puts the right directory on `python.analysis.extraPaths` — the package itself while you are editing inside it, so a sibling module resolves, and the directory the package sits in while you are anywhere else, so `from your_package import ...` resolves from a test;
- optionally points `python.testing.cwd` at the project so pytest discovers its tests.

Nothing is written when the settings already say the right thing.

## Finding the virtualenv

Three places are checked, in order:

| Source       | Where it looks                                                |
| ------------ | ------------------------------------------------------------- |
| `in-project` | `.venv` next to `pyproject.toml`                              |
| `poetry`     | `poetry env info --path`                                      |
| `pyenv`      | the virtualenv named in `.python-version`, under `PYENV_ROOT` |

`in-project` is checked first and, when it hits, nothing else runs. If you use `virtualenvs.in-project = true` this costs a single file check and no subprocess.

A virtualenv is only accepted if it really is one. `poetry env info --path` reports the base interpreter for a project whose virtualenv has not been created yet, and `pyenv` does the same for a plain version like `3.11.12`; in both cases the extension leaves your interpreter alone rather than switching you to the system Python.

## Requirements

- VS Code 1.85 or newer
- The [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)

## Settings

| Setting                                         | Default                             | Description                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `poetryMonorepo.venvDiscovery`                  | `["in-project", "poetry", "pyenv"]` | Where to look for the interpreter, in order. Set to `[]` to leave the interpreter alone.                                                         |
| `poetryMonorepo.updatePythonAnalysisExtraPaths` | `"replace"`                         | `replace` overwrites `python.analysis.extraPaths`, `append` puts the project ahead of what is already there, `disable` leaves the setting alone. |
| `poetryMonorepo.pytest.enabled`                 | `false`                             | Set `python.testing.cwd` to the Poetry project of the active file.                                                                               |
| `poetryMonorepo.appendExtraPaths`               | `false`                             | Deprecated, replaced by `updatePythonAnalysisExtraPaths`. Still honoured while that setting is unset.                                            |

## Known issues

- Working out which directory is the package needs a `name` or a `packages` entry in `pyproject.toml`, and the directory has to exist. When neither is readable the path falls back to the directory below `pyproject.toml` on the way to the file, which is what 0.0.1 shipped.
- The extension writes to `.vscode/settings.json`, which shows up in `git status` if that file is committed. Set `poetryMonorepo.updatePythonAnalysisExtraPaths` to `disable` to stop it touching paths.
- `poetry env info --path` is run in the background for projects without an in-project `.venv`, and the answer is cached for a minute. Switching a project's environment with `poetry env use` can take up to that long to be noticed.

## Contributing

Issues and pull requests are welcome at the [GitHub repository](https://github.com/ihsan-96/vscode-python-poetry-monorepo).

```
npm install
npm test            # unit and VS Code integration tests
npm run test:poetry # runs against a real poetry install, skipped if absent
```

Press `F5` in VS Code to launch a window with the extension loaded.

## License

[MIT](LICENSE)
