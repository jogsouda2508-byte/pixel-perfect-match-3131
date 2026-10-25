import { useBlocker, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  Image as ImageIcon,
  Loader2,
  Plus,
  Upload,
  Users,
  Video,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Audience } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { createPost, validateImage } from "@/lib/social";
import { createPoll } from "@/lib/polls";
import {
  createVideoThumbnail,
  uploadVideoPost,
  validateVideoDuration,
  validateVideoFile,
} from "@/lib/videos";
import {
  EMPTY_EXTRAS,
  PostExtrasFields,
  type PostExtrasValue,
} from "@/components/post-extras-fields";
import { appendHashtagMark, extractHashtags } from "@/lib/post-extras";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type MediaKind = "image" | "video";
type LauncherVariant = "sidebar" | "mobile" | "video" | "media";

const audiences: Audience[] = ["Public", "Friends", "Local Community"];
const imageAccept = "image/jpeg,image/png,image/webp,image/gif";
const videoAccept = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";

export function ComposerLauncher({
  variant,
  videoLabel = false,
  extras,
  onExtrasChange,
}: {
  variant: LauncherVariant;
  videoLabel?: boolean;
  /** Optional: let a parent page own the chosen location/tags (e.g. Create Post), so they
   *  carry over when a photo or video is attached. Without it the composer keeps its own. */
  extras?: PostExtrasValue | undefined;
  onExtrasChange?: ((next: PostExtrasValue) => void) | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<MediaKind>("image");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<Audience>("Public");
  const [localExtras, setLocalExtras] = useState<PostExtrasValue>(EMPTY_EXTRAS);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const previewVideo = useRef<HTMLVideoElement>(null);
  const captionInput = useRef<HTMLTextAreaElement>(null);
  const toastIdRef = useRef<string | null>(null);
  const uploadingRef = useRef(false);
  const hasOpenDraft = !!file && composerOpen;
  // Location and tagged people are NOT reset when a different photo/video is chosen.
  const postExtras = extras ?? localExtras;
  const setPostExtras = onExtrasChange ?? setLocalExtras;

  useBlocker({
    shouldBlockFn: () => hasOpenDraft && !window.confirm("Discard this media and its caption?"),
    enableBeforeUnload: false,
  });

  useEffect(() => {
    if (!hasOpenDraft) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasOpenDraft]);

  useEffect(() => {
    if (!file) {
      setFileUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!thumbnail) {
      setThumbnailUrl(null);
      return;
    }
    const url = URL.createObjectURL(thumbnail);
    setThumbnailUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [thumbnail]);

  const pick = (nextKind: MediaKind) => {
    setKind(nextKind);
    setFileError("");
    (nextKind === "image" ? imageInput.current : videoInput.current)?.click();
  };

  const onFileSelected = (nextKind: MediaKind, selected?: File) => {
    if (!selected) return;
    const problem = nextKind === "image" ? validateImage(selected) : validateVideoFile(selected);
    setKind(nextKind);
    setFile(selected);
    setDuration(null);
    setThumbnail(null);
    setCaption("");
    setAudience("Public");
    setStep(1);
    setFileError(problem ?? "");
    setComposerOpen(true);
  };

  const closeComposer = () => {
    if (uploadingRef.current) return;
    if (file && !window.confirm("Discard this media and its caption?")) return;
    setComposerOpen(false);
    setFile(null);
    setThumbnail(null);
    setDuration(null);
    setCaption("");
    setFileError("");
    setStep(1);
    // Only discard extras this composer owns; a parent page keeps its own.
    if (!onExtrasChange) setLocalExtras(EMPTY_EXTRAS);
  };

  const validateAndContinue = async () => {
    if (!file) return;
    const problem = kind === "image" ? validateImage(file) : validateVideoFile(file);
    if (problem) {
      setFileError(problem);
      return;
    }
    if (kind === "video") {
      const durationProblem = validateVideoDuration(duration ?? Number.NaN);
      if (durationProblem) {
        setFileError(durationProblem);
        return;
      }
      if (!thumbnail) {
        const videoElement = previewVideo.current;
        if (!videoElement) {
          setFileError("Couldn't preview this video. Please choose it again.");
          return;
        }
        try {
          setThumbnail(await createVideoThumbnail(videoElement));
        } catch (error) {
          setFileError(error instanceof Error ? error.message : "Couldn't create a thumbnail.");
          return;
        }
      }
    }
    setFileError("");
    setStep(2);
  };

  const publish = async () => {
    const currentFile = file;
    const currentThumbnail = thumbnail;
    const currentDuration = duration;
    const currentLocation = postExtras.location;
    const currentTaggedIds = postExtras.tagged.map((person) => person.id);
    const currentPoll = postExtras.poll ?? null;
    if (!currentFile || !profile || uploadingRef.current) return;
    if (kind === "video" && (!currentThumbnail || currentDuration === null)) return;

    uploadingRef.current = true;
    setUploading(true);
    setUploadProgress(0);
    const controller = new AbortController();
    const toastId = (toastIdRef.current ??= `composer-upload-${crypto.randomUUID()}`);
    const postedKind = kind;
    const updateProgress = (progress: number) => {
      setUploadProgress(progress);
      toast.loading(postedKind === "video" ? `Uploading... ${progress}%` : "Uploading...", {
        id: toastId,
        ...(postedKind === "video"
          ? {
              action: {
                label: "Cancel",
                onClick: () => controller.abort(),
              },
            }
          : {}),
      });
    };
    updateProgress(0);
    setComposerOpen(false);

    try {
      let postedId: string | undefined;
      let tagsFailed = false;
      let pollFailed = false;
      if (postedKind === "video") {
        const post = await uploadVideoPost({
          authorId: profile.id,
          caption: caption.trim(),
          audience,
          file: currentFile,
          thumbnail: currentThumbnail!,
          durationSeconds: currentDuration!,
          signal: controller.signal,
          onProgress: updateProgress,
          location: currentLocation,
          taggedUserIds: currentTaggedIds,
        });
        postedId = post.id;
        tagsFailed = post.tagsFailed;
        if (currentPoll) {
          try {
            await createPoll({ postId: post.id }, currentPoll.question, currentPoll.options);
          } catch {
            pollFailed = true;
          }
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["video-feed"] }),
          queryClient.invalidateQueries({ queryKey: ["feed"] }),
          queryClient.invalidateQueries({ queryKey: ["user-videos"] }),
          queryClient.invalidateQueries({ queryKey: ["user-posts"] }),
        ]);
      } else {
        const created = await createPost({
          authorId: profile.id,
          content: caption.trim(),
          audience,
          image: currentFile,
          location: currentLocation,
          taggedUserIds: currentTaggedIds,
        });
        postedId = created.id;
        tagsFailed = created.tagsFailed;
        if (currentPoll) {
          try {
            await createPoll({ postId: created.id }, currentPoll.question, currentPoll.options);
          } catch {
            pollFailed = true;
          }
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["feed"] }),
          queryClient.invalidateQueries({ queryKey: ["user-posts"] }),
          queryClient.invalidateQueries({ queryKey: ["follow-counts"] }),
          queryClient.invalidateQueries({ queryKey: ["trending"] }),
        ]);
      }
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["poll"] });
      toast.success(
        pollFailed
          ? "Posted, but the poll couldn't be added"
          : tagsFailed
            ? "Posted, but we couldn't tag everyone"
            : "Posted",
        {
          id: toastId,
          action: {
            label: "View",
            onClick: () => {
              if (postedKind === "video" && postedId)
                void navigate({ to: "/videos", search: { video: postedId } });
              else void navigate({ to: "/home" });
            },
          },
        },
      );
      setFile(null);
      setThumbnail(null);
      setDuration(null);
      setCaption("");
      setStep(1);
      setFileError("");
      setPostExtras(EMPTY_EXTRAS);
      toastIdRef.current = null;
    } catch (error) {
      const wasCancelled = error instanceof DOMException && error.name === "AbortError";
      toast.error(
        wasCancelled ? "Upload cancelled. Retry when you're ready." : "Couldn't post. Retry",
        {
          id: toastId,
          action: {
            label: "Retry",
            onClick: () => void publish(),
          },
        },
      );
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const directVideoPicker = variant === "video";
  const mediaLauncher = variant === "media";
  const startChooser = () => {
    if (directVideoPicker) {
      pick("video");
      return;
    }
    setChooserOpen(true);
  };

  return (
    <>
      <input
        ref={imageInput}
        type="file"
        accept={imageAccept}
        hidden
        onChange={(event) => {
          onFileSelected("image", event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept={videoAccept}
        hidden
        onChange={(event) => {
          onFileSelected("video", event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

      {mediaLauncher ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => pick("image")}
          >
            <ImageIcon className="mr-2 h-4 w-4" />
            Photo
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => pick("video")}
          >
            <Video className="mr-2 h-4 w-4" />
            Video
          </Button>
        </div>
      ) : directVideoPicker ? (
        <Button
          type="button"
          variant={videoLabel ? "default" : "ghost"}
          aria-label="Upload video"
          onClick={startChooser}
          className={
            videoLabel
              ? "min-h-11 focus-visible:ring-2 focus-visible:ring-ring"
              : "grid h-11 w-11 shrink-0 place-items-center rounded-full p-0 text-white focus-visible:ring-white"
          }
        >
          {videoLabel ? (
            <>
              <Camera className="mr-2 h-5 w-5" aria-hidden="true" />
              Upload video
            </>
          ) : (
            <Upload className="h-5 w-5" aria-hidden="true" />
          )}
        </Button>
      ) : variant === "mobile" ? (
        <Button
          type="button"
          aria-label="Create"
          onClick={startChooser}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-40 grid h-14 w-14 place-items-center rounded-full shadow-lg focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <Plus className="h-6 w-6" aria-hidden="true" />
        </Button>
      ) : (
        <Button
          type="button"
          onClick={startChooser}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-gradient-brand py-3 font-semibold text-primary-foreground glow focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          Create
        </Button>
      )}

      {!mediaLauncher && !directVideoPicker && (
        <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
          <DialogContent className="fixed inset-x-0 bottom-0 top-auto w-full max-w-none translate-x-0 translate-y-0 rounded-t-2xl p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
            <DialogHeader>
              <DialogTitle>Create</DialogTitle>
              <DialogDescription>Choose what you'd like to share.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setChooserOpen(false);
                  pick("image");
                }}
                className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ImageIcon className="h-6 w-6 text-primary" aria-hidden="true" />
                Post
                <span className="text-xs font-normal text-muted-foreground">Choose a photo</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setChooserOpen(false);
                  pick("video");
                }}
                className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Video className="h-6 w-6 text-primary" aria-hidden="true" />
                Video
                <span className="text-xs font-normal text-muted-foreground">Up to 60 seconds</span>
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog
        open={composerOpen}
        onOpenChange={(open) => {
          if (!open) closeComposer();
        }}
      >
        <DialogContent
          className="fixed inset-0 grid-rows-[auto_minmax(0,1fr)] h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-0 bg-background p-0 [&>button]:hidden sm:left-1/2 sm:top-1/2 sm:h-[86dvh] sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
          onEscapeKeyDown={(event) => {
            if (uploading) event.preventDefault();
          }}
        >
          <div className="flex min-h-14 items-center justify-between border-b border-border px-4 pt-[env(safe-area-inset-top)]">
            <button
              type="button"
              onClick={() => {
                if (step === 2) setStep(1);
                else closeComposer();
              }}
              aria-label={step === 2 ? "Back to preview" : "Discard media"}
              className="grid h-11 w-11 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <h2 className="font-semibold">
              {step === 1 ? (kind === "video" ? "New video" : "New post") : "Details"}
            </h2>
            {step === 1 ? (
              <Button
                type="button"
                onClick={() => void validateAndContinue()}
                disabled={!file || (kind === "video" && duration === null)}
                className="min-h-11"
              >
                Next
              </Button>
            ) : (
              <span className="w-11" />
            )}
          </div>

          {step === 1 ? (
            <div className="grid min-h-0 flex-1 place-items-center bg-neutral-950 p-3 sm:p-6">
              {kind === "image" && fileUrl && (
                <img
                  src={fileUrl}
                  alt="Selected post preview"
                  className="max-h-[calc(100dvh-7rem)] max-w-full object-contain"
                />
              )}
              {kind === "video" && file && (
                <video
                  ref={previewVideo}
                  src={fileUrl ?? undefined}
                  controls
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(event) => {
                    const seconds = event.currentTarget.duration;
                    setDuration(seconds);
                    setFileError(validateVideoDuration(seconds) ?? "");
                  }}
                  onError={() =>
                    setFileError("Couldn't read this video's preview. Choose another video.")
                  }
                  className="max-h-[calc(100dvh-7rem)] max-w-full object-contain"
                />
              )}
              {fileError && (
                <p
                  className="absolute bottom-4 left-4 right-4 rounded-lg bg-black/75 p-3 text-center text-sm text-white"
                  role="alert"
                >
                  {fileError}
                </p>
              )}
              {kind === "video" && file && duration === null && !fileError && (
                <p className="absolute bottom-4 rounded-lg bg-black/75 px-3 py-2 text-sm text-white">
                  Checking video duration…
                </p>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:p-6">
              <div className="flex gap-4">
                {kind === "image" && fileUrl ? (
                  <img
                    src={fileUrl}
                    alt=""
                    className="h-24 w-20 shrink-0 rounded-lg object-cover"
                  />
                ) : thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt=""
                    className="h-24 w-20 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="grid h-24 w-20 shrink-0 place-items-center rounded-lg bg-neutral-900 text-white">
                    <Camera className="h-6 w-6" aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <textarea
                    ref={captionInput}
                    value={caption}
                    onChange={(event) => setCaption(event.currentTarget.value.slice(0, 500))}
                    placeholder="Write a caption..."
                    maxLength={500}
                    rows={5}
                    aria-label="Caption"
                    className="min-h-24 w-full resize-y rounded-xl border border-border bg-background p-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p className="mt-1 text-right text-xs text-muted-foreground">
                    {caption.length}/500
                  </p>
                </div>
              </div>

              <PostExtrasFields
                value={postExtras}
                onChange={setPostExtras}
                audience={audience}
                hashtags={extractHashtags(caption)}
                onAddHashtag={() => {
                  setCaption((value) => appendHashtagMark(value, 500));
                  captionInput.current?.focus();
                }}
              />

              <div className="space-y-2">
                <p className="text-sm font-semibold">Audience</p>
                {audiences.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setAudience(option)}
                    aria-pressed={audience === option}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${audience === option ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                  >
                    <Users className="h-4 w-4" aria-hidden="true" />
                    {option}
                    <span className="ml-auto text-xs">{audience === option ? "Selected" : ""}</span>
                  </button>
                ))}
              </div>

              {fileError && (
                <p role="alert" className="text-sm text-destructive">
                  {fileError}
                </p>
              )}
              <Button
                type="button"
                onClick={() => void publish()}
                disabled={
                  !file || uploading || (kind === "video" && (!thumbnail || duration === null))
                }
                className="mt-auto min-h-12 w-full text-base font-semibold"
              >
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Share
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {uploading && (
        <div
          className="fixed inset-x-0 top-0 z-[100] h-1 bg-primary/20"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={kind === "video" ? uploadProgress : undefined}
          aria-label="Media upload progress"
        >
          <div
            className={
              kind === "video"
                ? "h-full bg-primary transition-[width]"
                : "h-full w-1/3 animate-pulse bg-primary"
            }
            style={kind === "video" ? { width: `${uploadProgress}%` } : undefined}
          />
        </div>
      )}
    </>
  );
}
