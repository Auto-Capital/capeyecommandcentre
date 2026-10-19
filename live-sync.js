// CapEye Auto Capital | Version 1.3 | Live Sync Layer
// ╔══════════════════════════════════════════════════════════════════╗
// ║  CAPEYE — LIVE DATA BOOTSTRAP                                     ║
// ║  Makes the existing synchronous read path serve LIVE Firestore   ║
// ║  data by pre-warming the localStorage cache before render, then  ║
// ║  attaching real-time listeners that re-render on any change.     ║
// ║                                                                  ║
// ║  Why this exists: pages read data via `getWorkflow(x)` and the   ║
// ║  static AC_VEHICLES array — both synchronous. Firestore is async.║
// ║  This layer resolves Firestore FIRST, caches it, then lets the   ║
// ║  existing sync code run against fresh data. No call-site rewrite.║
// ╚══════════════════════════════════════════════════════════════════╝

var CE_LIVE = (function () {
  var _unsubs = [];
  var _ready = false;
  var _rerenderCb = null;
  var _rerenderPending = false;

  // Debounced re-render so a burst of snapshot events paints once.
  function _scheduleRerender() {
    if (!_rerenderCb || _rerenderPending) return;
    _rerenderPending = true;
    setTimeout(function () {
      _rerenderPending = false;
      try { _rerenderCb(); } catch (e) { console.warn('[CapEye] rerender error', e); }
    }, 150);
  }

  // Merge Firestore vehicle docs into the in-memory `vehicles` array.
  // Firestore is the source of truth for any vehicle it holds; vehicles
  // that exist only in the static seed (AC_VEHICLES) are preserved.
  function _mergeVehicles(targetArr, fsVehicles) {
    if (!fsVehicles || !fsVehicles.length) return;
    fsVehicles.forEach(function (fv) {
      if (!fv || !fv.stockNo) return;
      var idx = targetArr.findIndex(function (v) { return v.stockNo === fv.stockNo; });
      if (idx >= 0) {
        // Update existing in place, keeping any seed fields FS doesn't carry.
        targetArr[idx] = Object.assign({}, targetArr[idx], fv);
      } else {
        targetArr.push(fv);
      }
    });
  }

  // Pull every workflow doc once and write it into the localStorage cache
  // under the exact key the sync getWorkflow() reads: ac_wf_<stockNo>.
  function _prewarmWorkflows() {
    if (!window.FS) return Promise.resolve();
    return FS.collection('workflows').get()
      .then(function (snap) {
        snap.forEach(function (doc) {
          try {
            localStorage.setItem('ac_wf_' + doc.id, JSON.stringify(doc.data()));
          } catch (e) {}
        });
      })
      .catch(function (err) {
        console.warn('[CapEye] prewarm workflows failed:', err);
      });
  }

  // Pull vehicle additions once, merge into the passed-in vehicles array.
  function _prewarmVehicles(vehiclesArr) {
    if (!window.FS) return Promise.resolve();
    return FS.collection('vehicles').get()
      .then(function (snap) {
        var fsVehicles = [];
        snap.forEach(function (doc) {
          fsVehicles.push(Object.assign({ _id: doc.id }, doc.data()));
        });
        _mergeVehicles(vehiclesArr, fsVehicles);
      })
      .catch(function (err) {
        console.warn('[CapEye] prewarm vehicles failed:', err);
      });
  }

  // Wait for Firebase Auth to be READY with a signed-in user before any
  // Firestore read. Fixes the "works on phone, not on desktop" bug: reads
  // were racing ahead of the auth session being restored, so the security
  // rules (request.auth != null) denied them and the screen came up empty.
  function _awaitAuth() {
    return new Promise(function (resolve) {
      if (typeof AUTH === 'undefined' || !AUTH) { resolve(false); return; }
      if (AUTH.currentUser) { resolve(true); return; }
      var done = false;
      var unsub = AUTH.onAuthStateChanged(function (user) {
        if (done) return;
        if (user) { done = true; if (unsub) unsub(); resolve(true); }
      });
      setTimeout(function () {
        if (done) return;
        done = true; if (unsub) unsub();
        console.warn('[CapEye] auth not ready after timeout — proceeding on cache.');
        resolve(!!(AUTH && AUTH.currentUser));
      }, 6000);
    });
  }

  // ── PUBLIC: run BEFORE init(), resolve when live data is cached ──
  function bootstrap(vehiclesArr) {
    if (!window.FS) {
      console.log('[CapEye] Live sync: Firestore unavailable — using local cache only.');
      return Promise.resolve(false);
    }
    return _awaitAuth().then(function (authed) {
      if (!authed) {
        console.warn('[CapEye] No Firebase auth session — reads would be denied.');
        if (typeof isSessionValid === 'function' && isSessionValid()) {
          // App thinks we're logged in but Firebase disagrees — session drift.
          window.location.href = 'login.html';
          return false;
        }
        return false;
      }
      return Promise.all([
        _prewarmWorkflows(),
        _prewarmVehicles(vehiclesArr)
      ]).then(function () {
        _ready = true;
        return true;
      });
    });
  }

  // ── PUBLIC: attach live listeners; rerenderCb re-paints the whole UI ──
  // vehiclesArr is the SAME array reference the page renders from, so
  // mutating it in place makes the next re-render show live data.
  function attachListeners(vehiclesArr, rerenderCb) {
    _rerenderCb = rerenderCb;
    if (!window.FS) return;

    // 1) Live vehicle workflow stages — keeps ac_wf_ cache hot + repaints.
    var u1 = FS.collection('workflows').onSnapshot(function (snap) {
      snap.docChanges().forEach(function (change) {
        var doc = change.doc;
        try {
          localStorage.setItem('ac_wf_' + doc.id, JSON.stringify(doc.data()));
        } catch (e) {}
        // Reflect currentStage / workflowStage back onto the vehicle row
        var data = doc.data();
        var idx = vehiclesArr.findIndex(function (v) { return v.stockNo === doc.id; });
        if (idx >= 0) {
          if (data.workflowStage) vehiclesArr[idx].workflowStage = data.workflowStage;
          if (data.status)        vehiclesArr[idx].status = data.status;
          if (data.stageStarted)  vehiclesArr[idx].stageStarted = data.stageStarted;
          if (typeof data.urgent === 'boolean') vehiclesArr[idx].urgent = data.urgent;
        }
      });
      _scheduleRerender();
    }, function (err) {
      console.warn('[CapEye] workflows listener error:', err);
    });
    _unsubs.push(u1);

    // 2) Live vehicle additions/edits.
    var u2 = FS.collection('vehicles').onSnapshot(function (snap) {
      var fsVehicles = [];
      snap.forEach(function (doc) {
        fsVehicles.push(Object.assign({ _id: doc.id }, doc.data()));
      });
      _mergeVehicles(vehiclesArr, fsVehicles);
      _scheduleRerender();
    }, function (err) {
      console.warn('[CapEye] vehicles listener error:', err);
    });
    _unsubs.push(u2);
  }

  function teardown() {
    _unsubs.forEach(function (u) { try { u(); } catch (e) {} });
    _unsubs = [];
  }

  window.addEventListener('beforeunload', teardown);

  return {
    bootstrap: bootstrap,
    attachListeners: attachListeners,
    teardown: teardown,
    isReady: function () { return _ready; }
  };
})();
