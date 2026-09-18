"""Refuse a partial package even when the Hermes patch itself still matches."""
import hashlib,json
from pathlib import Path


def verify(root,check_import=False):
    root=Path(root).resolve()
    manifest=json.loads((root/'bundle.json').read_text(encoding='utf-8'))
    files=manifest['files']
    digest=hashlib.sha256(json.dumps(files,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    if digest!=manifest.get('id'): raise ValueError('Package manifest identity differs')
    actual={file.relative_to(root).as_posix() for file in root.rglob('*')
            if file.is_file() and '__pycache__' not in file.parts and file.suffix not in ('.pyc','.pyo')
            and file!=root/'bundle.json'}
    if actual!=set(files): raise ValueError('Package contains missing or unlisted files')
    for name,expected in files.items():
        entry=root/name; file=entry.resolve()
        if entry.is_symlink() or not file.is_relative_to(root) or hashlib.sha256(file.read_bytes()).hexdigest()!=expected:
            raise ValueError('Package file differs: '+name)
    if check_import and Path(__file__).resolve().parents[2]!=root:
        raise ValueError('Loaded chat code is not from the configured immutable package')
    return manifest['id']
