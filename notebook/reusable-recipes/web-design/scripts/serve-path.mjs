import fs from 'node:fs';
import path from 'node:path';

export function servePath(root, requestUrl) {
  let requested;
  try { requested = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname); }
  catch { return { status: 400 }; }
  const inside = candidate => {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
  };
  let file = path.resolve(root, '.' + requested);
  if (!inside(file)) return { status: 403 };
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    const fallback = path.join(root, 'index.html');
    if (fs.existsSync(fallback) && !path.extname(requested)) file = fallback;
    else return { status: 404 };
  }
  const physicalRoot = fs.realpathSync(root), physicalFile = fs.realpathSync(file);
  const relative = path.relative(physicalRoot, physicalFile);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return { status: 403 };
  if (!fs.statSync(physicalFile).isFile()) return { status: 404 };
  return { status: 200, file: physicalFile };
}
