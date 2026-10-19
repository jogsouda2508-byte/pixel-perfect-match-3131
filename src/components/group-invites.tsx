import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { GroupAvatar, memberLabel } from "@/components/group-ui";
import { useAuth } from "@/lib/auth";
import { fetchMyGroupInvites, respondToGroupInvite } from "@/lib/social";

/** Pending invitations with Accept / Decline. Renders nothing when there are none. */
export function GroupInvites() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const meId = user?.id ?? "";

  const invites = useQuery({
    queryKey: ["group-invites", meId],
    queryFn: fetchMyGroupInvites,
    enabled: !!meId,
    refetchInterval: 30_000,
  });

  const respond = useMutation({
    mutationFn: (v: { id: string; name: string; accept: boolean }) =>
      respondToGroupInvite(v.id, v.accept),
    onSuccess: async (_d, v) => {
      toast.success(v.accept ? `You joined ${v.name}` : "Invitation declined");
      await Promise.all(
        ["group-invites", "groups", "chat-conversations", "chat-unread"].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      );
      if (v.accept) navigate({ to: "/group/$id", params: { id: v.id } });
    },
    onError: async () => {
      toast.error("This invitation was withdrawn.");
      await qc.invalidateQueries({ queryKey: ["group-invites"] });
    },
  });

  if (!invites.data?.length) return null;

  return (
    <section className="space-y-2" aria-label="Group invitations">
      <h2 className="text-sm font-semibold">
        Invitations <span className="text-muted-foreground">({invites.data.length})</span>
      </h2>
      {invites.data.map((inv) => {
        const busy = respond.isPending && respond.variables?.id === inv.group_id;
        const who = inv.inviter_name || inv.inviter_username;
        return (
          <div key={inv.group_id} className="glass-card flex items-center gap-3 p-3">
            <GroupAvatar size={44} members={inv.member_preview} total={inv.member_count} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{inv.group_name}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Avatar src={inv.inviter_avatar} name={who} size={16} />
                <span className="truncate">
                  {who} invited you • {memberLabel(inv.member_count)}
                </span>
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  respond.mutate({ id: inv.group_id, name: inv.group_name, accept: false })
                }
                className="rounded-full bg-elevated px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-60"
              >
                Decline
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  respond.mutate({ id: inv.group_id, name: inv.group_name, accept: true })
                }
                className="flex items-center gap-1 rounded-full bg-gradient-brand px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                Accept
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
