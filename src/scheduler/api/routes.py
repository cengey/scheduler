"""Comprehensive REST API routes for Scheduler Desktop."""

import io
import time
from datetime import datetime, date
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Response
from pydantic import BaseModel, Field

from scheduler.db import get_connection
from scheduler.excel_io import (
    parse_distribution_workbook,
    parse_schedule_file,
    parse_hub_teacher_list,
    export_schedule_to_excel,
    export_teachers_to_excel,
)
from scheduler.engine import generate_revised_schedule

router = APIRouter(prefix="/api", tags=["api"])
SERVER_START_TIME = time.time()


# ==============================================================================
# Health & System
# ==============================================================================
@router.get("/health")
def get_health():
    uptime_seconds = int(time.time() - SERVER_START_TIME)
    return {
        "status": "healthy",
        "app": "Scheduler Desktop",
        "version": "1.1.0",
        "uptime_seconds": uptime_seconds,
        "timestamp": datetime.now().isoformat(),
    }


# ==============================================================================
# Teachers & Qualifications
# ==============================================================================
class TeacherCreate(BaseModel):
    account: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    vtc: str = ""
    email: str = ""
    status: str = "active"
    teens_qualified: bool = False
    speak_plus_qualified: bool = False
    shift_id: str = "day"
    rotation_id: str = "rot-1"
    fixed_day_off: str = "Thursday"
    weekend_group: str = "A"
    notes: str = ""


class TeacherUpdate(BaseModel):
    name: Optional[str] = None
    vtc: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = None
    teens_qualified: Optional[bool] = None
    speak_plus_qualified: Optional[bool] = None
    shift_id: Optional[str] = None
    rotation_id: Optional[str] = None
    fixed_day_off: Optional[str] = None
    weekend_group: Optional[str] = None
    notes: Optional[str] = None


@router.get("/teachers")
def list_teachers(
    status: Optional[str] = None,
    qualification: Optional[str] = None,
    shift: Optional[str] = None,
    search: Optional[str] = None,
):
    with get_connection() as conn:
        query = "SELECT * FROM teachers WHERE 1=1"
        params: List[Any] = []

        if status:
            query += " AND status = ?"
            params.append(status)

        if qualification == "teens":
            query += " AND teens_qualified = 1"
        elif qualification == "speak_plus":
            query += " AND speak_plus_qualified = 1"

        if shift:
            query += " AND shift_id = ?"
            params.append(shift)

        if search:
            query += " AND (name LIKE ? OR account LIKE ? OR vtc LIKE ? OR email LIKE ?)"
            term = f"%{search.strip()}%"
            params.extend([term, term, term, term])

        query += " ORDER BY name ASC"
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]


