# A container that reproduces issue #10.
#
# Poetry is installed the way containers usually install it: pipx, as the
# non-root user, into ~/.local/bin. Debian's .profile puts that directory on
# PATH, so an interactive terminal finds poetry. Nothing puts it in the image
# environment, so the process tree the VS Code server starts does not, and the
# extension's execFile("poetry", ...) fails with ENOENT.
#
# Do not add `ENV PATH="/home/vscode/.local/bin:${PATH}"` here. That is the
# working setup, and it hides the thing this container exists to show.
FROM mcr.microsoft.com/devcontainers/python:3.11

ARG POETRY_VERSION=2.1.4

USER vscode
RUN PIPX_HOME=/home/vscode/.local/share/pipx \
    PIPX_BIN_DIR=/home/vscode/.local/bin \
    pipx install "poetry==${POETRY_VERSION}"
USER root
