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
print('Imported source-only UI with local adapters')
