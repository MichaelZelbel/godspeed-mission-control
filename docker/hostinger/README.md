# Godspeed Mission Control on Hostinger

This deployment is for a fresh Docker VPS. It uses the complete tested application,
keeps its data and certificates in persistent Docker volumes, and limits container
logs to 30 MB per service. It requires no local configuration files or terminal commands.

Hostinger's supported purchase link is:

`https://www.hostinger.com/docker-hosting?compose_url=PUBLIC_RAW_COMPOSE_URL`

Use the public raw URL of `compose.yaml` at the release commit. The file pins the
complete tested image by digest, so unrelated changes to `latest` cannot replace it.

After checkout, Hostinger opens Docker Manager with the installation ready to deploy.
Fill `GODSPEED_HOST` with the VPS hostname shown by Hostinger, without `https://`,
and choose a private `GODSPEED_SETUP_CODE`. Save that code in your password manager.
Deploy, then open `https://YOUR_VPS_HOSTNAME`. Enter the setup code, create your
username and password, and save the recovery code. Later visits use your account.

The hostname must resolve to this VPS and incoming ports 80 and 443 must be available.
The bundled HTTPS service obtains and renews the public certificate automatically.
Do not install this project over an existing project using those ports or volumes.
Connect an AI provider in Godspeed Mission Control after creating your account.

Verification runs on a disposable GitHub runner using this exact Compose file and
the published image. Local test certificates verify the HTTPS wiring; issuance of a
public certificate and the paid Hostinger handoff require a real fresh VPS test.

Official Hostinger flow: https://www.hostinger.com/support/deploy-on-hostinger-button/
