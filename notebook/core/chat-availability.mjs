/** @type {readonly ['none','ready','refused','unreachable','stalled','settings-only','unreadable']} */
// 'unreadable': the saved AI connection exists but cannot be read, so it cannot be used (#826).
export const CHAT_AVAILABILITIES=Object.freeze(['none','ready','refused','unreachable','stalled','settings-only','unreadable']);

export function chatAvailability(value){
  if(!CHAT_AVAILABILITIES.includes(value))throw new Error('Invalid chat availability');
  return value;
}
