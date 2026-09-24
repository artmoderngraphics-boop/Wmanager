// ===== STATE =====
let currentUser = null;
let jobs = [];
let workers = [];
let users = [];
let socket = null;
let currentJobTab = 'new';
let selectedWorkerForLogin = null;

// ===== DEPARTMENTS =====
const DEPARTMENTS = ['Design', 'Laser', 'CNC', 'Plotter', 'Painting', 'LED Work', 'Welding', 'Workshop', 'Fixing', 'Other'];

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('wm_session');
  if (saved) {
    currentUser = JSON.parse(saved);
    initApp();
  } else {
    loadLoginData();
  }
});

// ===== LOGIN FUNCTIONS =====
async function loadLoginData() {
  try {
    const res = await fetch('/api/users');
    const data = await res.json();
    users = data;
    populateUserSelect(data);

    const wRes = await fetch('/api/workers');
    const wData = await wRes.json();
    workers = wData;
    populateWorkerGrid(wData);
  } catch (e) {
    console.error('Error loading login data:', e);
  }
}

function populateUserSelect(usersList) {
  const sel = document.getElementById('userSelect');
  sel.innerHTML = '<option value="">-- Select User --</option>';
  usersList.forEach(u => {
    sel.innerHTML += `<option value="${u.name}">${u.name}</option>`;
  });
}

function populateWorkerGrid(workersList) {
  const grid = document.getElementById('workerGrid');
  if (workersList.length === 0) {
    grid.innerHTML = '<p class="no-workers">No workers added yet. Contact admin.</p>';
    return;
  }
  grid.innerHTML = '';
  workersList.forEach(w => {
    grid.innerHTML += `<button class="worker-grid-btn" onclick="selectWorker('${w.name}', ${w.id})">${w.name}</button>`;
  });
}

function switchLoginTab(tab) {
  document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.login-tab[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.login-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(tab + 'Login').classList.add('active');
  hideLoginError();
}

function selectWorker(name, id) {
  selectedWorkerForLogin = { name, id };
  document.getElementById('workerGrid').style.display = 'none';
  document.getElementById('workerPasswordSection').style.display = 'block';
  document.getElementById('selectedWorkerName').textContent = '👷 ' + name;
  document.getElementById('workerPassword').focus();
}

function cancelWorkerLogin() {
  selectedWorkerForLogin = null;
  document.getElementById('workerGrid').style.display = 'grid';
  document.getElementById('workerPasswordSection').style.display = 'none';
  document.getElementById('workerPassword').value = '';
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideLoginError() {
  document.getElementById('loginError').style.display = 'none';
}

async function adminLogin() {
  const password = document.getElementById('adminPassword').value;
  if (!password) return showLoginError('Please enter password');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', password })
    });

    if (!res.ok) return showLoginError('Invalid admin password');
    const data = await res.json();
    currentUser = data;
    localStorage.setItem('wm_session', JSON.stringify(data));
    initApp();
  } catch (e) {
    showLoginError('Connection error');
  }
}

async function userLogin() {
  const name = document.getElementById('userSelect').value;
  const password = document.getElementById('userPassword').value;
  if (!name || !password) return showLoginError('Please select user and enter password');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', name, password })
    });

    if (!res.ok) return showLoginError('Invalid credentials');
    const data = await res.json();
    currentUser = data;
    localStorage.setItem('wm_session', JSON.stringify(data));
    initApp();
  } catch (e) {
    showLoginError('Connection error');
  }
}

async function workerLogin() {
  if (!selectedWorkerForLogin) return;
  const password = document.getElementById('workerPassword').value;
  if (!password) return showLoginError('Please enter password');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'worker', name: selectedWorkerForLogin.name, password })
    });

    if (!res.ok) return showLoginError('Invalid password');
    const data = await res.json();
    currentUser = data;
    localStorage.setItem('wm_session', JSON.stringify(data));
    initApp();
  } catch (e) {
    showLoginError('Connection error');
  }
}

function logout() {
  currentUser = null;
  localStorage.removeItem('wm_session');
  if (socket) socket.disconnect();
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  // Reset login form
  document.getElementById('adminPassword').value = '';
  document.getElementById('userPassword').value = '';
  document.getElementById('workerPassword').value = '';
  cancelWorkerLogin();
  loadLoginData();
}

