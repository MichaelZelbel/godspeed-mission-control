#!/usr/bin/env node
/**
 * no-publish-in-the-persons-name.js  -  PreToolUse hook (Claude Code and Codex)
 *
 * Purpose: the assistant may draft posts, comments and replies, but it cannot publish, schedule or
 * queue one on a social platform in the person's name. The person posts; the assistant prepares.
 *
 * Why a check and not a line in the instructions: "nothing goes out until I press the button",
 * written in the instructions, can be talked past in the moment. In the mission control this kit
 * comes from, a model published to LinkedIn anyway, by reading a tool option's description as
 * permission. A check on the tool call itself cannot be talked past.
 *
 * What it refuses: anything that SENDS.
 *   - an MCP tool of a social platform or a posting service whose name posts, publishes, schedules,
 *     queues, shares, replies, comments, submits or uploads (Upload-Post, LinkedIn, X/Twitter,
 *     Facebook, Instagram, Threads, Reddit, TikTok, Bluesky, Mastodon, Buffer, Hootsuite,
 *     Typefully)
 *   - a call to one of those platforms' posting endpoints, from a shell command (curl, a script)
 *     or from any tool whose arguments carry it, unless the call only reads or cancels
 *   - a browser click on a control named Post, Publish, Share, Tweet or Schedule
 *
 * What it allows, because this is how a mistake gets cleaned up:
 *   - reading: history, status, schedule listings, analytics, profiles
 *   - cancelling: deleting a scheduled job, deleting or un-publishing a post
 *   - drafting: writing files, and a platform tool that only makes a draft
 *   - a browser click on any other control, and every unrelated tool call
 *
 * On any error (empty or broken input, a missing field, an exception) it allows: it can never trap
 * a session. It is a guard against one known failure, not a general gate.
 *
 * Turning it off is the person's choice, made in the settings and nowhere else: remove its entry
 * from .claude/settings.json (and from .codex/hooks.json for Codex). Nothing in a tool call can
 * switch it off: it reads no flag, file or environment variable that would let it pass.
 *
 * How it answers: a refused call exits 2 with the reason on stderr, which Claude Code and Codex
 * both hand back to the assistant. An allowed call exits 0 and prints nothing.
 */

"use strict";

