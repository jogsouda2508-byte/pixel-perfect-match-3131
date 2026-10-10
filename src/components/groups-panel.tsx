import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { Pill } from "@/components/ediraa";
import { useAuth } from "@/lib/auth";
import { createGroup, deleteGroup, fetchGroups, setGroupMembership } from "@/lib/social";

const NAME_MIN = 3;
const NAME_MAX = 50;
const DESC_MAX = 300;
const field =
  "w-full rounded-xl border border-border bg-elevated/40 px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary";

/** Browse, create, join and leave groups. Used on /groups and in Discover → Groups. */
export function GroupsPanel({ query = "" }: { query?: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const meId = user?.id ?? "";
  const [mineOnly, setMineOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const groups = useQuery({
    queryKey: ["groups", meId, query, mineOnly],
    queryFn: () => fetchGroups({ query, mineOnly }),
    enabled: !!meId,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["groups"] });

  const create = useMutation({
    mutationFn: () => createGroup(name, desc),
    onSuccess: async () => {
      toast.success("Group created");
      setName("");
      setDesc("");
      setCreating(false);
      setMineOnly(true);
      await refresh();
    },
    onError: () =>
      toast.error(`Couldn't create the group. Names must be ${NAME_MIN}–${NAME_MAX} characters.`),
  });

  const membership = useMutation({
    mutationFn: (v: { id: string; join: boolean }) => setGroupMembership(v.id, meId, v.join),
    onSuccess: refresh,
    onError: () => toast.error("Couldn't update your membership. Please try again."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteGroup(id),
    onSuccess: async () => {
      toast.success("Group deleted");
      await refresh();
    },
    onError: () => toast.error("Couldn't delete the group."),
  });

  const nameOk = name.trim().length >= NAME_MIN && name.trim().length <= NAME_MAX;

  return (
    <section className="space-y-4">
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
          onClick={() => setCreating((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-brand px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Create
        </button>
      </div>

      {creating && (
        <form
          className="glass-card space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameOk && !create.isPending) create.mutate();
          }}
        >
          <h2 className="font-semibold">New group</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
            placeholder="Group name"
            aria-label="Group name"
            className={field}
          />
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value.slice(0, DESC_MAX))}
            placeholder="What is this group about? (optional)"
            aria-label="Group description"
            rows={3}
            className={`${field} resize-none`}
          />
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-3 py-2 text-sm font-semibold text-muted-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!nameOk || create.isPending}
              className="flex items-center gap-2 rounded-full bg-gradient-brand px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create group
            </button>
          </div>
        </form>
      )}

      <div className="glass-card divide-y divide-border">
        {groups.isLoading && (
          <div className="grid place-items-center p-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}
        {groups.isError && <p className="p-4 text-sm text-destructive">Couldn't load groups.</p>}
        {groups.isSuccess && groups.data.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {query
              ? "No groups match your search."
              : mineOnly
                ? "You haven't joined any groups yet."
                : "No groups yet. Create the first one!"}
          </p>
        )}
        {groups.data?.map((g) => {
          const busy =
            (membership.isPending && membership.variables?.id === g.id) ||
            (remove.isPending && remove.variables === g.id);
          return (
            <div key={g.id} className="flex items-start gap-3 p-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-brand text-primary-foreground">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold">{g.name}</p>
                <p className="text-xs text-muted-foreground">
                  {g.member_count} {g.member_count === 1 ? "member" : "members"}
                  {g.my_role === "admin" ? " • You're the admin" : ""}
                </p>
                {g.description && (
                  <p className="mt-1 whitespace-pre-line break-words text-sm text-muted-foreground">
                    {g.description}
                  </p>
                )}
              </div>
              {g.my_role === "admin" ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Delete ${g.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete "${g.name}"? This removes the group for everyone.`))
                      remove.mutate(g.id);
                  }}
                  className="mt-1 text-muted-foreground hover:text-destructive disabled:opacity-60"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => membership.mutate({ id: g.id, join: !g.is_member })}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${g.is_member ? "bg-elevated text-muted-foreground" : "bg-gradient-brand text-primary-foreground"}`}
                >
                  {g.is_member ? "Joined" : "Join"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
