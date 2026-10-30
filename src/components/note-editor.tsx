import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { BottomSheet } from "@/components/bottom-sheet";
import { NoteBubble } from "@/components/notes-tray";
import { useAuth } from "@/lib/auth";
import { deleteNote, NOTE_MAX, saveNote, type NoteView } from "@/lib/notes";

const IDEAS = [
  "🎧 Listening to music",
  "📚 Studying",
  "☕ Chai time",
  "💪 At the gym",
  "😴 Sleeping",
  "✈️ Travelling",
];

/** Bottom sheet to write, change or delete my note. Used by the chat list and by my profile. */
export function NoteEditorSheet({
  open,
  onOpenChange,
  mine,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mine: NoteView | null;
}) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const meId = user?.id ?? "";
  const myName = profile?.full_name || profile?.username || "";
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (open) setDraft(mine?.body ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = useMutation({
    mutationFn: (body: string) => saveNote(body),
    onSuccess: () => {
      toast.success("Note shared for 24 hours");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["notes", meId] }),
  });
  const remove = useMutation({
    mutationFn: () => deleteNote(meId),
    onSuccess: () => {
      toast.success("Note deleted");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["notes", meId] }),
  });

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={mine ? "Your note" : "Share a note"}
      description="A short update that people who follow you see for 24 hours."
      compact
      focusOnOpen={false}
      footer={
        <>
          {mine ? (
            <button
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending || save.isPending}
              className="min-h-10 flex-1 rounded-full border border-border bg-card text-[13px] font-semibold text-destructive hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="min-h-10 flex-1 rounded-full border border-border bg-card text-[13px] font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={() => save.mutate(draft.trim())}
            disabled={!draft.trim() || save.isPending || remove.isPending}
            className="flex min-h-10 flex-[1.4] items-center justify-center gap-2 rounded-full bg-gradient-brand text-[13px] font-semibold text-primary-foreground glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {mine ? "Update" : "Share"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="pt-1">
          <NoteBubble dashed={!draft.trim()}>{draft.trim() || "Your note…"}</NoteBubble>
          <div className="flex justify-center">
            <Avatar src={profile?.avatar_url} name={myName} size={44} />
          </div>
        </div>
        <div>
          <label htmlFor="note-text" className="sr-only">
            Note
          </label>
          <input
            id="note-text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))}
            placeholder="What's on your mind?"
            maxLength={NOTE_MAX}
            className="w-full rounded-xl border border-border bg-elevated/40 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="mt-1 text-right text-[11px] text-muted-foreground">
            {draft.length}/{NOTE_MAX}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="Ideas">
          {IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setDraft(idea.slice(0, NOTE_MAX))}
              className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {idea}
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
