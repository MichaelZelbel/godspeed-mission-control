"""Preserve the tested source and its Python environment before enabling chat.

An external update is left intact. Recovery starts the preserved copy in the same
service process, with the same profile and permissions, never a second consumer.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import sysconfig
import tarfile
import tempfile
from .contracts import fingerprint


def inventory(root):
    result={}
    for directory in ('source','env','python'):
        for path in sorted((root/directory).rglob('*')):
            if '__pycache__' in path.parts or path.suffix in ('.pyc','.pyo'): continue
            name=path.relative_to(root).as_posix()
            if path.is_symlink():
                result[name]={'link':os.readlink(path)}
            elif path.is_file():
                with path.open('rb') as stream:
                    result[name]=hashlib.file_digest(stream,'sha256').hexdigest() if hasattr(hashlib,'file_digest') else hashlib.sha256(stream.read()).hexdigest()
    return result


def seal(root,revision,bundle):
    record={'schema':1,'revision':revision,'bundle':str(bundle),'files':inventory(root)}
    (root/'recovery.json').write_text(json.dumps(record,sort_keys=True)+'\n',encoding='utf-8')
    return record


def verify(root):
    root=Path(root)
    record=json.loads((root/'recovery.json').read_text(encoding='utf-8'))
    if record.get('schema')!=1 or inventory(root)!=record.get('files'):
        raise ValueError('The preserved runtime has changed. Recovery was refused.')
    return record


def preserve(runtime,profile,bundle):
    from .compatibility import verify_runtime, manifest_path
    verify_runtime(runtime)
    if sys.prefix==sys.base_prefix:
        raise ValueError('A dedicated Hermes Python environment is required for recovery')
    manifest=json.loads(manifest_path().read_text())
    key=fingerprint([manifest,str(bundle),sys.version])[:24]
    parent=profile/'chat-recovery'; parent.mkdir(exist_ok=True,mode=0o700)
    target=parent/key
    if target.exists():
        verify(target)
        return str(target)
    # Keep incomplete snapshots for diagnosis; only the final rename activates one.
    pending=Path(tempfile.mkdtemp(prefix='incomplete-',dir=parent))
    source=pending/'source'; source.mkdir()
    archive=pending/'source.tar'
    with archive.open('wb') as output:
        subprocess.run(['git','-C',str(runtime),'archive',manifest['hermes_commit']],stdout=output,check=True)
    with tarfile.open(archive) as packed:
        packed.extractall(source,filter='data')
    archive.unlink()
    for name in manifest['files']:
        destination=source/name; destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(runtime/name,destination)
    # Only this marker permits a source archive instead of a git checkout.
    (source/'.hub-chat-source.json').write_text(json.dumps({'revision':manifest['hermes_commit']}))
    shutil.copytree(sys.prefix,pending/'env',symlinks=True,
                    ignore=shutil.ignore_patterns('__pycache__','*.pyc','*.pyo'))
    purelib=Path(sysconfig.get_paths()['purelib']).relative_to(sys.prefix)
    (pending/'env'/purelib/'hub_chat.pth').write_text(str(bundle/'tools')+'\nimport hub_chat.startup\n',encoding='utf-8')
    # Hermes can own a downloadable base interpreter as well as the virtualenv.
    # Preserve that interpreter too so its updater cannot remove our recovery path.
    base=Path(sys.base_prefix).resolve()
    if (base.is_relative_to(runtime.resolve()) or '.hermes-runtime' in base.parts) and os.name!='nt':
        shutil.copytree(base,pending/'python',symlinks=False,
                        ignore=shutil.ignore_patterns('__pycache__','*.pyc','*.pyo'))
        executable=pending/'env/bin/python'
        executable.unlink()
        executable.symlink_to(target/'python/bin'/Path(sys._base_executable).name)
        cfg=pending/'env/pyvenv.cfg'
        lines=cfg.read_text().splitlines()
        cfg.write_text('\n'.join('home = '+str(target/'python/bin') if line.startswith('home = ') else line for line in lines)+'\n')
    seal(pending,manifest['hermes_commit'],bundle)
    verify(pending)
    pending.replace(target)
    return str(target)


def recover(profile,config):
    root=Path(config['recovery']).resolve()
    record=verify(root)
    # A second failure must stop, not create an exec loop.
    if os.environ.get('HUB_CHAT_RECOVERY')==str(root):
        raise RuntimeError('The preserved runtime could not start')
    python=root/'env'/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
    if not python.exists(): raise ValueError('The preserved Python interpreter is missing')
    from .setup import atomic_json
    config=dict(config,proactive_paused=True,package=record['bundle'])
    atomic_json(profile/'hub-chat.json',config)
    atomic_json(profile/'chat-recovery-active.json',{'runtime':str(root/'source'),'revision':record['revision'],
                'reason':'The updated Hermes runtime is not certified; the tested copy is active.'})
    os.environ['HUB_CHAT_RECOVERY']=str(root)
    os.environ['HERMES_HOME']=str(profile)
    os.environ['PYTHONDONTWRITEBYTECODE']='1'
    # .pth startup runs before this expression; it inserts the verified source.
    expression='import sys; sys.argv[0]="hermes"; from hermes_cli.main import main; main()'
    os.execv(str(python),[str(python),'-c',expression,*sys.argv[1:]])
