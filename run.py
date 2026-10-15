#!/usr/bin/env python3
"""Convenience runner script for Scheduler."""

import sys
from pathlib import Path

# Ensure src is on sys.path
src_dir = Path(__file__).resolve().parent / "src"
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

from scheduler.main import main

if __name__ == "__main__":
    main()
