// The connections the daily connection check looks at, in the order it lists them: the one list
// behind both its probes (connection-check.mjs) and the Settings text of its routine
// (notebook-routines.mjs). It imports nothing, so both can read it without an import cycle.
// Every notice the check queues for the owner starts with this; the routine runner says only notices that do (it is written into godspeed-routines.json).
export const CONNECTION_NOTICE_PREFIX='connection-notice-';
export const CONNECTION_NAMES={
 ai:{label:'your AI',stops:'your routines and your chat cannot think'},
 telegram:{label:'Telegram',stops:'nothing from your mission control reaches you on Telegram and your messages there go unanswered'},
 github:{label:'GitHub',stops:'your notebook stops syncing with your other computers'},
 mail:{label:'Gmail',stops:'your assistants cannot search your mail or save drafts'},
 // Only on a server (#238): the disk is not a connection, but it is the one other thing the check tells the owner about.
 disk:{label:'your server\'s disk',stops:'your notebook, your backups and your assistant will stop'},
 agentmail:{label:"your mission control's own mailbox",stops:'a tracker that counts its mail cannot read it'},
 phone:{label:"the phone's health data",stops:"your briefing's health numbers stop"},
};
