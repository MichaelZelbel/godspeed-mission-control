// Matches the Host names a notebook on this computer accepts (server/main.mjs `handle`). The auth screen's
// wording and its requests follow the hostname, so a notebook reached under another name reads as a server.
export function onThisComputer(): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}
