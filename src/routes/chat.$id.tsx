import { createFileRoute, Link } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Loader2, Paperclip, Play, Send, Smile } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ediraa";
import { GroupAvatar, memberLabel } from "@/components/group-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  AttachMenu,
  DayPill,
  FileBody,
  ImageBody,
  ImageLightbox,
  MediaPreview,
  MessageMeta,
  ReactionPill,
  ReactionsSheet,
  ReplyBar,
  ReplyQuote,
  type AttachKind,
  type PreviewItem,
} from "@/components/chat-parts";
import { InlineEdit, MessageMenu, PressableBubble } from "@/components/message-menu";
import { PageShell } from "@/components/page-shell";
import { SharedVideoCard } from "@/components/shared-video-card";
import {
  MicButton,
  RecordingBar,
  useVoiceRecorder,
  VoiceBubble,
  type VoiceResult,
} from "@/components/voice-recorder";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getConversation, getMessages, markRead, sendMessage } from "@/lib/chat";
import {
  applyReaction,
  dayLabel,
  getOthersReadAt,
  getReactions,
  groupReactions,
  HEART,
  mediaCaption,
  prepareImage,
  reactToMessage,
  sameDay,
  sendFileMessage,
  sendImageMessage,
  sendReply,
  senderColor,
  MEDIA_MAX_BYTES,
} from "@/lib/chat-extras";
import type { MessageReactionRow, MessageRow } from "@/integrations/supabase/types";
import { deleteMessage, editMessage, isEditable, patchCachedMessages } from "@/lib/message-actions";
import { sendVoiceMessage } from "@/lib/voice";

// Loaded on first open only: the emoji data is large and most visits never need it.
const EmojiPickerPanel = lazy(() => import("@/components/emoji-picker"));

type DisplayMessage = MessageRow & { status?: "sending" | "failed" };

