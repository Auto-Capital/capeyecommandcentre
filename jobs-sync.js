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

  // Create (or update) one job. Writes to Firestore AND localStorage.
  function upsert(job) {
    if (!job.id) job.id = _id();
    if (!job.createdAt) job.createdAt = Date.now();
    // keep both status vocabularies in sync so either UI shows it right
    if (job.status === 'pending' || job.status === 'To Do') { job.status = job.status; }
    var arr = _lsLoad();
    var i = arr.findIndex(function (j) { return j.id === job.id; });
    if (i >= 0) arr[i] = Object.assign({}, arr[i], job); else arr.unshift(job);
    _lsSave(arr);
    if (typeof FS !== 'undefined' && FS) {
      FS.collection(COL).doc(String(job.id)).set(job, { merge: true })
        .catch(function (e) { console.warn('[CapEye] job write failed', e); });
    }
    return job;
  }

  // Assign a job from a workflow handover (called by confirmHandover).
  function assignFromHandover(opts) {
    // opts: {stockNo, stageId, stageName, assignedTo, assignedBy, note, priority, vehicle}
    return upsert({
      id: _id(),
      stockNo: opts.stockNo,
      reg: opts.reg || '',            // registration — the unique cross-section link
      stageId: opts.stageId,
      stageName: opts.stageName,
      title: (opts.stageName || 'Stage') + ' — ' + (opts.vehicle || opts.stockNo),
      note: opts.note || '',
      assignedTo: opts.assignedTo || '',
      assignedToDept: opts.assignedToDept || '',
      assignedBy: opts.assignedBy || '',
      priority: opts.priority || 'Normal',
      status: 'pending',
      vehicle: opts.vehicle || '',
      assignedAt: Date.now(),
      completedAt: null,
      createdAt: Date.now()
    });
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
  // (team handovers). Pass the person's dept as the 2nd argument.
  function forStaff(name, dept) {
    if (!name) return [];
    var first = name.split(' ')[0].toLowerCase();
    var d = (dept || '').toLowerCase();
    return _lsLoad().filter(function (j) {
      var a = (j.assignedTo || '').toLowerCase();
      var jd = (j.assignedToDept || '').toLowerCase();
      var mine = a === name.toLowerCase() || a.split(' ')[0] === first;
      var teamMine = d && (jd === d || a === (d + ' team'));
      return mine || teamMine;
    });
  }

  // Live subscription — calls cb() whenever jobs change. Pre-warms cache too.
  function subscribe(cb) {
    if (typeof FS === 'undefined' || !FS) { if (cb) cb(_lsLoad()); return function () {}; }
    return FS.collection(COL).onSnapshot(function (snap) {
      var arr = [];
      snap.forEach(function (d) { arr.push(Object.assign({ id: d.id }, d.data())); });
      arr.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      _lsSave(arr);
      if (cb) cb(arr);
    }, function (err) { console.warn('[CapEye] jobs listener error', err); if (cb) cb(_lsLoad()); });
  }

  return { upsert: upsert, assignFromHandover: assignFromHandover, complete: complete,
           all: all, forStaff: forStaff, subscribe: subscribe };
})();
