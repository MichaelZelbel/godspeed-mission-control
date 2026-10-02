#!/usr/bin/env python3
# For docker/test.sh only: can the assistant read web pages with its own browser, in this
# image, as the account it runs as? It goes through the same door a model's tool call does
# (model_tools: the tool list a Telegram chat is offered, then handle_function_call), so no
# AI model and no key are needed. Run as hermes with Hermes' Python:
#
#   probe-browser.py <public address> <words that page must show>
#
# Prints one line per promise, in test.sh's own PASS / FAIL form:
#   offered  the chat is offered browser_navigate and browser_snapshot (not only browser_exec)
#   local    a page served inside the container comes back word for word
#   public   the public page opens and its text holds the words
import http.server
import json
import secrets
import sys
import threading
import time

sys.path.insert(0, "/opt/hermes")
import model_tools  # noqa: E402

PUBLIC_URL, PUBLIC_WORDS = sys.argv[1], sys.argv[2]
TASK = "godspeed-browse-probe"


def say(ok, what, detail=""):
    detail = " | ".join(line.strip() for line in str(detail).splitlines() if line.strip())[:600]
    print(("PASS  " if ok else "FAIL  ") + what + (f" ({detail})" if detail else ""), flush=True)


def call(name, args):
    raw = model_tools.handle_function_call(name, args, task_id=TASK)
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return {"success": False, "error": str(raw)[:400]}


def read_page(url):
    """browser_navigate, then the whole page through browser_snapshot: (title, text, error)."""
    t0 = time.time()
    nav = call("browser_navigate", {"url": url})
    if not nav.get("success"):
        return "", "", f"browser_navigate: {nav.get('error', nav)}"
    snap = call("browser_snapshot", {"full": True})
    if not snap.get("success"):
        return nav.get("title", ""), "", f"browser_snapshot: {snap.get('error', snap)}"
    return nav.get("title", ""), snap.get("snapshot", ""), f"{time.time() - t0:.1f}s"


offered = {d["function"]["name"] for d in model_tools.get_tool_definitions(
    enabled_toolsets=["hermes-telegram"], quiet_mode=True)}
want = {"browser_navigate", "browser_snapshot"}
say(want <= offered, "the assistant is offered its own browser tools",
    "offered: " + (", ".join(sorted(n for n in offered if n.startswith("browser_"))) or "no browser tool"))

token = "godspeed-" + secrets.token_hex(6)
page = (f"<!doctype html><title>Godspeed browse check</title>"
        f"<p>The assistant read this page: {token}</p>").encode()


class Page(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.end_headers()
        self.wfile.write(page)

    def log_message(self, *_):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Page)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    title, text, note = read_page(f"http://127.0.0.1:{server.server_address[1]}/")
    say(token in text and title == "Godspeed browse check",
        "the assistant's browser reads a page word for word", note if token in text else f"{note}; got: {text[:200]!r}")

    title, text, note = read_page(PUBLIC_URL)
    found = PUBLIC_WORDS.lower() in f"{title}\n{text}".lower()
    say(found, f"the assistant's browser reads a public page, {PUBLIC_URL}",
        f"{note}, title {title[:60]!r}" if found else f"{note}; title {title!r}, text: {text[:300]!r}")
finally:
    server.shutdown()
    try:
        from tools.browser_tool_lifecycle import cleanup_browser
        cleanup_browser(TASK)
    except Exception:
        pass
