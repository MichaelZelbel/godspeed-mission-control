"""Read the same pinned IANA data on Windows, Mac and Linux."""
from io import BytesIO
from pathlib import Path
import re
import zipfile
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from functools import lru_cache


@lru_cache(maxsize=64)
def zone(name):
    if not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9_+\-/]+',name) or name.startswith('/'):
        raise ZoneInfoNotFoundError('Invalid timezone name')
    archive=Path(__file__).parent/'data/tzdata-2026.4-py2.py3-none-any.whl'
    with zipfile.ZipFile(archive) as data:
        try: body=data.read('tzdata/zoneinfo/'+name)
        except KeyError: raise ZoneInfoNotFoundError('Unknown timezone: '+name) from None
    return ZoneInfo.from_file(BytesIO(body),key=name)
