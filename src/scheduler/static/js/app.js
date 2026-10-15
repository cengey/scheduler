// Scheduler Frontend Application Logic

const API_BASE = '/api';

// State
let tasks = [];

// DOM Elements
const taskListEl = document.getElementById('taskList');
const statTotalEl = document.getElementById('statTotal');
const statActiveEl = document.getElementById('statActive');
const statUptimeEl = document.getElementById('statUptime');
const statusBadgeEl = document.getElementById('statusBadge');
const statusTextEl = document.getElementById('statusText');

const taskModal = document.getElementById('taskModal');
const openModalBtn = document.getElementById('openModalBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const taskForm = document.getElementById('taskForm');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  fetchHealth();
  fetchTasks();
  setInterval(fetchHealth, 5000); // Check backend health every 5s

  setupEventListeners();
});

function setupEventListeners() {
  openModalBtn.addEventListener('click', () => showModal(true));
  closeModalBtn.addEventListener('click', () => showModal(false));
  cancelModalBtn.addEventListener('click', () => showModal(false));

  taskModal.addEventListener('click', (e) => {
    if (e.target === taskModal) showModal(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && taskModal.classList.contains('show')) {
      showModal(false);
    }
  });

  taskForm.addEventListener('submit', handleCreateTask);
}

function showModal(show) {
  if (show) {
    taskForm.reset();
    taskModal.classList.add('show');
    document.getElementById('taskTitle').focus();
  } else {
    taskModal.classList.remove('show');
  }
}

// Fetch Backend Health & Update Status Badge
async function fetchHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      const data = await res.json();
      statusBadgeEl.style.color = '#10b981';
      statusBadgeEl.style.backgroundColor = 'rgba(16, 185, 129, 0.12)';
      statusBadgeEl.style.borderColor = 'rgba(16, 185, 129, 0.25)';
      statusTextEl.textContent = `Backend: Connected (Uptime ${data.uptime_seconds}s)`;
      if (statUptimeEl) {
        statUptimeEl.textContent = `${data.uptime_seconds}s`;
      }
    } else {
      markDisconnected();
    }
  } catch (err) {
    markDisconnected();
  }
}

function markDisconnected() {
  statusBadgeEl.style.color = '#ef4444';
  statusBadgeEl.style.backgroundColor = 'rgba(239, 68, 68, 0.12)';
  statusBadgeEl.style.borderColor = 'rgba(239, 68, 68, 0.25)';
  statusTextEl.textContent = 'Backend: Disconnected';
}

// Fetch Tasks
async function fetchTasks() {
  try {
    const res = await fetch(`${API_BASE}/tasks`);
    if (res.ok) {
      tasks = await res.json();
      renderTasks();
    }
  } catch (err) {
    console.error('Failed to load tasks', err);
  }
}

// Render Tasks and Update Stats
function renderTasks() {
  statTotalEl.textContent = tasks.length;
  const activeCount = tasks.filter((t) => t.status === 'active').length;
  statActiveEl.textContent = activeCount;

  if (tasks.length === 0) {
    taskListEl.innerHTML = `
      <div style="text-align: center; padding: 48px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color);">
        <p style="font-size: 14px; margin-bottom: 8px;">No scheduled tasks yet</p>
        <p style="font-size: 12px;">Click "+ Add Schedule" to set up your first background task.</p>
      </div>
    `;
    return;
  }

  taskListEl.innerHTML = tasks
    .map(
      (task) => `
    <div class="task-item" id="task-${task.id}">
      <div class="task-info">
        <div class="task-title-row">
          <span class="task-title">${escapeHtml(task.title)}</span>
          <span class="priority-badge priority-${task.priority}">${task.priority}</span>
          <span style="font-size: 11px; color: ${task.status === 'active' ? '#10b981' : '#94a3b8'};">
            ● ${task.status.toUpperCase()}
          </span>
        </div>
        <div class="task-time">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          ${escapeHtml(task.time_or_cron)}
          ${task.description ? ` · <span style="color: var(--text-muted);">${escapeHtml(task.description)}</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="btn-toggle" onclick="toggleTask('${task.id}')">
          ${task.status === 'active' ? 'Pause' : 'Resume'}
        </button>
        <button class="btn-delete" title="Delete Task" onclick="deleteTask('${task.id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>
  `
    )
    .join('');
}

// Handle Add Task Form Submit
async function handleCreateTask(e) {
  e.preventDefault();
  const payload = {
    title: document.getElementById('taskTitle').value.trim(),
    time_or_cron: document.getElementById('taskSchedule').value.trim(),
    description: document.getElementById('taskDesc').value.trim(),
    priority: document.getElementById('taskPriority').value,
  };

  try {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      showModal(false);
      await fetchTasks();
    } else {
      alert('Failed to create task');
    }
  } catch (err) {
    console.error('Error creating task', err);
  }
}

// Toggle Task
window.toggleTask = async function (id) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${id}/toggle`, { method: 'PATCH' });
    if (res.ok) {
      await fetchTasks();
    }
  } catch (err) {
    console.error('Error toggling task', err);
  }
};

// Delete Task
window.deleteTask = async function (id) {
  if (!confirm('Are you sure you want to delete this task?')) return;
  try {
    const res = await fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchTasks();
    }
  } catch (err) {
    console.error('Error deleting task', err);
  }
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
