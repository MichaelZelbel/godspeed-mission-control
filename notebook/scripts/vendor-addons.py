"""Copy only tracked, reusable product source; never a user's configuration or outputs.

  python notebook/scripts/vendor-addons.py <folder> [add-on ...]
      copies each named add-on (every carried one when none is named) from the commit its checkout
      <folder>/dev/<add-on> has out, never from its working files, and pins that commit in
      third-party/addons/sources.json; the other add-ons' copies and pins stay as they are.
  python notebook/scripts/vendor-addons.py --check <folder>
      says which copied file differs from the commit its add-on is pinned to; exit 1 if any does.
A copy is never edited here by hand: a change goes into the add-on's own repository, and this
script brings the commit that holds it.

AN ADD-ON WITH NO REPOSITORY OF ITS OWN is carried in this repository instead, and its entry in
sources.json says so with "carriedHere": true in place of a commit (the Charm Challenge, built here
on 21 October 2026; a pin naming the commit of the branch it was built on would be gone after the
squash merge). Such an add-on is never copied from anywhere, so it is not in ADDONS below, and
naming it on the command line asks for a checkout that does not exist. --check still asks it the
same question as the others - do the pinned list and the files on disk agree? - but against the
product's own tracked files, the only source it has, and says so rather than claiming a commit
matched.
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

# The files of an add-on this repository carries itself, as the product tracks them: put through
# the same selection the other add-ons' commits go through, so the two are asked one same question.
def carried_files(name):
    return selected(name,[p[len(f'third-party/addons/{name}/'):] for p in git(product,'ls-files','--cached','--others','--exclude-standard','--',f'third-party/addons/{name}').decode().splitlines()])

if check:
    # What the pinned commit holds decides, never the list in sources.json alone: a file left out of
    # both the list and the copy is as wrong as a changed one.
    wrong=[];matched=[];own=[]
    for pin in pins:
        root,name=source/'dev'/pin['name'],pin['name']
        if pin.get('carriedHere'):
            # No repository of its own, so there is no commit to read and no copy to compare with:
            # the files here ARE the source. What is still worth asking is whether the pinned list
            # and the files on disk say the same thing, in both directions.
            own.append(name);here=carried_files(name)
            wrong+=[f'{name}/{p} (carried here, missing from the pinned list)' for p in here if p not in pin['files']]
            wrong+=[f'{name}/{p} (in the pinned list, not carried here)' for p in pin['files'] if p not in here]
            continue
        matched.append(name)
        expected=selected(name,git(root,'ls-tree','-r','--name-only',pin['commit']).decode().splitlines())
        here=[p[len(f'third-party/addons/{name}/'):] for p in git(product,'ls-files','--cached','--others','--exclude-standard','--',f'third-party/addons/{name}').decode().splitlines()]
        wrong+=[f'{name}/{p} (in the commit, missing from the pinned list)' for p in expected if p not in pin['files']]
        wrong+=[f'{name}/{p} (in the pinned list, not in the commit)' for p in pin['files'] if p not in expected]
        wrong+=[f'{name}/{p} (copied, not in the commit)' for p in here if p not in expected]
        for p in expected:
            copy=target/name/p
            if not copy.is_file():wrong.append(f'{name}/{p} (missing from the copy)')
            elif copy.read_bytes()!=git(root,'show',f"{pin['commit']}:{p}"):wrong.append(f'{name}/{p} (differs from the commit)')
    # What was compared, always, so a pass never claims more than it asked. An add-on carried here
    # was held against no commit, and this says so instead of counting it among the matched ones.
    print('Compared with the commit it is pinned to: '+(', '.join(matched) or 'none')+'.')
    if own:print('Carried in this repository, with no commit of its own, so only its pinned list and its files here were compared: '+', '.join(own)+'.')
    print('\n'.join(wrong) or 'Every add-on above agrees with what it was compared against.');sys.exit(1 if wrong else 0)

for name in args[1:] or ADDONS:
    if any(e['name']==name and e.get('carriedHere') for e in pins):
        raise SystemExit(f'{name} is carried in this repository and has no checkout to copy from; its files here are the source.')
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
