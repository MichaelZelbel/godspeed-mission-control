import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pinRecordVersion, recordVersion } from "@/integrations/supabase/client";
import { saveUnsavedNoteText } from "@/hooks/useNotes";
import { DELETED_WHILE_WAITING, NOT_SAVED_YET, SAVED_AFTER_WAITING } from "@/lib/note-save.mjs";
import { showToast } from "@/lib/toast";
import { unsavedNotes, type UnsavedStatus } from "@/lib/unsaved-notes";

/**
 * Connects the keeper of unsaved note text (lib/unsaved-notes.ts) to the
 * notebook. Mounted once for the whole dashboard, so text left by an earlier
 * visit is sent as soon as the page opens, and by every note editor, so an
 * editor never depends on where it is shown.
 */
export function useUnsavedNotesKeeper() {
  const qc = useQueryClient();
  useEffect(() => {
    unsavedNotes.start({
      send: (id, unsaved) => saveUnsavedNoteText(qc, id, unsaved),
      versionOf: (id) => recordVersion("notes", id),
      pin: (id, version, baseline) => pinRecordVersion("notes", id, version, baseline),
      waiting: () => showToast.batched.error("note:update-failed", () => NOT_SAVED_YET),
      caughtUp: () => showToast.success(SAVED_AFTER_WAITING),
      gone: () => showToast.warning(DELETED_WHILE_WAITING),
    });
  }, [qc]);
}

export function KeepUnsavedNotes() {
  useUnsavedNotesKeeper();
  return null;
}

/** Whether a note has text the notebook has not confirmed yet, and whether its last save failed. */
export function useUnsavedNoteStatus(noteId: string): UnsavedStatus {
  return useSyncExternalStore(
    (changed) => unsavedNotes.subscribe((id) => { if (id === noteId) changed(); }),
    () => unsavedNotes.status(noteId),
    () => "saved",
  );
}
