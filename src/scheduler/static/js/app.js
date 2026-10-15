// Scheduler Desktop Frontend Application Logic

const API_BASE = '/api';

// State
let teachers = [];
let adjustments = [];
let currentScheduleId = null;
let reviewPage = 0;
const reviewPageSize = 25;
let serverStartedAt = null;

// DOM Elements
const statusBadgeEl = document.getElementById('statusBadge');
const statusTextEl = document.getElementById('statusText');
const toastContainer = document.getElementById('toastContainer');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIconSun = document.getElementById('themeIconSun');
const themeIconMoon = document.getElementById('themeIconMoon');

// Navigation
const navItems = document.querySelectorAll('.nav-item');
const viewPanels = document.querySelectorAll('.view-panel');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  fetchHealth();
  setInterval(renderUptime, 1000);

  setupNavigation();
  setupGeneratorView();
  setupTeachersView();
  setupShiftsView();
  setupAdjustmentsView();
});

// ==============================================================================
// Navigation (Sidebar Multi-View Switcher)
// ==============================================================================
function setupNavigation() {
  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetViewId = item.dataset.view;
      if (!targetViewId) return;

      navItems.forEach((nav) => nav.classList.remove('active'));
      viewPanels.forEach((panel) => panel.classList.remove('active'));

      item.classList.add('active');
      const targetPanel = document.getElementById(targetViewId);
      if (targetPanel) targetPanel.classList.add('active');

      // Refresh view-specific data
      if (targetViewId === 'teachersView') fetchTeachers();
      if (targetViewId === 'shiftsView') fetchShifts();
      if (targetViewId === 'adjustmentsView') fetchAdjustments();
    });
  });
}

