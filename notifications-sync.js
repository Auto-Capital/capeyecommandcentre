// ══════════════════════════════════════════════════════════════════════
// CapEye — Shared Notifications Layer (notifications-sync.js)
// ONE shared Firestore collection ('notifications') so a notification
// raised on ANY device (desktop handover, app completion, authorise, fault)
// reaches the recipient's bell on EVERY device — not just the one that
// created it. Falls back to localStorage when Firestore is unavailable.
//
// This REPLACES the per-device localStorage-only bell. The old
// notifications.js still sends email/push; this module owns the in-app bell
// store and its live cross-device sync.
//
// Notification shape:
//   { id, forId (recipient staff id), forName, type, reg, vehicle, stage,
//     fromName, note, priority, link, ts, read }
// ══════════════════════════════════════════════════════════════════════
var CE_NOTIFY = (function () {
  var COL = 'notifications';
  function _lsKey(uid){ return 'ce_notifs_' + uid; }
  function _lsLoad(uid){ try { return JSON.parse(localStorage.getItem(_lsKey(uid)) || '[]'); } catch(e){ return []; } }
  function _lsSave(uid, arr){ try { localStorage.setItem(_lsKey(uid), JSON.stringify(arr.slice(0,80))); } catch(e){} }
  function _id(){ return 'ntf_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }

  function _resolveRecipients(nameOrDept){
    if (!nameOrDept || typeof AC_STAFF==='undefined') return [];
    var n = String(nameOrDept).toLowerCase();
    // exact name
    var byName = AC_STAFF.filter(function(s){ return s.name.toLowerCase()===n; });
    if (byName.length) return byName;
    // first name
    var first = n.split(' ')[0];
    var byFirst = AC_STAFF.filter(function(s){ return s.name.toLowerCase().split(' ')[0]===first && s.role!=='Test User'; });
    if (byFirst.length && byName.length===0 && n.indexOf(' ')===-1) return byFirst;
    // department (handles "Valeting Team", "Valeting dept")
    var clean = n.replace(/ team$/,'').replace(/ dept(artment)?$/,'').trim();
    var byDept = AC_STAFF.filter(function(s){ return s.dept && s.dept.toLowerCase()===clean; });
    return byDept;
  }

  // Raise a notification for one recipient (name or department). Writes a
  // doc per recipient so each person's bell can query just their own.
  function push(opts){
    // opts: {toName, type, reg, vehicle, stage, fromName, note, priority, link}
    var recips = _resolveRecipients(opts.toName);
    recips.forEach(function(s){
      var n = {
        id: _id(),
        forId: s.id,
        forName: s.name,
        type: opts.type || 'handover',
        reg: opts.reg || '',
        vehicle: opts.vehicle || '',
        stage: opts.stage || '',
        fromName: opts.fromName || '',
        note: opts.note || '',
        priority: opts.priority || 'Normal',
        link: opts.link || 'workflow.html',
        ts: Date.now(),
        read: false
      };
      // localStorage (instant, same device)
      var arr = _lsLoad(s.id); arr.unshift(n); _lsSave(s.id, arr);
      // Firestore (cross-device)
      if (typeof FS!=='undefined' && FS){
        try { FS.collection(COL).doc(n.id).set(n).catch(function(){}); } catch(e){}
      }
    });
    // Also fire the email/push path if the legacy dispatcher is present.
    // Mark the payload so storeInAppNotification doesn't loop back into push().
    try {
      if (typeof sendNotification==='function' && !opts._noEmail){
        sendNotification(opts.type||'handover', Object.assign({}, opts, { _fromCeNotify: true }));
      }
    } catch(e){}
    return recips.length;
  }

  // Live subscription for ONE recipient id — keeps that person's bell current
  // across devices. Merges Firestore + any local-only items.
  function subscribe(uid, cb){
    if (!uid) { if (cb) cb([]); return function(){}; }
    if (typeof FS==='undefined' || !FS){ if (cb) cb(_lsLoad(uid)); return function(){}; }
    var unsub = function(){};
    try {
      unsub = FS.collection(COL).where('forId','==',uid).onSnapshot(function(snap){
        var server=[]; var ids={};
        snap.forEach(function(d){ var n=Object.assign({id:d.id}, d.data()); server.push(n); ids[d.id]=1; });
        // keep local-only (not yet synced) items
        _lsLoad(uid).forEach(function(n){ if(!ids[n.id]) server.push(n); });
        server.sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
        _lsSave(uid, server);
        if (cb) cb(server);
      }, function(){ if (cb) cb(_lsLoad(uid)); });
    } catch(e){ if (cb) cb(_lsLoad(uid)); }
    return function(){ try { unsub(); } catch(e){} };
  }

  function forUser(uid){ return uid ? _lsLoad(uid) : []; }
  function unreadCount(uid){ return forUser(uid).filter(function(n){ return !n.read; }).length; }

  function markAllRead(uid){
    if (!uid) return;
    var arr = _lsLoad(uid);
    arr.forEach(function(n){ if(!n.read){ n.read=true;
      if (typeof FS!=='undefined' && FS && /^ntf_/.test(n.id)){ try { FS.collection(COL).doc(n.id).set({read:true},{merge:true}).catch(function(){}); } catch(e){} }
    }});
    _lsSave(uid, arr);
  }

  return { push:push, subscribe:subscribe, forUser:forUser, unreadCount:unreadCount, markAllRead:markAllRead };
})();

// Auto-wire the bell to live cross-device updates. When notifications change
// for the logged-in user on any device, refresh the badge and (if open) panel.
document.addEventListener('DOMContentLoaded', function(){
  try {
    var uid = localStorage.getItem('ce_user_id');
    if (!uid || uid==='unknown') return;
    CE_NOTIFY.subscribe(uid, function(){
      try { if (typeof updateBell==='function') updateBell(); } catch(e){}
      try { var p=document.getElementById('notifPanel'); if (p && p.classList.contains('open') && typeof renderNotifPanel==='function') renderNotifPanel(); } catch(e){}
    });
  } catch(e){}
});
