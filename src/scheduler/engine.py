"""Scheduling Delta Engine.

Applies distribution demands to an existing schedule with minimal disruption.
Respects 6h daily limits, 3h continuous blocks, shift windows, off days,
weekend rotations, and teacher schedule adjustments.
Outputs full actionable Client's Hub directives in Column H (Comment).
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
        in_night = start_min >= win_start and (end_min >= win_start or end_min <= 24 * 60)
        in_morning = end_min <= win_end
        return in_night or in_morning


def compute_roster_stats(classes: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute summary statistics for a roster."""
    active_items = [c for c in classes if c.get("action") != "deleted"]
    total = len(active_items)
    adults = sum(1 for c in active_items if c.get("class_type") == "Adult")
    teens = sum(1 for c in active_items if c.get("class_type") == "Teens")
    speak = sum(1 for c in active_items if c.get("class_type") == "Speak+")
    placeholders = sum(
        1 for c in active_items
        if "to be assigned" in c.get("name", "").lower() or c.get("name") == "Cengey G"
    )
    hidden_count = sum(1 for c in active_items if str(c.get("hidden", "")).lower() == "yes")

    moved_count = sum(1 for c in classes if c.get("action") == "moved")
    created_count = sum(1 for c in classes if c.get("action") == "created")
    deleted_count = sum(1 for c in classes if c.get("action") == "deleted")
    kept_count = sum(1 for c in classes if c.get("action") == "kept")

    return {
        "total_classes": total,
        "adult_count": adults,
        "teens_count": teens,
        "speak_plus_count": speak,
        "placeholder_count": placeholders,
        "resigned_count": hidden_count,
        "moved_count": moved_count,
        "created_count": created_count,
        "deleted_count": deleted_count,
        "kept_count": kept_count,
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
    allow_4h_continuous_override: bool = False,
    include_archived: bool = False,
) -> Dict[str, Any]:
    """Generate a revised schedule matching uploaded classes against target distributions.

    Outputs full actionable Client's Hub comments in Column H.
    """
    monday_dt = datetime.strptime(week_start_date, "%Y-%m-%d").date()
    iso_week_num = monday_dt.isocalendar()[1]
    effective_hour_cap = 7.0 if allow_7h_override else daily_hour_cap
    effective_continuous_cap = 4.0 if allow_4h_continuous_override else max_continuous_hours

    # Teacher lookups
    teacher_by_account: Dict[str, Dict[str, Any]] = {t["account"]: t for t in teachers}

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

    # Day date strings: day_index -> YYYY-MM-DD
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

    # Master list of required target demands across distributions
    target_demands: Dict[Tuple[int, str, str], int] = {}
    for ctype, dist in distributions.items():
        slots = dist.get("slots", {})
        for (d_idx, slot_str), req_count in slots.items():
            if req_count > 0:
                target_demands[(d_idx, slot_str, ctype)] = req_count

    # State tracking
    final_classes: List[Dict[str, Any]] = []
    change_log: List[Dict[str, Any]] = []
    # (account, day_idx) -> list of (start_min, end_min, duration_hours)
    teacher_day_schedule: Dict[Tuple[str, int], List[Tuple[int, int, float]]] = {}

    def _get_ineligibility_reason(
        teacher: Dict[str, Any],
        d_idx: int,
        slot_str: str,
        duration_mins: int,
        is_existing_class_hidden: bool = False,
    ) -> Optional[str]:
        """Check if teacher can take slot. Returns None if eligible, or human-readable reason string."""
        account = teacher["account"]
        status = teacher.get("status", "active")

        # 1. Archived / Leaver check
        if not include_archived and status == "archived":
            return f"{teacher['name']} is marked Archived / Leaver in Hub Teacher List"

        # 2. Hidden check
        if is_existing_class_hidden or str(teacher.get("hidden", "")).lower() == "yes":
            return f"{teacher['name']} is marked Hidden"

        # Placeholders are allowed anywhere
        if status == "placeholder":
            return None

        # 3. Shift window check
        shift_id = teacher.get("shift_id", "day")
        shift_cfg = shifts.get(shift_id, {"name": "Day Shift", "start_time": "07:00", "end_time": "19:00"})
        if not is_time_in_window(slot_str, duration_mins, shift_cfg["start_time"], shift_cfg["end_time"]):
            return f"Time outside shift window ({shift_cfg.get('name', 'Shift')}: {shift_cfg['start_time']}–{shift_cfg['end_time']})"

        # 4. Fixed weekly day off
        day_name = DAY_NAMES[d_idx]
        if teacher.get("fixed_day_off") == day_name:
            return f"Fixed weekly day off ({day_name})"

        # 5. Alternate weekend off
        if d_idx in (5, 6):  # Saturday or Sunday
            group = teacher.get("weekend_group", "A")
            is_weekend_off = (group == "A" and iso_week_num % 2 == 0) or (group == "B" and iso_week_num % 2 == 1)
            if is_weekend_off:
                rot_name = teacher.get("rotation_id", f"Group {group}")
                return f"Weekend rotation OFF (Rotation {rot_name})"

        # 6. Schedule Adjustments
        for adj in valid_adjustments.get(account, []):
            dow = adj.get("day_of_week", "all")
            if dow != "all" and day_name.lower() not in [d.strip().lower() for d in dow.split(",")]:
                continue
            adj_type = adj.get("type")
            slot_min = parse_time_str_to_minutes(slot_str)
            end_min = slot_min + duration_mins
            adj_reason_note = adj.get("reason", "").strip() or adj_type

            if adj_type == "unavailable_day" or adj_type == "full_leave":
                return f"Schedule adjustment: Unavailable day ({adj_reason_note})"
            elif adj_type == "no_before":
                limit_min = parse_time_str_to_minutes(adj.get("time_value", "00:00"))
                if slot_min < limit_min:
                    return f"Schedule adjustment: No classes before {adj.get('time_value')} ({adj_reason_note})"
            elif adj_type == "no_after":
                limit_min = parse_time_str_to_minutes(adj.get("time_value", "23:59"))
                if end_min > limit_min:
                    return f"Schedule adjustment: No classes after {adj.get('time_value')} ({adj_reason_note})"
            elif adj_type == "block_slot":
                b_val = adj.get("time_value", "")
                if "-" in b_val:
                    p1, p2 = b_val.split("-")
                    b_start, b_end = parse_time_str_to_minutes(p1), parse_time_str_to_minutes(p2)
                    if max(slot_min, b_start) < min(end_min, b_end):
                        return f"Schedule adjustment: Blocked slot {b_val} ({adj_reason_note})"
                else:
                    b_start = parse_time_str_to_minutes(b_val)
                    if b_start <= slot_min < b_start + 60:
                        return f"Schedule adjustment: Blocked slot {b_val} ({adj_reason_note})"

        # 7. Workload & Continuous Limits
        existing_slots = teacher_day_schedule.get((account, d_idx), [])
        slot_min = parse_time_str_to_minutes(slot_str)
        end_min = slot_min + duration_mins
        duration_hrs = duration_mins / 60.0

        total_day_hours = sum(s[2] for s in existing_slots)
        if total_day_hours + duration_hrs > effective_hour_cap:
            return f"Exceeds daily {effective_hour_cap:g}h cap (current: {total_day_hours:.1f}h)"

        # Check direct time overlap
        for s_start, s_end, _ in existing_slots:
            if max(slot_min, s_start) < min(end_min, s_end):
                return "Time overlap with another scheduled class"

        # Continuous back-to-back limit (< 3.0 / 4.0 hours continuous)
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

            if curr_continuous > effective_continuous_cap:
                return f"Exceeds continuous teaching limit ({effective_continuous_cap:g}h back-to-back)"

        return None

    def _record_slot(account: str, d_idx: int, slot_str: str, duration_mins: int):
        slot_min = parse_time_str_to_minutes(slot_str)
        teacher_day_schedule.setdefault((account, d_idx), []).append(
            (slot_min, slot_min + duration_mins, duration_mins / 60.0)
        )

    # Process each unique slot across the target week
    all_slot_keys = sorted(set(existing_by_slot.keys()).union(set(target_demands.keys())))

    for (d_idx, slot_str, ctype) in all_slot_keys:
        target_count = target_demands.get((d_idx, slot_str, ctype), 0)
        curr_existing = existing_by_slot.get((d_idx, slot_str, ctype), [])
        target_date_str = day_dates[d_idx]
        dur_mins = get_slot_duration_minutes(ctype)
        start_time_full = f"{target_date_str} {slot_str}:00"
        end_dt = datetime.strptime(start_time_full, "%Y-%m-%d %H:%M:%S") + timedelta(minutes=dur_mins)
        end_time_full = end_dt.strftime("%Y-%m-%d %H:%M:%S")

        kept_classes: List[Dict[str, Any]] = []
        classes_needing_reassign: List[Tuple[Dict[str, Any], str]] = []

        # 1. Evaluate existing classes at this slot
        for c in curr_existing:
            acc = c.get("account", "")
            t_info = teacher_by_account.get(acc)
            is_hidden = str(c.get("hidden", "No")).lower() == "yes"

            if not t_info:
                # If teacher is not in master list, check if name matches or treat as placeholder
                t_info = {"account": acc, "name": c.get("name", acc), "status": "active"}

            ineligible_reason = _get_ineligibility_reason(
                t_info, d_idx, slot_str, dur_mins, is_existing_class_hidden=is_hidden
            )

            if len(kept_classes) < target_count and ineligible_reason is None:
                # Retained without change
                _record_slot(acc, d_idx, slot_str, dur_mins)
                kept_class = {
                    "account": acc,
                    "name": c.get("name", t_info.get("name", acc)),
                    "time": start_time_full,
                    "end_time": end_time_full,
                    "vtc": c.get("vtc", t_info.get("vtc", "")),
                    "class_type": ctype,
                    "hidden": "No",
                    "action": "kept",
                    "comment": f"KEPT: Original schedule retained in Client's Hub for {c.get('name', acc)} ({acc})",
                }
                kept_classes.append(kept_class)
                final_classes.append(kept_class)
            elif len(kept_classes) >= target_count:
                # Surplus class beyond target demand -> mark for deletion in Hub
                del_class = {
                    "account": acc,
                    "name": c.get("name", t_info.get("name", acc)),
                    "time": start_time_full,
                    "end_time": end_time_full,
                    "vtc": c.get("vtc", t_info.get("vtc", "")),
                    "class_type": ctype,
                    "hidden": "Yes",
                    "action": "deleted",
                    "comment": f"DELETED: Delete / cancel in Client's Hub for {c.get('name', acc)} ({acc}) — Reason: Surplus class above distribution demand ({target_count} required)",
                }
                final_classes.append(del_class)
                change_log.append({
                    "action": "deleted",
                    "account": acc,
                    "name": c.get("name"),
                    "time": start_time_full,
                    "class_type": ctype,
                    "reason": "Surplus class above distribution demand",
                })
            else:
                # Ineligible -> needs to be moved to an eligible teacher
                classes_needing_reassign.append((c, ineligible_reason))

        # 2. Candidate teachers pool for moves and deficit creations
        candidate_teachers = [
            t for t in teachers
            if (t.get("status") == "active" or (include_archived and t.get("status") == "archived") or t.get("status") == "placeholder")
            and (ctype != "Teens" or t.get("teens_qualified") or t.get("status") == "placeholder")
            and (ctype != "Speak+" or t.get("speak_plus_qualified") or t.get("status") == "placeholder")
        ]

        # Prioritize real active teachers first, then lowest daily workload
        def _candidate_rank(t: Dict[str, Any]) -> Tuple[int, float]:
            is_pl = 1 if t.get("status") == "placeholder" else 0
            slots_today = teacher_day_schedule.get((t["account"], d_idx), [])
            day_hours = sum(s[2] for s in slots_today)
            return (is_pl, day_hours)

        # 3. Resolve classes that must be MOVED
        for orig_c, move_reason in classes_needing_reassign:
            if len(kept_classes) >= target_count:
                # If target count already reached, this excess class is deleted
                del_class = {
                    "account": orig_c.get("account", ""),
                    "name": orig_c.get("name", ""),
                    "time": start_time_full,
                    "end_time": end_time_full,
                    "vtc": orig_c.get("vtc", ""),
                    "class_type": ctype,
                    "hidden": "Yes",
                    "action": "deleted",
                    "comment": f"DELETED: Delete / cancel in Client's Hub for {orig_c.get('name')} ({orig_c.get('account')}) — Reason: {move_reason} & surplus demand",
                }
                final_classes.append(del_class)
                continue

            # Pick best eligible candidate
            best_t = None
            sorted_candidates = sorted(candidate_teachers, key=_candidate_rank)
            for cand in sorted_candidates:
                if _get_ineligibility_reason(cand, d_idx, slot_str, dur_mins) is None:
                    best_t = cand
                    break

            if best_t:
                acc_new = best_t["account"]
                _record_slot(acc_new, d_idx, slot_str, dur_mins)
                moved_class = {
                    "account": acc_new,
                    "name": best_t["name"],
                    "time": start_time_full,
                    "end_time": end_time_full,
                    "vtc": best_t.get("vtc", ""),
                    "class_type": ctype,
                    "hidden": "No",
                    "action": "moved",
                    "comment": f"MOVED: Reassigned in Client's Hub from {orig_c.get('name')} ({orig_c.get('account')}) to {best_t['name']} ({acc_new}) — Reason: {move_reason}",
                }
                final_classes.append(moved_class)
                kept_classes.append(moved_class)
                change_log.append({
                    "action": "moved",
                    "account": acc_new,
                    "name": best_t["name"],
                    "time": start_time_full,
                    "class_type": ctype,
                    "reason": f"Reassigned from {orig_c.get('name')}: {move_reason}",
                })
            else:
                # Assign to placeholder if no teacher available
                pl_name = f"To Be Assigned ({slot_str})"
                pl_acc = f"tba.{ctype.lower()[:3]}.{slot_str.replace(':', '')}"
                moved_class = {
                    "account": pl_acc,
                    "name": pl_name,
                    "time": start_time_full,
                    "end_time": end_time_full,
                    "vtc": "vtc_tba",
                    "class_type": ctype,
                    "hidden": "Yes",
                    "action": "moved",
                    "comment": f"MOVED: Reassigned in Client's Hub from {orig_c.get('name')} ({orig_c.get('account')}) to Placeholder ({pl_name}) — Reason: {move_reason}; all teachers at capacity",
                }
                final_classes.append(moved_class)
                kept_classes.append(moved_class)

        # 4. Resolve remaining DEFICIT -> CREATED classes
        deficit = target_count - len(kept_classes)
        for _ in range(max(0, deficit)):
            best_t = None
            sorted_candidates = sorted(candidate_teachers, key=_candidate_rank)
            for cand in sorted_candidates:
                if _get_ineligibility_reason(cand, d_idx, slot_str, dur_mins) is None:
                    best_t = cand
                    break

            if best_t:
                acc_new = best_t["account"]
                _record_slot(acc_new, d_idx, slot_str, dur_mins)
                created_class = {
                    "account": acc_new,
                    "name": best_t["name"],
                    "time": start_time_full,
                    "end_time": end_time_full,
                    "vtc": best_t.get("vtc", ""),
                    "class_type": ctype,
                    "hidden": "No",
                    "action": "created",
                    "comment": f"CREATED: Add new class in Client's Hub for {best_t['name']} ({acc_new}) — Reason: Demand deficit for {ctype} at {slot_str}",
                }
                final_classes.append(created_class)
                kept_classes.append(created_class)
                change_log.append({
                    "action": "created",
                    "account": acc_new,
                    "name": best_t["name"],
                    "time": start_time_full,
                    "class_type": ctype,
                    "reason": f"New class created for demand deficit at {slot_str}",
                })
            else:
                pl_name = f"To Be Assigned ({slot_str})"
                pl_acc = f"tba.{ctype.lower()[:3]}.{slot_str.replace(':', '')}"
                created_class = {
                    "account": pl_acc,
                    "name": pl_name,
                    "time": start_time_full,
                    "end_time": end_time_full,
                    "vtc": "vtc_tba",
                    "class_type": ctype,
                    "hidden": "Yes",
                    "action": "created",
                    "comment": f"CREATED: Add new class in Client's Hub with Placeholder ({pl_name}) — Reason: Demand deficit for {ctype} at {slot_str}; all teachers at capacity",
                }
                final_classes.append(created_class)
                kept_classes.append(created_class)

    stats = compute_roster_stats(final_classes)
    stats["total_changes"] = len(change_log)

    return {
        "week_start_date": week_start_date,
        "classes": final_classes,
        "change_log": change_log,
        "stats": stats,
    }
