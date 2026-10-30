import type { ReactNode } from "react";
import { Drawer as DrawerPrimitive } from "vaul";

/**
 * A sheet that slides up from the bottom of the screen (on phones and on desktop). The title
 * stays at the top and the action buttons (`footer`) stay pinned at the bottom while the middle
 * scrolls. Drag down, tap outside or press Escape to close. `z` lets it sit above the full-screen
 * story viewer.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  z = 60,
  compact = false,
  focusOnOpen = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
  z?: number;
  /** Smaller sheet and text on phones (desktop looks the same). */
  compact?: boolean;
  /** Set false so opening the sheet does not focus the first field (and pop up the keyboard). */
  focusOnOpen?: boolean;
}) {
  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay
          className="fixed inset-0 bg-black/60 backdrop-blur-[2px]"
          style={{ zIndex: z }}
        />
        <DrawerPrimitive.Content
          className={`fixed inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-[28px] ${compact ? "max-md:rounded-t-[20px]" : ""} border border-b-0 border-border bg-background text-foreground shadow-2xl outline-none`}
          style={{ zIndex: z + 1 }}
          {...(focusOnOpen ? {} : { onOpenAutoFocus: (e: Event) => e.preventDefault() })}
        >
          <div className={`mx-auto mt-3 h-1.5 w-11 shrink-0 rounded-full bg-muted-foreground/30 ${compact ? "max-md:mt-2 max-md:h-1 max-md:w-9" : ""}`} />
          <div className={`shrink-0 px-5 pb-2 pt-4 ${compact ? "max-md:px-4 max-md:pb-1 max-md:pt-2.5" : ""}`}>
            <DrawerPrimitive.Title className={`text-lg font-bold tracking-tight ${compact ? "max-md:text-base" : ""}`}>
              {title}
            </DrawerPrimitive.Title>
            <DrawerPrimitive.Description className={`mt-0.5 text-sm text-muted-foreground ${compact ? "max-md:text-xs" : ""}`}>
              {description}
            </DrawerPrimitive.Description>
          </div>
          <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-2 ${compact ? "max-md:px-4 max-md:pb-2 max-md:pt-1" : ""}`}>
            {children}
          </div>
          <div className={`flex shrink-0 gap-3 border-t border-border bg-background px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)] ${compact ? "max-md:gap-2 max-md:px-4 max-md:pt-2 max-md:pb-[max(env(safe-area-inset-bottom),0.75rem)]" : ""}`}>
            {footer}
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
