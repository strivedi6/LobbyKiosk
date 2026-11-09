/* =========================================================
   DXBAI Lobby Kiosk – Google Sheet back end (Apps Script web app)

   Paste into the Apps Script project of the sheet
   "DXBAI Lobby Kiosk – Data", set ADMIN_PIN, Save, run "setup" once,
   then Deploy › Manage deployments › ✏️ Edit › Version: New version › Deploy
   (Execute as: Me · Who has access: Anyone).

   Used by:
     lobby screen  GET  ?action=content | ?action=ping
     admin page    POST {action, pin, ...}  check | save | upload | history | restore | cleanup

   Storage: one tab per content section. Columns:
     Key | English / Value | Arabic | Type (hidden)
   You can fix text by hand in the English / Value and Arabic columns.
   ========================================================= */

const ADMIN_PIN = '2468';

const KIOSK = {
  ROOT_FOLDER: 'Lobby Kiosk',
  SLIDESHOW_FOLDER: 'Slideshow',
  MEDIA_FOLDER: 'App Media',
  BACKUP_FOLDER: 'Backups',
  BACKUP_EVERY_MIN: 15,
  TZ: 'Asia/Dubai',
  HEADER: ['Key', 'English / Value', 'Arabic', 'Type'],
  // content section -> tab name (order = order of keys in the content)
  TABS: [
    ['_about', 'About'], ['settings', 'Settings'], ['brand', 'Logos'], ['labels', 'Labels'],
    ['home', 'Home'], ['ads', 'Slideshow'], ['menu', 'Menu'], ['pages', 'Pages'],
    ['contacts', 'Contacts'], ['offers', 'Offers']
  ]
};

/* ---------------- setup (run once from the editor) ---------------- */
function setup() {
  const ss = SpreadsheetApp.getActive();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  const root = rootFolder_();
  sub_(root, KIOSK.SLIDESHOW_FOLDER); sub_(root, KIOSK.MEDIA_FOLDER); sub_(root, KIOSK.BACKUP_FOLDER);
  let rm = ss.getSheetByName('Read Me') || ss.insertSheet('Read Me', 0);
  rm.clear();
  rm.getRange(1, 1, 8, 1).setValues([
    ['DXBAI Lobby Kiosk – Data'],
    ['Edit everything at the admin page. This sheet is where it is saved.'],
    ['Emergency edits by hand: change only the "English / Value" and "Arabic" columns. Never change the Key column.'],
    ['Photos and videos live in Drive › Lobby Kiosk › Slideshow and › App Media.'],
    ['A backup of everything is kept at least every 15 minutes in Drive › Lobby Kiosk › Backups.'],
    [''],
    ['Tabs: ' + KIOSK.TABS.map(function (t) { return t[1]; }).join(', ')],
    ['Last setup: ' + new Date()]
  ]);
  rm.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  rm.setColumnWidth(1, 900);
  // if the sheet has no content yet, try to bring back the newest backup
  if (!readContent_().pages) {
    const b = newestBackup_();
    if (b) writeContent_(b, Object.keys(b));
  }
  clearCache_();
  Logger.log('Setup done. Root folder: ' + root.getName() + '. Content found: ' + (readContent_().pages ? 'yes' : 'no (the admin page will fill it on first sign-in)'));
}

/* ---------------- web app ---------------- */
function doGet(e) {
  const a = (e && e.parameter && e.parameter.action) || 'content';
  try {
    if (a === 'ping') return json_({ ok: true, time: Date.now() });
    if (a === 'content') return json_(getContent_());
    return json_({ error: 'Unknown action: ' + a });
  } catch (err) { return json_({ error: String(err.message || err) }); }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ error: 'Bad request' }); }
  if (String(body.pin || '') !== ADMIN_PIN) return json_({ code: 401, error: 'Wrong PIN' });
  try {
    switch (body.action) {
      case 'check': return json_({ ok: true });
      case 'save': return json_(save_(body.parts || {}));
      case 'upload': return json_(upload_(body));
      case 'history': return json_({ files: history_() });
      case 'restore': return json_(restore_(body.id));
      case 'cleanup':
        if (typeof runMediaCleanup_ !== 'function') throw new Error('Add Cleanup.gs to the Apps Script project first.');
        return json_({ ok: true, message: runMediaCleanup_(!!body.preview) });
      default: return json_({ error: 'Unknown action: ' + body.action });
    }
  } catch (err) { return json_({ error: String(err.message || err) }); }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------------- content (with cache) ---------------- */
