import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, Loader2, RefreshCw, Search, X } from "lucide-react";
import { ResponsiveModal } from "@/components/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { MAX_TAGGED_PEOPLE } from "@/lib/post-extras";
import { fetchPeople } from "@/lib/social";
import type { Audience, PersonRow, TaggedPerson } from "@/integrations/supabase/types";

const PAGE = 20;
/** The `get_people` database function never returns more than this many rows. */
const SERVER_MAX = 50;

/** Small local avatar: importing the shared one would create an import cycle
 *  (ediraa -> composer -> this picker -> ediraa). */
function PersonAvatar({ src, name }: { src: string | null; name: string }) {
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  return src ? (
    <img src={src} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
  ) : (
    <span
      aria-hidden="true"
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-brand font-semibold text-primary-foreground"
    >
      {initial}
    </span>
  );
}

function toTagged(person: PersonRow): TaggedPerson {
  return {
    id: person.id,
    username: person.username,
    full_name: person.full_name,
    avatar_url: person.avatar_url,
  };
}

/**
 * Search real Ediraa accounts and pick the people to tag. The list comes from the same backend
 * call as the rest of the app (`get_people`), which never returns you, unfinished sign-ups or
 * deleted accounts. The database re-checks every tag again when the post is published.
 */
export function TagPeoplePickerModal({
  open,
  onOpenChange,
  value,
  audience,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: TaggedPerson[];
  audience: Audience;
  onDone: (people: TaggedPerson[]) => void;
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [draft, setDraft] = useState<TaggedPerson[]>(value);

  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setQuery("");
    setDebounced("");
    setLimit(PAGE);
  }, [open, value]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(query.trim());
      setLimit(PAGE);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const people = useQuery({
    queryKey: ["tag-people", user?.id, debounced, limit],
    queryFn: () => fetchPeople({ query: debounced, limit }),
    enabled: open && !!user,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });

  const selectedIds = new Set(draft.map((person) => person.id));
  const atLimit = draft.length >= MAX_TAGGED_PEOPLE;
  const rows = (people.data ?? []).filter((person) => person.id !== user?.id);
  const canLoadMore = (people.data?.length ?? 0) >= limit && limit < SERVER_MAX;

  const toggle = (person: PersonRow) => {
    setDraft((current) => {
      if (current.some((item) => item.id === person.id)) {
        return current.filter((item) => item.id !== person.id);
      }
      if (current.length >= MAX_TAGGED_PEOPLE) return current;
      return [...current, toTagged(person)];
    });
  };

  const audienceNote =
    audience === "Friends"
      ? "Your post is for Friends, so only mutual friends can be tagged."
      : audience === "Local Community"
        ? "Your post is for your Local Community, so only people in the same community can be tagged."
        : "";

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Tag people"
      description="Search Ediraa members to tag in this post."
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-11"
            onClick={() => {
              onDone(draft);
              onOpenChange(false);
            }}
          >
            Done{draft.length > 0 ? ` (${draft.length})` : ""}
          </Button>
        </>
      }
    >
      <label className="relative block">
        <span className="sr-only">Search people</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value.slice(0, 50))}
          placeholder="Search by name or @username"
          autoComplete="off"
          className="h-11 pl-10"
        />
      </label>

      {draft.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Selected people">
          {draft.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => setDraft((current) => current.filter((p) => p.id !== person.id))}
                aria-label={`Remove @${person.username}`}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-3 pr-2 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                @{person.username}
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {atLimit && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          You can tag up to {MAX_TAGGED_PEOPLE} people.
        </p>
      )}

      <div className="mt-3 min-h-[8rem] flex-1 overflow-y-auto" aria-live="polite">
        {people.isLoading && (
          <div className="grid place-items-center py-8" role="status" aria-label="Searching">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}

        {people.isError && (
          <div className="space-y-3 py-6 text-center" role="alert">
            <p className="text-sm text-destructive">Couldn't load people. Please try again.</p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void people.refetch()}
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        )}

        {people.isSuccess && rows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {debounced ? `No one found for “${debounced}”.` : "No one to tag yet."}
          </p>
        )}

        {rows.length > 0 && (
          <ul className="space-y-1">
            {rows.map((person) => {
              const isSelected = selectedIds.has(person.id);
              const name = person.full_name || person.username;
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => toggle(person)}
                    aria-pressed={isSelected}
                    disabled={!isSelected && atLimit}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${isSelected ? "bg-primary/10" : "hover:bg-muted"}`}
                  >
                    <PersonAvatar src={person.avatar_url} name={name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        @{person.username}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50"}`}
                    >
                      {isSelected && <Check className="h-4 w-4" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {canLoadMore && !people.isError && (
          <Button
            type="button"
            variant="ghost"
            className="mt-2 min-h-11 w-full"
            disabled={people.isFetching}
            onClick={() => setLimit((current) => Math.min(current + PAGE, SERVER_MAX))}
          >
            {people.isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Load more
          </Button>
        )}
      </div>

      {audienceNote && <p className="mt-2 text-xs text-muted-foreground">{audienceNote}</p>}
    </ResponsiveModal>
  );
}
