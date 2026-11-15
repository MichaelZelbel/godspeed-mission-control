#!/usr/bin/env node
/*
 * test-no-publish-hook.js - proof that starter-godspeed/.claude/hooks/no-publish-in-the-persons-name.js
 * refuses posting, scheduling or queueing on a social platform in the person's name, and allows
 * reading, cancelling, drafting and everything else.
 *
 * It runs the hook the way Claude Code and Codex do: a child process with a PreToolUse payload on
 * stdin. A refusal is exit 2 with the reason on stderr; an allowed call is exit 0 and no output.
 *
 * Run: node tools/test-no-publish-hook.js
 */
"use strict";
require("./test-guard.cjs"); // never a real mission control (test-guard.bash says why)
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const KIT = path.dirname(__dirname);
const STARTER = path.join(KIT, "starter-godspeed");
const HOOK = path.join(STARTER, ".claude", "hooks", "no-publish-in-the-persons-name.js");

function run(payload, raw) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: raw !== undefined ? raw : JSON.stringify(payload),
    encoding: "utf8",
    timeout: 10000,
  });
  if (r.status === 2) return { verdict: "deny", reason: r.stderr, stdout: r.stdout };
  if (r.status === 0) return { verdict: /"deny"/.test(r.stdout) ? "deny-json" : "allow", reason: r.stderr, stdout: r.stdout };
  return { verdict: "crash " + r.status, reason: r.stderr, stdout: r.stdout };
}
const pre = (tool, input, extra) => Object.assign({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input }, extra || {});
const sh = (command) => pre("Bash", { command });

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "  (" + String(detail || "").slice(0, 300) + ")"));
  if (!cond) failures++;
};
const expect = (name, r, want) => check(name, r.verdict === want, r.verdict + " " + (r.reason || r.stdout));

/* ---- Criterion 2: refuses sending ---- */
const SENDS = [
  ["Upload-Post MCP: upload text", pre("mcp__upload-post__upload_text", { user: "me", platform: ["linkedin"], title: "Hello" })],
  ["Upload-Post MCP: schedule a post", pre("mcp__upload-post__schedule_post", { text: "Hi", scheduled_date: "2026-12-01T09:00:00Z" })],
  ["Upload-Post HTTP: upload_text by curl", sh("curl -X POST https://api.upload-post.com/api/upload_text -H 'Authorization: Apikey $K' -F user=me -F platform[]=x -F title=Hi")],
  ["Upload-Post HTTP: upload_photos, no -X but a form body", sh("curl https://api.upload-post.com/api/upload_photos -F photos[]=@a.jpg -F user=me")],
  ["LinkedIn MCP: create a post", pre("mcp__linkedin__create_post", { text: "Big news" })],
  ["LinkedIn HTTP: POST to /rest/posts", sh("curl -X POST https://api.linkedin.com/rest/posts -H 'Content-Type: application/json' -d @post.json")],
  ["LinkedIn HTTP: a Python requests.post", sh("python3 -c \"import requests; requests.post('https://api.linkedin.com/v2/ugcPosts', json=body)\"")],
  ["X MCP: post a tweet", pre("mcp__x__post_tweet", { text: "hello" })],
  ["Twitter MCP: reply", pre("mcp__twitter__reply_to_tweet", { tweet_id: "1", text: "thanks" })],
  ["X HTTP: POST /2/tweets", sh("curl -X POST https://api.x.com/2/tweets -d '{\"text\":\"hi\"}'")],
  ["Facebook MCP: publish to a page", pre("mcp__facebook__publish_page_post", { message: "hi" })],
  ["Facebook HTTP: POST to /feed", sh("curl -X POST 'https://graph.facebook.com/v19.0/123/feed' -d message=hi")],
  ["Instagram MCP: publish media", pre("mcp__instagram__publish_media", { creation_id: "1" })],
  ["Instagram HTTP: media_publish", sh("curl -X POST https://graph.instagram.com/v19.0/1/media_publish -d creation_id=2")],
  ["Threads MCP: create a thread post", pre("mcp__threads__create_post", { text: "hi" })],
  ["Threads HTTP: threads_publish", sh("curl -X POST https://graph.threads.net/v1.0/me/threads_publish -d creation_id=2")],
  ["Reddit MCP: submit a post", pre("mcp__reddit__submit_post", { subreddit: "test", title: "hi" })],
  ["Reddit MCP: comment", pre("mcp__reddit__comment", { thing_id: "t3_1", text: "hi" })],
  ["Reddit HTTP: /api/submit", sh("curl -X POST https://oauth.reddit.com/api/submit -d sr=test -d title=hi")],
  ["TikTok MCP: upload a video", pre("mcp__tiktok__upload_video", { file: "a.mp4" })],
  ["TikTok HTTP: post publish", sh("curl -X POST https://open.tiktokapis.com/v2/post/publish/video/init/ -d '{}'")],
  ["Bluesky MCP: create a post", pre("mcp__bluesky__create_post", { text: "hi" })],
  ["Bluesky HTTP: createRecord", sh("curl -X POST https://bsky.social/xrpc/com.atproto.repo.createRecord -d @rec.json")],
  ["Mastodon MCP: post a status", pre("mcp__mastodon__post_status", { status: "hi" })],
  ["Mastodon HTTP: POST /api/v1/statuses", sh("curl -X POST https://mastodon.social/api/v1/statuses -d status=hi")],
  ["Mastodon HTTP: queued for later (scheduled_at)", sh("curl https://mastodon.social/api/v1/statuses --data status=hi --data scheduled_at=2026-12-01T09:00:00Z")],
  ["a generic HTTP tool with method POST to LinkedIn", pre("mcp__http__request", { url: "https://api.linkedin.com/rest/posts", method: "POST", body: "{}" })],
  ["a send after a read in one shell line", sh("curl https://api.upload-post.com/api/uploadposts/history && curl -X POST https://api.upload-post.com/api/upload_text -F title=hi")],
  ["a send on the next line of a script", sh("echo checking\ncurl -X POST https://api.x.com/2/tweets -d @t.json")],
  ["a Codex shell payload is judged the same way",
    pre("Bash", { command: "curl -X POST https://api.linkedin.com/rest/posts -d @p.json" }, { turn_id: "t1", model: "gpt", cwd: "/tmp", session_id: "s" })],
];
for (const [name, p] of SENDS) expect("refuses: " + name, run(p), "deny");

