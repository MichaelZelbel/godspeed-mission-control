/** @type {readonly ['none','ready','refused','unreachable','stalled','settings-only']} */
export const CHAT_AVAILABILITIES=Object.freeze(['none','ready','refused','unreachable','stalled','settings-only']);

export function chatAvailability(value){
  if(!CHAT_AVAILABILITIES.includes(value))throw new Error('Invalid chat availability');
  return value;
}
