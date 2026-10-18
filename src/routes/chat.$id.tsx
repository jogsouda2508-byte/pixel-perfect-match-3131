import { createFileRoute, Link } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Send, Smile } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";
import { SharedVideoCard } from "@/components/shared-video-card";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getConversation, getMessages, markRead, sendMessage } from "@/lib/chat";
import type { MessageRow } from "@/integrations/supabase/types";
import { timeAgo } from "@/lib/time";

// Loaded on first open only: the emoji data is large and most visits never need it.
const EmojiPickerPanel = lazy(() => import("@/components/emoji-picker"));

type DisplayMessage = MessageRow & { status?: "sending" | "failed" };

export const Route = createFileRoute("/chat/$id")({
  head: () => ({
    meta: [{ title: "Conversation — Gicco chat" }],
  }),
  component: ConversationPage,
});

function ConversationPage() {
  const { id } = Route.useParams();
  return <ConversationDetail key={id} id={id} />;
}

function ConversationDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [screenError, setScreenError] = useState("");
  const sendingRef = useRef(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const emojiWrapRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const contact = useQuery({
    queryKey: ["chat-contact", id, user?.id],
    queryFn: () => getConversation(id, user!.id),
    enabled: !!user,
  });
  const history = useQuery({
    queryKey: ["chat-messages", id],
    queryFn: () => getMessages(id),
    enabled: !!user,
  });

  useEffect(() => {
    if (history.isSuccess) {
      setMessages((current) => {
        const currentIds = new Set(current.map((message) => message.id));
        return [...current, ...history.data.filter((message) => !currentIds.has(message.id))].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      });
    }
  }, [history.data, history.isSuccess]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const markConversationRead = async () => {
      try {
        await markRead(id);
        if (active) {
          void queryClient
            .invalidateQueries({ queryKey: ["chat-conversations", user.id] })
            .then(() => queryClient.invalidateQueries({ queryKey: ["chat-unread", user.id] }))
            .catch((error: unknown) => {
              console.error("Refreshing unread conversations failed", error);
              if (active) setScreenError("The unread count couldn't be refreshed.");
            });
        }
      } catch {
        if (active) setScreenError("Couldn't update this conversation. Please try again.");
      }
    };
    void markConversationRead();

    const channel = supabase
      .channel(`chat:${id}:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${id}`,
        },
        (payload) => {
          const incoming = payload.new as MessageRow;
          setMessages((current) =>
            current.some((message) => message.id === incoming.id)
              ? current
              : [...current, incoming].sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                ),
          );
          void markConversationRead();
        },
      )
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Conversation realtime subscription failed", error);
          if (active)
            setScreenError("Live updates are unavailable. Refresh to check for messages.");
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [id, queryClient, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const deliver = async (message: DisplayMessage) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setScreenError("");
    setMessages((current) =>
      current.map((item) => (item.id === message.id ? { ...item, status: "sending" } : item)),
    );
    try {
      const saved = await sendMessage(id, message.body);
      setMessages((current) => {
        const withoutPending = current.filter((item) => item.id !== message.id);
        if (withoutPending.some((item) => item.id === saved.id)) return withoutPending;
        return [...withoutPending, saved].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      });
      void queryClient
        .invalidateQueries({ queryKey: ["chat-conversations", user?.id] })
        .catch((error: unknown) => {
          console.error("Refreshing the chat list failed", error);
          setScreenError("Your message was sent, but the chat list couldn't be refreshed.");
        });
    } catch (cause) {
      setMessages((current) =>
        current.map((item) => (item.id === message.id ? { ...item, status: "failed" } : item)),
      );
      setScreenError(cause instanceof Error ? cause.message : "Couldn't send your message.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  // Close the picker on outside click / Escape.
  useEffect(() => {
    if (!emojiOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (emojiWrapRef.current?.contains(target) || emojiButtonRef.current?.contains(target)) {
        return;
      }
      setEmojiOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [emojiOpen]);

  /** Inserts the emoji at the caret (or over the selection) without touching other text. */
  const insertEmoji = (emoji: string) => {
    const input = composerRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    if (next.length > 2000) {
      setScreenError("Messages must be 2000 characters or fewer.");
      return;
    }
    setScreenError("");
    setDraft(next);
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      // Only grab focus on larger screens, so phones don't pop the keyboard over the picker.
      if (window.matchMedia("(min-width: 640px)").matches) el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sendingRef.current) return;
    if (body.length > 2000) {
      setScreenError("Messages must be 2000 characters or fewer.");
      return;
    }
    setScreenError("");
    setDraft("");
    setEmojiOpen(false);
    const optimistic: DisplayMessage = {
      id: `pending-${crypto.randomUUID()}`,
      conversation_id: id,
      sender_id: user!.id,
      body,
      created_at: new Date().toISOString(),
      shared_post_id: null,
      status: "sending",
    };
    setMessages((current) => [...current, optimistic]);
    void deliver(optimistic);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const name = contact.data?.full_name || contact.data?.username || "Conversation";

  return (
    <PageShell showBottomNav={false}>
      <section className="flex min-h-[calc(100dvh-6rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card">
        <header className="flex min-h-16 items-center gap-2 border-b border-border px-3 py-2">
          <Link
            to="/chat"
            aria-label="Back to chats"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          {contact.isLoading ? (
            <span className="text-sm text-muted-foreground">Loading conversation…</span>
          ) : contact.data ? (
            <Link
              to="/u/$username"
              params={{ username: contact.data.username }}
              className="flex min-w-0 items-center gap-3 rounded-lg p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar src={contact.data.avatar_url} name={name} size={40} />
              <span className="truncate text-sm font-semibold">{name}</span>
            </Link>
          ) : (
            <h1 className="truncate text-sm font-semibold">{name}</h1>
          )}
        </header>

        {contact.isError && (
          <p className="border-b border-border p-3 text-sm text-destructive" role="alert">
            This conversation couldn't be opened.
          </p>
        )}
        {history.isLoading && (
          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-label="Loading messages">
            <div className="ml-auto h-12 w-2/3 animate-pulse rounded-2xl bg-primary/10" />
            <div className="h-12 w-1/2 animate-pulse rounded-2xl bg-secondary" />
            <div className="ml-auto h-12 w-1/2 animate-pulse rounded-2xl bg-primary/10" />
          </div>
        )}
        {history.isError && (
          <div className="grid flex-1 place-items-center p-5 text-center" role="alert">
            <div className="space-y-3">
              <p className="text-sm text-destructive">Couldn't load messages.</p>
              <Button type="button" variant="outline" onClick={() => history.refetch()}>
                Retry
              </Button>
            </div>
          </div>
        )}
        {history.isSuccess && (
          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4"
            aria-label="Message history"
            aria-live="polite"
          >
            {messages.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No messages yet. Say hello!
              </p>
            )}
            {messages.map((message) => {
              const own = message.sender_id === user?.id;
              return (
                <div key={message.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] break-words rounded-2xl px-3 py-2 ${
                      own
                        ? "rounded-br-md bg-primary text-primary-foreground"
                        : "rounded-bl-md bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {message.shared_post_id ? (
                      <SharedVideoCard postId={message.shared_post_id} own={own} />
                    ) : (
                      <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                    )}
                    <div
                      className={`mt-1 flex items-center gap-2 text-sm ${
                        own ? "text-primary-foreground/80" : "text-muted-foreground"
                      }`}
                    >
                      <time dateTime={message.created_at}>
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                      {message.status === "sending" && <span>Sending…</span>}
                      {message.status === "failed" && (
                        <button
                          type="button"
                          disabled={sending}
                          onClick={() => void deliver(message)}
                          className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                        >
                          Failed - tap to retry
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}

        {screenError && (
          <p className="border-t border-border px-3 py-2 text-sm text-destructive" role="alert">
            {screenError}
          </p>
        )}
        <div className="relative">
          {emojiOpen && (
            <div
              ref={emojiWrapRef}
              className="absolute bottom-full left-3 z-30 mb-2 w-[min(23rem,calc(100vw-2.5rem))]"
            >
              <Suspense
                fallback={
                  <div className="grid h-40 place-items-center rounded-2xl border border-border bg-card shadow-lg">
                    <Loader2
                      className="h-5 w-5 animate-spin text-primary"
                      aria-label="Loading emojis"
                    />
                  </div>
                }
              >
                <EmojiPickerPanel onSelect={insertEmoji} />
              </Suspense>
            </div>
          )}
          <form
            onSubmit={submitMessage}
            className="flex items-end gap-2 border-t border-border p-3"
          >
            <Button
              ref={emojiButtonRef}
              type="button"
              variant="ghost"
              aria-label="Add emoji"
              aria-expanded={emojiOpen}
              onClick={() => setEmojiOpen((open) => !open)}
              disabled={!contact.data || history.isError}
              className={`h-11 w-11 shrink-0 rounded-full p-0 text-primary hover:bg-elevated ${emojiOpen ? "bg-elevated" : ""}`}
            >
              <Smile className="h-6 w-6" aria-hidden="true" />
            </Button>
            <Textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Write a message…"
              aria-label="Write a message"
              maxLength={2000}
              rows={1}
              className="min-h-11 max-h-28 resize-y text-sm"
              disabled={!contact.data || history.isError}
            />
            <Button
              type="submit"
              aria-label="Send message"
              disabled={!draft.trim() || sending || !contact.data || history.isError}
              className="h-11 w-11 shrink-0 p-0"
            >
              {sending ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-5 w-5" aria-hidden="true" />
              )}
            </Button>
          </form>
        </div>
      </section>
    </PageShell>
  );
}
