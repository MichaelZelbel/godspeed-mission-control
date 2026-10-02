"""Run an extracted full-alpha package in isolated local Docker storage only.

Usage (Linux/WSL): python3 verify-vps.py PACKAGE.tar.gz EVIDENCE.json [PRIOR_IMAGE]
Never points at a remote Docker host. Leaves the stopped candidate volumes for inspection.
"""
import base64, hashlib, http.client, json, os, pathlib, ssl, subprocess, sys, tarfile, tempfile, time, uuid

if os.environ.get('DOCKER_HOST') or os.environ.get('DOCKER_CONTEXT'):
    raise SystemExit('Use the local verification Docker engine, with no remote context.')
package=pathlib.Path(sys.argv[1]).resolve(); output=pathlib.Path(sys.argv[2]).resolve()
root=pathlib.Path(tempfile.mkdtemp(prefix='godspeed-vps-package-'))
with tarfile.open(package) as archive:
    for member in archive.getmembers():
        if member.name.startswith('/') or '..' in pathlib.PurePosixPath(member.name).parts or not member.isfile():
            raise ValueError('Unsafe package entry')
    archive.extractall(root,filter='data')
def command(*args):
    result=subprocess.run(args,cwd=root,text=True,capture_output=True,check=True)
    return result.stdout
command('sha256sum','-c','SHA256SUMS'); manifest=json.loads((root/'manifest.json').read_text())
command('docker','load','-i','image.tar.gz')
project='godspeed-full-alpha-acceptance-'+uuid.uuid4().hex[:8]; token='synthetic-package-acceptance-token'
def environment(image):
    (root/'candidate.env').write_text('\n'.join([
      'GODSPEED_CANDIDATE_IMAGE='+image,'GODSPEED_CADDY_IMAGE='+manifest['caddy'],
      'GODSPEED_CANDIDATE_TOKEN='+token,'GODSPEED_CANDIDATE_LOCAL_PORT=47834',
      'GODSPEED_CANDIDATE_HTTPS_PORT=48444','GODSPEED_CANDIDATE_COMPUTER_PORT=47447'])+'\n')
    (root/'candidate.env').chmod(0o600)
def compose(*args):return command('docker','compose','-p',project,'--env-file','candidate.env','-f','compose.yaml',*args)
if command('docker','ps','-a','--filter','label=com.docker.compose.project='+project,'--format','{{.ID}}').strip():
    raise ValueError('The dedicated acceptance project already exists; preserve it and use a fresh test engine.')
checks=[]; cookie=''
def request(route,body=None,authenticated=True):
    connection=http.client.HTTPSConnection('localhost',48444,context=ssl._create_unverified_context(),timeout=15)
    headers={'Content-Type':'application/json'}
    if authenticated:headers['Cookie']=cookie
    connection.request('POST' if body is not None else 'GET',route,json.dumps(body) if body is not None else None,headers)
    response=connection.getresponse();data=response.read();status=response.status; response_headers=dict(response.getheaders());connection.close()
    return status,json.loads(data) if data and data[:1] in [b'{',b'['] else data,response_headers
def wait():
    for _ in range(90):
        try:
            if request('/health',authenticated=False)[0]==200:return
        except (OSError,http.client.HTTPException):pass
        time.sleep(1)
    raise RuntimeError('Candidate did not become healthy')
def login():
    global cookie
    status,_,headers=request('/api/login',{'token':token},False);assert status==200
    assert 'Secure' in headers['Set-Cookie'] and 'HttpOnly' in headers['Set-Cookie']
    cookie=headers['Set-Cookie'].split(';')[0]
def post(route,body):
    status,data,_=request('/api/'+route,body);assert status==200,(route,status,data);return data
def retained():
    note=post('query',{'table':'notes','filters':[['eq','id','package-acceptance']]})['data'][0]
    assert note['content']=='Offline Unicode fixture: Grüße 日本語';return note
