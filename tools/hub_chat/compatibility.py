"""All changed source bytes must match a reviewed manifest before activation."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import shutil


def replace_file(path, data):
    if data is None:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name+'.chat-update')
    temporary.write_bytes(data)
    if path.exists(): shutil.copymode(path, temporary)
    temporary.replace(path)


def upgrade_patch(root, bundle, manifest, previous):
    from .bundle import verify
    previous = Path(previous)
    verify(previous, check_import=False)
    old = previous/'integrations/hermes'
    old_manifest = json.loads((old/'compatibility.json').read_text(encoding='utf-8'))
    if inspect_runtime(root, old_manifest):
        raise ValueError('Preserve local runtime changes before upgrading the protected gateway')
    names = set(manifest['files']) | set(old_manifest['files'])
    for name in names:
        file = root/name
        if file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
            raise ValueError('Runtime patch path must remain inside the installation')
    before = {name: (root/name).read_bytes() if (root/name).exists() else None for name in names}
    # Prove both patches and resulting bytes in isolation before changing the runtime.
    with tempfile.TemporaryDirectory(prefix='hub-chat-upgrade-') as directory:
        stage = Path(directory)
        subprocess.run(['git','init','-q',str(stage)],check=True,capture_output=True)
        subprocess.run(['git','-C',str(stage),'config','core.autocrlf','false'],check=True)
        for name, data in before.items():
            if data is not None:
                (stage/name).parent.mkdir(parents=True,exist_ok=True)
                (stage/name).write_bytes(data)
        for patch, reverse in ((old/'patches'/old_manifest['patch'],True),
                               (bundle/'patches'/manifest['patch'],False)):
            command=['git','-C',str(stage),'apply']+(['--reverse'] if reverse else [])
            subprocess.run(command+['--check',str(patch)],check=True,capture_output=True)
            subprocess.run(command+[str(patch)],check=True,capture_output=True)
        desired={name:(stage/name).read_bytes() if (stage/name).exists() else None for name in names}
        for name, hashes in manifest['files'].items():
            digest=hashlib.sha256(desired[name]).hexdigest() if desired[name] is not None else None
            if digest!=hashes['patched']: raise ValueError('The replacement runtime does not match its manifest')
    changed=[]
    try:
        for name in sorted(names):
            if before[name]!=desired[name]:
                replace_file(root/name,desired[name])
                changed.append(name)
        if inspect_runtime(root,manifest): raise RuntimeError('Runtime changed during upgrade')
    except Exception:
        for name in reversed(changed): replace_file(root/name,before[name])
        raise
    return 'upgraded'


def manifest_path():
    return Path(__file__).parent/'compatibility.json'


def inspect_runtime(root,manifest=None):
    root = Path(root)
    manifest = manifest or json.loads(manifest_path().read_text(encoding='utf-8'))
    problems = []
    marker=root/'.hub-chat-source.json'
    if marker.exists():
        from .recovery import verify
        record=verify(root.parent)
        head=record['revision']
    else:
        head = subprocess.run(['git','-C',str(root),'rev-parse','HEAD'],capture_output=True,text=True,check=True).stdout.strip()
    if head != manifest['hermes_commit']:
        problems.append('Hermes revision is not the tested revision')
    for name,hashes in manifest['files'].items():
        path = root/name
        digest = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
        if digest != hashes['patched']:
            problems.append('Runtime file differs: '+name)
    return problems


def verify_runtime(root):
    problems = inspect_runtime(root)
    if problems:
        raise RuntimeError('; '.join(problems))


def install_patch(root,bundle,previous=None):
    root,bundle = Path(root),Path(bundle)
    manifest = json.loads((bundle/'compatibility.json').read_text(encoding='utf-8'))
    if not inspect_runtime(root,manifest):
        return 'already installed'
    head = subprocess.run(['git','-C',str(root),'rev-parse','HEAD'],capture_output=True,text=True,check=True).stdout.strip()
    if head != manifest['hermes_commit']:
        raise ValueError('This Hermes version has not passed the chat compatibility checks')
    for name,hashes in manifest['files'].items():
        file = root/name
        digest = hashlib.sha256(file.read_bytes()).hexdigest() if file.exists() else None
        if digest != hashes['original']:
            if previous:
                return upgrade_patch(root,bundle,manifest,previous)
            raise ValueError('Preserve local runtime changes before installing: '+name)
    patch = bundle/'patches'/manifest['patch']
    subprocess.run(['git','-C',str(root),'apply','--check',str(patch)],check=True,capture_output=True)
    subprocess.run(['git','-C',str(root),'apply',str(patch)],check=True,capture_output=True)
    if inspect_runtime(root,manifest):
        raise RuntimeError('Patch verification failed; do not start this runtime')
    return 'installed'
