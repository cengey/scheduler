# Scheduler (Local Desktop Web App)

A lightweight, modern Python desktop application architecture initialized with **[uv](https://astral.sh/uv)**. It runs a local backend server (**FastAPI** + **Uvicorn**) and automatically launches the frontend in your browser in **standalone app mode**—giving it the appearance and feel of a native desktop application (no browser tabs, address bar, or navigation buttons).

---

## How It Works ("Browser as an App")

When standard browsers open a website, they show address bars, bookmarks, and tab strips. However, Chromium-based browsers (Chrome, Edge, Brave) support a standalone application mode switch:

```bash
chrome --app=http://127.0.0.1:8000 --window-size=1200,800
```

This application foundation:
1. **Initializes the local FastAPI backend** on `127.0.0.1:8000`.
2. **Waits for the server to be ready** by polling `/api/health` so you never encounter `ERR_CONNECTION_REFUSED`.
3. **Launches the browser in `--app` mode** in a dedicated window with its own taskbar/dock icon, window controls, and title bar.
4. **Cross-platform**: Works out of the box on Linux, WSL (automatically launches Windows Chrome/Edge), macOS, and Windows. If `--app` mode is unsupported on a machine, it gracefully falls back to the default web browser.

---

## Project Structure

```
scheduler/
├── pyproject.toml          # UV project configuration and dependencies
├── README.md               # Documentation
├── run.py                  # Convenience root launcher: uv run run.py
├── run.sh                  # Linux/WSL bash launcher script
├── run.bat                 # Windows batch launcher (double-click friendly)
└── src/
    └── scheduler/
        ├── __init__.py     # Package exports
        ├── __main__.py     # Module execution entry: python -m scheduler
        ├── main.py         # CLI entry point, argument parser, and runner
        ├── launcher.py     # Cross-platform browser app-mode launcher
        ├── server.py       # FastAPI application & static assets mount
        ├── api/
        │   ├── __init__.py
        │   └── routes.py   # REST API endpoints (/api/health, /api/tasks, etc.)
        └── static/         # Frontend web application
            ├── index.html  # Desktop app shell layout & modals
            ├── manifest.json # Web App Manifest (display: standalone)
            ├── css/
            │   └── style.css # Desktop styling (app bar, dark theme, sidebar)
            ├── js/
            │   └── app.js   # Frontend state, API integration, and health check
            └── assets/
                └── icon.svg # Application icon
```

---

## Quick Start

### 1. Run with UV (Recommended)

To launch the backend and open the app window:
```bash
uv run scheduler
```
or via the root script:
```bash
uv run run.py
```

### 2. Available Options

```bash
uv run scheduler --help
```

- `--port <PORT>`: Specify a custom port (default: `8000`).
- `--host <HOST>`: Specify the network interface (default: `127.0.0.1`).
- `--reload`: Enable auto-reloading when you modify backend code.
- `--no-browser`: Run the backend server without launching the browser window.

---

## API & Documentation

The local backend includes automatic interactive API documentation powered by Swagger UI:
- **Application UI**: [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
- **Interactive Swagger Docs**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Health Check**: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)
