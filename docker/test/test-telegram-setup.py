#!/usr/bin/env python3
# The Telegram setup's own test (docker/rootfs/usr/local/bin/godspeed-telegram-setup),
# with no Docker, no Telegram, no ChatGPT and no GitHub: run by CI before the image test,
# and by hand on any computer with Python 3:
#
#   python3 docker/test/test-telegram-setup.py
#
# A stand-in Telegram (fake-telegram.py) plays the reader; stand-ins for hermes, gh and
# the installer print what the real ones print and record how they were called. Walks
# the happy path, then every road back from a snag: a stranger who writes first, a
# code that runs out, a wrong repository address, an installer that stops. Prints
# PASS or FAIL per check and exits 1 when any check failed.
import importlib.machinery
import importlib.util
import json
import os
import shlex
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PROGRAM = os.path.join(ROOT, "docker", "rootfs", "usr", "local", "bin", "godspeed-telegram-setup")
TOKEN = "123456789:TESTtoken_never-logged"
FAILS = 0


def load(name, path):
    spec = importlib.util.spec_from_loader(name, importlib.machinery.SourceFileLoader(name, path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


fake_telegram = load("fake_telegram", os.path.join(HERE, "fake-telegram.py"))


def check(what, ok):
    global FAILS
    print("%s  %s" % ("PASS" if ok else "FAIL", what))
    if not ok:
        FAILS += 1


def fwd(p):
    return p.replace("\\", "/")


FAKE_HERMES = r'''
import json, os, sys, time
d = os.environ["FAKE_DIR"]; a = sys.argv[1:]
open(os.path.join(d, "hermes-calls"), "a").write(" ".join(a) + "\n")
mark = os.path.join(d, "chatgpt-signed-in")
if a[:2] == ["auth", "list"]:
    if os.path.exists(mark): print("openai-codex (1 credential)")
    sys.exit(0)
state_f = os.path.join(d, "hermes-state.json")
st = json.load(open(state_f)) if os.path.exists(state_f) else {"keys": {}}
def save(): json.dump(st, open(state_f, "w"))
if a[:3] == ["config", "set", "model.provider"]:
    st["provider"] = a[3]; save(); sys.exit(0)
if a[:3] == ["config", "set", "model.default"]:
    st["model"] = a[3]; save(); sys.exit(0)
if a[:2] == ["auth", "remove"]:
    st["keys"].pop(a[2], None); save(); sys.exit(0)
if a[:2] == ["auth", "add"] and "api-key" in a:
    # What hermes_cli/auth_commands.py does: --api-key, or else it asks, and with no
    # terminal the answer is read from standard input.
    key = a[a.index("--api-key") + 1] if "--api-key" in a else sys.stdin.readline().strip()
    st["keys"][a[2]] = key; save(); print("Added %s credential" % a[2]); sys.exit(0)
if a[:2] == ["chat", "--oneshot"]:
    # The proof question: ChatGPT answers only on the models the plan may use, a key only when good.
    p = st.get("provider")
    if p == "openai-codex":
        ok = os.path.exists(mark) and st.get("model") in os.environ.get("FAKE_CODEX_OK", "gpt-5.6-terra").split(",")
    else:
        ok = "bad" not in st["keys"].get(p, "bad")
    if ok: print("ready"); sys.exit(0)
    print("Provider said: HTTP 400: {\"detail\":\"The '%s' model is not supported\"}" % st.get("model")); sys.exit(1)
if a[:2] == ["auth", "add"]:
    # What hermes_cli/auth_codex.py prints, colours included.
    print("To continue, follow these steps:\n")
    print("  1. Open this URL in your browser:")
    print("     \033[94mhttps://auth.openai.com/codex/device\033[0m\n")
    print("  2. Enter this code:")
    print("     \033[94mABCD-12345\033[0m\n")
    print("Waiting for sign-in... (press Ctrl+C to cancel)", flush=True)
    first = os.path.join(d, "chatgpt-failed-once")
    if os.environ.get("FAKE_HERMES_FAIL_FIRST") and not os.path.exists(first):
        open(first, "w").close(); time.sleep(1); print("Login failed: the code expired"); sys.exit(1)
    time.sleep(1.5); open(mark, "w").close(); print('Added openai-codex OAuth credential #1'); sys.exit(0)
if a[:1] == ["send"]:
    open(os.path.join(d, "hermes-sent"), "a").write(sys.stdin.read()); sys.exit(0)
sys.exit(0)
'''

FAKE_GH = r'''
import os, sys, time
d = os.environ["FAKE_DIR"]; a = sys.argv[1:]
open(os.path.join(d, "gh-calls"), "a").write(" ".join(a) + "\n")
mark = os.path.join(d, "github-signed-in")
if a[:2] == ["auth", "status"]: sys.exit(0 if os.path.exists(mark) else 1)
if a[:2] == ["auth", "login"] and "--skip-ssh-key" in a:
    sys.stderr.write("unknown flag: --skip-ssh-key\n\nUsage:  gh auth login [flags]\n"); sys.exit(1)
if a[:2] == ["auth", "login"]:
    sys.stderr.write("! First copy your one-time code: 1A2B-3C4D\n")
    sys.stderr.write("Open this URL to continue in your web browser: https://github.com/login/device\n")
    sys.stderr.flush(); time.sleep(1.5); open(mark, "w").close(); sys.exit(0)
if a[:2] == ["api", "user"]: print("anna"); sys.exit(0)
if a[:2] == ["repo", "view"]:
    have = [r for r in os.environ.get("FAKE_GH_REPOS", "").split(",") if r]
    sys.exit(0 if a[2] in have else 1)
sys.exit(0)
'''

FAKE_SETUP = r'''
import json, os, subprocess, sys, time
d = os.environ["FAKE_DIR"]
keys = ["KB_TELEGRAM_SKIP", "KB_SIGNIN_SKIP", "KB_MORNING_BRIEF", "KB_OBSERVED_STATE", "GODSPEED_INSTALL_COUNT", "GODSPEED_REPO", "KB_REPO_NAME",
        "GODSPEED_TELEGRAM_TOKEN", "GODSPEED_TELEGRAM_OWNER"]
runs = os.path.join(d, "setup-runs.json")
seen = json.load(open(runs)) if os.path.exists(runs) else []
seen.append({k: os.environ.get(k) for k in keys}); json.dump(seen, open(runs, "w"))
print("\n== \033[1mInstalling your assistant\033[0m", flush=True); time.sleep(1)
print("   ok: installed", flush=True)
print("\n== Your folder", flush=True); time.sleep(2)
if os.environ.get("FAKE_SETUP_FAIL_FIRST") and len(seen) == 1:
    print("\n== Giving your mission control a checked private GitHub home")
    print("\033[1;31m[stop]\033[0m the private GitHub repository was not created or checked.", file=sys.stderr)
    sys.exit(1)
g = os.environ["GODSPEED"]
origin = os.environ.get("GODSPEED_REPO") or "https://github.com/anna/%s.git" % os.environ.get("KB_REPO_NAME", "godspeed")
subprocess.run(["git", "init", "-q", g], check=True)
subprocess.run(["git", "-C", g, "remote", "add", "origin", origin], check=True)
print("   ok: done")
'''

FAKE_FINISH = r'''
import json, os, sys, time
d = os.environ["FAKE_DIR"]
if sys.argv[1:] == ["connect"]:
    # What the notebook's connect prints: the first round's state, or the refusal Settings shows.
    runs = os.path.join(d, "connect-runs.json")
    seen = json.load(open(runs)) if os.path.exists(runs) else []
    seen.append({"input": json.loads(sys.stdin.read() or "{}"), "token": os.environ.get("GODSPEED_TELEGRAM_TOKEN")})
    json.dump(seen, open(runs, "w"))
    if os.environ.get("FAKE_CONNECT_FAIL_FIRST") and len(seen) == 1:
        print("This repository is publicly readable. Choose a private repository for your knowledge", file=sys.stderr); sys.exit(1)
    print(json.dumps({"state": "synced"})); sys.exit(0)
runs = os.path.join(d, "finish-runs.json")
seen = json.load(open(runs)) if os.path.exists(runs) else []
run = {"input": json.loads(sys.stdin.read() or "{}"), "token": os.environ.get("GODSPEED_TELEGRAM_TOKEN"),
       "code": os.environ.get("GODSPEED_TELEGRAM_START_CODE"), "started": time.time()}
# The real one takes about a minute on a small server: six `hermes cron create`, each a start of Hermes.
time.sleep(float(os.environ.get("FAKE_FINISH_SECONDS") or 0))
run["ended"] = time.time()
seen.append(run)
json.dump(seen, open(runs, "w"))
if os.environ.get("FAKE_FINISH_FAIL_FIRST") and len(seen) == 1:
    print("The notebook folder is busy right now", file=sys.stderr); sys.exit(1)
print("Filed the goal and the clock")
'''


def scenario_run(name, scenario, extra_env=None, env_file=None, timeout=120, prepare=None, state=None, hermes_config=None):
    tmp = tempfile.mkdtemp(prefix="tg-setup-")
    home, fakes = os.path.join(tmp, "home"), os.path.join(tmp, "fake")
    os.makedirs(home)
    os.makedirs(fakes)
    for fname, body in (("hermes.py", FAKE_HERMES), ("gh.py", FAKE_GH), ("setup.py", FAKE_SETUP), ("finish.py", FAKE_FINISH)):
        with open(os.path.join(fakes, fname), "w") as f:
            f.write(body)
    if env_file is not None or hermes_config is not None:
        os.makedirs(os.path.join(home, ".hermes"))
    if env_file is not None:
        with open(os.path.join(home, ".hermes", ".env"), "w") as f:
            f.write(env_file)
    if hermes_config is not None:
        with open(os.path.join(home, ".hermes", "config.yaml"), "w") as f:
            f.write(hermes_config)
    if state is not None:
        # A setup that stopped part way, with what an earlier version had kept by then.
        os.makedirs(os.path.join(home, ".godspeed"))
        with open(os.path.join(home, ".godspeed", "telegram-setup.json"), "w") as f:
            json.dump(state, f)
    fk = fake_telegram.Fake(TOKEN, scenario)
    srv = fake_telegram.serve(fk)
    py = shlex.quote(fwd(sys.executable))
    env = dict(os.environ, HOME=home, GODSPEED_TELEGRAM_TOKEN=TOKEN,
               GODSPEED_TELEGRAM_API="http://127.0.0.1:%d" % srv.server_address[1],
               GODSPEED_TG_HERMES="%s %s" % (py, shlex.quote(fwd(os.path.join(fakes, "hermes.py")))),
               GODSPEED_TG_GH="%s %s" % (py, shlex.quote(fwd(os.path.join(fakes, "gh.py")))),
               GODSPEED_TG_SETUP="%s %s" % (py, shlex.quote(fwd(os.path.join(fakes, "setup.py")))),
               GODSPEED_TG_FINISH="%s %s" % (py, shlex.quote(fwd(os.path.join(fakes, "finish.py")))),
               GODSPEED_WORKSPACE=os.path.join(tmp, "workspace"),
               HERMES_HOME=os.path.join(home, ".hermes"), GODSPEED=os.path.join(home, "godspeed"),
               FAKE_DIR=fakes, TZ="Europe/Berlin")
    os.makedirs(os.path.join(tmp, "workspace"))
    if prepare:
        prepare(os.path.join(tmp, "workspace"))
    env.pop("GODSPEED_TELEGRAM_OWNER", None)
    env.pop("GODSPEED_TELEGRAM_START_CODE", None)
    env.pop("GODSPEED_TG_FLOW", None)
    env.pop("KB_SIGNIN_SKIP", None)
    env.pop("GODSPEED_TG_BROWSER_TZ", None)
    env.pop("GODSPEED_TG_NOTEBOOK_URL", None)
    env.update(extra_env or {})
    print("== %s" % name)
    t0 = time.time()
    try:
        p = subprocess.run([sys.executable, PROGRAM], env=env, capture_output=True, text=True, timeout=timeout)
        rc, out = p.returncode, p.stdout + p.stderr
    except subprocess.TimeoutExpired as e:
        rc, out = "timeout", (e.stdout or "") if isinstance(e.stdout, str) else ""
    srv.shutdown()

    def read(*parts):
        try:
            with open(os.path.join(*parts), encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""
    r = {"rc": rc, "out": out, "secs": time.time() - t0, "fake": fk, "home": home, "fakes": fakes, "ended": time.time(),
         "to": lambda uid: [m["text"] for m in fk.sent if m["chat_id"] == uid],
         "env": read(home, ".hermes", ".env"),
         "state": json.loads(read(home, ".godspeed", "telegram-setup.json") or "{}"),
         "log": read(home, "logs", "godspeed-telegram-setup.log"),
         "runs": json.loads(read(fakes, "setup-runs.json") or "[]"),
         "hermes": read(fakes, "hermes-calls"), "gh": read(fakes, "gh-calls"),
         "hermes_sent": read(fakes, "hermes-sent"), "env_extra": env,
         "hstate": json.loads(read(fakes, "hermes-state.json") or "{}"),
         "finish": json.loads(read(fakes, "finish-runs.json") or "[]"),
         "connect": json.loads(read(fakes, "connect-runs.json") or "[]"),
         "workspace": os.path.join(tmp, "workspace")}
    if rc != 0:
        print(out[-3000:])
    return r


def have_zones():
    try:
        from zoneinfo import available_timezones
        return bool(available_timezones())
    except Exception:
        return False


def any_has(texts, *needles):
    return any(all(n in t for n in needles) for t in texts)


USERS = {"111": {"first_name": "Anna", "username": "anna"}, "999": {"first_name": "Eve", "username": "eve"}}


def test_codes():
    print("== reading the sign-in codes the way the real tools print them")
    m = load("tg_setup", PROGRAM)
    hermes = ("To continue, follow these steps:\n\n  1. Open this URL in your browser:\n"
              "     \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n  2. Enter this code:\n"
              "     \x1b[94mABCD-12345\x1b[0m\n\nWaiting for sign-in...")
    check("Hermes' ChatGPT code and address", m.find_device_code(hermes) == ("https://auth.openai.com/codex/device", "ABCD-12345"))
    check("Hermes' code without a dash", m.find_device_code(hermes.replace("ABCD-12345", "Q7RT9XW2")) ==
          ("https://auth.openai.com/codex/device", "Q7RT9XW2"))
    check("nothing is sent before the code is printed", m.find_device_code(hermes.split("  2.")[0]) is None)
    gh_old = ("! First copy your one-time code: 1A2B-3C4D\n"
              "Open this URL to continue in your web browser: https://github.com/login/device\n")
    check("gh's code and address, no terminal", m.find_device_code(gh_old) == ("https://github.com/login/device", "1A2B-3C4D"))
    gh_new = ("\n! One-time code (3E7F-F915) copied to clipboard\n"
              "Open this URL to continue in your web browser: https://github.com/login/device\n")
    check("gh's code where it has a clipboard", m.find_device_code(gh_new) == ("https://github.com/login/device", "3E7F-F915"))
    check("a repository address in any usual shape",
          [m.normalise_repo(x, "anna") for x in ("https://github.com/anna/godspeed", "github.com/anna/godspeed.git",
           "git@github.com:anna/godspeed.git", "anna/godspeed", "godspeed", "not an address!")]
          == ["anna/godspeed"] * 5 + [None])
    check("a country or a German city with no zone of its own",
          [m.find_zone(x) for x in ("Germany", "München", "Düsseldorf", "UK")] ==
          ["Europe/Berlin", "Europe/Berlin", "Europe/Berlin", "Europe/London"])
    if have_zones():
        check("a city is its zone, in any case, with spaces",
              [m.find_zone(x) for x in ("london", "New York", "Asia/Tokyo", "sao paulo", "Krefeld")] ==
              ["Europe/London", "America/New_York", "Asia/Tokyo", "America/Sao_Paulo", None])
    else:
        print("NOTE  no time zone database on this computer (pip install tzdata), so city names are not checked here")


def test_happy():
    r = scenario_run("the happy path: Start, two codes, three answers, set up", {
        "users": USERS,
        "start": [{"from": 111, "text": "/start"}, {"from": 999, "text": "hi, is this yours?"}],
        "rules": [
            {"when": "Step 1 of 3: connect an AI", "do": [{"from": 111, "press": "openai-codex"}]},
            {"when": "already have a Mission Control", "do": [{"from": 111, "press": "repo:fresh"}]},
            {"when": "morning brief", "do": [{"from": 111, "press": "brief:yes"}]},
            {"when": "Your morning brief comes at 06:00", "do": [{"from": 111, "text": "Tokyo" if have_zones() else "UK"}]},
            {"when": "one line about the world", "do": [{"from": 111, "press": "world:yes"}]},
            {"when": "Setting everything up now", "do": [{"from": 111, "text": "are you there?"}]},
        ]})
    to_anna, to_eve = r["to"](111), r["to"](999)
    check("it finishes, exit 0", r["rc"] == 0)
    check("the first writer owns the bot", r["state"].get("owner_id") == 111 and r["state"].get("chat_id") == 111)
    check("the welcome greets them by name, and says what connecting an AI means",
          any_has(to_anna, "Hi Anna", "Three short steps", "1. Connect me to an AI, such as ChatGPT or Claude",
                  "2. Connect GitHub") and not any_has(to_anna, "brain"))
    check("a stranger is told it is taken, and nothing else", to_eve == ["This assistant belongs to someone else."])
    check("the ChatGPT address and code arrive", any_has(to_anna, "https://auth.openai.com/codex/device", "<code>ABCD-12345</code>"))
    check("the AI question offers ChatGPT, OpenRouter, Claude, OpenAI, Gemini and the rest",
          any(m["buttons"] == ["openai-codex", "openrouter", "anthropic", "openai-api", "gemini", "more"]
              and "I need an AI service to do my thinking" in m["text"] for m in r["fake"].sent))
    check("the city question has no button for the server's own clock",
          any("Your morning brief comes at 06:00" in m["text"] and m["buttons"] == [] for m in r["fake"].sent))
    check("while the AI answers its test question, Telegram shows it typing",
          len([a for a in r["fake"].actions if a["chat_id"] == 111 and a["action"] == "typing"]) >= 1)
    check("ChatGPT: a model the plan refuses is passed over, the one that answers is kept",
          r["hstate"].get("provider") == "openai-codex" and r["hstate"].get("model") == "gpt-5.6-terra"
          and r["hermes"].count("chat --oneshot") >= 2)
    check("the brain counts as connected only after it answered a test question",
          any_has(to_anna, "ChatGPT is connected, and I answered a first test question"))
    check("the GitHub address and code arrive", any_has(to_anna, "https://github.com/login/device", "<code>1A2B-3C4D</code>"))
    check("GitHub is confirmed with the account", any_has(to_anna, "GitHub is connected as anna"))
    check("git is set up to push after the sign-in", "auth setup-git" in r["gh"])
    run = r["runs"][0] if r["runs"] else {}
    check("the installer ran once, with the answers and no token",
          len(r["runs"]) == 1 and run.get("KB_MORNING_BRIEF") == "yes" and run.get("GODSPEED_INSTALL_COUNT") is None
          and run.get("KB_OBSERVED_STATE") == "yes"
          and run.get("KB_REPO_NAME") == "godspeed" and run.get("KB_TELEGRAM_SKIP") == "1"
          and run.get("KB_SIGNIN_SKIP") == "1"
          and not run.get("GODSPEED_REPO") and not run.get("GODSPEED_TELEGRAM_TOKEN"))
    check("progress is shown while it works", any("Working on: Your folder" in e for e in r["fake"].edits))
    check("a message during the install gets an answer", any_has(to_anna, "Still working on"))
    check("the bot goes to Hermes: token, owner, home chat",
          "TELEGRAM_BOT_TOKEN=%s" % TOKEN in r["env"] and "TELEGRAM_ALLOWED_USERS=111" in r["env"]
          and "TELEGRAM_HOME_CHANNEL=111" in r["env"])
    check("the gateway is restarted to take it", "gateway restart" in r["hermes"])
    zone, city = ("Asia/Tokyo", "Tokyo") if have_zones() else ("Europe/London", "London")
    check("the city they typed becomes Hermes' clock, before the restart",
          "Got it: %s time." % city in to_anna
          and 0 <= r["hermes"].find("config set timezone %s" % zone) < r["hermes"].find("gateway restart"))
    check("the first message goes the brief's road (hermes send), with something to try that needs no folder",
          "this is its chat" in r["hermes_sent"] and "what can you do for me?" in r["hermes_sent"]
          and "folder" not in r["hermes_sent"])
    check("the last message carries the address for another computer",
          any_has(to_anna, "GodspeedSetup.exe", "<code>https://github.com/anna/godspeed.git</code>", "--repo https://github.com/anna/godspeed.git"))
    check("setup is marked done", r["state"].get("done") is True)
    check("the token is in no log", TOKEN not in r["log"] and TOKEN not in r["out"])
    sent_before = len(r["fake"].sent)
    # A restart after it is done: nothing is sent, nothing is asked.
    again = subprocess.run([sys.executable, PROGRAM], env=r["env_extra"], capture_output=True, text=True, timeout=30)
    check("started again once done, it does nothing", again.returncode == 0 and len(r["fake"].sent) == sent_before)


def test_snags():
    r = scenario_run("every road back: an owner named, a code that ran out, a wrong address, a stop", {
        "users": USERS,
        "start": [{"from": 999, "text": "/start"}, {"from": 111, "text": "/start"}],
        "rules": [
            {"when": "Step 1 of 3: connect an AI", "do": [{"from": 111, "press": "openai-codex"}]},
            {"when": "That code ran out", "do": [{"from": 111, "press": "retry"}]},
            {"when": "already have a Mission Control", "do": [{"from": 111, "press": "repo:have"}]},
            {"when": "Send me its address", "do": [{"from": 111, "text": "github.com/anna/nope"}]},
            {"when": "I cannot open", "do": [{"from": 111, "text": "https://github.com/anna/mission"}]},
            {"when": "morning brief", "do": [{"from": 111, "text": "whatever"}, {"from": 111, "press": "brief:no"}]},
            {"when": "Setup stopped at", "do": [{"from": 111, "press": "setup:retry"}]},
        ]}, extra_env={"GODSPEED_TELEGRAM_OWNER": "@Anna", "FAKE_HERMES_FAIL_FIRST": "1",
                       "FAKE_SETUP_FAIL_FIRST": "1", "FAKE_GH_REPOS": "anna/mission"})
    to_anna, to_eve = r["to"](111), r["to"](999)
    check("it finishes, exit 0", r["rc"] == 0)
    check("the named owner takes it though a stranger wrote first",
          r["state"].get("owner_id") == 111 and to_eve == ["This assistant belongs to someone else."])
    check("a code that ran out offers a new one, and the new one works",
          r["hermes"].count("auth add openai-codex") == 2 and any_has(to_anna, "ChatGPT is connected, and I answered"))
    check("a wrong address is said, and asked again", any_has(to_anna, "I cannot open github.com/anna/nope"))
    check("typing instead of tapping gets a nudge", "Tap one of the buttons above, please." in to_anna)
    check("a stop says where and why", any_has(to_anna, "Setup stopped at", "private GitHub home",
                                               "the private GitHub repository was not created"))
    runs = r["runs"]
    check("Try again runs the installer again, with the same answers",
          len(runs) == 2 and runs[1].get("GODSPEED_REPO") == "https://github.com/anna/mission.git"
          and runs[1].get("KB_MORNING_BRIEF") == "no" and runs[1].get("GODSPEED_INSTALL_COUNT") is None
          and not runs[1].get("KB_REPO_NAME"))
    check("the last message carries the address they gave", any_has(to_anna, "https://github.com/anna/mission.git"))
    check("no brief, no question about the clock", not any_has(to_anna, "comes at 06:00") and "timezone" not in r["hermes"])
    check("no brief, no question about the world line, and it is off",
          not any_has(to_anna, "one line about the world") and runs[1].get("KB_OBSERVED_STATE") == "no")
    check("setup is marked done", r["state"].get("done") is True)


def test_found_repo():
    r = scenario_run("a repository called godspeed is already on their GitHub", {
        "users": USERS,
        "start": [{"from": 111, "text": "/start"}],
        "rules": [
            {"when": "Step 1 of 3: connect an AI", "do": [{"from": 111, "press": "more"}]},
            {"when": "^Which one[?]$", "do": [{"from": 111, "press": "deepseek"}]},
            {"when": "Send me your DeepSeek API key", "do": [{"from": 111, "text": "sk-deepseek-good-0123456789"}]},
            {"when": "Is that your", "do": [{"from": 111, "press": "found:no"}]},
            {"when": "morning brief", "do": [{"from": 111, "press": "brief:yes"}]},
            {"when": "Your morning brief comes at 06:00", "do": [{"from": 111, "text": "Krefeld"}]},
            {"when": "do not know the time zone of Krefeld", "do": [{"from": 111, "text": "Düsseldorf"}]},
            {"when": "one line about the world", "do": [{"from": 111, "press": "world:no"}]},
        ]}, extra_env={"FAKE_GH_REPOS": "anna/godspeed,anna/godspeed-mission-control"})
    check("it asks whether that one is theirs", any_has(r["to"](111), "anna/godspeed</b> on your GitHub"))
    check("starting fresh picks a name that is free",
          r["runs"] and r["runs"][-1].get("KB_REPO_NAME") == "godspeed-2")
    check("another provider from the longer list, by key, and the key message deleted",
          r["hstate"].get("provider") == "deepseek" and len(r["fake"].deleted) == 1
          and any_has(r["to"](111), "DeepSeek is connected"))
    check("a town the zone database does not know is said, and the nearest big city is taken",
          any_has(r["to"](111), "I do not know the time zone of Krefeld")
          and any(m["buttons"] == [] for m in r["fake"].sent if "time zone of Krefeld" in m["text"])
          and "config set timezone Europe/Berlin" in r["hermes"])


def test_key_provider():
    good, bad = "sk-or-good-0123456789abcdef", "sk-or-bad-0123456789abcdef"
    r = scenario_run("OpenRouter by key: a short answer, a key that fails, a key that works", {
        "users": USERS,
        "start": [{"from": 111, "text": "/start"}],
        "rules": [
            {"when": "Step 1 of 3: connect an AI", "do": [{"from": 111, "press": "openrouter"}]},
            {"when": "Send me your OpenRouter API key", "do": [{"from": 111, "text": "short"}]},
            {"when": "does not look like an API key", "do": [{"from": 111, "text": bad}]},
            {"when": "did not answer with that key", "do": [{"from": 111, "text": good}]},
            {"when": "already have a Mission Control", "do": [{"from": 111, "press": "repo:fresh"}]},
            {"when": "morning brief", "do": [{"from": 111, "press": "brief:no"}]},
        ]})
    to_anna = r["to"](111)
    check("it finishes, exit 0", r["rc"] == 0)
    check("no ChatGPT sign-in is started for another provider", "auth add openai-codex" not in r["hermes"])
    check("something that is not a key is said", any_has(to_anna, "That does not look like an API key"))
    check("a key that fails is said, with what the provider answered",
          any_has(to_anna, "OpenRouter did not answer with that key", "Provider said"))
    check("the key that works is kept, with Hermes' default model for OpenRouter",
          r["hstate"].get("provider") == "openrouter" and r["hstate"].get("keys", {}).get("openrouter") == good
          and r["hstate"].get("model") == "z-ai/glm-5.2")
    check("every message with a key is deleted from the chat", len(r["fake"].deleted) == 3)
    check("no key is in the log, the output or any message the bot sent",
          all(k not in r["log"] and k not in r["out"] and not any_has(to_anna, k) for k in (good, bad)))
    check("and no key is on a command line, where the process list shows it",
          all(k not in r["hermes"] for k in (good, bad)))
    check("the installer's own ChatGPT sign-in is skipped", r["runs"] and r["runs"][-1].get("KB_SIGNIN_SKIP") == "1")


CODE = "fictionalStartCode0123456789abcd"
ONE_CLICK = {"GODSPEED_TG_FLOW": "notebook", "GODSPEED_TELEGRAM_START_CODE": CODE}
NOTEBOOK = "https://203-0-113-7.sslip.io/dashboard"
AI_ASK = "<b>Connect an AI.</b> I need an AI service to do my thinking"
FIRST_ASK = "One more question: is this your first Godspeed Mission Control?"
SETTING_UP = "Thanks! I am setting everything up now. This takes a minute or two, and I write to you as soon as I am ready."
INVITE = ("In about ten minutes I will write to you here so you can tell me a little about yourself and what you "
          "want help with. No rush, answer whenever you like. Or start right now: send me the word context.")
NO_CONTEXT_QUESTIONS = ("Which city", "Tell me a little about yourself", "Last question", "your briefing", "your goal")


def test_one_click_names():
    print("== the browser's time zone")
    m = load("tg_setup_names", PROGRAM)
    check("only a city's zone from the browser is used, never UTC or something made up",
          [m.browser_zone(x) for x in ("Europe/Vienna", "America/Argentina/Buenos_Aires", "UTC", "Etc/GMT+1", "",
                                       "Europe/Nowhere" if have_zones() else "Moon/Base", "../../etc")] ==
          ["Europe/Vienna", "America/Argentina/Buenos_Aires", None, None, None, None, None])


def gh_untouched(r):
    return r["gh"] == "" and not any_has(r["to"](111), "github.com/login/device")


def typing_between(r, start, end):
    return [a for a in r["fake"].actions if a["chat_id"] == 111 and a["action"] == "typing" and start <= a["t"] <= end]


def test_one_click_happy():
    r = scenario_run("the one-click server: the link's code, an AI, first or not, and that is all", {
        "users": USERS,
        "start": [{"from": 999, "text": "/start"}, {"from": 999, "text": "/start guessed"},
                  {"from": 111, "text": "/start " + CODE}],
        "rules": [
            {"when": "Hi Anna", "do": [{"from": 999, "text": "/start " + CODE}]},
            {"when": AI_ASK, "do": [{"from": 111, "press": "openai-codex"}]},
            {"when": FIRST_ASK, "do": [{"from": 111, "press": "have:no"}]},
            # Writing while it sets up: answered once, however often.
            {"when": "setting everything up now", "do": [{"from": 111, "text": "are you there?", "after": 1},
                                                         {"from": 111, "text": "hello??", "after": 2}]},
        ]}, extra_env=dict(ONE_CLICK, GODSPEED_REVISION=REVISION, GODSPEED_TG_BROWSER_TZ="Europe/Vienna",
                           GODSPEED_TG_NOTEBOOK_URL=NOTEBOOK, FAKE_FINISH_SECONDS="9"),
        prepare=backed_up)
    to_anna, to_eve = r["to"](111), r["to"](999)
    check("it finishes, exit 0", r["rc"] == 0)
    check("only the link's code takes the bot", r["state"].get("owner_id") == 111 and r["state"].get("bot_id") == 42)
    check("before that, a Start without the code is told to send the message the setup page shows",
          sum("send me the message shown on your Godspeed setup page. It starts with /start" in t for t in to_eve) == 1)
    check("the code works once: after the owner, the same link is refused",
          to_eve[-1:] == ["This assistant belongs to someone else."])
    welcome = next((t for t in to_anna if "Hi Anna" in t), "")
    check("the welcome says: the technical part now, about five minutes, getting to know you afterwards",
          "First the technical part, about five minutes: you connect me to an AI, such as ChatGPT or Claude." in welcome
          and "Getting to know you comes afterwards, in a short chat of its own, whenever you like." in welcome
          and "From now on I answer only you." in welcome and "Step" not in welcome and "GitHub" not in welcome)
    check("the AI question has no step number left over", any_has(to_anna, AI_ASK) and not any_has(to_anna, " of 2", " of 3"))
    check("no city, nothing about them and no goal is asked here",
          not any(any_has(to_anna, q) for q in NO_CONTEXT_QUESTIONS))
    check("a first Mission Control never signs in to GitHub, and nothing asks it", gh_untouched(r) and r["connect"] == [])
    first_q = next((m for m in r["fake"].sent if FIRST_ASK in m["text"]), {})
    check("the one question after the AI is one tap: first, or bring in the one on GitHub",
          first_q.get("labels") == ["Yes, it is my first", "No, bring in the one I have on GitHub"])
    at = next((i for i, t in enumerate(to_anna) if FIRST_ASK in t), -2)
    check("right after the last answer it says it is setting everything up", to_anna[at + 1:at + 2] == [SETTING_UP])
    fin = r["finish"]
    check("the browser's time zone is filed silently, with their name for the later chat, and no key",
          len(fin) == 1 and fin[0]["input"] == {"timezone": "Europe/Vienna", "timezone_from": "browser", "joined": False,
                                                "owner_name": "Anna"}
          and fin[0]["token"] is None and fin[0]["code"] is None)
    run = fin[0] if fin else {"started": 0, "ended": 0}
    check("Telegram shows it typing all through the minute that takes",
          len(typing_between(r, run["started"], run["ended"])) >= 2)
    check("a message written meanwhile is answered once",
          sum(t == "Still working on it. This can take a few minutes; I write to you when I am done." for t in to_anna) == 1)
    check("the bot goes to Hermes, and Hermes' clock is the browser's",
          "TELEGRAM_BOT_TOKEN=%s" % TOKEN in r["env"] and "TELEGRAM_ALLOWED_USERS=111" in r["env"]
          and "config set timezone Europe/Vienna" in r["hermes"])
    check("the gateway is left to the container's supervisor", "gateway" not in r["hermes"])
    last = r["hermes_sent"]
    check("the last message names both places, the notebook's address and how to sign in there",
          "Your Godspeed Mission Control is ready. You can reach me in two places" in last
          and "1. Here in Telegram, from anywhere." in last and NOTEBOOK in last
          and "Sign in with the username and password you chose when you set up this server" in last)
    check("and that it writes in about ten minutes to get to know them, or now with the word context, and no folder",
          INVITE in last and "folder" not in last.lower())
    check("setup is marked done", r["state"].get("done") is True)
    check("neither the key nor the start code is in any log",
          all(x not in r["log"] and x not in r["out"] for x in (TOKEN, CODE)))
    # The promoted version: the release marked Latest and beta's install-godspeed.sh, never the
    # build commit (GODSPEED_REVISION) whose own installers/ folder still held the previous product.
    check("another computer is sent to the promoted installers, not the build commit",
          any_has(to_anna, "releases/latest/download/GodspeedSetup.exe",
                  "/beta/install-godspeed.sh",
                  "--repo https://github.com/anna/notebook.git")
          and not any_has(to_anna, REVISION)
          and not any_has(to_anna, "Same folder"))


REVISION = "0123456789abcdef0123456789abcdef01234567"


def backed_up(workspace):
    """The notebook's folder already has its backup on GitHub."""
    subprocess.run(["git", "init", "-q", workspace], check=True)
    subprocess.run(["git", "-C", workspace, "remote", "add", "origin", "https://github.com/anna/notebook.git"], check=True)


def test_one_click_snags():
    r = scenario_run("the one-click server: Start without the link, a key, no time zone from the browser, a stop", {
        "users": USERS,
        "start": [{"from": 111, "text": "/start"}],
        "rules": [
            {"when": "send me the message shown on your Godspeed setup page", "do": [{"from": 111, "text": "/start " + CODE}]},
            {"when": AI_ASK, "do": [{"from": 111, "press": "openrouter"}]},
            {"when": "Send me your OpenRouter API key", "do": [{"from": 111, "text": "sk-or-good-0123456789abcdef"}]},
            {"when": FIRST_ASK, "do": [{"from": 111, "text": "Yes, it is my first"}]},
            # The person takes ten seconds to tap Try again; nothing is "typing" while it waits for them.
            {"when": "I could not finish the setup", "do": [{"from": 111, "press": "finish:retry", "after": 10}]},
        ]}, extra_env=dict(ONE_CLICK, FAKE_FINISH_FAIL_FIRST="1"), timeout=180)
    to_anna = r["to"](111)
    check("it finishes, exit 0", r["rc"] == 0)
    check("Start without the link gets the hint, and the message from the page then works", r["state"].get("owner_id") == 111)
    fin = r["finish"]
    check("with no time zone from the browser none is filed or asked; the later chat asks the city",
          len(fin) == 2 and fin[1]["input"]["timezone"] is None and fin[1]["input"]["timezone_from"] is None
          and not any_has(to_anna, "Which city") and "timezone" not in r["hermes"])
    check("a stop is said with its reason, and Try again files the answers",
          any_has(to_anna, "I could not finish the setup", "The notebook folder is busy right now")
          and len(fin) == 2 and fin[0]["input"] == fin[1]["input"])
    stop = next((m["t"] for m in r["fake"].sent if "I could not finish the setup" in m["text"]), None)
    check("no typing while it waits for the person to tap Try again, and typing again once it works",
          stop is not None and len(fin) == 2 and typing_between(r, stop + 1, fin[1]["started"] - 0.5) == []
          and typing_between(r, fin[1]["started"] - 1.5, r["ended"]) != [])
    check("a restart of the filing does not thank them twice",
          sum(t.startswith("Thanks! I am setting everything up now") for t in to_anna) == 1)
    check("without the server's address, the last message says where it is in words, and still invites them",
          "In your notebook, in your web browser, at the same address where you set up this server" in r["hermes_sent"]
          and INVITE in r["hermes_sent"] and "folder" not in r["hermes_sent"].lower())
    check("setup is marked done", r["state"].get("done") is True)


def test_one_click_existing():
    r = scenario_run("the one-click server: a Mission Control already on GitHub is brought in", {
        "users": USERS,
        "start": [{"from": 111, "text": "/start " + CODE}],
        "rules": [
            {"when": AI_ASK, "do": [{"from": 111, "press": "openai-codex"}]},
            {"when": FIRST_ASK, "do": [{"from": 111, "press": "have:yes"}]},
            {"when": "Send me its address", "do": [{"from": 111, "text": "github.com/anna/nope"}]},
            {"when": "I cannot open", "do": [{"from": 111, "text": "https://github.com/anna/mission"}]},
            {"when": "I could not connect", "do": [{"from": 111, "press": "join:retry"}]},
        ]}, extra_env=dict(ONE_CLICK, FAKE_GH_REPOS="anna/mission", FAKE_CONNECT_FAIL_FIRST="1",
                           GODSPEED_TG_BROWSER_TZ="Europe/London", GODSPEED_TG_NOTEBOOK_URL=NOTEBOOK), prepare=backed_up)
    to_anna = r["to"](111)
    first = next((i for i, t in enumerate(to_anna) if FIRST_ASK in t), -1)
    check("it finishes, exit 0", r["rc"] == 0)
    check("only bringing one in signs in to GitHub, after that answer, and git is set up",
          0 < first < next((i for i, t in enumerate(to_anna) if "github.com/login/device" in t), -1)
          and any_has(to_anna[first:], "To bring in your Mission Control, I sign in to GitHub with you")
          and any_has(to_anna, "GitHub is connected as anna") and "auth login" in r["gh"] and "auth setup-git" in r["gh"]
          and not any_has(to_anna, "No GitHub account yet"))
    check("an address it cannot open is said, and asked again", any_has(to_anna, "I cannot open github.com/anna/nope"))
    check("a refusal is said with its reason, and Try again connects",
          any_has(to_anna, "I could not connect <b>anna/mission</b>", "publicly readable")
          and [c["input"] for c in r["connect"]] == [{"repository": "https://github.com/anna/mission.git"}] * 2
          and all(c["token"] is None for c in r["connect"]))
    check("one plain sentence says it is connected and knows them already",
          any_has(to_anna, "Your Mission Control from GitHub is connected and its pages are here. It knows you already."))
    check("nothing about them is asked", not any(any_has(to_anna, q) for q in NO_CONTEXT_QUESTIONS))
    fin = r["finish"]
    check("the browser's clock goes to the notebook, marked as brought in",
          len(fin) == 1 and fin[0]["input"] == {"timezone": "Europe/London", "timezone_from": "browser", "joined": True,
                                                "owner_name": "Anna"})
    check("its last message has no invitation to tell it about themselves, since it knows them",
          NOTEBOOK in r["hermes_sent"] and "Try it now: open your notebook and ask me something." in r["hermes_sent"]
          and "ten minutes" not in r["hermes_sent"] and "context" not in r["hermes_sent"])
    check("it does not offer to install itself on the computer that already has it",
          not any_has(to_anna, "Want me on your computer too"))
    check("setup is marked done", r["state"].get("done") is True and r["state"].get("existing") == "anna/mission")


def test_one_click_old_state():
    # What the version before the split had kept when it stopped: the city given in the chat, what
    # they said about themselves and their goal, the filing not done yet.
    old = {"bot_id": 42, "owner_id": 111, "chat_id": 111, "owner_name": "Anna", "offset": 1, "brain": "openai-codex",
           "brain_ok": True, "login": "anna", "existing": "", "tz": "Europe/London", "briefing": "what-my-ai-knew.md",
           "goal": "Bake on Sundays."}
    r = scenario_run("the one-click server: restarted with the answers an earlier version had asked", {
        "users": USERS, "start": [], "rules": []}, extra_env=dict(ONE_CLICK, GODSPEED_TG_BROWSER_TZ="Europe/Vienna"), state=old)
    to_anna = r["to"](111)
    check("it picks up where it was, asks nothing more, and finishes",
          r["rc"] == 0 and r["state"].get("done") is True and to_anna[:1] == ["I restarted, and I am picking up where we were."]
          and not any(any_has(to_anna, q) for q in NO_CONTEXT_QUESTIONS) and not any_has(to_anna, FIRST_ASK))
    check("what they had answered is all filed, their own city over the browser's",
          r["finish"] and r["finish"][0]["input"] == {"timezone": "Europe/London", "timezone_from": "answer", "joined": False,
                                                      "owner_name": "Anna", "goal": "Bake on Sundays.",
                                                      "about": "what-my-ai-knew.md"}
          and "config set timezone Europe/London" in r["hermes"])
    old = {"bot_id": 42, "owner_id": 111, "chat_id": 111, "owner_name": "Anna", "offset": 1,
           "brain": "openrouter", "brain_ok": True, "login": "anna"}
    r = scenario_run("the one-click server: restarted right after an earlier version's GitHub sign-in", {
        "users": USERS, "start": [],
        "rules": [{"when": FIRST_ASK, "do": [{"from": 111, "press": "have:no"}]}]},
        extra_env=ONE_CLICK, state=old)
    check("it asks the one question, never signs in again, and finishes",
          r["rc"] == 0 and r["state"].get("done") is True and gh_untouched(r) and len(r["finish"]) == 1
          and INVITE in r["hermes_sent"])


def links_for(env):
    """WINDOWS_EXE and ONE_LINER the program computes for a given environment (offline)."""
    keys = ("GODSPEED_TG_FLOW", "GODSPEED_REVISION", "GODSPEED_INSTALLER_REF")
    old = {k: os.environ.get(k) for k in keys}
    try:
        for k in keys:
            os.environ.pop(k, None)
        os.environ.update({k: v for k, v in env.items() if v is not None})
        m = load("tg_links_%d" % time.time_ns(), PROGRAM)
        return m.WINDOWS_EXE, m.ONE_LINER
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


# The Windows link: the release marked Latest, which only a promotion moves.
LATEST_EXE = ("https://github.com/MichaelZelbel/godspeed-mission-control"
              "/releases/latest/download/GodspeedSetup.exe")


def test_one_click_links():
    print("== the install links for another computer name the promoted version, not the build commit")
    build = REVISION  # the image's GODSPEED_REVISION, the commit it was built from
    # Default: the public stage, beta, which holds the version the maintainer promoted.
    exe, sh = links_for({"GODSPEED_TG_FLOW": "notebook", "GODSPEED_REVISION": build})
    check("notebook default: the release marked Latest and beta's install-godspeed.sh",
          exe == LATEST_EXE and sh.endswith("/beta/install-godspeed.sh")
          and build not in exe and build not in sh)
    # A deployment may pin a release tag or a known-good commit; the build commit stays unused.
    exe, sh = links_for({"GODSPEED_TG_FLOW": "notebook", "GODSPEED_REVISION": build, "GODSPEED_INSTALLER_REF": "v2.6.0"})
    check("a pinned installer ref is honoured for the one-liner, and the Windows link stays Latest",
          sh.endswith("/v2.6.0/install-godspeed.sh") and exe == LATEST_EXE
          and build not in exe and build not in sh)
    # A ref that tries to climb out of the repository is refused and falls back to beta.
    exe, sh = links_for({"GODSPEED_TG_FLOW": "notebook", "GODSPEED_INSTALLER_REF": "../../etc/passwd"})
    check("a ref that tries to climb out is refused and falls back to beta",
          sh.endswith("/beta/install-godspeed.sh") and exe == LATEST_EXE
          and ".." not in exe and ".." not in sh)
    # The plain terminal flow hands out the same promoted pair.
    exe, sh = links_for({})
    check("the plain (non-notebook) flow: the release asset and beta",
          exe == LATEST_EXE and sh.endswith("/beta/install-godspeed.sh"))


# --- The backup AI chat (GODSPEED_TG_FLOW=backup), after /backupai on the one-click server ---------
# A stand-in for notebook/scripts/backup-ai.mjs: the main AI and the backup in a file, a check that
# fails for a key with "bad" in it (and for ChatGPT models other than FAKE_CODEX_OK), and a record of
# every call with its words, so a key on a command line would show.
FAKE_BACKUP = r'''
import json, os, sys
d = os.environ["FAKE_DIR"]; a = sys.argv[1:]
f = os.path.join(d, "backup-state.json")
st = json.load(open(f)) if os.path.exists(f) else {"main": {"provider": "openai-codex", "model": "gpt-plan"}, "backup": None}
text = sys.stdin.read()
open(os.path.join(d, "backup-calls"), "a").write(" ".join(a) + "\n")
def save(): json.dump(st, open(f, "w"))
def out(v): print("(node:1) ExperimentalWarning: noise before the answer", file=sys.stderr); print(json.dumps(v))
if a == ["show"]:
    b = st["backup"]
    out({"main": st["main"], "configured": bool(b), "backup": b and {k: b[k] for k in ("provider", "model")}}); sys.exit(0)
if a == ["check"]:
    e = json.loads(text) if text.strip() else st["backup"]
    if e["provider"] == "openai-codex":
        ok = os.path.exists(os.path.join(d, "chatgpt-signed-in")) and e["model"] in os.environ.get("FAKE_CODEX_OK", "gpt-5.6-terra").split(",")
    else:
        ok = "bad" not in e.get("api_key", "bad")
    out({"ok": True} if ok else {"ok": False, "error": "The AI account needs to be signed in again, or its key was refused."}); sys.exit(0 if ok else 1)
if a == ["set"]:
    st["backup"] = json.loads(text); save(); out({"configured": True, "backup": {"provider": st["backup"]["provider"]}}); sys.exit(0)
if a == ["remove"]:
    st["backup"] = None; save(); out({"removed": True, "configured": False}); sys.exit(0)
sys.exit(2)
'''
BACKUP_ASK = "Which one do you want as your backup?"


def backup_run(name, rules, backup_state=None, extra=None, timeout=90):
    def prepare(workspace):
        fakes = os.path.join(os.path.dirname(workspace), "fake")
        with open(os.path.join(fakes, "backup.py"), "w") as f:
            f.write(FAKE_BACKUP)
        if backup_state is not None:
            with open(os.path.join(fakes, "backup-state.json"), "w") as f:
                json.dump(backup_state, f)
    py = shlex.quote(fwd(sys.executable))
    env = {"GODSPEED_TG_FLOW": "backup", "GODSPEED_TG_REQUEST": "fictional0request",
           "GODSPEED_TG_OWNER_ID": "111", "GODSPEED_TG_CHAT_ID": "111", "GODSPEED_TG_OWNER_NAME": "Anna",
           # The fake lives in the run's own folder, which only FAKE_DIR names.
           "GODSPEED_TG_BACKUP": "%s -c %s" % (py, shlex.quote(
               "import os,runpy,sys;sys.argv=['backup.py']+sys.argv[1:];"
               "runpy.run_path(os.path.join(os.environ['FAKE_DIR'],'backup.py'),run_name='__main__')"))}
    env.update(extra or {})
    # The reader's /backupai is still unread when the chat starts: the gateway had it.
    r = scenario_run(name, {"users": USERS, "start": [{"from": 111, "text": "/backupai"}], "rules": rules},
                     extra_env=env, prepare=prepare, timeout=timeout)
    r["backup_calls"] = open(os.path.join(r["fakes"], "backup-calls")).read() if os.path.exists(os.path.join(r["fakes"], "backup-calls")) else ""
    try:
        r["backup_state"] = json.load(open(os.path.join(r["fakes"], "backup-state.json")))
    except (OSError, ValueError):
        r["backup_state"] = {}
    return r


def test_backup_key():
    good, bad = "sk-or-backup-good-0123456789", "sk-or-backup-bad-0123456789"
    r = backup_run("/backupai: the main setup's own choices, a backup by key, tried before it is saved, the main AI untouched", [
        {"when": BACKUP_ASK, "do": [{"from": 111, "press": "openai-codex"}]},
        {"when": "That is the service your main AI uses already", "do": [{"from": 111, "press": "openrouter"}]},
        {"when": "Send me your OpenRouter API key", "do": [{"from": 111, "text": bad}]},
        {"when": "did not answer with that key", "do": [{"from": 111, "text": good}]},
    ])
    to_anna = r["to"](111)
    check("it finishes and says the chat is done for this request", r["rc"] == 0 and r["state"].get("done") is True
          and r["state"].get("request") == "fictional0request")
    check("it explains what a backup is, naming the main AI", any_has(to_anna, "<b>Backup AI.</b>", "your main AI, ChatGPT, fails"))
    asked = next((m for m in r["fake"].sent if BACKUP_ASK in m["text"]), {"buttons": [], "labels": []})
    main_setup = load("tg_setup_backup_list", PROGRAM)
    check("it offers exactly the main setup's choices, with their labels, and Not now",
          asked["buttons"] == [s for s, _ in main_setup.TOP_BRAINS] + ["more", "backup:none"]
          and asked["labels"] == [l for _, l in main_setup.TOP_BRAINS] + ["Another provider", "Not now"])
    check("the main AI's own service is answered in plain words, and asked again",
          any_has(to_anna, "That is the service your main AI uses already. A backup steps in when the main AI fails"))
    check("the /backupai the gateway had read is not taken for an answer", not any_has(to_anna, "Tap one of the buttons"))
    check("a key that does not answer is said and not saved; the one that answers is saved with OpenRouter's default model",
          any_has(to_anna, "OpenRouter did not answer with that key")
          and r["backup_state"].get("backup") == {"provider": "openrouter", "model": "z-ai/glm-5.2", "api_key": good})
    check("both messages with a key are deleted from the chat", len(r["fake"].deleted) == 2)
    check("no key is in the log, the output, any message or on a command line",
          all(k not in r["log"] and k not in r["out"] and not any_has(to_anna, k) and k not in r["backup_calls"] for k in (good, bad)))
    check("the main AI is not touched", "config set model" not in r["hermes"] and "auth add" not in r["hermes"])
    check("it says the backup works, and that the chat is back to normal",
          any_has(to_anna, "OpenRouter is your backup AI now", "only when ChatGPT fails") and to_anna[-1] == "Back to normal: write to me as usual.")


def test_backup_chatgpt_and_remove():
    r = backup_run("/backupai: a ChatGPT plan as the backup, signed in by code, the first model that answers",
                   [{"when": BACKUP_ASK, "do": [{"from": 111, "press": "openai-codex"}]}],
                   backup_state={"main": {"provider": "openrouter", "model": "z-ai/glm-5.2"}, "backup": None})
    to_anna = r["to"](111)
    check("the sign-in code reaches the chat and the plan's model that answers is saved",
          r["rc"] == 0 and any_has(to_anna, "ABCD-12345") and r["backup_state"].get("backup") == {"provider": "openai-codex", "model": "gpt-5.6-terra"})
    check("it is a sign-in only: ChatGPT does not become the main AI", "config set model" not in r["hermes"])
    have = {"main": {"provider": "openai-codex", "model": "gpt-plan"}, "backup": {"provider": "anthropic", "model": "claude-fictional"}}
    r = backup_run("/backupai with a backup already: remove it", [{"when": "Your backup AI now is Claude", "do": [{"from": 111, "press": "backup:remove"}]}],
                   backup_state=have)
    check("removing it is said and done", r["rc"] == 0 and r["backup_state"].get("backup") is None
          and any_has(r["to"](111), "you have no backup AI now"))
    r = backup_run("/backupai with a backup already: keep it", [{"when": "Your backup AI now is Claude", "do": [{"from": 111, "press": "backup:keep"}]}],
                   backup_state=have)
    check("keeping it changes nothing", r["rc"] == 0 and r["backup_state"].get("backup") == have["backup"]
          and "set" not in r["backup_calls"].split() and any_has(r["to"](111), "Nothing changed: Claude stays your backup AI."))


def test_backup_time_up():
    r = backup_run("/backupai and then no answer: the bot goes back to the assistant", [],
                   extra={"GODSPEED_TG_BACKUP_MINUTES": "0.05"}, timeout=60)
    to_anna = r["to"](111)
    check("it hands the chat back on its own, nothing changed", r["rc"] == 0 and r["state"].get("done") is True
          and any_has(to_anna, "I am handing the chat back now; nothing changed.") and r["backup_state"].get("backup") is None)
    r = scenario_run("a backup chat started without its owner hands the bot back at once", {"users": USERS, "start": []},
                     extra_env={"GODSPEED_TG_FLOW": "backup", "GODSPEED_TG_REQUEST": "x", "GODSPEED_TG_BACKUP": "true"}, timeout=30)
    check("nothing is asked and it is done", r["rc"] == 0 and r["state"].get("done") is True and not r["fake"].sent)


def test_nothing_to_do():
    r = scenario_run("a token Telegram refuses", {"users": USERS, "start": []},
                     extra_env={"GODSPEED_TELEGRAM_TOKEN": "123:wrong"}, timeout=30)
    check("it stops at once and says why in the log", r["rc"] == 0 and "does not accept" in r["log"])
    check("and the wrong token is in no log", "123:wrong" not in r["log"])
    r = scenario_run("the terminal setup connected Telegram already", {"users": USERS, "start": [{"from": 111, "text": "hi"}]},
                     env_file="TELEGRAM_BOT_TOKEN=999:other\nTELEGRAM_ALLOWED_USERS=5\n", timeout=30)
    check("it stays out of the gateway's way", r["rc"] == 0 and r["fake"].calls.get("getUpdates", 0) == 0
          and "stays out of its way" in r["log"])


if __name__ == "__main__":
    test_codes()
    test_happy()
    test_snags()
    test_found_repo()
    test_key_provider()
    test_one_click_names()
    test_one_click_happy()
    test_one_click_snags()
    test_one_click_existing()
    test_one_click_old_state()
    test_one_click_links()
    test_backup_key()
    test_backup_chatgpt_and_remove()
    test_backup_time_up()
    test_nothing_to_do()
    print()
    if FAILS:
        print("%d FAILED" % FAILS)
        sys.exit(1)
    print("ALL PASS")
