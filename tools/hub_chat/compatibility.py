"""All changed source bytes must match a reviewed manifest before activation."""
import hashlib
import json
from pathlib import Path
import subprocess


def manifest_path():
    return Path(__file__).parent/'compatibility.json'


def inspect_runtime(root,manifest=None):
    root = Path(root)
    manifest = manifest or json.loads(manifest_path().read_text(encoding='utf-8'))
    problems = []
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


def install_patch(root,bundle):
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
            raise ValueError('Preserve local runtime changes before installing: '+name)
    patch = bundle/'patches'/manifest['patch']
    subprocess.run(['git','-C',str(root),'apply','--check',str(patch)],check=True,capture_output=True)
    subprocess.run(['git','-C',str(root),'apply',str(patch)],check=True,capture_output=True)
    if inspect_runtime(root,manifest):
        raise RuntimeError('Patch verification failed; do not start this runtime')
    return 'installed'
