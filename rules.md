# Project Rules & Operating Standards — Scheduler Desktop

> **Document Version**: 1.0.0  
> **Target Application**: Scheduler Desktop (`cengey/scheduler`)  
> **Location**: `/home/cengey/projects/scheduler/rules.md`  
> **Mandatory Policy**: All future development, refactoring, feature additions, and pull requests must strictly comply with the rules set forth in this document.

---

## 1. Privacy, Confidentiality & Data Security

1.1. **Zero Exposure of Client Data**:
- Client spreadsheets, teacher lists, schedule templates, `.xlsx`, `.xls`, `.csv`, database files (`.db`, `.sqlite`, `.sqlite3`), and directories `Scheduling/` and `data/` are strictly confidential.
- **NEVER** push, commit, or publicly expose actual client data, teacher names, usernames, passwords, contact details, or schedule matrices to GitHub or any public forum.

1.2. **Strict Git Ignore Enforcement**:
- `.gitignore` must continuously exclude:
  - `Scheduling/`
  - `data/`
  - `*.xlsx`, `*.xls`, `*.csv`
  - `*.db`, `*.sqlite`, `*.sqlite3`
  - `*:Zone.Identifier`
  - Temporary files, logs, and virtual environments (`.venv/`).

---

## 2. UI, UX & Visual Styling Rules

2.1. **Strict Zero Horizontal Scrollbars**:
- **Rule**: Horizontal scrollbars are strictly prohibited on all screens and views.
- **Enforcement**: Containers must implement responsive flex/grid wrapping and enforce `overflow-x: hidden`. Tables must be wrapped in responsive containers (`.table-responsive`) that never push the viewport wider than 100vw.

2.2. **Visual Uniformity & Design Consistency**:
- **Rule**: Styling, buttons, cards, typography, and controls must maintain 100% uniformity across all views.
- **Enforcement**:
  - Always reuse core design tokens (`.btn`, `.btn-primary`, `.btn-secondary`, `.btn-sm`, `.btn-danger-ghost`, `.stat-card`, `.form-input`, `.form-select`, etc.).
  - Never introduce mismatched or one-off button variants, arbitrary padding/margins, or ad-hoc color palettes that disrupt visual cohesion.

2.3. **Clean Header & No Extraneous Badges**:
- The top window app bar must remain minimalist, displaying only the application icon and title (`Scheduler Desktop`).
- Do **NOT** add status badges (e.g. "Backend: Connected"), theme toggle switches, or developer API documentation links to the landing page header.

---

## 3. Architecture & Code Quality Rules

3.1. **Clean Code & Zero Bloatware**:
- Keep the codebase lightweight, elegant, and maintainable.
- Avoid unnecessary external frameworks, heavy runtime dependencies, or frontend build toolchains (e.g., no Node.js/npm dependencies, no webpack/vite bundles).
- Rely on standard library primitives and lightweight modern packages: `FastAPI`, `Uvicorn`, `openpyxl`, `sqlite3`.

3.2. **Desktop Native Window Paradigm**:
- The application runs locally as a desktop client via Chromium native application mode (`--app=http://127.0.0.1:PORT`).
- The backend must start smoothly via `uv run scheduler`, `python run.py`, `run.sh`, or `run.bat` across Linux, macOS, and Windows.

---

## 4. Scheduling Engine & Algorithm Rules

4.1. **Minimal Disruption Delta Scheduling**:
- The engine must take existing benchmark classes and match them against target distribution counts with the **minimum number of changes possible**.
- Classes already scheduled on an eligible teacher must be **kept intact** (`action: kept`) rather than shuffled unnecessarily.

