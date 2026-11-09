import { MessageCircle } from "lucide-react";
import { whatsappShareHref } from "@/lib/community-share";
import { PUBLIC_URL } from "@/lib/public-url";
import { cn } from "@/lib/utils";

/** The Community tabs that can be linked to; /community?tab=… opens that tab. */
export type ShareTab = "events" | "alerts" | "polls" | "ask";

/** Always the public address, never localhost, so a shared link works for the person who gets it. */
export const communityLink = (tab: ShareTab): string => `${PUBLIC_URL}/community?tab=${tab}`;

/**
 * "Share on WhatsApp" button. It is a plain link (like the WhatsApp button on business pages), so
 * it works in the browser and in the Android app, and no popup blocker can stop it.
 */
export function WhatsAppShare({
  text,
  label = "Share on WhatsApp",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={whatsappShareHref(text)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-success px-4 text-sm font-semibold text-success transition active:scale-95",
        className,
      )}
    >
      <MessageCircle className="h-4 w-4" aria-hidden="true" />
      {label}
    </a>
  );
}
