"""One tools-free request through the connected Hermes home's selected model.

Use Hermes' own credential resolver and protocol adapters, never its agent loop.
There is deliberately no auxiliary auto-discovery: unavailable selected credentials
must fail rather than engage another subscription or a paid fallback.
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


def request(payload, *, load_config, resolve_runtime, resolve_client):
    config = load_config()
    provider, model = selected(config)
    if payload.get("describe"):
        return {"configured": True, "provider": provider, "model": model}
    runtime = resolve_runtime(requested=provider, target_model=model)
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
    return {"text": text, "provider": provider, "model": model}


def main():
    # The caller controls only text and bounded budgets. Connection settings and
    # credentials come exclusively from the installation's verified Hermes home.
    payload = json.loads(sys.stdin.read(600001))
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(os.environ["HERMES_HOME"]) / ".env", override=False)
    except ImportError:
        pass
    from hermes_cli.config import load_config_readonly
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from agent.auxiliary_client import resolve_provider_client
    # Runtime constructors can print diagnostics. Never mix them into the
    # protocol or preserve them alongside strangers' profiles.
    with contextlib.redirect_stdout(io.StringIO()):
        result = request(payload, load_config=load_config_readonly,
                         resolve_runtime=resolve_runtime_provider,
                         resolve_client=resolve_provider_client)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"error": "The selected Godspeed model could not answer. Check its connection and usage allowance."}))
        sys.exit(1)
