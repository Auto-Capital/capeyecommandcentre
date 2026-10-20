// CapEye Auto Capital | Version 1.2 | 24 August 2026 | Build v20260824
// ╔══════════════════════════════════════════════════════════════════╗
// ║         CAPEYE — NOTIFICATION SYSTEM                            ║
// ║  Handles: Email (via EmailJS) + PWA Push Notifications          ║
// ╚══════════════════════════════════════════════════════════════════╝

// ── EMAILJS CONFIG ────────────────────────────────────────────────
// Set these after creating your free EmailJS account
// See NOTIFICATION_SETUP.html for step-by-step instructions
var EMAILJS_SERVICE_ID  = 'service_whqa7ap';  // capeye@autocapital.co.uk via Outlook
var EMAILJS_TEMPLATE_ID = 'd1e8l6s';          // your template ID from EmailJS
var EMAILJS_PUBLIC_KEY  = 'qgmaToXYFDvmgWAJO'; // your EmailJS public key
var EMAILJS_ENABLED = true;  // emails now active

// ── PWA PUSH CONFIG ───────────────────────────────────────────────
// VAPID public key from Firebase Console → Project Settings → Cloud Messaging
var VAPID_PUBLIC_KEY = 'BJH6WXRok-dtL8nMtUsnjrsRpdG6Gk7xqgfAQzgtTJI_r4WyTA2kc3Sqti8KdLWtK5HopjRdereP5yki3iQ3Bgo'; // Firebase Web Push key
var PUSH_ENABLED = true;  // PWA push notifications active

// ── STAFF EMAIL LOOKUP ────────────────────────────────────────────
function getStaffEmail(nameOrDept) {
  if (!nameOrDept) return null;
  // Try exact name match first
  var byName = AC_STAFF.find(function(s) {
    return s.name.toLowerCase() === nameOrDept.toLowerCase();
  });
  if (byName && byName.email) return { name: byName.name, email: byName.email };

  // Try department match — return all staff in that dept.
  // Handles "Valeting Team", "Valeting dept", "Valeting Department".
  var nameClean = nameOrDept.replace(/ team$/i,'').replace(/ dept(artment)?$/i,'').trim();
  var byDept = AC_STAFF.filter(function(s) {
    return s.dept && s.dept.toLowerCase() === nameClean.toLowerCase();
  });
  if (byDept.length) {
    return byDept.map(function(s){ return { name: s.name, email: s.email }; });
  }
  return null;
}

// ── MAIN NOTIFICATION DISPATCHER ──────────────────────────────────
function sendNotification(type, payload) {
  // type: 'handover' | 'urgent' | 'skip' | 'sendback' | 'fault'
  // payload: { toName, vehicle, reg, stage, fromName, note, priority, link }

  var recipients = getStaffEmail(payload.toName);
  if (!recipients) return;
  if (!Array.isArray(recipients)) recipients = [recipients];

  var subject = buildSubject(type, payload);
  var body    = buildEmailBody(type, payload);

  // Send email to each recipient
  recipients.forEach(function(r) {
    if (r.email) {
      sendEmail(r.name, r.email, subject, body, payload);
    }
  });

  // PWA push notification (to current device — broader push needs server)
  sendPushToSelf(subject, buildPushBody(type, payload), payload.link || 'workflow.html');

  // Store in-app notification (always works, no config needed)
  storeInAppNotification(type, payload, recipients);
}

// ── EMAIL BUILDER ─────────────────────────────────────────────────
function buildSubject(type, p) {
  var prefix = p.priority === 'Critical' ? '🔴 CRITICAL' : p.priority === 'Urgent' ? '🟠 URGENT' : '📋';
  if (type === 'handover')  return prefix + ' CapEye — ' + p.reg + ' handed to you (' + p.stage + ')';
  if (type === 'urgent')    return '🔥 CapEye — ' + p.reg + ' marked URGENT';
  if (type === 'skip')      return '⏭ CapEye — ' + p.reg + ' stage skipped to ' + p.stage;
  if (type === 'sendback')  return '↩ CapEye — ' + p.reg + ' sent back to ' + p.stage;
  if (type === 'fault')     return '⚠️ CapEye — New fault logged for ' + p.reg;
  return 'CapEye Notification';
}

function buildPushBody(type, p) {
  if (type === 'handover') return p.reg + ' — ' + p.stage + ' handed over by ' + p.fromName;
  if (type === 'urgent')   return p.reg + ' has been marked URGENT by ' + p.fromName;
  if (type === 'skip')     return p.reg + ' skipped to ' + p.stage;
  if (type === 'sendback') return p.reg + ' sent back to ' + p.stage;
  return p.reg + ' — action required';
}