@router.post("/teachers", status_code=201)
def create_teacher(data: TeacherCreate):
    now_str = datetime.now().isoformat()
    with get_connection() as conn:
        try:
            conn.execute("""
                INSERT INTO teachers
                (account, name, vtc, email, status, teens_qualified, speak_plus_qualified, shift_id, rotation_id, fixed_day_off, weekend_group, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                data.account.strip(),
                data.name.strip(),
                data.vtc.strip(),
                data.email.strip(),
                data.status,
                1 if data.teens_qualified else 0,
                1 if data.speak_plus_qualified else 0,
                data.shift_id,
                data.rotation_id,
                data.fixed_day_off,
                data.weekend_group,
                data.notes,
                now_str,
                now_str,
            ))
            conn.commit()
            return {"success": True, "account": data.account}
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to create teacher: {e}")


@router.patch("/teachers/{account}")
def update_teacher(account: str, data: TeacherUpdate):
    with get_connection() as conn:
        existing = conn.execute("SELECT * FROM teachers WHERE account = ?", (account,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Teacher not found")

        updates: List[str] = []
        params: List[Any] = []

        for field, val in data.model_dump(exclude_unset=True).items():
            if field in ("teens_qualified", "speak_plus_qualified"):
                updates.append(f"{field} = ?")
                params.append(1 if val else 0)
            else:
                updates.append(f"{field} = ?")
                params.append(val)

        if updates:
            updates.append("updated_at = ?")
            params.append(datetime.now().isoformat())
            params.append(account)
            conn.execute(f"UPDATE teachers SET {', '.join(updates)} WHERE account = ?", params)
            conn.commit()

        row = conn.execute("SELECT * FROM teachers WHERE account = ?", (account,)).fetchone()
        return dict(row)


@router.delete("/teachers/{account}")
def delete_teacher(account: str):
    with get_connection() as conn:
        conn.execute("DELETE FROM teachers WHERE account = ?", (account,))
        conn.commit()
        return {"success": True, "account": account}


@router.post("/teachers/upload")
async def upload_teacher_list(file: UploadFile = File(...)):
    """Upload Hub Teacher List.xlsx to add or update master teachers."""
    try:
        content = await file.read()
        parsed_teachers = parse_hub_teacher_list(content)
        if not parsed_teachers:
            raise HTTPException(status_code=400, detail="No valid teacher records found in file")

        now_str = datetime.now().isoformat()
        with get_connection() as conn:
            for t in parsed_teachers:
                # Upsert teacher
                conn.execute("""
                    INSERT INTO teachers (account, name, vtc, email, status, teens_qualified, speak_plus_qualified, shift_id, rotation_id, fixed_day_off, weekend_group, notes, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 0, 0, 'day', 'rot-1', 'Thursday', 'A', 'Imported from Hub List', ?, ?)
                    ON CONFLICT(account) DO UPDATE SET
                        name = excluded.name,
                        vtc = CASE WHEN excluded.vtc != '' THEN excluded.vtc ELSE teachers.vtc END,
                        email = CASE WHEN excluded.email != '' THEN excluded.email ELSE teachers.email END,
                        status = excluded.status,
                        updated_at = excluded.updated_at
                """, (
                    t["account"],
                    t["name"],
                    t.get("vtc", ""),
                    t.get("email", ""),
                    t.get("status", "active"),
                    now_str,
                    now_str,
                ))
            conn.commit()

        return {"success": True, "imported_count": len(parsed_teachers)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to import teachers: {str(e)}")


@router.get("/teachers/export")
def export_teachers_endpoint():
    """Download the full master teacher roster as an Excel file."""
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM teachers ORDER BY name ASC").fetchall()
        teachers = [dict(r) for r in rows]

    excel_bytes = export_teachers_to_excel(teachers)
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="Teacher_Roster.xlsx"'},
    )


# ==============================================================================
# Shifts & Rotation Groups
# ==============================================================================
@router.get("/shifts")
def list_shifts():
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM shifts ORDER BY id ASC").fetchall()
        return [dict(r) for r in rows]


class ShiftUpdate(BaseModel):
    name: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    description: Optional[str] = None


@router.put("/shifts/{shift_id}")
def update_shift(shift_id: str, data: ShiftUpdate):
    with get_connection() as conn:
        updates = []
        params = []
        for k, v in data.model_dump(exclude_unset=True).items():
            updates.append(f"{k} = ?")
            params.append(v)
        if updates:
            params.append(shift_id)
            conn.execute(f"UPDATE shifts SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()
        row = conn.execute("SELECT * FROM shifts WHERE id = ?", (shift_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Shift not found")
        return dict(row)


class RotationGroupCreate(BaseModel):
    id: Optional[str] = None
    name: str
    shift_id: str = "day"
    fixed_day_off: str = "Thursday"
    week1_weekend_off: bool = True
    week2_weekend_off: bool = False
    description: str = ""


@router.get("/rotation-groups")
def list_rotation_groups():
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT r.*, s.name as shift_name, s.start_time, s.end_time,
                   (SELECT COUNT(*) FROM teachers t WHERE t.rotation_id = r.id) as teacher_count
            FROM shift_rotations r
            LEFT JOIN shifts s ON r.shift_id = s.id
            ORDER BY r.id ASC
        """).fetchall()
        return [dict(r) for r in rows]