const CLICKS = [
  ["Post", pre("mcp__playwright__browser_click", { element: "Post", ref: "e12" })],
  ["Publish", pre("mcp__browser__click_by_text", { text: "Publish" })],
  ["Share", pre("mcp__browser__click_by_role", { role: "button", name: "Share" })],
  ["Tweet", pre("mcp__browser__click", { text: " tweet " })],
  ["Schedule", pre("mcp__browser__click", { selector: "button:has-text(\"Schedule\")" })],
  ["the Post button", pre("mcp__playwright__browser_click", { element: "Post button", ref: "e3" })],
];
for (const [name, p] of CLICKS) expect("refuses a browser click on " + name, run(p), "deny");

const refused = run(pre("mcp__linkedin__create_post", { text: "Big news" }));
check("the reason says the assistant prepares and the person posts",
  /You prepare; the person posts/.test(refused.reason) && /let them post it themselves/.test(refused.reason), refused.reason);
const clicked = run(CLICKS[0][1]);
check("a refused click says the same and names the control",
  /the person posts/.test(clicked.reason) && /"Post"/.test(clicked.reason), clicked.reason);

/* ---- Criterion 3: allows the rest ---- */
const ALLOWS = [
  // reading
  ["read: Upload-Post history over HTTP", sh("curl -H 'Authorization: Apikey $K' https://api.upload-post.com/api/uploadposts/history")],
  ["read: Upload-Post status of a job", sh("curl 'https://api.upload-post.com/api/uploadposts/status?request_id=abc'")],
  ["read: Upload-Post analytics", sh("curl https://api.upload-post.com/api/uploadposts/analytics/me")],
  ["read: Upload-Post MCP history", pre("mcp__upload-post__get_history", { user: "me" })],
  ["read: Upload-Post MCP status of an upload", pre("mcp__upload-post__get_upload_status", { request_id: "abc" })],
  ["read: LinkedIn list of posts (a GET)", sh("curl -X GET 'https://api.linkedin.com/rest/posts?author=urn:li:person:1&q=author'")],
  ["read: LinkedIn plain curl of posts", sh("curl 'https://api.linkedin.com/rest/posts?q=author'")],
  ["read: LinkedIn MCP analytics", pre("mcp__linkedin__get_post_analytics", { post_id: "1" })],
  ["read: X MCP timeline", pre("mcp__x__list_tweets", { user: "me" })],
  ["read: Mastodon status by id", sh("curl https://mastodon.social/api/v1/statuses/1234")],
  ["read: a generic HTTP tool with method GET", pre("mcp__http__request", { url: "https://api.linkedin.com/rest/posts?q=author", method: "GET" })],
  ["read: WebFetch of a posting endpoint", pre("WebFetch", { url: "https://api.x.com/2/tweets/1", prompt: "what does it say" })],
  ["read: searching the code for an endpoint", pre("Grep", { pattern: "api.upload-post.com/api/upload_text" })],
  // cancelling
  ["cancel: Upload-Post scheduled job over HTTP", sh("curl -X DELETE https://api.upload-post.com/api/uploadposts/schedule/job-123 -H 'Authorization: Apikey $K'")],
  ["cancel: Upload-Post MCP cancel a scheduled post", pre("mcp__upload-post__cancel_scheduled_post", { job_id: "job-123" })],
  ["cancel: LinkedIn delete a post", sh("curl -X DELETE https://api.linkedin.com/rest/posts/urn%3Ali%3Ashare%3A1")],
  ["cancel: X MCP delete a tweet", pre("mcp__x__delete_tweet", { id: "1" })],
  ["cancel: Mastodon delete a status", sh("curl --request DELETE https://mastodon.social/api/v1/statuses/1234")],
  ["cancel: Bluesky deleteRecord", sh("curl -X POST https://bsky.social/xrpc/com.atproto.repo.deleteRecord -d @del.json")],
  // drafting
  ["draft: writing a LinkedIn draft file", pre("Write", { file_path: "/home/p/mc/drafts/linkedin-post.md", content: "Draft for LinkedIn. Post it at https://api.linkedin.com/rest/posts" })],
  ["draft: editing a draft that names an upload endpoint", pre("Edit", { file_path: "/home/p/mc/drafts/x.md", old_string: "a", new_string: "curl -X POST https://api.upload-post.com/api/upload_text" })],
  ["draft: LinkedIn MCP create a draft", pre("mcp__linkedin__create_draft", { text: "Big news" })],
  ["draft: Typefully MCP save a draft", pre("mcp__typefully__save_draft", { content: "hi" })],
  ["draft: a Codex apply_patch writing a draft", pre("apply_patch", { input: "*** Add File: drafts/x.md\n+Tweet: hello" })],
  // other clicks and unrelated calls
  ["a click on another control (Save draft)", pre("mcp__browser__click_by_text", { text: "Save draft" })],
  ["a click on a field labelled Post text", pre("mcp__playwright__browser_click", { element: "Post text", ref: "e5" })],
  ["a click on Cancel", pre("mcp__browser__click", { text: "Cancel" })],
  ["an unrelated shell command", sh("git status && ls -la")],
  ["an unrelated POST", sh("curl -X POST https://example.org/api/things -d a=1")],
  ["an unrelated MCP send", pre("mcp__notebook__save_record", { type: "contacts", value: { name: "A" } })],
  ["a non-social server whose tool posts", pre("mcp__notebook__post_note", { text: "hi" })],
  ["a server whose name only contains x", pre("mcp__index__post_update", { text: "hi" })],
  ["a Read", pre("Read", { file_path: "/tmp/a" })],
];
for (const [name, p] of ALLOWS) expect("allows " + name, run(p), "allow");

