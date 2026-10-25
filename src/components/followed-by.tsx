import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Avatar } from "@/components/ediraa";
import { fetchMutualFollowers, type MutualPerson } from "@/lib/mutual";

function Name({ p }: { p: MutualPerson }) {
  return (
    <Link
      to="/u/$username"
      params={{ username: p.username }}
      className="font-semibold text-foreground hover:underline"
    >
      {p.username}
    </Link>
  );
}

/**
 * Instagram-style line under the bio of someone else's profile:
 * [photos] Followed by anna, ravi and 37 others. Only shows when there is at least one.
 */
export function FollowedBy({ meId, profileId }: { meId: string; profileId: string }) {
  const { data } = useQuery({
    queryKey: ["mutual-followers", meId, profileId],
    queryFn: () => fetchMutualFollowers(meId, profileId),
    staleTime: 60_000,
    retry: false,
  });
  if (!data || data.total === 0 || data.people.length === 0) return null;
  const [a, b] = data.people;
  const others = data.total - 2;
  return (
    <div className="mt-3 flex items-center gap-3" aria-label="Followed by people you follow">
      <div className="flex shrink-0 -space-x-3">
        {data.people.map((p) => (
          <span key={p.id} className="rounded-full">
            <Avatar src={p.avatar_url} name={p.full_name || p.username} size={28} />
          </span>
        ))}
      </div>
      <p className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
        Followed by {a && <Name p={a} />}
        {data.total === 1 ? null : data.total === 2 ? (
          <>
            {" and "}
            {b && <Name p={b} />}
          </>
        ) : (
          <>
            {", "}
            {b && <Name p={b} />}
            {` and ${others} ${others === 1 ? "other" : "others"}`}
          </>
        )}
      </p>
    </div>
  );
}