4.2. **Column H Directive Comments (Client's Hub Directives)**:
- Every exported schedule row must include **Column H** titled `Comment`.
- Column H must clearly tell the user what to execute in the Client's Hub:
  - **`MOVED`**: `MOVED: Reassigned in Client's Hub from [Old Teacher] ([Old Account]) to [New Teacher] ([New Account]) — Reason: [Specific Reason]`
  - **`CREATED`**: `CREATED: Add new class in Client's Hub for [Teacher] ([Account]) — Reason: Demand deficit for [Class Type] at [Time]`
  - **`DELETED`**: `DELETED: Delete / cancel in Client's Hub for [Teacher] ([Account]) — Reason: Surplus class above distribution demand`
  - **`KEPT`**: `KEPT: Original schedule retained in Client's Hub for [Teacher] ([Account])`
- The user must be able to read Column H and know with 100% certainty what adjustments to make manually in the Client's Hub.

4.3. **Exclusion of Archived / Leaver Teachers**:
- Teachers marked as `Archived` (leavers) in the Hub Teacher List must **never** be scheduled to unless the user explicitly checks *"Include Archived Teachers"*.
- When *"Include Archived Teachers"* is unchecked (default):
  - Existing classes assigned to archived teachers in the uploaded schedule must be unassigned, flagged as `MOVED`, and reallocated to active qualified teachers with the reason: `Teacher is marked Archived / Leaver in Hub Teacher List`.
- Teachers marked `Hidden: Yes` in the schedule must be treated similarly.

4.4. **Daily Teaching Hours Cap**:
- **Default Cap**: 6.0 hours per teacher per day.
- **Override**: The user may enable the 7.0-hour cap override via the UI checkbox. No teacher may exceed the effective daily cap under any circumstance.

4.5. **Continuous Teaching Limits (Back-to-Back Cap)**:
- **Default Cap**: Maximum 3.0 continuous hours without a break of at least 30 minutes.
- **Override**: The user may enable the 4.0-hour continuous override via the UI checkbox.
- A break of 30 minutes or more resets the continuous teaching accumulator.

4.6. **Review & Sorting Toolbar Placement**:
- A dedicated review sorting and filtering toolbar must be positioned **directly below the KPI cards** in the Weekly Schedule Generator tab.
- It must support sorting and filtering by:
  - Date & Time (Ascending / Descending)
  - Action (Classes to be Moved first, Classes to be Created first, Classes to be Deleted first, Kept)
  - Teacher Name (A–Z)
  - Search query and Class Type filter.

---

## 5. Shifts, Rotations & Off-Day Rules

5.1. **Shift Naming & Working Windows**:
- **Rotating Shifts** (each possessing 4 structured rotations):
  1. `Day Shift`: `07:00 – 19:00` CET
  2. `Evening Shift`: `13:00 – 01:00` CET
  3. `Latam Shift`: `21:00 – 09:00` CET
  - **Prohibition**: *The term "Graveyard" was strictly context-only and must NEVER appear in the UI, code, database, or documentation. Always use `Latam Shift`.*
- **Non-Rotating Shifts** (fixed windows, no alternate weekend rotations):
  4. `Weekend Only Day shift`: `07:00 – 19:00` CET (Saturday & Sunday)
  5. `Weekend Only Latam Shift`: `21:00 – 09:00` CET (Saturday & Sunday)
  6. `Standby shift`: `00:00 – 23:59` CET (On-call coverage)

5.2. **Clickable Rotating Shift KPI Cards**:
- The 3 Rotating Shift KPI cards (`Day Shift`, `Evening Shift`, `Latam Shift`) in the Shifts view must be clickable.
- Clicking a card filters the view to show only that shift's 4 rotation patterns.
- A "View All Shifts" button must be available to display all rotation groups simultaneously.

5.3. **Shift & Rotation Time Adjustments**:
- The application must support editing shift times (`start_time`, `end_time`, name, description) and rotation configurations (fixed day off, weekend rotation cycle) via modals to maintain operational agility.

5.4. **Fixed Off Days & Alternate Weekend Rotation**:
- **Fixed Off Day**: Fixed off days (Rotation 1 = Thursday, Rotation 2 = Friday, Rotation 3 = Tuesday, Rotation 4 = Wednesday) are fixed. Whether a teacher worked, took leave, or was off sick does **NOT** alter their fixed off day.
- **2-Week Weekend Rotation**:
  - Week 1: Saturday & Sunday are marked **OFF** (4 working days total).
  - Week 2: Saturday & Sunday are **Shifted / Working** (6 working days total).
  - Alternating cycle repeats continuously every 2 weeks. Maximum 6 consecutive working days is strictly maintained.
- **Weekend Groups**: Group A (even ISO week off) vs Group B (odd ISO week off).

---

## 6. Teachers, Skills & Placeholders Rules

6.1. **Display Active Teachers First**:
- All teacher queries, dropdowns, and views must display **active teachers first**, followed by placeholders, and archived leavers last.
- Sorting standard: `ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'placeholder' THEN 2 ELSE 3 END, name ASC`.

6.2. **Placeholder Accounts Policy**:
- Placeholder accounts (e.g. `To Be Assigned`, `Cengey G`, `tba.*`) represent recruitment or onboarding accounts.
- **Exclusion from Skills Filters**: Placeholders must **NOT** be included when filtering the `Teens List` or `Speak+ List` in the Teachers & Skills tab. They must reside under the `Placeholders` tab only.
- **Universal Class Eligibility**: Although excluded from skill tab listings, placeholders can be scheduled to any class type (`Adult`, `Teens`, `Speak+`) by the scheduling engine when teacher capacity is exhausted.

6.3. **Teacher Profile Editing**:
- Users must always have the ability to view and edit a teacher's:
  - Full Name, VTC code, Email
  - Shift Group
  - Rotation Group
  - Fixed Weekly Off Day
  - Weekend Group (`Group A` / `Group B`)
  - Account Status (`Active`, `Archived`, `Placeholder`)
  - Skill Qualifications (`Teens Qualified`, `Speak+ Qualified`)

---

## 7. Teacher Schedule Adjustments Rules

7.1. **Adjustment Capture & Enforcement**:
- The application must provide a functional "Add Adjustment" modal and management table for capturing teacher scheduling constraints:
  - **Blocked Slot**: Cannot take a specific slot or time window (e.g. `14:00` childcare).
  - **No Before**: Earliest allowed start time (e.g. `10:00`).
  - **No After**: Latest allowed finish time (e.g. `16:00`).
  - **Unavailable Day**: Specific day off (e.g. unavailable on Mondays).
  - **Full Leave**: Unavailable for an entire date range.
- Must capture effective date range (`start_date` to `end_date`, or ongoing) and days of the week (`All Days`, or specific weekdays).
- The delta scheduling engine must enforce active adjustments during roster generation.

---

## 8. Export & Integration Rules

8.1. **Exact Sandbox Format Compliance**:
- The exported Excel roster must strictly mirror the column structure and formatting of the client's benchmark schedule (`TRGTC Sandbox Schedule.xlsx`):
  - Column A: `Account`
  - Column B: `Name`
  - Column C: `Time` (`YYYY-MM-DD HH:MM:SS`)
  - Column D: `End Time` (`YYYY-MM-DD HH:MM:SS`)
  - Column E: `VTC`
  - Column F: `Class Type` (`Adult`, `Teens`, `Speak+`)
  - Column G: `Hidden` (`Yes` / `No`)
  - Column H: `Comment` (Hub action directive and reason)
- Column widths must be auto-fitted generously so directives in Column H are fully legible without manual column resizing.

---

## 9. Development & Verification Checklist

Before committing or releasing any modification:
1. Verify `git status` shows no client spreadsheets, `.db` files, or `.xlsx` files staged.
2. Verify HTML and CSS contain zero horizontal overflow.
3. Verify all buttons follow the `.btn` styling tokens.
4. Verify tests pass:
   ```bash
   uv run python -c "
   from scheduler.db import init_db, get_connection
   init_db()
   with get_connection() as conn:
       print('Teachers:', conn.execute('SELECT COUNT(*) FROM teachers').fetchone()[0])
       print('Shifts:', conn.execute('SELECT COUNT(*) FROM shifts').fetchone()[0])
   "
   ```
5. Ensure commit messages clearly state the rationale and changes made.

---
*End of Rules Document. Adherence is mandatory for all contributors.*