const byTime = (a: MessageRow, b: MessageRow) =>
  new Date(a.created_at).getTime() - new Date(b.created_at).getTime();

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
  const { user, profile } = useAuth();
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
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef(new Map<string, () => void>());
  const [cancelling, setCancelling] = useState(false);
  // long-press menu, inline edit and delete confirmation
  const [menu, setMenu] = useState<{ message: DisplayMessage; rect: DOMRect } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DisplayMessage | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  // WhatsApp extras: reply, attach, photo preview / viewer, reactions
  const [replyTo, setReplyTo] = useState<DisplayMessage | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [previewFiles, setPreviewFiles] = useState<File[] | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [reactionsFor, setReactionsFor] = useState<string | null>(null);
  const [popId, setPopId] = useState<string | null>(null);

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
  const reactionsQuery = useQuery({
    queryKey: ["chat-reactions", id],
    queryFn: () => getReactions(id),
    enabled: !!user,
  });
  // when the others last opened this chat: decides if the ticks are blue
  const readQuery = useQuery({
    queryKey: ["chat-read", id, user?.id],
    queryFn: () => getOthersReadAt(id, user!.id),
    enabled: !!user,
    refetchInterval: 8000,
  });

  useEffect(() => {
    if (history.isSuccess) {
      setMessages((current) => {
        const currentIds = new Set(current.map((message) => message.id));
        return [...current, ...history.data.filter((message) => !currentIds.has(message.id))].sort(
          byTime,
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
              : [...current, incoming].sort(byTime),
          );
          void markConversationRead();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${id}`,
        },
        (payload) => {
          const changed = payload.new as MessageRow;
          setMessages((current) =>
            current.map((message) =>
              message.id === changed.id ? { ...message, ...changed } : message,
            ),
          );
          patchCachedMessages(queryClient, { type: "update", row: changed });
        },
      )
      // a delete event can't be filtered by conversation; we only act on ids we have
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const removedId = (payload.old as Partial<MessageRow>).id;
          if (!removedId) return;
          setMessages((current) => current.filter((message) => message.id !== removedId));
          setMenu((open) => (open?.message.id === removedId ? null : open));
          setEditingId((open) => (open === removedId ? null : open));
          setReplyTo((open) => (open?.id === removedId ? null : open));
          patchCachedMessages(queryClient, { type: "delete", id: removedId });
        },
      )
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Conversation realtime subscription failed", error);
          if (active)
            setScreenError("Live updates are unavailable. Refresh to check for messages.");
        }
      });

    // Reactions have their own channel: if the database update for reactions hasn't been run
    // yet, only live reactions are affected and messages keep arriving as before.
    const reactionKey = ["chat-reactions", id];
    const reactionChannel = supabase
      .channel(`chat-reactions:${id}:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${id}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const row = payload.new as MessageReactionRow;
          queryClient.setQueryData<MessageReactionRow[]>(reactionKey, (old = []) =>
            applyReaction(old, {
              messageId: row.message_id,
              conversationId: row.conversation_id,
              userId: row.user_id,
              emoji: row.emoji,
            }),
          );
        },
      )
      // deletes can't be filtered by conversation; removing something we don't have is harmless
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => {
          const old = payload.old as Partial<MessageReactionRow>;
          if (!old.message_id || !old.user_id) return;
          queryClient.setQueryData<MessageReactionRow[]>(reactionKey, (list = []) =>
            list.filter((r) => !(r.message_id === old.message_id && r.user_id === old.user_id)),
          );
        },
      )
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          console.error("Reactions realtime subscription failed", error);
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
      void supabase.removeChannel(reactionChannel);
    };
  }, [id, queryClient, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    // only when a message is added: editing or deleting an old one shouldn't jump the chat
  }, [messages.length]);

  const replacePending = (pendingId: string, saved: MessageRow) => {
    setMessages((current) => {
      const withoutPending = current.filter((item) => item.id !== pendingId);
      if (withoutPending.some((item) => item.id === saved.id)) return withoutPending;
      return [...withoutPending, saved].sort(byTime);
    });
    void queryClient.invalidateQueries({ queryKey: ["chat-conversations", user?.id] });
  };

  const deliver = async (message: DisplayMessage) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setScreenError("");
    setMessages((current) =>
      current.map((item) => (item.id === message.id ? { ...item, status: "sending" } : item)),
    );
    try {
      const saved = message.reply_to_id
        ? await sendReply({ conversationId: id, body: message.body, replyTo: message.reply_to_id })
        : await sendMessage(id, message.body);
      setMessages((current) => {
        const withoutPending = current.filter((item) => item.id !== message.id);
        if (withoutPending.some((item) => item.id === saved.id)) return withoutPending;
        return [...withoutPending, saved].sort(byTime);
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

  const retry = (message: DisplayMessage) => {
    const again = retryRef.current.get(message.id);
    if (again) again();
    else void deliver(message);
  };

  /** A recorded voice message: shown at once, then uploaded and sent. */
  const sendVoice = async ({ blob, seconds }: VoiceResult) => {
    if (!user) return;
    const pendingId = `pending-${crypto.randomUUID()}`;
    const localUrl = URL.createObjectURL(blob);
    setScreenError("");
    setMessages((current) => [
      ...current,
      {
        id: pendingId,
        conversation_id: id,
        sender_id: user.id,
        body: "Voice message",
        created_at: new Date().toISOString(),
        shared_post_id: null,
        audio_url: localUrl,
        audio_seconds: Math.min(600, Math.max(1, Math.round(seconds))),
        status: "sending",
      },
    ]);
    try {
      const saved = await sendVoiceMessage(id, user.id, blob, seconds);
      replacePending(pendingId, saved);
    } catch (cause) {
      setMessages((current) => current.filter((item) => item.id !== pendingId));
      setScreenError(cause instanceof Error ? cause.message : "Couldn't send your voice message.");
    } finally {
      URL.revokeObjectURL(localUrl);
    }
  };
  const voice = useVoiceRecorder((result) => void sendVoice(result));

  /** One photo: shown at once with a spinner, then compressed, uploaded and sent. */
  const sendOnePhoto = (item: PreviewItem, replyId: string | null) => {
    if (!user) return;
    const pendingId = `pending-${crypto.randomUUID()}`;
    const localUrl = URL.createObjectURL(item.file);
    const caption = item.caption.trim();
    setMessages((current) => [
      ...current,
      {
        id: pendingId,
        conversation_id: id,
        sender_id: user.id,
        body: caption || "📷 Photo",
        created_at: new Date().toISOString(),
        shared_post_id: null,
        image_url: localUrl,
        reply_to_id: replyId,
        status: "sending",
      },
    ]);
    const run = async () => {
      setScreenError("");
      setMessages((c) => c.map((m) => (m.id === pendingId ? { ...m, status: "sending" } : m)));
      try {
        const image = await prepareImage(item.file);
        const saved = await sendImageMessage({
          conversationId: id,
          userId: user.id,
          image,
          body: caption,
          replyTo: replyId,
        });
        retryRef.current.delete(pendingId);
        replacePending(pendingId, saved);
        URL.revokeObjectURL(localUrl);
      } catch (cause) {
        setMessages((c) => c.map((m) => (m.id === pendingId ? { ...m, status: "failed" } : m)));
        setScreenError(cause instanceof Error ? cause.message : "Couldn't send your photo.");
      }
    };
    retryRef.current.set(pendingId, () => void run());
    void run();
  };

  const sendPhotos = (items: PreviewItem[]) => {
    setPreviewFiles(null);
    const replyId = replyTo?.id ?? null;
    setReplyTo(null);
    items.forEach((item, i) => sendOnePhoto(item, i === 0 ? replyId : null));
  };

  const sendOneDocument = (file: File, replyId: string | null) => {
    if (!user) return;
    if (file.size > MEDIA_MAX_BYTES) {
      setScreenError("Files must be 15 MB or smaller.");
      return;
    }
    const pendingId = `pending-${crypto.randomUUID()}`;
    const localUrl = URL.createObjectURL(file);
    setMessages((current) => [
      ...current,
      {
        id: pendingId,
        conversation_id: id,
        sender_id: user.id,
        body: `📄 ${file.name}`,
        created_at: new Date().toISOString(),
        shared_post_id: null,
        file_url: localUrl,
        file_name: file.name,
        file_size: file.size,
        reply_to_id: replyId,
        status: "sending",
      },
    ]);
    const run = async () => {
      setScreenError("");
      setMessages((c) => c.map((m) => (m.id === pendingId ? { ...m, status: "sending" } : m)));
      try {
        const saved = await sendFileMessage({
          conversationId: id,
          userId: user.id,
          file,
          replyTo: replyId,
        });
        retryRef.current.delete(pendingId);
        replacePending(pendingId, saved);
        URL.revokeObjectURL(localUrl);
      } catch (cause) {
        setMessages((c) => c.map((m) => (m.id === pendingId ? { ...m, status: "failed" } : m)));
        setScreenError(cause instanceof Error ? cause.message : "Couldn't send your file.");
      }
    };
    retryRef.current.set(pendingId, () => void run());
    void run();
  };

  const pickAttachment = (kind: AttachKind) => {
    setAttachOpen(false);
    setEmojiOpen(false);
    const input =
      kind === "camera"
        ? cameraInputRef.current
        : kind === "gallery"
          ? galleryInputRef.current
          : documentInputRef.current;
    input?.click();
  };

  const onPhotosChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const photos = files.filter((f) => f.type.startsWith("image/")).slice(0, 10);
    if (!photos.length) {
      setScreenError("Please choose a photo. Use the document option for other files.");
      return;
    }
    setScreenError("");
    setPreviewFiles(photos);
  };

  const onDocumentsChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 5);
    event.target.value = "";
    if (!files.length) return;
    const replyId = replyTo?.id ?? null;
    setReplyTo(null);
    files.forEach((file, i) => sendOneDocument(file, i === 0 ? replyId : null));
  };

  const saveEdit = async (message: DisplayMessage, text: string) => {
    setActionBusy(true);
    setScreenError("");
    try {
      const saved = await editMessage(message.id, text);
      setMessages((current) =>
        current.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)),
      );
      patchCachedMessages(queryClient, { type: "update", row: saved });
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: ["chat-conversations", user?.id] });
    } catch (cause) {
      setScreenError(cause instanceof Error ? cause.message : "Couldn't edit your message.");
    } finally {
      setActionBusy(false);
    }
  };

  const confirmDelete = async () => {
    const message = pendingDelete;
    if (!message) return;
    setActionBusy(true);
    setScreenError("");
    try {
      await deleteMessage(message);
      setMessages((current) => current.filter((item) => item.id !== message.id));
      setReplyTo((open) => (open?.id === message.id ? null : open));
      patchCachedMessages(queryClient, { type: "delete", id: message.id });
      void queryClient.invalidateQueries({ queryKey: ["chat-conversations", user?.id] });
    } catch (cause) {
      setScreenError(cause instanceof Error ? cause.message : "Couldn't delete your message.");
    } finally {
      setActionBusy(false);
      setPendingDelete(null);
    }
  };

  /** Sets (or, with null, takes back) my reaction. The pill updates at once. */
  const react = (message: DisplayMessage, emoji: string | null) => {
    if (!user || message.id.startsWith("pending-")) return;
    const key = ["chat-reactions", id];
    const before = queryClient.getQueryData<MessageReactionRow[]>(key) ?? [];
    queryClient.setQueryData(
      key,
      applyReaction(before, {
        messageId: message.id,
        conversationId: id,
        userId: user.id,
        emoji,
      }),
    );
    reactToMessage(message.id, emoji).catch((cause: unknown) => {
      queryClient.setQueryData(key, before);
      setScreenError(cause instanceof Error ? cause.message : "Couldn't react to that message.");
    });
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

  // the text box grows with what is typed (up to about 5 lines)
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 124)}px`;
  }, [draft]);

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
    setAttachOpen(false);
    const optimistic: DisplayMessage = {
      id: `pending-${crypto.randomUUID()}`,
      conversation_id: id,
      sender_id: user!.id,
      body,
      created_at: new Date().toISOString(),
      shared_post_id: null,
      reply_to_id: replyTo?.id ?? null,
      status: "sending",
    };
    setReplyTo(null);
    setMessages((current) => [...current, optimistic]);
    void deliver(optimistic);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const jumpTo = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("wa-flash");
    void el.offsetWidth; // restart the highlight if it is still running
    el.classList.add("wa-flash");
    window.setTimeout(() => el.classList.remove("wa-flash"), 1500);
  };

  const startReply = (message: DisplayMessage) => {
    setMenu(null);
    setReplyTo(message);
    if (window.matchMedia("(min-width: 640px)").matches) composerRef.current?.focus();
  };

  const copyText = async (message: DisplayMessage) => {
    setMenu(null);
    const text = message.image_url || message.file_url ? mediaCaption(message) : message.body;
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast.error("Couldn't copy this message.");
    }
  };

  const senderNames = new Map(
    (contact.data?.members ?? []).map((m) => [m.id, m.full_name || m.username]),
  );
  const senderAvatars = new Map((contact.data?.members ?? []).map((m) => [m.id, m.avatar_url]));
  const isGroup = !!contact.data?.group;
  const name = contact.data?.full_name || contact.data?.username || "Conversation";
  const nameOf = (userId: string) =>
    userId === user?.id ? "You" : (senderNames.get(userId) ?? (isGroup ? "Former member" : name));

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, MessageReactionRow[]>();
    for (const r of reactionsQuery.data ?? []) {
      map.set(r.message_id, [...(map.get(r.message_id) ?? []), r]);
    }
    return map;
  }, [reactionsQuery.data]);
  const readAt = readQuery.data ?? null;
  const composerDisabled = !contact.data || history.isError;
  const hasText = !!draft.trim();

  return (
    <PageShell showBottomNav={false}>
      <section className="wa-chat wa-wallpaper -mx-4 -mb-5 flex h-dvh flex-col overflow-hidden border-0 border-border sm:mx-0 sm:mb-0 sm:h-auto sm:min-h-[calc(100dvh-6rem)] sm:rounded-2xl sm:border">
        <header className="wa-header flex min-h-16 items-center gap-1 px-2 py-2">
          <Link
            to="/chat"
            aria-label="Back to chats"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          {contact.isLoading ? (
            <span className="text-sm text-[var(--wa-meta)]">Loading conversation…</span>
          ) : contact.data?.group ? (
            <Link
              to="/group/$id"
              params={{ id: contact.data.group.id }}
              className="flex min-w-0 items-center gap-3 rounded-lg p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <GroupAvatar
                size={40}
                members={contact.data.group.preview}
                total={contact.data.group.memberCount}
              />
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold sm:text-base">
                  {name}
                </span>
                <span className="block truncate text-xs text-[var(--wa-meta)]">
                  {memberLabel(contact.data.group.memberCount)} • tap for group info
                </span>
              </span>
            </Link>
          ) : contact.data ? (
            <Link
              to="/u/$username"
              params={{ username: contact.data.username }}
              className="flex min-w-0 items-center gap-3 rounded-lg p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar src={contact.data.avatar_url} name={name} size={40} />
              <span className="truncate text-[15px] font-semibold sm:text-base">{name}</span>
            </Link>
          ) : (
            <h1 className="truncate text-[15px] font-semibold sm:text-base">{name}</h1>
          )}
        </header>

        {contact.isError && (
          <p className="bg-[var(--wa-in)] p-3 text-sm text-destructive" role="alert">
            This conversation couldn't be opened.
          </p>
        )}
        {history.isLoading && (
          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-label="Loading messages">
            <div className="ml-auto h-12 w-2/3 animate-pulse rounded-lg bg-[var(--wa-out)]/70" />
            <div className="h-12 w-1/2 animate-pulse rounded-lg bg-[var(--wa-in)]/80" />
            <div className="ml-auto h-12 w-1/2 animate-pulse rounded-lg bg-[var(--wa-out)]/70" />
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
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3"
            aria-label="Message history"
            aria-live="polite"
          >
            {messages.length === 0 && (
              <p className="mx-auto my-10 w-fit rounded-lg bg-[var(--wa-day)] px-3 py-1.5 text-center text-sm text-[var(--wa-day-fg)] shadow-sm">
                No messages yet. Say hello!
              </p>
            )}
            {messages.map((message, index) => {
              const prev = messages[index - 1];
              const newDay = !prev || !sameDay(prev.created_at, message.created_at);
              const firstOfRun = newDay || prev.sender_id !== message.sender_id;
              const own = message.sender_id === user?.id;
              const pending = message.id.startsWith("pending-");
              // anyone's sent message can be replied to / reacted to; only mine can be edited / deleted
              const canAct = !message.status && !pending;
              const editing = editingId === message.id;
              const groups = groupReactions(reactionsByMessage.get(message.id) ?? [], user?.id);
              const myReaction = groups.find((g) => g.mine)?.emoji;
              const quoted = message.reply_to_id ? byId.get(message.reply_to_id) : undefined;
              const isImage = !!message.image_url;
              const isFile = !!message.file_url;
              const isVoice = !!message.audio_url;
              const isShared = !!message.shared_post_id;
              const isStory = !!message.story_kind;
              const caption = mediaCaption(message);
              const isSending = message.status === "sending";
              const read =
                own &&
                !pending &&
                readAt !== null &&
                readAt >= new Date(message.created_at).getTime();
              const bg = own ? "bg-[var(--wa-out)]" : "bg-[var(--wa-in)]";
              const meta = (onImage = false) => (
                <MessageMeta
                  iso={message.created_at}
                  own={own}
                  edited={!!message.edited_at}
                  sending={isSending}
                  read={read}
                  onImage={onImage}
                />
              );
              const plainText = !isImage && !isFile && !isVoice && !isShared && !isStory;
              const inlineMeta = (plainText && !editing) || ((isImage || isFile) && !!caption);
              const spacer = (
                <span
                  aria-hidden="true"
                  className={`inline-block ${own ? "w-[5.25rem] sm:w-[6rem]" : "w-[4.25rem] sm:w-[4.75rem]"} ${message.edited_at ? "ml-9" : ""}`}
                />
              );
              return (
                <div key={message.id}>
                  {newDay && <DayPill label={dayLabel(message.created_at)} />}
                  <div
                    id={`msg-${message.id}`}
                    className={`flex rounded-md ${own ? "justify-end" : "justify-start"} ${
                      firstOfRun && !newDay ? "mt-2" : "mt-0.5"
                    }`}
                  >
                    <PressableBubble
                      enabled={canAct && !editing}
                      onLongPress={(rect) => setMenu({ message, rect })}
                      onReply={() => startReply(message)}
                      onDoubleTap={() => {
                        setPopId(message.id);
                        window.setTimeout(
                          () => setPopId((p) => (p === message.id ? null : p)),
                          850,
                        );
                        if (myReaction !== HEART) react(message, HEART);
                      }}
                      {...(isImage && message.image_url
                        ? { onTap: () => setLightbox(message.image_url!) }
                        : {})}
                      outerClassName={groups.length ? "mb-4" : ""}
                      className={`${bg} ${
                        isImage ? "p-[3px]" : "px-[9px] py-[6px]"
                      } break-words rounded-lg text-sm leading-[1.35] sm:text-[15px] text-[var(--wa-text)] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] ${
                        firstOfRun ? (own ? "rounded-tr-none" : "rounded-tl-none") : ""
                      }`}
                      overlay={
                        <>
                          {firstOfRun && (
                            <span
                              aria-hidden="true"
                              className={`absolute top-0 h-3 w-2 ${
                                own ? "wa-tail-out -right-2" : "wa-tail -left-2"
                              } ${bg}`}
                            />
                          )}
                          {popId === message.id && (
                            <span
                              aria-hidden="true"
                              className="wa-heart-pop pointer-events-none absolute left-1/2 top-1/2 z-20 text-6xl leading-none drop-shadow-lg"
                            >
                              {HEART}
                            </span>
                          )}
                          <ReactionPill
                            groups={groups}
                            own={own}
                            onClick={() => setReactionsFor(message.id)}
                          />
                          {inlineMeta && (
                            <span
                              className={`absolute bottom-1 right-2 ${isImage || isFile ? "" : ""}`}
                            >
                              {meta()}
                            </span>
                          )}
                        </>
                      }
                    >
                      {isGroup && !own && firstOfRun && (
                        <p
                          className={`mb-0.5 text-xs font-semibold sm:text-[13px] ${isImage ? "px-1.5 pt-0.5" : ""}`}
                          style={{ color: senderColor(message.sender_id) }}
                        >
                          {senderNames.get(message.sender_id) ?? "Former member"}
                        </p>
                      )}
                      {message.reply_to_id && (
                        <div className={isImage ? "p-1 pb-0" : ""}>
                          <ReplyQuote
                            quoted={quoted}
                            name={
                              quoted
                                ? quoted.sender_id === user?.id
                                  ? "You"
                                  : nameOf(quoted.sender_id)
                                : "Message"
                            }
                            color={
                              quoted
                                ? quoted.sender_id === user?.id
                                  ? "#00a884"
                                  : senderColor(quoted.sender_id)
                                : "#8696a0"
                            }
                            onJump={() => quoted && jumpTo(quoted.id)}
                          />
                        </div>
                      )}
                      {isShared ? (
                        <>
                          <SharedVideoCard postId={message.shared_post_id!} own={own} />
                          <div className="mt-1 flex justify-end">{meta()}</div>
                        </>
                      ) : isVoice ? (
                        <VoiceBubble
                          url={message.audio_url!}
                          seconds={message.audio_seconds ?? 1}
                          own={own}
                          avatarUrl={
                            own ? profile?.avatar_url : senderAvatars.get(message.sender_id)
                          }
                          name={own ? (profile?.full_name ?? undefined) : nameOf(message.sender_id)}
                          footer={meta()}
                        />
                      ) : isImage ? (
                        <>
                          <ImageBody
                            url={message.image_url!}
                            width={message.image_w}
                            height={message.image_h}
                            uploading={isSending}
                            overlay={!caption ? meta(true) : undefined}
                          />
                          {caption && (
                            <p className="whitespace-pre-wrap px-1.5 pb-1 pt-1.5 text-sm sm:text-[15px]">
                              {caption}
                              {spacer}
                            </p>
                          )}
                        </>
                      ) : isFile ? (
                        <>
                          <FileBody
                            url={message.file_url!}
                            name={message.file_name}
                            size={message.file_size}
                          />
                          {caption ? (
                            <p className="whitespace-pre-wrap pt-1.5 text-sm sm:text-[15px]">
                              {caption}
                              {spacer}
                            </p>
                          ) : (
                            <div className="mt-1 flex justify-end">{meta()}</div>
                          )}
                        </>
                      ) : isStory ? (
                        <>
                          <StoryMessageBody message={message} own={own} name={name} />
                          <div className="mt-1 flex justify-end">{meta()}</div>
                        </>
                      ) : editing ? (
                        <>
                          <InlineEdit
                            initial={message.body}
                            busy={actionBusy}
                            onSave={(text) => void saveEdit(message, text)}
                            onCancel={() => setEditingId(null)}
                          />
                        </>
                      ) : (
                        <p className="whitespace-pre-wrap">
                          {message.body}
                          {spacer}
                        </p>
                      )}
                      {message.status === "failed" && (
                        <button
                          type="button"
                          disabled={sending}
                          onClick={() => retry(message)}
                          className="mt-1 block text-xs text-destructive underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                        >
                          Failed - tap to retry
                        </button>
                      )}
                    </PressableBubble>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}

        {screenError && (
          <p className="bg-[var(--wa-in)] px-3 py-2 text-sm text-destructive" role="alert">
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
          {attachOpen && (
            <AttachMenu
              onPick={pickAttachment}
              onClose={() => setAttachOpen(false)}
              ignore={attachButtonRef}
            />
          )}
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            aria-label="Choose photos from gallery"
            onChange={onPhotosChosen}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label="Take a photo"
            onChange={onPhotosChosen}
          />
          <input
            ref={documentInputRef}
            type="file"
            multiple
            hidden
            aria-label="Choose a document"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.json,.rtf,application/*,text/*"
            onChange={onDocumentsChosen}
          />
          <form onSubmit={submitMessage} className="flex items-end gap-2 px-2 pb-2 pt-1.5">
            {voice.recording ? (
              <RecordingBar
                seconds={voice.seconds}
                cancelling={cancelling}
                onCancel={() => voice.stop(false)}
              />
            ) : (
              <div className="flex min-w-0 flex-1 flex-col">
                {replyTo && (
                  <ReplyBar
                    name={nameOf(replyTo.sender_id)}
                    color={
                      replyTo.sender_id === user?.id ? "#00a884" : senderColor(replyTo.sender_id)
                    }
                    quoted={replyTo}
                    onClose={() => setReplyTo(null)}
                  />
                )}
                <div
                  className={`flex min-h-11 min-w-0 items-end bg-[var(--wa-input)] sm:min-h-12 text-[var(--wa-input-fg)] shadow-sm ${
                    replyTo ? "rounded-b-3xl rounded-t-none" : "rounded-3xl"
                  }`}
                >
                  <Button
                    ref={emojiButtonRef}
                    type="button"
                    variant="ghost"
                    aria-label="Add emoji"
                    aria-expanded={emojiOpen}
                    onClick={() => {
                      setAttachOpen(false);
                      setEmojiOpen((open) => !open);
                    }}
                    disabled={composerDisabled}
                    className={`h-11 w-10 shrink-0 rounded-full p-0 text-[var(--wa-icon)] sm:h-12 sm:w-11 hover:bg-transparent ${emojiOpen ? "text-[var(--wa-accent)]" : ""}`}
                  >
                    <Smile className="h-[22px] w-[22px] sm:h-6 sm:w-6" aria-hidden="true" />
                  </Button>
                  <textarea
                    ref={composerRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="Message"
                    aria-label="Write a message"
                    maxLength={2000}
                    rows={1}
                    disabled={composerDisabled}
                    className="max-h-[124px] min-h-11 min-w-0 flex-1 resize-none self-center bg-transparent py-2.5 text-[15px] leading-6 sm:min-h-12 sm:py-3 text-[var(--wa-input-fg)] outline-none placeholder:text-[var(--wa-meta)] disabled:opacity-60"
                  />
                  <Button
                    ref={attachButtonRef}
                    type="button"
                    variant="ghost"
                    aria-label="Attach"
                    aria-expanded={attachOpen}
                    onClick={() => {
                      setEmojiOpen(false);
                      setAttachOpen((open) => !open);
                    }}
                    disabled={composerDisabled}
                    className="h-11 w-9 shrink-0 rounded-full p-0 text-[var(--wa-icon)] hover:bg-transparent sm:h-12 sm:w-10"
                  >
                    <Paperclip
                      className="h-[22px] w-[22px] -rotate-45 sm:h-6 sm:w-6"
                      aria-hidden="true"
                    />
                  </Button>
                  {!hasText && (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label="Camera"
                      onClick={() => pickAttachment("camera")}
                      disabled={composerDisabled}
                      className="h-11 w-9 shrink-0 rounded-full p-0 pr-1 text-[var(--wa-icon)] hover:bg-transparent sm:h-12 sm:w-10"
                    >
                      <Camera className="h-[22px] w-[22px] sm:h-6 sm:w-6" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
            )}
            {hasText ? (
              <Button
                type="submit"
                aria-label="Send message"
                disabled={!hasText || sending || composerDisabled}
                className="h-11 w-11 shrink-0 rounded-full bg-[var(--wa-accent)] p-0 text-white sm:h-12 sm:w-12 shadow-sm hover:bg-[var(--wa-accent)]/90"
              >
                {sending ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-5 w-5" aria-hidden="true" />
                )}
              </Button>
            ) : (
              <MicButton
                recording={voice.recording}
                start={voice.start}
                stop={voice.stop}
                onCancelling={setCancelling}
                disabled={composerDisabled}
              />
            )}
          </form>
        </div>
        {menu && (
          <MessageMenu
            rect={menu.rect}
            own={menu.message.sender_id === user?.id}
            myReaction={
              groupReactions(reactionsByMessage.get(menu.message.id) ?? [], user?.id).find(
                (g) => g.mine,
              )?.emoji
            }
            canEdit={isEditable(menu.message)}
            canCopy={
              !menu.message.audio_url &&
              !menu.message.shared_post_id &&
              !menu.message.story_kind &&
              (menu.message.image_url || menu.message.file_url
                ? !!mediaCaption(menu.message)
                : true)
            }
            onClose={() => setMenu(null)}
            onReact={(emoji) => {
              const mine = groupReactions(
                reactionsByMessage.get(menu.message.id) ?? [],
                user?.id,
              ).find((g) => g.mine)?.emoji;
              react(menu.message, mine === emoji ? null : emoji);
              setMenu(null);
            }}
            onReply={() => startReply(menu.message)}
            onCopy={() => void copyText(menu.message)}
            {...(menu.message.sender_id === user?.id
              ? {
                  onEdit: () => {
                    setEditingId(menu.message.id);
                    setMenu(null);
                  },
                  onDelete: () => {
                    setPendingDelete(menu.message);
                    setMenu(null);
                  },
                }
              : {})}
          />
        )}
        {previewFiles && (
          <MediaPreview
            files={previewFiles}
            toName={name}
            onClose={() => setPreviewFiles(null)}
            onSend={sendPhotos}
          />
        )}
        {lightbox && <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />}
        <ReactionsSheet
          open={!!reactionsFor}
          onOpenChange={(open) => {
            if (!open) setReactionsFor(null);
          }}
          list={reactionsFor ? (reactionsByMessage.get(reactionsFor) ?? []) : []}
          me={user?.id}
          nameOf={nameOf}
          onRemoveMine={() => {
            const m = reactionsFor ? byId.get(reactionsFor) : undefined;
            if (m) react(m, null);
          }}
        />
        <AlertDialog
          open={!!pendingDelete}
          onOpenChange={(open) => {
            if (!open && !actionBusy) setPendingDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this message?</AlertDialogTitle>
              <AlertDialogDescription>
                It will be deleted for everyone in this chat. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={actionBusy}
                onClick={(event) => {
                  event.preventDefault();
                  void confirmDelete();
                }}
              >
                {actionBusy ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </PageShell>
  );
}

/** A story reply or quick reaction: a small preview of the story, then what was sent. */
function StoryMessageBody({
  message,
  own,
  name,
}: {
  message: MessageRow;
  own: boolean;
  name: string;
}) {
  const reaction = message.story_kind === "reaction";
  const label = own
    ? `You ${reaction ? "reacted to" : "replied to"} ${name}'s story`
    : `${reaction ? "Reacted" : "Replied"} to your story`;
  return (
    <div>
      <div
        className={`mb-2 flex items-center gap-2.5 rounded-xl p-1.5 pr-3 ${"bg-[var(--wa-quote)]"}`}
      >
        {message.story_thumb ? (
          <img
            src={message.story_thumb}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
            className="h-12 w-9 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid h-12 w-9 shrink-0 place-items-center rounded-lg bg-[var(--wa-accent)] text-white"
          >
            <Play className="h-4 w-4 fill-current" />
          </span>
        )}
        <span className="text-xs font-medium text-[var(--wa-meta)]">{label}</span>
      </div>
      {reaction ? (
        <p className="py-0.5 text-4xl leading-none">{message.body}</p>
      ) : (
        <p className="whitespace-pre-wrap text-sm">{message.body}</p>
      )}
    </div>
  );
}