function buildEmailBody(type, p) {
  var colour = p.priority === 'Critical' ? '#C8102E' : p.priority === 'Urgent' ? '#d4980a' : '#003DA5';
  var actionLine = '';
  if (type === 'handover') actionLine = 'A vehicle has been handed over to you and is ready for your attention.';
  if (type === 'urgent')   actionLine = 'This vehicle has been flagged as URGENT and requires immediate attention.';
  if (type === 'skip')     actionLine = 'A vehicle stage has been skipped and moved to your queue.';
  if (type === 'sendback') actionLine = 'A vehicle has been sent back to an earlier stage.';
  if (type === 'fault')    actionLine = 'A post-sale fault has been logged and assigned to you.';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f0f2f6;font-family:\'Helvetica Neue\',Arial,sans-serif">' +
    '<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)">' +
    // Header
    '<div style="background:#001a4d;padding:24px 32px;display:flex;align-items:center;justify-content:space-between">' +
    '<div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:1px">Cap<span style="color:#C8102E">Eye</span></div>' +
    '<div style="color:rgba(255,255,255,.5);font-size:11px;letter-spacing:2px;text-transform:uppercase">Auto Capital</div>' +
    '</div>' +
    // Priority bar
    '<div style="height:4px;background:' + colour + '"></div>' +
    // Body
    '<div style="padding:32px">' +
    '<p style="font-size:13px;color:#7a8fa6;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;font-weight:700">' + buildSubject(type, p).replace(/^[^ ]+ /,'') + '</p>' +
    '<div style="background:#f0f2f6;border-radius:10px;padding:18px 20px;margin-bottom:20px">' +
    '<div style="display:flex;align-items:center;gap:14px">' +
    '<div style="background:#f5c518;color:#000;padding:4px 12px;border-radius:6px;font-weight:800;font-size:16px;font-family:monospace;letter-spacing:1px">' + (p.reg||'—') + '</div>' +
    '<div><div style="font-weight:700;font-size:15px;color:#0f1923">' + (p.vehicle||'') + '</div>' +
    '<div style="font-size:12px;color:#7a8fa6;margin-top:2px">Stage: ' + (p.stage||'—') + '</div></div>' +
    '</div></div>' +
    '<p style="font-size:14px;color:#3d4d5c;margin-bottom:20px;line-height:1.6">' + actionLine + '</p>' +
    (p.note ? '<div style="background:#fff8e1;border-left:4px solid #d4980a;padding:12px 16px;border-radius:4px;margin-bottom:20px"><p style="font-size:12px;font-weight:700;color:#d4980a;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px">Note from ' + (p.fromName||'Team') + '</p><p style="font-size:13px;color:#5d4037;margin:0">' + p.note + '</p></div>' : '') +
    '<div style="margin-bottom:24px"><p style="font-size:11px;color:#7a8fa6;margin-bottom:2px">From</p><p style="font-size:13px;font-weight:600;color:#0f1923">' + (p.fromName||'CapEye System') + '</p></div>' +
    '<a href="' + (p.link||'https://www.capeye.co.uk/workflow.html') + '" style="display:inline-block;background:#C8102E;color:#fff;padding:13px 28px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none">Open in CapEye →</a>' +
    '</div>' +
    // Footer
    '<div style="background:#f0f2f6;padding:16px 32px;border-top:1px solid #e2e6ed">' +
    '<p style="font-size:11px;color:#7a8fa6;margin:0">CapEye Auto Capital Command Centre · This is an automated notification · <a href="https://www.capeye.co.uk" style="color:#003DA5">www.capeye.co.uk</a></p>' +
    '</div></div></body></html>';
}

// ── EMAILJS SENDER ────────────────────────────────────────────────
function sendEmail(toName, toEmail, subject, htmlBody, payload) {
  if (!EMAILJS_ENABLED) {
    console.log('[CapEye] Email not configured yet — would send to:', toEmail, '|', subject);
    return;
  }
  if (typeof emailjs === 'undefined') {
    console.warn('[CapEye] EmailJS not loaded');
    return;
  }
  emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
    to_name:    toName,
    to_email:   toEmail,
    subject:    subject,
    html_body:  htmlBody,
    reg:        payload.reg        || '',
    vehicle:    payload.vehicle    || '',
    stage:      payload.stage      || '',
    from_name:  payload.fromName   || 'CapEye',
    note:       payload.note       || '',
    priority:   payload.priority   || 'Normal',
    action_url: payload.link       || 'https://www.capeye.co.uk/workflow.html',
  }, EMAILJS_PUBLIC_KEY)
  .then(function() {
    console.log('[CapEye] Email sent to', toEmail);
  })
  .catch(function(err) {
    console.warn('[CapEye] Email failed:', err);
  });
}

