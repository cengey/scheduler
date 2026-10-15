// Scheduler Frontend Application Logic

const API_BASE = '/api';

// State
let tasks = [];
let currentFilter = 'all';
let searchQuery = '';

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

const searchInput = document.getElementById('searchInput');
const filterBtns = document.querySelectorAll('.filter-btn');
const toastContainer = document.getElementById('toastContainer');

const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIconSun = document.getElementById('themeIconSun');
const themeIconMoon = document.getElementById('themeIconMoon');

// Server start time (client clock), derived from a single health check.
// Uptime is then ticked locally so we don't need to poll the backend.
let serverStartedAt = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  fetchHealth(); // One-time check on load
  fetchTasks();
  setInterval(renderUptime, 1000); // Local tick only, no network request

  // Re-check only when the user returns to the window (e.g. server may have restarted)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fetchHealth();
  });

  setupEventListeners();
});

function setupEventListeners() {
  // Modal handlers
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

  // Form submission
  taskForm.addEventListener('submit', handleCreateTask);

  // Search input
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderTasks();
  });

  // Filter tabs
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderTasks();
    });
  });

  // Theme toggle
  themeToggleBtn.addEventListener('click', toggleTheme);
}

// Theme handling
function initTheme() {
  const saved = localStorage.getItem('scheduler-theme') || 'light';
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const target = current === 'dark' ? 'light' : 'dark';
  applyTheme(target);
  localStorage.setItem('scheduler-theme', target);
  showToast(target === 'dark' ? 'Dark theme enabled' : 'Light theme enabled');
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeIconSun.style.display = 'block';
    themeIconMoon.style.display = 'none';
  } else {
    document.documentElement.removeAttribute('data-theme');
    themeIconSun.style.display = 'none';
    themeIconMoon.style.display = 'block';
  }
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

// Toast Feedback Notification
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    <span>${escapeHtml(message)}</span>
  `;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, 2600);
}

// Fetch Backend Health & Update Status Badge (called on load / window refocus only)
async function fetchHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      const data = await res.json();
      serverStartedAt = Date.now() - data.uptime_seconds * 1000;
      markConnected();
      renderUptime();
    } else {
      markDisconnected();
    }
  } catch (err) {
    markDisconnected();
  }
}

function formatUptime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Purely client-side: no network request
function renderUptime() {
  if (serverStartedAt === null || !statUptimeEl) return;
  const seconds = Math.max(0, Math.floor((Date.now() - serverStartedAt) / 1000));
  statUptimeEl.textContent = formatUptime(seconds);
}

function markConnected() {
  statusBadgeEl.style.color = 'var(--success)';
  statusBadgeEl.style.backgroundColor = 'var(--success-tint)';
  statusBadgeEl.style.borderColor = 'var(--success-border)';
  statusTextEl.textContent = 'Backend: Connected';
}

function markDisconnected() {
  serverStartedAt = null;
  if (statUptimeEl) statUptimeEl.textContent = '-';
  statusBadgeEl.style.color = 'var(--danger)';
  statusBadgeEl.style.backgroundColor = 'var(--danger-tint)';
  statusBadgeEl.style.borderColor = 'var(--danger-border)';
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
    // A real request failing is the signal that the backend is down
    markDisconnected();
    console.error('Failed to load tasks', err);
  }
}

// Render Tasks with search and filters
function renderTasks() {
  statTotalEl.textContent = tasks.length;
  const activeCount = tasks.filter((t) => t.status === 'active').length;
  statActiveEl.textContent = activeCount;

  // Filter tasks
  let filtered = tasks.filter((t) => {
    if (currentFilter === 'active' && t.status !== 'active') return false;
    if (currentFilter === 'paused' && t.status !== 'paused') return false;
    if (currentFilter === 'high' && t.priority !== 'high') return false;

    if (searchQuery) {
      const titleMatch = (t.title || '').toLowerCase().includes(searchQuery);
      const scheduleMatch = (t.time_or_cron || '').toLowerCase().includes(searchQuery);
      const descMatch = (t.description || '').toLowerCase().includes(searchQuery);
      return titleMatch || scheduleMatch || descMatch;
    }
    return true;
  });

  if (filtered.length === 0) {
    taskListEl.innerHTML = `
      <div style="text-align: center; padding: 48px 24px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color); box-shadow: var(--shadow-sm);">
        <p style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">
          ${searchQuery ? 'No matching schedules found' : 'No scheduled tasks yet'}
        </p>
        <p style="font-size: 13px; margin-bottom: 16px;">
          ${searchQuery ? 'Try clearing your search query or filter.' : 'Click "Add Schedule" to configure your first automated routine.'}
        </p>
        ${
          searchQuery
            ? `<button class="btn btn-secondary btn-sm" onclick="clearSearch()">Clear Search</button>`
            : `<button class="btn btn-primary btn-sm" onclick="showModal(true)">+ Add Schedule</button>`
        }
      </div>
    `;
    return;
  }

  taskListEl.innerHTML = filtered
    .map(
      (task) => `
    <div class="task-item" id="task-${task.id}">
      <div class="task-info">
        <div class="task-title-row">
          <span class="task-title">${escapeHtml(task.title)}</span>
          <span class="badge badge-priority-${task.priority}">${task.priority}</span>
          <span class="badge badge-status-${task.status}">
            ● ${task.status.toUpperCase()}
          </span>
        </div>
        <div class="task-meta">
          <span class="task-meta-time">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            ${escapeHtml(task.time_or_cron)}
          </span>
          ${task.description ? `<span>· ${escapeHtml(task.description)}</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="btn btn-sm btn-secondary" onclick="toggleTask('${task.id}')">
          ${task.status === 'active' ? 'Pause' : 'Resume'}
        </button>
        <button class="btn btn-sm btn-danger-ghost" title="Delete Schedule" onclick="deleteTask('${task.id}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          Delete
        </button>
      </div>
    </div>
  `
    )
    .join('');
}

window.clearSearch = function () {
  searchInput.value = '';
  searchQuery = '';
  renderTasks();
};

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
      showToast(`Schedule "${payload.title}" created`);
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
      const updated = await res.json();
      await fetchTasks();
      showToast(`Schedule ${updated.status === 'active' ? 'resumed' : 'paused'}`);
    }
  } catch (err) {
    console.error('Error toggling task', err);
  }
};

// Delete Task
window.deleteTask = async function (id) {
  if (!confirm('Are you sure you want to delete this schedule?')) return;
  try {
    const res = await fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchTasks();
      showToast('Schedule deleted');
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
