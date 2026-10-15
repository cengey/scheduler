"""Lightweight SQLite database manager for Scheduler Desktop.

Stores teachers, shift configurations, shift rotation groups, adjustments, and generated rosters.
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

        # 1. Shifts (Working windows)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS shifts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                description TEXT DEFAULT ''
            )
        """)

        # 2. Shift Rotation Groups (from Shift Rotation List)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS shift_rotations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                shift_id TEXT REFERENCES shifts(id),
                fixed_day_off TEXT NOT NULL,
                week1_weekend_off INTEGER NOT NULL DEFAULT 1,
                week2_weekend_off INTEGER NOT NULL DEFAULT 0,
                description TEXT DEFAULT ''
            )
        """)

        # 3. Teachers
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS teachers (
                account TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                vtc TEXT NOT NULL DEFAULT '',
                email TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                teens_qualified INTEGER NOT NULL DEFAULT 0,
                speak_plus_qualified INTEGER NOT NULL DEFAULT 0,
                shift_id TEXT REFERENCES shifts(id),
                rotation_id TEXT REFERENCES shift_rotations(id),
                fixed_day_off TEXT DEFAULT 'Thursday',
                weekend_group TEXT DEFAULT 'A',
                notes TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        # Safe schema migrations for existing databases
        columns = [col[1] for col in cursor.execute("PRAGMA table_info(teachers)").fetchall()]
        if "email" not in columns:
            cursor.execute("ALTER TABLE teachers ADD COLUMN email TEXT NOT NULL DEFAULT ''")
        if "rotation_id" not in columns:
            cursor.execute("ALTER TABLE teachers ADD COLUMN rotation_id TEXT REFERENCES shift_rotations(id)")

        # 4. Schedule Adjustments
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

        # 5. Saved Schedules
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

        # 6. Schedule Items (Classes)
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
                action TEXT DEFAULT 'kept',
                comment TEXT DEFAULT ''
            )
        """)

        # Schema migrations for schedule_items
        item_cols = [col[1] for col in cursor.execute("PRAGMA table_info(schedule_items)").fetchall()]
        if "comment" not in item_cols:
            cursor.execute("ALTER TABLE schedule_items ADD COLUMN comment TEXT DEFAULT ''")

        # Standard Shifts: 3 Rotating + 3 Non-rotating
        standard_shifts = [
            ("day", "Day Shift", "07:00", "19:00", "Standard daytime window (07:00 – 19:00 CET)"),
            ("evening", "Evening Shift", "13:00", "01:00", "Afternoon/evening window (13:00 – 01:00 CET)"),
            ("latam", "Latam Shift", "21:00", "09:00", "Latam overnight window (21:00 – 09:00 CET)"),
            ("weekend_day", "Weekend Only Day shift", "07:00", "19:00", "Weekend daytime window (Saturday & Sunday)"),
            ("weekend_latam", "Weekend Only Latam Shift", "21:00", "09:00", "Weekend Latam overnight window (Saturday & Sunday)"),
            ("standby", "Standby shift", "00:00", "23:59", "Standby / On-call coverage"),
        ]
        for s_id, s_name, s_start, s_end, s_desc in standard_shifts:
            cursor.execute("""
                INSERT INTO shifts (id, name, start_time, end_time, description)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = CASE WHEN shifts.name LIKE '%Graveyard%' THEN excluded.name ELSE shifts.name END
            """, (s_id, s_name, s_start, s_end, s_desc))

        # Standard 4 Rotations per Rotating Shift Group (Day, Evening, Latam)
        rotating_shifts = [
            ("day", "Day"),
            ("evening", "Evening"),
            ("latam", "Latam"),
        ]
        rot_days = ["Thursday", "Friday", "Tuesday", "Wednesday"]
        for s_id, s_prefix in rotating_shifts:
            for rot_num in range(1, 5):
                rot_code = f"rot-{rot_num}" if s_id == "day" else f"rot-{s_id}-{rot_num}"
                rot_name = f"Rotation {rot_num}" if s_id == "day" else f"{s_prefix} Rotation {rot_num}"
                fixed_day = rot_days[rot_num - 1]
                cursor.execute("""
                    INSERT OR IGNORE INTO shift_rotations (id, name, shift_id, fixed_day_off, week1_weekend_off, week2_weekend_off, description)
                    VALUES (?, ?, ?, ?, 1, 0, ?)
                """, (
                    rot_code,
                    rot_name,
                    s_id,
                    fixed_day,
                    f"{fixed_day} OFF | Wk 1 Weekend OFF, Wk 2 Weekend Shifted",
                ))

        # Update any obsolete status names to standard 'archived'
        cursor.execute("UPDATE teachers SET status = 'archived' WHERE status IN ('resigned', 'inactive', 'leaver')")

        # Sync with Hub Teacher List.xlsx if present
        scheduling_dir = Path(__file__).resolve().parent.parent.parent / "Scheduling"
        hub_path = scheduling_dir / "Hub Teacher List.xlsx"
        if hub_path.is_file():
            try:
                import openpyxl
                wb_hub = openpyxl.load_workbook(hub_path, data_only=True)
                ws_hub = wb_hub['Teachers'] if 'Teachers' in wb_hub.sheetnames else wb_hub.worksheets[0]
                archived_users = []
                for r in ws_hub.iter_rows(min_row=2, values_only=True):
                    if not r or len(r) < 4:
                        continue
                    st = str(r[2] or "").strip().lower()
                    u = str(r[3] or "").strip()
                    if u and st in ("archived", "inactive", "resigned", "leaver"):
                        archived_users.append(u)
                if archived_users:
                    cursor.executemany("UPDATE teachers SET status = 'archived' WHERE account = ?", [(u,) for u in archived_users])
            except Exception:
                pass

        conn.commit()

    # Seed teacher master list from sandbox file if database is new
    seed_teachers_from_sandbox_if_empty()


