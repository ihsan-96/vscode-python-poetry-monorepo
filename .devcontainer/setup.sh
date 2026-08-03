#!/usr/bin/env bash
#
# Builds the extension and gives each package in .devcontainer/monorepo a
# virtualenv that lives outside the project, which is what poetry does by
# default in a container. An in-project .venv would be found without running
# poetry at all, which is exactly the case issue #10 is not about.
set -euo pipefail

cd "$(dirname "$0")/.."

npm install
npm run compile

# postCreateCommand does not get the login shell's PATH either, so say where
# poetry is rather than relying on the profile.
POETRY="$HOME/.local/bin/poetry"

export POETRY_VIRTUALENVS_IN_PROJECT=false
for project in .devcontainer/monorepo/packages/*/; do
  (cd "$project" && "$POETRY" env use python3 >/dev/null)
done

echo
echo "Issue #10 in one command -- these two should disagree:"
echo "  login shell:     $(bash -lic 'command -v poetry' 2>/dev/null || echo '<not found>')"
echo "  extension host:  $(bash -c 'command -v poetry' 2>/dev/null || echo '<not found>')"
