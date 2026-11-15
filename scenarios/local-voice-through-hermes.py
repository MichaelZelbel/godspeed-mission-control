import argparse, importlib, importlib.util, inspect, json, sys

def fail(words): raise SystemExit("FAIL local-voice: " + words)
ap=argparse.ArgumentParser();ap.add_argument("--audio",required=True);ap.add_argument("--transcript",required=True);ap.add_argument("--call",required=True);ap.add_argument("--source");a=ap.parse_args()
if a.source: sys.path.insert(0,a.source)
if importlib.util.find_spec("hermes_bootstrap"): import hermes_bootstrap  # noqa: F401
try:
 import faster_whisper  # noqa: F401
 local=importlib.import_module("tools.transcription_local")
except ImportError as error: fail("the installed Hermes environment cannot load local transcription: %s"%error)
function=next((getattr(local,n,None) for n in ("transcribe_local","_transcribe_local") if callable(getattr(local,n,None))),None)
if not function: fail("Hermes exposes no local transcription entry point")
known={"audio":a.audio,"audio_path":a.audio,"audio_file":a.audio,"path":a.audio,"file":a.audio,"file_path":a.audio,"input_path":a.audio,"source":a.audio,"language":None,"model":"tiny","model_name":"tiny"};arguments={}
for name,parameter in inspect.signature(function).parameters.items():
 if name in known: arguments[name]=known[name]
 elif parameter.default is inspect.Parameter.empty and parameter.kind not in (parameter.VAR_POSITIONAL,parameter.VAR_KEYWORD): fail("Hermes local transcription now requires an unsupported argument: "+name)
answer=function(**arguments)
if isinstance(answer,dict): answer=answer.get("text") or answer.get("transcript")
elif isinstance(answer,tuple): answer=answer[0]
text=str(answer or "").strip()
if not text: fail("Hermes local transcription returned no words")
open(a.transcript,"w",encoding="utf-8").write(text+"\n")
json.dump({"function":function.__module__+"."+function.__name__,"language":arguments.get("language","absent")},open(a.call,"w",encoding="utf-8"))
