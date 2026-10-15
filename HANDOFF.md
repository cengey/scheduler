# Scheduler Desktop — Project Handoff Documentation

> **Document Version**: 1.0.0  
> **Date**: October 16, 2026  
> **Repository**: `cengey/scheduler` (Branch: `main`)  
> **Location**: `/home/cengey/projects/scheduler/HANDOFF.md`  

---

## 1. Executive Summary

**Scheduler Desktop** is a standalone local desktop application built with Python (`FastAPI`, `uvicorn`, `openpyxl`, `sqlite3`) and a responsive client UI running in an isolated Chromium app window. 

The application solves a specific scheduling operational need:
1. Takes 3 target distribution files (**Adults**, **Teens**, and **Speak+**) and an existing benchmark schedule (**TRGTC Sandbox Schedule** format).
2. Runs an automated **Delta Scheduling Engine** that applies distribution demands against the existing roster with **minimal disruption**.
3. Enforces business constraints: shift working windows, fixed weekly off days, 2-week alternate weekend rotations, daily hour caps (6h or 7h override), continuous back-to-back teaching caps (3h or 4h override), individual teacher schedule adjustments (childcare blocks, earliest start, latest finish), and archived/leaver exclusions.
4. Exports a finalized Excel roster in the **exact Sandbox Schedule structure** with an added **Column H (`Comment`)** that details the directive for the Client's Hub (what classes to keep, move, delete, or create, including exact origin teachers and constraint reasons).

---

## 2. Architecture & File Structure

```
scheduler/
├── .gitignore                     # Protects client data, *.xlsx, *.db, Scheduling/
├── pyproject.toml                 # uv project definition (Python >=3.14, FastAPI, openpyxl, uvicorn)
├── README.md                      # Quickstart guide
├── HANDOFF.md                     # Comprehensive project handoff (this file)
├── run.py / run.sh / run.bat      # Universal multi-platform launch scripts
├── data/
│   └── scheduler.db               # Local SQLite database (git-ignored)
├── Scheduling/                    # Client source spreadsheets (git-ignored)
│   ├── Adults Distribution.xlsx
│   ├── Teens Distribution.xlsx
│   ├── Speak + Distribution.xlsx
│   ├── TRGTC Sandbox Schedule.xlsx
│   ├── Hub Teacher List.xlsx
│   └── Shift Rotation.png
└── src/
    └── scheduler/
        ├── __init__.py            # Exports main()
        ├── main.py                # CLI argument parsing and server/browser launcher
        ├── server.py              # FastAPI app instance, CORS middleware, static mount
        ├── launcher.py            # Headless/Chromium native window launcher (--app mode)
        ├── db.py                  # SQLite database schema, migrations, and seed logic
        ├── engine.py              # Core delta scheduling engine & Hub directive comments
        ├── excel_io.py            # openpyxl readers & Sandbox-compliant Excel exporters
        ├── api/
        │   └── routes.py          # REST API endpoints (/api/*)
        └── static/
            ├── index.html         # 4-view single page interface
            ├── css/
            │   └── style.css      # Desktop styling, zero horizontal scrollbars, uniform UI
            └── js/
                └── app.js         # Frontend application logic, modals, API integration
```

---

## 3. Core Principles & User Constraints

1. **Privacy & Security**:
   - Teacher spreadsheets, `.xlsx`, `.csv`, `data/scheduler.db`, and `Scheduling/` are strictly excluded in `.gitignore` and **NEVER** committed to GitHub.
2. **Zero Horizontal Scrollbars**:
   - The UI enforces strict responsive wrapping and `overflow-x: hidden` across all containers.
3. **Visual Uniformity**:
   - All buttons, badges, tables, inputs, and modal dialogues use consistent design tokens (`.btn`, `.btn-primary`, `.btn-secondary`, `.btn-sm`, `.stat-card`, `.badge-action`, etc.).
4. **Clean Code & Zero Bloatware**:
   - Standard Python libraries and minimal dependencies (`openpyxl`, `fastapi`, `uvicorn`, `python-multipart`). No Node/npm, webpack, or frontend framework bloat.
5. **No Extraneous Header Elements**:
   - The top application header displays only the logo and title. Unnecessary status badges and developer toggles have been removed.

---

## 4. Key Functional Areas

### 4.1. Weekly Schedule Generator & Export
- **File Uploads**:
  - Week start date picker (restricted to Mondays).
  - 3 Distribution files with auto-detecting class type dropdowns (`Adult`, `Teens`, `Speak+`).
  - Benchmark schedule file upload (`.xlsx`).
  - Rules & Overrides:
    - 7h Daily Cap Override checkbox (default: 6h).
    - 4h Continuous Teaching Override checkbox (default: 3h continuous limit without >=30m break).
    - **Include Archived Teachers checkbox**: (default: unchecked). When unchecked, classes on archived teachers in the uploaded schedule are automatically unassigned and reallocated to active qualified teachers.
- **KPI Cards**:
  - Displays 4 metrics: Total Classes, Classes to be Moved (`resMovedCount`), Classes to be Created (`resCreatedCount`), Classes to be Deleted (`resDeletedCount`).
