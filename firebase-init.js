// CapEye Auto Capital | Version 1.2 | 24 August 2026 | Build v20260824
// ╔══════════════════════════════════════════════════════════════════╗
// ║  CAPEYE — FIREBASE INIT + FIRESTORE SYNC                        ║
// ║  Project: capeye-autocapital                                     ║
// ║  All data synced to Firestore — localStorage used as cache only  ║
// ╚══════════════════════════════════════════════════════════════════╝

var _firebaseApp, DB, AUTH, STORE, FS;

// IMPORTANT: each Firebase service is initialised INDEPENDENTLY and guarded.
// The staff app does NOT load the Realtime Database SDK, so firebase.database()
// throws there — previously that crashed the whole init and left FS undefined
// (the "no-firebase" banner). Now one missing SDK can't break the others.
try { _firebaseApp = firebase.initializeApp(FIREBASE_CONFIG); }
catch(e){ try { _firebaseApp = firebase.app(); } catch(e2){ console.warn('[CapEye] firebase app init failed', e2); } }

try { AUTH  = (firebase.auth)      ? firebase.auth()      : null; } catch(e){ AUTH=null;  console.warn('[CapEye] auth unavailable', e); }
try { FS    = (firebase.firestore) ? firebase.firestore() : null; } catch(e){ FS=null;    console.warn('[CapEye] firestore unavailable', e); }
try { STORE = (firebase.storage)   ? firebase.storage()   : null; } catch(e){ STORE=null; }
try { DB    = (firebase.database)  ? firebase.database()   : null; } catch(e){ DB=null; }   // optional — app doesn't load this SDK

// Firestore offline persistence (best-effort; never fatal).
if (FS) {
  try {
    FS.enablePersistence({ synchronizeTabs: true }).catch(function(err) {
      if (err && err.code === 'failed-precondition') { console.log('[CapEye] Firestore persistence: multiple tabs open'); }
      else if (err && err.code === 'unimplemented') { console.log('[CapEye] Firestore persistence not available'); }
    });
  } catch(e){}
}

// PWA service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function(){});
}

// ── SESSION ──────────────────────────────────────────────────────────
var SESSION_TTL = 12 * 60 * 60 * 1000;

function isSessionValid() {
  var ts = parseInt(localStorage.getItem('ce_auth_ts') || '0');
  return ts && (Date.now() - ts) < SESSION_TTL;
}

function getCurrentUser() {
  if (isSessionValid()) {
    var id = localStorage.getItem('ce_user_id') || 'keith';
    var staffMatch = AC_STAFF.find(function(s){ return s.id === id; });
    return staffMatch || {
      id: id,
      name: localStorage.getItem('ce_user_name') || 'Unknown',
      dept: localStorage.getItem('ce_user_dept') || 'Management',
      canSeePurchasePrice: localStorage.getItem('ce_user_price') === '1',
      canSkipStages:       localStorage.getItem('ce_user_mgr')   === '1',
      canSendBack:         localStorage.getItem('ce_user_mgr')   === '1',
      admin:               localStorage.getItem('ce_user_admin') === '1',
    };
  }
  return AC_STAFF.find(function(s){ return s.id === 'keith'; }) || AC_STAFF[2];
}

function canSeePurchasePrice() {
  var u = getCurrentUser();
  if (u.dept === 'Workshop' || u.dept === 'Checklist') return false;
  return !!u.canSeePurchasePrice;
}
function isManager() {
  var u = getCurrentUser();
  return !!(u.canSkipStages || u.canSendBack || u.dept === 'Management');
}
function isAdmin() { return !!getCurrentUser().admin; }

function doLogout() {
  ['ce_user_id','ce_user_name','ce_user_dept','ce_user_email',
   'ce_user_admin','ce_user_price','ce_user_mgr','ce_auth_ts'].forEach(function(k){
    localStorage.removeItem(k);
  });
  if (AUTH) AUTH.signOut().catch(function(){});
  window.location.href = 'login.html';
}

// ══════════════════════════════════════════════════════════════════════
// FIRESTORE HELPERS — all data reads/writes go through these
// ══════════════════════════════════════════════════════════════════════

