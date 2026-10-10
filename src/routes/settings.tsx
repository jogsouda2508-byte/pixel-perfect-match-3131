import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, ChevronRight, Loader2, MapPin } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import { PageHeader, PageShell } from "@/components/page-shell";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { friendlyAuthError } from "@/lib/auth-errors";
import { updateMyProfile, uploadAvatar } from "@/lib/social";
import { passwordSchema, passwordStrength } from "@/lib/validation";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings & Privacy — Ediraa" },
      { name: "description", content: "Edit your profile and manage your Ediraa account." },
    ],
  }),
  component: SettingsPage,
});

const BIO_MAX = 160;
const MAX_FILE = 5 * 1024 * 1024;
const field =
  "w-full rounded-[14px] border border-border bg-elevated/40 px-4 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary";

function SettingsPage() {
  const { profile } = useAuth();
  return (
    <PageShell>
      <PageHeader title="Settings & Privacy" />
      {profile && (
        <>
          <EditProfileCard profile={profile} />
          <AccountCard profile={profile} />
          <PasswordCard />
          <LogoutButton />
        </>
      )}
    </PageShell>
  );
}

function EditProfileCard({ profile }: { profile: Profile }) {
  const { refreshProfile } = useAuth();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState(profile.full_name);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [location, setLocation] = useState(profile.location ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type))
      return setError("Please choose a JPG, PNG, WebP or GIF image.");
    if (f.size > MAX_FILE) return setError("Image must be 5 MB or smaller.");
    setError(undefined);
    setFile(f);
  };

  const changed =
    !!file ||
    fullName.trim() !== profile.full_name ||
    (bio.trim() || null) !== (profile.bio ?? null) ||
    (location.trim() || null) !== (profile.location ?? null);

  const save = async () => {
    const name = fullName.trim();
    if (name.length < 2) return setError("Enter your full name.");
    setError(undefined);
    setBusy(true);
    try {
      const avatar_url = file ? await uploadAvatar(profile.id, file) : profile.avatar_url;
      await updateMyProfile(profile.id, {
        full_name: name,
        bio: bio.trim() || null,
        location: location.trim() || null,
        avatar_url,
      });
      await refreshProfile();
      setFile(null);
      // Names, photos and locations show up in the feed, people lists and profile pages.
      void qc.invalidateQueries({ queryKey: ["feed"] });
      void qc.invalidateQueries({ queryKey: ["people"] });
      void qc.invalidateQueries({ queryKey: ["profile"] });
      void qc.invalidateQueries({ queryKey: ["stories"] });
      toast.success("Profile updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save your profile. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass-card space-y-4 p-4">
      <h2 className="font-semibold">Edit profile</h2>
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative"
          aria-label="Change profile photo"
        >
          <Avatar
            src={preview ?? profile.avatar_url}
            name={fullName || profile.username}
            size={88}
            ring
          />
          <span className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground">
            <Camera className="h-4 w-4" />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          hidden
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <p className="text-xs text-muted-foreground">Tap to change your photo (max 5 MB)</p>
      </div>
      {error && (
        <p role="alert" className="text-center text-xs text-destructive">
          {error}
        </p>
      )}
      <div>
        <label htmlFor="full-name" className="mb-1.5 block text-sm font-medium">
          Full name
        </label>
        <input
          id="full-name"
          maxLength={50}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="bio" className="mb-1.5 block text-sm font-medium">
          Bio
        </label>
        <textarea
          id="bio"
          rows={3}
          maxLength={BIO_MAX}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Tell people about yourself"
          className={`${field} resize-none`}
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {bio.length}/{BIO_MAX}
        </p>
      </div>
      <div>
        <label htmlFor="location" className="mb-1.5 block text-sm font-medium">
          Location
        </label>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="location"
            maxLength={60}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Bangalore, India"
            className={`${field} pl-10`}
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Used for the Local feed and Local Community posts.
        </p>
      </div>
      <button
        type="button"
        onClick={save}
        disabled={!changed || busy}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-brand py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}Save changes
      </button>
    </section>
  );
}

function AccountCard({ profile }: { profile: Profile }) {
  const { user } = useAuth();
  return (
    <section className="glass-card divide-y divide-border">
      <div className="px-4 py-3.5">
        <p className="text-xs text-muted-foreground">Username</p>
        <p className="text-sm font-medium">@{profile.username}</p>
      </div>
      <div className="px-4 py-3.5">
        <p className="text-xs text-muted-foreground">Email</p>
        <p className="break-all text-sm font-medium">{user?.email || "Not set"}</p>
      </div>
      <Link to="/business" className="flex items-center gap-3 px-4 py-3.5 text-sm">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Account type</p>
          <p className="font-medium capitalize">{profile.account_type}</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </Link>
    </section>
  );
}

function PasswordCard() {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(pw);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(pw);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid password");
    if (pw !== confirm) return setError("Passwords do not match");
    setError(undefined);
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(friendlyAuthError(err));
    setPw("");
    setConfirm("");
    toast.success("Password updated");
  };

  return (
    <form onSubmit={submit} className="glass-card space-y-3 p-4">
      <h2 className="font-semibold">Change password</h2>
      <input
        type="password"
        autoComplete="new-password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="New password"
        aria-label="New password"
        className={field}
      />
      {pw && <p className="text-xs text-muted-foreground">Strength: {strength.label}</p>}
      <input
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm new password"
        aria-label="Confirm new password"
        className={field}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!pw || !confirm || busy}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-primary py-3 text-sm font-semibold text-primary disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}Update password
      </button>
    </form>
  );
}

function LogoutButton() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    setBusy(true);
    try {
      await signOut();
      navigate({ to: "/login", replace: true });
    } catch {
      setBusy(false);
      toast.error("Couldn't log out. Please try again.");
    }
  };
  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-full border border-destructive py-3.5 font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}Log Out
    </button>
  );
}
