"""Integration called only by the version-checked Hermes patch."""
import asyncio
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from functools import wraps
import json
from pathlib import Path
import threading
from .app import Chat
from .contracts import utcnow, fingerprint, canonical
from .runtime import Boundary

_approvals = {}
_approval_lock = threading.RLock()


def filter_cron_targets(job,targets,for_failure):
    from hermes_constants import get_hermes_home
    from .scheduled import filter_targets
    return filter_targets(get_hermes_home(),job,targets,for_failure)


def refuse_standalone_telegram():
    from hermes_constants import get_hermes_home
    from .scheduled import protected
    return protected(get_hermes_home())


def get(adapter):
    return getattr(adapter,'_hub_chat_boundary',None)


def configure(adapter, request):
    from hermes_constants import get_hermes_home
    config_path = get_hermes_home() / 'hub-chat.json'
    if not config_path.exists():
        return request
    config = json.loads(config_path.read_text(encoding='utf-8'))
    if config.get('enabled') is not True:
        return request
    from .bundle import verify
    verify(config['package'],check_import=True)
    from .compatibility import verify_runtime
    verify_runtime(Path(__import__('gateway').__file__).parent.parent)
    previous = get(adapter)
    if previous:
        from .telegram_request import GuardedRequest
        return GuardedRequest(request,previous)
    chat = Chat(config_path.parent/'chat-state',str(config['conversation_id']),config.get('timezone','UTC'),config.get('language','en'))
    from .source_adapters import configure_sources
    configure_sources(chat,config)
    chat.delivery.recover()
    chat.approvals.cancel_pending('Gateway restarted')
    boundary = Boundary(chat,str(config['actor_id']))
    boundary.config = config
    boundary.profile = config_path.parent
    boundary.adapter = adapter
    adapter._hub_chat_boundary = boundary
    boundary.loaded_at=utcnow()
    from .telegram_request import GuardedRequest
    return GuardedRequest(request,boundary)


def heartbeat(boundary):
    from .setup import atomic_json
    import os
    atomic_json(boundary.profile/'chat-runtime.json',
                {'pid':os.getpid(),'config_hash':fingerprint(boundary.config),'loaded_at':boundary.loaded_at,
                 'heartbeat_at':utcnow(),'package':str(Path(__file__).parent)})


def native_event(function):
    @wraps(function)
    def wrapped(adapter,message,*args,**kwargs):
        event = function(adapter,message,*args,**kwargs)
        boundary = get(adapter)
        if boundary:
            # Pairing is not authorization. Require both configured owner and Hermes auth.
            accepted = adapter._is_callback_user_authorized(str(event.source.user_id),chat_id=event.source.chat_id,chat_type=event.source.chat_type)
            boundary.bind(event,authenticated=bool(accepted))
            if boundary.native(event):
                boundary.reconcile_reply(getattr(message,'reply_to_message',None),adapter._bot.id)
                context = boundary.chat.context.resolve(boundary.chat.conversation_id,event.reply_to_message_id,event.text,utcnow())
                prompt = boundary.chat.context.prompt(context)
                if prompt:
                    event.channel_prompt = (event.channel_prompt or '') + '\n\n' + prompt
        return event
    return wrapped


def turn(function):
    @wraps(function)
    async def wrapped(adapter,event,*args,**kwargs):
        boundary = get(adapter)
        with boundary.turn(event) if boundary else nullcontext():
            return await function(adapter,event,*args,**kwargs)
    return wrapped


def final_output(function):
    @wraps(function)
    async def wrapped(adapter,*args,**kwargs):
        boundary = get(adapter)
        with boundary.output('reply') if boundary else nullcontext():
            if boundary and function.__name__=='_notify_turn_error':
                event=args[0]
                boundary.chat.store.audit('turn_failed',type(args[1]).__name__)
                text=('Ich konnte diese Anfrage nicht abschließen. Bitte versuche es erneut.' if boundary.chat.language=='de'
                      else 'I could not finish this request. Please try again.')
                await adapter.send(chat_id=event.source.chat_id,content=text)
                return None
            return await function(adapter,*args,**kwargs)
    return wrapped


def quiet_stream(adapter):
    return get(adapter) is not None


def result_instruction(adapter):
    if not get(adapter): return ''
    from .evidence import INSTRUCTION
    return INSTRUCTION


