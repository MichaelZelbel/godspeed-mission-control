# Chapter 32: Use Your Server From the Desktop App

Your server can already answer through Telegram if you connected it. This optional chapter adds a desktop window for reading results, browsing files and inspecting schedules.

Hermes and the hub remain on the server. The desktop application runs on your own computer and connects to that server. Those locations matter when you look for a file or stop a job.

## Add a private network connection

The companion route uses Tailscale to connect your computer and server over a private network. Check [Tailscale's current setup guide and plan](https://tailscale.com/kb) before creating an account. Its access rules decide which connected devices can reach one another.

Install Tailscale on your desktop and sign in. Then open the server terminal as `root`. Use the same reviewed companion version as Chapter 31 for:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/open-the-door.sh | bash
```

The script guides the server's Tailscale sign-in, creates a login for the web interface and starts that interface as a service. Follow its authentication link using your own account. Keep the printed password in your password manager.

The resulting private address has a form such as `100.x.y.z`. With your real address, the companion route uses:

```
http://100.x.y.z:9119
```

Open that address from the connected desktop. The page must require its configured sign-in. Do not expose port 9119 publicly to make a failed private connection work.

The earlier test of this script established that the service asked for its password. It did not establish the full first-time desktop route on a blank reader machine. Check each step on your own connection.

## Connect the desktop app

Install the desktop app from [the official Hermes site](https://hermes-agent.nousresearch.com). Choose its route to an existing Hermes server rather than installing a new local assistant if that is your intention.

The tested interface called this **Connect to existing Hermes**. Enter the private server URL, use its sign-in control, test the connection and reconnect. If you already use local Hermes, its gateway settings provide a remote connection alongside the local one.

Confirm which connection is selected. Ask:

```
Without changing files, show this session's working folder and read the heading of /home/ai/hub/AGENTS.md. List the next scheduled job on this server with its time zone. If this is a local connection, say so instead of searching for a similarly named folder.
```

Then open a known server result in the file browser. A successful sign-in alone does not prove the session uses the intended hub.

## Diagnose the failed step

An authentication error means the login was rejected. Check the saved credentials and configured login method. A refused connection or timeout calls for checking the address, Tailscale access and whether the server service is listening.

Read the actual error before rerunning an installer. Reinstallation is not a substitute for checking the wrong address or a stopped service. Do not paste the web password into a troubleshooting chat.

## Keep access limited

The Telegram user list controls who can speak to the bot. The private network rules and web login control desktop access. They are separate.

If you want to add another person, inspect the current channel's allowed-user settings first. Confirm what that person would be able to ask the assistant to read or change. A second user is not automatically limited to harmless conversation.

Other messenger connections are optional. Each needs its own permissions, credentials and delivery test; their appearance in a settings list is not evidence that they are connected.

## Keep the server checks visible

The gateway and web service run on the server. The desktop app runs locally. The server's scheduled checks can attempt local recovery while your desktop is closed.

Chapter 31's distinction still applies: the model probe needs a model response, while its failure detector and alert sender do not. All still need the server and enough network access to work. They cannot report every failure of the computer they run on.

Check that the expected watchdog jobs and web service appear in `procedures.md`, with their actual pause or stop controls. The desktop app itself is not an extra server service.

The historical route used one model account for the assistant and its AI watchdog. Their work shared that account's allowance. A different provider or a separate watcher can add charges; changing the desktop connection does not remove server rent or model costs.

You now have two ways to reach the same server work: phone conversation and a desktop window. Test the next real scheduled result from the place you intend to read it.
