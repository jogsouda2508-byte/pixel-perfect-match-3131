import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Search, X } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { fetchPeople } from "@/lib/social";

export type PickedPerson = {
  id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
};

/** Search people and tick the ones to invite. Selected people show as removable chips. */
export function MemberPicker({
  selected,
  onChange,
  excludeIds = [],
  max = 50,
}: {
  selected: PickedPerson[];
  onChange: (next: PickedPerson[]) => void;
  excludeIds?: string[];
  max?: number;
}) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const people = useQuery({
    queryKey: ["member-picker", term],
    queryFn: () => fetchPeople({ query: term, limit: 30 }),
  });
  const visible = (people.data ?? []).filter((p) => !excludeIds.includes(p.id));
  const isPicked = (id: string) => selected.some((p) => p.id === id);

  const toggle = (p: PickedPerson) => {
    if (isPicked(p.id)) onChange(selected.filter((x) => x.id !== p.id));
    else if (selected.length < max) onChange([...selected, p]);
  };

  return (
    <div className="space-y-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Selected people">
          {selected.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p)}
              aria-label={`Remove ${p.full_name || p.username}`}
              className="flex items-center gap-1.5 rounded-full bg-elevated py-1 pl-1 pr-2 text-xs font-medium"
            >
              <Avatar src={p.avatar_url} name={p.full_name || p.username} size={22} />
              {p.full_name || p.username}
              <X className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <label className="relative block">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people to invite"
          aria-label="Search people to invite"
          className="w-full rounded-xl border border-border bg-elevated/40 py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
        />
      </label>
      <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {people.isLoading && (
          <div className="grid place-items-center p-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}
        {people.isError && <p className="p-3 text-sm text-destructive">Couldn't load people.</p>}
        {people.isSuccess && visible.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">No people found.</p>
        )}
        {visible.map((p) => {
          const name = p.full_name || p.username;
          const picked = isPicked(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p)}
              aria-pressed={picked}
              className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar src={p.avatar_url} name={name} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{name}</span>
                <span className="block truncate text-xs text-muted-foreground">@{p.username}</span>
              </span>
              <span
                className={`grid h-6 w-6 place-items-center rounded-full border ${picked ? "border-transparent bg-gradient-brand text-primary-foreground" : "border-border"}`}
              >
                {picked && <Check className="h-4 w-4" aria-hidden="true" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
