"""Lightweight SQLite database manager for Scheduler Desktop.

Stores teachers, shift configurations, schedule adjustments, and generated rosters.
All data is stored locally in data/scheduler.db and never committed to version control.
"""

import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
DB_PATH = DATA_DIR / "scheduler.db"


def get_connection() -> sqlite3.Connection:
    """Create or retrieve a SQLite database connection with row-mapping."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db() -> None:
    """Initialize database tables and run automatic migrations."""
    with get_connection() as conn:
        cursor = conn.cursor()

        # 1. Shifts
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS shifts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                description TEXT DEFAULT ''
            )
        """)

        # 2. Teachers
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS teachers (
                account TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                vtc TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                teens_qualified INTEGER NOT NULL DEFAULT 0,
                speak_plus_qualified INTEGER NOT NULL DEFAULT 0,
                shift_id TEXT REFERENCES shifts(id),
                fixed_day_off TEXT DEFAULT 'Sunday',
                weekend_group TEXT DEFAULT 'A',
                notes TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        # 3. Schedule Adjustments
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS adjustments (
                id TEXT PRIMARY KEY,
                teacher_account TEXT NOT NULL REFERENCES teachers(account) ON DELETE CASCADE,
                type TEXT NOT NULL,
                time_value TEXT DEFAULT '',
                day_of_week TEXT DEFAULT 'all',
                start_date TEXT NOT NULL,
                end_date TEXT DEFAULT '',
                reason TEXT DEFAULT '',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            )
        """)

        # 4. Saved Schedules
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS schedules (
                id TEXT PRIMARY KEY,
                week_start_date TEXT NOT NULL,
                name TEXT NOT NULL,
                total_classes INTEGER DEFAULT 0,
                adult_count INTEGER DEFAULT 0,
                teens_count INTEGER DEFAULT 0,
                speak_plus_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )
        """)

        # 5. Schedule Items (Classes)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS schedule_items (
                id TEXT PRIMARY KEY,
                schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
                account TEXT NOT NULL,
                name TEXT NOT NULL,
                time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                vtc TEXT NOT NULL,
                class_type TEXT NOT NULL,
                hidden TEXT NOT NULL DEFAULT 'No',
                action TEXT DEFAULT 'kept'
            )
        """)

        # Insert default shifts if not present
        cursor.execute("SELECT COUNT(*) FROM shifts")
        if cursor.fetchone()[0] == 0:
            cursor.executemany("""
                INSERT INTO shifts (id, name, start_time, end_time, description)
                VALUES (?, ?, ?, ?, ?)
            """, [
                ("day", "Day Shift", "07:00", "19:00", "Standard daytime window (up to 12h)"),
                ("evening", "Evening Shift", "13:00", "01:00", "Afternoon/evening window (up to 12h)"),
                ("latam", "Latam (Graveyard)", "21:00", "09:00", "Overnight graveyard window (up to 12h)"),
            ])

        conn.commit()

    # Seed teacher master list from sandbox file if database is new
    seed_teachers_from_sandbox_if_empty()


def seed_teachers_from_sandbox_if_empty() -> None:
    """Auto-seed initial teachers from TRGTC Sandbox Schedule.xlsx if present."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM teachers")
        if cursor.fetchone()[0] > 0:
            return  # Already seeded

    sandbox_path = Path(__file__).resolve().parent.parent.parent / "Scheduling" / "TRGTC Sandbox Schedule.xlsx"
    if not sandbox_path.is_file():
        return

    try:
        import openpyxl
        wb = openpyxl.load_workbook(sandbox_path, data_only=True)
        ws = wb.worksheets[-1]
        rows = list(ws.iter_rows(min_row=2, values_only=True))
        rows = [r for r in rows if r and r[0]]

        # Aggregate teacher stats
        teacher_map: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            account = str(r[0]).strip()
            name = str(r[1]).strip()
            vtc = str(r[4]).strip() if r[4] else ""
            ctype = str(r[5]).strip()
            hidden = str(r[6]).strip() if len(r) > 6 and r[6] else "No"

            if account not in teacher_map:
                status = "active"
                if "to be assigned" in name.lower() or name.lower() == "cengey g":
                    status = "placeholder"
                elif hidden.lower() == "yes":
                    status = "resigned"

                teacher_map[account] = {
                    "account": account,
                    "name": name,
                    "vtc": vtc,
                    "status": status,
                    "teens": False,
                    "speak_plus": False,
                    "shifts": set(),
                }

            if ctype == "Teens":
                teacher_map[account]["teens"] = True
            elif ctype == "Speak+":
                teacher_map[account]["speak_plus"] = True

        now_str = datetime.now().isoformat()
        days_of_week = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

        records = []
        for i, t in enumerate(teacher_map.values()):
            # Assign balanced shifts & off days for initial master data
            shift_id = "day" if (i % 3 == 0) else ("evening" if (i % 3 == 1) else "latam")
            day_off = days_of_week[i % 5]  # Weekday off (Mon-Fri)
            weekend_group = "A" if (i % 2 == 0) else "B"

            records.append((
                t["account"],
                t["name"],
                t["vtc"],
                t["status"],
                1 if t["teens"] else 0,
                1 if t["speak_plus"] else 0,
                shift_id,
                day_off,
                weekend_group,
                "Imported from sandbox schedule",
                now_str,
                now_str,
            ))

        with get_connection() as conn:
            conn.executemany("""
                INSERT OR IGNORE INTO teachers
                (account, name, vtc, status, teens_qualified, speak_plus_qualified, shift_id, fixed_day_off, weekend_group, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, records)
            conn.commit()

        print(f"[Database] Seeded {len(records)} teachers from Sandbox Schedule.")
    except Exception as e:
        print(f"[Database] Notice: Sandbox seeding skipped ({e})")