// ── WORKFLOW ──────────────────────────────────────────────────────────
function getWorkflow(stockNo, callback) {
  // Returns workflow data — callback(data) pattern for async
  // Also returns cached data immediately from localStorage
  var cached = {};
  try { cached = JSON.parse(localStorage.getItem('ac_wf_'+stockNo)||'{}'); } catch(e){}

  if (!FS) { if (callback) callback(cached); return cached; }

  // Fetch from Firestore
  FS.collection('workflows').doc(String(stockNo)).get()
    .then(function(doc) {
      var data = doc.exists ? doc.data() : {};
      // Merge with local cache (local may have newer unsaved data)
      var merged = Object.assign({}, data, cached);
      // Update local cache
      localStorage.setItem('ac_wf_'+stockNo, JSON.stringify(merged));
      if (callback) callback(merged);
    })
    .catch(function(err) {
      console.warn('[CapEye] Firestore getWorkflow error:', err);
      if (callback) callback(cached);
    });

  return cached; // return cached immediately for sync callers
}

function saveWorkflow(stockNo, data) {
  // Save to localStorage immediately (fast)
  localStorage.setItem('ac_wf_'+stockNo, JSON.stringify(data));
  // Then sync to Firestore
  if (!FS) return;
  FS.collection('workflows').doc(String(stockNo)).set(data, { merge: true })
    .catch(function(err) {
      console.warn('[CapEye] Firestore saveWorkflow error:', err);
    });
}

// Subscribe to real-time workflow updates for a vehicle
function subscribeWorkflow(stockNo, callback) {
  if (!FS) return function(){};
  return FS.collection('workflows').doc(String(stockNo))
    .onSnapshot(function(doc) {
      if (doc.exists) {
        var data = doc.data();
        localStorage.setItem('ac_wf_'+stockNo, JSON.stringify(data));
        callback(data);
      }
    }, function(err) {
      console.warn('[CapEye] Firestore subscribeWorkflow error:', err);
    });
}

// ── HANDOVERS ─────────────────────────────────────────────────────────
function getHandover(stockNo, stageId) {
  try {
    return JSON.parse(localStorage.getItem('ac_ho_'+stockNo+'_'+stageId)||'null');
  } catch(e) { return null; }
}

function saveHandover(stockNo, stageId, data) {
  var obj = Object.assign({}, data, {
    ts: Date.now(),
    savedAt: new Date().toISOString(),
  });
  // localStorage cache
  localStorage.setItem('ac_ho_'+stockNo+'_'+stageId, JSON.stringify(obj));
  // Firestore
  if (FS) {
    FS.collection('handovers').doc(String(stockNo)+'_stage'+stageId).set(obj)
      .catch(function(err){ console.warn('[CapEye] saveHandover error:', err); });
  }
  // Realtime DB (legacy — keep for notifications)
  if (DB) {
    DB.ref('handovers/'+stockNo+'/stage'+stageId).set(obj).catch(function(){});
  }
}

// ── AUDIT LOG ─────────────────────────────────────────────────────────
function logWorkflowEvent(reg, eventType, details, userName) {
  var entry = {
    timestamp: Date.now(),
    date: new Date().toLocaleDateString('en-GB'),
    time: new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),
    eventType: eventType,
    details: details,
    user: userName || 'Unknown',
    reg: reg,
  };
  // Firestore
  if (FS) {
    FS.collection('audit_log').add(entry)
      .catch(function(err){ console.warn('[CapEye] logWorkflowEvent error:', err); });
  }
  // Realtime DB (legacy)
  if (DB) {
    DB.ref('workflow_log/'+reg).push(entry).catch(function(){});
  }
}

function writeAuditLog(type, reg, title, desc, staff, priority) {
  var entry = {
    type: type,
    ts: Date.now(),
    reg: reg || '',
    title: title || '',
    desc: desc || '',
    staff: staff || getCurrentUser().name,
    priority: priority || 'normal',
    date: new Date().toLocaleDateString('en-GB'),
    time: new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),
  };
  // localStorage (for audit page)
  try {
    var log = JSON.parse(localStorage.getItem('ac_audit_log')||'[]');
    log.unshift(entry);
    localStorage.setItem('ac_audit_log', JSON.stringify(log.slice(0, 200)));
  } catch(e){}
  // Firestore
  if (FS) {
    FS.collection('audit_log').add(entry)
      .catch(function(err){ console.warn('[CapEye] writeAuditLog error:', err); });
  }
}

