// Quoted titles and source bodies are data, not permission or refusal clauses.
export function explicitNoteCapture(message){
 const request=String(message).trim(),intent=request.replace(/"(?:\\.|[^"\\])*"|“[^”]*”|„[^“]*“/g,' supplied passage ');
 const head=intent.split(/\b(?:with\s+(?:(?:exactly|this|the|following)\s+)*(?:content|text)|containing|mit\s+(?:(?:diesem|folgendem)\s+)*(?:inhalt|text))\b/i)[0];
 // A contextual preface may introduce a real instruction. Keep the instruction
 // anchored so discussion of what a note tool could do never grants permission.
 const command=head.replace(/^(?:for|in|as part of)\s+[^.!?;\n,]{1,100},\s*/i,'');
 const direct=/^(?:(?:please|bitte)\s+|(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:(?:use\s+(?:your|the)\s+note\s+tool\s+to\s+)?(?:create|make|save|keep|write|capture|add)|revise|edit|update|rewrite|erstell\w*|speicher\w*|ändere|bearbeite)\b/i.test(command);
 const capture=/\b(?:create|make|save|keep|write|capture|add|erstell\w*|speicher\w*)\b[^.!?;\n]{0,240}\b(?:note|notes|notiz|notizen)\b/i.test(command);
 if(!direct||!capture||/\b(?:if|unless|suppose|hypothetical(?:ly)?|for example|someone said|quoted|wenn|falls|beispielsweise)\b/i.test(head))return false;
 return !/\b(?:do not|don.t|never|must not|should not|nicht|niemals)\s+(?:create|make|save|keep|write|capture|add|erstell\w*|speicher\w*)\b[^.!?;\n]{0,120}\b(?:note|notes|notiz|notizen)\b/i.test(intent);
}

