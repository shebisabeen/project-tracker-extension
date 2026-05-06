/**
 * popup.js — Project Tracker
 *
 * State machine:
 *   idle  →  tracking  →  stopped  →  idle
 *
 * All session data is persisted to chrome.storage.local so the popup
 * can close and reopen without losing state.
 */

import { api } from '../utils/api.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const viewLogin   = document.getElementById('view-login');
const viewMain    = document.getElementById('view-main');

// Login
const formLogin   = document.getElementById('form-login');
const inputEmail  = document.getElementById('input-email');
const inputPwd    = document.getElementById('input-password');
const loginError  = document.getElementById('login-error');
const btnLogin    = document.getElementById('btn-login');

// Main
const userName        = document.getElementById('user-name');
const btnLogout       = document.getElementById('btn-logout');
const mainError       = document.getElementById('main-error');
const toastSuccess    = document.getElementById('toast-success');
const selectProject   = document.getElementById('select-project');
const timerDisplay    = document.getElementById('timer-display');
const timerValue      = document.getElementById('timer-value');
const durationDisplay = document.getElementById('duration-display');
const durationValue   = document.getElementById('duration-value');
const inputDesc       = document.getElementById('input-description');
const btnStart        = document.getElementById('btn-start');
const btnStop         = document.getElementById('btn-stop');
const btnSubmit       = document.getElementById('btn-submit');
const btnDiscard      = document.getElementById('btn-discard');

// ─── Timer interval handle ───────────────────────────────────────────────────
let timerInterval = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Read one or more keys from chrome.storage.local */
function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

