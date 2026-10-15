#!/usr/bin/env bash
# Runner script for Scheduler application using uv
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

echo "Starting Scheduler application with uv..."
uv run run.py "$@"
