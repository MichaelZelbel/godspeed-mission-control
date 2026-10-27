"""A voice note through the installed assistant's own transcription, for scenarios/voice.sh.

Run with the assistant's own Python, the one that can import its modules:

  <assistant python> voice-through-hermes.py --home <assistant home> --audio <file>
      [--source <the assistant's source folder>] --transcript <out file> --call <out file>

WHAT IT DOES AND DOES NOT DO. A voice note in a chat is understood by the assistant itself: it
reads which service is to do it from its own settings (stt.provider, and the model at
stt.elevenlabs.model_id - the keys notebook/core/voice-replies.mjs writes and
tools/transcription_tools.py reads), and then calls that service. This asks the assistant's own
modules for both halves: the settings decide, and the assistant's own ElevenLabs transcription does
the work, with the key out of the assistant's .env, where Settings saved it. It does not run a
gateway and does not need a chat account, which is why the scenario needs no Telegram.

It writes the transcript to --transcript and, to --call, which function it called with which
arguments, so the scenario's own verdict can say that the words came back through the assistant's
ElevenLabs path and not through anything this script decided.

Exit 0 when a transcript was written, 1 with one sentence on the error stream otherwise.
"""
import argparse
import importlib.util
import inspect
import json
import os
import re
import sys


def fail(sentence):
    sys.stderr.write(sentence + "\n")
    raise SystemExit(1)


def config_value(text, keys):
    """One key of the assistant's settings file, in the block layout it is written in."""
    stack = []
    for raw in text.replace("\r\n", "\n").split("\n"):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        found = re.match(r"^(\s*)([A-Za-z0-9_.-]+)\s*:(.*)$", raw)
        if not found:
            continue
        level = len(found.group(1)) // 2
        if level > len(stack):
            continue
        del stack[level:]
        stack.append(found.group(2))
        if stack == list(keys):
            value = found.group(3).strip()
            if value[:1] in ('"', "'") and value[-1:] == value[:1]:
                return value[1:-1]
            return re.sub(r"\s+#.*$", "", value)
    return None


def env_value(text, name):
    found = re.search(r"^\s*(?:export\s+)?%s\s*=\s*(.*)$" % re.escape(name), text, re.M)
    return found.group(1).strip().strip("\"'") if found else ""


def read(path):
    try:
        with open(path, encoding="utf-8") as file:
            return file.read().lstrip("﻿")
    except OSError:
        return ""


# The arguments the assistant's own transcription takes, by every name it has given them. Filled by
# name, so a signature that calls the sound "audio_path" and one that calls it "path" both work; a
# parameter it needs that is not here is said plainly instead of guessed at.
def call_with(function, audio, key, model):
    known = {
        "audio": audio, "audio_path": audio, "audio_file": audio, "path": audio, "file": audio,
        "file_path": audio, "filename": audio, "input_path": audio, "source": audio,
        "api_key": key, "key": key, "elevenlabs_api_key": key, "token": key,
        "model": model, "model_id": model, "stt_model": model, "model_name": model,
    }
    arguments, missing = {}, []
    for name, parameter in inspect.signature(function).parameters.items():
        if name in known:
            arguments[name] = known[name]
        elif parameter.default is inspect.Parameter.empty and parameter.kind in (
            parameter.POSITIONAL_ONLY, parameter.POSITIONAL_OR_KEYWORD, parameter.KEYWORD_ONLY):
            missing.append(name)
    if missing:
        fail("the assistant's own transcription wants %s, which this scenario does not know how to "
             "give it (its arguments are now %s)" % (", ".join(missing), list(inspect.signature(function).parameters)))
    return arguments, function(**arguments)


def main():
    ap = argparse.ArgumentParser(prog="voice-through-hermes")
    ap.add_argument("--home", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--source")
    ap.add_argument("--transcript", required=True)
    ap.add_argument("--call", required=True)
    a = ap.parse_args()

    if a.source:
        sys.path.insert(0, a.source)
    # Hermes 0.22 keeps no venv: its own packages are found only once its own bootstrap has run, as
    # its launcher runs it, so its modules are loaded the same way here (the notebook's own helpers,
    # notebook/assistant-files/chat-options.py and addon-model.py, do the same). Until 27 October
    # 2026 this script skipped it, and on a fresh machine the assistant's transcription could not be
    # loaded at all ("No module named 'ruamel'").
    if importlib.util.find_spec("hermes_bootstrap") is not None:
        import hermes_bootstrap  # noqa: F401
    if not os.path.isfile(a.audio):
        fail("the recording %s is not there" % a.audio)

    config = read(os.path.join(a.home, "config.yaml"))
    provider = (config_value(config, ["stt", "provider"]) or "").lower()
    if provider != "elevenlabs":
        fail("the assistant's own settings say voice notes are understood by %r, not by ElevenLabs, "
             "so there was nothing to send there" % (provider or "its own computer"))
    key = env_value(read(os.path.join(a.home, ".env")), "ELEVENLABS_API_KEY")
    if not key:
        fail("the assistant has no ElevenLabs key in its .env, so a voice note could not be sent")

    try:
        from tools.transcription_cloud import _transcribe_elevenlabs as transcribe
        from tools.transcription_common import DEFAULT_ELEVENLABS_STT_MODEL as default_model
        from tools.transcription_tools import _BUILTIN_MODEL_KEYS as model_keys
    except ImportError as error:
        fail("the assistant's own transcription could not be loaded with this Python: %s" % error)

    section, key_name = model_keys["elevenlabs"][0], model_keys["elevenlabs"][1]
    model = config_value(config, ["stt", section, key_name]) or default_model
    arguments, answer = call_with(transcribe, a.audio, key, model)

    text = answer
    if isinstance(answer, dict):
        text = answer.get("text") or answer.get("transcript") or ""
    text = str(text or "").strip()
    with open(a.call, "w", encoding="utf-8") as file:
        json.dump({"function": transcribe.__module__ + "." + transcribe.__name__,
                   "arguments": sorted(arguments), "model": model, "model_key": "stt.%s.%s" % (section, key_name),
                   "provider": provider}, file, indent=2)
    if not text:
        fail("the assistant's ElevenLabs transcription came back with nothing for %s" % a.audio)
    with open(a.transcript, "w", encoding="utf-8") as file:
        file.write(text + "\n")
    sys.stderr.write("ElevenLabs understood the voice note with %s: %s\n" % (model, text))


main()
