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
# A rule fires once unless it says "times". Only standard library, so it runs anywhere.
import argparse
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Fake:
    def __init__(self, token, scenario, record=None):
        self.token = token
        self.cv = threading.Condition()
        self.updates, self.sent, self.edits, self.calls, self.deleted = [], [], [], {}, []
        self.next_update, self.next_msg = 1, 100
        self.users = scenario.get("users", {})
        self.rules = scenario.get("rules", [])
        self.record = record
        with self.cv:
            for a in scenario.get("start", []):
                self.act(a)

    def act(self, a):
        uid = a["from"]
        user = dict({"id": uid, "is_bot": False}, **self.users.get(str(uid), {"first_name": "User%s" % uid}))
        chat = {"id": uid, "type": "private"}
        if "text" in a:
            upd = {"message": {"message_id": self.next_msg, "from": user, "chat": chat,
                               "date": int(time.time()), "text": a["text"]}}
            self.next_msg += 1
        else:
            msg = next((m for m in reversed(self.sent) if m["chat_id"] == uid and a["press"] in m["buttons"]), None)
            upd = {"callback_query": {"id": "cq%d" % self.next_update, "from": user, "data": a["press"],
                                      "message": {"message_id": msg["message_id"] if msg else 0, "chat": chat}}}
        upd["update_id"] = self.next_update
        self.next_update += 1
        self.updates.append(upd)
        self.cv.notify_all()

    def handle(self, method, p):
        with self.cv:
            self.calls[method] = self.calls.get(method, 0) + 1
            if method == "getMe":
                return {"id": 42, "is_bot": True, "first_name": "Godspeed", "username": "test_godspeed_bot"}
            if method == "getUpdates":
                off = p.get("offset") or 0
                self.updates = [u for u in self.updates if u["update_id"] >= off]
                if not self.updates:
                    self.cv.wait(min(float(p.get("timeout") or 0), 2.0))
                return list(self.updates)
            if method == "sendMessage":
                kb = (p.get("reply_markup") or {}).get("inline_keyboard") or []
                m = {"chat_id": p.get("chat_id"), "text": p.get("text", ""), "message_id": self.next_msg,
                     "buttons": [b.get("callback_data") for row in kb for b in row]}
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
                self.save()
                return {"message_id": m["message_id"], "chat": {"id": m["chat_id"]}, "text": m["text"]}
            if method == "deleteMessage":
                self.deleted.append(p.get("message_id"))
            if method == "editMessageText":
                self.edits.append(p.get("text", ""))
                self.save()
            return True

    def save(self):
        if self.record:
            with open(self.record, "w", encoding="utf-8") as f:
                json.dump({"sent": self.sent, "edits": self.edits, "calls": self.calls, "deleted": self.deleted}, f, indent=1)


def serve(fake, port=0):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            self._go()

        def do_GET(self):
            self._go()

        def _go(self):
            m = re.match(r"^/bot([^/]+)/(\w+)", self.path)
            n = int(self.headers.get("Content-Length") or 0)
            try:
                p = json.loads(self.rfile.read(n).decode() or "{}") if n else {}
            except ValueError:
                p = {}
            if not m or m.group(1) != fake.token:
                code, body = 401, {"ok": False, "error_code": 401, "description": "Unauthorized"}
            else:
                code, body = 200, {"ok": True, "result": fake.handle(m.group(2), p)}
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
