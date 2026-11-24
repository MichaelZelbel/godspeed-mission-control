// The sentence an activity row shows: "Created an action", "Updated a note", "Created a profile category: Hobbies" when the record has a name.
// Both activity lists said "Created a action" and "Created a event".
const article = word => /^[aeiou]/i.test(String(word || '')) ? 'an' : 'a';
export function formatAction(action, itemType, metadata, itemName) {
  const named = typeof itemName === 'string' && itemName.trim() ? `: ${itemName.trim()}` : '';
  const labels = {
    create: `Created ${article(itemType)} ${itemType}${named}`,
    update: `Updated ${article(itemType)} ${itemType}${named}`,
    delete: `Deleted ${article(itemType)} ${itemType}${named}`,
    login: 'Signed in',
    profile_update: 'Updated profile',
    role_change: metadata?.new_role ? `Role changed to ${metadata.new_role}` : 'Role changed',
  };
  return labels[action] || `${action} ${itemType}`;
}
