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
    from .telegram_request import GuardedRequest
    return GuardedRequest(request,boundary)


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
            return await function(adapter,*args,**kwargs)
    return wrapped


def quiet_stream(adapter):
    return get(adapter) is not None


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
        return SendResult(success=False,error='Approval has no authenticated request',error_kind='forbidden')
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
        asyncio.run_coroutine_threadsafe(edit_approval(boundary,request_id),loop)
    if not register_gateway_settle(prompt.session_key,request_id,settled):
        chat.approvals.settle(request_id,'cancelled')
        return SendResult(success=False,error='Request is no longer waiting',error_kind='forbidden')
    summary = prompt.description.strip() or 'Run the requested command'
    text = summary + '\n\n' + prompt.command[:1800] + '\n\nIf you do not approve, this action will not run. This request expires shortly.'
    labels = {'once':'Approve once','session':'Approve for this session','always':'Save approval for this command','deny':'Decline'}
    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton(labels[choice],callback_data=f'ea:{choice}:{request_id}')] for choice in prompt.choices])
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
        return SendResult(success=False,error='Approval delivery could not be confirmed',error_kind='forbidden')


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
    text = json.loads(row['body'])['summary'] + '\n\n' + boundary.chat.approvals.text(row['state'])
    try:
        with boundary.output('approval_result',request_id,row['message_id']):
            await boundary.adapter._bot.edit_message_text(chat_id=row['conversation'],message_id=int(row['message_id']),text=text,reply_markup=None)
        with boundary.chat.store.transaction() as db:
            result = json.loads(row['result'])
            result['presented_state'] = row['state']
            db.execute('UPDATE approvals SET result=? WHERE id=?',(canonical(result),request_id))
    except Exception as exc:
        if 'message is not modified' not in str(exc).lower():
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
    await query.answer(text=boundary.chat.approvals.text(row['state'])[:190])
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
