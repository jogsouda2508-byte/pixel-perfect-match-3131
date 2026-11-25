import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Ban,
  Building2,
  ChevronRight,
  Heart,
  MessageCircle,
  Star,
  Tag,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ediraa";
import { CloseFriendsSheet } from "@/components/close-friends-sheet";
import { PageHeader, PageShell } from "@/components/page-shell";
import { SafetyListsSheet } from "@/components/safety-lists-sheet";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/my-profile")({
  head: () => ({
    meta: [
      { title: "My Profile — SabZone" },
      { name: "description", content: "Your close friends, blocked and muted accounts and activity." },
    ],
  }),
  component: MyProfilePage,
});

const rowClass =
  "flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors active:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

function RowContent({
  icon: Icon,
  label,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string | undefined;
}) {
  return (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-xs leading-snug text-muted-foreground">{hint}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </>
  );
}

function Row({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={rowClass}>
      <RowContent icon={Icon} label={label} hint={hint} />
    </button>
  );
}

function LinkRow({
  icon: Icon,
  label,
  hint,
  to,
  tab,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  to: "/my-activity" | "/business";
  tab?: "comments" | "tags" | "likes";
}) {
  const inner = <RowContent icon={Icon} label={label} hint={hint} />;
  return to === "/my-activity" ? (
    <Link to="/my-activity" search={{ tab: tab ?? "comments" }} className={rowClass}>
      {inner}
    </Link>
  ) : (
    <Link to="/business" className={rowClass}>
      {inner}
    </Link>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-4 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground sm:px-1 sm:text-xs">
        {title}
      </h2>
      <div className="glass-card divide-y divide-border overflow-hidden max-sm:-mx-4 max-sm:rounded-3xl">
        {children}
      </div>
    </section>
  );
}

function MyProfilePage() {
  const { profile } = useAuth();
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [safety, setSafety] = useState<"blocked" | "muted" | null>(null);
  const name = profile?.full_name || profile?.username || "";

  return (
    <PageShell rowGap="space-y-4 sm:space-y-4">
      <PageHeader title="My Profile" compact />
      <Link
        to="/profile"
        className="glass-card more-profile-card flex items-center gap-3 p-4 transition-colors active:bg-foreground/5"
      >
        <Avatar src={profile?.avatar_url} name={name} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{name}</p>
          <p className="truncate text-sm text-muted-foreground">View your profile</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </Link>

      <Group title="Who can see your content">
        <Row
          icon={Star}
          label="Close Friends"
          hint="Choose who sees your Close Friends stories"
          onClick={() => setFriendsOpen(true)}
        />
        <Row
          icon={Ban}
          label="Blocked"
          hint="People you blocked"
          onClick={() => setSafety("blocked")}
        />
      </Group>

      <Group title="What you see">
        <Row
          icon={VolumeX}
          label="Muted"
          hint="People whose posts you muted"
          onClick={() => setSafety("muted")}
        />
      </Group>

      <Group title="Your activity">
        <LinkRow
          icon={MessageCircle}
          label="Comments"
          hint="Comments you wrote"
          to="/my-activity"
          tab="comments"
        />
        <LinkRow
          icon={Tag}
          label="Tags"
          hint="Posts you are tagged in"
          to="/my-activity"
          tab="tags"
        />
        <LinkRow
          icon={Heart}
          label="Likes"
          hint="Posts you liked"
          to="/my-activity"
          tab="likes"
        />
      </Group>

      <Group title="Profiles">
        <LinkRow
          icon={Building2}
          label="Add profile"
          hint="Create a Business Page"
          to="/business"
        />
      </Group>

      {friendsOpen && profile && (
        <CloseFriendsSheet open onOpenChange={setFriendsOpen} meId={profile.id} />
      )}
      {safety && (
        <SafetyListsSheet
          open
          initial={safety}
          single
          onOpenChange={(open) => {
            if (!open) setSafety(null);
          }}
        />
      )}
    </PageShell>
  );
}
