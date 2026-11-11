#!/usr/bin/env python3
# A stand-in for Telegram's Bot API, for the Telegram setup's tests only
# (docker/test/test-telegram-setup.py on any computer, docker/test.sh inside the image).
#
# It plays the reader: a scenario file says what the reader writes first, and which
# button they press or what they type when the bot says something matching a pattern.
# Everything the bot sent is written to a record file for the test to read.
#
#   python3 fake-telegram.py --port 8081 --token 123:abc --scenario s.json --record r.json
#
# Scenario: {"users": {"111": {"first_name": "Anna", "username": "anna"}},
#            "start": [{"from": 111, "text": "/start"}],
#            "rules": [{"when": "morning brief", "do": [{"from": 111, "press": "brief:yes"}]}]}
# A rule fires once unless it says "times". A reader can also send a file:
# {"from": 111, "document": {"file_name": "notes.md", "content": "..."}}, fetched back
# through getFile and /file/bot<token>/<path> like Telegram's. An action with "after": 9
# happens nine seconds later, as a reader who takes their time. Every sendChatAction
# ("typing...") is kept with its time, and every button with its label. Only standard
# library, so it runs anywhere.
import argparse
import email.parser
import email.policy
import json
import os
import re
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# buttons.py drops a tap unless the message it edits was sent by getMe's bot, so both must be this one record.
BOT = {"id": 42, "is_bot": True, "first_name": "Godspeed"}
# Fields whose form value is the text itself; every other form value is JSON, as Telegram reads it.
PLAIN_FIELDS = {"text", "caption", "parse_mode", "action", "url", "secret_token", "file_name"}


def parameters(content_type, body):
    """A Bot API request's parameters, sent the way any client sends them: JSON (the setup chat), a
    form or a multipart form (python-telegram-bot, so Hermes' gateway and its routine deliveries)."""
    kind = (content_type or "").split(";")[0].strip().lower()
    if not body:
        return {}
    if kind == "application/x-www-form-urlencoded":
        fields = dict(urllib.parse.parse_qsl(body.decode("utf-8"), keep_blank_values=True))
    elif kind == "multipart/form-data":
        form = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
            b"Content-Type: " + content_type.encode("latin-1") + b"\r\n\r\n" + body)
        fields = {}
        for part in form.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if name and part.get_filename() is None:
                fields[name] = part.get_payload(decode=True).decode("utf-8")
    else:
        try:
            return json.loads(body.decode() or "{}")
        except ValueError:
            return {}
    decoded = {}
    for key, value in fields.items():
        if key in PLAIN_FIELDS:
            decoded[key] = value
            continue
        try:
            decoded[key] = json.loads(value)
        except ValueError:
            decoded[key] = value
    return decoded


def shown(p, field):
    """The text as the reader sees it. A MarkdownV2 message (Hermes' gateway sends them) loses its
    escapes and its formatting marks, and a link shows only its text."""
    text = p.get(field, "")
    if not isinstance(text, str) or p.get("parse_mode") != "MarkdownV2":
        return text
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == "\\" and i + 1 < n:
            out.append(text[i + 1])
            i += 2
            continue
        if c == "]" and text[i + 1:i + 2] == "(":
            # the end of a link's text: skip its address, up to the unescaped ")"
            i += 2
            while i < n and text[i] != ")":
                i += 2 if text[i] == "\\" else 1
            i += 1
            continue
        if c == ">" and (i == 0 or text[i - 1] == "\n"):
            i += 2 if text[i + 1:i + 2] == " " else 1
            continue
        if c in "*_~`|[":
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def message(m):
    """The Message Telegram answers a send with; python-telegram-bot rejects one without date or chat type."""
    return {"message_id": m["message_id"], "date": int(m["t"]), "from": BOT,
            "chat": {"id": m["chat_id"], "type": "private"}, "text": m["text"]}


