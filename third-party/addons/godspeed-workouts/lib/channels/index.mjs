// Where messages go: every channel in the setting `tell` gets the message, and it counts as
// delivered when at least one took it. Not set: this computer's notifications on a desktop, the
// assistant's own Telegram bot on a server.
//
// A channel is lib/channels/<name>.mjs with
//   send({ text, link, settings, env, home }) -> true when it took the message (or throws)
//   ready({ settings, env, home }) -> { ok, why }
import * as telegram from "./telegram.mjs";
import * as desktop from "./desktop.mjs";
import { TELLS } from "../settings.mjs";

const CHANNELS = { telegram, desktop };

export function isDesktop({ platform = process.platform, env = process.env } = {}) {
  if (platform === "win32" || platform === "darwin") return true;
  return !!(env.DISPLAY || env.WAYLAND_DISPLAY || /^(x11|wayland)$/i.test(env.XDG_SESSION_TYPE || ""));
}

export function tellOf(settings, { platform = process.platform, env = process.env } = {}) {
  const set = Array.isArray(settings.tell) ? settings.tell.filter((t) => TELLS.includes(t)) : [];
  return set.length ? [...new Set(set)] : isDesktop({ platform, env }) ? ["desktop"] : ["telegram"];
}

const linkOf = (text) => (String(text).match(/https?:\/\/\S+/) || [null])[0];

export async function tell(text, { settings, env = process.env, home, log = () => {}, impls = {}, link } = {}) {
  const results = {};
  let delivered = false;
  for (const name of tellOf(settings, { env })) {
    try {
      const ch = impls[name] || CHANNELS[name];
      const ok = await ch.send({ text, link: link || linkOf(text), settings, env, home });
      results[name] = ok ? "ok" : "not taken";
      if (ok) delivered = true;
    } catch (e) {
      results[name] = e.message;
      log(`message: ${name} did not take it: ${e.message}`);
    }
  }
  return { delivered, results };
}

export function readiness(settings, { env = process.env, home } = {}) {
  return tellOf(settings, { env }).map((name) => {
    try { return { name, ...CHANNELS[name].ready({ settings, env, home }) }; }
    catch (e) { return { name, ok: false, why: e.message }; }
  });
}
