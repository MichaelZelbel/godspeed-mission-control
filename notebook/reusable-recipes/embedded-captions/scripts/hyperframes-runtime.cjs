const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function roots(extra) {
  const home = process.env.GODSPEED_VIDEO_HOME || path.join(os.homedir(), '.mc-video');
  return [...new Set([extra, process.env.HYPERFRAMES_ROOT,
    path.resolve(__dirname, '../../..'), path.join(home, 'hyperframes'),
    path.join(os.homedir(), 'Downloads', 'hyperframes')].filter(Boolean))];
}
function resolve(extra) {
  for (const root of roots(extra)) {
    for (const relative of ['packages/cli/dist/cli.js', 'node_modules/hyperframes/dist/cli.js', 'dist/cli.js']) {
      const cli = path.join(root, relative);
      if (fs.existsSync(cli)) return {root, cli};
    }
  }
  throw new Error('HyperFrames CLI not found; set HYPERFRAMES_ROOT to its npm installation or built checkout');
}
module.exports = {roots, resolve};
if (require.main === module) {
  try {
    const found = resolve(process.argv[3]);
    console.log(found[process.argv[2] === '--root' ? 'root' : 'cli']);
  } catch (error) { console.error(error.message); process.exitCode = 3; }
}
