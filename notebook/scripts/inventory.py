"""Build source evidence without copying personal records or credentials."""
import json, pathlib, re, subprocess, sys

source = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parents[2] / 'docs/full-version'
out.mkdir(parents=True, exist_ok=True)
root = source / 'dev/menerio/src'
pages = ['Notes','People','Profile','World','Collections','CollectionDetail','CollectionSchema',
         'CollectionTemplates','TimelinePage','MediaLibrary','ReviewQueue','Groups','GroupDetail',
         'WeeklyReview','Actions','ActivityPage','Dashboard','Settings']
seen = set()
def visit(p):
    p=p.resolve()
    if p.suffix not in ['.ts','.tsx','.js','.jsx','.css']: return
    if p in seen or not p.is_file(): return
    seen.add(p)
    text = p.read_text(encoding='utf-8')
    for name in re.findall(r'(?:from\s*|import\s*\()\s*["\']([^"\']+)', text):
        base = root / name[2:] if name.startswith('@/') else p.parent / name if name.startswith('.') else None
        if base:
            for candidate in [base, *(pathlib.Path(str(base)+x) for x in ['.ts','.tsx','.js','.jsx']), base/'index.ts',base/'index.tsx']:
                if candidate.is_file(): visit(candidate); break
for page in pages: visit(root/'pages'/f'{page}.tsx')
evidence=[]
for p in sorted(seen):
    text=p.read_text(encoding='utf-8')
    evidence.append({'source':str(p.relative_to(root.parent)).replace('\\','/'),
        'tables':sorted(set(re.findall(r'\.from\(["\']([^"\']+)',text))),
        'functions':sorted(set(re.findall(r'\.invoke\(["\']([^"\']+)',text))),
        'rpcs':sorted(set(re.findall(r'\.rpc\(["\']([^"\']+)',text)))})
jobs=json.loads((source/'dev/godspeed-engine/scripts/config/jobs.json').read_text(encoding='utf-8'))['jobs']
skills=[]
for p in sorted((source/'skills').glob('*/SKILL.md')):
    text=p.read_text(encoding='utf-8')
    skills.append({'name':p.parent.name,'source':f'skills/{p.parent.name}/SKILL.md','bytes':len(text.encode())})
procedures=(source/'procedures.md').read_text(encoding='utf-8')
register={'source':'procedures.md','headings':re.findall(r'^##+ (.+)$',procedures,re.M),
          'services':sorted(set(re.findall(r'[\w-]+\.(?:service|timer)',procedures)))}
result={'version':1,'menerio_commit':subprocess.check_output(['git','-C',str(source/'dev/menerio'),'rev-parse','HEAD'],text=True).strip(),
        'pages':pages,'dependencies':evidence,'skills':skills,'job_ids':[j['id'] for j in jobs],'procedure_register':register}
(out/'source-inventory.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
tables=sorted({t for e in evidence for t in e['tables']})
functions=sorted({t for e in evidence for t in e['functions']})
lines=['# Capability inventory','', 'This checklist is generated from current source dependencies. Passing a homepage is not parity.',
       'Every required item remains an acceptance obligation until its evidence is recorded.','', '## Notebook screens','']
lines += [f'- [ ] {p}: reused screen, file service integration and real UI verification required.' for p in pages]
lines += ['','## Record domains','']+[f'- [ ] `{t}`: read/write, references, restart, export and rebuild.' for t in tables]
lines += ['','## Processing functions','']+[f'- [ ] `{f}`: port processing, provider refusal and saved results.' for f in functions]
lines += ['','## Personal procedures','']+[f'- [ ] `{j["id"]}`: classify included, connector, superseded or separately owned with rationale.' for j in jobs]
lines += ['','## Recipes','']+[f'- [ ] `{s["name"]}`: reusable instructions or explicit ownership classification.' for s in skills]
lines += ['','## Permitted deferrals','','- Lexicon','- Note graph','', '## Release isolation','',
          '- No personal records, account identifiers, credentials or company output in the candidate.',
          '- Mac remains outside this Windows/VPS build request; existing stable installer is untouched.']
(out/'capabilities.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'screens':len(pages),'dependencies':len(evidence),'tables':len(tables),'functions':len(functions),'jobs':len(jobs),'recipes':len(skills)}))
