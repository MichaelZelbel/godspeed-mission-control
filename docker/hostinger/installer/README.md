# Godspeed Mission Control prepared Hostinger installer

Live test endpoint: https://srv1069233.hstgr.cloud/godspeed-install

The coordinator creates private per-installation Compose URLs for Hostinger's documented Deploy button. The generated configuration requires zero input fields and uses the complete pinned image. After the buyer completes checkout and clicks Deploy, the hostname callback and private polling hand the buyer a single-use owner invitation.

Hostinger describes the checkout handoff and referral parameter here: https://www.hostinger.com/support/deploy-on-hostinger-button/

The paid checkout has not been completed. Actual generated deployment, HTTPS issuance and owner handoff have been tested on the authorized disposable VPS. GitHub CI additionally tests the ordinary remote-coordinator deployment with the complete image, account creation, 30-day session, import/chat UI and Docker restart/logout.

## Coordinator deployment

Copy this folder to /opt/godspeed-hostinger-installer. Install godspeed-installer.service. Its GODSPEED_INSTALL_BIND must be the actual Docker host-gateway address (inspect Docker's bridge network). The test machine uses 10.0.0.1. The coordinator is not exposed publicly on that HTTP port; the generated Caddy configuration proxies /godspeed-install over HTTPS when deployed on the coordinator's own server. Other buyer servers use HTTPS directly and do not proxy the coordinator.

DynamicUser and StateDirectory keep private jobs in /var/lib/godspeed-installer, retained through restarts. Jobs expire after 24 hours; counts and request rates are bounded. Browser, callback and Compose credentials are separate. Never log generated configurations, ticket files, invitation links, authorization headers or job state. No customer AI traffic is routed through the coordinator.

seed-vps-test.mjs is only an operator tool for the authorized test VPS; it generates and stores a synthetic private ticket and Compose configuration in /opt/godspeed-hostinger-test. It is not part of the customer flow.

## Verification

Run node --test docker/hostinger/installer/test.mjs. The workflow_dispatch docker workflow option hostinger-automatic runs the complete pinned image in a disposable GitHub runner. Docker config --variables --format json must return an empty object.

Live test results: private owner invitation; account creation without setup code; 12-character progress; 30-day login; requested-page return; incorrect-password feedback; logout revokes server session; synthetic expiry shows the expiry message; sign-in again returns to the requested import page. Production srv1328602 was not used for this deployment. Disk usage after deployment: 68 GB used, 125 GB available.

Design review: independent review completed, repeated copy removed, whole Mission Control phrase retained in small header, cost/new-server context brought beside the action. Live desktop, 390/360 phone and reduced motion check: zero failures and warnings. Real phones/Safari not verified. Screenshot evidence lives under C:/godspeed/work/artifacts/2026-10-03-server-login/automatic-installer-live-final.