function getContent_() {
  const cached = cacheGet_();
  if (cached) return cached;
  let c = readContent_();
  if (!c.pages) {
    // nothing in the tabs yet: fall back to (and move in) the newest backup
    const b = newestBackup_();
    if (b) {
      const lock = LockService.getScriptLock();
      if (lock.tryLock(20000)) { try { if (!readContent_().pages) writeContent_(b, Object.keys(b)); } finally { lock.releaseLock(); } }
      c = b;
    }
  }
  if (c.pages) cachePut_(c);
  return c;
}

function save_(parts) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    maybeBackup_(false);
    writeContent_(parts, Object.keys(parts));
    clearCache_();
    return { ok: true, saved: Object.keys(parts) };
  } finally { lock.releaseLock(); }
}

function sheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

function isMine_(sh) {
  if (!sh || sh.getLastRow() < 1) return false;
  const h = sh.getRange(1, 1, 1, 4).getDisplayValues()[0];
  return h[0] === KIOSK.HEADER[0] && h[3] === KIOSK.HEADER[3];
}

function readContent_() {
  const ss = sheet_();
  const out = {};
  KIOSK.TABS.forEach(function (t) {
    const sh = ss.getSheetByName(t[1]);
    if (!isMine_(sh) || sh.getLastRow() < 2) return;
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues();
    rows.forEach(function (r) { if (r[0]) setPath_(out, r[0], r); });
  });
  return out;
}

function writeContent_(content, keys) {
  const ss = sheet_();
  keys.forEach(function (key) {
    const tab = KIOSK.TABS.filter(function (t) { return t[0] === key; })[0];
    if (!tab) return;
    let sh = ss.getSheetByName(tab[1]);
    if (sh && !isMine_(sh) && sh.getLastRow() > 0) { sh.setName('old – ' + tab[1] + ' ' + Date.now()); sh = null; }
    if (!sh) sh = ss.insertSheet(tab[1]);
    const rows = [KIOSK.HEADER];
    flatten_(content[key], key, rows);
    sh.clearContents();
    const rng = sh.getRange(1, 1, rows.length, 4);
    rng.setNumberFormat('@');            // keep everything as plain text (times, phone numbers…)
    rng.setValues(rows.map(function (r) { return r.map(function (v) { return v == null ? '' : String(v); }); }));
    if (sh.getMaxRows() > rows.length + 50) sh.deleteRows(rows.length + 51, sh.getMaxRows() - rows.length - 50);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold');
    sh.setColumnWidth(1, 320); sh.setColumnWidth(2, 420); sh.setColumnWidth(3, 420);
    sh.getRange(2, 2, Math.max(1, rows.length - 1), 2).setWrap(true);
    sh.getRange(2, 3, Math.max(1, rows.length - 1), 1).setHorizontalAlignment('right');
    sh.hideColumns(4);
  });
}

// content -> rows [key, value/en, ar, type]
function flatten_(v, path, rows) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const ks = Object.keys(v);
    if (ks.length === 2 && 'en' in v && 'ar' in v && typeof v.en !== 'object' && typeof v.ar !== 'object') { rows.push([path, v.en, v.ar, 'bi']); return; }
    if (!ks.length) { rows.push([path, '', '', '{}']); return; }
    ks.forEach(function (k) { flatten_(v[k], path + '.' + k, rows); });
  } else if (Array.isArray(v)) {
    if (!v.length) { rows.push([path, '', '', '[]']); return; }
    v.forEach(function (x, i) { flatten_(x, path + '.' + i, rows); });
  } else if (typeof v === 'number') rows.push([path, v, '', 'n']);
  else if (typeof v === 'boolean') rows.push([path, v ? 'TRUE' : 'FALSE', '', 'b']);
  else if (v == null) rows.push([path, '', '', 'null']);
  else rows.push([path, v, '', 's']);
}

// rows -> content
function setPath_(root, path, r) {
  const segs = path.split('.');
  let o = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i], nextIsIndex = /^\d+$/.test(segs[i + 1]);
    if (o[k] == null || typeof o[k] !== 'object') o[k] = nextIsIndex ? [] : {};
    o = o[k];
  }
  const last = segs[segs.length - 1], type = r[3], val = r[1];
  let v;
  if (type === 'bi') v = { en: r[1], ar: r[2] };
  else if (type === 'n') v = Number(val) || 0;
  else if (type === 'b') v = String(val).toUpperCase() === 'TRUE';
  else if (type === '[]') v = [];
  else if (type === '{}') v = {};
  else if (type === 'null') v = null;
  else v = val;
  o[last] = v;
}

