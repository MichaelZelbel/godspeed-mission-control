// The sentence an activity row shows: "Created an action", "Updated a note", "Created a profile category: Hobbies" when the record has a name.
// Both activity lists said "Created a action" and "Created a event".
const article = word => /^[aeiou]/i.test(String(word || '')) ? 'an' : 'a';
export function formatAction(action, itemType, metadata, itemName) {
  const labels = {
    create: `Created ${article(itemType)} ${itemType}`,
    update: `Updated ${article(itemType)} ${itemType}`,
    delete: `Deleted ${article(itemType)} ${itemType}`,
    login: 'Signed in',
    profile_update: 'Updated profile',
    role_change: metadata?.new_role ? `Role changed to ${metadata.new_role}` : 'Role changed',
  };
  if (action === 'update' && metadata?.change === 'trash') labels.update = `Moved ${article(itemType)} ${itemType} to the trash`;
  if (action === 'update' && metadata?.change === 'restore') labels.update = `Restored ${article(itemType)} ${itemType}`;
  const text = labels[action] || `${action} ${itemType}`;
  const name = typeof itemName === 'string' ? itemName.trim() : '';
  if (!name || !['create', 'update', 'delete'].includes(action)) return text;
  return `${text}: ${name}${action === 'update' && metadata?.previous_name ? ` (was ${metadata.previous_name})` : ''}`;
}
