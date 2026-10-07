const storage = 'godspeed-hostinger-installation';
const endpoint = 'https://srv1069233.hstgr.cloud/godspeed-install';
let poll;
export function installationClient({ onState, onError, onReady, base = endpoint }) {
  let job;
  try { job = JSON.parse(sessionStorage.getItem(storage) || 'null'); } catch { job = null; }
  async function check() {
    if (!job) return;
    try {
      const response = await fetch(`${base}/api/status/${job.id}`, { headers: { authorization: 'Bearer ' + job.key } });
      const data = await response.json();
      if (!response.ok) { if (response.status === 401) { clearInterval(poll); sessionStorage.removeItem(storage); job = null; onState('idle'); } throw Error(data.error); }
      onState(data.state, job.checkout);
      if (data.url) { clearInterval(poll); sessionStorage.removeItem(storage); onReady(data.url); }
    } catch (error) { onError(error.message || 'Connection interrupted. We will try again.'); }
  }
  if (job) { onState('waiting', job.checkout); check(); poll = setInterval(check, 5000); }
  return {
    async start() {
      // Open in the click handler, before awaiting, so popup blockers do not hide checkout.
      const checkoutWindow = window.open('about:blank', '_blank');
      if (checkoutWindow) checkoutWindow.opener = null;
      onState('preparing');
      try {
        const response = await fetch(base + '/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        const data = await response.json(); if (!response.ok) throw Error(data.error);
        job = data; sessionStorage.setItem(storage, JSON.stringify(data)); onState('waiting', data.checkout);
        if (checkoutWindow) checkoutWindow.location.replace(data.checkout);
        clearInterval(poll); poll = setInterval(check, 5000);
      } catch (error) { checkoutWindow?.close(); onState('idle'); onError(error.message || 'The connection could not be opened. Please try again.'); }
    },
    dispose() { clearInterval(poll); },
  };
}