/* cache: content is ~130 KB, CacheService allows 100 KB per key, so split it */
function cachePut_(c) {
  try {
    const s = JSON.stringify(c), size = 90000, n = Math.ceil(s.length / size), map = { 'kc-n': String(n) };
    for (let i = 0; i < n; i++) map['kc-' + i] = s.substr(i * size, size);
    CacheService.getScriptCache().putAll(map, 600);
  } catch (e) {}
}
function cacheGet_() {
  try {
    const cache = CacheService.getScriptCache(), n = Number(cache.get('kc-n'));
    if (!n) return null;
    const keys = []; for (let i = 0; i < n; i++) keys.push('kc-' + i);
    const got = cache.getAll(keys);
    let s = ''; for (let i = 0; i < n; i++) { if (got['kc-' + i] == null) return null; s += got['kc-' + i]; }
    return JSON.parse(s);
  } catch (e) { return null; }
}
function clearCache_() { try { CacheService.getScriptCache().remove('kc-n'); } catch (e) {} }

/* ---------------- Drive folders ---------------- */
function rootFolder_() {
  const parents = DriveApp.getFileById(sheet_().getId()).getParents();
  while (parents.hasNext()) { const p = parents.next(); if (p.getName() === KIOSK.ROOT_FOLDER) return p; }
  const it = DriveApp.getFoldersByName(KIOSK.ROOT_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(KIOSK.ROOT_FOLDER);
}
function sub_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/* ---------------- uploads ---------------- */
function upload_(b) {
  if (!b.data) throw new Error('No file received');
  const root = rootFolder_();
  let folder = b.folder === 'slideshow' ? sub_(root, KIOSK.SLIDESHOW_FOLDER) : sub_(root, KIOSK.MEDIA_FOLDER);
  if (b.folder !== 'slideshow' && b.subfolder) folder = sub_(folder, String(b.subfolder));
  const mime = b.mime || 'application/octet-stream';
  const stamp = Utilities.formatDate(new Date(), KIOSK.TZ, 'yyyyMMdd-HHmmss');
  const blob = Utilities.newBlob(Utilities.base64Decode(b.data), mime, stamp + '-' + (b.name || 'file'));
  const file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (e) { throw new Error("Google wouldn't allow link sharing for this folder (ask IT to allow \"Anyone with the link\")."); }
  const id = file.getId();
  const isVideo = /^video\//.test(mime) || /\.(mp4|webm|mov|m4v)$/i.test(b.name || '');
  const ext = isVideo ? (((b.name || '').match(/\.(mp4|webm|mov|m4v)$/i) || ['.mp4'])[0]).toLowerCase() : '';
  const url = isVideo
    ? 'https://drive.google.com/uc?export=download&id=' + id + '&f=' + ext   // ends in .mp4 so the screen knows it's a video
    : 'https://lh3.googleusercontent.com/d/' + id;
  return { ok: true, url: url, id: id };
}

/* ---------------- backups ---------------- */
function maybeBackup_(force) {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('LAST_BACKUP') || 0);
  if (!force && Date.now() - last < KIOSK.BACKUP_EVERY_MIN * 60e3) return;
  const c = readContent_();
  if (!c.pages) return;
  const name = 'content-' + Utilities.formatDate(new Date(), KIOSK.TZ, 'yyyyMMdd-HHmmss') + '.json';
  sub_(rootFolder_(), KIOSK.BACKUP_FOLDER).createFile(name, JSON.stringify(c), 'application/json');
  props.setProperty('LAST_BACKUP', String(Date.now()));
}

function backupFiles_() {
  const it = sub_(rootFolder_(), KIOSK.BACKUP_FOLDER).getFiles(), out = [];
  while (it.hasNext()) { const f = it.next(); if (/^content-\d{8}-\d{6}/.test(f.getName())) out.push(f); }
  out.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  return out;
}

function history_() {
  return backupFiles_().slice(0, 60).map(function (f) { return { id: f.getId(), name: f.getName() }; });
}

function parseBackup_(file) {
  try {
    const j = JSON.parse(file.getBlob().getDataAsString());
    if (j && j.pages) return j;
    if (j && j.content && j.content.pages) return j.content;
  } catch (e) {}
  return null;
}

function newestBackup_() {
  const files = backupFiles_();
  for (let i = 0; i < Math.min(files.length, 10); i++) { const c = parseBackup_(files[i]); if (c) return c; }
  return null;
}

function restore_(id) {
  const c = parseBackup_(DriveApp.getFileById(id));
  if (!c) throw new Error("That backup can't be read");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    maybeBackup_(true);
    writeContent_(c, Object.keys(c));
    clearCache_();
  } finally { lock.releaseLock(); }
  return { ok: true };
}
