"""Free, local Hermes dictation. Audio never goes to a cloud provider."""
import json
import os
from pathlib import Path
import sys

home = Path(os.environ['HERMES_HOME'])
sys.path.insert(0, str(home.parent / 'stt-deps'))
os.environ['HF_HOME'] = str(home / 'stt-cache')
from tools.transcription_tools import transcribe_audio_local_fallback

try:
    result = transcribe_audio_local_fallback(sys.argv[1], model='base')
    print(json.dumps({'text': result.get('transcript', '').strip(), 'ok': bool(result.get('success'))}))
except Exception:
    print(json.dumps({'ok': False, 'text': ''}))
