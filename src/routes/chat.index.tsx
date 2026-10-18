import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Search, UserPlus } from "lucide-react";
import { Avatar, BottomNav, SideNav } from "@/components/ediraa";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { fetchPeople } from "@/lib/social";
import { listConversations, startConversation } from "@/lib/chat";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { timeAgo } from "@/lib/time";

export const Route = createFileRoute("/chat/")({
  head: () => ({
    meta: [{ title: "Chat — Gicco chat" }],
  }),
  component: ChatPage,
});

function ChatPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const conversations = useQuery({
    queryKey: ["chat-conversations", user?.id],
    queryFn: () => listConversations(user!.id),
    enabled: !!user,
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`chat-list:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["chat-conversations", user.id] });
      })
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          console.error("Chat list realtime subscription failed", error);
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, user]);

  return (
    <div className="mx-auto max-w-[1480px] px-4 sm:px-6 pb-28 pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[220px_minmax(0,680px)_300px] lg:justify-center 2xl:grid-cols-[240px_minmax(0,800px)_340px]">
      <SideNav />
      <main className="min-w-0 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Chat</h1>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 rounded-full"
            onClick={() => setNewMessageOpen(true)}
          >
            <UserPlus aria-hidden="true" />
            <span>New message</span>
          </Button>
        </header>

        {conversations.isLoading && (
          <section className="glass-card space-y-3 p-4" aria-label="Loading conversations">
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            ))}
          </section>
        )}

        {conversations.isError && (
          <section className="glass-card space-y-3 p-5 text-center" role="alert">
            <p className="text-sm text-destructive">Couldn't load your conversations.</p>
            <Button type="button" variant="outline" onClick={() => conversations.refetch()}>
              Retry
            </Button>
          </section>
        )}

        {conversations.isSuccess && conversations.data.length === 0 && (
          <section className="glass-card flex min-h-72 flex-col items-center justify-center px-6 text-center">
            <MessageSquare className="h-10 w-10 text-primary" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold">No messages yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Start a conversation with someone in your community.
            </p>
            <Button
              type="button"
              className="mt-5 min-h-11 rounded-full"
              onClick={() => setNewMessageOpen(true)}
            >
              Start a conversation
            </Button>
          </section>
        )}

        {conversations.isSuccess && conversations.data.length > 0 && (
          <section className="glass-card divide-y divide-border" aria-label="Conversations">
            {conversations.data.map((conversation) => {
              const contact = conversation.otherParticipant;
              const name = contact.full_name || contact.username;
              return (
                <Link
                  key={conversation.id}
                  to="/chat/$id"
                  params={{ id: conversation.id }}
                  aria-label={`Open conversation with ${name}${conversation.unread ? ", unread" : ""}`}
                  className="flex min-h-[76px] items-center gap-3 rounded-xl px-4 py-3 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Avatar src={contact.avatar_url} name={name} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{name}</span>
                      {conversation.last_message_at && (
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {timeAgo(conversation.last_message_at)}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <span className="truncate text-sm text-muted-foreground">
                        {conversation.last_message_preview || "No messages yet"}
                      </span>
                      {conversation.unread && (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary"
                          aria-label="Unread"
                        />
                      )}
                    </span>
                  </span>
                </Link>
              );
            })}
          </section>
        )}
      </main>
      <BottomNav />
      <NewMessageDialog
        open={newMessageOpen}
        onOpenChange={setNewMessageOpen}
        currentUserId={user?.id ?? ""}
      />
    </div>
  );
}

function NewMessageDialog({
  open,
  onOpenChange,
  currentUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [scope, setScope] = useState<"all" | "following">("all");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const people = useQuery({
    queryKey: ["chat-people", currentUserId, debouncedSearch],
    queryFn: () => fetchPeople({ query: debouncedSearch, limit: 30 }),
    enabled: open && !!currentUserId,
  });
  const visiblePeople =
    scope === "following"
      ? (people.data ?? []).filter((person) => person.is_following)
      : people.data;

  const beginConversation = async (otherUserId: string) => {
    setOpeningId(otherUserId);
    setError("");
    try {
      const id = await startConversation(otherUserId);
      onOpenChange(false);
      setSearch("");
      navigate({ to: "/chat/$id", params: { id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't start a conversation.");
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setSearch("");
          setError("");
        }
      }}
    >
      <DialogContent className="max-h-[85dvh] grid-rows-[auto_auto_auto_minmax(0,1fr)] overflow-hidden [&>button]:grid [&>button]:h-11 [&>button]:w-11 [&>button]:place-items-center">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>Choose someone to start a private conversation.</DialogDescription>
        </DialogHeader>
        <label className="relative block">
          <Search
            className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or username"
            aria-label="Search people"
            className="min-h-11 pl-10"
          />
        </label>
        <div className="flex gap-2">
          {(["all", "following"] as const).map((item) => (
            <Button
              key={item}
              type="button"
              variant={scope === item ? "secondary" : "ghost"}
              className="min-h-11"
              onClick={() => setScope(item)}
            >
              {item === "all" ? "All people" : "Following"}
            </Button>
          ))}
        </div>
        <div className="min-h-0 overflow-y-auto">
          {people.isLoading && (
            <div className="space-y-3 py-2" aria-label="Loading people">
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <Skeleton className="h-11 w-11 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {people.isError && (
            <div className="space-y-3 py-4 text-center" role="alert">
              <p className="text-sm text-destructive">Couldn't find people.</p>
              <Button type="button" variant="outline" onClick={() => people.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {people.isSuccess && visiblePeople?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {scope === "following" ? "No followed people found." : "No people found."}
            </p>
          )}
          <div className="divide-y divide-border">
            {visiblePeople?.map((person) => {
              const name = person.full_name || person.username;
              const isOpening = openingId === person.id;
              return (
                <button
                  type="button"
                  key={person.id}
                  disabled={openingId !== null}
                  onClick={() => void beginConversation(person.id)}
                  className="flex min-h-[68px] w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <Avatar src={person.avatar_url} name={name} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{name}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      @{person.username}
                    </span>
                  </span>
                  {isOpening && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                </button>
              );
            })}
          </div>
          {error && (
            <p className="py-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