// Subscribe to audit log — for real-time audit page
function subscribeAuditLog(callback, limitTo) {
  if (!FS) return function(){};
  return FS.collection('audit_log')
    .orderBy('ts', 'desc')
    .limit(limitTo || 200)
    .onSnapshot(function(snap) {
      var entries = [];
      snap.forEach(function(doc) { entries.push(doc.data()); });
      callback(entries);
    }, function(err){
      console.warn('[CapEye] subscribeAuditLog error:', err);
    });
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────
function saveNotificationFS(recipientId, notif) {
  if (!FS) return;
  FS.collection('notifications').doc(recipientId)
    .collection('items').add(notif)
    .catch(function(err){ console.warn('[CapEye] saveNotification error:', err); });
}

function subscribeNotifications(userId, callback) {
  if (!FS) return function(){};
  return FS.collection('notifications').doc(userId)
    .collection('items')
    .orderBy('ts', 'desc')
    .limit(50)
    .onSnapshot(function(snap) {
      var items = [];
      snap.forEach(function(doc) {
        items.push(Object.assign({ _id: doc.id }, doc.data()));
      });
      callback(items);
    }, function(err){
      console.warn('[CapEye] subscribeNotifications error:', err);
    });
}

function markNotificationRead(userId, notifId) {
  if (!FS) return;
  FS.collection('notifications').doc(userId)
    .collection('items').doc(notifId)
    .update({ read: true })
    .catch(function(){});
}

// ── AFTERSALES ────────────────────────────────────────────────────────
function loadFaultsFS(callback) {
  // Load from localStorage immediately
  var cached = [];
  try { cached = JSON.parse(localStorage.getItem('ce_aftersales_faults')||'[]'); } catch(e){}
  if (callback) callback(cached);

  if (!FS) return;
  // Then sync from Firestore
  FS.collection('aftersales')
    .orderBy('loggedAt', 'desc')
    .get()
    .then(function(snap) {
      var faults = [];
      snap.forEach(function(doc) { faults.push(Object.assign({ _id: doc.id }, doc.data())); });
      localStorage.setItem('ce_aftersales_faults', JSON.stringify(faults));
      if (callback) callback(faults);
    })
    .catch(function(err){ console.warn('[CapEye] loadFaultsFS error:', err); });
}

function saveFaultFS(fault, callback) {
  if (!FS) {
    // localStorage only
    var faults = [];
    try { faults = JSON.parse(localStorage.getItem('ce_aftersales_faults')||'[]'); } catch(e){}
    faults.unshift(fault);
    localStorage.setItem('ce_aftersales_faults', JSON.stringify(faults));
    if (callback) callback();
    return;
  }
  FS.collection('aftersales').add(fault)
    .then(function() {
      loadFaultsFS(callback);
    })
    .catch(function(err){ console.warn('[CapEye] saveFaultFS error:', err); });
}

function updateFaultStatusFS(docId, status, callback) {
  if (!FS || !docId) {
    if (callback) callback();
    return;
  }
  FS.collection('aftersales').doc(docId).update({ status: status })
    .then(function() { loadFaultsFS(callback); })
    .catch(function(err){ console.warn('[CapEye] updateFaultStatusFS error:', err); });
}

// ── ACCESSORIES ───────────────────────────────────────────────────────
function loadBookingsFS(callback) {
  var cached = [];
  try { cached = JSON.parse(localStorage.getItem('ce_accessories_bookings')||'[]'); } catch(e){}
  if (callback) callback(cached);

  if (!FS) return;
  FS.collection('accessories')
    .orderBy('createdAt', 'desc')
    .get()
    .then(function(snap) {
      var bookings = [];
      snap.forEach(function(doc) { bookings.push(Object.assign({ _id: doc.id }, doc.data())); });
      localStorage.setItem('ce_accessories_bookings', JSON.stringify(bookings));
      if (callback) callback(bookings);
    })
    .catch(function(err){ console.warn('[CapEye] loadBookingsFS error:', err); });
}

function saveBookingFS(booking, callback) {
  if (!FS) {
    var bookings = [];
    try { bookings = JSON.parse(localStorage.getItem('ce_accessories_bookings')||'[]'); } catch(e){}
    bookings.unshift(booking);
    localStorage.setItem('ce_accessories_bookings', JSON.stringify(bookings));
    if (callback) callback();
    return;
  }
  FS.collection('accessories').add(booking)
    .then(function() { loadBookingsFS(callback); })
    .catch(function(err){ console.warn('[CapEye] saveBookingFS error:', err); });
}

// ── AUCTION ───────────────────────────────────────────────────────────
function loadAuctionsFS(callback) {
  var cached = [];
  try { cached = JSON.parse(localStorage.getItem('ce_auction_entries')||'[]'); } catch(e){}
  if (callback) callback(cached);

  if (!FS) return;
  FS.collection('auction')
    .orderBy('updatedAt', 'desc')
    .get()
    .then(function(snap) {
      var entries = [];
      snap.forEach(function(doc) { entries.push(Object.assign({ _id: doc.id }, doc.data())); });
      localStorage.setItem('ce_auction_entries', JSON.stringify(entries));
      if (callback) callback(entries);
    })
    .catch(function(err){ console.warn('[CapEye] loadAuctionsFS error:', err); });
}

function saveAuctionFS(entry, docId, callback) {
  if (!FS) {
    var entries = [];
    try { entries = JSON.parse(localStorage.getItem('ce_auction_entries')||'[]'); } catch(e){}
    if (docId) {
      var idx = entries.findIndex(function(e){ return e._id === docId; });
      if (idx >= 0) entries[idx] = entry; else entries.unshift(entry);
    } else { entries.unshift(entry); }
    localStorage.setItem('ce_auction_entries', JSON.stringify(entries));
    if (callback) callback();
    return;
  }
  var op = docId
    ? FS.collection('auction').doc(docId).set(entry)
    : FS.collection('auction').add(entry);
  op.then(function() { loadAuctionsFS(callback); })
    .catch(function(err){ console.warn('[CapEye] saveAuctionFS error:', err); });
}

function deleteAuctionFS(docId, callback) {
  if (!FS || !docId) {
    var entries = [];
    try { entries = JSON.parse(localStorage.getItem('ce_auction_entries')||'[]'); } catch(e){}
    entries = entries.filter(function(e){ return e._id !== docId; });
    localStorage.setItem('ce_auction_entries', JSON.stringify(entries));
    if (callback) callback();
    return;
  }
  FS.collection('auction').doc(docId).delete()
    .then(function() { loadAuctionsFS(callback); })
    .catch(function(err){ console.warn('[CapEye] deleteAuctionFS error:', err); });
}

// ── VEHICLE ADDITIONS ─────────────────────────────────────────────────
function loadVehicleAdditionsFS(callback) {
  var cached = [];
  try { cached = JSON.parse(localStorage.getItem('ce_vehicle_additions')||'[]'); } catch(e){}
  if (callback) callback(cached);

  if (!FS) return;
  FS.collection('vehicles').get()
    .then(function(snap) {
      var vehicles = [];
      snap.forEach(function(doc) { vehicles.push(Object.assign({ _id: doc.id }, doc.data())); });
      localStorage.setItem('ce_vehicle_additions', JSON.stringify(vehicles));
      if (callback) callback(vehicles);
    })
    .catch(function(err){ console.warn('[CapEye] loadVehicleAdditionsFS error:', err); });
}

function saveVehicleFS(vehicle, callback) {
  if (!FS) {
    var vehicles = [];
    try { vehicles = JSON.parse(localStorage.getItem('ce_vehicle_additions')||'[]'); } catch(e){}
    vehicles.push(vehicle);
    localStorage.setItem('ce_vehicle_additions', JSON.stringify(vehicles));
    if (callback) callback();
    return;
  }
  FS.collection('vehicles').doc(vehicle.registration).set(vehicle)
    .then(function() { loadVehicleAdditionsFS(callback); })
    .catch(function(err){ console.warn('[CapEye] saveVehicleFS error:', err); });
}

// ── PHOTO STORAGE ─────────────────────────────────────────────────────
function uploadPhotoFS(stockNo, photoKey, dataUrl, callback) {
  if (!STORE) {
    // No storage — keep as base64 in workflow data
    if (callback) callback(dataUrl);
    return;
  }
  // Convert base64 to blob
  var parts = dataUrl.split(',');
  var mime = parts[0].match(/:(.*?);/)[1];
  var binary = atob(parts[1]);
  var array = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) { array[i] = binary.charCodeAt(i); }
  var blob = new Blob([array], { type: mime });

  var path = 'photos/' + stockNo + '/' + photoKey + '_' + Date.now() + '.jpg';
  var ref = STORE.ref(path);
  ref.put(blob)
    .then(function() { return ref.getDownloadURL(); })
    .then(function(url) {
      if (callback) callback(url);
    })
    .catch(function(err) {
      console.warn('[CapEye] uploadPhotoFS error:', err);
      // Fall back to base64
      if (callback) callback(dataUrl);
    });
}

