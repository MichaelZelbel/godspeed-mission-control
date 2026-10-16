// Saving a note's text, and what the screen says when a save is refused.
//
// The server refuses a save when the same field of the note also changed
// somewhere else since the screen last saw it (another window, another device,
// the assistant), and keeps both versions for review. The write pipeline then
// holds the note's current version (record-writes.mjs), so typed text is sent
// once more: what is in the editor is the person's, and it is never dropped.
// The other version stays in the conflict pile, and the screen says where.
// Other changes (a tag, a pin, a move) are not sent again: they ask for the
// change to be made again.

const TEXT_FIELDS=new Set(['content','title']);

export const isConflict=error=>error?.code==='CONFLICT';
export const isTextOnly=updates=>{const keys=Object.keys(updates||{});return keys.length>0&&keys.every(key=>TEXT_FIELDS.has(key));};

// `save` sends the update and answers {data, error}. `kept` is true when the
// other version went to the conflict pile and this one was saved over it.
export async function saveNoteText(save,updates){
  let result=await save();
  if(isConflict(result?.error)&&isTextOnly(updates)){
    result=await save();
    if(!result?.error)return {...result,kept:true};
  }
  return {...result,kept:false};
}

export const OTHER_VERSION_KEPT='This note was also changed somewhere else at the same moment. Your text is saved, and the other version is kept in Settings under "Review conflicting edits".';

// The sentence after "Could not save ..." for a refused note save.
export function refusedNoteReason(error,updates){
  if(!isConflict(error))return null;
  return isTextOnly(updates)
    ? 'This note keeps changing somewhere else at the same moment. Your text is still in the editor and is saved with your next change; the other version is in Settings under "Review conflicting edits".'
    : 'This note was changed somewhere else at the same moment. Please make the change again; the other version is in Settings under "Review conflicting edits".';
}
