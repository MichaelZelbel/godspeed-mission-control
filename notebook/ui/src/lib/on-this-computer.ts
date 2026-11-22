// Matches the Host names a notebook on this computer accepts (server/main.mjs `handle`). Use it
// only while the notebook has not answered; once /api/auth/status answers, its `local` field is the truth.
export function onThisComputer(): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}