/* ---- Criterion 4: any error lets the call through ---- */
const ERR = [
  ["empty stdin", null, ""],
  ["malformed stdin", null, "{nope"],
  ["a JSON array", null, "[1,2]"],
  ["JSON null", null, "null"],
  ["no tool_name", { hook_event_name: "PreToolUse", tool_input: { command: "curl -X POST https://api.x.com/2/tweets" } }],
  ["no tool_input", { hook_event_name: "PreToolUse", tool_name: "mcp__linkedin__create_post" }],
  ["a tool_input that is a string", { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: "curl -X POST https://api.x.com/2/tweets" }],
  ["a tool_name that is not a string", { hook_event_name: "PreToolUse", tool_name: 7, tool_input: {} }],
  ["a Stop payload", { hook_event_name: "Stop", stop_hook_active: false }],
];
for (const [name, p, raw] of ERR) {
  const r = run(p, raw);
  check("an error lets the call through: " + name, r.verdict === "allow" && r.stdout === "" && r.reason === "", r.verdict + r.stdout + r.reason);
}
// An exception inside the check: a tool_input whose getter throws cannot come over stdin, so a
// copy of the hook is made to throw while judging and must still allow.
{
  const src = fs.readFileSync(HOOK, "utf8");
  const broken = src.replace("checkPlatformTool(tool);", "checkPlatformTool(tool); throw new Error('boom');");
  check("the copy really has the throw", broken !== src);
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "kit-nopub-"));
  const f = path.join(tmp, "hook.js");
  fs.writeFileSync(f, broken);
  const r = spawnSync(process.execPath, [f], { input: JSON.stringify(sh("curl -X POST https://api.x.com/2/tweets -d a")), encoding: "utf8" });
  check("an exception while judging lets the call through", r.status === 0 && r.stdout === "", r.status + r.stdout + r.stderr);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- Criterion 5: turning it off is the owner's choice in the settings ---- */