class Fake:
    def __init__(self, token, scenario, record=None):
        self.token = token
        self.cv = threading.Condition()
        self.updates, self.sent, self.edits, self.calls, self.deleted, self.requests = [], [], [], {}, [], []
        self.actions = []   # sendChatAction: {"t": time, "chat_id": ..., "action": "typing"}
        self.files = {}
        self.next_update, self.next_msg = 1, 100
        self.users = scenario.get("users", {})
        self.rules = scenario.get("rules", [])
        self.record = record
        with self.cv:
            for a in scenario.get("start", []):
                self.act(a)

    def later(self, a):
        with self.cv:
            self.act(a)

    def act(self, a):
        if a.get("after"):
            t = threading.Timer(a["after"], self.later, [dict(a, after=0)])
            t.daemon = True
            t.start()
            return
        uid = a["from"]
        user = dict({"id": uid, "is_bot": False}, **self.users.get(str(uid), {"first_name": "User%s" % uid}))
        chat = {"id": uid, "type": "private"}
        if "text" in a:
            upd = {"message": {"message_id": self.next_msg, "from": user, "chat": chat,
                               "date": int(time.time()), "text": a["text"]}}
            self.next_msg += 1
        elif "document" in a:
            d = a["document"]
            data = d.get("content", "").encode("utf-8") if "content" in d else bytes.fromhex(d.get("hex", ""))
            fid = "file%d" % (len(self.files) + 1)
            self.files[fid] = data
            upd = {"message": {"message_id": self.next_msg, "from": user, "chat": chat, "date": int(time.time()),
                               "document": {"file_id": fid, "file_unique_id": fid, "file_name": d["file_name"],
                                            "mime_type": d.get("mime_type", "text/markdown"),
                                            "file_size": d.get("file_size", len(data))}}}
            self.next_msg += 1
        else:
            msg = next((m for m in reversed(self.sent) if m["chat_id"] == uid
                        and any(button["callback"] == a["press"] for button in m["buttons"])), None)
            upd = {"callback_query": {"id": "cq%d" % self.next_update, "from": user, "data": a["press"],
                                      "message": {"message_id": msg["message_id"] if msg else 0, "chat": chat,
                                                  "from": BOT,
                                                  "text": msg["text"] if msg else ""}}}
        upd["update_id"] = self.next_update
        self.next_update += 1
        self.updates.append(upd)
        self.cv.notify_all()

    def handle(self, method, p):
        with self.cv:
            self.calls[method] = self.calls.get(method, 0) + 1
            if method == "getFile":
                fid = p.get("file_id")
                return {"file_id": fid, "file_size": len(self.files.get(fid, b"")), "file_path": "documents/%s" % fid}
            if method == "getMe":
                return dict(BOT, username="test_godspeed_bot")
            if method == "getUpdates":
                off = p.get("offset") or 0
                self.updates = [u for u in self.updates if u["update_id"] >= off]
                if not self.updates:
                    self.cv.wait(min(float(p.get("timeout") or 0), 2.0))
                return list(self.updates)
            if method == "sendMessage":
                kb = (p.get("reply_markup") or {}).get("inline_keyboard") or []
                m = {"chat_id": p.get("chat_id"), "text": shown(p, "text"), "message_id": self.next_msg,
                     "buttons": [{"label": b.get("text"), "callback": b.get("callback_data")}
                                 for row in kb for b in row], "t": time.time()}
                self.next_msg += 1
                self.sent.append(m)
                for r in self.rules:
                    if r.get("fired", 0) >= r.get("times", 1):
                        continue
                    if r.get("to") not in (None, m["chat_id"]):
                        continue
                    if re.search(r["when"], m["text"], re.S):
                        r["fired"] = r.get("fired", 0) + 1
                        for a in r["do"]:
                            self.act(a)
                return message(m)
            if method == "sendDocument":
                m = {"chat_id": p.get("chat_id"), "text": shown(p, "caption"), "message_id": self.next_msg,
                     "buttons": [], "t": time.time()}
                self.next_msg += 1
                self.sent.append(m)
                return message(m)
            if method == "getWebhookInfo":
                return {"url": "", "has_custom_certificate": False, "pending_update_count": 0}
            if method == "sendChatAction":
                self.actions.append({"t": time.time(), "chat_id": p.get("chat_id"), "action": p.get("action")})
            if method == "deleteMessage":
                self.deleted.append(p.get("message_id"))
            if method == "editMessageText":
                self.edits.append(shown(p, "text"))
            return True

    def request(self, method, authorized, p):
        # Evidence names the API operation and safe message metadata only.  In particular it never
        # retains the path token or inbound text, which can carry a provider key during setup.
        with self.cv:
            safe = {"method": method, "authorized": authorized, "t": time.time()}
            if "chat_id" in p:
                safe["chat_id"] = p["chat_id"]
            if "message_id" in p:
                safe["message_id"] = p["message_id"]
            if method == "sendMessage":
                safe["buttons"] = sum(len(row) for row in ((p.get("reply_markup") or {}).get("inline_keyboard") or []))
            self.requests.append(safe)

    def save(self):
        if self.record:
            with self.cv:
                snapshot = {"sent": self.sent, "edits": self.edits, "calls": self.calls, "deleted": self.deleted,
                            "actions": self.actions, "requests": self.requests}
                directory = os.path.dirname(os.path.abspath(self.record))
                fd, temporary = tempfile.mkstemp(prefix=".fake-telegram-", dir=directory)
                try:
                    with os.fdopen(fd, "w", encoding="utf-8") as f:
                        json.dump(snapshot, f, indent=1)
                        f.flush()
                        os.fsync(f.fileno())
                    os.replace(temporary, self.record)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)


def serve(fake, port=0):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            self._go()

        def do_GET(self):
            self._go()

        def _go(self):
            if self.path == "/__act":
                # A test acting as the reader at a moment it chooses (docker/full-candidate/test-browser.cjs:
                # pressing Start with the one-time code the web page showed).
                n = int(self.headers.get("Content-Length") or 0)
                with fake.cv:
                    fake.act(json.loads(self.rfile.read(n).decode()))
                self.send_response(204)
                self.end_headers()
                return
            f = re.match(r"^/file/bot([^/]+)/documents/(\w+)$", self.path)
            if f and f.group(1) == fake.token and f.group(2) in fake.files:
                data = fake.files[f.group(2)]
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            m = re.match(r"^/bot([^/]+)/(\w+)", self.path)
            n = int(self.headers.get("Content-Length") or 0)
            p = parameters(self.headers.get("Content-Type"), self.rfile.read(n) if n else b"")
            method = m.group(2) if m else "invalid"
            authorized = bool(m and m.group(1) == fake.token)
            with fake.cv:
                fake.request(method, authorized, p)
                if not authorized:
                    code, body = 401, {"ok": False, "error_code": 401, "description": "Unauthorized"}
                else:
                    code, body = 200, {"ok": True, "result": fake.handle(method, p)}
                fake.save()
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--token", required=True)
    ap.add_argument("--scenario", required=True)
    ap.add_argument("--record", required=True)
    a = ap.parse_args()
    with open(a.scenario, encoding="utf-8") as f:
        fk = Fake(a.token, json.load(f), a.record)
    fk.save()
    serve(fk, a.port)
    while True:
        time.sleep(3600)
