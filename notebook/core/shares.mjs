// A note that goes to the trash, or is removed, stops being shared: its public
// link is switched off, so restoring the note later does not quietly publish it
// again. Until 6 October 2026 a trashed note's link kept working.
export async function retireShares(store, noteIds) {
  const ids = new Set(noteIds.filter(Boolean));
  if (!ids.size) return 0;
  const active = store.list('shared_notes').filter(share => share.is_active && ids.has(share.note_id));
  for (const share of active) await store.saveAsync('shared_notes', { id: share.id, is_active: false, deactivated_at: new Date().toISOString(), deactivated_because: 'The note was moved to the trash or removed' });
  return active.length;
}
