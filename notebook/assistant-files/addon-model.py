"""One tools-free request through the connected Hermes home's selected model.

Use Hermes' own credential resolver and protocol adapters, never its agent loop.
There is deliberately no auxiliary auto-discovery: unavailable selected credentials
must fail rather than engage another subscription or a paid fallback.

The one exception is the backup AI the person connected themselves (22 October 2026,
discussion #20): the first entry of Hermes' fallback chain (`fallback_providers`, which
Godspeed writes only when the person connects a backup). It is tried only when the
selected model failed, only for this request, and the answer says so ("backup": true).
The notebook's Settings check asks for one of the two by name ("route": "main" or
"backup"); an add-on cannot, since godspeed-model accepts no such field.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import sys


def selected(config):
    model = config.get("model") or {}
    if not isinstance(model, dict):
        raise ValueError("Choose a model connection in Godspeed first")
    provider, name = model.get("provider"), model.get("default")
    if not isinstance(provider, str) or not provider.strip() or provider == "auto":
        raise ValueError("Choose an explicit model provider in Godspeed first")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Choose a model in Godspeed first")
    return provider, name


def backup_entry(config):
    """The backup AI: the first usable entry of Hermes' fallback chain, or None.

    The same reading as Hermes' own (hermes_cli/fallback_config.py): `fallback_providers`
    first, then the older single `fallback_model`, entries without a provider and a model
    skipped."""
    for key in ("fallback_providers", "fallback_model"):
        raw = config.get(key)
        for entry in [raw] if isinstance(raw, dict) else raw if isinstance(raw, list) else []:
            if not isinstance(entry, dict):
                continue
            provider, model = str(entry.get("provider") or "").strip(), str(entry.get("model") or "").strip()
            if provider and model and provider != "auto":
                return {**entry, "provider": provider, "model": model}
    return None


def entry_key(entry):
    """The key the entry carries itself, else the one its key_env names, else None (the provider's
    own sign-in, such as a ChatGPT plan, is then found the usual way)."""
    inline = str(entry.get("api_key") or "").strip()
    if inline:
        return inline
    name = str(entry.get("key_env") or entry.get("api_key_env") or "").strip()
    return (os.environ.get(name) or "").strip() or None if name else None


def ask(payload, provider, model, *, resolve_runtime, resolve_client, expected_route=None, base_url=None, api_key=None):
    hints = {}
    if api_key:
        hints["explicit_api_key"] = api_key
    if base_url:
        hints["explicit_base_url"] = base_url
    runtime = resolve_runtime(requested=provider, target_model=model, **hints)
    expected, endpoint = expected_route(provider, base_url) if expected_route else (provider, None)
    effective = runtime.get("provider")
    if effective != expected or (endpoint and str(runtime.get("base_url", "")).rstrip("/") != endpoint.rstrip("/")):
        raise ValueError("The resolved connection does not match the model provider selected in Godspeed")
    # A named custom provider can normalize to 'custom'; it is still the exact
    # selected endpoint. The resolver is never called with 'auto'.
    client, resolved = resolve_client(
        provider, model=model, explicit_base_url=runtime.get("base_url"),
        explicit_api_key=runtime.get("api_key"), api_mode=runtime.get("api_mode"),
        main_runtime={**runtime, "model": model},
    )
    if client is None or resolved != model:
        raise ValueError("The selected Godspeed model connection is unavailable")
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": payload["system"]},
                  {"role": "user", "content": payload["prompt"]}],
        max_tokens=payload["max_tokens"], timeout=payload["timeout_ms"] / 1000,
    )
    message = response.choices[0].message
    if getattr(message, "tool_calls", None):
        raise ValueError("The model returned a tool call instead of text")
    text = message.content
    if not isinstance(text, str) or not text.strip():
        raise ValueError("The connected model returned no text")
    return {"text": text, "provider": effective, "model": model}


def request(payload, *, load_config, resolve_runtime, resolve_client, expected_route=None):
    config = load_config()
    provider, model = selected(config)
    backup = backup_entry(config)
    if payload.get("describe"):
        described = {"configured": True, "provider": provider, "model": model}
        if backup:
            described["backup"] = {"provider": backup["provider"], "model": backup["model"]}
        return described
    route = payload.get("route")
    # The Telegram backup chat tests a backup before it is saved ("entry", with route "backup"
    # only), so a new one that does not answer never replaces one that does.
    trial = backup_entry({"fallback_providers": [payload.get("entry")]}) if route == "backup" and payload.get("entry") else None
    if route == "backup" and payload.get("entry") and not trial:
        raise ValueError("Name the backup's provider and model")

    def through_backup():
        chosen = trial or backup
        if not chosen:
            raise ValueError("No backup AI is connected")
        answer = ask(payload, chosen["provider"], chosen["model"], resolve_runtime=resolve_runtime,
                     resolve_client=resolve_client, expected_route=expected_route,
                     base_url=str(chosen.get("base_url") or "").strip() or None, api_key=entry_key(chosen))
        return {**answer, "backup": True}

    if route == "backup":
        return through_backup()
    main_url = (config.get("model") or {}).get("base_url")
    try:
        return ask(payload, provider, model, resolve_runtime=resolve_runtime, resolve_client=resolve_client,
                   expected_route=expected_route and (lambda name, _url: expected_route(name, main_url)))
    except Exception:
        if route == "main" or not backup:
            raise
    # The main one failed: the backup, once, for this request only.
    return through_backup()


def load_host_environment():
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(os.environ["HERMES_HOME"]) / ".env", override=True)
    except ImportError:
        pass


def main():
    # The caller controls only text and bounded budgets. Connection settings and
    # credentials come exclusively from the installation's verified Hermes home.
    payload = json.loads(sys.stdin.read(600001))
    load_host_environment()
    from hermes_cli.config import load_config_readonly
    from hermes_cli.runtime_provider import resolve_runtime_provider, _get_named_custom_provider, expand_direct_api_alias
    from agent.auxiliary_client import resolve_provider_client, _normalize_aux_provider
    def expected_route(provider, base_url):
        named = _get_named_custom_provider(provider)
        if named:
            return "custom", named.get("base_url")
        return expand_direct_api_alias(_normalize_aux_provider(provider), base_url)
    # Runtime constructors can print diagnostics. Never mix them into the
    # protocol or preserve them alongside strangers' profiles.
    with contextlib.redirect_stdout(io.StringIO()):
        result = request(payload, load_config=load_config_readonly,
                         resolve_runtime=resolve_runtime_provider,
                         resolve_client=resolve_provider_client, expected_route=expected_route)
    print(json.dumps(result))


def reason(error):
    """Which of the two everyday failures this was, as a fixed word, never the provider's own text
    (it can name accounts or carry a key's prefix): "limit", "sign-in" or None."""
    import re
    text = "%s %s" % (type(error).__name__, error)
    if re.search(r"rate.?limit|too many requests|usage limit|quota|insufficient_quota|\b429\b", text, re.I):
        return "limit"
    if re.search(r"authenticat|invalid.?api.?key|incorrect api key|unauthori[sz]ed|token expired|permission denied|\b40[13]\b", text, re.I):
        return "sign-in"
    return None


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": "The selected Godspeed model could not answer. Check its connection and usage allowance.",
                          "reason": reason(error)}))
        sys.exit(1)
