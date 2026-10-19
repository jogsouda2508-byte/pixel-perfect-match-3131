import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MessageCircle, Plus } from "lucide-react";
import { Pill } from "@/components/ediraa";
import { CreateGroupDialog } from "@/components/create-group-dialog";
import { GroupAvatar, PrivacyBadge, memberLabel } from "@/components/group-ui";
import { GroupInvites } from "@/components/group-invites";
import { useAuth } from "@/lib/auth";
import { fetchGroups, setGroupMembership } from "@/lib/social";

/** Browse, create and join groups; answer invitations. Used on /groups and Discover → Groups. */
export function GroupsPanel({ query = "" }: { query?: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const meId = user?.id ?? "";
  const [mineOnly, setMineOnly] = useState(false);
  const [creating, setCreating] = useState(false);

  const groups = useQuery({
    queryKey: ["groups", meId, query, mineOnly],
    queryFn: () => fetchGroups({ query, mineOnly }),
    enabled: !!meId,
  });

  const join = useMutation({
    mutationFn: (id: string) => setGroupMembership(id, meId, true),
    onSuccess: async () => {
      toast.success("You joined the group");
      await Promise.all(
        ["groups", "chat-conversations"].map((k) => qc.invalidateQueries({ queryKey: [k] })),
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't join the group."),
  });

  return (
    <section className="space-y-4">
      <GroupInvites />
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-2 overflow-x-auto">
          <Pill active={!mineOnly} onClick={() => setMineOnly(false)}>
            All groups
          </Pill>
          <Pill active={mineOnly} onClick={() => setMineOnly(true)}>
            My groups
          </Pill>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-brand px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          New group
        </button>
      </div>
      <CreateGroupDialog open={creating} onOpenChange={setCreating} />

      <div className="glass-card divide-y divide-border">
        {groups.isLoading && (
          <div className="grid place-items-center p-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}
        {groups.isError && <p className="p-4 text-sm text-destructive">Couldn't load groups.</p>}
        {groups.isSuccess && groups.data.length === 0 && (
          <div className="space-y-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {query
                ? "No groups match your search."
                : mineOnly
                  ? "You haven't joined any groups yet."
                  : "No groups yet."}
            </p>
            {!query && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="rounded-full bg-gradient-brand px-5 py-2 text-sm font-semibold text-primary-foreground"
              >
                Create a group
              </button>
            )}
          </div>
        )}
        {groups.data?.map((g) => (
          <div key={g.id} className="flex items-center gap-3 p-4">
            <Link
              to="/group/$id"
              params={{ id: g.id }}
              className="flex min-w-0 flex-1 items-start gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <GroupAvatar size={44} members={g.member_preview} total={g.member_count} />
              <span className="min-w-0 flex-1">
                <span className="block break-words font-semibold">{g.name}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {memberLabel(g.member_count)}
                  <PrivacyBadge isPrivate={g.is_private} />
                  {g.my_role === "admin" && <span>Admin</span>}
                </span>
                {g.description && (
                  <span className="mt-1 line-clamp-2 block break-words text-sm text-muted-foreground">
                    {g.description}
                  </span>
                )}
              </span>
            </Link>
            {g.is_member && g.conversation_id ? (
              <Link
                to="/chat/$id"
                params={{ id: g.conversation_id }}
                aria-label={`Open ${g.name} chat`}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-elevated text-primary"
              >
                <MessageCircle className="h-5 w-5" />
              </Link>
            ) : g.has_invite ? (
              <Link
                to="/group/$id"
                params={{ id: g.id }}
                className="shrink-0 rounded-full bg-gradient-brand px-4 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                View invite
              </Link>
            ) : (
              <button
                type="button"
                disabled={join.isPending && join.variables === g.id}
                onClick={() => join.mutate(g.id)}
                className="shrink-0 rounded-full bg-gradient-brand px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                Join
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
