# Change Log

## [0.2.0]

Added

- Poetry is now found when it is not on the PATH the editor runs with. pipx and
  the official installer both put it somewhere a shell profile adds, and an
  editor reads no shell profile, so a container where the terminal finds poetry
  would leave the extension silently doing nothing (#10). `$POETRY_HOME/bin`,
  `~/.local/bin`, `/usr/local/py-utils/bin`, `/usr/local/bin` and
  `/opt/poetry/bin` are tried, and the answer is kept for the session.
- `poetryMonorepo.poetryPath` names the executable outright, for installs in
  none of those places.
- An output channel, and **Poetry Monorepo: Show Logs** to open it. It records
  the project each file resolved to, every place an interpreter was looked for
  and what came back, and each setting written or left alone. When poetry
  cannot be found at all, that is now said once rather than not at all.
- `poetryMonorepo.generatePyrightConfig` keeps a `pyrightconfig.json` with one
  execution environment per Poetry project, and stops writing
  `python.analysis.extraPaths` (#2). Pylance matches files against those roots
  itself, so the file is written once instead of on every editor change and
  `.vscode/settings.json` stops moving. Off by default: a `pyrightconfig.json`
  makes Pylance ignore every `python.analysis.*` setting, not just this one.
  **Poetry Monorepo: Generate pyrightconfig.json** writes it on demand.
- Execution environments that the extension did not write are never
  overwritten; the file is left alone and the log says why.
- A warning when a virtualenv is there but has no interpreter in it. A
  virtualenv's `bin/python` is a symlink to the Python it was built against, so
  it dangles once that Python is removed or the environment is used under a
  different home directory. Every source rejects such an environment, rightly,
  and used to do so without a word. Said once per environment.
- A note in the log when a `pyrightconfig.json` or a `[tool.pyright]` table is
  already present and generation is off, since Pylance is ignoring the
  `extraPaths` being written in that case.
- A dev container under `.devcontainer/` that reproduces #10, for anyone
  working on it.

Changed

- Cached interpreter answers are dropped when a `poetryMonorepo` setting
  changes, so a corrected `poetryPath` takes effect without a reload.

## [0.1.1]

Fixed

- A file outside the package no longer puts its own directory on
  `python.analysis.extraPaths`. Opening `tests/test_app.py` used to write
  `tests`, which resolves nothing; it now writes the directory the package sits
  in, so `from your_package import ...` resolves. The same applies to any other
  directory in the project, `scripts` and `migrations` alike (#1).
- Editing inside the package is unchanged, so sibling imports resolve as
  before.
- Projects using a `src` layout get `src` rather than the project directory,
  and projects declaring several `packages` are recognised by each of them.

The package directory is read from `name` or `packages` in `pyproject.toml`.
Where neither can be read the path is left as 0.0.1 wrote it.

## [0.1.0]

First release since 0.0.1. Windows support was merged in October 2024 but never
published, so it ships here too.

Added

- Virtualenvs that Poetry keeps outside the project are now found, via
  `poetry env info --path`. Thanks to @thisdotfabio (#11).
- pyenv-virtualenv environments named in `.python-version` are now found.
  Thanks to @g3rv4 (#5).
- `poetryMonorepo.venvDiscovery` controls which of those are used, and in what
  order. Set it to `[]` to stop the extension changing the interpreter.
- `poetryMonorepo.updatePythonAnalysisExtraPaths` replaces the boolean
  `appendExtraPaths` and adds a `disable` option (#7). Thanks to @Mythir (#8).
- `poetryMonorepo.pytest.enabled` sets `python.testing.cwd` to the Poetry
  project of the active file so pytest finds its tests. Thanks to @Mythir (#8).
- Windows support. Thanks to @RomeoDespres (#6).
- Unit, VS Code integration and real-poetry test suites, and CI on Linux, macOS
  and Windows.

Changed

- Paths are updated when the active file moves between projects, not only when
  the interpreter changes (#3).
- Settings are only written when the value would actually change, so moving
  between files in the same project no longer rewrites `settings.json` (#2).
- Interpreter lookup no longer blocks the editor. Results are cached per
  project for a minute, and a project with an in-project `.venv` never runs a
  subprocess at all.
- Paths written to settings use forward slashes on every platform, so a
  committed `settings.json` still works for teammates on other systems.

Fixed

- A project whose virtualenv has not been created yet is left alone instead of
  being switched to the system Python. `poetry env info --path` reports the
  base interpreter in that case.
- An activated virtualenv inherited from the shell no longer makes every
  project in the monorepo resolve to that one environment.
- `python.testing.cwd` is written as `${workspaceFolder}/<path>`. A bare
  relative path with no separator is never resolved by the Python extension.
- The search for the nearest `pyproject.toml` could fail to terminate if it
  reached a filesystem root without matching the workspace root.
- `appendExtraPaths` keeps working for anyone who set it.

## [0.0.1]

- Initial release.
