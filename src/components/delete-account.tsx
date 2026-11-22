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
import {
  AccountDeletionError,
  DELETE_WORD,
  deleteMyAccount,
  hasPasswordLogin,
  isDeleteConfirmed,
} from "@/lib/account";

/** "Delete account" button + confirmation. Used in Settings and on the public /delete-account page. */
export function DeleteAccountButton() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  // Accounts made with an email + password must type it again. Google-only accounts have no
  // password; the server instead insists they signed in a few minutes ago.
  const needsPassword = hasPasswordLogin(user);
  const ready = isDeleteConfirmed(text) && (!needsPassword || password.length > 0);

  const run = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await deleteMyAccount({
        userId: user.id,
        email: user.email,
        password: needsPassword ? password : undefined,
      });
      try {
        await signOut();
      } catch {
        /* the login is already gone, so a failed sign-out changes nothing */
      }
      toast.success("Your account was deleted.");
      void navigate({ to: "/welcome", replace: true });
    } catch (e) {
      const message = "Couldn't delete your account.";
      setPassword("");
      setProblem({ code: e instanceof AccountDeletionError ? e.code : "failed", message });
      setBusy(false);
    }
  };

  const signOutToRetry = async () => {
    try {
      await signOut();
    } catch {
      /* signing in again is all that matters */
    }
    void navigate({ to: "/login", replace: true });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setText("");
          setPassword("");
          setProblem(null);
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
              bookings are removed, and so are your photos, videos and voice notes. Groups you
              created pass to another member. This cannot be undone.
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
          {needsPassword && (
            <label className="block text-sm">
              Enter your password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-2 w-full rounded-[14px] border border-border bg-elevated/40 px-4 py-3 text-sm outline-none focus:border-destructive"
              />
            </label>
          )}
          {problem && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{problem.message}</p>
              {problem.code === "reauth_required" && (
                <button
                  type="button"
                  onClick={signOutToRetry}
                  className="rounded-full border border-destructive px-3 py-1 text-xs font-semibold"
                >
                  Sign out and sign in again
                </button>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep my account</AlertDialogCancel>
            <button
              type="button"
              onClick={run}
              disabled={busy || !ready}
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
