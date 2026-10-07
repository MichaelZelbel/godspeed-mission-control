"""Extract public schema templates, never exported user rows."""
import pathlib,re,json,sys
root=pathlib.Path(sys.argv[1]);result={}
for path in sorted((root/'supabase/migrations').glob('*.sql')):
    text=path.read_text(encoding='utf-8')
    for match in re.finditer(r'INSERT INTO public\.collection_templates\s*\(([^)]+)\)\s*VALUES\s*([\s\S]*?)(?:ON CONFLICT|;)',text,re.I):
        columns=[c.strip() for c in match[1].split(',')]
        for row in re.finditer(r"\((\s*(?:'(?:[^']|'')*'(?:\s*::jsonb)?|true|false|\d+|NULL)(?:\s*,\s*(?:'(?:[^']|'')*'(?:\s*::jsonb)?|true|false|\d+|NULL))*\s*)\)",match[2],re.I):
            tokens=re.findall(r"'(?:[^']|'')*'(?:\s*::jsonb)?|true|false|\d+|NULL",row[1],re.I)
            if len(tokens)!=len(columns):raise ValueError('Unexpected template tuple '+str(path))
            data={}
            for key,value in zip(columns,tokens):
                value=re.sub(r'\s*::jsonb$','',value)
                if value.startswith("'"):value=value[1:-1].replace("''","'")
                elif value.lower() in ['true','false']:value=value.lower()=='true'
                elif value.upper()=='NULL':value=None
                else:value=int(value)
                data[key]=json.loads(value) if key=='field_schema' else value
            result[data['slug']]=data
target=pathlib.Path(__file__).resolve().parents[1]/'data';target.mkdir(exist_ok=True)
(target/'templates.json').write_text(json.dumps(list(result.values()),indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print('Imported '+str(len(result))+' public collection templates')