// ==============================================================================
// View 1: Schedule Generator & Review
// ==============================================================================
function setupGeneratorView() {
  const form = document.getElementById('scheduleGenForm');
  const weekDateInput = document.getElementById('weekStartDate');
  const dateHint = document.getElementById('dateHintText');

  // Auto-detect class type dropdown from file name if keywords match
  const bindAutoDetect = (fileInputId, selectId) => {
    const input = document.getElementById(fileInputId);
    const select = document.getElementById(selectId);
    if (!input || !select) return;
    input.addEventListener('change', () => {
      if (!input.files || input.files.length === 0) return;
      const fname = input.files[0].name.toLowerCase();
      if (fname.includes('teen')) select.value = 'Teens';
      else if (fname.includes('speak')) select.value = 'Speak+';
      else if (fname.includes('adult')) select.value = 'Adult';
    });
  };
  bindAutoDetect('file1', 'typeFile1');
  bindAutoDetect('file2', 'typeFile2');
  bindAutoDetect('file3', 'typeFile3');

  // Restrict to Monday on change
  weekDateInput.addEventListener('change', () => {
    if (!weekDateInput.value) return;
    const d = new Date(weekDateInput.value + 'T00:00:00');
    if (d.getDay() !== 1) {
      dateHint.style.color = 'var(--danger)';
      dateHint.textContent = 'Selected date is not a Monday. Please select a Monday.';
    } else {
      dateHint.style.color = 'var(--text-light)';
      dateHint.textContent = `Valid week starting Monday, ${weekDateInput.value}`;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = new Date(weekDateInput.value + 'T00:00:00');
    if (d.getDay() !== 1) {
      alert('The start of the week must always be a Monday.');
      return;
    }

    const btn = document.getElementById('btnRunSchedule');
    btn.disabled = true;
    btn.innerHTML = 'Generating Roster...';

    const formData = new FormData();
    formData.append('week_start_date', weekDateInput.value);
    formData.append('type_file_1', document.getElementById('typeFile1').value);
    formData.append('file_1', document.getElementById('file1').files[0]);
    formData.append('type_file_2', document.getElementById('typeFile2').value);
    formData.append('file_2', document.getElementById('file2').files[0]);
    formData.append('type_file_3', document.getElementById('typeFile3').value);
    formData.append('file_3', document.getElementById('file3').files[0]);
    formData.append('file_schedule', document.getElementById('fileSchedule').files[0]);
    formData.append('allow_7h_override', document.getElementById('allow7hOverride').checked ? 'true' : 'false');

    try {
      const res = await fetch(`${API_BASE}/generate-schedule`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to generate schedule');
      }

      const data = await res.json();
      currentScheduleId = data.schedule_id;
      showToast('Schedule generated successfully!');

      renderGeneratorResults(data);
    } catch (err) {
      alert(`Error generating schedule: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Generate Proposed Schedule
      `;
    }
  });

  // Review Table Search and Filters
  document.getElementById('reviewSearch').addEventListener('input', () => {
    reviewPage = 0;
    fetchReviewClasses();
  });
  document.getElementById('reviewClassType').addEventListener('change', () => {
    reviewPage = 0;
    fetchReviewClasses();
  });

  document.getElementById('btnPrevPage').addEventListener('click', () => {
    if (reviewPage > 0) {
      reviewPage--;
      fetchReviewClasses();
    }
  });
  document.getElementById('btnNextPage').addEventListener('click', () => {
    reviewPage++;
    fetchReviewClasses();
  });
}

function renderGeneratorResults(data) {
  const stats = data.stats;
  document.getElementById('resTotalClasses').textContent = stats.total_classes.toLocaleString();
  document.getElementById('resClassBreakdown').textContent = `Adults: ${stats.adult_count} | Teens: ${stats.teens_count} | Speak+: ${stats.speak_plus_count}`;
  document.getElementById('resTotalChanges').textContent = stats.total_changes.toLocaleString();
  document.getElementById('resChangeBreakdown').textContent = `Added: ${stats.added_count} | Removed: ${stats.removed_count}`;
  document.getElementById('resPlaceholderCount').textContent = stats.unassigned_count.toLocaleString();

  // Show sections & enable export
  document.getElementById('resultsSummarySection').style.display = 'block';
  const exportBtn = document.getElementById('downloadExcelBtn');
  exportBtn.href = `${API_BASE}/schedule/${data.schedule_id}/export`;
  document.getElementById('exportActionContainer').style.display = 'block';

  // Load first page of classes
  reviewPage = 0;
  fetchReviewClasses();
}

async function fetchReviewClasses() {
  if (!currentScheduleId) return;
  const search = document.getElementById('reviewSearch').value.trim();
  const ctype = document.getElementById('reviewClassType').value;
  const offset = reviewPage * reviewPageSize;

  let url = `${API_BASE}/schedule/${currentScheduleId}/classes?limit=${reviewPageSize}&offset=${offset}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (ctype) url += `&class_type=${encodeURIComponent(ctype)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    renderReviewTable(data.items, data.total, offset);
  } catch (err) {
    console.error('Failed to load review classes', err);
  }
}

function renderReviewTable(items, total, offset) {
  const tbody = document.getElementById('reviewTableBody');
  const pageInfo = document.getElementById('reviewPageInfo');
  const btnPrev = document.getElementById('btnPrevPage');
  const btnNext = document.getElementById('btnNextPage');

  const startIdx = total === 0 ? 0 : offset + 1;
  const endIdx = Math.min(offset + items.length, total);
  pageInfo.textContent = `Showing ${startIdx}–${endIdx} of ${total} classes`;

  btnPrev.disabled = reviewPage === 0;
  btnNext.disabled = endIdx >= total;

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 32px; color: var(--text-muted);">
          No classes match your filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map((c) => {
    let actionBadge = `<span class="badge badge-priority-low">Kept</span>`;
    if (c.action === 'added') {
      actionBadge = `<span class="badge badge-status-active">+ Added</span>`;
    } else if (c.action === 'added_unassigned') {
      actionBadge = `<span class="badge badge-priority-high">Placeholder</span>`;
    }

    return `
      <tr>
        <td style="font-weight: 500;">${escapeHtml(c.time)}</td>
        <td style="color: var(--text-muted);">${escapeHtml(c.end_time)}</td>
        <td>
          <strong>${escapeHtml(c.name)}</strong>
          ${c.hidden === 'Yes' ? '<span class="badge badge-priority-high ml-1">Hidden</span>' : ''}
        </td>
        <td><code>${escapeHtml(c.account)}</code></td>
        <td>${escapeHtml(c.vtc || '-')}</td>
        <td>
          <span class="badge badge-priority-${c.class_type === 'Teens' ? 'medium' : (c.class_type === 'Speak+' ? 'high' : 'low')}">
            ${escapeHtml(c.class_type)}
          </span>
        </td>
        <td>${actionBadge}</td>
      </tr>
    `;
  }).join('');
}


// ==============================================================================
// View 2: Teachers & Qualifications
// ==============================================================================
let currentTeacherFilter = 'all';
let teacherSearchQuery = '';

function setupTeachersView() {
  const searchInput = document.getElementById('teacherSearchInput');
  const filterBtns = document.querySelectorAll('[data-tfilter]');
  const addModal = document.getElementById('teacherModal');
  const btnOpen = document.getElementById('btnOpenAddTeacher');
  const btnClose = document.getElementById('btnCloseTeacherModal');
  const btnCancel = document.getElementById('btnCancelTeacherModal');
  const form = document.getElementById('teacherForm');

  searchInput.addEventListener('input', (e) => {
    teacherSearchQuery = e.target.value.toLowerCase().trim();
    renderTeachersTable();
  });

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentTeacherFilter = btn.dataset.tfilter;
      renderTeachersTable();
    });
  });

  btnOpen.addEventListener('click', () => {
    form.reset();
    document.getElementById('teacherModalTitle').textContent = 'Add New Teacher';
    document.getElementById('tAccount').readOnly = false;
    addModal.classList.add('show');
  });

  const closeTeacherModal = () => addModal.classList.remove('show');
  btnClose.addEventListener('click', closeTeacherModal);
  btnCancel.addEventListener('click', closeTeacherModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      account: document.getElementById('tAccount').value.trim(),
      name: document.getElementById('tName').value.trim(),
      vtc: document.getElementById('tVtc').value.trim(),
      status: document.getElementById('tStatus').value,
      shift_id: document.getElementById('tShift').value,
      fixed_day_off: document.getElementById('tDayOff').value,
      weekend_group: document.getElementById('tWeekendGroup').value,
      teens_qualified: document.getElementById('tTeens').checked,
      speak_plus_qualified: document.getElementById('tSpeakPlus').checked,
    };

    try {
      const res = await fetch(`${API_BASE}/teachers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        closeTeacherModal();
        showToast(`Teacher ${payload.name} saved`);
        fetchTeachers();
      } else {
        const err = await res.json();
        alert(`Error: ${err.detail || 'Could not save teacher'}`);
      }
    } catch (err) {
      alert(`Error saving teacher: ${err.message}`);
    }
  });

  fetchTeachers();
}

async function fetchTeachers() {
  try {
    const res = await fetch(`${API_BASE}/teachers`);
    if (res.ok) {
      teachers = await res.json();
      renderTeachersTable();
      populateTeacherDropdowns();
    }
  } catch (err) {
    console.error('Failed to load teachers', err);
  }
}

function renderTeachersTable() {
  const tbody = document.getElementById('teachersTableBody');
  if (!tbody) return;

  const filtered = teachers.filter((t) => {
    if (currentTeacherFilter === 'teens' && !t.teens_qualified) return false;
    if (currentTeacherFilter === 'speak_plus' && !t.speak_plus_qualified) return false;
    if (currentTeacherFilter === 'active' && t.status !== 'active') return false;

    if (teacherSearchQuery) {
      const nameMatch = (t.name || '').toLowerCase().includes(teacherSearchQuery);
      const accMatch = (t.account || '').toLowerCase().includes(teacherSearchQuery);
      const vtcMatch = (t.vtc || '').toLowerCase().includes(teacherSearchQuery);
      return nameMatch || accMatch || vtcMatch;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 36px; color: var(--text-muted);">
          No teachers found.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((t) => `
    <tr>
      <td><strong>${escapeHtml(t.name)}</strong></td>
      <td><code>${escapeHtml(t.account)}</code></td>
      <td>${escapeHtml(t.vtc || '-')}</td>
      <td><span class="badge badge-priority-low">${escapeHtml(t.shift_id.toUpperCase())}</span></td>
      <td>${escapeHtml(t.fixed_day_off)}</td>
      <td><span class="badge badge-priority-medium">Group ${escapeHtml(t.weekend_group)}</span></td>
      <td>
        <button class="btn btn-sm ${t.teens_qualified ? 'btn-primary' : 'btn-secondary'}"
                onclick="toggleQualification('${t.account}', 'teens_qualified', ${!t.teens_qualified})">
          ${t.teens_qualified ? 'Teens Yes' : 'No'}
        </button>
      </td>
      <td>
        <button class="btn btn-sm ${t.speak_plus_qualified ? 'btn-primary' : 'btn-secondary'}"
                onclick="toggleQualification('${t.account}', 'speak_plus_qualified', ${!t.speak_plus_qualified})">
          ${t.speak_plus_qualified ? 'Speak+ Yes' : 'No'}
        </button>
      </td>
      <td>
        <span class="badge badge-status-${t.status === 'active' ? 'active' : 'paused'}">
          ${escapeHtml(t.status.toUpperCase())}
        </span>
      </td>
      <td>
        <button class="btn btn-sm btn-danger-ghost" onclick="deleteTeacher('${t.account}')" title="Delete Teacher">
          Delete
        </button>
      </td>
    </tr>
  `).join('');
}

window.toggleQualification = async function(account, field, value) {
  try {
    const res = await fetch(`${API_BASE}/teachers/${account}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) {
      showToast('Qualification updated');
      fetchTeachers();
    }
  } catch (err) {
    console.error('Error toggling qualification', err);
  }
};

