import type { NotificationRow } from "@/integrations/supabase/types";

export const NOTIFICATION_TABS = ["All", "Likes", "Comments", "Follows", "Tags"] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];

type Kind = NotificationRow["kind"];

const TAB_KINDS: Record<NotificationTab, readonly Kind[] | null> = {
  All: null,
  // Story likes sit with post likes.
  Likes: ["like", "story_like"],
  Comments: ["comment"],
  // New followers, follow requests waiting for me, and requests of mine that were accepted.
  Follows: ["follow", "follow_request", "follow_accepted"],
  Tags: ["tag"],
};

/** Whether a notification of `kind` belongs on `tab`. "All" shows everything. */
export function notificationMatchesTab(kind: Kind, tab: NotificationTab): boolean {
  const kinds = TAB_KINDS[tab];
  return kinds === null || kinds.includes(kind);
}
