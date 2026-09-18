"""Operator entry point. It never sends directly to Telegram."""
import argparse
import json
import os
from pathlib import Path
import sys
from .app import Chat
from .contracts import utcnow


def main():
    parser = argparse.ArgumentParser(description='Inspect and configure clear Telegram conversations')
    parser.add_argument('--profile',type=Path,default=Path(os.environ.get('HERMES_HOME',Path.home()/'.hermes')))
    sub = parser.add_subparsers(dest='command',required=True)
    doctor=sub.add_parser('doctor'); doctor.add_argument('--runtime',type=Path)
    queue=sub.add_parser('submit'); queue.add_argument('items',nargs='+')
    sub.add_parser('preview')
    sub.add_parser('status')
    migrate=sub.add_parser('migrate'); migrate.add_argument('file',type=Path)
    setup=sub.add_parser('configure')
    setup.add_argument('--runtime',type=Path,required=True)
    setup.add_argument('--bundle',type=Path,required=True)
    setup.add_argument('--conversation',required=True)
    setup.add_argument('--actor',required=True)
    setup.add_argument('--hub',type=Path,required=True)
    setup.add_argument('--timezone',default='UTC')
    setup.add_argument('--language',choices=('en','de'),default='en')
    args=parser.parse_args()
    if args.command=='doctor':
        from .doctor import inspect
        report=inspect(args.profile,args.runtime)
        print(json.dumps(report,indent=2)); return 0 if report['healthy'] else 1
    if args.command=='submit':
        from .inbox import submit
        print(json.dumps(submit(args.profile/'chat-inbox',args.items))); return 0
    if args.command=='configure':
        from .setup import configure
        print(json.dumps(configure(args),indent=2)); return 0
    config=json.loads((args.profile/'hub-chat.json').read_text(encoding='utf-8'))
    chat=Chat(args.profile/'chat-state',config['conversation_id'],config.get('timezone','UTC'),config.get('language','en'))
    try:
        from .source_adapters import configure_sources,discover
        configure_sources(chat,config)
        if args.command=='preview':
            now=utcnow(); draft=chat.compose(chat.sources.refresh(discover(config),now),now)
            print(draft.text if draft else 'No verified item needs a message.')
        elif args.command=='migrate':
            from .migrate import import_legacy
            print(json.dumps(import_legacy(chat,args.file)))
        else:
            print(json.dumps({'delivery_states':chat.store.rows('SELECT state,count(*) AS count FROM deliveries GROUP BY state'),
                              'approval_states':chat.store.rows('SELECT state,count(*) AS count FROM approvals GROUP BY state')},indent=2))
    finally:
        chat.close()
    return 0


if __name__=='__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print('Chat setup needs attention: '+str(exc),file=sys.stderr)
        sys.exit(1)
