// What Hermes refuses to read in a context file. Hermes scans AGENTS.md (and SOUL.md) before it
// puts it into the prompt, and a single match blanks the WHOLE file: the assistant then runs with
// "[BLOCKED: AGENTS.md contained potential prompt injection ...]" in place of its manual
// (Hermes agent/prompt_builder.py _scan_context_content, tools/threat_patterns.py, scope
// "context": the patterns of scope "all" and "context"). The Identity page checks a change
// against the same patterns before it saves, so a persona like "you are now a pirate" is
// refused with a plain sentence instead of silently costing the assistant its manual.
//
// Ported from Hermes' tools/threat_patterns.py as installed on 15 October 2026. Python's \w
// matches letters of every script; here it is written [\p{L}\p{N}_] with the u flag for the same.
const W='[\\p{L}\\p{N}_]';
const FILLER='(?:'+W+'+\\s+){0,8}';
const SECRET_VAR='\\$\\{?'+W+'*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\\b';
const PATTERNS=[
  ['ignore\\s+'+FILLER+'(previous|all|above|prior)\\s+'+FILLER+'instructions','prompt_injection'],
  ['system\\s+prompt\\s+override','sys_prompt_override'],
  ['disregard\\s+'+FILLER+'(your|all|any)\\s+'+FILLER+'(instructions|rules|guidelines)','disregard_rules'],
  ['act\\s+as\\s+(if|though)\\s+'+FILLER+'you\\s+'+FILLER+'(have\\s+no|don\'t\\s+have)\\s+'+FILLER+'(restrictions|limits|rules)','bypass_restrictions'],
  ['<!--[^>]{0,512}(?:ignore|override|system|secret|hidden)[^>]{0,512}-->','html_comment_injection'],
  ['<\\s*div\\s+style\\s*=\\s*["\'][^>]{0,2048}display\\s*:\\s*none','hidden_div'],
  ['translate\\s+[^\\n]{0,512}\\s+into\\s+'+W+'+(?:[\\s-]+'+W+'+){0,2}\\s+and\\s+(execute|run|eval)\\b','translate_execute'],
  ['do\\s+not\\s+'+FILLER+'tell\\s+'+FILLER+'the\\s+user','deception_hide'],
  ['you\\s+are\\s+'+FILLER+'now\\s+(?:a|an|the)\\s+','role_hijack'],
  ['pretend\\s+'+FILLER+'(you\\s+are|to\\s+be)\\s+','role_pretend'],
  ['output\\s+'+FILLER+'(system|initial)\\s+prompt','leak_system_prompt'],
  ['(respond|answer|reply)\\s+without\\s+'+FILLER+'(restrictions|limitations|filters|safety)','remove_filters'],
  ['you\\s+have\\s+been\\s+'+FILLER+'(updated|upgraded|patched)\\s+to','fake_update'],
  ['\\bname\\s+yourself\\s+'+W+'+','identity_override'],
  ['register\\s+(as\\s+)?a?\\s*node','c2_node_registration'],
  ['(heartbeat|beacon|check[\\s\\-]?in)\\s+(to|with)\\s+','c2_heartbeat'],
  ['pull\\s+(down\\s+)?(?:new\\s+)?task(?:ing|s)?\\b','c2_task_pull'],
  ['connect\\s+to\\s+the\\s+network\\b','c2_network_connect'],
  ['you\\s+must\\s+(?:'+W+'+\\s+){0,3}(register|connect|report|beacon)\\b','forced_action'],
  ['only\\s+use\\s+one[\\s\\-]?liners?\\b','anti_forensic_oneliner'],
  ['never\\s+'+FILLER+'(?:create|write)\\s+'+FILLER+'(?:script|file)\\s+'+FILLER+'disk','anti_forensic_disk'],
  ['unset\\s+'+W+'*(?:CLAUDE|CODEX|HERMES|AGENT|OPENAI|ANTHROPIC)'+W+'*','env_var_unset_agent'],
  ['\\b(?:cobalt\\s*strike|sliver|havoc|mythic|metasploit|brainworm)\\b','known_c2_framework'],
  ['\\bc2\\s+(?:server|channel|infrastructure|beacon)\\b','c2_explicit'],
  ['\\bcommand\\s+and\\s+control\\b','c2_explicit_long'],
  ['curl\\s+[^\\n]{0,2048}'+SECRET_VAR,'exfil_curl'],
  ['wget\\s+[^\\n]{0,2048}'+SECRET_VAR,'exfil_wget'],
  ['cat\\s+[^\\n]{0,2048}(\\.env|credentials|\\.netrc|\\.pgpass|\\.npmrc|\\.pypirc)','read_secrets'],
].map(([source,id])=>[new RegExp(source,'iu'),id]);
const INVISIBLE=new Set([...'\u200b\u200c\u200d\u2060\u2062\u2063\u2064\ufeff\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069']);
// Hermes scans at most this much of a file.
const MAX_SCAN_CHARS=65536;

// Every finding in `text`: {id, words}, words being the text that matched (or the invisible character).
export function scanContext(text){
  let content=String(text??'');if(content.startsWith('\ufeff'))content=content.slice(1);
  content=[...content].slice(0,MAX_SCAN_CHARS).join('');
  const found=[...new Set([...content].filter(ch=>INVISIBLE.has(ch)))].map(ch=>({id:'invisible_unicode_U+'+ch.codePointAt(0).toString(16).toUpperCase().padStart(4,'0'),words:'an invisible character'}));
  const normal=content.normalize('NFKC');
  for(const [pattern,id] of PATTERNS){const match=pattern.exec(normal);if(match)found.push({id,words:match[0].replace(/\s+/g,' ').trim().slice(0,120)});}
  return found;
}
// The findings `after` has that `before` did not: what a change would bring in. A manual that
// already carries a match keeps it (its owner may know why); the change is judged on its own.
export function newFindings(before,after){const old=new Set(scanContext(before).map(f=>f.id));return scanContext(after).filter(f=>!old.has(f.id));}
