// A real notebook for screen tests, in a process of its own (the server's
// modules read their own file addresses, which a test bundler rewrites).
//
//   node notebook-server.mjs <empty workspace folder>
//
// Prints one line, "listening <port>", and runs until it is stopped.
import {createService} from '../../../server/main.mjs';

const [root] = process.argv.slice(2);
const service = await createService({root, host: '127.0.0.1', port: 0, device: 'screen-test'});
process.stdout.write('listening ' + service.address.port + '\n');
const stop = async () => { try { await service.close(); } finally { process.exit(0); } };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