window.deleteTeacher = async function(account) {
  if (!confirm(`Are you sure you want to delete teacher ${account}?`)) return;
  try {
    const res = await fetch(`${API_BASE}/teachers/${account}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Teacher deleted');
      fetchTeachers();
    }
  } catch (err) {
    console.error('Error deleting teacher', err);
  }
};

function populateTeacherDropdowns() {
  const sel = document.getElementById('adjTeacherSelect');
  if (!sel) return;
  sel.innerHTML = teachers.map((t) => `
    <option value="${t.account}">${escapeHtml(t.name)} (${t.account})</option>
  `).join('');
}


// ==============================================================================
// View 3: Shifts & Off Days
// ==============================================================================
async function fetchShifts() {
  try {
    const res = await fetch(`${API_BASE}/shifts`);
    if (res.ok) {
      const shifts = await res.json();
      renderShiftsCards(shifts);
    }
  } catch (err) {
    console.error('Failed to load shifts', err);
  }
}

function renderShiftsCards(shifts) {
  const grid = document.getElementById('shiftsCardsGrid');
  if (!grid) return;

  grid.innerHTML = shifts.map((s) => `
    <div class="stat-card">
      <div class="stat-header">
        <span class="stat-label">${escapeHtml(s.name)}</span>
        <span class="badge badge-priority-low">${escapeHtml(s.id.toUpperCase())}</span>
      </div>
      <div class="stat-value" style="font-size: 20px; margin-top: 10px;">
        ${escapeHtml(s.start_time)} – ${escapeHtml(s.end_time)}
      </div>
      <span class="stat-sub">${escapeHtml(s.description || 'Configured working window')}</span>
    </div>
  `).join('');
}


// ==============================================================================
// View 4: Schedule Adjustments
// ==============================================================================
function setupAdjustmentsView() {
  const modal = document.getElementById('adjModal');
  const btnOpen = document.getElementById('btnOpenAddAdjustment');
  const btnClose = document.getElementById('btnCloseAdjModal');
  const btnCancel = document.getElementById('btnCancelAdjModal');
  const form = document.getElementById('adjForm');

  btnOpen.addEventListener('click', () => {
    form.reset();
    populateTeacherDropdowns();
    modal.classList.add('show');
  });

  const closeModal = () => modal.classList.remove('show');
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      teacher_account: document.getElementById('adjTeacherSelect').value,
      type: document.getElementById('adjType').value,
      time_value: document.getElementById('adjTimeVal').value.trim(),
      day_of_week: document.getElementById('adjDayOfWeek').value,
      start_date: document.getElementById('adjStartDate').value,
      end_date: document.getElementById('adjEndDate').value,
      reason: document.getElementById('adjReason').value.trim(),
    };

    try {
      const res = await fetch(`${API_BASE}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        closeModal();
        showToast('Adjustment created');
        fetchAdjustments();
      } else {
        alert('Failed to save adjustment');
      }
    } catch (err) {
      alert(`Error saving adjustment: ${err.message}`);
    }
  });

  fetchAdjustments();
}