def seed_teachers_from_sandbox_if_empty() -> None:
    """Auto-seed initial teachers from TRGTC Sandbox Schedule.xlsx and Hub Teacher List.xlsx."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM teachers")
        if cursor.fetchone()[0] > 0:
            return  # Already seeded

    scheduling_dir = Path(__file__).resolve().parent.parent.parent / "Scheduling"
    sandbox_path = scheduling_dir / "TRGTC Sandbox Schedule.xlsx"
    hub_path = scheduling_dir / "Hub Teacher List.xlsx"

    if not sandbox_path.is_file():
        return

    try:
        import openpyxl

        # 1. Parse qualifications and accounts from Sandbox schedule
        wb_sb = openpyxl.load_workbook(sandbox_path, data_only=True)
        ws_sb = wb_sb.worksheets[-1]
        sb_rows = list(ws_sb.iter_rows(min_row=2, values_only=True))

        teacher_map: Dict[str, Dict[str, Any]] = {}
        for r in sb_rows:
            if not r or not r[0]:
                continue
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
                    "email": "",
                    "status": status,
                    "teens": False,
                    "speak_plus": False,
                }

            if ctype == "Teens":
                teacher_map[account]["teens"] = True
            elif ctype == "Speak+":
                teacher_map[account]["speak_plus"] = True

        # 2. Enrich with emails and check if more teachers exist in Hub Teacher List
        if hub_path.is_file():
            wb_hub = openpyxl.load_workbook(hub_path, data_only=True)
            ws_hub = wb_hub['Teachers'] if 'Teachers' in wb_hub.sheetnames else wb_hub.worksheets[0]
            for r in ws_hub.iter_rows(min_row=2, values_only=True):
                if not r or len(r) < 4:
                    continue
                name = str(r[0] or "").strip()
                vtc = str(r[1] or "").strip()
                hub_status = str(r[2] or "Active").strip()
                username = str(r[3] or "").strip()
                email = str(r[5] or "").strip() if len(r) > 5 else ""

                if not username:
                    continue

                if username in teacher_map:
                    teacher_map[username]["email"] = email
                    if not teacher_map[username]["vtc"]:
                        teacher_map[username]["vtc"] = vtc
                    if hub_status.lower() in ("archived", "inactive", "resigned", "leaver"):
                        teacher_map[username]["status"] = "archived"
                else:
                    status = "archived" if hub_status.lower() in ("archived", "inactive", "resigned", "leaver") else "active"
                    teacher_map[username] = {
                        "account": username,
                        "name": name,
                        "vtc": vtc,
                        "email": email,
                        "status": status,
                        "teens": False,
                        "speak_plus": False,
                    }

        now_str = datetime.now().isoformat()
        rotations = ["rot-1", "rot-2", "rot-3", "rot-4"]
        rot_days = ["Thursday", "Friday", "Tuesday", "Wednesday"]

        records = []
        for i, t in enumerate(teacher_map.values()):
            rot_idx = i % 4
            rot_id = rotations[rot_idx]
            fixed_off = rot_days[rot_idx]
            shift_id = "day" if (i % 3 == 0) else ("evening" if (i % 3 == 1) else "latam")
            weekend_group = "A" if (i % 2 == 0) else "B"

            records.append((
                t["account"],
                t["name"],
                t["vtc"],
                t.get("email", ""),
                t["status"],
                1 if t["teens"] else 0,
                1 if t["speak_plus"] else 0,
                shift_id,
                rot_id,
                fixed_off,
                weekend_group,
                "Seeded from Sandbox & Hub Teacher List",
                now_str,
                now_str,
            ))

        with get_connection() as conn:
            conn.executemany("""
                INSERT OR REPLACE INTO teachers
                (account, name, vtc, email, status, teens_qualified, speak_plus_qualified, shift_id, rotation_id, fixed_day_off, weekend_group, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, records)
            conn.commit()

        print(f"[Database] Seeded {len(records)} teachers with skills and rotation groups.")
    except Exception as e:
        print(f"[Database] Notice: Teacher seeding skipped ({e})")
