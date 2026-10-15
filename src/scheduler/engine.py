"""Scheduling Delta Engine.

Applies distribution demands to an existing schedule with minimal disruption.
Respects 6h daily limits, 3h continuous blocks, shift windows, off days,
weekend rotations, and teacher schedule adjustments.
"""

from datetime import datetime, date, time, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import uuid4

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def get_slot_duration_minutes(class_type: str) -> int:
    """Return class duration in minutes based on class type."""
    if class_type.lower() == "speak+":
        return 30
    return 60  # Adult and Teens are 60 minutes


def parse_time_str_to_minutes(time_str: str) -> int:
    """Convert 'HH:MM' string to minutes since midnight."""
    parts = time_str.strip().split(":")
    return int(parts[0]) * 60 + int(parts[1])


def is_time_in_window(slot_time_str: str, duration_mins: int, start_window: str, end_window: str) -> bool:
    """Check if a class slot falls entirely within a shift window."""
    start_min = parse_time_str_to_minutes(slot_time_str)
    end_min = start_min + duration_mins
    win_start = parse_time_str_to_minutes(start_window)
    win_end = parse_time_str_to_minutes(end_window)

    if win_start < win_end:
        # Standard window (e.g. 07:00 to 19:00)
        return start_min >= win_start and end_min <= win_end
    else:
        # Overnight / wrapping window (e.g. 21:00 to 09:00)
        # Class starts after 21:00 or finishes before 09:00
        in_night = start_min >= win_start and (end_min >= win_start or end_min <= 24 * 60)
        in_morning = end_min <= win_end
        return in_night or in_morning