// ── PUSH SUBSCRIPTIONS ────────────────────────────────────────────────
function savePushSubscription(userId, subscription) {
  if (FS) {
    FS.collection('push_subscriptions').doc(userId).set({
      subscription: JSON.stringify(subscription),
      updatedAt: new Date().toISOString(),
      userId: userId,
    }).catch(function(){});
  }
  if (DB) {
    DB.ref('push_subscriptions/'+userId).set(JSON.stringify(subscription)).catch(function(){});
  }
}

// ── REAL-TIME VEHICLE STATUS LISTENER ────────────────────────────────
// Call this to get live updates when any vehicle's workflow stage changes
function subscribeVehicleStages(callback) {
  if (!FS) return function(){};
  return FS.collection('workflows')
    .onSnapshot(function(snap) {
      var updates = {};
      snap.forEach(function(doc) {
        var data = doc.data();
        if (data.currentStage) updates[doc.id] = data;
      });
      callback(updates);
    }, function(err){
      console.warn('[CapEye] subscribeVehicleStages error:', err);
    });
}

// ── HELPERS ────────────────────────────────────────────────────────────
function formatGBP(n) {
  if (!n && n !== 0) return '—';
  return '£' + Number(n).toLocaleString('en-GB', {minimumFractionDigits:0, maximumFractionDigits:0});
}
function getDaysInStage(stageStarted) {
  if (!stageStarted) return 0;
  var p = stageStarted.split('/');
  if (p.length === 3) {
    var d = new Date(p[2], p[1]-1, p[0]);
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }
  // ISO format
  var d2 = new Date(stageStarted);
  if (!isNaN(d2)) return Math.floor((Date.now() - d2.getTime()) / 86400000);
  return 0;
}
function getMOTDaysLeft(motExpiry) {
  if (!motExpiry) return 999;
  var p = motExpiry.split('/');
  if (p.length !== 3) return 999;
  var d = new Date(p[2], p[1]-1, p[0]);
  return Math.floor((d.getTime() - Date.now()) / 86400000);
}
function isOverdue(v) {
  return getDaysInStage(v.stageStarted) > 3 &&
    !['Sold','Aftersales','Ready for Sale'].includes(v.workflowStage);
}
function stageColor(stageName) {
  var s = AC_WORKFLOW_STAGES.find(function(x){ return x.name === stageName; });
  return s ? s.color : '#64748b';
}
function showToast(msg, type) {
  type = type || 'info';
  var colors = {info:'#3b82f6',success:'#10b981',warning:'#f59e0b',error:'#ef4444',urgent:'#C8102E'};
  document.querySelectorAll('.ce-toast').forEach(function(t){ t.remove(); });
  var t = document.createElement('div');
  t.className = 'ce-toast';
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;background:'+(colors[type]||colors.info)+';color:#fff;border-radius:10px;font-family:"IBM Plex Sans",sans-serif;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 24px rgba(0,0,0,.25);max-width:340px;line-height:1.4;transition:opacity .3s';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function(){ t.style.opacity='0'; setTimeout(function(){ t.remove(); },300); },3500);
}

// ── NAV USER ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var el = document.getElementById('nav-user');
  if (el) {
    var u = getCurrentUser();
    el.textContent = u.name || 'CapEye';
    el.title = 'Click to sign out';
    el.style.cursor = 'pointer';
    el.onclick = function() {
      if (confirm('Sign out of CapEye?')) doLogout();
    };
  }
});