// ===== APP INITIALIZATION =====
function initApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';

  // Update nav
  const navUser = document.getElementById('navUserInfo');
  const roleLabel = currentUser.role === 'admin' ? '👑 Admin' : currentUser.role === 'user' ? '👤 ' + currentUser.name : '👷 ' + currentUser.name;
  navUser.textContent = roleLabel;

  // Show/hide buttons based on role
  document.getElementById('settingsBtn').style.display = currentUser.role === 'admin' ? 'inline-block' : 'none';
  document.getElementById('addJobBtn').style.display = (currentUser.role === 'admin' || currentUser.role === 'user') ? 'inline-block' : 'none';
  document.getElementById('notifBtn').style.display = currentUser.role === 'worker' ? 'inline-block' : 'none';

  // Load data
  loadJobs();
  if (currentUser.role === 'admin') {
    loadWorkersForSettings();
    loadUsersForSettings();
  }

  // Load worker notifications
  if (currentUser.role === 'worker') {
    loadWorkerNotifications();
  }

  // Connect Socket.IO
  connectSocket();
}

// ===== SOCKET.IO =====
function connectSocket() {
  socket = io();

  socket.on('new-job', (job) => {
    if (currentUser.role !== 'worker' || (job.workers && job.workers.includes(currentUser.id))) {
      showToast(`🆕 New job: ${job.jobNo}`);
      loadJobs();
    }
  });

  socket.on('job-updated', (job) => {
    loadJobs();
  });

  socket.on('job-deleted', (jobId) => {
    loadJobs();
  });

  socket.on('notification', (data) => {
    if (currentUser.role === 'worker' && data.workerId === currentUser.id) {
      showToast(`🔔 ${data.message}`);
      loadWorkerNotifications();
    }
  });

  socket.on('workers-updated', () => {
    if (currentUser.role === 'admin') loadWorkersForSettings();
  });

  socket.on('users-updated', () => {
    if (currentUser.role === 'admin') loadUsersForSettings();
  });
}

// ===== JOBS =====
async function loadJobs() {
  try {
    const res = await fetch('/api/jobs', {
      headers: { 'x-auth-token': currentUser.token }
    });
    jobs = await res.json();
    updateCounts();
    renderJobs();
  } catch (e) {
    console.error('Error loading jobs:', e);
  }
}

function updateCounts() {
  const newCount = jobs.filter(j => j.status === 'new').length;
  const pendingCount = jobs.filter(j => j.status === 'pending').length;
  const finishedCount = jobs.filter(j => j.status === 'finished').length;

  document.getElementById('newCount').textContent = newCount;
  document.getElementById('pendingCount').textContent = pendingCount;
  document.getElementById('finishedCount').textContent = finishedCount;
}

function switchJobTab(status) {
  currentJobTab = status;
  document.querySelectorAll('.job-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.job-tab[data-status="${status}"]`).classList.add('active');
  renderJobs();
}

function renderJobs() {
  const filtered = jobs.filter(j => j.status === currentJobTab);
  const container = document.getElementById('jobsList');

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No ${currentJobTab} jobs</p></div>`;
    return;
  }

  // Sort by date (newest first)
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  container.innerHTML = filtered.map(job => {
    const progress = getJobProgress(job);
    const workerNames = getWorkerNames(job.workers || []);

    return `
      <div class="job-card status-${job.status}" onclick="showJobDetail(${job.id})">
        <div class="job-card-header">
          <div class="job-card-title">${job.jobNo}</div>
          <span class="job-card-status status-badge-${job.status}">${job.status.toUpperCase()}</span>
        </div>
        <div class="job-card-dates">
          <span>📅 ${formatDate(job.date)}</span>
          <span>🎯 ${formatDate(job.targetDate)}</span>
          <span>📦 ${formatDate(job.deliveryDate)}</span>
        </div>
        <div class="job-card-departments">
          ${(job.departments || []).map(d => `<span class="dept-tag">${d}</span>`).join('')}
        </div>
        <div class="job-card-workers">
          ${workerNames.map(n => `<span class="worker-tag">👷 ${n}</span>`).join('')}
        </div>
        ${job.description ? `<div class="job-card-desc">${job.description}</div>` : ''}
        ${job.workers && job.workers.length > 0 ? `
          <div class="job-card-progress">
            <div class="progress-bar"><div class="progress-fill" style="width: ${progress.percent}%"></div></div>
            <span class="progress-text">${progress.done}/${progress.total} done</span>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function getJobProgress(job) {
  if (!job.workers || job.workers.length === 0) return { done: 0, total: 0, percent: 0 };
  const total = job.workers.length;
  const done = job.workers.filter(wId => {
    const ws = job.workerStatuses[String(wId)];
    return ws && ws.status === 'done';
  }).length;
  return { done, total, percent: Math.round((done / total) * 100) };
}

function getWorkerNames(workerIds) {
  return workerIds.map(id => {
    const w = workers.find(w => w.id === id);
    return w ? w.name : `Worker #${id}`;
  });
}