def guard_result(ctx,result,history_length):
    boundary=get(ctx._status_adapter)
    if not boundary or not isinstance(result,dict): return result
    from .evidence import collect,validate_answer
    evidence=collect(boundary.chat.store,boundary.chat.conversation_id,result.get('messages',[])[history_length:])
    for row in boundary.chat.store.rows("SELECT * FROM approvals WHERE state='approved'"):
        action=json.loads(row['body'])
        if action.get('session_key') != ctx.session_key: continue
        matches=[e for e in evidence.values() if e.get('command_hash')==fingerprint(action.get('command'))]
        if matches:
            state=matches[-1]['status']
            boundary.chat.approvals.finish(row['id'],{'status':state if state in ('succeeded','failed') else 'uncertain','evidence_id':matches[-1]['id']})
        else:
            boundary.chat.approvals.finish(row['id'],{'status':'uncertain','reason':'This turn ended without a matching execution result'})
    result['final_response']=validate_answer(result.get('final_response') or '',evidence,boundary.chat.language)
    return result


def approval_metadata(ctx, data):
    metadata = dict(ctx._status_thread_metadata or {})
    boundary = get(ctx._status_adapter)
    if boundary:
        turn = boundary.active.get(str(getattr(ctx.source,'message_id','')))
        metadata.update(_hub_chat_request_id=data.get('request_id'),_hub_chat_turn=turn)
    return metadata


def prompt_output(function):
    @wraps(function)
    async def wrapped(adapter,*args,**kwargs):
        boundary = get(adapter)
        metadata=kwargs.get('metadata') or (args[2] if len(args)>2 else None) or {}
        inherited=boundary._turn.get() or metadata.get('_hub_chat_turn') if boundary else None
        with boundary.inherit_turn(inherited) if boundary else nullcontext():
            with boundary.output('question') if boundary else nullcontext():
                return await function(adapter,*args,**kwargs)
    return wrapped


def final_send(function):
    @wraps(function)
    async def wrapped(adapter,chat_id,content,*args,**kwargs):
        boundary = get(adapter)
        # Inline command replies use Hermes's final notify flag inside a native turn.
        # Unknown callers cannot gain the native turn from metadata.
        metadata = kwargs.get('metadata') or {}
        turn = boundary._turn.get() if boundary else None
        scope = boundary.output('reply') if boundary and turn and turn.live and metadata.get('notify') else nullcontext()
        with scope:
            return await function(adapter,chat_id,content,*args,**kwargs)
    return wrapped


async def approval_prompt(adapter,prompt):
    boundary = get(adapter)
    if boundary is None:
        return None
    from gateway.platforms.base import SendResult
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup
    from tools.approval import register_gateway_settle
    from tools.approval_context import _get_approval_timeout
    request_id = (prompt.metadata or {}).get('_hub_chat_request_id')
    turn = boundary._turn.get() or (prompt.metadata or {}).get('_hub_chat_turn')
    if not request_id or not turn or not turn.live or str(prompt.chat_id) != boundary.chat.conversation_id:
        return SendResult(success=False,error='Approval has no authenticated request',error_kind='forbidden',raw_response={'code':'egress_declined'})
    chat = boundary.chat
    expires = (datetime.now(timezone.utc) + timedelta(seconds=max(0,_get_approval_timeout()))).isoformat()
    action = {'request_id':request_id,'summary':prompt.description,'actor':turn.actor,
              'fingerprint':fingerprint([prompt.command,prompt.description]),'session_key':prompt.session_key,
              'choices':prompt.choices,'command':prompt.command}
    chat.approvals.create(action,chat.conversation_id,expires)
    loop = asyncio.get_running_loop()
    with _approval_lock:
        _approvals[request_id] = (boundary,prompt.session_key)
    def settled(reason):
        if reason != 'answered':
            chat.approvals.settle(request_id,reason)
        with _approval_lock:
            _approvals.pop(request_id,None)
        asyncio.run_coroutine_threadsafe(edit_approval(boundary,request_id),loop)
    if not register_gateway_settle(prompt.session_key,request_id,settled):
        chat.approvals.settle(request_id,'cancelled')
        return SendResult(success=False,error='Request is no longer waiting',error_kind='forbidden',raw_response={'code':'egress_declined'})
    summary = prompt.description.strip() or 'Run the requested command'
    german=chat.language=='de'
    timeout=max(0,_get_approval_timeout())
    text = summary + ('\n\nOhne deine Freigabe wird diese Aktion nicht ausgeführt. Die Anfrage läuft in '+str(timeout)+' Sekunden ab.' if german else
                      '\n\nIf you do not approve, this action will not run. This request expires in '+str(timeout)+' seconds.')
    labels = ({'once':'Einmal freigeben','session':'Für dieses Gespräch freigeben','always':'Freigabe für diesen Befehl speichern','deny':'Ablehnen'} if german else
              {'once':'Approve once','session':'Approve for this session','always':'Save approval for this command','deny':'Decline'})
    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton(labels[choice],callback_data=f'ea:{choice}:{request_id}')] for choice in prompt.choices] +
                                    [[InlineKeyboardButton('Genaue Aktion anzeigen' if german else 'Show exact action',callback_data=f'ea:details:{request_id}')]])
    try:
        with boundary.output('approval',request_id):
            result = await adapter._bot.send_message(chat_id=chat.conversation_id,text=text,reply_markup=keyboard)
        with chat.store.transaction() as db:
            db.execute('UPDATE approvals SET message_id=? WHERE id=?',(str(result.message_id),request_id))
        if chat.approvals.get(request_id)['state'] != 'pending':
            await edit_approval(boundary,request_id)
        return SendResult(success=True,message_id=str(result.message_id))
    except Exception as exc:
        chat.store.audit('approval_send_uncertain',type(exc).__name__)
        # Guard remains authoritative; never re-send an ambiguous prompt.
        return SendResult(success=False,error='Approval delivery could not be confirmed',raw_response={'ambiguous':True})


