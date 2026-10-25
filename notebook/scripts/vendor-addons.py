"""Copy only tracked, reusable product source; never a user's configuration or outputs.

  python notebook/scripts/vendor-addons.py <folder> [add-on ...]
      copies each named add-on (every carried one when none is named) from the commit its checkout
      <folder>/dev/<add-on> has out, never from its working files, and pins that commit in
      third-party/addons/sources.json; the other add-ons' copies and pins stay as they are.
  python notebook/scripts/vendor-addons.py --check <folder>
      says which copied file differs from the commit its add-on is pinned to; exit 1 if any does.
A copy is never edited here by hand: a change goes into the add-on's own repository, and this
script brings the commit that holds it.
"""
import pathlib,subprocess,json,sys,shutil
ADDONS=['godspeed-coach','godspeed-headache','godspeed-journal','mc-phone','mc-video']
ACTIVATION='Explicit setup only. No connector or outward action is enabled by packaging.'
product=pathlib.Path(__file__).resolve().parents[2];target=product/'third-party/addons';pins_file=target/'sources.json'
git=lambda root,*a:subprocess.check_output(['git','-C',str(root),*a])

def selected(name,tracked):
    # mc-video's own sample clips are the ones its setup proves itself with (bin/mc-video.mjs,
    # stepProof); without them the setup run from this copy stopped at the proof (2026-10-18).
    own_sample=lambda p:name=='mc-video' and p.startswith('sample/')
    return [p for p in tracked if pathlib.PurePosixPath(p).parts[0] in ['bin','lib','skill','hermes','service','setup','tools','docs','fonts','test','sample','package.json','LICENSE','README.md','install.sh','config.example.env'] and not any(x in p for x in ['__pycache__','.env.','cache','secret']) and ('sample' not in p or own_sample(p))]

check='--check' in sys.argv;args=[a for a in sys.argv[1:] if a!='--check']
source=pathlib.Path(args[0]);pins=json.loads(pins_file.read_text(encoding='utf-8')) if pins_file.exists() else []

if check:
    wrong=[]
    for pin in pins:
        root,name=source/'dev'/pin['name'],pin['name']
        for p in pin['files']:
            copy=target/name/p
            if not copy.is_file() or copy.read_bytes()!=git(root,'show',f"{pin['commit']}:{p}"):wrong.append(f'{name}/{p}')
        here=git(product,'ls-files','--cached','--others','--exclude-standard','--',f'third-party/addons/{name}').decode().splitlines()
        wrong+=[f'{p} (not in the pinned list)' for p in here if p[len(f'third-party/addons/{name}/'):] not in pin['files']]
    print('\n'.join(wrong) or 'Every carried add-on matches the commit it is pinned to.');sys.exit(1 if wrong else 0)

for name in args[1:] or ADDONS:
    root=source/'dev'/name
    commit=git(root,'rev-parse','HEAD').decode().strip()
    files=selected(name,git(root,'ls-tree','-r','--name-only',commit).decode().splitlines())
    shutil.rmtree(target/name,ignore_errors=True)
    for p in files:
        dest=target/name/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(git(root,'show',f'{commit}:{p}'))
    entry={'name':name,'commit':commit,'license':'MIT','files':files,'activation':ACTIVATION}
    pins=[entry if e['name']==name else e for e in pins] if any(e['name']==name for e in pins) else sorted(pins+[entry],key=lambda e:e['name'])
    print(f'{name}: {len(files)} files from {commit}')
pins_file.write_text(json.dumps(pins,indent=2)+'\n',encoding='utf-8')
