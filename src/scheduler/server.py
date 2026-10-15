"""FastAPI server application configuration and static file mounting."""

from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from scheduler.api.routes import router as api_router
from scheduler.db import init_db

# Locate static folder relative to this file
STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""
    init_db()
    app = FastAPI(
        title="Scheduler Local App",
        description="Local backend server and desktop-like frontend interface.",
        version="0.1.0",
        docs_url="/docs",
        redoc_url=None,
    )

    # Allow local CORS requests
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register API endpoints under /api
    app.include_router(api_router)

    # Mount static assets for the frontend UI
    if STATIC_DIR.exists():
        app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

    return app


app = create_app()
