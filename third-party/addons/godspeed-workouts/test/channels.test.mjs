import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { tell, tellOf } from "../lib/channels/index.mjs";
import { resolveEnvFile, validTelegramEnv } from "../lib/channels/telegram.mjs";
import { DEFAULTS } from "../lib/settings.mjs";
import { tmp } from "./helpers.mjs";

test("a message goes to the assistant's own Telegram bot, found in the mission control's Hermes home", async () => {
  const ws = tmp("ws");
  const envFile = path.join(ws, ".godspeed", "integrated-runtime", "hermes", ".env");
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, "TELEGRAM_BOT_TOKEN=123:made-up\nTELEGRAM_ALLOWED_USERS=4242\n");
  const got = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    got.push({ url: req.url, body: JSON.parse(body) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const settings = { ...DEFAULTS, workspace: ws, tell: ["telegram"] };
    assert.equal(resolveEnvFile({ settings, env: {}, home: tmp("home") }), envFile);
    const env = { GODSPEED_WORKOUTS_TEST: "1", GODSPEED_WORKOUTS_TELEGRAM_API: `http://127.0.0.1:${server.address().port}` };
    const res = await tell("Hevy stopped accepting the key. https://hevy.com/settings?developer", { settings, env, home: tmp("home") });
    assert.equal(res.delivered, true, JSON.stringify(res.results));
    assert.equal(got.length, 1);
    assert.equal(got[0].url, "/bot123:made-up/sendMessage");
    assert.equal(got[0].body.chat_id, "4242");
    assert.equal(got[0].body.disable_web_page_preview, true);
    // A pretend Telegram address outside test mode is refused, so no test can reach a real bot by mistake.
    const off = await tell("x", { settings, env: { GODSPEED_WORKOUTS_TELEGRAM_API: env.GODSPEED_WORKOUTS_TELEGRAM_API }, home: tmp("home") });
    assert.equal(off.delivered, false);
    assert.equal(got.length, 1);
  } finally { await new Promise((r) => server.close(r)); fs.rmSync(ws, { recursive: true, force: true }); }
});

test("where messages go: the setting, else Telegram on a server and notifications on a desktop", () => {
  assert.deepEqual(tellOf({ tell: ["desktop", "telegram"] }), ["desktop", "telegram"]);
  assert.deepEqual(tellOf({ tell: null }, { platform: "linux", env: {} }), ["telegram"]);
  assert.deepEqual(tellOf({ tell: null }, { platform: "win32", env: {} }), ["desktop"]);
  assert.equal(validTelegramEnv("/home/example/godspeed/.godspeed/integrated-runtime/hermes/.env"), true);
  assert.equal(validTelegramEnv("/home/example/godspeed/secrets/.env"), false);
});
