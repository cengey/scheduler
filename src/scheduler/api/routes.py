"""REST API routes for the Scheduler backend."""

import platform
import time
from datetime import datetime
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api", tags=["api"])

SERVER_START_TIME = time.time()


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, description="Task title or name")
    time_or_cron: str = Field(..., description="Time, cron schedule, or frequency")
    description: Optional[str] = Field(default="", description="Detailed description")
    priority: str = Field(default="medium", description="Priority level: low, medium, high")


class Task(TaskCreate):
    id: str
    status: str = "active"
    created_at: str


# In-memory storage for the foundational demo
_TASKS: dict[str, Task] = {
    "task-1": Task(
        id="task-1",
        title="Daily Database Backup",
        time_or_cron="0 2 * * * (Every day at 02:00)",
        description="Run automated snapshot of local database files",
        priority="high",
        status="active",
        created_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    ),
    "task-2": Task(
        id="task-2",
        title="Weekly Report Aggregation",
        time_or_cron="0 9 * * 1 (Every Monday at 09:00)",
        description="Aggregate weekly statistics and metrics summary",
        priority="medium",
        status="active",
        created_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    ),
    "task-3": Task(
        id="task-3",
        title="Cache Cleanup Routine",
        time_or_cron="*/30 * * * * (Every 30 minutes)",
        description="Evict stale temporary cache entries",
        priority="low",
        status="active",
        created_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    ),
}


@router.get("/health")
def get_health():
    """Health check endpoint used by the launcher to detect server readiness."""
    uptime_seconds = int(time.time() - SERVER_START_TIME)
    return {
        "status": "healthy",
        "app": "Scheduler",
        "version": "0.1.0",
        "uptime_seconds": uptime_seconds,
        "timestamp": datetime.now().isoformat(),
    }


@router.get("/system")
def get_system_info():
    """System information endpoint."""
    return {
        "platform": platform.platform(),
        "python_version": platform.python_version(),
        "node": platform.node(),
        "is_wsl": "microsoft" in platform.release().lower(),
    }


@router.get("/tasks", response_model=List[Task])
def list_tasks():
    """Retrieve all scheduled tasks."""
    return list(_TASKS.values())


@router.post("/tasks", response_model=Task, status_code=201)
def create_task(task_input: TaskCreate):
    """Create a new scheduled task."""
    task_id = f"task-{uuid4().hex[:6]}"
    task = Task(
        id=task_id,
        title=task_input.title,
        time_or_cron=task_input.time_or_cron,
        description=task_input.description,
        priority=task_input.priority,
        status="active",
        created_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )
    _TASKS[task_id] = task
    return task


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str):
    """Delete a scheduled task by ID."""
    if task_id not in _TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    del _TASKS[task_id]
    return {"success": True, "deleted_id": task_id}


@router.patch("/tasks/{task_id}/toggle")
def toggle_task(task_id: str):
    """Toggle a task between active and paused status."""
    if task_id not in _TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    task = _TASKS[task_id]
    task.status = "paused" if task.status == "active" else "active"
    return task
