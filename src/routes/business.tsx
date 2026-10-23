import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Loader2 } from "lucide-react";
import { Avatar, UserRow } from "@/components/ediraa";
import { PageHeader, PageShell } from "@/components/page-shell";
import { useAuth } from "@/lib/auth";
import { fetchFollowCounts, fetchPeople, updateMyProfile } from "@/lib/social";
import { useFollow } from "@/lib/use-follow";

export const Route = createFileRoute("/business")({
  head: () => ({
    meta: [
      { title: "Business Page — Ediraa" },
      {
        name: "description",
        content: "Run a business page and discover local businesses on Ediraa.",
      },
    ],
  }),
  component: BusinessPage,
});

function BusinessPage() {
  const { user, profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const meId = user?.id ?? "";
  const isBusiness = profile?.account_type === "business";
  const follow = useFollow();

  const stats = useQuery({
    queryKey: ["follow-counts", meId],
    queryFn: () => fetchFollowCounts(meId),
    enabled: !!meId && isBusiness,
  });
  const businesses = useQuery({
    queryKey: ["people", "business", meId],
    queryFn: () => fetchPeople({ businessOnly: true, limit: 20 }),
    enabled: !!meId,
  });

  const switchType = useMutation({
    mutationFn: (next: "personal" | "business") => updateMyProfile(meId, { account_type: next }),
    onSuccess: async (_data, next) => {
      await refreshProfile();
      void qc.invalidateQueries({ queryKey: ["feed"] });
      void qc.invalidateQueries({ queryKey: ["people"] });
      toast.success(
        next === "business"
          ? "You now have a Business page"
          : "Switched back to a personal account",
      );
    },
    onError: () => toast.error("Couldn't change your account type. Please try again."),
  });

  const name = profile?.full_name || profile?.username || "";

  return (
    <PageShell>
      <PageHeader title="Business Page" />

      {isBusiness ? (
        <section className="glass-card space-y-4 p-4">
          <div className="flex items-center gap-3">
            <Avatar src={profile?.avatar_url} name={name} size={56} ring />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate font-semibold">
                {name}
                <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-xs font-medium text-primary">
                  <Building2 className="h-3 w-3" />
                  Business
                </span>
              </p>
              <p className="truncate text-sm text-muted-foreground">@{profile?.username}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 text-center">
            <Stat n={stats.data?.posts ?? 0} l="Posts" />
            <Stat n={stats.data?.followers ?? 0} l="Followers" />
            <Stat n={stats.data?.following ?? 0} l="Following" />
          </div>
          <p className="text-sm text-muted-foreground">
            Your posts appear in the Business tab of everyone's feed, and your profile is marked as
            a business.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Link
              to="/profile"
              className="rounded-full border border-primary py-2.5 text-center text-sm font-semibold text-primary"
            >
              View page
            </Link>
            <Link
              to="/settings"
              className="rounded-full border border-border py-2.5 text-center text-sm font-semibold"
            >
              Edit details
            </Link>
          </div>
          <button
            type="button"
            disabled={switchType.isPending}
            onClick={() => {
              if (window.confirm("Switch back to a personal account?"))
                switchType.mutate("personal");
            }}
            className="w-full text-center text-sm font-medium text-muted-foreground hover:text-destructive disabled:opacity-60"
          >
            Switch back to a personal account
          </button>
        </section>
      ) : (
        <section className="glass-card space-y-3 p-5 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gradient-brand text-primary-foreground">
            <Building2 className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold">Grow your business on Ediraa</h2>
          <p className="text-sm text-muted-foreground">
            Switch to a Business account to get a business badge on your profile and have your posts
            show up in the Business feed. You can switch back any time.
          </p>
          <button
            type="button"
            disabled={switchType.isPending}
            onClick={() => switchType.mutate("business")}
            className="mx-auto flex items-center justify-center gap-2 rounded-full bg-gradient-brand px-6 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {switchType.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Switch to a Business account
          </button>
        </section>
      )}

      <section className="glass-card p-4">
        <h2 className="mb-4 font-semibold">Businesses on Ediraa</h2>
        <div className="space-y-4">
          {businesses.isLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {businesses.isError && (
            <p className="text-sm text-destructive">Couldn't load businesses.</p>
          )}
          {businesses.isSuccess && businesses.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No other businesses have joined yet.</p>
          )}
          {businesses.data?.map((p) => (
            <UserRow
              key={p.id}
              name={p.full_name || p.username}
              username={p.username}
              sub={`@${p.username}`}
              img={p.avatar_url}
              following={follow.isFollowing(p.id, p.is_following)}
              requested={follow.isRequested(p.id)}
              pending={follow.isPending(p.id)}
              onToggle={() => follow.toggle(p.id, follow.isFollowing(p.id, p.is_following))}
            />
          ))}
        </div>
      </section>
    </PageShell>
  );
}

function Stat({ n, l }: { n: number; l: string }) {
  return (
    <div>
      <p className="text-lg font-bold">{n}</p>
      <p className="text-xs text-muted-foreground">{l}</p>
    </div>
  );
}