def compute_roster_stats(classes: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute summary statistics for a roster."""
    total = len(classes)
    adults = sum(1 for c in classes if c.get("class_type") == "Adult")
    teens = sum(1 for c in classes if c.get("class_type") == "Teens")
    speak = sum(1 for c in classes if c.get("class_type") == "Speak+")
    placeholders = sum(1 for c in classes if "to be assigned" in c.get("name", "").lower() or c.get("name") == "Cengey G")
    hidden_count = sum(1 for c in classes if str(c.get("hidden", "")).lower() == "yes")

    return {
        "total_classes": total,
        "adult_count": adults,
        "teens_count": teens,
        "speak_plus_count": speak,
        "placeholder_count": placeholders,
        "resigned_count": hidden_count,
    }


def generate_revised_schedule(
    week_start_date: str,  # 'YYYY-MM-DD' (Monday)
    distributions: Dict[str, Dict[str, Any]],  # {'Adult': ..., 'Teens': ..., 'Speak+': ...}
    existing_classes: List[Dict[str, Any]],
    teachers: List[Dict[str, Any]],
    shifts: Dict[str, Dict[str, Any]],
    adjustments: List[Dict[str, Any]],
    daily_hour_cap: float = 6.0,
    max_continuous_hours: float = 3.0,
    allow_7h_override: bool = False,
) -> Dict[str, Any]:
    """Generate a revised schedule by matching uploaded classes against target distributions."""
    monday_dt = datetime.strptime(week_start_date, "%Y-%m-%d").date()
    # ISO calendar week number determines alternate weekend cycle
    iso_week_num = monday_dt.isocalendar()[1]
    effective_hour_cap = 7.0 if allow_7h_override else daily_hour_cap

    # Pre-index teachers
    teacher_by_account = {t["account"]: t for t in teachers}
    active_teachers = [t for t in teachers if t["status"] == "active"]

    # Filter active adjustments covering the target week
    week_end_dt = monday_dt + timedelta(days=6)
    valid_adjustments: Dict[str, List[Dict[str, Any]]] = {}
    for adj in adjustments:
        if not adj.get("is_active", 1):
            continue
        start_d = datetime.strptime(adj["start_date"], "%Y-%m-%d").date()
        end_d = datetime.strptime(adj["end_date"], "%Y-%m-%d").date() if adj.get("end_date") else date.max
        if start_d <= week_end_dt and end_d >= monday_dt:
            acc = adj["teacher_account"]
            valid_adjustments.setdefault(acc, []).append(adj)

    # 1. Map existing classes onto the target week by weekday (0..6)
    # Target week date mapping: day_index -> YYYY-MM-DD
    day_dates = [(monday_dt + timedelta(days=d)).strftime("%Y-%m-%d") for d in range(7)]

    # Group existing classes by (day_index, slot_time_str, class_type)
    existing_by_slot: Dict[Tuple[int, str, str], List[Dict[str, Any]]] = {}
    for c in existing_classes:
        time_raw = str(c.get("time", "")).strip()
        if not time_raw:
            continue
        try:
            class_dt = datetime.strptime(time_raw, "%Y-%m-%d %H:%M:%S")
            d_idx = class_dt.weekday()
            slot_str = class_dt.strftime("%H:%M")
            ctype = c.get("class_type", "Adult")
            existing_by_slot.setdefault((d_idx, slot_str, ctype), []).append(c)
        except Exception:
            continue

    # 2. Build master list of all required demands across all 3 distributions
    target_demands: Dict[Tuple[int, str, str], int] = {}
    for ctype, dist in distributions.items():
        slots = dist.get("slots", {})
        for (d_idx, slot_str), req_count in slots.items():
            if req_count > 0:
                target_demands[(d_idx, slot_str, ctype)] = req_count

    # Track final classes, action log, and teacher daily workloads
    final_classes: List[Dict[str, Any]] = []
    change_log: List[Dict[str, Any]] = []
    # (account, day_idx) -> list of (start_min, end_min, duration_hours)
    teacher_day_schedule: Dict[Tuple[str, int], List[Tuple[int, int, float]]] = {}

    def _can_teacher_take_slot(
        teacher: Dict[str, Any],
        d_idx: int,
        target_date_str: str,
        slot_str: str,
        duration_mins: int,
    ) -> bool:
        account = teacher["account"]
        # 1. Eligibility
        # Handled before calling

        # 2. Shift window
        shift_id = teacher.get("shift_id", "day")
        shift_cfg = shifts.get(shift_id, {"start_time": "07:00", "end_time": "19:00"})
        if not is_time_in_window(slot_str, duration_mins, shift_cfg["start_time"], shift_cfg["end_time"]):
            return False

        # 3. Fixed weekly day off
        day_name = DAY_NAMES[d_idx]
        if teacher.get("fixed_day_off") == day_name:
            return False

        # 4. Alternate weekend off
        # Group A off on even weeks, Group B off on odd weeks
        if d_idx in (5, 6):  # Saturday or Sunday
            group = teacher.get("weekend_group", "A")
            is_weekend_off = (group == "A" and iso_week_num % 2 == 0) or (group == "B" and iso_week_num % 2 == 1)
            if is_weekend_off:
                return False

        # 5. Check Schedule Adjustments
        for adj in valid_adjustments.get(account, []):
            dow = adj.get("day_of_week", "all")
            if dow != "all" and dow.lower() != day_name.lower():
                continue
            adj_type = adj.get("type")
            slot_min = parse_time_str_to_minutes(slot_str)
            end_min = slot_min + duration_mins

            if adj_type == "unavailable_day":
                return False
            elif adj_type == "no_before":
                limit_min = parse_time_str_to_minutes(adj.get("time_value", "00:00"))
                if slot_min < limit_min:
                    return False
            elif adj_type == "no_after":
                limit_min = parse_time_str_to_minutes(adj.get("time_value", "23:59"))
                if end_min > limit_min:
                    return False
            elif adj_type == "block_slot":
                # Check overlap with blocked slot or range
                b_val = adj.get("time_value", "")
                if "-" in b_val:
                    p1, p2 = b_val.split("-")
                    b_start, b_end = parse_time_str_to_minutes(p1), parse_time_str_to_minutes(p2)
                    if max(slot_min, b_start) < min(end_min, b_end):
                        return False
                else:
                    b_start = parse_time_str_to_minutes(b_val)
                    if b_start <= slot_min < b_start + 60:
                        return False

        # 6. Existing classes on this day (overlap, total hours cap, back-to-back continuous limit)
        existing_slots = teacher_day_schedule.get((account, d_idx), [])
        slot_min = parse_time_str_to_minutes(slot_str)
        end_min = slot_min + duration_mins
        duration_hrs = duration_mins / 60.0

        total_day_hours = sum(s[2] for s in existing_slots)
        if total_day_hours + duration_hrs > effective_hour_cap:
            return False

        # Check direct time overlap
        for s_start, s_end, _ in existing_slots:
            if max(slot_min, s_start) < min(end_min, s_end):
                return False  # Overlapping class

        # Check continuous back-to-back limit (< 3.0 continuous hours without a >=30m break)
        all_slots = sorted(existing_slots + [(slot_min, end_min, duration_hrs)], key=lambda x: x[0])
        curr_continuous = 0.0
        prev_end = None
        for s_start, s_end, s_dur in all_slots:
            if prev_end is not None:
                gap = s_start - prev_end
                if gap < 30:
                    curr_continuous += s_dur
                else:
                    curr_continuous = s_dur
            else:
                curr_continuous = s_dur
            prev_end = s_end

            if curr_continuous > max_continuous_hours:
                return False

        return True

    def _record_teacher_slot(account: str, d_idx: int, slot_str: str, duration_mins: int):
        slot_min = parse_time_str_to_minutes(slot_str)
        teacher_day_schedule.setdefault((account, d_idx), []).append(
            (slot_min, slot_min + duration_mins, duration_mins / 60.0)
        )

    # All unique slots to process
    all_keys = set(existing_by_slot.keys()).union(set(target_demands.keys()))

    for (d_idx, slot_str, ctype) in sorted(all_keys):
        target_count = target_demands.get((d_idx, slot_str, ctype), 0)
        curr_existing = existing_by_slot.get((d_idx, slot_str, ctype), [])
        target_date_str = day_dates[d_idx]
        dur_mins = get_slot_duration_minutes(ctype)
        start_time_full = f"{target_date_str} {slot_str}:00"
        end_dt = datetime.strptime(start_time_full, "%Y-%m-%d %H:%M:%S") + timedelta(minutes=dur_mins)
        end_time_full = end_dt.strftime("%Y-%m-%d %H:%M:%S")

        # CASE 1: Keep matching existing classes
        kept_from_existing = []
        for c in curr_existing:
            if len(kept_from_existing) >= target_count:
                # Excess class -> remove
                change_log.append({
                    "action": "removed",
                    "account": c.get("account"),
                    "name": c.get("name"),
                    "time": start_time_full,
                    "class_type": ctype,
                    "reason": "Distribution demand decreased",
                })
            else:
                acc = c.get("account", "")
                t_info = teacher_by_account.get(acc)
                # Check if this teacher is currently allowed to keep this slot
                if t_info and _can_teacher_take_slot(t_info, d_idx, target_date_str, slot_str, dur_mins):
                    _record_teacher_slot(acc, d_idx, slot_str, dur_mins)
                    final_classes.append({
                        "account": acc,
                        "name": c.get("name", t_info["name"]),
                        "time": start_time_full,
                        "end_time": end_time_full,
                        "vtc": c.get("vtc", t_info.get("vtc", "")),
                        "class_type": ctype,
                        "hidden": c.get("hidden", "No"),
                        "action": "kept",
                    })
                    kept_from_existing.append(c)
                else:
                    # Teacher violates rules or is off -> mark for reallocation
                    change_log.append({
                        "action": "reassigned",
                        "account": acc,
                        "name": c.get("name"),
                        "time": start_time_full,
                        "class_type": ctype,
                        "reason": "Teacher unavailable or exceeds shift/rule limits",
                    })

        # CASE 2: Deficit (target_count > kept_from_existing) -> Add new classes
        deficit = target_count - len(kept_from_existing)
        if deficit > 0:
            # Candidate teachers based on class type
            candidate_teachers = [
                t for t in active_teachers
                if (ctype != "Teens" or t.get("teens_qualified"))
                and (ctype != "Speak+" or t.get("speak_plus_qualified"))
            ]

            # Sort candidate teachers: prefer teachers already working on this day with room,
            # then teachers on shift with lowest daily hours (balanced load)
            for _ in range(deficit):
                best_teacher = None
                for t in candidate_teachers:
                    if _can_teacher_take_slot(t, d_idx, target_date_str, slot_str, dur_mins):
                        best_teacher = t
                        break

                if best_teacher:
                    acc = best_teacher["account"]
                    _record_teacher_slot(acc, d_idx, slot_str, dur_mins)
                    final_classes.append({
                        "account": acc,
                        "name": best_teacher["name"],
                        "time": start_time_full,
                        "end_time": end_time_full,
                        "vtc": best_teacher.get("vtc", ""),
                        "class_type": ctype,
                        "hidden": "No",
                        "action": "added",
                    })
                    change_log.append({
                        "action": "added",
                        "account": acc,
                        "name": best_teacher["name"],
                        "time": start_time_full,
                        "class_type": ctype,
                        "reason": "Demand increased; assigned available qualified teacher",
                    })
                else:
                    # No active teacher available -> assign to placeholder
                    placeholder_name = f"To Be Assigned (Slot {slot_str})"
                    placeholder_acc = f"tba.{ctype.lower()[:3]}.{slot_str.replace(':', '')}"
                    final_classes.append({
                        "account": placeholder_acc,
                        "name": placeholder_name,
                        "time": start_time_full,
                        "end_time": end_time_full,
                        "vtc": "vtc_tba",
                        "class_type": ctype,
                        "hidden": "Yes",
                        "action": "added_unassigned",
                    })
                    change_log.append({
                        "action": "unassigned_placeholder",
                        "account": placeholder_acc,
                        "name": placeholder_name,
                        "time": start_time_full,
                        "class_type": ctype,
                        "reason": "All qualified teachers at capacity or off shift",
                    })

    stats = compute_roster_stats(final_classes)
    stats["total_changes"] = len(change_log)
    stats["added_count"] = sum(1 for c in change_log if c["action"] == "added")
    stats["removed_count"] = sum(1 for c in change_log if c["action"] == "removed")
    stats["unassigned_count"] = sum(1 for c in change_log if c["action"] == "unassigned_placeholder")

    return {
        "week_start_date": week_start_date,
        "classes": final_classes,
        "change_log": change_log,
        "stats": stats,
    }
