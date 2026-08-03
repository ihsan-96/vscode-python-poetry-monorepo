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

### Dev containers, and anywhere else poetry is not on PATH

The extension runs `poetry` the way any program runs another: it looks on the `PATH` the editor itself was started with. That is not the `PATH` your terminal has. pipx and the official installer both put poetry in a directory they add from a shell profile — `~/.local/bin` or `$POETRY_HOME/bin` — and a shell profile is read by shells, not by editors. In a container this is the usual outcome:

```console
$ bash -lic 'command -v poetry'   # your terminal
/home/vscode/.local/bin/poetry
$ bash -c 'command -v poetry'     # what the editor spawns
$
```

When a bare `poetry` is not found the extension tries the places it is normally installed, `$POETRY_HOME/bin`, `~/.local/bin`, `/usr/local/py-utils/bin`, `/usr/local/bin` and `/opt/poetry/bin` among them, so most containers need nothing. If yours keeps poetry somewhere else, name it:

```json
{ "poetryMonorepo.poetryPath": "/opt/poetry/bin/poetry" }
```

If the interpreter still does not change, run **Poetry Monorepo: Show Logs** from the command palette. The log names the project it found for the file, every place it looked for an interpreter, and what each one said.

## Keeping settings.json still

`python.analysis.extraPaths` is one workspace setting, so pointing it at whichever project you are editing means rewriting `.vscode/settings.json` as you move around. In a repo that commits that file, it never stops showing up in `git status`.

Pyright and Pylance already have a per-project answer, and the extension can maintain it for you:

```json
{ "poetryMonorepo.generatePyrightConfig": true }
```

That writes a `pyrightconfig.json` at the workspace root with one execution environment per Poetry project:

```json
{
  "executionEnvironments": [
    {
      "root": "packages/api",
      "extraPaths": ["packages/api", "packages/api/api"]
    },
    {
      "root": "packages/web",
      "extraPaths": ["packages/web", "packages/web/web"]
    }
  ]
}
```

Pylance matches each file against those roots itself, so the file is written once and `python.analysis.extraPaths` is left alone from then on. It is refreshed when a `pyproject.toml` appears, changes or is deleted, and **Poetry Monorepo: Generate pyrightconfig.json** does it on demand.

Two things worth knowing before turning it on:

- While a `pyrightconfig.json` exists, Pylance ignores **every** `python.analysis.*` setting, not just `extraPaths`. Settings you rely on, `typeCheckingMode` or `exclude` for instance, have to move into the file. Anything already in it is preserved; only `executionEnvironments` is rewritten.
- Execution environments you wrote yourself are never overwritten. The extension leaves the file alone and says so in the log; running the command asks first.

## Requirements

- VS Code 1.85 or newer
- The [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)

## Settings

| Setting                                         | Default                             | Description                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `poetryMonorepo.venvDiscovery`                  | `["in-project", "poetry", "pyenv"]` | Where to look for the interpreter, in order. Set to `[]` to leave the interpreter alone.                                                         |
| `poetryMonorepo.poetryPath`                     | `""`                                | Full path to the `poetry` executable. Empty means PATH, then the usual install locations.                                                        |
| `poetryMonorepo.generatePyrightConfig`          | `false`                             | Maintain `pyrightconfig.json` instead of writing `python.analysis.extraPaths`.                                                                   |
| `poetryMonorepo.updatePythonAnalysisExtraPaths` | `"replace"`                         | `replace` overwrites `python.analysis.extraPaths`, `append` puts the project ahead of what is already there, `disable` leaves the setting alone. |
| `poetryMonorepo.pytest.enabled`                 | `false`                             | Set `python.testing.cwd` to the Poetry project of the active file.                                                                               |
| `poetryMonorepo.appendExtraPaths`               | `false`                             | Deprecated, replaced by `updatePythonAnalysisExtraPaths`. Still honoured while that setting is unset.                                            |

## Known issues

- Working out which directory is the package needs a `name` or a `packages` entry in `pyproject.toml`, and the directory has to exist. When neither is readable the path falls back to the directory below `pyproject.toml` on the way to the file, which is what 0.0.1 shipped.
- `python.testing.cwd` is still a per-project setting when `poetryMonorepo.pytest.enabled` is on, so that one keeps being written as you move between projects. Pyright has no equivalent to move it into.
- `poetry env info --path` is run in the background for projects without an in-project `.venv`, and the answer is cached for a minute. Switching a project's environment with `poetry env use` can take up to that long to be noticed.

## Contributing

Issues and pull requests are welcome at the [GitHub repository](https://github.com/ihsan-96/vscode-python-poetry-monorepo).

```
npm install
npm test            # unit and VS Code integration tests
npm run test:poetry # runs against a real poetry install, skipped if absent
```

Press `F5` in VS Code to launch a window with the extension loaded.

`.devcontainer/` holds a container that reproduces the environment behind #10: poetry installed with pipx, reachable from a terminal and not from the editor. Reopen the repo in it, press `F5`, and open a file under `.devcontainer/monorepo`.

## License

[MIT](LICENSE)