function getWorkerName(id) {
  const w = workers.find(w => w.id === id);
  return w ? w.name : `Worker #${id}`;
}

// ===== JOB FORM =====
function showJobForm(jobId) {
  if (currentUser.role !== 'admin' && currentUser.role !== 'user') return;

  document.getElementById('jobFormModal').style.display = 'flex';

  // Load workers for checkbox
  const container = document.getElementById('jobWorkersSelect');
  container.innerHTML = workers.map(w =>
    `<label class="checkbox-label"><input type="checkbox" value="${w.id}"> ${w.name} (${w.department || 'N/A'})</label>`
  ).join('');

  if (jobId) {
    // Edit mode
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    document.getElementById('jobFormTitle').textContent = 'Edit Job';
    document.getElementById('editJobId').value = jobId;
    document.getElementById('jobNo').value = job.jobNo;
    document.getElementById('jobDate').value = job.date;
    document.getElementById('jobTargetDate').value = job.targetDate;
    document.getElementById('jobDeliveryDate').value = job.deliveryDate;
    document.getElementById('jobDescription').value = job.description;

    // Check assigned workers
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (job.workers.includes(parseInt(cb.value))) cb.checked = true;
    });

    // Check departments
    document.querySelectorAll('.departments-group input[type="checkbox"]').forEach(cb => {
      cb.checked = (job.departments || []).includes(cb.value);
    });
  } else {
    // Add mode
    document.getElementById('jobFormTitle').textContent = 'Add New Job';
    document.getElementById('editJobId').value = '';
    document.getElementById('jobNo').value = '';
    document.getElementById('jobDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('jobTargetDate').value = '';
    document.getElementById('jobDeliveryDate').value = '';
    document.getElementById('jobDescription').value = '';
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('.departments-group input[type="checkbox"]').forEach(cb => cb.checked = false);
  }
}

function closeJobForm() {
  document.getElementById('jobFormModal').style.display = 'none';
}