// ── PWA PUSH ──────────────────────────────────────────────────────
function requestPushPermission() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (Notification.permission === 'granted') {
    subscribeToPush();
    return;
  }
  if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(function(perm) {
      if (perm === 'granted') subscribeToPush();
    });
  }
}

function subscribeToPush() {
  if (!PUSH_ENABLED) return;
  navigator.serviceWorker.ready.then(function(reg) {
    reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    }).then(function(sub) {
      // Store subscription in Firebase for server-side push
      if (DB) {
        var uid = localStorage.getItem('ce_user_id') || 'unknown';
        DB.ref('push_subscriptions/' + uid).set(JSON.stringify(sub))
          .catch(function(){});
      }
    }).catch(function(e) {
      console.warn('[CapEye] Push subscribe failed:', e);
    });
  });
}

function sendPushToSelf(title, body, url) {
  // Local notification — shows immediately on this device
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  navigator.serviceWorker.ready.then(function(reg) {
    reg.showNotification(title, {
      body: body,
      icon: '/auto-capital-logo.png',
      badge: '/auto-capital-logo.png',
      data: url,
      vibrate: [200, 100, 200],
      tag: 'capeye-' + Date.now()
    });
  }).catch(function(){});
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = window.atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
  return outputArray;
}

// ── IN-APP NOTIFICATION STORE ─────────────────────────────────────
// Always works — no external services needed
// Staff see their notifications when they open the system
function storeInAppNotification(type, payload, recipients) {
  var recipientIds = [];
  var recips = Array.isArray(recipients) ? recipients : [recipients];
  recips.forEach(function(r) {
    var s = AC_STAFF.find(function(x){ return x.name === r.name; });
    if (s) recipientIds.push(s.id);
  });

  var notif = {
    id:        Date.now(),
    type:      type,
    reg:       payload.reg       || '',
    vehicle:   payload.vehicle   || '',
    stage:     payload.stage     || '',
    fromName:  payload.fromName  || '',
    note:      payload.note      || '',
    priority:  payload.priority  || 'Normal',
    link:      payload.link      || 'workflow.html',
    ts:        Date.now(),
    read:      false,
  };

  // Store per recipient — localStorage cache + Firestore
  recipientIds.forEach(function(uid) {
    // localStorage cache
    var key = 'ce_notifs_' + uid;
    var existing = [];
    try { existing = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
    existing.unshift(notif);
    localStorage.setItem(key, JSON.stringify(existing.slice(0, 50)));
    // Firestore (cross-device)
    if (typeof saveNotificationFS === 'function') {
      saveNotificationFS(uid, notif);
    } else if (DB) {
      DB.ref('notifications/' + uid).push(notif).catch(function(){});
    }
  });
}

// ── NOTIFICATION BELL ─────────────────────────────────────────────
// Call this to render unread count badge on the nav bell
function getUnreadCount() {
  var uid = localStorage.getItem('ce_user_id');
  if (!uid) return 0;
  try {
    var notifs = JSON.parse(localStorage.getItem('ce_notifs_' + uid) || '[]');
    return notifs.filter(function(n){ return !n.read; }).length;
  } catch(e) { return 0; }
}

function markAllRead() {
  var uid = localStorage.getItem('ce_user_id');
  if (!uid) return;
  try {
    var notifs = JSON.parse(localStorage.getItem('ce_notifs_' + uid) || '[]');
    notifs.forEach(function(n){ n.read = true; });
    localStorage.setItem('ce_notifs_' + uid, JSON.stringify(notifs));
  } catch(e) {}
}

function getMyNotifications() {
  var uid = localStorage.getItem('ce_user_id');
  if (!uid) return [];
  try { return JSON.parse(localStorage.getItem('ce_notifs_' + uid) || '[]'); } catch(e) { return []; }
}

// ── AUTO-INIT ─────────────────────────────────────────────────────
// Request push permission once user is logged in and page loads
document.addEventListener('DOMContentLoaded', function() {
  var uid = localStorage.getItem('ce_user_id');
  if (uid && uid !== 'unknown') {
    // Small delay so page loads first
    setTimeout(requestPushPermission, 2000);
  }
});