@router.post("/rotation-groups", status_code=201)
def create_rotation_group(data: RotationGroupCreate):
    rot_id = data.id or f"rot-{uuid4().hex[:6]}"
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO shift_rotations (id, name, shift_id, fixed_day_off, week1_weekend_off, week2_weekend_off, description)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            rot_id,
            data.name,
            data.shift_id,
            data.fixed_day_off,
            1 if data.week1_weekend_off else 0,
            1 if data.week2_weekend_off else 0,
            data.description,
        ))
        conn.commit()
        return {"id": rot_id, "success": True}


@router.put("/rotation-groups/{rot_id}")
def update_rotation_group(rot_id: str, data: RotationGroupCreate):
    with get_connection() as conn:
        conn.execute("""
            UPDATE shift_rotations
            SET name = ?, shift_id = ?, fixed_day_off = ?, week1_weekend_off = ?, week2_weekend_off = ?, description = ?
            WHERE id = ?
        """, (
            data.name,
            data.shift_id,
            data.fixed_day_off,
            1 if data.week1_weekend_off else 0,
            1 if data.week2_weekend_off else 0,
            data.description,
            rot_id,
        ))
        conn.commit()
        return {"id": rot_id, "success": True}


@router.delete("/rotation-groups/{rot_id}")
def delete_rotation_group(rot_id: str):
    with get_connection() as conn:
        conn.execute("DELETE FROM shift_rotations WHERE id = ?", (rot_id,))
        conn.commit()
        return {"id": rot_id, "success": True}


# ==============================================================================
# Schedule Adjustments
# ==============================================================================
class AdjustmentCreate(BaseModel):
    teacher_account: str
    type: str  # 'block_slot', 'no_before', 'no_after', 'unavailable_day', 'custom_cap'
    time_value: str = ""
    day_of_week: str = "all"
    start_date: str
    end_date: str = ""
    reason: str = ""


@router.get("/adjustments")
def list_adjustments():
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT a.*, t.name as teacher_name
            FROM adjustments a
            JOIN teachers t ON a.teacher_account = t.account
            ORDER BY a.created_at DESC
        """).fetchall()
        return [dict(r) for r in rows]


@router.post("/adjustments", status_code=201)
def create_adjustment(data: AdjustmentCreate):
    adj_id = f"adj-{uuid4().hex[:8]}"
    now_str = datetime.now().isoformat()
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO adjustments
            (id, teacher_account, type, time_value, day_of_week, start_date, end_date, reason, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        """, (
            adj_id,
            data.teacher_account,
            data.type,
            data.time_value,
            data.day_of_week,
            data.start_date,
            data.end_date,
            data.reason,
            now_str,
        ))
        conn.commit()
        return {"id": adj_id, "success": True}


