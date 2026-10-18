// A route change renders before its hydration effect. Never persist the old
// conversation under the new route's key during that intermediate render.
export function readScopedChat(binding,key,load){
 return binding.key===key?binding.state:load();
}
export function updateScopedChat(binding,key,update,load){
 const previous=readScopedChat(binding,key,load);
 return {key,state:typeof update==='function'?update(previous):update};
}
export function persistScopedChat(binding,key,save){
 if(binding.key!==key)return false;
 save(binding.state);return true;
}
