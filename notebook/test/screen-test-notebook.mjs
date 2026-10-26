// A real notebook for the screen tests in ui/ (ui/src/test/real-notebook.ts),
// in a process of its own: the server's modules read their own file
// addresses, which the screen tests' bundler rewrites. It lives here, not in
// ui/, because the UI's Docker build copies only what the UI itself imports.
//
//   node screen-test-notebook.mjs <empty workspace folder>
//
// Prints one line, "listening <port>", and runs until it is stopped.
import {createService} from '../server/main.mjs';

const [root] = process.argv.slice(2);
const service = await createService({root, host: '127.0.0.1', port: 0, device: 'screen-test'});
process.stdout.write('listening ' + service.address.port + '\n');
const stop = async () => { try { await service.close(); } finally { process.exit(0); } };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
