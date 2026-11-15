"""Today's brief in Telegram, answered by the notebook and not by the model.

WHY (9 November 2026, #336): asked "today's brief" in Telegram, the model wrote a briefing of its own
instead of the one the notebook saved, although its recipe says to show `godspeed-brief`'s text word
for word. A message that only asks for today's brief, in English or German, is now answered here,
before the gateway hands it to the model (Hermes' pre_gateway_dispatch hook): with the briefing saved
today, word for word, or with one sentence that none is saved. Nothing is written: `godspeed-brief
--saved` only reads. Anything else, a message from anyone but the one owner, or a read that fails,
goes to the model as before. The language of the sentence is the language of the message, from
the one decision every Telegram reply uses (language.py, #505): "Briefing" alone tells none, so the
person's recent messages decide.
"""
import importlib.util
import os
import re
import subprocess

_spec = importlib.util.spec_from_file_location("godspeed_reply_language",
                                               os.path.join(os.path.dirname(os.path.abspath(__file__)), "language.py"))
_language = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_language)

READ_SECONDS = 20

# The whole message, without punctuation, case or a polite frame around it.
ASKS = {
    "en": ("today's brief", "todays brief", "today brief", "today's briefing", "todays briefing",
           "today's morning brief", "todays morning brief", "today's morning briefing",
           "my brief", "my briefing", "the brief", "the brief again", "my brief again",
           "morning brief", "my morning brief", "the morning brief", "morning briefing",
           "my morning briefing", "brief", "briefing"),
    "de": ("heutiges briefing", "das heutige briefing", "briefing von heute", "das briefing von heute",
           "mein briefing", "das briefing", "morgenbriefing", "mein morgenbriefing", "das morgenbriefing",
           "heutiges morgenbriefing", "das heutige morgenbriefing", "tagesbriefing", "mein tagesbriefing"),
}
FRAMES = {
    "en": (r"^(?:please\s+)?(?:show|send|give|get)\s+me\s+", r"^(?:what(?:'s| is)|where(?:'s| is))\s+",
           r"^(?:can|could)\s+(?:i|you)\s+(?:see|have|get|send me|show me)\s+", r"\s+please$"),
    "de": (r"^(?:bitte\s+)?(?:zeig|schick|gib)\s+mir\s+", r"^(?:was ist|wo ist)\s+", r"\s+bitte$"),
}
NONE_TODAY = {"en": "No morning briefing is saved for today.",
              "de": "Für heute ist kein Morgenbriefing gespeichert."}


def asks_for_brief(text):
    """Whether the message asks only for today's brief, in English or German."""
    if not isinstance(text, str) or len(text) > 80:
        return False
    plain = text.lower().replace("’", "'")
    plain = re.sub(r"[^\w\s']", " ", plain)
    plain = re.sub(r"\s+", " ", plain).strip()
    for language, asks in ASKS.items():
        candidates = {plain}
        for frame in FRAMES[language]:
            candidates |= {re.sub(frame, "", c).strip() for c in list(candidates)}
        if candidates & set(asks):
            return True
    return False


def saved_brief(home, run=subprocess.run):
    """Today's saved briefing ("" when none is saved), or None when it could not be read."""
    command = os.path.join(home or "", "bin", "godspeed-brief")
    if not home or not os.path.isfile(command):
        return None
    try:
        done = run([command, "--saved"], capture_output=True, text=True, timeout=READ_SECONDS)
    except Exception:
        return None
    if done.returncode != 0:
        return None
    return (done.stdout or "").strip()


def owner():
    raw = os.environ.get("TELEGRAM_ALLOWED_USERS", "").strip()
    return raw if re.fullmatch(r"[1-9][0-9]*", raw) else None


def answer(event, home, run=subprocess.run):
    """The words to send for this message, or None to leave it to the model."""
    source = getattr(event, "source", None)
    platform = getattr(getattr(source, "platform", None), "value", getattr(source, "platform", None))
    if str(platform) != "telegram" or getattr(source, "chat_type", "dm") not in ("dm", "private"):
        return None
    who = owner()
    if not who or str(getattr(source, "user_id", "")) != who or str(getattr(source, "chat_id", "")) != who:
        return None
    asked = getattr(event, "text", None)
    if not asks_for_brief(asked):
        return None
    text = saved_brief(home, run)
    if text is None:
        return None
    if text:
        return text
    earlier = _language.person_messages(home, "telegram", who)
    return NONE_TODAY[_language.message_language(asked, earlier, _language.person_language())]


def make_hook(home_of):
    async def on_dispatch(event=None, gateway=None, **_):
        try:
            text = answer(event, home_of())
            if not text:
                return None
            adapter = None
            for platform, candidate in (getattr(gateway, "adapters", None) or {}).items():
                if getattr(platform, "value", platform) == "telegram":
                    adapter = candidate
            if adapter is None:
                return None
            result = await adapter.send(str(event.source.chat_id), text)
            if getattr(result, "success", True) is False:
                return None
            return {"action": "skip", "reason": "godspeed: today's brief answered from the notebook"}
        except Exception:
            return None
    return on_dispatch
