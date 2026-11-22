"""Copy only tracked, reusable product source; never a user's configuration or outputs.

  python notebook/scripts/vendor-addons.py <folder> [add-on ...]
      copies each named add-on (every carried one when none is named) from the commit its checkout
      <folder>/dev/<add-on> has out, never from its working files, and pins that commit and the hash
      of every file it carries in third-party/addons/sources.json; the other add-ons' copies and
      pins stay as they are.
  python notebook/scripts/vendor-addons.py --check <folder>
      says which copied file differs from the commit its add-on is pinned to; exit 1 if any does.
  python notebook/scripts/vendor-addons.py --help
      prints this usage and exits 0.
A copy is never edited here by hand: a change goes into the add-on's own repository, and this
script brings the commit that holds it. A clone that is not where the folder says it is is said
in one plain line naming the add-on, and the run stops there, instead of ending in a traceback.

AN ADD-ON WITH NO REPOSITORY OF ITS OWN is carried in this repository instead, and its entry in
sources.json says so with "carriedHere": true in place of a commit (the Charm Challenge, built here
on 21 October 2026; a pin naming the commit of the branch it was built on would be gone after the
squash merge). Such an add-on is never copied from anywhere, so it is not in ADDONS below, and
naming it on the command line asks for a checkout that does not exist. --check still asks it the
same question as the others - do the pinned list and the files on disk agree? - but against the
product's own tracked files, the only source it has, and says so rather than claiming a commit
matched.
"""
import pathlib,subprocess,json,sys,shutil,hashlib
ADDONS=['godspeed-coach','godspeed-headache','godspeed-journal','godspeed-workouts','mc-phone','mc-video']
ACTIVATION='Explicit setup only. No connector or outward action is enabled by packaging.'
product=pathlib.Path(__file__).resolve().parents[2];target=product/'third-party/addons';pins_file=target/'sources.json'
# Git's own words are captured, so a failure is said the way this script says it, in one plain
# line, and not twice over.
# A person is present: a maintainer runs this script by hand.
git=lambda root,*a:subprocess.check_output(['git','-C',str(root),*a],stderr=subprocess.PIPE)
USAGE='''usage: python notebook/scripts/vendor-addons.py <folder> [add-on ...]
       python notebook/scripts/vendor-addons.py --check <folder>

Copies each named add-on (every carried one when none is named) from the commit its checkout
<folder>/dev/<add-on> has out, never from its working files, and pins that commit and the hash
of every file it carries in third-party/addons/sources.json. With --check, says which copied
file differs from the commit its add-on is pinned to; exit 1 if any does.'''

# Names are read as git holds them: `-z` ends every name with NUL and never quotes one, so a
# file named with a space or with non-ASCII characters is compared by its real name (23 Nov 2026).
# A name that is not valid UTF-8 comes back as raw bytes, held here as surrogates so the file on
# disk is still found by its own name, and printed escaped, by shown(), instead of ending the run
# in a traceback. `-z` is asked for by each caller, before any `--`, so it is read as the flag
# it is and never as a path.
def listed(root,*a):
    return [p for p in git(root,*a).decode('utf-8',errors='surrogateescape').split('\0') if p]
def shown(p):
    return p.encode('utf-8','surrogateescape').decode('utf-8','backslashreplace')

def selected(name,tracked):
    # mc-video's own sample clips are the ones its setup proves itself with (bin/mc-video.mjs,
    # stepProof); without them the setup run from this copy stopped at the proof (2026-10-18).
    own_sample=lambda p:name=='mc-video' and p.startswith('sample/')
    return [p for p in tracked if pathlib.PurePosixPath(p).parts[0] in ['bin','lib','skill','hermes','service','setup','tools','docs','fonts','test','sample','package.json','LICENSE','README.md','install.sh','config.example.env'] and not any(x in p for x in ['__pycache__','.env.','cache','secret']) and ('sample' not in p or own_sample(p))]

check='--check' in sys.argv;args=[a for a in sys.argv[1:] if a not in ('--check','--help','-h')]
if '--help' in sys.argv[1:] or '-h' in sys.argv[1:]:
    print(USAGE);sys.exit(0)
if not args or (check and len(args)!=1):
    print(USAGE,file=sys.stderr);sys.exit(2)
source=pathlib.Path(args[0]);pins=json.loads(pins_file.read_text(encoding='utf-8')) if pins_file.exists() else []

