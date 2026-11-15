// The sentence an activity row shows: "Created an action", "Updated a note".
// Both activity lists said "Created a action" and "Created a event".
const article = word => /^[aeiou]/i.test(String(word || '')) ? 'an' : 'a';
export function formatAction(action, itemType, metadata) {
  const labels = {
    create: `Created ${article(itemType)} ${itemType}`,
    update: `Updated ${article(itemType)} ${itemType}`,
    delete: `Deleted ${article(itemType)} ${itemType}`,
    login: 'Signed in',
    profile_update: 'Updated profile',
    role_change: metadata?.new_role ? `Role changed to ${metadata.new_role}` : 'Role changed',
  };
  return labels[action] || `${action} ${itemType}`;
}