@router.patch("/adjustments/{adj_id}/toggle")
def toggle_adjustment(adj_id: str):
    with get_connection() as conn:
        row = conn.execute("SELECT is_active FROM adjustments WHERE id = ?", (adj_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Adjustment not found")
        new_val = 0 if row["is_active"] else 1
        conn.execute("UPDATE adjustments SET is_active = ? WHERE id = ?", (new_val, adj_id))
        conn.commit()
        return {"id": adj_id, "is_active": new_val}


@router.delete("/adjustments/{adj_id}")
def delete_adjustment(adj_id: str):
    with get_connection() as conn:
        conn.execute("DELETE FROM adjustments WHERE id = ?", (adj_id,))
        conn.commit()
        return {"id": adj_id, "success": True}


# ==============================================================================
# Schedule Generation & Export
# ==============================================================================
@router.post("/generate-schedule")
async def generate_schedule_endpoint(
    week_start_date: str = Form(...),
    type_file_1: str = Form(...),
    file_1: UploadFile = File(...),
    type_file_2: str = Form(...),
    file_2: UploadFile = File(...),
    type_file_3: str = Form(...),
    file_3: UploadFile = File(...),
    file_schedule: UploadFile = File(...),
    allow_7h_override: bool = Form(False),
    allow_4h_continuous_override: bool = Form(False),
):
    """Run the delta scheduling engine on the uploaded distribution and schedule files."""
    try:
        content_1 = await file_1.read()
        content_2 = await file_2.read()
        content_3 = await file_3.read()
        content_sched = await file_schedule.read()

        # Parse distributions with their selected class type dropdowns
        dist_1 = parse_distribution_workbook(content_1, type_file_1)
        dist_2 = parse_distribution_workbook(content_2, type_file_2)
        dist_3 = parse_distribution_workbook(content_3, type_file_3)

        dists = {
            dist_1["class_type"]: dist_1,
            dist_2["class_type"]: dist_2,
            dist_3["class_type"]: dist_3,
        }

        # Parse uploaded schedule
        existing = parse_schedule_file(content_sched)

        # Fetch master data
        with get_connection() as conn:
            teachers = [dict(r) for r in conn.execute("SELECT * FROM teachers").fetchall()]
            shifts = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM shifts").fetchall()}
            adjustments = [dict(r) for r in conn.execute("SELECT * FROM adjustments").fetchall()]

        # Generate revised schedule
        result = generate_revised_schedule(
            week_start_date=week_start_date,
            distributions=dists,
            existing_classes=existing,
            teachers=teachers,
            shifts=shifts,
            adjustments=adjustments,
            allow_7h_override=allow_7h_override,
            allow_4h_continuous_override=allow_4h_continuous_override,
        )

        # Save generated schedule into database
        sched_id = f"sched-{uuid4().hex[:8]}"
        now_str = datetime.now().isoformat()
        stats = result["stats"]

        with get_connection() as conn:
            conn.execute("""
                INSERT INTO schedules
                (id, week_start_date, name, total_classes, adult_count, teens_count, speak_plus_count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                sched_id,
                week_start_date,
                f"Schedule Week {week_start_date}",
                stats["total_classes"],
                stats["adult_count"],
                stats["teens_count"],
                stats["speak_plus_count"],
                now_str,
            ))

            item_records = [
                (
                    f"item-{uuid4().hex[:8]}",
                    sched_id,
                    c["account"],
                    c["name"],
                    c["time"],
                    c["end_time"],
                    c["vtc"],
                    c["class_type"],
                    c.get("hidden", "No"),
                    c.get("action", "kept"),
                )
                for c in result["classes"]
            ]
            conn.executemany("""
                INSERT INTO schedule_items
                (id, schedule_id, account, name, time, end_time, vtc, class_type, hidden, action)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, item_records)
            conn.commit()

        return {
            "schedule_id": sched_id,
            "week_start_date": week_start_date,
            "stats": stats,
            "change_log_sample": result["change_log"][:40],
            "total_changes": len(result["change_log"]),
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Generation failed: {str(e)}")


@router.get("/schedule/{schedule_id}/export")
def export_schedule_endpoint(schedule_id: str):
    """Download the finalised schedule in the exact Sandbox Schedule structure."""
    with get_connection() as conn:
        sched = conn.execute("SELECT * FROM schedules WHERE id = ?", (schedule_id,)).fetchone()
        if not sched:
            raise HTTPException(status_code=404, detail="Schedule not found")

        rows = conn.execute("""
            SELECT account, name, time, end_time, vtc, class_type, hidden
            FROM schedule_items
            WHERE schedule_id = ?
            ORDER BY time ASC, name ASC
        """, (schedule_id,)).fetchall()

        classes = [dict(r) for r in rows]

    excel_bytes = export_schedule_to_excel(classes)
    filename = f"Revised_Schedule_{sched['week_start_date']}.xlsx"

    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/schedule/{schedule_id}/classes")
def get_schedule_classes(
    schedule_id: str,
    day: Optional[str] = None,
    class_type: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    """Paginated classes for the interactive review grid."""
    with get_connection() as conn:
        query = "SELECT * FROM schedule_items WHERE schedule_id = ?"
        params: List[Any] = [schedule_id]

        if day:
            query += " AND time LIKE ?"
            params.append(f"{day}%")

        if class_type:
            query += " AND class_type = ?"
            params.append(class_type)

        if search:
            query += " AND (name LIKE ? OR account LIKE ?)"
            term = f"%{search.strip()}%"
            params.extend([term, term])

        count_query = query.replace("SELECT *", "SELECT COUNT(*)")
        total = conn.execute(count_query, params).fetchone()[0]

        query += " ORDER BY time ASC, name ASC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = conn.execute(query, params).fetchall()

        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "items": [dict(r) for r in rows],
        }
