'use strict';
//
// run-log-folders.js - the folders that hold Godspeed's own run records, one folder per day under
// each: research (mc-research), work (mc-work-run), next-action (mc-decide) and coach-prep
// (mc-coach-prep). The nightly cleanup (notebook/core/cleanup.mjs) deletes their files after 30
// days, and mc-work refuses a result kept inside one of them (#543), so a person's work goes in
// work/, goals/ or ideas/ instead.
//
// This file is a library, not a command. It holds the list once so the cleanup and mc-work cannot
// disagree about which folders are emptied (#551). It lives here, not in the notebook, because
// mc-work is copied into places without the notebook, and the notebook already reads tools/.

module.exports = {
  RUN_LOG_FOLDERS: ['routines/research', 'routines/work', 'routines/next-action', 'routines/coach-prep'],
};
