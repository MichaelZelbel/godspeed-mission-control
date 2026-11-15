import json
import sys

# The model list under the notebook's chat, read with Hermes' own code. The notebook runs this with
# the Python Hermes runs on (core/runtime.mjs, hermesPython) and names Hermes' own folder as the
# first argument: Hermes 0.22 keeps no venv, and its packages are found only after its own folder
# is first on the path and hermes_bootstrap has run, as its launcher does (18 October 2026).
if len(sys.argv) > 1 and sys.argv[1]:
    sys.path.insert(0, sys.argv[1])
try:
    import hermes_bootstrap  # noqa: F401
except Exception:
    pass

from hermes_cli.inventory import load_picker_context, build_model_options_payload
from agent.reasoning_effort import codex_supported_efforts

ctx = load_picker_context()
payload = build_model_options_payload(ctx, explicit_only=True, include_unconfigured=False)
models = []
for provider in payload.get('providers', []):
    if provider.get('slug') != ctx.current_provider:
        continue
    for name in provider.get('models', []):
        if not isinstance(name, str):
            continue
        models.append({'id': name, 'efforts': list(codex_supported_efforts(name)) if ctx.current_provider == 'openai-codex' else []})
if not any(m['id'] == ctx.current_model for m in models):
    models.insert(0, {'id': ctx.current_model, 'efforts': list(codex_supported_efforts(ctx.current_model)) if ctx.current_provider == 'openai-codex' else []})
print(json.dumps({'current': ctx.current_model, 'provider': ctx.current_provider, 'models': models}))
