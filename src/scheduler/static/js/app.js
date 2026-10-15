// Scheduler Desktop Frontend Application Logic

const API_BASE = '/api';

// State
let teachers = [];
let adjustments = [];
let shifts = [];
let shiftRotations = [];
let currentScheduleId = null;
let reviewPage = 0;
const reviewPageSize = 25;
let currentReviewAction = 'all';
let currentReviewSortBy = 'time_asc';

let currentTeacherTab = 'active';
let teacherSearchQuery = '';
let selectedShiftFilter = 'all';

// DOM Elements
const toastContainer = document.getElementById('toastContainer');
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
    formData.append('include_archived', document.getElementById('includeArchivedTeachers').checked ? 'true' : 'false');

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

  // Review Table Action Pills Filtering
  const actionPills = document.querySelectorAll('#reviewActionPills .action-pill');
  actionPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      actionPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      currentReviewAction = pill.dataset.action || 'all';
      reviewPage = 0;
      fetchReviewClasses();
    });
  });

  // Review Table Sort By Selector
  const sortSelect = document.getElementById('reviewSortBy');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      currentReviewSortBy = e.target.value;
      reviewPage = 0;
      fetchReviewClasses();
    });
  }

  // Review Table Search and Class Type Filters
  document.getElementById('reviewSearch').addEventListener('input', () => {
    reviewPage = 0;
    fetchReviewClasses();
  });
  document.getElementById('reviewClassType').addEventListener('change', () => {
    reviewPage = 0;
    fetchReviewClasses();
  });

  // Pagination buttons
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
  document.getElementById('resTotalClasses').textContent = (stats.total_classes || 0).toLocaleString();
  document.getElementById('resClassBreakdown').textContent = `Adults: ${stats.adult_count || 0} | Teens: ${stats.teens_count || 0} | Speak+: ${stats.speak_plus_count || 0}`;
  document.getElementById('resMovedCount').textContent = (stats.moved_count || 0).toLocaleString();
  document.getElementById('resCreatedCount').textContent = (stats.created_count || 0).toLocaleString();
  document.getElementById('resDeletedCount').textContent = (stats.deleted_count || 0).toLocaleString();

  // Update Toolbar Pill Counts
  const totalWithDeleted = (stats.total_classes || 0) + (stats.deleted_count || 0);
  document.getElementById('pillCountAll').textContent = totalWithDeleted.toLocaleString();
  document.getElementById('pillCountMoved').textContent = (stats.moved_count || 0).toLocaleString();
  document.getElementById('pillCountCreated').textContent = (stats.created_count || 0).toLocaleString();
  document.getElementById('pillCountDeleted').textContent = (stats.deleted_count || 0).toLocaleString();
  document.getElementById('pillCountKept').textContent = (stats.kept_count || 0).toLocaleString();

  // Show sections & enable Excel export with Column H
  document.getElementById('resultsSummarySection').style.display = 'block';
  const exportBtn = document.getElementById('btnExportFinalSchedule');
  if (exportBtn) {
    exportBtn.href = `${API_BASE}/schedule/${data.schedule_id}/export`;
  }

  // Reset filter state to all and load review classes
  currentReviewAction = 'all';
  const actionPills = document.querySelectorAll('#reviewActionPills .action-pill');
  actionPills.forEach((p) => p.classList.toggle('active', p.dataset.action === 'all'));

  reviewPage = 0;
  fetchReviewClasses();
}

