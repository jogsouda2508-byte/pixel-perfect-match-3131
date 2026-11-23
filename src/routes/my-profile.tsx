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
  "flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

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
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
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
  const inner = (
    <>
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </>
  );
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
    <section className="space-y-1.5">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="glass-card divide-y divide-border">{children}</div>
    </section>
  );
}

function MyProfilePage() {
  const { profile } = useAuth();
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [safety, setSafety] = useState<"blocked" | "muted" | null>(null);
  const name = profile?.full_name || profile?.username || "";

  return (
    <PageShell>
      <PageHeader title="My Profile" />
      <Link to="/profile" className="glass-card flex items-center gap-3 p-4">
        <Avatar src={profile?.avatar_url} name={name} size={48} />
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
          onOpenChange={(open) => {
            if (!open) setSafety(null);
          }}
        />
      )}
    </PageShell>
  );
}
