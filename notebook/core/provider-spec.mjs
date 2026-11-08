// The host decides both how Settings talks to a provider and what Hermes saves for it. Keep that
// classification here so a successfully tested connection is the same provider routines receive.
const providers=[
 {provider:'openrouter',key:'OPENROUTER_API_KEY',base_url:'https://openrouter.ai/api/v1',matches:host=>host==='openrouter.ai'||host.endsWith('.openrouter.ai')},
 {provider:'anthropic',key:'ANTHROPIC_API_KEY',base_url:'https://api.anthropic.com/v1',matches:host=>host==='api.anthropic.com',messages:'https://api.anthropic.com/v1/messages'},
 {provider:'openai-api',key:'OPENAI_API_KEY',base_url:'https://api.openai.com/v1',matches:host=>host==='api.openai.com'},
 {provider:'gemini',key:'GEMINI_API_KEY',aliases:['GOOGLE_API_KEY']}
];
export const providerForHost=host=>providers.find(entry=>entry.matches?.(host));
export const providerForName=name=>providers.find(entry=>entry.provider===name);
export const messagesProviderForHost=host=>providerForHost(host)?.messages||null;