async function fetchAdjustments() {
  try {
    const res = await fetch(`${API_BASE}/adjustments`);
    if (res.ok) {
      adjustments = await res.json();
      renderAdjustmentsTable();
    }
  } catch (err) {
    console.error('Failed to load adjustments', err);
  }
}

function renderAdjustmentsTable() {
  const tbody = document.getElementById('adjustmentsTableBody');
  if (!tbody) return;

  if (adjustments.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 36px; color: var(--text-muted);">
          No adjustments recorded. Click "Add Adjustment" to configure specific constraints (e.g. childcare, unavailability).
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = adjustments.map((a) => {
    let typeBadge = `<span class="badge badge-priority-medium">${escapeHtml(a.type.replace('_', ' ').toUpperCase())}</span>`;
    return `
      <tr>
        <td><strong>${escapeHtml(a.teacher_name)}</strong><br><small class="text-muted">${escapeHtml(a.teacher_account)}</small></td>
        <td>${typeBadge}</td>
        <td><code>${escapeHtml(a.time_value || 'Full Day')}</code></td>
        <td>${escapeHtml(a.day_of_week)}</td>
        <td>${escapeHtml(a.start_date)} ${a.end_date ? 'to ' + escapeHtml(a.end_date) : '(Ongoing)'}</td>
        <td>${escapeHtml(a.reason || '-')}</td>
        <td>
          <button class="btn btn-sm ${a.is_active ? 'btn-primary' : 'btn-secondary'}" onclick="toggleAdjustment('${a.id}')">
            ${a.is_active ? 'Active' : 'Disabled'}
          </button>
        </td>
        <td>
          <button class="btn btn-sm btn-danger-ghost" onclick="deleteAdjustment('${a.id}')">
            Delete
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.toggleAdjustment = async function(id) {
  try {
    const res = await fetch(`${API_BASE}/adjustments/${id}/toggle`, { method: 'PATCH' });
    if (res.ok) {
      showToast('Adjustment toggled');
      fetchAdjustments();
    }
  } catch (err) {
    console.error('Error toggling adjustment', err);
  }
};

window.deleteAdjustment = async function(id) {
  if (!confirm('Are you sure you want to delete this adjustment?')) return;
  try {
    const res = await fetch(`${API_BASE}/adjustments/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Adjustment deleted');
      fetchAdjustments();
    }
  } catch (err) {
    console.error('Error deleting adjustment', err);
  }
};


// ==============================================================================
// System & Feedback Utilities
// ==============================================================================
function initTheme() {
  const saved = localStorage.getItem('scheduler-theme') || 'light';
  applyTheme(saved);
  themeToggleBtn.addEventListener('click', toggleTheme);
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

function showToast(message) {
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

async function fetchHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      const data = await res.json();
      serverStartedAt = Date.now() - data.uptime_seconds * 1000;
      statusBadgeEl.style.color = 'var(--success)';
      statusBadgeEl.style.backgroundColor = 'var(--success-tint)';
      statusBadgeEl.style.borderColor = 'var(--success-border)';
      statusTextEl.textContent = 'Backend: Connected';
    }
  } catch (err) {
    statusBadgeEl.style.color = 'var(--danger)';
    statusBadgeEl.style.backgroundColor = 'var(--danger-tint)';
    statusBadgeEl.style.borderColor = 'var(--danger-border)';
    statusTextEl.textContent = 'Backend: Disconnected';
  }
}

function renderUptime() {
  // Pure local tick - no network requests
  if (!serverStartedAt) return;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
