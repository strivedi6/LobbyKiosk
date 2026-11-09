/* =========================================================
   Lobby Kiosk — clean up unused media
   Add this as a SECOND file in the Apps Script project
   (next to Code.gs). It does not change anything in Code.gs.

   What it does:
   - Looks at every photo/video in Drive › Lobby Kiosk › Slideshow
     and › App Media (and their subfolders).
   - If a file's ID is not used anywhere in the Google Sheet
     (i.e. not on the live screen), it moves it to the Drive Trash.
   - Files uploaded in the last 24 hours are never touched
     (so a fresh upload that hasn't saved yet is safe).
   - The Backups folder is never touched.
   - Trash keeps files for 30 days, so anything removed by
     mistake can still be restored from Drive › Trash.

   Run once by hand:   choose  cleanUnusedMediaPreview  → ▶ Run   (only lists, deletes nothing)
                       choose  cleanUnusedMediaNow      → ▶ Run   (moves unused files to Trash)
   Turn on daily run:  choose  installDailyCleanup      → ▶ Run   (every night around 3 AM)
   Turn it off:        choose  removeDailyCleanup       → ▶ Run
   ========================================================= */

const CLEANUP = {
  MEDIA_FOLDERS: ['Slideshow', 'App Media'],   // folders inside "Lobby Kiosk" that hold uploads
  ROOT_NAME: 'Lobby Kiosk',
  SKIP_FOLDERS: ['Backups'],
  KEEP_HOURS: 24,                               // never remove files newer than this
  MAX_SHARE: 0.9                                // safety: stop if it would remove more than 90% of files
};

function cleanUnusedMediaPreview() { return runMediaCleanup_(true); }
function cleanUnusedMediaNow() { return runMediaCleanup_(false); }
function dailyMediaCleanup() { return runMediaCleanup_(false); }

function installDailyCleanup() {
  removeDailyCleanup();
  ScriptApp.newTrigger('dailyMediaCleanup').timeBased().everyDays(1).atHour(3).create();
  Logger.log('Daily clean-up is ON (runs every night around 3 AM).');
}

function removeDailyCleanup() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'dailyMediaCleanup'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('Daily clean-up is OFF.');
}

function runMediaCleanup_(dryRun) {
  // 1. Everything the live screen uses = all text in every tab of the sheet
  const ss = cleanupSheet_();
  let used = '';
  ss.getSheets().forEach(function (sh) {
    const r = sh.getDataRange();
    used += '\n' + r.getValues().map(function (row) { return row.join('\t'); }).join('\n');
    used += '\n' + r.getFormulas().map(function (row) { return row.join('\t'); }).join('\n');
  });
  if (used.replace(/\s/g, '').length < 500) throw new Error('The sheet looks empty, so nothing was removed.');

  // 2. All uploaded files
  const root = cleanupRoot_(ss);
  const files = [];
  CLEANUP.MEDIA_FOLDERS.forEach(function (name) {
    const it = root.getFoldersByName(name);
    while (it.hasNext()) collectFiles_(it.next(), name, files);
  });
  if (!files.length) { Logger.log('No uploaded files found in ' + CLEANUP.MEDIA_FOLDERS.join(' / ') + '.'); return; }

  // 3. Unused = ID not mentioned in the sheet, and older than KEEP_HOURS
  const cutoff = Date.now() - CLEANUP.KEEP_HOURS * 3600e3;
  const usedCount = files.filter(function (f) { return used.indexOf(f.file.getId()) >= 0; }).length;
  const unused = files.filter(function (f) {
    return used.indexOf(f.file.getId()) < 0 && f.file.getDateCreated().getTime() < cutoff;
  });

  if (usedCount === 0) throw new Error('None of the ' + files.length + ' files are used in the sheet — that looks wrong, so nothing was removed. Check that this script is attached to the live sheet.');
  if (unused.length > files.length * CLEANUP.MAX_SHARE) throw new Error('This would remove ' + unused.length + ' of ' + files.length + ' files, which looks wrong, so nothing was removed.');

  let bytes = 0;
  unused.forEach(function (f) {
    bytes += f.file.getSize();
    if (!dryRun) f.file.setTrashed(true);
  });

  const mb = (bytes / 1048576).toFixed(1);
  const head = (dryRun ? 'PREVIEW (nothing removed): ' : 'Removed: ') + unused.length + ' unused file(s), ' + mb + ' MB. ' +
    usedCount + ' file(s) in use, kept.';
  Logger.log(head);
  unused.forEach(function (f) { Logger.log('  ' + f.path + '/' + f.file.getName()); });

  PropertiesService.getScriptProperties().setProperty('LAST_MEDIA_CLEANUP',
    new Date().toISOString() + ' — ' + head);
  return head;
}

function collectFiles_(folder, path, out) {
  if (CLEANUP.SKIP_FOLDERS.indexOf(folder.getName()) >= 0) return;
  const fi = folder.getFiles();
  while (fi.hasNext()) out.push({ file: fi.next(), path: path });
  const fo = folder.getFolders();
  while (fo.hasNext()) { const sub = fo.next(); collectFiles_(sub, path + '/' + sub.getName(), out); }
}

function cleanupSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return SpreadsheetApp.getActive() || SpreadsheetApp.openById(id);
}

// "Lobby Kiosk" folder: the one that holds the sheet, otherwise the first folder with that name
function cleanupRoot_(ss) {
  const parents = DriveApp.getFileById(ss.getId()).getParents();
  while (parents.hasNext()) {
    const p = parents.next();
    if (p.getName() === CLEANUP.ROOT_NAME || p.getFoldersByName(CLEANUP.MEDIA_FOLDERS[0]).hasNext()) return p;
  }
  const it = DriveApp.getFoldersByName(CLEANUP.ROOT_NAME);
  if (it.hasNext()) return it.next();
  throw new Error('Could not find the "' + CLEANUP.ROOT_NAME + '" folder in Drive.');
}
