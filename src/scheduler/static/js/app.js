// Scheduler Desktop Frontend Application Logic

const API_BASE = '/api';

// State
let teachers = [];
let adjustments = [];
let shiftRotations = [];
let currentScheduleId = null;
let reviewPage = 0;
const reviewPageSize = 25;
let serverStartedAt = null;

let currentTeacherTab = 'all';
let teacherSearchQuery = '';

// DOM Elements
const toastContainer = document.getElementById('toastContainer');

// Navigation
const navItems = document.querySelectorAll('.nav-item');
const viewPanels = document.querySelectorAll('.view-panel');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
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
      if (targetViewId === 'shiftsView') fetchShiftsAndRotations();
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
    formData.append('allow_4h_continuous_override', document.getElementById('allow4hContinuousOverride').checked ? 'true' : 'false');

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
          ${c.hidden === 'Yes' ? '<span class="badge badge-priority-high" style="margin-left: 6px;">Hidden</span>' : ''}
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
function setupTeachersView() {
  const searchInput = document.getElementById('teacherSearchInput');
  const filterBtns = document.querySelectorAll('[data-tfilter]');
  const addModal = document.getElementById('teacherModal');
  const btnOpen = document.getElementById('btnOpenAddTeacher');
  const btnClose = document.getElementById('btnCloseTeacherModal');
  const btnCancel = document.getElementById('btnCancelTeacherModal');
  const form = document.getElementById('teacherForm');
  const hubFileInput = document.getElementById('hubTeacherFileInput');
  const btnQuickAddSkill = document.getElementById('btnQuickAddSkill');

  searchInput.addEventListener('input', (e) => {
    teacherSearchQuery = e.target.value.toLowerCase().trim();
    renderTeachersTable();
  });

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentTeacherTab = btn.dataset.tfilter;
      updateSkillSectionView();
      renderTeachersTable();
    });
  });

  // Hub Teacher List Upload
  hubFileInput.addEventListener('change', async () => {
    if (!hubFileInput.files || hubFileInput.files.length === 0) return;
    const file = hubFileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);

    showToast('Uploading teacher list...');
    try {
      const res = await fetch(`${API_BASE}/teachers/upload`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`Imported ${data.imported_count} teachers successfully!`);
        fetchTeachers();
      } else {
        const err = await res.json();
        alert(`Error: ${err.detail || 'Failed to upload teacher list'}`);
      }
    } catch (e) {
      alert(`Error uploading file: ${e.message}`);
    } finally {
      hubFileInput.value = '';
    }
  });

  // Quick Add Teacher to Skill list
  btnQuickAddSkill.addEventListener('click', async () => {
    const sel = document.getElementById('quickSkillTeacherSelect');
    const account = sel.value;
    if (!account) return;

    const field = currentTeacherTab === 'teens' ? 'teens_qualified' : 'speak_plus_qualified';
    await toggleQualification(account, field, true);
    fetchTeachers();
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
      email: document.getElementById('tEmail').value.trim(),
      status: document.getElementById('tStatus').value,
      shift_id: document.getElementById('tShift').value,
      rotation_id: document.getElementById('tRotation').value,
      fixed_day_off: 'Thursday',
      weekend_group: 'A',
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
      updateTeacherCounts();
      updateSkillSectionView();
      renderTeachersTable();
      populateTeacherDropdowns();
    }
  } catch (err) {
    console.error('Failed to load teachers', err);
  }
}

function updateTeacherCounts() {
  const total = teachers.length;
  const teens = teachers.filter((t) => t.teens_qualified).length;
  const speak = teachers.filter((t) => t.speak_plus_qualified).length;

  document.getElementById('countAllTeachers').textContent = total;
  document.getElementById('countTeensTeachers').textContent = teens;
  document.getElementById('countSpeakTeachers').textContent = speak;
}

function updateSkillSectionView() {
  const sec = document.getElementById('quickSkillAddSection');
  const title = document.getElementById('quickSkillTitle');
  const desc = document.getElementById('quickSkillDesc');
  const sel = document.getElementById('quickSkillTeacherSelect');

  if (currentTeacherTab === 'teens') {
    sec.style.display = 'block';
    title.textContent = 'Add Teacher to Teens Qualification List';
    desc.textContent = 'Select any teacher below to authorize them for 1-hour Teen classes.';
    const candidates = teachers.filter((t) => !t.teens_qualified);
    sel.innerHTML = candidates.map((t) => `<option value="${t.account}">${escapeHtml(t.name)} (${t.account})</option>`).join('');
  } else if (currentTeacherTab === 'speak_plus') {
    sec.style.display = 'block';
    title.textContent = 'Add Teacher to Speak+ Qualification List';
    desc.textContent = 'Select any teacher below to authorize them for 30-minute Speak+ classes.';
    const candidates = teachers.filter((t) => !t.speak_plus_qualified);
    sel.innerHTML = candidates.map((t) => `<option value="${t.account}">${escapeHtml(t.name)} (${t.account})</option>`).join('');
  } else {
    sec.style.display = 'none';
  }
}

