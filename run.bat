@echo off
REM Windows runner script for Scheduler application
cd /d "%~dp0"
echo Starting Scheduler application with uv...
uv run run.py %*
pause