// The posting endpoints of the platforms. Each one SENDS when it is called with a body.
const SENDING_ENDPOINTS = [
  // Upload-Post: the endpoints that publish or schedule (upload, upload_text, upload_photos, upload_document)
  /api\.upload-post\.com\/api\/upload(_text|_photos|_document|_video)?\b/i,
  /api\.linkedin\.com\/[^\s"']*\/(ugcPosts|posts|shares|socialActions)/i,
  /api\.(twitter|x)\.com\/[0-9.]*\/?(tweets|statuses\/update)/i,
  /graph\.facebook\.com\/[^\s"']*\/(feed|photos|videos|media_publish|comments)/i,
  /graph\.instagram\.com\/[^\s"']*\/(media|media_publish|comments|replies)/i,
  /graph\.threads\.net\/[^\s"']*\/(threads|threads_publish|replies)/i,
  /oauth\.reddit\.com\/api\/(submit|comment)/i,
  /open(-?api)?\.tiktok(apis)?\.com\/[^\s"']*\/(post|publish)/i,
  /(bsky\.social|bsky\.app|[\w.-]+)\/xrpc\/com\.atproto\.repo\.(createRecord|applyWrites)/i,
  /\/api\/v1\/(statuses|scheduled_statuses)\b/i, // Mastodon
  /api\.bufferapp\.com\/[^\s"']*\/updates\/create/i,
  /platform\.hootsuite\.com\/[^\s"']*\/messages/i,
];

// Paths on those hosts that only read: history, status, schedule listings, analytics, profiles.
const READ_ONLY_PATHS =
  /uploadposts\/(status|history|schedule|me|users|analytics|post-analytics|total-impressions|linkedin\/pages|facebook\/pages)/i;

// How a single call says what it does. A body (-d, --data, -F, --json, -T) or a POST, PUT or PATCH
// sends. A GET or DELETE only reads or cancels. A plain curl or wget with neither is a GET.
const SENDS =
  /(?<![\w-])-X\s*(POST|PUT|PATCH)\b|--request[\s=]+(POST|PUT|PATCH)\b|\bmethod\W{0,6}(POST|PUT|PATCH)\b|\.(post|put|patch)\s*\(|(?<![\w-])(-d|-F|--data[\w-]*|--form[\w-]*|--json|-T|--upload-file)(?![\w-])/i;
const READS_OR_CANCELS =
  /(?<![\w-])-X\s*(GET|DELETE|HEAD)\b|--request[\s=]+(GET|DELETE|HEAD)\b|\bmethod\W{0,6}(GET|DELETE|HEAD)\b|\.(get|delete|head)\s*\(|\bdeleteRecord\b/i;
const PLAIN_FETCH = /(?<![\w-])(curl|wget)(?![\w-])/i;

// One shell line can hold several commands. Each is judged on its own, so a read in the first
// cannot wave through a send in the second (a status read, then && and an upload). The arguments
// are JSON, so a line break in a command arrives as the two characters \n.
const COMMAND_SPLIT = /;|&&|\|\|?|\\n|\\r/;

// Tools that only read or write the person's own files, or hand work to another assistant whose
// own calls pass this check too. Writing a draft or a script that names an endpoint is drafting,
// and searching for one is reading.
const LOCAL_TOOLS = new Set([
  "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Grep", "Glob", "LS", "TodoWrite",
  "Task", "Agent", "WebFetch", "WebSearch",
  // Codex names
  "apply_patch", "read_file", "list_dir", "view_image", "update_plan",
]);

// MCP servers of social platforms and posting services, matched on whole words of the server's
// name (`mcp__<server>__<tool>`), so `x` matches a server named x but not one named "index".
const PLATFORM_WORDS = new Set([
  "uploadpost", "upload-post", "linkedin", "x", "twitter", "facebook", "fb", "instagram",
  "ig", "threads", "reddit", "tiktok", "bluesky", "bsky", "atproto", "mastodon", "buffer",
  "hootsuite", "typefully", "social", "socials", "publer", "postiz", "ayrshare",
]);

// Tool names, judged in this order: a draft, a cancel, a name that starts with a read verb, a name
// that starts with a send verb (post_status sends), a name about history or analytics, and last
// any send verb inside the name (create_post, linkedin_share).
const DRAFT_TOOL = /(^|[_-])drafts?([_-]|$)/i;
const CANCEL_TOOL = /(^|[_-])(cancel|delete|remove|unschedule|unpublish|undo|retract|withdraw|dequeue)([_-]|$)/i;
const READ_VERB = /^(get|list|read|fetch|search|find|view|show|lookup|describe|count|check)([_-]|$)/i;
const SEND_PREFIX = /^(upload|post|publish|schedule|queue|share|tweet|retweet|repost|reply|comment|submit|toot|boost|send)/i;
const READ_NOUN = /(^|[_-])(history|status|analytics|insights|metrics|stats|profile|profiles|me|whoami|accounts?|pages|timeline|mentions)([_-]|$)/i;
const SEND_TOOL = /(^|[_-])(post|posts|publish|schedule|queue|enqueue|share|reshare|tweet|retweet|repost|reply|comment|submit|upload|uploads|toot|boost|send|create_(post|tweet|status|comment|reply|thread|media|record|update|share))([_-]|$)/i;

// Browser controls that send, matched on the whole label, not a part of it: "Post text" as a
// field label does not trip it, a "Post" button does.
const SEND_LABEL = /^\s*(the\s+)?(post|publish|share|tweet|schedule|post now|publish now|share now|send post|schedule post|post all)(\s+(button|link))?\s*$/i;
const CLICK_TOOL = /click|^mcp__.*(tap|press)/i;
const LABEL_FIELDS = ["text", "name", "label", "element", "selector", "title", "aria_label", "ariaLabel", "description"];

function allow() {
  process.exit(0);
}

function deny(what) {
  process.stderr.write(
    "Refused by the no-publish check: " + what + ".\n\n" +
    "You prepare; the person posts. Nothing goes onto a social platform in their name from you: " +
    "no post, comment or reply, and nothing scheduled or queued to go out later. That holds even " +
    "when they approved the wording (approving text is not saying send), said \"let's test it\", " +
    "gave you an API key (a key is a means, not an instruction), when a tool's option seems to " +
    "permit it, or when the post is good, scheduled far ahead, or could be cancelled afterwards.\n\n" +
    "What to do instead: put the finished text in front of the person (in your reply, or as a " +
    "draft file) and let them post it themselves. Reading, listing and cancelling stay allowed, " +
    "so use them freely to check or clean up. If you think this check is wrong, say so and stop. " +
    "Do not route around it. Only the person can turn it off, in their settings.\n"
  );
  process.exit(2); // exit 2 refuses the tool call; stderr goes back to the assistant
}

function serverWords(server) {
  const s = String(server || "").toLowerCase();
  const out = new Set(s.split(/[^a-z0-9]+/).filter(Boolean));
  out.add(s.replace(/[^a-z0-9]/g, ""));
  return out;
}

function isPlatformServer(server) {
  for (const w of serverWords(server)) if (PLATFORM_WORDS.has(w)) return true;
  return false;
}

// 1. A browser click on a control named Post / Publish / Share / Tweet / Schedule. A label can sit
//    inside a selector (button:has-text("Post"), [aria-label="Publish"]), so quoted parts count too.
function checkClick(input) {
  const labels = [];
  for (const k of LABEL_FIELDS) if (typeof input[k] === "string") labels.push(input[k]);
  for (const l of labels.slice()) {
    for (const m of l.matchAll(/["'“”‘’]([^"'“”‘’]{1,40})["'“”‘’]/g)) labels.push(m[1]);
  }
  const hit = labels.find((l) => SEND_LABEL.test(l));
  if (hit) deny('a browser click on a control named "' + hit.trim() + '"');
}

// 2. An MCP tool of a posting platform, judged by its own name.
function checkPlatformTool(tool) {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (!m || !isPlatformServer(m[1])) return;
  const name = m[2];
  if (DRAFT_TOOL.test(name) && !/(publish|send)/i.test(name)) return;
  if (CANCEL_TOOL.test(name)) return;
  if (READ_VERB.test(name)) return;
  const sends = SEND_PREFIX.test(name) || (!READ_NOUN.test(name) && SEND_TOOL.test(name));
  if (sends) {
    deny('the posting tool "' + tool + '" (it publishes, schedules or queues in the person\'s name)');
  }
}

// 3. Any call whose arguments reach a posting endpoint and do more than read or cancel.
function checkEndpoints(input) {
  const blob = JSON.stringify(input);
  for (const seg of blob.split(COMMAND_SPLIT)) {
    const rx = SENDING_ENDPOINTS.find((r) => r.test(seg));
    if (!rx) continue;
    if (READ_ONLY_PATHS.test(seg) && !SENDS.test(seg)) continue;
    if (SENDS.test(seg)) deny("a call that sends to a social posting endpoint (" + rx.source + ")");
    if (READS_OR_CANCELS.test(seg)) continue;
    if (PLAIN_FETCH.test(seg)) continue; // curl or wget with no body and no method is a GET
    deny("a call to a social posting endpoint that does not say it only reads (" + rx.source + ")");
  }
}

function main() {
  let payload;
  try {
    payload = JSON.parse(require("fs").readFileSync(0, "utf8"));
  } catch (_) {
    allow();
  }
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) allow();
    const event = payload.hook_event_name ?? payload.hookEventName;
    if (event && event !== "PreToolUse") allow();
    const tool = payload.tool_name ?? payload.toolName;
    const input = payload.tool_input ?? payload.toolInput;
    if (typeof tool !== "string" || !tool) allow();
    if (!input || typeof input !== "object") allow();
    if (LOCAL_TOOLS.has(tool)) allow();
    if (CLICK_TOOL.test(tool)) {
      checkClick(input);
      allow(); // any other click goes through, even on a platform's page
    }
    checkPlatformTool(tool);
    checkEndpoints(input);
  } catch (_) {
    allow();
  }
  allow();
}

main();
