import { Lock, Users } from "lucide-react";

/** Round gradient badge used wherever a group has no photo. */
export function GroupAvatar({ size = 44 }: { size?: number }) {
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
