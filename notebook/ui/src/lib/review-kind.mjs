// What a Review card holds, in plain words, and a sentence for the card's hover title. Until 23
// October 2026 the page showed only red and blue calendars: timeline entries and facts about a
// person had the same icon, and the words for them were written down but never shown.
// `names` maps a person's id to their name, for "Fact about <name>".
export function reviewKind(item, names = new Map()) {
  const p = item?.payload || {}, type = item?.suggestion_type;
  const personId = p.contact_id || (['contact', 'person'].includes(p.subject_type) ? p.subject_id : null);
  const who = personId ? names.get(personId) || p.contact_name || p.subject_name || 'someone' : p.is_owner === false && p.contact_name ? p.contact_name : null;
  switch (type) {
    case 'add_claim':
    case 'add_profile_entry':
    case 'unknown_profile_field':
      return who ? {label: 'Fact about ' + who, hint: 'Something to remember about ' + who + '. Keep adds it to their profile.'}
        : {label: 'Fact about you', hint: 'Something to remember about you. Keep adds it to your profile.'};
    case 'add_moment': return {label: 'Timeline entry', hint: 'Something that happened on a day. Keep puts it on your timeline.'};
    case 'add_contact': return {label: 'New person', hint: 'Someone a note names who is not in your People yet. Keep adds them.'};
    case 'add_relationship': return {label: 'How two people are related', hint: 'Keep records how these two people are related.'};
    case 'add_alias': return {label: 'Another name', hint: 'Another name someone goes by. Keep adds it to their names.'};
    case 'connect_note_person':
    case 'link_note': return {label: 'Note about a person', hint: 'Keep links this note to the person it is about.'};
    case 'add_entity': return {label: 'New thing in World', hint: 'A place, company or thing a note names. Keep adds it to World.'};
    case 'group_member_suggestion': return {label: 'Group member', hint: 'Keep adds this person to the group.'};
    case 'normalize_profile_entry': return {label: 'Profile cleanup', hint: 'Several entries that say the same thing, made into one.'};
    case 'merge_duplicate_person': return {label: 'Same person twice', hint: 'Keep makes these people one.'};
    case 'resolve_relationship_conflict': return {label: 'Relationship conflict', hint: 'Two relationships that cannot both be right. Choose which one to keep.'};
    case 'adjudicate_relationship': return {label: 'Relationship evidence', hint: 'What a note says about how two people are related.'};
    case 'deadline_both_changed': return {label: 'A reminder changed in two places', hint: 'Its file in due/ and its page in the notebook were both changed. The page is being kept; both versions are here.'};
    case 'source_version': return {label: 'New version of a file', hint: 'An imported file changed. Keep takes the new version.'};
    case 'media_conflict': return {label: 'Two versions of a file', hint: 'A file was changed in two places. Keep holds on to both.'};
    case 'outward_patch': return {label: 'Change to send out', hint: 'Keep sends this change.'};
    default: return {label: 'Suggestion', hint: 'Keep applies it; Roll Back takes it away.'};
  }
}
