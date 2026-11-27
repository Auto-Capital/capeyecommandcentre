// ══════════════════════════════════════════════════════════════════════
// CapEye — Shared Jobs Layer (jobs-sync.js)
// ONE shared Firestore collection ('staff_jobs') is the single source of
// truth for assigned jobs. Both the back-office app and the staff mobile
// app read/write through here, so a job Ibrahim assigns in Workflow
// appears live on David's phone. Falls back to localStorage when offline.
//
// Job shape:
//   { id, stockNo, stageId, stageName, title, note,
//     assignedTo (staff NAME), assignedBy (staff NAME),
//     priority ('Normal'|'Urgent'|'Critical'|'High'|'Medium'|'Low'),
//     status ('pending'|'done'  AND/OR  'To Do'|'In Progress'|'Done'),
//     vehicle (reg make model), assignedAt (ms), completedAt (ms|null),
//     createdAt (ms) }
// ══════════════════════════════════════════════════════════════════════
var CE_JOBS = (function () {
  var COL = 'staff_jobs';
  var LS  = 'ce_staff_jobs';

  function _lsLoad() { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } }
  function _lsSave(arr) { try { localStorage.setItem(LS, JSON.stringify(arr.slice(0, 500))); } catch (e) {} }

  function _id() { return 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

  // Track ids written locally but not yet confirmed in a server snapshot, so a
  // snapshot that arrives before the write lands can't wipe them from the cache.
  var _pendingIds = {};

  // Wait until Firebase auth is ready (anonymous or email), then run cb.
  function _awaitAuth(cb) {
    try {
      if (typeof AUTH === 'undefined' || !AUTH) { cb(); return; }
      if (AUTH.currentUser) { cb(); return; }
      var done = false;
      var unsub = AUTH.onAuthStateChanged(function (u) {
        if (done) return;
        if (u) { done = true; if (unsub) unsub(); cb(); }
      });
      // Fallback: proceed after 4s even if auth never fires, and try anon sign-in.
      if (AUTH.signInAnonymously && !AUTH.currentUser) { AUTH.signInAnonymously().catch(function(){}); }
      setTimeout(function () { if (!done) { done = true; if (unsub) unsub(); cb(); } }, 4000);
    } catch (e) { cb(); }
  }

  // Push one job to Firestore, waiting for auth and retrying once on failure.
  function _writeFS(job, attempt) {
    if (typeof FS === 'undefined' || !FS) return;
    _pendingIds[job.id] = Date.now();
    _awaitAuth(function () {
      FS.collection(COL).doc(String(job.id)).set(job, { merge: true })
        .then(function () { delete _pendingIds[job.id]; _lastWrite = { ok:true, at:Date.now() }; if (_onWrite) _onWrite(true); })
        .catch(function (e) {
          console.warn('[CapEye] job write failed', e && e.code, e);
          _lastWrite = { ok:false, code:(e&&e.code)||'error', at:Date.now() };
          if (!attempt) { setTimeout(function () { _writeFS(job, 1); }, 1500); }
          else { delete _pendingIds[job.id]; if (_onWrite) _onWrite(false, (e&&e.code)); }
        });
    });
  }
  var _lastWrite = null;      // { ok, code, at }
  var _onWrite = null;        // optional callback(ok, code) pages can set
  function lastWriteStatus(){ return _lastWrite; }
  function onWrite(cb){ _onWrite = cb; }

  // Create (or update) one job. Writes to Firestore AND localStorage.
  function upsert(job) {
    if (!job.id) job.id = _id();
    if (!job.createdAt) job.createdAt = Date.now();
    job.updatedAt = Date.now();
    var arr = _lsLoad();
    var i = arr.findIndex(function (j) { return j.id === job.id; });
    if (i >= 0) arr[i] = Object.assign({}, arr[i], job); else arr.unshift(job);
    _lsSave(arr);
    _writeFS(Object.assign({}, job), 0);
    return job;
  }

  // Assign a job from a workflow handover (called by confirmHandover).
  function assignFromHandover(opts) {
    // opts: {stockNo, stageId, stageName, assignedTo, assignedBy, note, priority, vehicle}
    // ONE shared job per vehicle+stage (deterministic id). Re-advancing the same
    // vehicle to the same stage updates that ONE job instead of creating a
    // duplicate for every department member — and because it's a single doc,
    // completing it clears it for the whole team at once. Authorise/technician
    // sign-off jobs get their own suffix so they don't collide with the stage job.
    var detId = 'stage_' + opts.stockNo + '_' + opts.stageId +
                (opts.jobType ? ('_' + opts.jobType + (opts.assignedTo ? '_' + String(opts.assignedTo).toLowerCase().replace(/[^a-z0-9]+/g,'') : '')) : '');
    return upsert({
      id: opts.id || detId,
      stockNo: opts.stockNo,
      reg: opts.reg || '',            // registration — the unique cross-section link
      stageId: opts.stageId,
      stageName: opts.stageName,
      title: (opts.stageName || 'Stage') + ' — ' + (opts.vehicle || opts.stockNo),
      note: opts.note || '',
      workRequired: opts.workRequired || '',   // inspector's flagged tasks
      jobType: opts.jobType || '',             // '' normal, 'authorise' = sign-off check
      assignedTo: opts.assignedTo || '',
      assignedToDept: opts.assignedToDept || '',
      assignedBy: opts.assignedBy || '',
      priority: opts.priority || 'Normal',
      status: 'pending',
      vehicle: opts.vehicle || '',
      startedAt: null,
      assignedAt: Date.now(),
      completedAt: null,
      createdAt: Date.now()
    });
  }

  // Record that a staff member has STARTED a job (date/time started).
  function start(jobId, byName) {
    var arr = _lsLoad();
    var job = arr.find(function (j) { return j.id === jobId; });
    if (!job) return null;
    if (!job.startedAt) { job.startedAt = Date.now(); job.startedBy = byName || ''; }
    upsert(job);
    return job;
  }

  // Mark a job complete.
  function complete(jobId, byName) {
    var arr = _lsLoad();
    var job = arr.find(function (j) { return j.id === jobId; });
    if (!job) return;
    job.status = 'done';
    job.completedAt = Date.now();
    job.completedBy = byName || '';
    upsert(job);
  }

  // All jobs (local cache). Use subscribe() for live.
  function all() { return _lsLoad(); }

  // Jobs assigned to a given staff NAME — or to that person's DEPARTMENT
  // (team handovers) — or to a STAGE the person covers. Pass the person's dept
  // as the 2nd arg and the array of stage names they see as the 3rd, so e.g.
  // Stash (who covers Intake + Bodywork) gets the Bodywork job even though it
  // was handed to the Bodyshop department.
  function forStaff(name, dept, sees) {
    if (!name) return [];
    var first = name.split(' ')[0].toLowerCase();
    var d = (dept || '').toLowerCase();
    var seesArr = (sees === 'all') ? 'all' : (Array.isArray(sees) ? sees.map(function(s){return (s||'').toLowerCase();}) : []);
    return _lsLoad().filter(function (j) {
      var a = (j.assignedTo || '').toLowerCase();
      var jd = (j.assignedToDept || '').toLowerCase();
      var mine = a === name.toLowerCase() || a.split(' ')[0] === first;
      var teamMine = d && (jd === d || a === (d + ' team'));
      // Stage the person covers (but never steal another individual's named job).
      var isTeamJob = !j.assignedTo || /team$/.test(a) || !!j.assignedToDept;
      var stageMine = isTeamJob && Array.isArray(seesArr) && seesArr.length &&
                      j.stageName && seesArr.indexOf((j.stageName||'').toLowerCase()) > -1;
      return mine || teamMine || stageMine;
    });
  }

  // Collapse duplicate PENDING stage jobs for the same vehicle+stage+dept down
  // to one (the newest), so legacy duplicates created before deterministic ids
  // don't keep showing for every department member. A job that's done, or a
  // one-off (accessories/aftersales/authorise), is never collapsed.
  function _dedupeStageJobs(list) {
    var seen = {}; var out = [];
    (list || []).forEach(function (j) {
      var isStage = /^stage_/.test(j.id || '') || (j.stageId && j.stageName && !j.jobType && !j.source);
      var pending = !(j.status === 'done' || j.status === 'Done');
      if (isStage && pending) {
        var key = (j.stockNo || j.reg || '') + '|' + (j.stageId || j.stageName || '') + '|' + ((j.assignedToDept || j.assignedTo || '').toLowerCase());
        if (seen[key]) {
          // Drop the older duplicate; if it still lives on the server, delete it.
          if (typeof FS !== 'undefined' && FS && /^job_/.test(j.id)) { try { FS.collection(COL).doc(String(j.id)).delete().catch(function(){}); } catch(e){} }
          return;
        }
        seen[key] = 1;
      }
      out.push(j);
    });
    return out;
  }

  // Live subscription — calls cb() whenever jobs change. Pre-warms cache too.
  // Waits for auth first so the first read isn't rejected, and MERGES any
  // locally-written jobs whose Firestore write hasn't landed yet, so a job
  // never vanishes between being created and being confirmed on the server.
  function subscribe(cb) {
    if (typeof FS === 'undefined' || !FS) { if (cb) cb(_lsLoad()); return function () {}; }
    var unsub = function () {};
    _awaitAuth(function () {
      unsub = FS.collection(COL).onSnapshot(function (snap) {
        var server = [];
        var serverIds = {};
        snap.forEach(function (d) { var j = Object.assign({ id: d.id }, d.data()); server.push(j); serverIds[d.id] = 1; });
        // Keep any local job that the server doesn't have yet AND is still pending a write.
        var local = _lsLoad();
        local.forEach(function (j) {
          if (!serverIds[j.id] && _pendingIds[j.id]) server.push(j);
        });
        server.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        server = _dedupeStageJobs(server);
        _lsSave(server);
        if (cb) cb(server);
      }, function (err) { console.warn('[CapEye] jobs listener error', err); if (cb) cb(_lsLoad()); });
    });
    return function () { try { unsub(); } catch (e) {} };
  }

  return { upsert: upsert, assignFromHandover: assignFromHandover, complete: complete,
           start: start, all: all, forStaff: forStaff, subscribe: subscribe,
           lastWriteStatus: lastWriteStatus, onWrite: onWrite };
})();
