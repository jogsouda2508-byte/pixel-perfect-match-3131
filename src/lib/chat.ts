import { supabase } from "@/integrations/supabase/client";
import type {
  ConversationParticipantRow,
  ConversationRow,
  MessageRow,
  Profile,
} from "@/integrations/supabase/types";

export type ChatProfile = Pick<Profile, "id" | "full_name" | "username" | "avatar_url">;

export type ChatConversation = ConversationRow & {
  otherParticipant: ChatProfile;
  unread: boolean;
};

export function isUnread(lastMessageAt: string | null, lastReadAt: string): boolean {
  return !!lastMessageAt && new Date(lastMessageAt).getTime() > new Date(lastReadAt).getTime();
}

function fail(action: string, error: unknown): never {
  console.error(`${action} failed`, error);
  throw new Error(`Couldn't ${action}. Please try again.`);
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) fail("identify your account", error ?? new Error("No signed-in user"));
  return data.user.id;
}

export async function listConversations(userId?: string): Promise<ChatConversation[]> {
  const me = userId ?? (await currentUserId());
  const { data: myRows, error: participantError } = await supabase
    .from("conversation_participants")
    .select("conversation_id, last_read_at")
    .eq("user_id", me);
  if (participantError) fail("load conversations", participantError);
  if (!myRows?.length) return [];

  const conversationIds = myRows.map((row) => row.conversation_id);
  const { data: conversations, error: conversationError } = await supabase
    .from("conversations")
    .select("*")
    .in("id", conversationIds);
  if (conversationError) fail("load conversations", conversationError);

  const { data: participants, error: otherParticipantError } = await supabase
    .from("conversation_participants")
    .select("conversation_id, user_id")
    .in("conversation_id", conversationIds)
    .neq("user_id", me);
  if (otherParticipantError) fail("load conversation members", otherParticipantError);
  const otherIds = [...new Set((participants ?? []).map((row) => row.user_id))];
  if (!otherIds.length) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .in("id", otherIds);
  if (profileError) fail("load conversation profiles", profileError);

  const readAtByConversation = new Map(
    (myRows as Pick<ConversationParticipantRow, "conversation_id" | "last_read_at">[]).map(
      (row) => [row.conversation_id, row.last_read_at],
    ),
  );
  const participantByConversation = new Map(
    (participants ?? []).map((row) => [row.conversation_id, row.user_id]),
  );
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  return (conversations ?? [])
    .flatMap((conversation) => {
      const otherId = participantByConversation.get(conversation.id);
      const otherParticipant = otherId ? profileById.get(otherId) : undefined;
      const lastReadAt = readAtByConversation.get(conversation.id);
      if (!otherParticipant || !lastReadAt) return [];
      return [
        {
          ...conversation,
          otherParticipant,
          unread: isUnread(conversation.last_message_at, lastReadAt),
        },
      ];
    })
    .sort((a, b) => {
      const aTime = a.last_message_at ?? a.created_at;
      const bTime = b.last_message_at ?? b.created_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
}

export async function getConversation(
  conversationId: string,
  userId?: string,
): Promise<ChatProfile> {
  const me = userId ?? (await currentUserId());
  const { data: participants, error } = await supabase
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", conversationId);
  if (error) fail("load this conversation", error);
  if (!participants?.some((participant) => participant.user_id === me))
    throw new Error("This conversation is unavailable.");

  const otherId = participants.find((participant) => participant.user_id !== me)?.user_id;
  if (!otherId) throw new Error("This conversation has no other participant.");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .eq("id", otherId)
    .maybeSingle();
  if (profileError) fail("load this contact", profileError);
  if (!profile) throw new Error("This contact is unavailable.");
  return profile;
}

export async function getMessages(conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) fail("load messages", error);
  return data ?? [];
}

export async function sendMessage(conversationId: string, body: string): Promise<MessageRow> {
  const text = body.trim();
  if (!text || text.length > 2000) {
    throw new Error("Messages must be between 1 and 2000 characters.");
  }
  const senderId = await currentUserId();
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: senderId, body: text })
    .select("*")
    .single();
  if (error) fail("send your message", error);
  return data;
}

export async function markRead(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from("conversation_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId);
  if (error) fail("update this conversation", error);
}

export async function startConversation(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc("get_or_create_dm", { other_user: otherUserId });
  if (error) fail("start a conversation", error);
  if (!data) throw new Error("Couldn't start a conversation. Please try again.");
  return data;
}
