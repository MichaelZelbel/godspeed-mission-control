# Godspeed Mission Control prepared Hostinger installer

Live test endpoint: https://srv1069233.hstgr.cloud/godspeed-install

The coordinator creates private per-installation Compose URLs for Hostinger's documented Deploy button. The generated configuration requires zero input fields and uses the complete pinned image. After the buyer completes checkout and clicks Deploy, the hostname callback and private polling hand the buyer a single-use owner invitation.

Hostinger describes the checkout handoff and referral parameter here: https://www.hostinger.com/support/deploy-on-hostinger-button/

The paid checkout has not been completed. Actual generated deployment, HTTPS issuance and owner handoff have been tested on the authorized disposable VPS. GitHub CI additionally tests the ordinary remote-coordinator deployment with the complete image, account creation, 30-day session, import/chat UI and Docker restart/logout.

## Coordinator deployment

Copy this folder to /opt/godspeed-hostinger-installer. Install godspeed-installer.service. Its GODSPEED_INSTALL_BIND must be the actual Docker host-gateway address (inspect Docker's bridge network). The test machine uses 10.0.0.1. The coordinator is not exposed publicly on that HTTP port; the generated Caddy configuration proxies /godspeed-install over HTTPS when deployed on the coordinator's own server. Other buyer servers use HTTPS directly and do not proxy the coordinator.

The generated configuration says nothing about Telegram. The buyer connects a bot on their own server's web page after the account is made (../README.md, "Telegram, connected after the account"), so a bot's key never reaches this coordinator, the website or its logs.

DynamicUser and StateDirectory keep private jobs in /var/lib/godspeed-installer, retained through restarts. Browser, callback and Compose credentials are separate.

The generated Compose file carries no setup code (since 6 October 2026). On its first start the server makes its own, keeps it in its data volume, and sends it with the authenticated hostname callback; the first callback binds both the server address and that code, and the Compose link opens nothing after it. Hostinger fetches and keeps the Compose file, so a setup code written into it reached Hostinger and anyone who saw the link.

Limits: an installation whose Compose file was never fetched expires after one hour, a deployed one after 24 hours. One client (the address Caddy names in X-Forwarded-For, and for IPv6 its whole /64, since a customer is handed a /64) holds at most five installations not yet bound by the authenticated hostname callback and starts at most twenty a day; overall at most thirty start per minute. Fetching your own Compose link no longer counts as "deployed" for that cap, so it cannot be used to escape it. Before, the Origin header was the only gate and one global cap of 100 jobs kept for a day let a script block real buyers. These per-address counters are persisted to the private volume (limits.json, keyed by a salted hash of the client group, never the address itself), so a restart no longer resets them. Never log generated configurations, ticket files, invitation links, authorization headers or job state. No customer AI traffic is routed through the coordinator.

The coordinator reads a claimed server's callback reply with a hard few-KB cap: a flooded reply (64 MB under the service's MemoryMax=96M) used to crash the Restart=on-failure service, and the persisted job made every restart crash again.

seed-vps-test.mjs is only an operator tool for the authorized test VPS; it generates and stores a synthetic private ticket and Compose configuration in /opt/godspeed-hostinger-test. It is not part of the customer flow.

## Verification

Run node --test docker/hostinger/installer/test.mjs. The workflow_dispatch docker workflow option hostinger-automatic runs the complete pinned image in a disposable GitHub runner. Docker config --variables --format json must return an empty object.

Live test results: private owner invitation; account creation without setup code; 12-character progress; 30-day login; requested-page return; incorrect-password feedback; logout revokes server session; synthetic expiry shows the expiry message; sign-in again returns to the requested import page. Production srv1328602 was not used for this deployment. Disk usage after deployment: 68 GB used, 125 GB available.

Design review: independent review completed, repeated copy removed, whole Mission Control phrase retained in small header, cost/new-server context brought beside the action. Live desktop, 390/360 phone and reduced motion check: zero failures and warnings. Real phones/Safari not verified. Screenshot evidence lives under C:/godspeed/work/artifacts/2026-10-03-server-login/automatic-installer-live-final.
