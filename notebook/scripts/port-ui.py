"""Explicit source-only import. Never copy .env, data exports, builds or node_modules."""
import pathlib, shutil, json, subprocess, sys
source=pathlib.Path(sys.argv[1]); target=pathlib.Path(__file__).resolve().parents[1]/'ui'
target.mkdir(exist_ok=True)
for directory in ['src', 'supabase/functions/_shared']:
    shutil.copytree(source/directory,target/directory,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__tests__','*.test.*'))
for name in ['LICENSE','tailwind.config.ts','postcss.config.js','tsconfig.json','tsconfig.app.json','tsconfig.node.json']:
    shutil.copyfile(source/name,target/name)
package=json.loads((source/'package.json').read_text(encoding='utf-8'))
package['name']='godspeed-mission-control-notebook-ui';package['license']='AGPL-3.0-only'
package['scripts']={'build':'vite build','dev':'vite --host 127.0.0.1'}
for group in ['dependencies','devDependencies']:
    for name in list(package[group]):
        if name.startswith('@powersync/') or name.startswith('@journeyapps/') or name in ['@tauri-apps/cli','lovable-tagger','vite-plugin-pwa']: del package[group][name]
(target/'package.json').write_text(json.dumps(package,indent=2)+'\n',encoding='utf-8')
(target/'UPSTREAM.md').write_text('Reused from MichaelZelbel/menerio at '+subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()+'.\nLicense: AGPL-3.0-only. See LICENSE. No personal data or upstream credentials are included.\n',encoding='utf-8')
# Replaced files are maintained locally and reapplied from a separate adapter directory.
adapters=pathlib.Path(__file__).resolve().parents[1]/'adapters'
for p in adapters.rglob('*'):
    if p.is_file():
        dest=target/p.relative_to(adapters);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest)
# These transformations are explicit compatibility fixes, not silent feature removal.
p=target/'src/hooks/useContactRelationships.ts';text=p.read_text(encoding='utf-8').replace('/^[0-9a-f-]{36}$/i','/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}$/');p.write_text(text,encoding='utf-8')
p=target/'src/hooks/useGroups.ts';text=p.read_text(encoding='utf-8').replace('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i','/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}$/');p.write_text(text,encoding='utf-8')
p=target/'src/hooks/useContactTopics.ts';text=p.read_text(encoding='utf-8').replace('navigator.onLine','true');p.write_text(text,encoding='utf-8')
p=target/'src/components/notes/MediaAnalysisOverlay.tsx';text=p.read_text(encoding='utf-8').replace('const match = path.match(/\\/note-attachments\\/(.+)$/);','const match = path.match(/\\/(?:note-attachments|api\\/media\\/file)\\/(.+)$/);');p.write_text(text,encoding='utf-8')
p=target/'src/pages/MediaLibrary.tsx';text=p.read_text(encoding='utf-8').replace('import.meta.env.VITE_SUPABASE_URL','location.origin').replace('/functions/v1/backfill-media-analysis','/api/functions/backfill-media-analysis');p.write_text(text,encoding='utf-8')
p=target/'src/components/layout/GlobalCreateButton.tsx';text=p.read_text(encoding='utf-8').replace('"https://tjeapelvjlmbxafsmjef.supabase.co"','location.origin').replace('/functions/v1/link-note','/api/functions/link-note');p.write_text(text,encoding='utf-8')
p=target/'src/lib/chat-history.ts';text=p.read_text(encoding='utf-8');text="import { loadFileChat, saveFileChat, clearFileChat } from '@/local/file-chat';\n"+text
start=text.index('export function loadChatState(');end=text.index('/**\n * Build the API payload',start)
text=text[:start]+'''export function loadChatState(userId: string | undefined, contextKey: string): PersistedChatState {
  return loadFileChat(contextKey);
}
export function saveChatState(userId: string | undefined, contextKey: string, state: PersistedChatState): void {
  saveFileChat(contextKey, state);
}
export function clearChatState(userId: string | undefined, contextKey: string): void {
  clearFileChat(contextKey);
}

'''+text[end:];p.write_text(text,encoding='utf-8')
print('Imported source-only UI with local adapters')
p=target/'src/components/settings/ApiKeysManager.tsx';text=p.read_text(encoding='utf-8').replace('"https://mcp.menerio.com"','location.origin + "/mcp"');text=text.replace('{ value: "graph", label: "Graph", desc: "Connections and graph data" },','').replace('{ value: "lexicon", label: "Lexicon", desc: "Lexicon pages" },','');p.write_text(text,encoding='utf-8')
