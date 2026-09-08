# Chapter 32: Use Your Server From the Desktop App

Telegram is handy for a quick question. For reading a longer result or finding a file, you may prefer a desktop window. This optional setup gives you one for the server you already built.

Hermes and the hub stay on the server; the desktop app on your computer connects to them. Keep those locations in mind. A file you are viewing on the desktop can still be a file that lives on the server.

## Add a private network connection

The companion setup uses Tailscale, which connects your computer and server over a private network. Before signing up, read [Tailscale's current setup guide and plan](https://tailscale.com/kb). Its access rules determine which of your connected devices can reach each other.

Install Tailscale on your desktop and sign in. Then open the server terminal as `root`. Use the same reviewed companion version as Chapter 31 for:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/open-the-door.sh | bash
```

The script guides you through signing the server into Tailscale, creates a login for the web interface and starts that interface as a service. Use your own account when following its authentication link, and save the printed password in your password manager.

The resulting private address has a form such as `100.x.y.z`. With your real address, the companion route uses:

```
http://100.x.y.z:9119
```

From the connected desktop, open your real address and check that the page asks for the configured sign-in. If the private connection fails, work through that failure. Making port 9119 public would change who can reach it without fixing the private setup you intended.

In the earlier test, the service correctly asked for its password. That test didn't cover the entire first connection from a blank reader machine. I'll keep that limit clear: check each step on your own computer as you go.

## Connect the desktop app

Get the desktop app from [the official Hermes site](https://hermes-agent.nousresearch.com). For this job, choose the connection to an existing server. Your assistant is already on the server; you are adding a way to reach it.

The tested interface called this **Connect to existing Hermes**. Enter the private server URL, use its sign-in control, test the connection and reconnect. If you already use local Hermes, its gateway settings provide a remote connection alongside the local one.

Confirm which connection is selected. Ask:

```
Without changing files, show this session's working folder and read the heading of /home/ai/hub/AGENTS.md. List the next scheduled job on this server with its time zone. If this is a local connection, say so instead of searching for a similarly named folder.
```

Then open a server result you recognise in the file browser. Signing in successfully is reassuring, but seeing the expected file tells you that you're in the hub you meant to reach.

## Diagnose the failed step

Use the error to decide where to look. An authentication error points to the login: check the saved credentials and login method. A refused connection or timeout points you toward the address, Tailscale access or whether the server service is listening.

Read that error before installing everything again. A wrong address can survive any number of successful reinstallations. Keep the web password out of the troubleshooting conversation.

## Keep access limited

Telegram's allowed-user list governs who can speak to the bot. Desktop access has its own controls: the private network rules and web login. Changing one doesn't change the other.

Before inviting another person, read the allowed-user settings for that channel and check what they could ask the assistant to read or change. An assistant with your files can do more than make small talk, so decide what access you mean to share.

Other messenger connections can wait until you want one. Each needs its own credentials, permissions and delivery test. A name in the settings menu only tells you the option exists.

## Keep the server checks visible

The gateway and web service run on the server. The desktop app runs locally. The server's scheduled checks can attempt local recovery while your desktop is closed.

As in Chapter 31, the model probe needs a response from the model to pass. Its failure detector and alert sender don't. But all of them still depend on the server and enough network access to work. They can't report every failure of the computer they're running on.

Check that the expected watchdog jobs and web service appear in `procedures.md`, with their actual pause or stop controls. The desktop app itself is not an extra server service.

The earlier setup used one model account for both the assistant and its AI watchdog, so both used that account's allowance. Another provider or separate watcher may add charges. Connecting from the desktop doesn't change the server rent or make its model work free.

You can now reach the same server work from a phone conversation or a desktop window. When the next scheduled result is due, read it where you expect to use it. A connection is most useful when it brings the work comfortably within reach.
