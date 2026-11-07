export const GODSPEED_PLUGINS=['godspeed-coach','godspeed-journal','godspeed-headache','godspeed-charm','godspeed-context','godspeed-reply','godspeed-chat-tidy'];
export const enabledGodspeedPlugins=(disabled=[])=>{const omitted=new Set(disabled);return GODSPEED_PLUGINS.filter(plugin=>!omitted.has(plugin));};
