import { installationClient } from './client.mjs';
const start = document.getElementById('start');
const progress = document.getElementById('progress');
const title = document.getElementById('progress-title');
const copy = document.getElementById('progress-copy');
const checkout = document.getElementById('checkout');
const open = document.getElementById('open');
const error = document.getElementById('error');
const messages = {
  preparing: ['Preparing your installation', 'Your private installation is being prepared.'],
  waiting: ['Continue on Hostinger', 'Choose your server and complete checkout. When Hostinger opens the prepared installation, click Deploy. Keep this page open; Godspeed will open here when it is ready.'],
  prepared: ['Your Godspeed installation is prepared', 'Complete checkout and click Deploy in Hostinger. There are no Godspeed settings to fill in. This page will open your account creation automatically.'],
  starting: ['Godspeed is starting', 'Your server is setting up its secure connection. Keep this page open; account creation will open automatically.'],
  ready: ['Your server is ready', 'Opening your private account-creation page.'],
};
const client = installationClient({ base: location.origin + '/godspeed-install',
  onState(state, url) {
    start.disabled = state !== 'idle'; start.textContent = 'Install Godspeed on Hostinger';
    progress.hidden = state === 'idle'; error.hidden = true;
    if (messages[state]) { title.textContent = messages[state][0]; copy.textContent = messages[state][1]; }
    if (url) { checkout.href = url; checkout.hidden = false; }
  },
  onError(message) { error.textContent = message; error.hidden = false; },
  onReady(url) { open.href = url; open.hidden = false; location.assign(url); },
});
start.textContent = 'Install Godspeed on Hostinger'; start.disabled = !progress.hidden;
start.addEventListener('click', () => client.start());
