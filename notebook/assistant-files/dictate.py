"""Free, local Hermes dictation. Audio never goes to a cloud provider."""
import json
import importlib.util
import os
from pathlib import Path
import sys

home = Path(os.environ['HERMES_HOME'])
sys.path.insert(0, str(home.parent / 'stt-deps'))
os.environ['HF_HOME'] = str(home / 'stt-cache')
# Hermes 0.22's launcher bootstraps the environment that exposes its installed
# packages. Dictation starts its Python directly, so it must do the same before
# importing Hermes' transcription tools.
if importlib.util.find_spec('hermes_bootstrap') is not None:
    import hermes_bootstrap  # noqa: F401
from tools.transcription_tools import transcribe_audio_local_fallback

try:
    result = transcribe_audio_local_fallback(sys.argv[1], model='base')
    print(json.dumps({'text': result.get('transcript', '').strip(), 'ok': bool(result.get('success'))}))
except Exception:
    print(json.dumps({'ok': False, 'text': ''}))
