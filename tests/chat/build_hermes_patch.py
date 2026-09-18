"""Maintainer tool: generate the immutable patch from the reviewed source checkout.
Never run this on a reader machine. Installation uses git apply --check.
"""
import difflib
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
kit = Path(__file__).resolve().parents[2]
out = kit/'integrations/hermes'
(out/'patches').mkdir(parents=True,exist_ok=True)
files = {}
patches = []

def change(path,edit,reference=None):
    original = (root/(reference or path)).read_text(encoding='utf-8') if (root/(reference or path)).exists() else ''
    revised = edit(original)
    files[path] = {'original':hashlib.sha256(original.encode()).hexdigest() if original else None,'patched':hashlib.sha256(revised.encode()).hexdigest()}
    patches.extend(difflib.unified_diff(original.splitlines(True),revised.splitlines(True),fromfile='a/'+path if original else '/dev/null',tofile='b/'+path))

def replace(text,before,after):
    if text.count(before) != 1:
        raise ValueError('Source anchor is not unique: '+before[:100])
    return text.replace(before,after)

def base(t):
    t = replace(t,'class BasePlatformAdapter','import _hub_chat_bridge as _hub_chat\n\n\nclass BasePlatformAdapter')
    for name in ('_process_message_background','_dispatch_inline_reply'):
        t = replace(t,'    async def '+name+'(', '    @_hub_chat.turn\n    async def '+name+'(')
    for name in ('_send_final_text','_deliver_attachments','_play_tts_file','_notify_turn_error'):
        t = replace(t,'    async def '+name+'(', '    @_hub_chat.final_output\n    async def '+name+'(')
    return t

def adapter(t):
    t = replace(t,'class TelegramAdapter','import _hub_chat_bridge as _hub_chat\n\n\nclass TelegramAdapter')
    for name,deco in (('_build_message_event','native_event'),('send','final_send'),('_send_prompt','prompt_output')):
        prefix = '    def ' if name=='_build_message_event' else '    async def '
        t = replace(t,prefix+name+'(', '    @_hub_chat.'+deco+'\n'+prefix+name+'(')
    t = replace(t,'            builder = builder.request(request).get_updates_request(get_updates_request)',
                '            request = _hub_chat.configure(self, request)\n            builder = builder.request(request).get_updates_request(get_updates_request)')
    t = replace(t,'            self._start_post_connect_housekeeping()\n            return True',
                '            self._start_post_connect_housekeeping()\n            await _hub_chat.start(self)\n            return True')
    anchor = '        def build():\n            # Short monotonic ids in callback_data map back to session_key.'
    t = replace(t,anchor,'        handled = await _hub_chat.approval_prompt(self, prompt)\n        if handled is not None:\n            return handled\n'+anchor)
    t = replace(t,'        parts = data.split(":", 2)\n        if len(parts) != 3:\n            return\n        choice = parts[1]  # once, session, always, deny',
                '        if await _hub_chat.approval_callback(self, query, data, cb):\n            return\n        parts = data.split(":", 2)\n        if len(parts) != 3:\n            return\n        choice = parts[1]  # once, session, always, deny')
    return t

def runner(t):
    t = replace(t,'        want_interim_messages = ctx.interim_assistant_messages_enabled',
                '        want_interim_messages = ctx.interim_assistant_messages_enabled\n        import _hub_chat_bridge as _hub_chat\n        if _hub_chat.quiet_stream(ctx._status_adapter):\n            want_stream_deltas = want_interim_messages = False')
    t = replace(t,'                        description=desc, metadata=ctx._status_thread_metadata, **flags,',
                '                        description=desc, metadata=__import__("_hub_chat_bridge").approval_metadata(ctx, approval_data), **flags,')
    return t

def approval(t):
    # The durable decision is written before waking the executor, under its queue lock.
    # Other profiles retain the existing path. Refused journal decisions stay queued to expire.
    t = replace(t,'            queue[:] = [entry for entry in queue if entry not in targets]',
                '            from _hub_chat_bridge import guard_decision\n            targets = [entry for entry in targets if guard_decision(session_key, entry.data.get("request_id"), choice)]\n            if not targets:\n                return 0\n            queue[:] = [entry for entry in queue if entry not in targets]')
    # Text /approve must pass the same exact-request guard, including /approve all.
    t = replace(t,'            targets = list(queue)\n            queue.clear()',
                '            from _hub_chat_bridge import guard_decision\n            targets = [entry for entry in queue if guard_decision(session_key, entry.data.get("request_id"), choice)]\n            queue[:] = [entry for entry in queue if entry not in targets]')
    t = replace(t,'            targets = [queue.pop(0)]',
                '            from _hub_chat_bridge import guard_decision\n            entry = queue[0]\n            if not guard_decision(session_key, entry.data.get("request_id"), choice):\n                return 0\n            targets = [queue.pop(0)]')
    return t

shim = '''"""Versioned optional integration. No private hub behavior lives here."""
import importlib.util
if importlib.util.find_spec('hub_chat'):
    from hub_chat.hermes_bridge import *
else:
    from hermes_constants import get_hermes_home
    import json
    path = get_hermes_home() / 'hub-chat.json'
    if path.exists() and json.loads(path.read_text()).get('enabled'):
        raise RuntimeError('Chat protection is enabled but its package is missing')
    def identity(function): return function
    turn = final_output = native_event = final_send = prompt_output = identity
    def configure(adapter,request): return request
    def quiet_stream(adapter): return False
    def guard_decision(*args): return True
    def approval_metadata(ctx,data): return ctx._status_thread_metadata
    async def approval_prompt(*args): return None
    async def approval_callback(*args): return False
    async def start(*args): pass
    async def stop(*args): pass
'''
change('gateway/platforms/base.py',base,'base.py')
change('plugins/platforms/telegram/adapter.py',adapter,'adapter.py')
change('gateway/run_turn_runner.py',runner,'run_turn_runner.py')
change('tools/approval.py',approval,'approval.py')
change('_hub_chat_bridge.py',lambda t:shim)
name = 'db64ddb58eef-hub-chat.patch'
(out/'patches'/name).write_text(''.join(patches),encoding='utf-8',newline='\n')
manifest = {'schema':1,'hermes_commit':'db64ddb58eef6aebd0874bcdaad266ca8f6205a0','patch':name,'files':files}
for target in (out/'compatibility.json',kit/'tools/hub_chat/compatibility.json'):
    target.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8',newline='\n')
print('Generated version-bound patch and manifests')
