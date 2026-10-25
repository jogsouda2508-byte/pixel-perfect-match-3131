import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { patchCachedMessages } from "@/lib/message-actions";
import type { MessageRow } from "@/integrations/supabase/types";

export async function fetchUnreadChatCount(): Promise<number> {
  const { data, error } = await supabase.rpc("get_unread_chat_count");
  if (error) {
    console.error("Checking unread chats failed", error);
    return 0;
  }
  return Number(data ?? 0);
}

/** Number of chats with an unread message or shared reel/post. Updates live. */
export function useChatUnread(): number {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const instance = useId();
  const meId = user?.id ?? "";

  const query = useQuery({
    queryKey: ["chat-unread", meId],
    queryFn: fetchUnreadChatCount,
    enabled: !!meId,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!meId) return;
    const channel = supabase
      .channel(`chat-unread:${meId}:${instance}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const removedId = (payload.old as { id?: string }).id;
          if (removedId) patchCachedMessages(queryClient, { type: "delete", id: removedId });
        } else if (payload.eventType === "UPDATE") {
          patchCachedMessages(queryClient, { type: "update", row: payload.new as MessageRow });
        }
        void queryClient.invalidateQueries({ queryKey: ["chat-unread", meId] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [instance, meId, queryClient]);

  return query.data ?? 0;
}

export function UnreadBadge({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={`grid min-h-5 min-w-5 place-items-center rounded-full bg-brand-accent px-1 text-[10px] font-bold leading-none text-brand-accent-foreground ${className}`}
    >
      {count > 99 ? "99+" : count}
      <span className="sr-only"> unread</span>
    </span>
  );
}