const src = fs.readFileSync(HOOK, "utf8");
const header = src.slice(0, src.indexOf("*/"));
check("the header says to turn it off by removing its entry from the settings", /remove its entry/i.test(header) && /settings/.test(header), header);
check("the hook reads no environment variable, flag or file that could switch it off",
  !/process\.env|process\.argv|existsSync|readFileSync\((?!0)/.test(src), "found a switch");
expect("a payload asking to skip the check is still refused",
  run(pre("mcp__linkedin__create_post", { text: "hi", skip_no_publish_check: true, bypass: true })), "deny");

/* ---- Criterion 1 and 6: wiring ---- */
const settingsFile = path.join(STARTER, ".claude", "settings.json");
const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
const cmds = (hooks, ev) => ((hooks || {})[ev] || []).flatMap((g) => g.hooks || []).map((h) => h.command || "");
const ccCmd = cmds(settings.hooks, "PreToolUse").find((c) => /no-publish-in-the-persons-name\.js/.test(c)) || "";
check("Claude Code: registered as a PreToolUse hook in the starter's settings", !!ccCmd, JSON.stringify(settings));
check("Claude Code: the obligation-close Stop hook is still registered",
  cmds(settings.hooks, "Stop").some((c) => /obligation-close-check\.js/.test(c)), JSON.stringify(settings));
if (ccCmd) {
  const r = spawnSync("bash", ["-c", ccCmd], { cwd: STARTER, env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: STARTER }),
    input: JSON.stringify(pre("mcp__x__post_tweet", { text: "hi" })), encoding: "utf8" });
  check("Claude Code: its command line finds the hook and refuses", r.status === 2, r.status + r.stderr);
}
const codex = JSON.parse(fs.readFileSync(path.join(STARTER, ".codex", "hooks.json"), "utf8"));
const cxCmd = cmds(codex.hooks, "PreToolUse").find((c) => /no-publish-in-the-persons-name\.js/.test(c)) || "";
check("Codex: wired for PreToolUse", !!cxCmd, JSON.stringify(codex));
if (cxCmd) {
  // Codex runs the command in the session's folder. A mission control is its own folder (its own
  // repository, or none yet), so the command runs in a copy of the starter's hooks, outside this kit.
  const MC = fs.mkdtempSync(path.join(require("os").tmpdir(), "kit-nopub-mc-"));
  fs.cpSync(path.join(STARTER, ".claude", "hooks"), path.join(MC, ".claude", "hooks"), { recursive: true });
  const r = spawnSync("bash", ["-c", cxCmd], { cwd: MC,
    input: JSON.stringify(pre("Bash", { command: "curl -X POST https://api.x.com/2/tweets -d @t.json" }, { turn_id: "t", cwd: MC })), encoding: "utf8" });
  check("Codex: its command line finds the hook from the mission control's folder and refuses", r.status === 2, r.status + r.stderr);
  const ok = spawnSync("bash", ["-c", cxCmd], { cwd: MC, input: JSON.stringify(sh("ls")), encoding: "utf8" });
  check("Codex: its command line allows an unrelated command", ok.status === 0 && ok.stdout === "", ok.status + ok.stderr);
  fs.rmSync(MC, { recursive: true, force: true });
}
const parity = fs.readFileSync(path.join(KIT, "docs", "harness-parity.md"), "utf8");
const row = parity.split("\n").find((l) => /Refuses posting, scheduling or queueing/.test(l)) || "";
check("the parity document names the hook in the Claude Code column", /no-publish-in-the-persons-name\.js/.test(row.split("|")[2] || ""), row);
check("the parity document says what Codex does", /\.codex\/hooks\.json/.test(row.split("|")[4] || ""), row);

/* ---- Criterion 7: generalised ---- */
for (const f of [HOOK, path.join(STARTER, ".codex", "hooks.json"), __filename]) {
  const t = fs.readFileSync(f, "utf8");
  // Built from parts so this file does not name what it looks for.
  const personal = new RegExp(["mich" + "ael", "zel" + "bel", "plan" + "ino", "/home/god" + "speed", "\\bmy name\\b", "as" + "-me"].join("|"), "i");
  check("no owner name, personal path or host in " + path.basename(f), !personal.test(t), (t.match(personal) || [])[0]);
}
check("the hook is not named after a person", !new RegExp("mich" + "ael|my-name|as" + "-me", "i").test(path.basename(HOOK)));

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
