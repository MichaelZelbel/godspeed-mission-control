export const NOTEBOOK_CHAT_FUNCTIONS=Object.freeze(['conversation-chat','note-chat','collection-chat']);

export const isNotebookChat=name=>NOTEBOOK_CHAT_FUNCTIONS.includes(name);