def guard_decision(session_key,request_id,choice):
    """Called under Hermes's queue lock, before it signals execution."""
    with _approval_lock:
        record = _approvals.get(request_id)
    if not record:
        return True  # Unconfigured profiles retain their original guard.
    boundary,expected_session = record
    if expected_session != session_key:
        return False
    row = boundary.chat.approvals.get(request_id)
    action = json.loads(row['body'])
    if choice not in action['choices']:
        return False
    outcome = boundary.chat.approvals.decide(request_id,row['actor'],choice,utcnow())
    return outcome['state'] == 'denied' if choice == 'deny' else outcome['may_execute']


async def edit_approval(boundary,request_id):
    row = boundary.chat.approvals.get(request_id)
    if not row or not row['message_id'] or row['state'] == 'pending':
        return
    text = json.loads(row['body'])['summary'] + '\n\n' + boundary.chat.approvals.text(row['state'],boundary.chat.language)
    try:
        with boundary.output('approval_result',request_id,row['message_id']):
            await boundary.adapter._bot.edit_message_text(chat_id=row['conversation'],message_id=int(row['message_id']),text=text,reply_markup=None)
        with boundary.chat.store.transaction() as db:
            result = json.loads(row['result'])
            result['presented_state'] = row['state']
            db.execute('UPDATE approvals SET result=? WHERE id=?',(canonical(result),request_id))
    except Exception as exc:
        if 'message is not modified' in str(exc).lower():
            with boundary.chat.store.transaction() as db:
                result=json.loads(row['result']); result['presented_state']=row['state']
                db.execute('UPDATE approvals SET result=? WHERE id=?',(canonical(result),request_id))
        else:
            boundary.chat.store.audit('approval_edit_retry',type(exc).__name__)


async def approval_callback(adapter,query,data,cb):
    boundary = get(adapter)
    if boundary is None:
        return False
    parts = data.split(':',2)
    if len(parts) != 3:
        return True
    _,choice,aid = parts
    row = boundary.chat.approvals.get(aid)
    if not await adapter._callback_authorized(query,cb,'This request belongs to another person.'):
        return True
    if not row:
        await query.answer(text='This request is no longer available. Nothing was approved.')
        return True
    if str(query.from_user.id) != row['actor'] or str(cb['chat_id']) != row['conversation'] or str(query.message.message_id) != row['message_id']:
        await query.answer(text='This button does not belong to this request.')
        return True
    if choice=='details':
        action=json.loads(row['body'])
        with boundary.output('approval_result',aid,row['message_id']):
            await adapter._bot.edit_message_text(chat_id=row['conversation'],message_id=int(row['message_id']),
                text=action['summary']+'\n\n'+action['command'][:1800]+'\n\n'+boundary.chat.approvals.text(row['state'],boundary.chat.language),
                reply_markup=getattr(query.message,'reply_markup',None))
        await query.answer()
        return True
    if row['state'] == 'pending':
        from tools.approval import resolve_gateway_approval
        action = json.loads(row['body'])
        if choice not in action['choices']:
            await query.answer(text='This choice is not available.')
            return True
        count = resolve_gateway_approval(action['session_key'],choice,request_id=aid)
        if not count and boundary.chat.approvals.get(aid)['state'] == 'pending':
            boundary.chat.approvals.settle(aid,'cancelled')
    row = boundary.chat.approvals.get(aid)
    await query.answer(text=boundary.chat.approvals.text(row['state'],boundary.chat.language)[:190])
    await edit_approval(boundary,aid)
    return True


async def start(adapter):
    boundary = get(adapter)
    if boundary and not getattr(adapter,'_hub_chat_pump',None):
        from .inbox import pump
        adapter._hub_chat_pump = asyncio.create_task(pump(boundary))


async def stop(adapter):
    task = getattr(adapter,'_hub_chat_pump',None)
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        adapter._hub_chat_pump = None
