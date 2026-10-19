import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  LogOut,
  MessageCircle,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { GroupAvatar, PrivacyBadge, memberLabel } from "@/components/group-ui";
import { MemberPicker, type PickedPerson } from "@/components/member-picker";
import { PageShell } from "@/components/page-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import {
  deleteGroup,
  fetchGroup,
  fetchGroupMembers,
  inviteToGroup,
  removeGroupMember,
  respondToGroupInvite,
  setGroupMembership,
} from "@/lib/social";

export const Route = createFileRoute("/group/$id")({
  head: () => ({ meta: [{ title: "Group — Gicco chat" }] }),
  component: GroupPage,
});

const errorText = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

function GroupPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const meId = user?.id ?? "";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [inviting, setInviting] = useState(false);
  const [picked, setPicked] = useState<PickedPerson[]>([]);

  const group = useQuery({
    queryKey: ["group", id, meId],
    queryFn: () => fetchGroup(id),
    enabled: !!meId,
  });
  const members = useQuery({
    queryKey: ["group-members", id],
    queryFn: () => fetchGroupMembers(id),
    enabled: !!meId && !!group.data,
  });

  const refresh = () =>
    Promise.all(
      ["group", "group-members", "groups", "group-invites", "chat-conversations"].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );

  const run = <T,>(fn: (v: T) => Promise<unknown>, ok: string, after?: () => void) => ({
    mutationFn: fn,
    onSuccess: async () => {
      toast.success(ok);
      await refresh();
      after?.();
    },
    onError: (e: unknown) => toast.error(errorText(e, "Something went wrong. Please try again.")),
  });

  const join = useMutation(run(() => setGroupMembership(id, meId, true), "You joined the group"));
  const leave = useMutation(
    run(
      () => setGroupMembership(id, meId, false),
      "You left the group",
      () => navigate({ to: "/groups" }),
    ),
  );
  const accept = useMutation(run(() => respondToGroupInvite(id, true), "You joined the group"));
  const decline = useMutation(
    run(
      () => respondToGroupInvite(id, false),
      "Invitation declined",
      () => navigate({ to: "/groups" }),
    ),
  );
  const remove = useMutation(run((uid: string) => removeGroupMember(id, uid), "Member removed"));
  const destroy = useMutation(
    run(
      () => deleteGroup(id),
      "Group deleted",
      () => navigate({ to: "/groups" }),
    ),
  );
  const invite = useMutation(
    run(
      () =>
        inviteToGroup(
          id,
          picked.map((p) => p.id),
        ),
      "Invitations sent",
      () => {
        setPicked([]);
        setInviting(false);
      },
    ),
  );

  const g = group.data;
  const isAdmin = g?.my_role === "admin";

  return (
    <PageShell showBottomNav={false}>
      <div className="space-y-4">
        <Link
          to="/groups"
          aria-label="Back to groups"
          className="grid h-11 w-11 place-items-center rounded-full hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>

        {group.isLoading && (
          <div className="grid place-items-center p-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
        {group.isError && <p className="text-sm text-destructive">Couldn't load this group.</p>}
        {group.isSuccess && !g && (
          <p className="glass-card p-6 text-center text-sm text-muted-foreground">
            This group doesn't exist, or it's private.
          </p>
        )}

        {g && (
          <>
            <section className="glass-card space-y-4 p-5 text-center">
              <div className="flex justify-center">
                <GroupAvatar size={72} members={g.member_preview} total={g.member_count} />
              </div>
              <div>
                <h1 className="break-words text-xl font-bold">{g.name}</h1>
                <p className="mt-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  {memberLabel(g.member_count)}
                  <PrivacyBadge isPrivate={g.is_private} />
                </p>
                {g.description && (
                  <p className="mt-3 whitespace-pre-line break-words text-sm text-muted-foreground">
                    {g.description}
                  </p>
                )}
              </div>

              {g.is_member && g.conversation_id && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Link
                    to="/chat/$id"
                    params={{ id: g.conversation_id }}
                    className="flex items-center gap-2 rounded-full bg-gradient-brand px-5 py-2 text-sm font-semibold text-primary-foreground"
                  >
                    <MessageCircle className="h-4 w-4" /> Open chat
                  </Link>
                  <button
                    type="button"
                    onClick={() => setInviting(true)}
                    className="flex items-center gap-2 rounded-full bg-elevated px-5 py-2 text-sm font-semibold"
                  >
                    <UserPlus className="h-4 w-4" /> Add people
                  </button>
                </div>
              )}

              {!g.is_member && g.has_invite && (
                <div className="space-y-2">
                  <p className="text-sm">You've been invited to join this group.</p>
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      disabled={decline.isPending || accept.isPending}
                      onClick={() => decline.mutate(undefined)}
                      className="rounded-full bg-elevated px-5 py-2 text-sm font-semibold text-muted-foreground disabled:opacity-60"
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      disabled={decline.isPending || accept.isPending}
                      onClick={() => accept.mutate(undefined)}
                      className="rounded-full bg-gradient-brand px-6 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      Accept
                    </button>
                  </div>
                </div>
              )}

              {!g.is_member && !g.has_invite && !g.is_private && (
                <button
                  type="button"
                  disabled={join.isPending}
                  onClick={() => join.mutate(undefined)}
                  className="rounded-full bg-gradient-brand px-6 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  Join group
                </button>
              )}
            </section>

            {g.is_member && (
              <section className="glass-card divide-y divide-border" aria-label="Members">
                {members.isLoading && (
                  <div className="grid place-items-center p-5">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                )}
                {members.isError && (
                  <p className="p-4 text-sm text-destructive">Couldn't load members.</p>
                )}
                {members.data?.map((m) => {
                  const name = m.full_name || m.username;
                  return (
                    <div key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                      <Avatar src={m.avatar_url} name={name} size={40} />
                      <Link
                        to="/u/$username"
                        params={{ username: m.username }}
                        className="min-w-0 flex-1"
                      >
                        <span className="block truncate text-sm font-semibold">
                          {name}
                          {m.user_id === meId ? " (you)" : ""}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          @{m.username}
                        </span>
                      </Link>
                      {m.role === "admin" && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                          Admin
                        </span>
                      )}
                      {isAdmin && m.role !== "admin" && (
                        <button
                          type="button"
                          aria-label={`Remove ${name}`}
                          disabled={remove.isPending}
                          onClick={() => {
                            if (window.confirm(`Remove ${name} from the group?`))
                              remove.mutate(m.user_id);
                          }}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-60"
                        >
                          <UserMinus className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {g.is_member && (
              <div className="flex justify-center">
                {isAdmin ? (
                  <button
                    type="button"
                    disabled={destroy.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete "${g.name}"? This removes the group and its chat for everyone.`,
                        )
                      )
                        destroy.mutate(undefined);
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-destructive disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" /> Delete group
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={leave.isPending}
                    onClick={() => {
                      if (window.confirm(`Leave "${g.name}"? You'll stop receiving its messages.`))
                        leave.mutate(undefined);
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-destructive disabled:opacity-60"
                  >
                    <LogOut className="h-4 w-4" /> Leave group
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <Dialog
        open={inviting}
        onOpenChange={(o) => {
          setInviting(o);
          if (!o) setPicked([]);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add people</DialogTitle>
            <DialogDescription>They'll get an invitation to accept or decline.</DialogDescription>
          </DialogHeader>
          <MemberPicker
            selected={picked}
            onChange={setPicked}
            excludeIds={[meId, ...(members.data?.map((m) => m.user_id) ?? [])]}
          />
          <button
            type="button"
            disabled={!picked.length || invite.isPending}
            onClick={() => invite.mutate(undefined)}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-brand px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {invite.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {picked.length
              ? `Send ${picked.length} ${picked.length === 1 ? "invitation" : "invitations"}`
              : "Send invitations"}
          </button>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