- **Review Toolbar (Directly Under KPI Cards)**:
  - **Action Filter Pills**: Filter table by `All Classes`, `🔄 Moved`, `➕ Created`, `❌ Deleted`, or `Kept Intact` with live counts.
  - **Sort by Selector**: Sort by Date & Time (Ascending/Descending), Moved First, Created First, Deleted First, or Teacher Name (A–Z).
  - **Search & Filter**: Search by teacher name, login account, or directive reason.
  - **Export Button**: Download proposed schedule `.xlsx`.
- **Excel Export Structure with Column H**:
  - Headers: `Account`, `Name`, `Time`, `End Time`, `VTC`, `Class Type`, `Hidden`, `Comment`.
  - Column H provides exact Client's Hub directives:
    - `MOVED: Reassigned in Client's Hub from [Old Teacher] ([Old Account]) to [New Teacher] ([New Account]) — Reason: [Specific Reason]`
    - `CREATED: Add new class in Client's Hub for [New Teacher] ([New Account]) — Reason: Demand deficit for [Type] at [Time]`
    - `DELETED: Delete / cancel in Client's Hub for [Teacher] ([Account]) — Reason: Surplus class above distribution demand`
    - `KEPT: Original schedule retained in Client's Hub for [Teacher] ([Account])`

---

### 4.2. Teachers & Skills
- **Active Teachers First**:
  - Default view and SQL sorting prioritize active teachers first, followed by placeholders, then archived leavers:
    `ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'placeholder' THEN 2 ELSE 3 END, name ASC`.
- **View Sub-tabs**:
  - `Active Teachers` (default)
  - `All Teachers`
  - `Teens List` (placeholders excluded)
  - `Speak+ List` (placeholders excluded)
  - `Placeholders` (TBA accounts)
  - `Archived / Leavers`
- **Teacher Editing**:
  - Every teacher row features an **Edit** button opening an Edit Modal allowing updates to:
    - Shift Group (`Day Shift`, `Evening Shift`, `Latam Shift`, `Weekend Only Day shift`, `Weekend Only Latam Shift`, `Standby shift`)
    - Rotation Group (`Rotation 1`, `Rotation 2`, `Rotation 3`, `Rotation 4`, `None / Fixed`)
    - Fixed Day Off (`Thursday`, `Friday`, `Tuesday`, `Wednesday`, `Monday`, `Saturday`, `Sunday`, `None`)
    - Weekend Group (`Group A` or `Group B`)
    - Account Status (`Active`, `Archived`, `Placeholder`)
    - Qualifications (`Teens Qualified`, `Speak+ Qualified`)
- **Bulk Upload & Export**:
  - `Upload Hub Teacher List` (`.xlsx`) to bulk-sync master teachers.
  - `Export Roster` (`.xlsx`) to download full master teacher list.

---

### 4.3. Shifts & Rotation Groups
- **Shift Definitions**:
  - **Rotating Shifts** (each with 4 standard rotations):
    1. `Day Shift` (`07:00` – `19:00` CET)
    2. `Evening Shift` (`13:00` – `01:00` CET)
    3. `Latam Shift` (`21:00` – `09:00` CET) — *Note: "Graveyard" term permanently removed.*
  - **Non-Rotating Shifts**:
    4. `Weekend Only Day shift` (`07:00` – `19:00` CET, Saturday & Sunday)
    5. `Weekend Only Latam Shift` (`21:00` – `09:00` CET, Saturday & Sunday)
    6. `Standby shift` (`00:00` – `23:59` CET, On-call coverage)
- **Clickable Shift KPI Cards**:
  - Clicking any of the 3 rotating shift KPI cards filters the view to display that shift's 4 rotations.
  - "View All Shifts" button resets the filter to show all rotations.
- **Rotation Pattern Visualization**:
  - 2-week visual table cards displaying Week 1 vs Week 2 with `OFF` (blue) and `Shifted` (white) cells.
  - Rotation 1 (Thursday OFF), Rotation 2 (Friday OFF), Rotation 3 (Tuesday OFF), Rotation 4 (Wednesday OFF).
- **Edit Modals**:
  - **Edit Shift Modal**: Allows editing shift name, start time (CET), end time (CET), and description.
  - **Edit Rotation Modal**: Allows editing rotation name, shift assignment, fixed day off, weekend rotation pattern, and description.

---

### 4.4. Teacher Schedule Adjustments
- **Working Add Adjustment Flow**:
  - "Add Adjustment" button opens the modal reliably.
  - Pre-populates active teachers in dropdown: `Teacher Name (Account - Shift)`.
  - Supported Adjustment Types:
    - `block_slot`: Block specific slot or range (e.g. `14:00` childcare).
    - `no_before`: Earliest start time (e.g. `10:00`).
    - `no_after`: Latest finish time (e.g. `16:00`).
    - `unavailable_day`: Full day off on specific day of week.
    - `full_leave`: Full period leave.
  - Day of week picker (`All Days`, or specific days).
  - Effective duration: Start Date and optional End Date (or ongoing).
  - Reason / notes text field.
  - Active toggle and delete controls on table rows.

