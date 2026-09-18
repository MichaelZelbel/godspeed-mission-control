import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))


def load_chat(test):
    import importlib.util
    test.assertIsNotNone(importlib.util.find_spec('hub_chat'), 'The shared chat package is not installed')
    from hub_chat.app import Chat
    return Chat


class Adapter:
    def __init__(self):
        self.messages = []
        self.edits = []
        self.failure = None

    def send(self, conversation_id, text):
        if self.failure:
            raise self.failure
        self.messages.append((conversation_id, text))
        return str(len(self.messages))


def fixture(name):
    import json
    return json.loads((ROOT / 'tests/chat/fixtures' / name).read_text())
