import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NoteEditorSheet } from "@/components/note-editor";
import { NoteBubble } from "@/components/notes-tray";
import { useAuth } from "@/lib/auth";
import { fetchNotes } from "@/lib/notes";

/**
 * The note bubble above a profile photo. On my own profile it is always there ("Share a note"
 * until I write one) and opens the editor; on someone else's it only shows when they have a note
 * you are allowed to see (people they have a note for are the ones who follow them).
 */
export function useProfileNote(profileId: string, isMe: boolean) {
  const { user } = useAuth();
  const meId = user?.id ?? "";
  const notes = useQuery({
    queryKey: ["notes", meId],
    queryFn: () => fetchNotes(meId),
    enabled: !!meId,
    staleTime: 30_000,
  });
  const note = notes.data?.find((n) => n.userId === profileId) ?? null;
  return { note, visible: isMe || !!note };
}

export function ProfileNoteBubble({
  note,
  isMe,
}: {
  note: Parameters<typeof NoteEditorSheet>[0]["mine"];
  isMe: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (!isMe) {
    return note ? (
      <div className="absolute bottom-full left-0 mb-1.5">
        <NoteBubble size="profile">{note.body}</NoteBubble>
      </div>
    ) : null;
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={note ? "Edit your note" : "Share a note"}
        className="absolute bottom-full left-0 mb-1.5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <NoteBubble size="profile" dashed={!note}>
          {note ? note.body : "Share a note"}
        </NoteBubble>
      </button>
      <NoteEditorSheet open={editing} onOpenChange={setEditing} mine={note} />
    </>
  );
}