async function fetchReviewClasses() {
  if (!currentScheduleId) return;
  const search = document.getElementById('reviewSearch').value.trim();
  const ctype = document.getElementById('reviewClassType').value;
  const offset = reviewPage * reviewPageSize;

  let url = `${API_BASE}/schedule/${currentScheduleId}/classes?limit=${reviewPageSize}&offset=${offset}`;
  if (currentReviewAction && currentReviewAction !== 'all') {
    url += `&action=${encodeURIComponent(currentReviewAction)}`;
  }
  if (currentReviewSortBy) {
    url += `&sort_by=${encodeURIComponent(currentReviewSortBy)}`;
  }
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
    let actionBadge = `<span class="badge-action badge-action-kept">Kept</span>`;
    if (c.action === 'moved') {
      actionBadge = `<span class="badge-action badge-action-moved">🔄 Moved</span>`;
    } else if (c.action === 'created') {
      actionBadge = `<span class="badge-action badge-action-created">➕ Created</span>`;
    } else if (c.action === 'deleted') {
      actionBadge = `<span class="badge-action badge-action-deleted">❌ Deleted</span>`;
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
        <td>
          <span class="badge badge-priority-${c.class_type === 'Teens' ? 'medium' : (c.class_type === 'Speak+' ? 'high' : 'low')}">
            ${escapeHtml(c.class_type)}
          </span>
        </td>
        <td>${actionBadge}</td>
        <td style="max-width: 380px;">
          <span style="font-size: 12px; font-weight: 500; color: var(--text-main); line-height: 1.4; display: block;">
            ${escapeHtml(c.comment || '-')}
          </span>
        </td>
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
  const teacherModal = document.getElementById('teacherModal');
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

  // Open Add Teacher Modal
  btnOpen.addEventListener('click', () => {
    form.reset();
    document.getElementById('tIsEdit').value = 'false';
    document.getElementById('teacherModalTitle').textContent = 'Add New Teacher';
    const accInput = document.getElementById('tAccount');
    accInput.readOnly = false;
    accInput.style.backgroundColor = '';
    teacherModal.classList.add('show');
  });

  const closeTeacherModal = () => teacherModal.classList.remove('show');
  btnClose.addEventListener('click', closeTeacherModal);
  btnCancel.addEventListener('click', closeTeacherModal);
  teacherModal.addEventListener('click', (e) => {
    if (e.target === teacherModal) closeTeacherModal();
  });

  // Submit Add / Edit Teacher
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isEdit = document.getElementById('tIsEdit').value === 'true';
    const account = document.getElementById('tAccount').value.trim();

    const payload = {
      name: document.getElementById('tName').value.trim(),
      vtc: document.getElementById('tVtc').value.trim(),
      email: document.getElementById('tEmail').value.trim(),
      status: document.getElementById('tStatus').value,
      shift_id: document.getElementById('tShift').value,
      rotation_id: document.getElementById('tRotation').value,
      fixed_day_off: document.getElementById('tFixedDayOff').value,
      weekend_group: document.getElementById('tWeekendGroup').value,
      teens_qualified: document.getElementById('tTeens').checked,
      speak_plus_qualified: document.getElementById('tSpeakPlus').checked,
    };

    try {
      let res;
      if (isEdit) {
        res = await fetch(`${API_BASE}/teachers/${encodeURIComponent(account)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        payload.account = account;
        res = await fetch(`${API_BASE}/teachers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        closeTeacherModal();
        showToast(`Teacher ${payload.name} saved successfully`);
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
  const activeCount = teachers.filter((t) => t.status === 'active').length;
  const totalCount = teachers.length;
  // Placeholders excluded from teens and speak+ counts
  const teensCount = teachers.filter((t) => t.teens_qualified && t.status !== 'placeholder').length;
  const speakCount = teachers.filter((t) => t.speak_plus_qualified && t.status !== 'placeholder').length;
  const placeholderCount = teachers.filter((t) => t.status === 'placeholder').length;
  const archivedCount = teachers.filter((t) => t.status === 'archived').length;

  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setTxt('countActiveTeachers', activeCount);
  setTxt('countAllTeachers', totalCount);
  setTxt('countTeensTeachers', teensCount);
  setTxt('countSpeakTeachers', speakCount);
  setTxt('countPlaceholders', placeholderCount);
  setTxt('countArchivedTeachers', archivedCount);
}

function updateSkillSectionView() {
  const sec = document.getElementById('quickSkillAddSection');
  const title = document.getElementById('quickSkillTitle');
  const desc = document.getElementById('quickSkillDesc');
  const sel = document.getElementById('quickSkillTeacherSelect');

  if (currentTeacherTab === 'teens') {
    sec.style.display = 'block';
    title.textContent = 'Add Teacher to Teens Qualification List';
    desc.textContent = 'Select any active teacher below to authorize them for 1-hour Teen classes.';
    const candidates = teachers.filter((t) => !t.teens_qualified && t.status === 'active');
    sel.innerHTML = candidates.map((t) => `<option value="${t.account}">${escapeHtml(t.name)} (${t.account})</option>`).join('');
  } else if (currentTeacherTab === 'speak_plus') {
    sec.style.display = 'block';
    title.textContent = 'Add Teacher to Speak+ Qualification List';
    desc.textContent = 'Select any active teacher below to authorize them for 30-minute Speak+ classes.';
    const candidates = teachers.filter((t) => !t.speak_plus_qualified && t.status === 'active');
    sel.innerHTML = candidates.map((t) => `<option value="${t.account}">${escapeHtml(t.name)} (${t.account})</option>`).join('');
  } else {
    sec.style.display = 'none';
  }
}

function renderTeachersTable() {
  const tbody = document.getElementById('teachersTableBody');
  if (!tbody) return;

  const filtered = teachers.filter((t) => {
    if (currentTeacherTab === 'active' && t.status !== 'active') return false;
    if (currentTeacherTab === 'teens' && (!t.teens_qualified || t.status === 'placeholder')) return false;
    if (currentTeacherTab === 'speak_plus' && (!t.speak_plus_qualified || t.status === 'placeholder')) return false;
    if (currentTeacherTab === 'placeholder' && t.status !== 'placeholder') return false;
    if (currentTeacherTab === 'archived' && t.status !== 'archived') return false;

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
    let statusBadge = `<span class="badge badge-status-active">Active</span>`;
    if (t.status === 'archived') {
      statusBadge = `<span class="badge" style="background-color: var(--border-subtle); color: var(--text-muted);">Archived</span>`;
    } else if (t.status === 'placeholder') {
      statusBadge = `<span class="badge badge-priority-medium">Placeholder</span>`;
    }

    const shiftDisplay = (t.shift_id || 'day').replace('_', ' ').toUpperCase();
    const rotDisplay = (t.rotation_id || 'none').toUpperCase();

    return `
      <tr>
        <td><strong>${escapeHtml(t.name)}</strong></td>
        <td><code>${escapeHtml(t.account)}</code></td>
        <td>${escapeHtml(t.vtc || '-')}</td>
        <td>${statusBadge}</td>
        <td><span class="badge badge-priority-low">${escapeHtml(shiftDisplay)}</span></td>
        <td><span class="badge badge-priority-medium">${escapeHtml(rotDisplay)}</span></td>
        <td>${escapeHtml(t.fixed_day_off || 'Thursday')}</td>
        <td><strong>Group ${escapeHtml(t.weekend_group || 'A')}</strong></td>
        <td>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-sm ${t.teens_qualified ? 'btn-primary' : 'btn-secondary'}"
              style="padding: 2px 7px; height: 24px; font-size: 11px;"
              onclick="toggleQualification('${t.account}', 'teens_qualified', ${!t.teens_qualified})">
              Teens: ${t.teens_qualified ? 'Yes' : 'No'}
            </button>
            <button class="btn btn-sm ${t.speak_plus_qualified ? 'btn-primary' : 'btn-secondary'}"
              style="padding: 2px 7px; height: 24px; font-size: 11px;"
              onclick="toggleQualification('${t.account}', 'speak_plus_qualified', ${!t.speak_plus_qualified})">
              Speak+: ${t.speak_plus_qualified ? 'Yes' : 'No'}
            </button>
          </div>
        </td>
        <td style="text-align: right;">
          <button class="btn btn-sm btn-secondary" onclick="openEditTeacherModal('${t.account}')" title="Edit Teacher Rotation, Shift, and Off Days">
            Edit
          </button>
          <button class="btn btn-sm btn-danger-ghost" onclick="deleteTeacher('${t.account}')" title="Delete Teacher">
            Delete
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.openEditTeacherModal = function(account) {
  const t = teachers.find((x) => x.account === account);
  if (!t) return;

  const modal = document.getElementById('teacherModal');
  const form = document.getElementById('teacherForm');
  form.reset();

  document.getElementById('tIsEdit').value = 'true';
  document.getElementById('teacherModalTitle').textContent = `Edit Teacher: ${t.name}`;

  const accInput = document.getElementById('tAccount');
  accInput.value = t.account;
  accInput.readOnly = true;
  accInput.style.backgroundColor = 'var(--border-subtle)';

  document.getElementById('tName').value = t.name || '';
  document.getElementById('tVtc').value = t.vtc || '';
  document.getElementById('tEmail').value = t.email || '';
  document.getElementById('tStatus').value = t.status || 'active';
  document.getElementById('tShift').value = t.shift_id || 'day';
  document.getElementById('tRotation').value = t.rotation_id || 'rot-1';
  document.getElementById('tFixedDayOff').value = t.fixed_day_off || 'Thursday';
  document.getElementById('tWeekendGroup').value = t.weekend_group || 'A';
  document.getElementById('tTeens').checked = !!t.teens_qualified;
  document.getElementById('tSpeakPlus').checked = !!t.speak_plus_qualified;

  modal.classList.add('show');
};

window.toggleQualification = async function(account, field, value) {
  try {
    const res = await fetch(`${API_BASE}/teachers/${encodeURIComponent(account)}`, {
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
    const res = await fetch(`${API_BASE}/teachers/${encodeURIComponent(account)}`, { method: 'DELETE' });
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
  const activeTeachers = teachers.filter((t) => t.status === 'active');
  sel.innerHTML = activeTeachers.map((t) => `
    <option value="${t.account}">${escapeHtml(t.name)} (${t.account} - ${(t.shift_id || 'day').toUpperCase()})</option>
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
      shifts = await shiftsRes.json();
      renderShiftsCards(shifts);
    }
    if (rotsRes.ok) {
      shiftRotations = await rotsRes.json();
      renderRotationsList();
    }
  } catch (err) {
    console.error('Failed to load shifts and rotations', err);
  }
}

function renderShiftsCards(allShifts) {
  const rotatingGrid = document.getElementById('shiftsCardsGrid');
  const nonRotatingGrid = document.getElementById('nonRotatingShiftsGrid');
  if (!rotatingGrid) return;

  const rotatingShifts = allShifts.filter((s) => ['day', 'evening', 'latam'].includes(s.id));
  const nonRotatingShifts = allShifts.filter((s) => !['day', 'evening', 'latam'].includes(s.id));

  // 3 Clickable Rotating Shift KPI Cards
  rotatingGrid.innerHTML = rotatingShifts.map((s) => {
    const isSelected = selectedShiftFilter === s.id;
    const teacherCount = teachers.filter((t) => t.shift_id === s.id && t.status === 'active').length;

    return `
      <div class="stat-card clickable ${isSelected ? 'active' : ''}" onclick="selectShiftCard('${s.id}')">
        <div class="stat-header">
          <span class="stat-label">${escapeHtml(s.name)}</span>
          <button class="btn btn-sm btn-secondary" style="padding: 2px 8px; height: 24px; font-size: 11px;"
            onclick="event.stopPropagation(); openEditShiftModal('${s.id}')">
            Edit Times
          </button>
        </div>
        <div class="stat-value" style="font-size: 22px; margin-top: 8px;">
          ${escapeHtml(s.start_time)} – ${escapeHtml(s.end_time)} CET
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
          <span class="stat-sub">${escapeHtml(s.description || 'Configured shift window')}</span>
          <span class="badge badge-priority-low">${teacherCount} Active Teachers</span>
        </div>
      </div>
    `;
  }).join('');

  // Non-Rotating Shifts
  if (nonRotatingGrid) {
    nonRotatingGrid.innerHTML = nonRotatingShifts.map((s) => {
      const teacherCount = teachers.filter((t) => t.shift_id === s.id && t.status === 'active').length;
      return `
        <div class="stat-card">
          <div class="stat-header">
            <span class="stat-label">${escapeHtml(s.name)}</span>
            <button class="btn btn-sm btn-secondary" style="padding: 2px 8px; height: 24px; font-size: 11px;"
              onclick="openEditShiftModal('${s.id}')">
              Edit
            </button>
          </div>
          <div class="stat-value" style="font-size: 18px; margin-top: 6px;">
            ${escapeHtml(s.start_time)} – ${escapeHtml(s.end_time)} CET
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
            <span class="stat-sub">${escapeHtml(s.description || 'Fixed hours')}</span>
            <span class="badge badge-priority-low">${teacherCount} Teachers</span>
          </div>
        </div>
      `;
    }).join('');
  }
}

window.selectShiftCard = function(shiftId) {
  selectedShiftFilter = shiftId;
  const titleEl = document.getElementById('rotationsListTitle');
  if (titleEl) {
    const sObj = shifts.find((x) => x.id === shiftId);
    titleEl.textContent = sObj ? `${sObj.name} Rotations (2-Week Cycle)` : 'All Shift Rotation Patterns (2-Week Cycle)';
  }
  renderShiftsCards(shifts);
  renderRotationsList();
};

window.filterShiftRotations = function(shiftId) {
  selectShiftCard(shiftId);
};

function renderRotationsList() {
  const container = document.getElementById('rotationsListContainer');
  if (!container) return;

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const fullDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const displayedRotations = selectedShiftFilter === 'all'
    ? shiftRotations
    : shiftRotations.filter((r) => r.shift_id === selectedShiftFilter);

  if (displayedRotations.length === 0) {
    container.innerHTML = `
      <div class="card" style="text-align: center; padding: 32px; color: var(--text-muted);">
        No rotations found for selected shift. Click "Add Rotation Group" to create one.
      </div>
    `;
    return;
  }

  container.innerHTML = displayedRotations.map((r) => {
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
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="text-muted" style="font-size: 12px;">${r.teacher_count || 0} Teachers Assigned</span>
            <button class="btn btn-sm btn-secondary" onclick="openAddRotationModal('${r.id}')">Edit Pattern</button>
          </div>
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

// Edit Shift Modal
window.openEditShiftModal = function(shiftId) {
  const s = shifts.find((x) => x.id === shiftId);
  if (!s) return;

  document.getElementById('editShiftId').value = s.id;
  document.getElementById('editShiftName').value = s.name;
  document.getElementById('editShiftStartTime').value = s.start_time;
  document.getElementById('editShiftEndTime').value = s.end_time;
  document.getElementById('editShiftDesc').value = s.description || '';
  document.getElementById('editShiftModalTitle').textContent = `Edit Shift: ${s.name}`;

  document.getElementById('editShiftModal').classList.add('show');
};

window.closeEditShiftModal = function() {
  document.getElementById('editShiftModal').classList.remove('show');
};

// Form submit for Shift hours
const editShiftForm = document.getElementById('editShiftForm');
if (editShiftForm) {
  editShiftForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editShiftId').value;
    const payload = {
      name: document.getElementById('editShiftName').value.trim(),
      start_time: document.getElementById('editShiftStartTime').value.trim(),
      end_time: document.getElementById('editShiftEndTime').value.trim(),
      description: document.getElementById('editShiftDesc').value.trim(),
    };

    try {
      const res = await fetch(`${API_BASE}/shifts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        closeEditShiftModal();
        showToast('Shift working hours updated');
        fetchShiftsAndRotations();
      } else {
        alert('Failed to update shift');
      }
    } catch (err) {
      alert(`Error updating shift: ${err.message}`);
    }
  });
}

// Rotation Modal Add / Edit
window.openAddRotationModal = function(rotId) {
  const form = document.getElementById('rotationForm');
  form.reset();

  if (rotId) {
    const rot = shiftRotations.find((x) => x.id === rotId);
    if (rot) {
      document.getElementById('rotationModalTitle').textContent = `Edit Rotation: ${rot.name}`;
      document.getElementById('rotName').value = rot.name;
      document.getElementById('rotShift').value = rot.shift_id || 'day';
      document.getElementById('rotDayOff').value = rot.fixed_day_off || 'Thursday';
      document.getElementById('rotWeekendPattern').value = rot.week1_weekend_off ? 'w1_off' : 'w2_off';
      document.getElementById('rotDesc').value = rot.description || '';
      form.dataset.editId = rot.id;
    }
  } else {
    document.getElementById('rotationModalTitle').textContent = 'Add Rotation Group';
    delete form.dataset.editId;
  }

  document.getElementById('rotationModal').classList.add('show');
};

window.closeAddRotationModal = function() {
  document.getElementById('rotationModal').classList.remove('show');
};

const rotForm = document.getElementById('rotationForm');
if (rotForm) {
  rotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isEdit = !!rotForm.dataset.editId;
    const rotId = rotForm.dataset.editId;
    const pattern = document.getElementById('rotWeekendPattern').value;

    const payload = {
      name: document.getElementById('rotName').value.trim(),
      shift_id: document.getElementById('rotShift').value,
      fixed_day_off: document.getElementById('rotDayOff').value,
      week1_weekend_off: pattern === 'w1_off',
      week2_weekend_off: pattern === 'w2_off',
      description: document.getElementById('rotDesc').value.trim(),
    };

    try {
      const url = isEdit ? `${API_BASE}/rotation-groups/${rotId}` : `${API_BASE}/rotation-groups`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        closeAddRotationModal();
        showToast('Rotation group saved');
        fetchShiftsAndRotations();
      } else {
        alert('Failed to save rotation group');
      }
    } catch (err) {
      alert(`Error saving rotation: ${err.message}`);
    }
  });
}


// ==============================================================================
// View 4: Schedule Adjustments
// ==============================================================================
function setupAdjustmentsView() {
  const modal = document.getElementById('adjModal');
  const form = document.getElementById('adjForm');
  const btnOpen = document.getElementById('btnOpenAddAdjustment');

  window.openAdjustmentModal = async function() {
    form.reset();
    if (!teachers || teachers.length === 0) {
      await fetchTeachers();
    }
    populateTeacherDropdowns();

    // Default start date to today
    const today = new Date().toISOString().split('T')[0];
    const startInput = document.getElementById('adjStartDate');
    if (startInput) startInput.value = today;

    modal.classList.add('show');
  };

  window.closeAdjustmentModal = function() {
    modal.classList.remove('show');
  };

  if (btnOpen) {
    btnOpen.addEventListener('click', (e) => {
      e.preventDefault();
      window.openAdjustmentModal();
    });
  }

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
        showToast('Schedule adjustment created');
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
          No adjustments recorded. Click "Add Adjustment" to configure specific constraints (e.g. childcare at 14:00, no classes before 10:00).
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = adjustments.map((a) => {
    let typeBadge = `<span class="badge badge-priority-medium">${escapeHtml(a.type)}</span>`;
    if (a.type === 'block_slot') {
      typeBadge = `<span class="badge badge-priority-high">Blocked Slot</span>`;
    } else if (a.type === 'no_before') {
      typeBadge = `<span class="badge badge-priority-low">No Before</span>`;
    } else if (a.type === 'no_after') {
      typeBadge = `<span class="badge badge-priority-low">No After</span>`;
    } else if (a.type === 'unavailable_day' || a.type === 'full_leave') {
      typeBadge = `<span class="badge badge-priority-high">Full Day Off</span>`;
    }

    const dateRange = a.end_date
      ? `${a.start_date} to ${a.end_date}`
      : `${a.start_date} (Ongoing)`;

    return `
      <tr>
        <td>
          <strong>${escapeHtml(a.teacher_name || a.teacher_account)}</strong>
          <br><small class="text-muted"><code>${escapeHtml(a.teacher_account)}</code></small>
        </td>
        <td>${typeBadge}</td>
        <td><strong>${escapeHtml(a.time_value || '-')}</strong></td>
        <td>${escapeHtml(a.day_of_week === 'all' ? 'All Days' : a.day_of_week)}</td>
        <td style="font-size: 12px;">${escapeHtml(dateRange)}</td>
        <td style="max-width: 200px;">${escapeHtml(a.reason || '-')}</td>
        <td>
          <button class="btn btn-sm ${a.is_active ? 'btn-primary' : 'btn-secondary'}"
            style="padding: 2px 8px; height: 24px; font-size: 11px;"
            onclick="toggleAdjustment('${a.id}')">
            ${a.is_active ? 'Active' : 'Disabled'}
          </button>
        </td>
        <td>
          <button class="btn btn-sm btn-danger-ghost" onclick="deleteAdjustment('${a.id}')" title="Delete Adjustment">
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
      showToast('Adjustment removed');
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
