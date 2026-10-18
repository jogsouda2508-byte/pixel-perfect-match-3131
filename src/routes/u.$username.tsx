import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { ProfileView } from "@/components/profile-view";
import { useAuth } from "@/lib/auth";
import { fetchProfileByUsername } from "@/lib/social";

export const Route = createFileRoute("/u/$username")({
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} — Gicco chat` },
      { name: "description", content: `See @${params.username}'s posts on Gicco chat.` },
    ],
  }),
  component: UserProfilePage,
});

/** Anyone's profile, reached by tapping their name or photo anywhere in the app. */
function UserProfilePage() {
  const { username } = Route.useParams();
  const { profile: me } = useAuth();
  const navigate = useNavigate();
  const handle = username.replace(/^@/, "").toLowerCase();
  const isMe = me?.username === handle;

  // Your own @name opens the regular /profile page.
  useEffect(() => {
    if (isMe) navigate({ to: "/profile", replace: true });
  }, [isMe, navigate]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["profile", handle],
    queryFn: () => fetchProfileByUsername(handle),
    enabled: !isMe,
  });

  if (isMe || isLoading) {
    return (
      <div className="grid min-h-screen place-items-center" role="status" aria-label="Loading">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <PageShell>
        <div className="glass-card space-y-3 p-8 text-center">
          <h1 className="text-xl font-bold">
            {isError ? "Couldn't load this profile" : "User not found"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isError
              ? "Please try again in a moment."
              : `There's no one on Gicco chat called @${handle}.`}
          </p>
          {isError ? (
            <button
              onClick={() => refetch()}
              className="rounded-full border border-primary px-5 py-2 text-sm font-semibold text-primary"
            >
              Try again
            </button>
          ) : (
            <Link
              to="/discover"
              className="inline-block rounded-full border border-primary px-5 py-2 text-sm font-semibold text-primary"
            >
              Back to Discover
            </Link>
          )}
        </div>
      </PageShell>
    );
  }

  return <ProfileView key={data.id} profile={data} isMe={false} />;
}
