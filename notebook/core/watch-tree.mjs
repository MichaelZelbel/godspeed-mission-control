// A recursive watcher for the workspace folders that survives a file being
// replaced by rename. Node's recursive fs.watch is an emulation on Linux: it
// opens one inotify watch per file's inode, and when a file is replaced by
// rename (the atomic write every save and every adoption uses) the old
// inode's watch dies while the emulation still knows the path, so it never
// re-watches it and the path is never reported again (#914; #897's
// adoption-only re-arm was the earlier partial fix). darwin and win32 watch
// recursively natively and do not have this fault, so they keep the native
// watcher. Everywhere else this watches each directory once: an inotify watch
// on a directory reports a name however often the file under it is replaced.
import fs from 'node:fs';
import path from 'node:path';

export function watchTree(root, listener) {
  if (process.platform === 'darwin' || process.platform === 'win32') return fs.watch(root, {recursive: true}, listener);
  const watchers = new Map(); // relative directory -> its fs.watch
  const errorHandlers = [];
  let closed = false;
  const fail = error => {
    if (closed) return;
    closed = true;
    for (const watcher of watchers.values()) { try { watcher.close(); } catch {} }
    watchers.clear();
    for (const handler of errorHandlers) handler(error);
  };
  // A directory that was renamed or removed: its watchers are dead and its
  // subfolders' watchers point at paths that no longer exist.
  const drop = child => {
    for (const key of [...watchers.keys()]) if (key === child || key.startsWith(child + '/')) { watchers.get(key).close(); watchers.delete(key); }
  };
  // Watch one directory. A directory that vanished between being seen and
  // being watched is skipped, unless it is the root itself: failing to watch
  // the root is a failure to watch anything, like fs.watch's own.
  const watch = (relative, announce) => {
    if (closed || watchers.has(relative)) return;
    let watcher;
    try { watcher = fs.watch(path.join(root, relative), (event, name) => {
      if (name == null) { listener(event, null); return; }
      const child = relative ? relative + '/' + name : name;
      let stat = null;
      try { stat = fs.lstatSync(path.join(root, child)); } catch {}
      if (!stat) drop(child);
      listener(event, child);
      if (stat?.isDirectory() && !stat.isSymbolicLink() && !watchers.has(child)) watch(child, true);
    }); }
    catch (error) {
      if (relative === '') throw error;
      return;
    }
    watcher.on('error', fail);
    watchers.set(relative, watcher);
    // Every subfolder is watched, so a folder that arrives whole is covered
    // from then on. Its entries are reported only when the folder itself
    // arrived while watching (announce): its watcher starts too late to
    // report the files already inside it. At start the entries that are
    // already there are not reported; the native watchers do not report them
    // either, and the callers read what exists at startup themselves.
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, relative), {withFileTypes: true}); } catch {}
    for (const entry of entries) {
      const child = relative ? relative + '/' + entry.name : entry.name;
      if (announce) listener('rename', child);
      if (entry.isDirectory() && !entry.isSymbolicLink()) watch(child, announce);
    }
  };
  watch('', false);
  return {
    close() {
      if (closed) return;
      closed = true;
      for (const watcher of watchers.values()) { try { watcher.close(); } catch {} }
      watchers.clear();
    },
    on(event, handler) {
      if (event === 'error') errorHandlers.push(handler);
      return this;
    },
  };
}
