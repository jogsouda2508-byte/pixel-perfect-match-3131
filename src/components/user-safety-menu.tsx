import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Flag, VolumeX, Volume2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReportSheet } from "@/components/report-sheet";
import { useAuth } from "@/lib/auth";
import {
  blockUser,
  CONTENT_QUERY_KEYS,
  muteUser,
  unblockUser,
  unmuteUser,
  useMutedIds,
  type ReportTarget,
} from "@/lib/safety";
import { userMessage } from "@/lib/security";

/** Refresh everything that shows other people's content. */
export function useRefreshAfterSafetyChange() {
  const qc = useQueryClient();
  return () => {
    for (const key of CONTENT_QUERY_KEYS) void qc.invalidateQueries({ queryKey: [key] });
  };
}

/**
 * The "..." menu for another person: Mute, Block and Report. It can also report one thing they
 * made (a post, comment or story) when `report` is given. `blocked` shows "Unblock" instead.
 * `z` lets the report sheet open above the full-screen story viewer; `onOpenChange` tells a
 * viewer that something is open (to pause a story).
 */
export function UserSafetyMenu({
  userId,
  username,
  trigger,
  triggerClassName,
  blocked = false,
  report,
  onDone,
  z,
  onOpenChange,
}: {
  userId: string;
  username: string;
  trigger: ReactNode;
  triggerClassName?: string;
  blocked?: boolean;
  /** Also offer to report one thing (shows "Report post" etc.), else "Report @name". */
  report?: { type: ReportTarget; id: string; label: string };
  /** Runs after blocking, e.g. to leave a screen that now has nothing to show. */
  onDone?: (action: "blocked" | "unblocked") => void;
  z?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const refresh = useRefreshAfterSafetyChange();
  const muted = useMutedIds();
  const isMuted = (muted.data ?? []).includes(userId);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const setOpen = (open: boolean) => onOpenChange?.(open);
  const openReport = (open: boolean) => {
    setReportOpen(open);
    setOpen(open);
  };
  const openConfirm = (open: boolean) => {
    setConfirmBlock(open);
    setOpen(open);
  };

  const mute = useMutation({
    mutationFn: () => (isMuted ? unmuteUser(user!.id, userId) : muteUser(user!.id, userId)),
    onSuccess: () => {
      toast.success(
        isMuted
          ? `Unmuted @${username}`
          : `Muted @${username}. You won't see their posts or stories in your feed.`,
      );
      refresh();
    },
    onError: (e) => toast.error(userMessage(e, "Couldn't do that. Please try again.")),
  });

  const block = useMutation({
    mutationFn: () => (blocked ? unblockUser(user!.id, userId) : blockUser(user!.id, userId)),
    onSuccess: () => {
      toast.success(blocked ? `Unblocked @${username}` : `Blocked @${username}`);
      refresh();
      openConfirm(false);
      onDone?.(blocked ? "unblocked" : "blocked");
    },
    onError: (e) => {
      toast.error(userMessage(e, "Couldn't do that. Please try again."));
      openConfirm(false);
    },
  });

  if (!user || user.id === userId) return null;

  const reportTarget = report ?? {
    type: "user" as const,
    id: userId,
    label: `Report @${username}`,
  };

  return (
    <>
      <DropdownMenu onOpenChange={setOpen}>
        <DropdownMenuTrigger aria-label="More options" className={triggerClassName}>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" style={z ? { zIndex: z } : undefined}>
          <DropdownMenuItem onSelect={() => openReport(true)}>
            <Flag className="mr-2 h-4 w-4" aria-hidden="true" />
            {reportTarget.label}
          </DropdownMenuItem>
          {!blocked && (
            <DropdownMenuItem onSelect={() => mute.mutate()} disabled={mute.isPending}>
              {isMuted ? (
                <Volume2 className="mr-2 h-4 w-4" aria-hidden="true" />
              ) : (
                <VolumeX className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {isMuted ? `Unmute @${username}` : `Mute @${username}`}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => (blocked ? block.mutate() : openConfirm(true))}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Ban className="mr-2 h-4 w-4" aria-hidden="true" />
            {blocked ? `Unblock @${username}` : `Block @${username}`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmBlock} onOpenChange={openConfirm}>
        <AlertDialogContent style={z ? { zIndex: z + 5 } : undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Block @{username}?</AlertDialogTitle>
            <AlertDialogDescription>
              They won't be able to see your posts or stories, follow you or message you, and you
              won't see theirs. Any follow between you is removed. They are not told that you
              blocked them. You can unblock them any time in Settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                block.mutate();
              }}
              disabled={block.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Block
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {reportOpen && (
        <ReportSheet
          open
          onOpenChange={openReport}
          targetType={reportTarget.type}
          targetId={reportTarget.id}
          targetUserId={userId}
          {...(z ? { z } : {})}
        />
      )}
    </>
  );
}
