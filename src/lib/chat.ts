import { supabase } from "@/integrations/supabase/client";
import type {
  ConversationParticipantRow,
  ConversationRow,
  MessageRow,
  Profile,
} from "@/integrations/supabase/types";

export type ChatProfile = Pick<Profile, "id" | "full_name" | "username" | "avatar_url">;

export type ChatGroup = {
  id: string;
  name: string;
  memberCount: number;
  /** Up to three members, for the overlapping photos on the group icon. */
  preview: { name: string; avatar_url: string | null }[];
};

const toPreview = (p: ChatProfile) => ({
  name: p.full_name || p.username,
  avatar_url: p.avatar_url,
});

export type ChatConversation = ConversationRow & {
  /** For a group chat this stands in for the group (full_name = group name). */
  otherParticipant: ChatProfile;
  group: ChatGroup | null;
  unread: boolean;
};

/** What the conversation screen needs: who/what it is, plus every member for sender names. */
export type ChatContact = ChatProfile & { group: ChatGroup | null; members: ChatProfile[] };

function groupAsProfile(group: Pick<ChatGroup, "id" | "name">): ChatProfile {
  return { id: group.id, full_name: group.name, username: "", avatar_url: null };
}

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

  const groupIds = [
    ...new Set((conversations ?? []).flatMap((c) => (c.group_id ? [c.group_id] : []))),
  ];
  const groupNames = new Map<string, string>();
  if (groupIds.length) {
    const { data: groups, error: groupError } = await supabase
      .from("groups")
      .select("id, name")
      .in("id", groupIds);
    if (groupError) fail("load groups", groupError);
    for (const g of groups ?? []) groupNames.set(g.id, g.name);
  }

  const dmIds = new Set((conversations ?? []).filter((c) => !c.group_id).map((c) => c.id));
  const groupConvIds = new Set((conversations ?? []).filter((c) => c.group_id).map((c) => c.id));
  const previewIdsByConversation = new Map<string, string[]>();
  for (const row of participants ?? []) {
    if (!groupConvIds.has(row.conversation_id)) continue;
    const ids = previewIdsByConversation.get(row.conversation_id) ?? [];
    if (ids.length < 3) previewIdsByConversation.set(row.conversation_id, [...ids, row.user_id]);
  }
  const otherIds = [
    ...new Set([
      ...(participants ?? [])
        .filter((row) => dmIds.has(row.conversation_id))
        .map((row) => row.user_id),
      ...[...previewIdsByConversation.values()].flat(),
      ...(groupConvIds.size ? [me] : []),
    ]),
  ];
  const profileById = new Map<string, ChatProfile>();
  if (otherIds.length) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .in("id", otherIds);
    if (profileError) fail("load conversation profiles", profileError);
    for (const p of profiles ?? []) profileById.set(p.id, p);
  }

  const readAtByConversation = new Map(
    (myRows as Pick<ConversationParticipantRow, "conversation_id" | "last_read_at">[]).map(
      (row) => [row.conversation_id, row.last_read_at],
    ),
  );
  const othersByConversation = new Map<string, string[]>();
  for (const row of participants ?? []) {
    othersByConversation.set(row.conversation_id, [
      ...(othersByConversation.get(row.conversation_id) ?? []),
      row.user_id,
    ]);
  }

  return (conversations ?? [])
    .flatMap((conversation): ChatConversation[] => {
      const lastReadAt = readAtByConversation.get(conversation.id);
      if (!lastReadAt) return [];
      const others = othersByConversation.get(conversation.id) ?? [];
      const unread = isUnread(conversation.last_message_at, lastReadAt);

      if (conversation.group_id) {
        const name = groupNames.get(conversation.group_id);
        if (!name) return [];
        const previewIds = [...(previewIdsByConversation.get(conversation.id) ?? []), me].slice(
          0,
          3,
        );
        const preview = previewIds.flatMap((uid) => {
          const profile = profileById.get(uid);
          return profile ? [toPreview(profile)] : [];
        });
        const group = { id: conversation.group_id, name, memberCount: others.length + 1, preview };
        return [{ ...conversation, otherParticipant: groupAsProfile(group), group, unread }];
      }
      const otherParticipant = others[0] ? profileById.get(others[0]) : undefined;
      if (!otherParticipant) return [];
      return [{ ...conversation, otherParticipant, group: null, unread }];
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
): Promise<ChatContact> {
  const me = userId ?? (await currentUserId());
  const { data: participants, error } = await supabase
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", conversationId);
  if (error) fail("load this conversation", error);
  if (!participants?.some((participant) => participant.user_id === me))
    throw new Error("This conversation is unavailable.");

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("group_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (conversationError) fail("load this conversation", conversationError);

  const otherIds = participants.map((p) => p.user_id).filter((uid) => uid !== me);

  if (conversation?.group_id) {
    const { data: groupRow, error: groupError } = await supabase
      .from("groups")
      .select("id, name")
      .eq("id", conversation.group_id)
      .maybeSingle();
    if (groupError) fail("load this group", groupError);
    if (!groupRow) throw new Error("This group is unavailable.");
    // Fetch everyone including me: others label messages, all of them make up the icon photos.
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .in("id", [...otherIds, me]);
    if (profileError) fail("load group members", profileError);
    const everyone = profiles ?? [];
    const members = everyone.filter((p) => p.id !== me);
    const mine = everyone.filter((p) => p.id === me);
    const group = {
      id: groupRow.id,
      name: groupRow.name,
      memberCount: participants.length,
      preview: [...members, ...mine].slice(0, 3).map(toPreview),
    };
    return { ...groupAsProfile(group), group, members };
  }

  const otherId = otherIds[0];
  if (!otherId) throw new Error("This conversation has no other participant.");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .eq("id", otherId)
    .maybeSingle();
  if (profileError) fail("load this contact", profileError);
  if (!profile) throw new Error("This contact is unavailable.");
  return { ...profile, group: null, members: [profile] };
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