# The files of an add-on this repository carries itself, as the product tracks them: put through
# the same selection the other add-ons' commits go through, so the two are asked one same question.
# A file the index still holds after a re-pin dropped it is not on disk any more, and is not
# counted: the copy matches, and the deletion only has to be staged.
def carried_files(name):
    prefix=f'third-party/addons/{name}/'
    return selected(name,[p[len(prefix):] for p in listed(product,'ls-files','--cached','--others','--exclude-standard','-z','--',f'third-party/addons/{name}') if (product/p).exists()])

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
            wrong+=[f'{name}/{shown(p)} (carried here, missing from the pinned list)' for p in here if p not in pin['files']]
            wrong+=[f'{name}/{shown(p)} (in the pinned list, not carried here)' for p in pin['files'] if p not in here]
            continue
        try:
            expected=selected(name,listed(root,'ls-tree','-r','--name-only','-z',pin['commit']))
        except subprocess.CalledProcessError:
            wrong.append(f'{name} (no checkout at {root})');continue
        # Counted among the compared ones only once its commit was read: a clone that is missing
        # was compared with nothing, and is named in its own plain line instead.
        matched.append(name)
        here=[p[len(f'third-party/addons/{name}/'):] for p in listed(product,'ls-files','--cached','--others','--exclude-standard','-z','--',f'third-party/addons/{name}') if (product/p).exists()]
        wrong+=[f'{name}/{shown(p)} (in the commit, missing from the pinned list)' for p in expected if p not in pin['files']]
        wrong+=[f'{name}/{shown(p)} (in the pinned list, not in the commit)' for p in pin['files'] if p not in expected]
        wrong+=[f'{name}/{shown(p)} (copied, not in the commit)' for p in here if p not in expected]
        for p in expected:
            copy=target/name/p
            if not copy.is_file():wrong.append(f'{name}/{shown(p)} (missing from the copy)')
            elif copy.read_bytes()!=git(root,'show',f"{pin['commit']}:{p}"):wrong.append(f'{name}/{shown(p)} (differs from the commit)')
    # What was compared, always, so a pass never claims more than it asked. An add-on carried here
    # was held against no commit, and this says so instead of counting it among the matched ones.
    print('Compared with the commit it is pinned to: '+(', '.join(matched) or 'none')+'.')
    if own:print('Carried in this repository, with no commit of its own, so only its pinned list and its files here were compared: '+', '.join(own)+'.')
    print('\n'.join(wrong) or 'Every add-on above agrees with what it was compared against.');sys.exit(1 if wrong else 0)

wanted=args[1:] or list(ADDONS)
# Every clone is asked for before anything is copied, so a missing one stops the run with one
# plain line naming the add-on, and nothing here is half changed when it does.
for name in wanted:
    if any(e['name']==name and e.get('carriedHere') for e in pins):
        raise SystemExit(f'{name} is carried in this repository and has no checkout to copy from; its files here are the source.')
    root=source/'dev'/name
    if root.is_dir():
        try:git(root,'rev-parse','HEAD')
        except subprocess.CalledProcessError:root=None
    else:root=None
    if root is None:
        print(f'{name}: no checkout at {source/"dev"/name}; give the folder that holds the add-ons\' clones.',file=sys.stderr);sys.exit(1)

for name in wanted:
    root=source/'dev'/name
    commit=git(root,'rev-parse','HEAD').decode().strip()
    files=selected(name,listed(root,'ls-tree','-r','--name-only','-z',commit))
    shutil.rmtree(target/name,ignore_errors=True)
    hashes={}
    for p in files:
        content=git(root,'show',f'{commit}:{p}')
        dest=target/name/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(content)
        hashes[p]=hashlib.sha256(content).hexdigest()
    # The hash of every carried file, so a copy edited here can be found without the add-on's
    # repository: the gate's own test (notebook/test/addon-carried-hashes.test.mjs) recomputes
    # them from the copies alone. Rewritten on every re-pin with the rest of the entry.
    entry={'name':name,'commit':commit,'license':'MIT','files':files,'hashes':hashes,'activation':ACTIVATION}
    pins=[entry if e['name']==name else e for e in pins] if any(e['name']==name for e in pins) else sorted(pins+[entry],key=lambda e:e['name'])
    print(f'{name}: {len(files)} files from {commit}')
# LF on every platform, like the carried files themselves (written with write_bytes above). A run on
# Windows wrote the pins with CRLF, which this repository's .gitattributes turns back into LF on the
# way into a commit, so the file stayed "changed" in the working tree after every run (31 Oct 2026).
pins_file.write_text(json.dumps(pins,indent=2)+'\n',encoding='utf-8',newline='\n')
