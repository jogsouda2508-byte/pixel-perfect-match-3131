import { Lock, Users } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import type { MemberPreview } from "@/integrations/supabase/types";

/**
 * A group's icon: the first few members' profile photos, overlapping one after another,
 * plus a "+N" chip when there are more. Falls back to a people icon when no members are known.
 */
export function GroupAvatar({
  size = 44,
  members = [],
  total,
}: {
  size?: number;
  members?: MemberPreview[];
  total?: number;
}) {
  const shown = members.slice(0, 3);
  if (shown.length === 0) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-full bg-gradient-brand text-primary-foreground"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <Users style={{ width: size * 0.48, height: size * 0.48 }} />
      </span>
    );
  }
  // One member: show their photo at the full size, like a one-to-one chat avatar.
  if (shown.length === 1 && !(total && total > 1)) {
    const only = shown[0]!;
    return (
      <span className="shrink-0" style={{ width: size, height: size }} aria-hidden="true">
        <Avatar src={only.avatar_url} name={only.name || "Member"} size={size} />
      </span>
    );
  }
  const photo = Math.round(size * 0.78);
  const step = Math.round(photo * 0.62);
  const extra = Math.max(0, (total ?? shown.length) - shown.length);
  const slots = shown.length + (extra > 0 ? 1 : 0);
  const ring = "rounded-full border-2 border-card bg-card";
  return (
    <span
      className="relative shrink-0"
      style={{ width: photo + step * (slots - 1) + 4, height: photo + 4 }}
      aria-hidden="true"
    >
      {shown.map((m, i) => (
        <span
          key={i}
          className={`absolute top-0 ${ring}`}
          style={{ left: i * step, zIndex: 10 - i }}
        >
          <Avatar src={m.avatar_url} name={m.name || "Member"} size={photo} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className={`absolute top-0 grid place-items-center bg-elevated text-[10px] font-bold text-muted-foreground ${ring}`}
          style={{ left: shown.length * step, width: photo + 4, height: photo + 4 }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

export function PrivacyBadge({ isPrivate }: { isPrivate: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      {isPrivate ? <Lock className="h-3 w-3" aria-hidden="true" /> : null}
      {isPrivate ? "Private" : "Public"}
    </span>
  );
}

export function memberLabel(count: number): string {
  return `${count} ${count === 1 ? "member" : "members"}`;
}
