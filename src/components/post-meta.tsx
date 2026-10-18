import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { MapPin, Users } from "lucide-react";
import { UserRow } from "@/components/ediraa";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FeedRow } from "@/integrations/supabase/types";

/** "Cubbon Park, Bengaluru" -- adds the city unless the name already includes it. */
function locationLabel(name: string, city: string | null | undefined): string {
  if (!city || name.toLowerCase().includes(city.toLowerCase())) return name;
  return `${name}, ${city}`;
}

/**
 * The location and tagged people shown under a post's header. Renders nothing for posts that have
 * neither. Posts are only loaded for people allowed to see them (row-level security), and the
 * tag list is filtered the same way, so this never reveals anything the viewer couldn't already see.
 */
export function PostMeta({
  post,
  tone = "default",
}: {
  post: Pick<FeedRow, "location_name" | "location_city" | "tagged_people">;
  /** "overlay" is for white text on top of a video. */
  tone?: "default" | "overlay";
}) {
  const [open, setOpen] = useState(false);
  const people = post.tagged_people ?? [];
  const place = post.location_name;
  if (!place && people.length === 0) return null;

  const overlay = tone === "overlay";
  const strong = overlay ? "text-white" : "text-foreground";
  const shown = people.slice(0, 2);
  const rest = people.length - shown.length;

  return (
    <div
      className={`mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${overlay ? "text-white/85" : "text-muted-foreground"}`}
    >
      {place && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="sr-only">Location: </span>
          <span className="truncate">{locationLabel(place, post.location_city)}</span>
        </span>
      )}
      {people.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Users className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>with</span>
          {shown.map((person, index) => (
            <span key={person.id}>
              <Link
                to="/u/$username"
                params={{ username: person.username }}
                className={`font-medium ${strong} hover:underline`}
              >
                {person.full_name || `@${person.username}`}
              </Link>
              {index < shown.length - 1 ? (rest === 0 ? " and" : ",") : ""}
            </span>
          ))}
          {rest > 0 && (
            <>
              <span>and</span>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className={`font-medium ${strong} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
              >
                {rest} {rest === 1 ? "other" : "others"}
              </button>
            </>
          )}
        </span>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>People in this post</DialogTitle>
            <DialogDescription className="sr-only">
              Everyone tagged in this post. Select a name to open their profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4" onClick={(e) => {
            // Close the popup when a profile link is followed.
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}>
            {people.map((person) => (
              <UserRow
                key={person.id}
                name={person.full_name || person.username}
                username={person.username}
                sub={`@${person.username}`}
                img={person.avatar_url}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
