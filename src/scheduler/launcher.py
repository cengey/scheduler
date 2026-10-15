"""Browser launcher utility to open the web frontend in standalone application mode.

When opened with `--app=<url>`, Chromium-based browsers (Chrome, Edge, Brave)
render without address bars, navigation tabs, or bookmark bars, giving it the
look and feel of a native desktop application.
"""

import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from typing import Optional


def is_wsl() -> bool:
    """Check if the code is executing inside Windows Subsystem for Linux (WSL)."""
    if platform.system() != "Linux":
        return False
    try:
        with open("/proc/version", "r", encoding="utf-8") as f:
            return "microsoft" in f.read().lower()
    except Exception:
        return False


def find_browser_app_executable() -> Optional[list[str]]:
    """Find a browser executable that supports the `--app` standalone window switch."""
    # 1. Inside WSL, prefer Windows-side Chrome or Edge for native desktop UI
    if is_wsl():
        wsl_candidates = [
            "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
            "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
            "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
            "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe",
            "/mnt/c/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
        ]
        for path in wsl_candidates:
            if os.path.isfile(path) and os.access(path, os.X_OK):
                return [path]

    # 2. Native Windows
    if sys.platform == "win32":
        roots = [
            os.environ.get("PROGRAMFILES", r"C:\Program Files"),
            os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"),
            os.environ.get("LOCALAPPDATA", r"C:\Users\Default\AppData\Local"),
        ]
        rel_paths = [
            r"Google\Chrome\Application\chrome.exe",
            r"Microsoft\Edge\Application\msedge.exe",
            r"BraveSoftware\Brave-Browser\Application\brave.exe",
        ]
        for root in roots:
            for rel in rel_paths:
                full_path = os.path.join(root, rel)
                if os.path.isfile(full_path):
                    return [full_path]

    # 3. macOS
    if sys.platform == "darwin":
        mac_candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ]
        for path in mac_candidates:
            if os.path.isfile(path):
                return [path]

    # 4. Native Linux (non-WSL)
    linux_candidates = [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "brave-browser",
        "microsoft-edge",
    ]
    for cmd in linux_candidates:
        resolved = shutil.which(cmd)
        if resolved:
            return [resolved]

    return None


def wait_for_server(url: str, timeout: float = 10.0, interval: float = 0.1) -> bool:
    """Poll the server URL until it responds or timeout is reached."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status in (200, 301, 302, 307, 308):
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(interval)
    return False


def open_in_app_mode(
    url: str,
    window_width: int = 1200,
    window_height: int = 800,
    wait_url: Optional[str] = None,
) -> bool:
    """Open the URL in a standalone app window without browser chrome.

    Falls back to the default web browser if an app-compatible browser is not found.
    """
    if wait_url:
        wait_for_server(wait_url)

    browser_cmd = find_browser_app_executable()

    if browser_cmd:
        cmd = [
            *browser_cmd,
            f"--app={url}",
            f"--window-size={window_width},{window_height}",
        ]
        try:
            # Launch in background detached from console
            subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
            )
            return True
        except Exception as e:
            print(f"[Warning] Failed to launch app mode ({e}), falling back to default browser...")

    # Fallback to standard system browser
    if is_wsl():
        try:
            subprocess.Popen(
                ["cmd.exe", "/c", "start", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
            )
            return True
        except Exception:
            pass

    return webbrowser.open(url)
