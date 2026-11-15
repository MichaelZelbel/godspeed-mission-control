import { useEffect } from "react";
// A chat docked beside a note or a collection is the chat while it is open.
// The floating chat button sits fixed in the same corner and covered the
// docked chat's send button (seen 6 October 2026), so it steps aside.
export function useDockedChat() {
  useEffect(() => {
    const body = document.body;
    body.dataset.dockedChat = String(Number(body.dataset.dockedChat || 0) + 1);
    return () => {
      const left = Number(body.dataset.dockedChat || 1) - 1;
      if (left > 0) body.dataset.dockedChat = String(left); else delete body.dataset.dockedChat;
    };
  }, []);
}
