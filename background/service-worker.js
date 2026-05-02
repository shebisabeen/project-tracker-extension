/**
 * service-worker.js — Project Tracker
 *
 * Responsibilities:
 *  - Listen for messages from the popup to start/stop the badge alarm
 *  - On each alarm tick, read session_start_time from storage and update
 *    the extension badge with the elapsed time (e.g. "1:23")
 *  - On install/startup, re-register the alarm if a tracking session is active
 */

const ALARM_NAME = 'tracker-badge-tick';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

/** Format elapsed ms as a compact badge string: "MM:SS" or "H:MM" */
function formatBadge(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) {
    // Show "H:MM" when over an hour
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  // Show "M:SS" under an hour
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function updateBadge() {
  const data = await storageGet(['session_state', 'session_start_time']);

  if (data.session_state !== 'tracking' || !data.session_start_time) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const elapsed = Date.now() - new Date(data.session_start_time).getTime();
  const label   = formatBadge(elapsed);

  chrome.action.setBadgeText({ text: label });
  chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
}

function startAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 / 60 }); // every ~1 second
}

function stopAlarm() {
  chrome.alarms.clear(ALARM_NAME);
  chrome.action.setBadgeText({ text: '' });
}

// ─── Alarm tick ───────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    updateBadge();
  }
});

// ─── Messages from popup ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'TRACKING_STARTED') {
    startAlarm();
    updateBadge();
    sendResponse({ ok: true });
  } else if (msg.type === 'TRACKING_STOPPED') {
    stopAlarm();
    sendResponse({ ok: true });
  }
  // Return true to keep the message channel open for async responses
  return true;
});

// ─── On install / startup — re-register alarm if session is active ────────────

async function checkAndRestoreAlarm() {
  const data = await storageGet(['session_state']);
  if (data.session_state === 'tracking') {
    startAlarm();
    updateBadge();
  }
}

chrome.runtime.onInstalled.addListener(checkAndRestoreAlarm);
chrome.runtime.onStartup.addListener(checkAndRestoreAlarm);
