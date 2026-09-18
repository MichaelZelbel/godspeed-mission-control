"""Create a new recovery-only scratch profile for the protected rollback probe."""
import json
from pathlib import Path
import sys
from hub_chat.recovery import preserve

runtime,bundle,profile=map(Path,sys.argv[1:])
profile.mkdir(parents=True,exist_ok=False)
snapshot=preserve(runtime,profile,bundle)
(profile/'hub-chat.json').write_text(json.dumps({'enabled':True,'runtime':str(runtime),'package':str(bundle),
                                               'recovery':snapshot,'proactive_paused':True}))
print('Prepared a recovery-only fixture. No bot connection was started.')
