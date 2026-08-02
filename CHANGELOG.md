# Change Log

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
