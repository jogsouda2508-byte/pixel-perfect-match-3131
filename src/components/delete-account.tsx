import { useNavigate } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
  DELETE_FAILED_MESSAGE,
  DELETE_WORD,
  WRONG_ACCOUNT_MESSAGE,
  checkGoogleReauth,
  deleteMyAccount,
  hasPasswordLogin,
  isDeleteConfirmed,
  signInMarker,
} from "@/lib/account";

const SIGN_OUT_FAILED_MESSAGE =
  "We couldn't sign you out. Check your internet, close the app and open it again, then retry.";

/** "Delete account" button + confirmation. Used in Settings and on the public /delete-account page. */
export function DeleteAccountButton() {
  const { user, session, profile, signOut, reauthenticateWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const userId = user?.id ?? null;
  const marker = signInMarker(session);

  // Coming back from Google ("confirm it's you"): a new sign-in for the SAME account reopens the
  // dialog so the person can finish; a different account is refused and nothing is deleted.
  useEffect(() => {
    if (!userId) return;
    const status = checkGoogleReauth(userId, session);
    if (status === "confirmed") {
      setText("");
      setPassword("");
      setProblem(null);
      setNotice("Google sign-in confirmed. Type DELETE below to finish.");
      setOpen(true);
    } else if (status === "wrong_account") {
      setText("");
      setPassword("");
      setNotice(null);
      setProblem({ code: "identity_mismatch", message: WRONG_ACCOUNT_MESSAGE });
      setOpen(true);
    }
    // `session` is read only when the user or the sign-in changes, which `marker` captures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, marker]);

  if (!user) return null;

  // Accounts made with an email + password must type it again (checked through the same
  // username log-in the app uses, so it is rate limited). Google-only accounts have no password;
  // they confirm with Google, and the server insists the sign-in is only minutes old.
  const needsPassword = hasPasswordLogin(user);
  // A wrong-account result locks the button: the person is now signed in as someone else, so
  // they must sign out (or close and reopen this dialog on purpose) before anything is deleted.
  const blocked = problem?.code === "identity_mismatch";
  const ready = isDeleteConfirmed(text) && (!needsPassword || password.length > 0) && !blocked;

  const run = async () => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await deleteMyAccount({
        userId: user.id,
        username: profile?.username,
        password: needsPassword ? password : undefined,
      });
    } catch (e) {
      // Show the real reason. AccountDeletionError messages are written for people to read.
      if (e instanceof AccountDeletionError) {
        setProblem({ code: e.code, message: e.message });
      } else {
        console.error("Account deletion failed", e);
        setProblem({ code: "failed", message: DELETE_FAILED_MESSAGE });
      }
      setPassword("");
      setBusy(false);
      return;
    }
    // The account is gone. A failed sign-out must not make it look like it wasn't.
    try {
      await signOut();
    } catch (e) {
      console.error("Sign-out after account deletion failed", e);
    }
    toast.success("Your account was deleted.");
    void navigate({ to: "/welcome", replace: true });
  };

  const confirmWithGoogle = async () => {
    setBusy(true);
    setProblem(null);
    const r = await reauthenticateWithGoogle();
    // On the website the page leaves for Google; we only get here when it could not start.
    if (r.error) setProblem({ code: "failed", message: r.error });
    setBusy(false);
  };

  const signOutToRetry = async () => {
    setBusy(true);
    try {
      await signOut();
    } catch (e) {
      console.error("Sign-out failed", e);
      setProblem({ code: "signout_failed", message: SIGN_OUT_FAILED_MESSAGE });
      setBusy(false);
      return;
    }
    setBusy(false);
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
          setNotice(null);
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
              {profile?.username ? (
                <>
                  Account: <b>@{profile.username}</b>.{" "}
                </>
              ) : null}
              Your profile, posts, stories, comments, messages you sent, followers, listings and
              bookings are removed, and so are your photos, videos and voice notes. Groups you
              created pass to another member. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {notice && (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          )}
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
              {problem.code === "identity_mismatch" && (
                <button
                  type="button"
                  onClick={signOutToRetry}
                  disabled={busy}
                  className="rounded-full border border-destructive px-3 py-1 text-xs font-semibold disabled:opacity-50"
                >
                  Sign out
                </button>
              )}
              {problem.code === "reauth_required" &&
                (needsPassword ? (
                  <button
                    type="button"
                    onClick={signOutToRetry}
                    disabled={busy}
                    className="rounded-full border border-destructive px-3 py-1 text-xs font-semibold disabled:opacity-50"
                  >
                    Sign out and sign in again
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={confirmWithGoogle}
                    disabled={busy}
                    className="rounded-full border border-destructive px-3 py-1 text-xs font-semibold disabled:opacity-50"
                  >
                    Confirm with Google
                  </button>
                ))}
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
