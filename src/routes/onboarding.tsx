import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Check, Globe, Loader2, Lock, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { Avatar } from "@/components/ediraa";
import { AvatarCropper } from "@/components/avatar-cropper";
import { uploadAvatar as uploadAvatarFile } from "@/lib/social";
import { AuthShell, PrimaryButton, inputClass } from "@/components/auth-ui";
import { userMessage } from "@/lib/security";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Set up your profile — SabZone" }] }),
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
// The photo is cropped and shrunk to a small JPEG before upload, so a big camera photo is fine.
const MAX_FILE = 15 * 1024 * 1024;
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
  const [cropping, setCropping] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>();
  // Account privacy. Public is the default; this is saved even if step 1 is skipped.
  const [isPrivate, setIsPrivate] = useState(profile?.is_private ?? false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Skipping a step means "don't save what's on it".
  const skipped = useRef({ profile: false, interests: false });

  // step 2
  const [interests, setInterests] = useState<string[]>(profile?.interests ?? []);

  // step 3
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  // Private accounts I have asked to follow (waiting for them to accept).
  const [requested, setRequested] = useState<Set<string>>(new Set());
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
      const [{ data: list, error }, { data: mine }, { data: asked }] = await Promise.all([
        supabase
          .from("profiles")
          .select("*")
          .neq("id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("follows").select("following_id").eq("follower_id", user.id),
        supabase
          .from("follow_requests")
          .select("target_id")
          .eq("requester_id", user.id)
          .eq("status", "pending"),
      ]);
      if (!active) return;
      if (error) toast.error("Couldn't load suggestions.");
      setPeople(list ?? []);
      setFollowing(new Set((mine ?? []).map((r) => r.following_id)));
      setRequested(new Set((asked ?? []).map((r) => r.target_id)));
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
    if (f.size > MAX_FILE) return setFileError("Image must be 15 MB or smaller.");
    setFileError(undefined);
    setCropping(f); // move and zoom first; the cropped photo becomes `file`
  };

  const useCropped = (cropped: File) => {
    setFile(cropped);
    if (preview) URL.revokeObjectURL(preview); // don't leak the previous crop's blob
    setPreview(URL.createObjectURL(cropped));
    setCropping(null);
  };

  const uploadAvatar = async (): Promise<string | null> => {
    if (!file) return avatarUrl;
    return uploadAvatarFile(user.id, file);
  };

  const toggleFollow = async (id: string) => {
    if (pending.has(id)) return;
    const isFollowing = following.has(id);
    const isRequested = requested.has(id);
    setPending((p) => new Set(p).add(id));
    // Following a public account is instant; a private account turns it into a request.
    const { data, error } = isFollowing
      ? await supabase.from("follows").delete().eq("follower_id", user.id).eq("following_id", id)
      : isRequested
        ? await supabase.rpc("cancel_follow_request", { p_target: id })
        : await supabase.rpc("send_follow_request", { p_target: id });
    setPending((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
    if (error) {
      toast.error("Couldn't update. Please try again.");
      return;
    }
    if (isFollowing) {
      setFollowing((f) => new Set([...f].filter((x) => x !== id)));
    } else if (isRequested) {
      setRequested((r) => new Set([...r].filter((x) => x !== id)));
    } else if (data === "requested") {
      setRequested((r) => new Set(r).add(id));
      toast.success("Follow request sent");
    } else {
      setFollowing((f) => new Set(f).add(id));
    }
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
          is_private: isPrivate,
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
      toast.error(userMessage(e, "Couldn't save your profile. Please try again."));
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
          toast.error(userMessage(e, "Photo upload failed."));
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
    <AuthShell variant="immersive" title={STEPS[step]!} subtitle={`Step ${step + 1} of 3`}>
      {cropping && (
        <AvatarCropper file={cropping} onCancel={() => setCropping(null)} onDone={useCropped} />
      )}
      <div
        className="mb-5 h-1.5 overflow-hidden rounded-full bg-violet-400/15"
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
              <Avatar src={shownAvatar} name={profile?.full_name ?? ""} size={96} />
              <span className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full bg-violet-500 text-white ring-2 ring-[#0a0618]">
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
            <p className="text-xs text-muted-foreground">Tap to add a profile photo</p>
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
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium">Who can see your posts?</legend>
            <div className="grid gap-2">
              {(
                [
                  {
                    value: false,
                    icon: Globe,
                    title: "Public account",
                    text: "Anyone on SabZone can see your posts and follow you right away.",
                  },
                  {
                    value: true,
                    icon: Lock,
                    title: "Private account",
                    text: "Only people you approve can see your posts and stories. Others must send a follow request.",
                  },
                ] as const
              ).map(({ value, icon: Icon, title, text }) => {
                const on = isPrivate === value;
                return (
                  <button
                    key={title}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setIsPrivate(value)}
                    className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 ${on ? "border-violet-400/70 bg-violet-500/15 shadow-[0_0_18px_-6px_rgba(139,92,246,0.6)]" : "border-violet-400/20 bg-white/[0.03] hover:border-violet-400/40"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${on ? "bg-violet-500 text-white" : "bg-violet-500/15 text-violet-300"}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.82rem] font-semibold leading-tight">{title}</span>
                      <span className="mt-0.5 block text-[0.7rem] leading-snug text-violet-100/60">{text}</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${on ? "border-violet-400 bg-violet-400" : "border-violet-300/40"}`}
                    />
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[0.7rem] text-violet-100/50">
              You can change this any time in Settings &amp; Privacy.
            </p>
          </fieldset>
        </div>
      )}

      {step === 1 && (
        <div>
          <p className="mb-3 text-sm text-violet-100/65">
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
                  className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition ${on ? "bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-[0_0_16px_-4px_rgba(139,92,246,0.8)]" : "border border-violet-400/25 bg-white/[0.04] text-violet-50"}`}
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
              <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
            </div>
          ) : people.length === 0 ? (
            <p className="py-6 text-center text-sm text-violet-100/65">
              No one else has joined yet. You're one of the first! 🎉
            </p>
          ) : (
            <ul className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {people.map((p) => {
                const on = following.has(p.id);
                const asked = requested.has(p.id);
                return (
                  <li key={p.id} className="flex items-center gap-3">
                    <Avatar src={p.avatar_url} name={p.full_name || p.username} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.full_name || p.username}</p>
                      <p className="truncate text-xs text-violet-100/55">
                        @{p.username}
                        {p.is_private ? " · Private" : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={pending.has(p.id)}
                      onClick={() => toggleFollow(p.id)}
                      className={`shrink-0 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-60 ${on ? "bg-gradient-to-r from-violet-500 to-purple-500 text-white" : asked ? "bg-white/10 text-violet-100/60" : "border border-violet-400 text-violet-300"}`}
                    >
                      {on ? "Following" : asked ? "Requested" : "Follow"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-3 pt-6">
        <button
          type="button"
          onClick={skip}
          disabled={busy}
          className="rounded-full px-5 py-3.5 text-sm font-semibold text-violet-200/70 hover:text-white disabled:opacity-60"
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
