# Chapter 31: Use Your Server From the Desktop App

Telegram is a good place to ask a quick question. A long result or a folder full of files deserves more room. This optional setup puts the server within reach of your desktop app, so you can read and work on the computer in front of you.

The assistant and Mission Control stay on the server; the desktop app gives you a way to reach them. A file on your screen can therefore belong to a computer elsewhere. Check the selected connection before editing, even when the window looks familiar.

## Add a private network connection

You need an existing Linux server with Hermes installed for the `ai` account and your mission control at `/home/ai/godspeed`. This chapter adds access to that working server; it does not install the assistant itself.

The companion setup uses Tailscale, which connects your computer and server over a private network. Before signing up, read [Tailscale's current setup guide](https://tailscale.com/docs/how-to/quickstart) and the plan offered to your account. Its access rules determine which of your connected devices can reach each other.

Install Tailscale on your desktop and sign in. Then open the server terminal as `root`. Ask the assistant to inspect the access script against your existing server setup first. This address downloads the current public script:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/open-the-door.sh | bash
```

The script guides you through signing the server into Tailscale, creates a login for the web interface and starts that interface as a service. Use your own account when following its authentication link, and save the printed password in your password manager.

The resulting private address has a form such as `100.x.y.z`. With your real address, the companion route uses:

```
http://100.x.y.z:9119
```

Open your real address from the connected desktop. It should ask for the sign-in you configured. If it won't connect, use the troubleshooting section below to trace the private connection. Keep port 9119 on the private network while you check; a connection problem is a reason to repair access, not to widen it.

In the earlier test, the service correctly asked for its password.

## Connect the desktop app

Get the desktop app from [the official Hermes site](https://hermes-agent.nousresearch.com). For this job, choose the connection to an existing server. Your assistant is already on the server; you are adding a way to reach it.

The tested interface called this **Connect to existing Hermes**. Enter the private server URL, use its sign-in control, test the connection and reconnect. If you already use Hermes on this computer, add the server under **Settings**, then **Gateways**; the two connections sit side by side.

Confirm which connection is selected. Ask:

```
Without changing files, show this session's working folder and read the heading of /home/ai/godspeed/AGENTS.md. List the next scheduled job on this server with its time zone. If this is a local connection, say so instead of searching for a similarly named folder.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-31-text-3-20260913)*

Open a server result you recognise in the file browser. It is still on the server, but now you have the screen space to read it properly. This is the convenience we installed the connection for.

## Diagnose the failed step

Read the actual error before changing settings. An authentication failure points you toward the saved credentials and login method. A refused connection or a timeout sends you to the address, Tailscale access and whether the server service is listening. These clues are more useful than trying a little of everything and forgetting what you changed.

You can ask the assistant to work through that error with you while keeping the web password out of the chat.

## Keep access limited

Telegram's allowed-user list governs who can speak to the bot. Desktop access has its own controls: the private network rules and web login. Changing one doesn't change the other.

Before inviting someone, check the channel's allowed-user settings and what that person could ask the assistant to read or change. You're sharing access to an assistant with your files. Decide how much access you mean to give before making the introduction.

Add another messenger when you have a job for it. Each one needs its own credentials, permissions and delivery test. One connection you use regularly is a better starting point than several you keep meaning to try.

## Keep the server checks visible

The gateway and web service run on the server. The desktop app runs locally. If your server setup includes watchdog jobs, those are scheduled checks that can detect a stopped service and try restarting it while your desktop is closed.

Ask the assistant to inspect which recovery checks are installed. Have it record them and the web service in `procedures.md`, with their actual pause or stop controls. Connecting the desktop does not, by itself, add those checks.

The earlier setup used one model account for both the assistant and its AI watchdog, so both used that account's allowance. Another provider or separate watcher may add charges.

When the next result is due, read it where it suits you: on the phone for a quick answer, or in the desktop window for work that needs a closer look. The files can stay on the server without making you feel as though you left your work somewhere else.