try:
    environment(manifest['image']);compose('up','-d');wait();login();checks.append('fresh packaged image with separate HTTPS, volumes and ports')
    assert request('/api/query',{'table':'notes'},False)[0]==401
    link=post('login-link',{})['path'];assert request(link,authenticated=False)[0]==303;assert request(link,authenticated=False)[0]==401
    checks.append('TLS, authenticated data and one-use login link')
    note=post('query',{'table':'notes','operation':'insert','values':{'id':'package-acceptance','title':'Synthetic package test','content':'Offline Unicode fixture: Grüße 日本語'}})['data'][0]
    png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4wAAAABJRU5ErkJggg==');digest=hashlib.sha256(png).hexdigest()
    post('media/transfer',{'mapping':{'path':'synthetic/acceptance.png','file':digest+'-acceptance.png','sha256':digest,'size':len(png),'contentType':'image/png'},'data':base64.b64encode(png).decode()})
    assert request('/api/media/file/synthetic/acceptance.png')[1]==png
    compose('restart','notebook');wait();login();assert retained()['uid']==note['uid'];checks.append('restart preserves exact identity and Unicode note')
    native_create="from hermes_state import SessionDB;db=SessionDB();db.create_session('package-native-history','cli');mid=db.append_message('package-native-history','user','Synthetic native file history');assert mid==1;db.close()"
    compose('exec','-T','-u','hermes','notebook','python','-c',native_create)
    native_rebuild="import os;from pathlib import Path;home=Path(os.environ['HERMES_HOME']);(home/'state.db').unlink();from hermes_state import SessionDB;db=SessionDB();rows=db.get_messages('package-native-history');assert len(rows)==1 and rows[0]['id']==1 and rows[0]['content']=='Synthetic native file history';db.close()"
    compose('exec','-T','-u','hermes','notebook','python','-c',native_rebuild)
    checks.append('actual native assistant conversation and message identity recover from files after database deletion')
    compose('exec','-T','notebook','node','/opt/godspeed/kit/notebook/bin/godspeed.mjs','backup','/opt/data/full-candidate/backups/acceptance')
    compose('stop','notebook')
    compose('run','--rm','--no-deps','--entrypoint','sh','notebook','-c','rm -f "$GODSPEED_WORKSPACE/.godspeed/search.sqlite"')
    compose('up','-d','notebook');wait();login();assert retained()['uid']==note['uid'];checks.append('index loss rebuilds from durable files')
    if len(sys.argv)>3:
        compose('stop','notebook');environment(sys.argv[3]);compose('up','-d','notebook');wait();login();assert retained()['uid']==note['uid'];checks.append('prior compatible image rollback retains data')
        compose('stop','notebook');environment(manifest['image']);compose('up','-d','notebook');wait();login();assert retained()['uid']==note['uid'];checks.append('upgrade from prior image retains data after checked backup')
    code="import {Store} from '/opt/godspeed/kit/notebook/core/records/store.mjs';import {restore} from '/opt/godspeed/kit/notebook/core/archives.mjs';import fs from 'node:fs';const root='/opt/data/full-candidate/acceptance-restored',store=new Store(root);restore(store,root+'/media','/opt/data/full-candidate/backups/acceptance');const note=store.get('notes','package-acceptance');if(note.content!=='Offline Unicode fixture: Grüße 日本語')throw new Error('Restoration mismatch');console.log(JSON.stringify({uid:note.uid,problems:store.problems}));"
    result=json.loads(compose('exec','-T','notebook','node','--input-type=module','-e',code));assert result['uid']==note['uid'] and not result['problems']
    media_digest=compose('exec','-T','notebook','sha256sum','/opt/data/full-candidate/acceptance-restored/media/'+digest+'-acceptance.png').split()[0];assert media_digest==digest
    checks.append('checked backup restores identities, documents and media bytes into separate empty storage')
    output.parent.mkdir(parents=True,exist_ok=True)
    with package.open('rb') as handle:package_hash=hashlib.file_digest(handle,'sha256').hexdigest()
    output.write_text(json.dumps({'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'syntheticOnly':True,'revision':manifest['revision'],'imageId':manifest['imageId'],'package_sha256':package_hash,'project':project,'checks':checks},indent=2)+'\n')
    print(json.dumps({'verified':checks,'evidence':str(output)}))
finally:
    compose('stop')
