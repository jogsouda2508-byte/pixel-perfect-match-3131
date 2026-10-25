import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { useAuth } from "@/lib/auth";
import { startConversation } from "@/lib/chat";
import { fetchNotes, type NoteView } from "@/lib/notes";
import { NoteEditorSheet } from "@/components/note-editor";
import { timeAgo } from "@/lib/time";

/** The little speech bubble that sits above a photo. */
export function NoteBubble({
  children,
  dashed = false,
  size = "tray",
}: {
  children: React.ReactNode;
  dashed?: boolean;
  /** "tray" is centred above a small photo; "profile" is wider and points at the left of the photo */
  size?: "tray" | "profile";
}) {
  const profile = size === "profile";
  return (
    <span
      className={`relative flex items-center justify-center rounded-2xl text-center font-medium leading-tight shadow-md ${
        profile
          ? "min-h-9 w-max max-w-[11.5rem] px-3 py-2 text-xs"
          : "mx-auto mb-2.5 min-h-9 max-w-[84px] px-2.5 py-1.5 text-[11px]"
      } ${
        dashed
          ? "border border-dashed border-primary/50 bg-primary/5 text-primary"
          : "border border-border bg-card text-foreground"
      }`}
    >
      <span className="line-clamp-3 break-words">{children}</span>
      <span
        aria-hidden="true"
        className={`absolute -bottom-1 h-2 w-2 rotate-45 border-b border-r ${
          profile ? "left-7" : "left-1/2 -translate-x-1/2"
        } ${dashed ? "border-primary/50 bg-background" : "border-border bg-card"}`}
      />
    </span>
  );
}

/**
 * A row above the chat list: my note first, then the notes of people I follow. A note is one
 * short line that disappears after 24 hours. Tap someone's note to open your chat with them.
 */
export function NotesTray() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const meId = user?.id ?? "";

  const notes = useQuery({
    queryKey: ["notes", meId],
    queryFn: () => fetchNotes(meId),
    enabled: !!meId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const mine = notes.data?.find((n) => n.mine) ?? null;
  const others = (notes.data ?? []).filter((n) => !n.mine);

  const openEditor = () => setEditing(true);
  const openChat = async (n: NoteView) => {
    if (opening) return;
    setOpening(n.userId);
    try {
      const id = await startConversation(n.userId);
      await navigate({ to: "/chat/$id", params: { id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open the chat.");
    } finally {
      setOpening(null);
    }
  };

  if (!meId) return null;
  const myName = profile?.full_name || profile?.username || "";

  return (
    <>
      <section
        aria-label="Notes"
        className="glass-card -mx-1 flex gap-3 overflow-x-auto px-4 pb-3 pt-4 [scrollbar-width:none] sm:mx-0 [&::-webkit-scrollbar]:hidden"
      >
        <div className="w-[84px] shrink-0">
          <button
            type="button"
            onClick={openEditor}
            aria-label={mine ? "Edit your note" : "Share a note"}
            className="flex w-full flex-col items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <NoteBubble dashed={!mine}>{mine ? mine.body : "Share a note"}</NoteBubble>
            <span className="relative">
              <Avatar src={profile?.avatar_url} name={myName} size={60} />
              {!mine && (
                <span className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground">
                  <Plus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
                </span>
              )}
            </span>
            <span className="mt-1.5 block w-full truncate text-center text-xs">Your note</span>
          </button>
        </div>

        {others.map((n) => (
          <div key={n.userId} className="w-[84px] shrink-0">
            <button
              type="button"
              onClick={() => void openChat(n)}
              aria-label={`${n.name}'s note: ${n.body}. Open chat`}
              className="flex w-full flex-col items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <NoteBubble>{n.body}</NoteBubble>
              <span className="relative">
                <Avatar src={n.avatar} name={n.name} size={60} />
                {opening === n.userId && (
                  <span className="absolute inset-0 grid place-items-center rounded-full bg-black/40">
                    <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden="true" />
                  </span>
                )}
              </span>
              <span className="mt-1.5 block w-full truncate text-center text-xs">
                {n.name.split(" ")[0]}
              </span>
              <span className="block text-[10px] text-muted-foreground">
                {timeAgo(n.updatedAt)}
              </span>
            </button>
          </div>
        ))}
      </section>

      <NoteEditorSheet open={editing} onOpenChange={setEditing} mine={mine} />
    </>
  );
}
