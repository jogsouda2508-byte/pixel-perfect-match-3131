import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Check, Loader2, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { Avatar } from "@/components/ediraa";
import { AuthShell, PrimaryButton, inputClass } from "@/components/auth-ui";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Set up your profile — Ediraa" }] }),
  component: OnboardingPage,
});

const INTERESTS = [
  "Startups",
  "Tech",
  "Business",
  "Travel",
  "Food",
  "Fitness",
  "Music",
  "Art",
  "Sports",
  "Education",
];
const STEPS = ["Your profile", "Your interests", "People to follow"] as const;
const MAX_FILE = 5 * 1024 * 1024;
const BIO_MAX = 160;

function OnboardingPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // step 1
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [location, setLocation] = useState(profile?.location ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  // Skipping a step means "don't save what's on it".
  const skipped = useRef({ profile: false, interests: false });

  // step 2
  const [interests, setInterests] = useState<string[]>(profile?.interests ?? []);

  // step 3
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  // Load suggestions + who I already follow when reaching step 3.
  useEffect(() => {
    if (step !== 2 || !user || people) return;
    let active = true;
    (async () => {
      const [{ data: list, error }, { data: mine }] = await Promise.all([
        supabase
          .from("profiles")
          .select("*")
          .neq("id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("follows").select("following_id").eq("follower_id", user.id),
      ]);
      if (!active) return;
      if (error) toast.error("Couldn't load suggestions.");
      setPeople(list ?? []);
      setFollowing(new Set((mine ?? []).map((r) => r.following_id)));
    })();
    return () => {
      active = false;
    };
  }, [step, user, people]);

  if (!user) return null;

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type))
      return setFileError("Please choose a JPG, PNG, WebP or GIF image.");
    if (f.size > MAX_FILE) return setFileError("Image must be 5 MB or smaller.");
    setFileError(undefined);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const uploadAvatar = async (): Promise<string | null> => {
    if (!file) return avatarUrl;
    const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
    const path = `${user.id}/avatar.${ext}`; // folder name must equal the user's id (storage policy)
    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`; // cache-bust when the photo is replaced
  };

  const toggleFollow = async (id: string) => {
    if (pending.has(id)) return;
    const isFollowing = following.has(id);
    setPending((p) => new Set(p).add(id));
    const { error } = isFollowing
      ? await supabase.from("follows").delete().eq("follower_id", user.id).eq("following_id", id)
      : await supabase.from("follows").insert({ follower_id: user.id, following_id: id });
    setPending((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
    if (error) {
      toast.error("Couldn't update. Please try again.");
      return;
    }
    setFollowing((f) => {
      const n = new Set(f);
      if (isFollowing) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const finish = async () => {
    const saveStepOne = !skipped.current.profile;
    setBusy(true);
    try {
      let url = avatarUrl;
      if (saveStepOne) url = await uploadAvatar();
      const { data, error } = await supabase
        .from("profiles")
        .update({
          bio: saveStepOne ? bio.trim() || null : (profile?.bio ?? null),
          location: saveStepOne ? location.trim() || null : (profile?.location ?? null),
          avatar_url: url,
          interests: skipped.current.interests ? (profile?.interests ?? []) : interests,
          onboarding_completed: true,
        })
        .eq("id", user.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw new Error("Your profile could not be found. Please log out and sign in again.");
      await refreshProfile();
      toast.success("You're all set!");
      navigate({ to: "/home" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save your profile. Please try again.");
      setBusy(false);
    }
  };

  const next = async () => {
    if (step === 0 && file) {
      // Upload now so a failure shows up on this step, not at the very end.
      setBusy(true);
      try {
        setAvatarUrl(await uploadAvatar());
        setFile(null);
      } catch (e) {
        setBusy(false);
        {
          toast.error(e instanceof Error ? e.message : "Photo upload failed.");
          return;
        }
      }
      setBusy(false);
    }
    if (step < 2) setStep(step + 1);
    else await finish();
  };

  const skip = async () => {
    if (step === 0) skipped.current.profile = true;
    if (step === 1) skipped.current.interests = true;
    if (step < 2) setStep(step + 1);
    else await finish();
  };

  const toggleInterest = (i: string) =>
    setInterests((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));
  const shownAvatar = preview ?? avatarUrl;

  return (
    <AuthShell title={STEPS[step]!} subtitle={`Step ${step + 1} of 3`}>
      <div
        className="mb-5 h-1.5 overflow-hidden rounded-full bg-elevated"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={step + 1}
      >
        <div
          className="h-full rounded-full bg-gradient-brand transition-all"
          style={{ width: `${((step + 1) / 3) * 100}%` }}
        />
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative"
              aria-label="Upload profile photo"
            >
              <Avatar src={shownAvatar} name={profile?.full_name ?? ""} size={96} ring />
              <span className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground">
                <Camera className="h-4 w-4" />
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <p className="text-xs text-muted-foreground">Tap to add a profile photo (max 5 MB)</p>
            {fileError && (
              <p role="alert" className="text-xs text-destructive">
                {fileError}
              </p>
            )}
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
              className={`${inputClass} resize-none border-border`}
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {bio.length}/{BIO_MAX}
            </p>
          </div>
          <div>
            <label htmlFor="loc" className="mb-1.5 block text-sm font-medium">
              Location
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="loc"
                maxLength={60}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Bangalore, India"
                className={`${inputClass} border-border pl-10`}
              />
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <p className="mb-3 text-sm text-muted-foreground">
            Pick a few topics to personalise your feed.
          </p>
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map((i) => {
              const on = interests.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleInterest(i)}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition ${on ? "bg-gradient-brand text-primary-foreground glow" : "border border-border bg-card"}`}
                >
                  {on && <Check className="h-3.5 w-3.5" />}
                  {i}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          {people === null ? (
            <div className="grid place-items-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : people.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No one else has joined yet. You're one of the first! 🎉
            </p>
          ) : (
            <ul className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {people.map((p) => {
                const on = following.has(p.id);
                return (
                  <li key={p.id} className="flex items-center gap-3">
                    <Avatar src={p.avatar_url} name={p.full_name || p.username} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.full_name || p.username}</p>
                      <p className="truncate text-xs text-muted-foreground">@{p.username}</p>
                    </div>
                    <button
                      type="button"
                      disabled={pending.has(p.id)}
                      onClick={() => toggleFollow(p.id)}
                      className={`shrink-0 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-60 ${on ? "bg-gradient-brand text-primary-foreground" : "border border-primary text-primary"}`}
                    >
                      {on ? "Following" : "Follow"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={skip}
          disabled={busy}
          className="rounded-full px-5 py-3.5 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          Skip
        </button>
        <div className="flex-1">
          <PrimaryButton type="button" onClick={next} loading={busy}>
            {step < 2 ? "Next" : "Finish"}
          </PrimaryButton>
        </div>
      </div>
    </AuthShell>
  );
}
