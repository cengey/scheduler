"""CLI Entrypoint for the Scheduler application."""

import argparse
import threading
import sys
import uvicorn

from scheduler.launcher import open_in_app_mode


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the Scheduler local backend and launch the standalone desktop app window."
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host interface to bind the local server to (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port number for the local server (default: 8000)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Start the server without launching the browser window",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reloading on code changes (development mode)",
    )

    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}"
    health_url = f"{url}/api/health"

    print("=" * 60)
    print("  🚀 SCHEDULER LOCAL APPLICATION")
    print("=" * 60)
    print(f"  • Backend Server : {url}")
    print(f"  • API Swagger    : {url}/docs")
    print(f"  • App UI         : {url}/")
    print("=" * 60)

    # Launch browser window in background once server is ready
    if not args.no_browser:
        launcher_thread = threading.Thread(
            target=open_in_app_mode,
            args=(url,),
            kwargs={"wait_url": health_url},
            daemon=True,
        )
        launcher_thread.start()

    # Start Uvicorn ASGI server
    try:
        uvicorn.run(
            "scheduler.server:app",
            host=args.host,
            port=args.port,
            reload=args.reload,
            log_level="info",
        )
    except KeyboardInterrupt:
        print("\n[Scheduler] Application stopped.")
        sys.exit(0)


if __name__ == "__main__":
    main()
