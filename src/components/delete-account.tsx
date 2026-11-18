import { useNavigate } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { DELETE_WORD, deleteMyAccount, isDeleteConfirmed } from "@/lib/account";

/** "Delete account" button + confirmation. Used in Settings and on the public /delete-account page. */
export function DeleteAccountButton() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const run = async () => {
    setBusy(true);
    try {
      await deleteMyAccount(user.id);
      try {
        await signOut();
      } catch {
        /* the login is already gone, so a failed sign-out changes nothing */
      }
      toast.success("Your account was deleted.");
      void navigate({ to: "/welcome", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete your account.");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setText("");
          setOpen(true);
        }}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-destructive py-3 text-sm font-semibold text-destructive transition hover:bg-destructive/10"
      >
        <Trash2 className="h-4 w-4" />
        Delete my account
      </button>
      <AlertDialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account for good?</AlertDialogTitle>
            <AlertDialogDescription>
              Your profile, posts, stories, comments, messages you sent, followers, listings and
              bookings are removed, and so are your photos, videos and voice notes. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="block text-sm">
            Type <b>{DELETE_WORD}</b> to confirm
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              className="mt-2 w-full rounded-[14px] border border-border bg-elevated/40 px-4 py-3 text-sm outline-none focus:border-destructive"
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep my account</AlertDialogCancel>
            <button
              type="button"
              onClick={run}
              disabled={busy || !isDeleteConfirmed(text)}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete forever
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function DeleteAccountCard() {
  return (
    <section className="glass-card space-y-3 p-4">
      <h2 className="font-semibold">Delete account</h2>
      <p className="text-sm text-muted-foreground">
        Permanently remove your account and everything you shared. This cannot be undone.
      </p>
      <DeleteAccountButton />
    </section>
  );
}