async function saveJob() {
  const editId = document.getElementById('editJobId').value;
  const jobNo = document.getElementById('jobNo').value.trim();
  const date = document.getElementById('jobDate').value;
  const targetDate = document.getElementById('jobTargetDate').value;
  const deliveryDate = document.getElementById('jobDeliveryDate').value;
  const description = document.getElementById('jobDescription').value.trim();

  // Get selected workers
  const selectedWorkers = [];
  document.querySelectorAll('#jobWorkersSelect input[type="checkbox"]:checked').forEach(cb => {
    selectedWorkers.push(parseInt(cb.value));
  });

  // Get selected departments
  const selectedDepts = [];
  document.querySelectorAll('.departments-group input[type="checkbox"]:checked').forEach(cb => {
    selectedDepts.push(cb.value);
  });

  if (!jobNo) return showToast('❌ Please enter Job No');
  if (!date) return showToast('❌ Please select Date');
  if (selectedWorkers.length === 0) return showToast('❌ Please assign at least one worker');
  if (selectedDepts.length === 0) return showToast('❌ Please select at least one department');

  const jobData = {
    jobNo,
    date,
    targetDate,
    deliveryDate,
    workers: selectedWorkers,
    departments: selectedDepts,
    description,
    createdBy: currentUser.name
  };

  try {
    if (editId) {
      await fetch(`/api/jobs/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
        body: JSON.stringify(jobData)
      });
      showToast('✅ Job updated successfully');
    } else {
      await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
        body: JSON.stringify(jobData)
      });
      showToast('✅ Job created successfully');
    }
    closeJobForm();
    loadJobs();
  } catch (e) {
    showToast('❌ Error saving job');
  }
}

// ===== JOB DETAIL =====
function showJobDetail(jobId) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;

  const modal = document.getElementById('jobDetailModal');
  modal.style.display = 'flex';
  document.getElementById('jobDetailTitle').textContent = job.jobNo + ' - Details';

  const progress = getJobProgress(job);
  const canEdit = currentUser.role === 'admin' || currentUser.role === 'user';
  const isWorker = currentUser.role === 'worker';
  const isAssigned = isWorker && job.workers && job.workers.includes(currentUser.id);

  let workerStatusesHtml = '';
  if (job.workers && job.workers.length > 0) {
    workerStatusesHtml = '<h4 style="margin-bottom:12px;">👷 Worker Status</h4>';
    job.workers.forEach(wId => {
      const ws = job.workerStatuses[String(wId)] || { status: 'pending', days: 0, explanation: '' };
      const name = getWorkerName(wId);
      const badgeClass = ws.status === 'done' ? 'badge-done' : ws.status === 'need' ? 'badge-need' : 'badge-pending';
      const statusText = ws.status === 'done' ? '✅ Done' : ws.status === 'need' ? `⏰ Need ${ws.days} days` : '⏳ Pending';

      let actionsHtml = '';
      if (isWorker && isAssigned && wId === currentUser.id) {
        actionsHtml = `
          <div class="worker-status-actions">
            <button class="btn btn-success btn-sm" onclick="updateMyStatus(${job.id}, 'done')">✅ Done</button>
            <button class="btn btn-warning btn-sm" onclick="updateMyStatus(${job.id}, 'pending')">⏳ Pending</button>
            <button class="btn btn-sm" style="background:#8b5cf6;color:white;" onclick="showNeedDaysForm(${job.id})">⏰ Need Days</button>
          </div>
          <div id="needDaysForm-${job.id}" style="display:none;" class="worker-update-form">
            <div class="form-group">
              <label>How many days needed?</label>
              <div class="need-days-input">
                <input type="number" id="needDays-${job.id}" min="1" value="1" placeholder="Days">
                <span>days</span>
              </div>
            </div>
            <div class="form-group">
              <label>Explain (Reason)</label>
              <textarea id="needExplain-${job.id}" rows="2" placeholder="Explain why you need more days..."></textarea>
            </div>
            <button class="btn btn-primary btn-sm" onclick="submitNeedDays(${job.id})">Submit</button>
          </div>
          <div class="form-group" style="margin-top:10px;">
            <label>📝 Explain (Optional)</label>
            <div style="display:flex;gap:8px;">
              <input type="text" id="explainInput-${job.id}" placeholder="Add explanation..." style="flex:1;padding:8px;border:2px solid var(--border);border-radius:6px;">
              <button class="btn btn-primary btn-sm" onclick="submitExplanation(${job.id})">Save</button>
            </div>
          </div>
        `;
      }

      workerStatusesHtml += `
        <div class="worker-status-card">
          <div class="worker-status-header">
            <span class="worker-status-name">👷 ${name}</span>
            <span class="worker-status-badge ${badgeClass}">${statusText}</span>
          </div>
          ${ws.explanation ? `<div class="status-explanation">💬 ${ws.explanation}</div>` : ''}
          ${ws.updatedAt ? `<div style="font-size:11px;color:var(--text-light);margin-top:4px;">Updated: ${new Date(ws.updatedAt).toLocaleString()}</div>` : ''}
          ${actionsHtml}
        </div>
      `;
    });
  }

  let adminActionsHtml = '';
  if (canEdit) {
    adminActionsHtml = `
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="closeJobDetail();showJobForm(${job.id})">✏️ Edit Job</button>
        <button class="btn btn-danger" onclick="deleteJob(${job.id})">🗑️ Delete Job</button>
        ${job.status !== 'new' ? `<button class="btn btn-secondary" onclick="moveJob(${job.id},'new')">↩️ Move to New</button>` : ''}
        ${job.status !== 'pending' ? `<button class="btn btn-warning" onclick="moveJob(${job.id},'pending')">⏳ Move to Pending</button>` : ''}
        ${job.status !== 'finished' ? `<button class="btn btn-success" onclick="moveJob(${job.id},'finished')">✅ Move to Finished</button>` : ''}
      </div>
    `;
  }

  document.getElementById('jobDetailBody').innerHTML = `
    <div class="detail-section">
      <h4>📅 Dates</h4>
      <div class="detail-dates">
        <div class="detail-date-item">
          <label>Created Date</label>
          <span>${formatDate(job.date)}</span>
        </div>
        <div class="detail-date-item">
          <label>Target Date</label>
          <span>${formatDate(job.targetDate)}</span>
        </div>
        <div class="detail-date-item">
          <label>Delivery Date</label>
          <span>${formatDate(job.deliveryDate)}</span>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h4>🏢 Departments</h4>
      <div class="job-card-departments">
        ${(job.departments || []).map(d => `<span class="dept-tag">${d}</span>`).join('')}
      </div>
    </div>

    <div class="detail-section">
      <h4>📝 Description</h4>
      <div class="detail-description">${job.description || 'No description provided'}</div>
    </div>

    ${job.workers && job.workers.length > 0 ? `
      <div class="detail-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h4 style="margin:0;">👷 Workers Progress</h4>
          <span style="font-size:13px;color:var(--text-light);">${progress.done}/${progress.total} completed (${progress.percent}%)</span>
        </div>
        <div class="progress-bar" style="height:8px;margin-bottom:16px;">
          <div class="progress-fill" style="width:${progress.percent}%"></div>
        </div>
        ${workerStatusesHtml}
      </div>
    ` : ''}

    ${job.createdAt ? `<div style="font-size:12px;color:var(--text-light);margin-top:16px;">Created by ${job.createdBy || 'Unknown'} on ${new Date(job.createdAt).toLocaleString()}</div>` : ''}
    
    ${adminActionsHtml}
  `;
}

function closeJobDetail() {
  document.getElementById('jobDetailModal').style.display = 'none';
}

async function updateMyStatus(jobId, status) {
  let days = 0;
  let explanation = '';

  if (status === 'done') {
    const explainInput = document.getElementById(`explainInput-${jobId}`);
    explanation = explainInput ? explainInput.value : '';
  }

  try {
    await fetch(`/api/jobs/${jobId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
      body: JSON.stringify({ workerId: currentUser.id, status, days, explanation })
    });
    showToast(`✅ Status updated: ${status}`);
    loadJobs();
    showJobDetail(jobId);
  } catch (e) {
    showToast('❌ Error updating status');
  }
}

function showNeedDaysForm(jobId) {
  document.getElementById(`needDaysForm-${jobId}`).style.display = 'block';
}

async function submitNeedDays(jobId) {
  const days = parseInt(document.getElementById(`needDays-${jobId}`).value) || 1;
  const explanation = document.getElementById(`needExplain-${jobId}`).value;

  try {
    await fetch(`/api/jobs/${jobId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
      body: JSON.stringify({ workerId: currentUser.id, status: 'need', days, explanation })
    });
    showToast(`⏰ Updated: Need ${days} days`);
    loadJobs();
    showJobDetail(jobId);
  } catch (e) {
    showToast('❌ Error updating status');
  }
}

async function submitExplanation(jobId) {
  const input = document.getElementById(`explainInput-${jobId}`);
  if (!input) return;
  const explanation = input.value;

  try {
    // Get current worker status
    const job = jobs.find(j => j.id === jobId);
    const ws = job.workerStatuses[String(currentUser.id)] || { status: 'pending', days: 0 };

    await fetch(`/api/jobs/${jobId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
      body: JSON.stringify({ workerId: currentUser.id, status: ws.status, days: ws.days, explanation })
    });
    showToast('📝 Explanation saved');
    loadJobs();
    showJobDetail(jobId);
  } catch (e) {
    showToast('❌ Error saving explanation');
  }
}

async function deleteJob(jobId) {
  if (!confirm('Are you sure you want to delete this job?')) return;

  try {
    await fetch(`/api/jobs/${jobId}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': currentUser.token }
    });
    showToast('🗑️ Job deleted');
    closeJobDetail();
    loadJobs();
  } catch (e) {
    showToast('❌ Error deleting job');
  }
}

async function moveJob(jobId, status) {
  try {
    await fetch(`/api/jobs/${jobId}/move`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
      body: JSON.stringify({ status })
    });
    showToast(`📋 Job moved to ${status}`);
    closeJobDetail();
    loadJobs();
  } catch (e) {
    showToast('❌ Error moving job');
  }
}

// ===== NOTIFICATIONS =====
async function loadWorkerNotifications() {
  if (currentUser.role !== 'worker') return;

  try {
    const res = await fetch(`/api/notifications/${currentUser.id}`);
    const notifs = await res.json();
    const badge = document.getElementById('notifBadge');
    if (notifs.length > 0) {
      badge.textContent = notifs.length;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  } catch (e) {
    console.error('Error loading notifications:', e);
  }
}

function showNotifications() {
  const panel = document.getElementById('notificationsPanel');
  if (panel.style.display === 'none' || !panel.style.display) {
    panel.style.display = 'block';
    loadNotificationsList();
    // Mark as read
    fetch(`/api/notifications/${currentUser.id}/read`, { method: 'PUT' });
    document.getElementById('notifBadge').style.display = 'none';
  } else {
    panel.style.display = 'none';
  }
}

async function loadNotificationsList() {
  try {
    const res = await fetch(`/api/notifications/${currentUser.id}`);
    const notifs = await res.json();
    const container = document.getElementById('notificationsList');

    if (notifs.length === 0) {
      container.innerHTML = '<div class="notif-empty">No new notifications</div>';
      return;
    }

    container.innerHTML = notifs.map(n => `
      <div class="notif-item">
        <div>${n.message}</div>
        <div class="notif-time">${new Date(n.createdAt).toLocaleString()}</div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Error loading notifications:', e);
  }
}

function closeNotifications() {
  document.getElementById('notificationsPanel').style.display = 'none';
}

// ===== SETTINGS =====
function showSettings() {
  if (currentUser.role !== 'admin') return;
  document.getElementById('dashboardView').style.display = 'none';
  document.getElementById('settingsView').style.display = 'block';
  document.getElementById('settingsBtn').textContent = '📋 Dashboard';
  document.getElementById('settingsBtn').onclick = showDashboard;
  document.getElementById('dashboardBtn').style.display = 'none';
  loadWorkersForSettings();
  loadUsersForSettings();
}

function showDashboard() {
  document.getElementById('dashboardView').style.display = 'block';
  document.getElementById('settingsView').style.display = 'none';
  if (currentUser.role === 'admin') {
    document.getElementById('settingsBtn').textContent = '⚙️ Settings';
    document.getElementById('settingsBtn').onclick = showSettings;
  }
  document.getElementById('dashboardBtn').style.display = 'inline-block';
  loadJobs();
}

function switchSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(tab + 'Settings').classList.add('active');
}

// ===== WORKERS MANAGEMENT =====
async function loadWorkersForSettings() {
  try {
    const res = await fetch('/api/workers/all');
    workers = await res.json();
    renderWorkersList();
  } catch (e) {
    console.error('Error loading workers:', e);
  }
}

function renderWorkersList() {
  const container = document.getElementById('workersList');
  if (workers.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No workers added yet</p></div>';
    return;
  }

  container.innerHTML = workers.map(w => `
    <div class="worker-item">
      <div class="worker-item-info">
        <div class="worker-item-name">👷 ${w.name}</div>
        <div class="worker-item-dept">🏢 ${w.department || 'Not assigned'} | 🔑 ${w.password}</div>
      </div>
      <div class="item-actions">
        <button class="btn btn-primary btn-sm" onclick="editWorker(${w.id})">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteWorker(${w.id})">🗑️</button>
      </div>
    </div>
  `).join('');
}

function showWorkerForm() {
  document.getElementById('workerFormModal').style.display = 'flex';
  document.getElementById('workerFormTitle').textContent = 'Add Worker';
  document.getElementById('editWorkerId').value = '';
  document.getElementById('workerName').value = '';
  document.getElementById('workerPasswordAdmin').value = '';
  document.getElementById('workerDepartment').value = '';
}

function editWorker(id) {
  const w = workers.find(w => w.id === id);
  if (!w) return;
  document.getElementById('workerFormModal').style.display = 'flex';
  document.getElementById('workerFormTitle').textContent = 'Edit Worker';
  document.getElementById('editWorkerId').value = id;
  document.getElementById('workerName').value = w.name;
  document.getElementById('workerPasswordAdmin').value = w.password;
  document.getElementById('workerDepartment').value = w.department || '';
}

function closeWorkerForm() {
  document.getElementById('workerFormModal').style.display = 'none';
}

async function saveWorker() {
  const editId = document.getElementById('editWorkerId').value;
  const name = document.getElementById('workerName').value.trim();
  const password = document.getElementById('workerPasswordAdmin').value.trim();
  const department = document.getElementById('workerDepartment').value;

  if (!name) return showToast('❌ Please enter worker name');
  if (!password) return showToast('❌ Please set a password');
  if (!department) return showToast('❌ Please select department');

  const data = { name, password, department };

  try {
    if (editId) {
      await fetch(`/api/workers/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
        body: JSON.stringify(data)
      });
      showToast('✅ Worker updated');
    } else {
      await fetch('/api/workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
        body: JSON.stringify(data)
      });
      showToast('✅ Worker added');
    }
    closeWorkerForm();
    loadWorkersForSettings();
  } catch (e) {
    showToast('❌ Error saving worker');
  }
}

async function deleteWorker(id) {
  if (!confirm('Are you sure you want to delete this worker?')) return;

  try {
    await fetch(`/api/workers/${id}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': currentUser.token }
    });
    showToast('🗑️ Worker deleted');
    loadWorkersForSettings();
  } catch (e) {
    showToast('❌ Error deleting worker');
  }
}

// ===== USERS MANAGEMENT =====
async function loadUsersForSettings() {
  try {
    const res = await fetch('/api/users');
    users = await res.json();
    renderUsersList();
  } catch (e) {
    console.error('Error loading users:', e);
  }
}

function renderUsersList() {
  const container = document.getElementById('usersList');
  container.innerHTML = users.map(u => `
    <div class="user-item">
      <div class="user-item-info">
        <div class="user-item-name">👤 ${u.name}</div>
        <div class="worker-item-dept">🔑 ${u.password}</div>
      </div>
      <div class="item-actions">
        <button class="btn btn-primary btn-sm" onclick="editUser(${u.id})">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">🗑️</button>
      </div>
    </div>
  `).join('');
}

function showUserForm() {
  document.getElementById('userFormModal').style.display = 'flex';
  document.getElementById('userFormTitle').textContent = 'Add User';
  document.getElementById('editUserId').value = '';
  document.getElementById('userName').value = '';
  document.getElementById('userPasswordAdmin').value = '';
}

function editUser(id) {
  const u = users.find(u => u.id === id);
  if (!u) return;
  document.getElementById('userFormModal').style.display = 'flex';
  document.getElementById('userFormTitle').textContent = 'Edit User';
  document.getElementById('editUserId').value = id;
  document.getElementById('userName').value = u.name;
  document.getElementById('userPasswordAdmin').value = u.password;
}

function closeUserForm() {
  document.getElementById('userFormModal').style.display = 'none';
}

async function saveUser() {
  const editId = document.getElementById('editUserId').value;
  const name = document.getElementById('userName').value.trim();
  const password = document.getElementById('userPasswordAdmin').value.trim();

  if (!name) return showToast('❌ Please enter user name');
  if (!password) return showToast('❌ Please set a password');

  const data = { name, password };

  try {
    if (editId) {
      await fetch(`/api/users/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
        body: JSON.stringify(data)
      });
      showToast('✅ User updated');
    } else {
      await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
        body: JSON.stringify(data)
      });
      showToast('✅ User added');
    }
    closeUserForm();
    loadUsersForSettings();
  } catch (e) {
    showToast('❌ Error saving user');
  }
}

async function deleteUser(id) {
  if (!confirm('Are you sure you want to delete this user?')) return;

  try {
    await fetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': currentUser.token }
    });
    showToast('🗑️ User deleted');
    loadUsersForSettings();
  } catch (e) {
    showToast('❌ Error deleting user');
  }
}

// ===== ADMIN PASSWORD =====
async function changeAdminPassword() {
  const newPass = document.getElementById('newAdminPassword').value;
  const confirmPass = document.getElementById('confirmAdminPassword').value;

  if (!newPass) return showToast('❌ Please enter new password');
  if (newPass !== confirmPass) return showToast('❌ Passwords do not match');
  if (newPass.length < 4) return showToast('❌ Password must be at least 4 characters');

  try {
    await fetch('/api/settings/admin-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': currentUser.token },
      body: JSON.stringify({ password: newPass })
    });
    showToast('✅ Admin password updated');
    document.getElementById('newAdminPassword').value = '';
    document.getElementById('confirmAdminPassword').value = '';
  } catch (e) {
    showToast('❌ Error updating password');
  }
}

// ===== UTILITIES =====
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastMessage').textContent = message;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3000);
}
