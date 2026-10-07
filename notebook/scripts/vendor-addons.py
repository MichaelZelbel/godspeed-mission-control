"""Copy only tracked, reusable product source; never a user's configuration or outputs."""
import pathlib,subprocess,shutil,json,sys
source=pathlib.Path(sys.argv[1]);target=pathlib.Path(__file__).resolve().parents[2]/'third-party/addons';target.mkdir(parents=True,exist_ok=True)
evidence=[]
for name in ['godspeed-coach','godspeed-journal','mc-phone','mc-video']:
    root=source/'dev'/name
    commit=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
    tracked=subprocess.check_output(['git','-C',str(root),'ls-files'],text=True).splitlines()
    selected=[p for p in tracked if pathlib.PurePosixPath(p).parts[0] in ['bin','lib','skill','hermes','service','setup','tools','docs','fonts','test','package.json','LICENSE','README.md','install.sh','config.example.env'] and not any(x in p for x in ['__pycache__','.env.','sample','cache','secret'])]
    for namepath in selected:
        dest=target/name/namepath;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/namepath,dest)
    evidence.append({'name':name,'commit':commit,'license':'MIT','files':selected,'activation':'Explicit setup only. No connector or outward action is enabled by packaging.'})
(target/'sources.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
print('Packaged four reusable add-ons with source pins and licenses')
