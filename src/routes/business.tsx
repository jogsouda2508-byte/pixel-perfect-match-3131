import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Check, ChevronRight, Loader2 } from "lucide-react";
import { BusinessDirectory } from "@/components/business-directory";
import { Stars } from "@/components/business-reviews";
import { Avatar } from "@/components/ediraa";
import { PageHeader, PageShell } from "@/components/page-shell";
import { useAuth } from "@/lib/auth";
import { setupProgress, useBusinessPage, type BusinessPage } from "@/lib/business";
import { fetchFollowCounts, updateMyProfile } from "@/lib/social";

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
  const biz = useBusinessPage(meId, isBusiness);

  const stats = useQuery({
    queryKey: ["follow-counts", meId],
    queryFn: () => fetchFollowCounts(meId),
    enabled: !!meId && isBusiness,
  });

  const switchType = useMutation({
    mutationFn: (next: "personal" | "business") => updateMyProfile(meId, { account_type: next }),
    onSuccess: async (_data, next) => {
      await refreshProfile();
      void qc.invalidateQueries({ queryKey: ["feed"] });
      void qc.invalidateQueries({ queryKey: ["people"] });
      void qc.invalidateQueries({ queryKey: ["business-directory"] });
      void qc.invalidateQueries({ queryKey: ["business-page"] });
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

          <SetupChecklist page={biz.data} loading={biz.isLoading} />

          {biz.data && biz.data.rating_count > 0 && (
            <Link
              to="/profile"
              hash="reviews"
              className="flex min-h-11 items-center gap-2 rounded-xl bg-elevated/60 px-3 text-sm"
            >
              <Stars value={biz.data.rating_avg ?? 0} size={15} />
              <span className="font-semibold">{(biz.data.rating_avg ?? 0).toFixed(1)}</span>
              <span className="text-muted-foreground">
                · {biz.data.rating_count} review{biz.data.rating_count === 1 ? "" : "s"}
              </span>
              <span className="ml-auto flex items-center gap-0.5 font-semibold text-primary">
                See &amp; reply <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </Link>
          )}

          <Link
            to="/business-edit"
            className="flex min-h-12 w-full items-center justify-center rounded-full bg-gradient-brand text-sm font-semibold text-primary-foreground"
          >
            {setupProgress(biz.data).done === 0 ? "Set up business info" : "Edit business info"}
          </Link>
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
              Edit profile
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
            Switch to a Business account to get a business badge, show your opening hours, prices
            and Call / WhatsApp buttons, collect customer reviews, and have your posts show up in
            the Business feed. You can switch back any time.
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

      <BusinessDirectory showSearch />
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

/** "Complete your business page": what is done, and one tap to the part that is missing. */
function SetupChecklist({
  page,
  loading,
}: {
  page: BusinessPage | null | undefined;
  loading: boolean;
}) {
  if (loading) return null;
  const p = setupProgress(page);
  if (p.done === p.total)
    return (
      <p className="flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2.5 text-sm font-medium text-success">
        <Check className="h-4 w-4" aria-hidden="true" />
        Your business page is complete
      </p>
    );
  const items = [
    { done: p.contact, label: "Category and phone number", hash: "category" },
    { done: p.hours, label: "Opening hours", hash: "hours" },
    { done: p.prices, label: "Price list", hash: "prices" },
  ];
  return (
    <div className="rounded-2xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Complete your business page</p>
        <p className="text-xs text-muted-foreground">
          {p.done} of {p.total} done
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.done}
        aria-label="Business page set-up progress"
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-gradient-brand transition-all"
          style={{ width: `${(p.done / p.total) * 100}%` }}
        />
      </div>
      <ul className="mt-1">
        {items.map((item) => (
          <li key={item.hash}>
            <Link
              to="/business-edit"
              hash={item.hash}
              className="flex min-h-11 items-center gap-3 text-sm"
            >
              <span
                aria-hidden="true"
                className={`grid h-5 w-5 place-items-center rounded-full border ${item.done ? "border-success bg-success text-success-foreground" : "border-border"}`}
              >
                {item.done && <Check className="h-3 w-3" />}
              </span>
              <span className={item.done ? "text-muted-foreground line-through" : "font-medium"}>
                {item.label}
              </span>
              {!item.done && (
                <ChevronRight
                  className="ml-auto h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