function renderTeachersTable() {
  const tbody = document.getElementById('teachersTableBody');
  if (!tbody) return;

  const filtered = teachers.filter((t) => {
    if (currentTeacherTab === 'teens' && !t.teens_qualified) return false;
    if (currentTeacherTab === 'speak_plus' && !t.speak_plus_qualified) return false;
    if (currentTeacherTab === 'placeholder' && t.status !== 'placeholder') return false;

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
          No teachers found matching criteria.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((t) => {
    const isTeensTab = currentTeacherTab === 'teens';
    const isSpeakTab = currentTeacherTab === 'speak_plus';

    return `
      <tr>
        <td><strong>${escapeHtml(t.name)}</strong></td>
        <td><code>${escapeHtml(t.account)}</code></td>
        <td>${escapeHtml(t.vtc || '-')}</td>
        <td><span class="badge badge-priority-low">${escapeHtml(t.shift_id.toUpperCase())}</span></td>
        <td><span class="badge badge-priority-medium">${escapeHtml(t.rotation_id ? t.rotation_id.toUpperCase() : 'ROT-1')}</span></td>
        <td>${escapeHtml(t.fixed_day_off || 'Thu')}</td>
        <td>
          ${isTeensTab
            ? `<button class="btn btn-sm btn-danger-ghost" onclick="toggleQualification('${t.account}', 'teens_qualified', false)">Remove</button>`
            : `<button class="btn btn-sm ${t.teens_qualified ? 'btn-primary' : 'btn-secondary'}" onclick="toggleQualification('${t.account}', 'teens_qualified', ${!t.teens_qualified})">${t.teens_qualified ? 'Yes' : 'No'}</button>`
          }
        </td>
        <td>
          ${isSpeakTab
            ? `<button class="btn btn-sm btn-danger-ghost" onclick="toggleQualification('${t.account}', 'speak_plus_qualified', false)">Remove</button>`
            : `<button class="btn btn-sm ${t.speak_plus_qualified ? 'btn-primary' : 'btn-secondary'}" onclick="toggleQualification('${t.account}', 'speak_plus_qualified', ${!t.speak_plus_qualified})">${t.speak_plus_qualified ? 'Yes' : 'No'}</button>`
          }
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
    `;
  }).join('');
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
// View 3: Shifts & Off Days (from Shift Rotation List)
// ==============================================================================
async function fetchShiftsAndRotations() {
  try {
    const [shiftsRes, rotsRes] = await Promise.all([
      fetch(`${API_BASE}/shifts`),
      fetch(`${API_BASE}/rotation-groups`),
    ]);

    if (shiftsRes.ok) {
      const shifts = await shiftsRes.json();
      renderShiftsCards(shifts);
    }
    if (rotsRes.ok) {
      shiftRotations = await rotsRes.json();
      renderRotationsList(shiftRotations);
    }
  } catch (err) {
    console.error('Failed to load shifts and rotations', err);
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
      <span class="stat-sub">${escapeHtml(s.description || 'Configured shift window')}</span>
    </div>
  `).join('');
}

function renderRotationsList(rotations) {
  const container = document.getElementById('rotationsListContainer');
  if (!container) return;

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const fullDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  container.innerHTML = rotations.map((r, idx) => {
    const offDay = r.fixed_day_off || 'Thursday';

    // Week 1 cells
    const w1Cells = days.map((d, i) => {
      const isOff = fullDays[i].toLowerCase() === offDay.toLowerCase() || (r.week1_weekend_off && (d === 'Sat' || d === 'Sun'));
      return `<td class="${isOff ? 'rotation-cell-off' : 'rotation-cell-shifted'}">${isOff ? 'OFF' : 'Shifted'}</td>`;
    }).join('');

    // Week 2 cells
    const w2Cells = days.map((d, i) => {
      const isOff = fullDays[i].toLowerCase() === offDay.toLowerCase() || (r.week2_weekend_off && (d === 'Sat' || d === 'Sun'));
      return `<td class="${isOff ? 'rotation-cell-off' : 'rotation-cell-shifted'}">${isOff ? 'OFF' : 'Shifted'}</td>`;
    }).join('');

    return `
      <div class="rotation-card">
        <div class="rotation-card-header">
          <div>
            <strong style="font-size: 15px;">${escapeHtml(r.name)}</strong>
            <span class="badge badge-priority-low" style="margin-left: 8px;">${escapeHtml((r.shift_id || 'day').toUpperCase())}</span>
            <span class="text-muted" style="font-size: 12px; margin-left: 8px;">Fixed Off: <strong>${escapeHtml(r.fixed_day_off)}</strong></span>
          </div>
          <span class="text-muted" style="font-size: 12px;">${r.teacher_count || 0} Teachers Assigned</span>
        </div>

        <div class="table-responsive">
          <table class="rotation-grid-table">
            <thead>
              <tr>
                <th colspan="7" class="week-header">Week 1</th>
                <th colspan="7" class="week-header">Week 2</th>
                <th rowspan="2" style="background-color: var(--border-subtle); vertical-align: middle;">Cycle</th>
              </tr>
              <tr>
                ${days.map((d) => `<th style="width: 6.5%;">${d}</th>`).join('')}
                ${days.map((d) => `<th style="width: 6.5%;">${d}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              <tr>
                ${w1Cells}
                ${w2Cells}
                <td style="font-size: 11px; color: var(--text-muted); font-weight: 500;">Repeats from Wk 1</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');
}

window.openAddRotationModal = function() {
  document.getElementById('rotationForm').reset();
  document.getElementById('rotationModal').classList.add('show');
};

window.closeAddRotationModal = function() {
  document.getElementById('rotationModal').classList.remove('show');
};


// ==============================================================================
// View 4: Schedule Adjustments
// ==============================================================================
function setupAdjustmentsView() {
  const modal = document.getElementById('adjModal');
  const form = document.getElementById('adjForm');

  // Direct modal opener & closer functions
  window.openAdjustmentModal = function() {
    form.reset();
    populateTeacherDropdowns();
    modal.classList.add('show');
  };

  window.closeAdjustmentModal = function() {
    modal.classList.remove('show');
  };

  modal.addEventListener('click', (e) => {
    if (e.target === modal) window.closeAdjustmentModal();
  });

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
        window.closeAdjustmentModal();
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
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