/** Write key/value pairs to chrome.storage.local */
function storageSet(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

/** Remove keys from chrome.storage.local */
function storageRemove(keys) {
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

/** Format a Date as a local ISO string (no UTC conversion): "YYYY-MM-DDTHH:MM:SS" */
function toLocalISOString(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
         `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Format elapsed milliseconds as HH:MM:SS */
function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

/** Show an element (remove hidden class) */
function show(el) { el.classList.remove('hidden'); }

/** Hide an element (add hidden class) */
function hide(el) { el.classList.add('hidden'); }

/** Show inline error */
function showError(el, msg) {
  el.textContent = msg;
  show(el);
}

/** Hide inline error */
function clearError(el) {
  el.textContent = '';
  hide(el);
}

/** Set loading state on a button */
function setLoading(btn, loading) {
  const text    = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  btn.disabled  = loading;
  if (text)    text.classList.toggle('hidden', loading);
  if (spinner) spinner.classList.toggle('hidden', !loading);
}

/** Show a success toast that auto-hides after 3 s */
function showToast() {
  show(toastSuccess);
  setTimeout(() => hide(toastSuccess), 3000);
}

// ─── Session keys ─────────────────────────────────────────────────────────────
const SESSION_KEYS = [
  'session_project_id',
  'session_start_time',
  'session_end_time',
  'session_description',
  'session_state',
];

async function clearSession() {
  await storageRemove(SESSION_KEYS);
}

// ─── View routing ─────────────────────────────────────────────────────────────

function showLoginView() {
  hide(viewMain);
  show(viewLogin);
  inputEmail.value = '';
  inputPwd.value   = '';
  clearError(loginError);
}

async function showMainView(user) {
  hide(viewLogin);
  show(viewMain);

  // Populate user name
  userName.textContent = user?.name ?? user?.email ?? 'User';

  // Load projects
  await loadProjects();

  // Restore session state
  await restoreSession();
}

// ─── Projects ─────────────────────────────────────────────────────────────────

async function loadProjects() {
  selectProject.innerHTML = '<option value="">— Loading… —</option>';
  selectProject.disabled  = true;

  try {
    const projects = await api.getProjects();
    const active   = projects.filter(p => p.status === 'active');

    selectProject.innerHTML = '';

    if (active.length === 0) {
      selectProject.innerHTML = '<option value="">— No active projects —</option>';
      btnStart.disabled = true;
    } else {
      const placeholder = document.createElement('option');
      placeholder.value       = '';
      placeholder.textContent = '— Select a project —';
      selectProject.appendChild(placeholder);

      active.forEach(p => {
        const opt = document.createElement('option');
        opt.value       = p.id;
        opt.textContent = p.name;
        selectProject.appendChild(opt);
      });

      selectProject.disabled = false;
    }
  } catch (err) {
    handleApiError(err, 'Failed to load projects.');
    selectProject.innerHTML = '<option value="">— Error loading projects —</option>';
  }
}

// ─── Session restore ──────────────────────────────────────────────────────────

async function restoreSession() {
  const data = await storageGet(SESSION_KEYS);
  const state = data.session_state ?? 'idle';

  // Restore description
  if (data.session_description) {
    inputDesc.value = data.session_description;
  }

  // Restore selected project
  if (data.session_project_id) {
    selectProject.value = String(data.session_project_id);
  }

  switch (state) {
    case 'tracking':
      applyTrackingUI();
      resumeTimer(data.session_start_time);
      break;
    case 'stopped':
      applyStoppedUI(data.session_start_time, data.session_end_time);
      break;
    default:
      applyIdleUI();
  }
}

// ─── UI state appliers ────────────────────────────────────────────────────────

function applyIdleUI() {
  clearError(mainError);
  hide(timerDisplay);
  hide(durationDisplay);
  hide(btnStop);
  hide(btnSubmit);
  hide(btnDiscard);
  show(btnStart);
  selectProject.disabled  = false;
  inputDesc.disabled      = false;
  btnStart.disabled       = selectProject.value === '';
}

function applyTrackingUI() {
  clearError(mainError);
  hide(btnStart);
  hide(durationDisplay);
  hide(btnSubmit);
  hide(btnDiscard);
  show(timerDisplay);
  show(btnStop);
  selectProject.disabled = true;
  inputDesc.disabled     = false;
}

function applyStoppedUI(startTime, endTime) {
  clearError(mainError);
  hide(btnStart);
  hide(timerDisplay);
  hide(btnStop);
  show(durationDisplay);
  show(btnSubmit);
  show(btnDiscard);
  selectProject.disabled = true;
  inputDesc.disabled     = false;

  if (startTime && endTime) {
    const ms = new Date(endTime) - new Date(startTime);
    durationValue.textContent = formatElapsed(ms);
  }
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer(startTimeISO) {
  stopTimer(); // clear any existing interval
  timerValue.textContent = formatElapsed(Date.now() - new Date(startTimeISO).getTime());
  timerInterval = setInterval(() => {
    timerValue.textContent = formatElapsed(Date.now() - new Date(startTimeISO).getTime());
  }, 1000);
}

function resumeTimer(startTimeISO) {
  if (!startTimeISO) return;
  startTimer(startTimeISO);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ─── Error handling ───────────────────────────────────────────────────────────

function handleApiError(err, fallback = 'An error occurred.') {
  if (err?.status === 401) {
    // Already cleared by api.js; redirect to login
    showLoginView();
    return;
  }
  const msg = err?.message ?? err?.error ?? fallback;
  showError(mainError, msg);
}

// ─── Event: Login ─────────────────────────────────────────────────────────────

formLogin.addEventListener('submit', async e => {
  e.preventDefault();
  clearError(loginError);

  const email    = inputEmail.value.trim();
  const password = inputPwd.value;

  if (!email || !password) {
    showError(loginError, 'Please enter your email and password.');
    return;
  }

  setLoading(btnLogin, true);

  try {
    const data = await api.login(email, password);
    await storageSet({ auth_token: data.token, user: data.user });
    await showMainView(data.user);
  } catch (err) {
    const msg = err?.message ?? 'Invalid credentials. Please try again.';
    showError(loginError, msg);
  } finally {
    setLoading(btnLogin, false);
  }
});

// ─── Event: Logout ────────────────────────────────────────────────────────────

btnLogout.addEventListener('click', async () => {
  btnLogout.disabled = true;
  stopTimer();

  try {
    await api.logout();
  } catch {
    // Ignore logout errors — clear storage regardless
  }

  await chrome.storage.local.clear();
  showLoginView();
  btnLogout.disabled = false;
});

// ─── Event: Project change ────────────────────────────────────────────────────

selectProject.addEventListener('change', async () => {
  const id = selectProject.value;
  btnStart.disabled = id === '';
  if (id) {
    await storageSet({ session_project_id: Number(id) });
  }
});

// ─── Event: Description auto-save ────────────────────────────────────────────

inputDesc.addEventListener('input', async () => {
  await storageSet({ session_description: inputDesc.value });
});

// ─── Event: Start ─────────────────────────────────────────────────────────────

btnStart.addEventListener('click', async () => {
  const projectId = selectProject.value;
  if (!projectId) {
    showError(mainError, 'Please select a project before starting.');
    return;
  }

  const startTime = toLocalISOString();

  await storageSet({
    session_project_id: Number(projectId),
    session_start_time: startTime,
    session_end_time:   null,
    session_description: inputDesc.value,
    session_state:      'tracking',
  });

  // Notify service worker to start badge alarm
  chrome.runtime.sendMessage({ type: 'TRACKING_STARTED', startTime });

  applyTrackingUI();
  startTimer(startTime);
});

// ─── Event: Stop ──────────────────────────────────────────────────────────────

btnStop.addEventListener('click', async () => {
  stopTimer();

  const endTime = toLocalISOString();
  const data    = await storageGet(['session_start_time']);

  await storageSet({
    session_end_time: endTime,
    session_state:    'stopped',
  });

  // Notify service worker to stop badge alarm
  chrome.runtime.sendMessage({ type: 'TRACKING_STOPPED' });

  applyStoppedUI(data.session_start_time, endTime);
});

// ─── Event: Submit ────────────────────────────────────────────────────────────

btnSubmit.addEventListener('click', async () => {
  clearError(mainError);
  setLoading(btnSubmit, true);

  const data = await storageGet([
    'session_project_id',
    'session_start_time',
    'session_end_time',
    'session_description',
  ]);

  if (!data.session_project_id || !data.session_start_time || !data.session_end_time) {
    showError(mainError, 'Session data is incomplete. Please discard and start again.');
    setLoading(btnSubmit, false);
    return;
  }

  try {
    await api.storeTracking({
      project_id:  data.session_project_id,
      start_time:  data.session_start_time,
      end_time:    data.session_end_time,
      description: data.session_description ?? '',
    });

    await clearSession();
    inputDesc.value = '';
    selectProject.value = '';

    applyIdleUI();
    showToast();
  } catch (err) {
    handleApiError(err, 'Failed to submit. Please try again.');
  } finally {
    setLoading(btnSubmit, false);
  }
});

// ─── Event: Discard ───────────────────────────────────────────────────────────

btnDiscard.addEventListener('click', async () => {
  stopTimer();
  await clearSession();

  inputDesc.value     = '';
  selectProject.value = '';

  // Notify service worker
  chrome.runtime.sendMessage({ type: 'TRACKING_STOPPED' });

  applyIdleUI();
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  const data = await storageGet(['auth_token', 'user']);

  if (!data.auth_token) {
    showLoginView();
    return;
  }

  // Token exists — show main view
  await showMainView(data.user);
}

init();