---

## 5. Database Schema Reference

Database: `data/scheduler.db` (SQLite with WAL mode and foreign keys enabled).

```sql
-- 1. Shifts
CREATE TABLE shifts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    description TEXT DEFAULT ''
);

-- 2. Shift Rotations
CREATE TABLE shift_rotations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    shift_id TEXT REFERENCES shifts(id),
    fixed_day_off TEXT NOT NULL,
    week1_weekend_off INTEGER NOT NULL DEFAULT 1,
    week2_weekend_off INTEGER NOT NULL DEFAULT 0,
    description TEXT DEFAULT ''
);

-- 3. Master Teachers
CREATE TABLE teachers (
    account TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    vtc TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'archived', 'placeholder'
    teens_qualified INTEGER NOT NULL DEFAULT 0,
    speak_plus_qualified INTEGER NOT NULL DEFAULT 0,
    shift_id TEXT REFERENCES shifts(id),
    rotation_id TEXT REFERENCES shift_rotations(id),
    fixed_day_off TEXT DEFAULT 'Thursday',
    weekend_group TEXT DEFAULT 'A',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 4. Adjustments
CREATE TABLE adjustments (
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
);

-- 5. Saved Schedules
CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    week_start_date TEXT NOT NULL,
    name TEXT NOT NULL,
    total_classes INTEGER DEFAULT 0,
    adult_count INTEGER DEFAULT 0,
    teens_count INTEGER DEFAULT 0,
    speak_plus_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

-- 6. Schedule Items (with Column H comment)
CREATE TABLE schedule_items (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    account TEXT NOT NULL,
    name TEXT NOT NULL,
    time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    vtc TEXT NOT NULL,
    class_type TEXT NOT NULL,
    hidden TEXT NOT NULL DEFAULT 'No',
    action TEXT DEFAULT 'kept', -- 'kept', 'moved', 'created', 'deleted'
    comment TEXT DEFAULT ''
);
```

---

## 6. API Reference Summary

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status and uptime |
| `GET` | `/api/teachers` | Filter teachers by `status`, `qualification`, `shift`, `search` (sorted active first) |
| `POST` | `/api/teachers` | Create a new master teacher |
| `PATCH` | `/api/teachers/{account}` | Update teacher details, status, shift, rotation, day off, qualifications |
| `DELETE` | `/api/teachers/{account}` | Delete a teacher from database |
| `POST` | `/api/teachers/upload` | Upload `Hub Teacher List.xlsx` to bulk-sync master roster |
| `GET` | `/api/teachers/export` | Download full master roster as `Teacher_Roster.xlsx` |
| `GET` | `/api/shifts` | List all 6 shifts (Day, Evening, Latam, Weekend Day, Weekend Latam, Standby) |
| `PUT` | `/api/shifts/{id}` | Update shift working window hours, name, description |
| `GET` | `/api/rotation-groups` | List all rotation groups with assigned teacher counts |
| `POST` | `/api/rotation-groups` | Create a new rotation group |
| `PUT` | `/api/rotation-groups/{id}` | Update rotation group pattern, fixed day off, weekend cycle |
| `DELETE` | `/api/rotation-groups/{id}` | Delete a rotation group |
| `GET` | `/api/adjustments` | List all schedule adjustments |
| `POST` | `/api/adjustments` | Create a schedule adjustment (childcare, no before/after, full day off) |
| `PATCH` | `/api/adjustments/{id}/toggle` | Toggle adjustment active/disabled state |
| `DELETE` | `/api/adjustments/{id}` | Remove an adjustment |
| `POST` | `/api/generate-schedule` | Multipart generation with distributions, schedule, overrides, `include_archived` |
| `GET` | `/api/schedule/{id}/classes` | Paginated review classes with `action`, `sort_by`, `search`, `class_type` |
| `GET` | `/api/schedule/{id}/export` | Export finalized roster to `.xlsx` matching Sandbox format with **Column H Comment** |

---

## 7. How to Run and Test

### 7.1. Running the Application
```bash
# Using uv (recommended)
uv run scheduler

# Or using the launch script
./run.sh

# Without launching the browser (headless server)
uv run scheduler --no-browser --port 8000
```

### 7.2. Running Automated Verification
```bash
uv run python -c "
from scheduler.db import init_db, get_connection
init_db()
with get_connection() as conn:
    print('Teachers count:', conn.execute('SELECT COUNT(*) FROM teachers').fetchone()[0])
    print('Shifts count:', conn.execute('SELECT COUNT(*) FROM shifts').fetchone()[0])
"
```

---

## 8. Current Status & Git State

- **Branch**: `main`
- **Remote**: `origin/main` (up to date)
- **Working Tree**: Clean (`git status` reports nothing untracked or modified)
- **Last Commit**: `a228617` ("Add Column H Hub directive comments, review sorting menu under KPI cards, active-first teachers with rotation/shift editing, clickable shift cards with Latam rename, and full adjustment modal")

---
*End of Handoff Document. Created locally in project root.*
