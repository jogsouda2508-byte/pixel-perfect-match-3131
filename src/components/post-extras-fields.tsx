import { useState, type ReactNode } from "react";
import { BarChart3, Hash, MapPin, Users, X } from "lucide-react";
import { LocationPickerModal } from "@/components/location-picker";
import { PollSheet } from "@/components/poll-card";
import type { PollDraft } from "@/lib/polls";
import { TagPeoplePickerModal } from "@/components/tag-people-picker";
import { placeSubtitle, type PlaceSelection } from "@/lib/places";
import type { Audience, TaggedPerson } from "@/integrations/supabase/types";

/** What a person has chosen to attach to a post besides its text and media. */
export type PostExtrasValue = {
  location: PlaceSelection | null;
  tagged: TaggedPerson[];
  /** An optional 2-option poll, created together with the post. */
  poll?: PollDraft | null | undefined;
};

export const EMPTY_EXTRAS: PostExtrasValue = { location: null, tagged: [] };

/** "@sam", "@sam and 1 more", "@sam and 3 more" */
export function taggedSummary(people: TaggedPerson[]): string {
  const first = people[0];
  if (!first) return "";
  const rest = people.length - 1;
  return rest > 0 ? `@${first.username} and ${rest} more` : `@${first.username}`;
}

const tileBase =
  "group relative flex min-h-14 items-center gap-2 rounded-2xl border text-sm transition-colors focus-within:ring-2 focus-within:ring-ring";
const tileEmpty = "border-border bg-card/60 hover:border-primary/40 hover:bg-primary/5";
const tileFilled = "border-primary/30 bg-primary/10 shadow-sm";
const mainButton =
  "flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 text-left focus-visible:outline-none";

/** Tiny avatar for the stacked "who is tagged" preview. */
function MiniAvatar({ person }: { person: TaggedPerson }) {
  const initial = (person.full_name || person.username).trim().slice(0, 1).toUpperCase() || "?";
  return person.avatar_url ? (
    <img
      src={person.avatar_url}
      alt=""
      className="h-7 w-7 rounded-full border-2 border-background object-cover"
    />
  ) : (
    <span
      aria-hidden="true"
      className="grid h-7 w-7 place-items-center rounded-full border-2 border-background bg-gradient-brand text-xs font-semibold text-primary-foreground"
    >
      {initial}
    </span>
  );
}

function IconBubble({ children, filled }: { children: ReactNode; filled: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${filled ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}
    >
      {children}
    </span>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/**
 * The Location, Tag People and Hashtag controls for a post. Used by both the Create Post page and
 * the photo/video "Details" step so they look and behave the same: two tiles on the first row,
 * hashtag underneath. A chosen location/tag turns its tile violet and shows what was picked, with
 * a small X to remove it; tapping the tile edits it.
 */
export function PostExtrasFields({
  value,
  onChange,
  audience,
  hashtags,
  onAddHashtag,
}: {
  value: PostExtrasValue;
  onChange: (next: PostExtrasValue) => void;
  audience: Audience;
  /** Hashtags found in the caption, shown as chips under the Hashtag tile. */
  hashtags: string[];
  /** Inserts a "#" into the caption (the caller owns the text). */
  onAddHashtag: () => void;
}) {
  const [locationOpen, setLocationOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const { location, tagged, poll } = value;
  const stack = tagged.slice(0, 3);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {/* Location */}
        <div className={`${tileBase} ${location ? tileFilled : tileEmpty}`}>
          <button
            type="button"
            onClick={() => setLocationOpen(true)}
            aria-label={location ? `Change location: ${location.name}` : "Add location"}
            className={mainButton}
          >
            <IconBubble filled={!!location}>
              <MapPin className="h-4 w-4" />
            </IconBubble>
            {location ? (
              <span className="min-w-0">
                <span className="block truncate font-semibold">{location.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {location.city ?? placeSubtitle(location)}
                </span>
              </span>
            ) : (
              <span className="font-medium">Location</span>
            )}
          </button>
          {location && (
            <RemoveButton
              label="Remove location"
              onClick={() => onChange({ ...value, location: null })}
            />
          )}
        </div>

        {/* Tag people */}
        <div className={`${tileBase} ${tagged.length > 0 ? tileFilled : tileEmpty}`}>
          <button
            type="button"
            onClick={() => setPeopleOpen(true)}
            aria-label={tagged.length > 0 ? "Edit tagged people" : "Tag people"}
            className={mainButton}
          >
            {tagged.length > 0 ? (
              <span className="flex shrink-0 -space-x-2" aria-hidden="true">
                {stack.map((person) => (
                  <MiniAvatar key={person.id} person={person} />
                ))}
              </span>
            ) : (
              <IconBubble filled={false}>
                <Users className="h-4 w-4" />
              </IconBubble>
            )}
            {tagged.length > 0 ? (
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {tagged.length} {tagged.length === 1 ? "person" : "people"} tagged
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {taggedSummary(tagged)}
                </span>
              </span>
            ) : (
              <span className="font-medium">Tag People</span>
            )}
          </button>
          {tagged.length > 0 && (
            <RemoveButton
              label="Remove all tags"
              onClick={() => onChange({ ...value, tagged: [] })}
            />
          )}
        </div>
      </div>

      {/* Hashtag */}
      <div
        className={`rounded-2xl border ${hashtags.length > 0 ? "border-primary/30 bg-primary/10" : "border-border bg-card/60"}`}
      >
        <button
          type="button"
          onClick={onAddHashtag}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-medium hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Hash className="h-4 w-4 text-primary" aria-hidden="true" />
          Add Hashtag
        </button>
        {hashtags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 px-3 pb-3" aria-label="Hashtags in your caption">
            {hashtags.map((tag) => (
              <li
                key={tag}
                className="rounded-full bg-background px-2.5 py-1 text-xs font-semibold text-primary shadow-sm"
              >
                #{tag}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Poll */}
      <div className={`${tileBase} ${poll ? tileFilled : tileEmpty}`}>
        <button
          type="button"
          onClick={() => setPollOpen(true)}
          aria-label={poll ? `Edit poll: ${poll.question}` : "Add poll"}
          className={mainButton}
        >
          <IconBubble filled={!!poll}>
            <BarChart3 className="h-4 w-4" />
          </IconBubble>
          {poll ? (
            <span className="min-w-0">
              <span className="block truncate font-semibold">{poll.question}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {poll.options[0]} · {poll.options[1]}
              </span>
            </span>
          ) : (
            <span className="font-medium">Add Poll</span>
          )}
        </button>
        {poll && (
          <RemoveButton label="Remove poll" onClick={() => onChange({ ...value, poll: null })} />
        )}
      </div>
      <PollSheet
        open={pollOpen}
        onOpenChange={setPollOpen}
        initial={poll}
        submitLabel={poll ? "Save poll" : "Add poll"}
        onSubmit={(draft) => onChange({ ...value, poll: draft })}
      />

      <LocationPickerModal
        open={locationOpen}
        onOpenChange={setLocationOpen}
        value={location}
        onConfirm={(place) => onChange({ ...value, location: place })}
      />
      <TagPeoplePickerModal
        open={peopleOpen}
        onOpenChange={setPeopleOpen}
        value={tagged}
        audience={audience}
        onDone={(people) => onChange({ ...value, tagged: people })}
      />
    </div>
  );
}
