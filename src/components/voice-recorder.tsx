import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Mic, Pause, Play, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ediraa";
import {
  formatClock,
  MIC_DENIED_MESSAGE,
  pickVoiceFormat,
  VOICE_MAX_SECONDS,
  VOICE_MIN_SECONDS,
  voiceSupported,
  voiceUnsupportedMessage,
} from "@/lib/voice";

export type VoiceResult = { blob: Blob; seconds: number };

/** Records from the microphone. `stop(true)` hands the recording to `onFinish`, `stop(false)` throws it away. */
export function useVoiceRecorder(onFinish: (r: VoiceResult) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const startingRef = useRef(false);
  // set when the finger is lifted before the microphone permission / start finished
  const earlyStopRef = useRef<boolean | null>(null);
  const sendRef = useRef(false);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  const stop = (send: boolean) => {
    if (startingRef.current && !recRef.current) {
      earlyStopRef.current = send;
      return;
    }
    const rec = recRef.current;
    if (!rec) return;
    sendRef.current = send;
    recRef.current = null;
    if (rec.state !== "inactive") rec.stop();
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const start = async () => {
    if (recRef.current || startingRef.current) return;
    if (!voiceSupported()) {
      toast.error(voiceUnsupportedMessage());
      return;
    }
    startingRef.current = true;
    earlyStopRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (earlyStopRef.current !== null) {
        // let go before it started: just a tap, nothing to record
        stream.getTracks().forEach((t) => t.stop());
        earlyStopRef.current = null;
        toast("Hold the mic to record, release to send");
        return;
      }
      const format = pickVoiceFormat();
      const rec = new MediaRecorder(stream, format ? { mimeType: format.mime } : undefined);
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const tick = window.setInterval(() => {
        const s = (Date.now() - startedAt) / 1000;
        setSeconds(Math.floor(s));
        if (s >= VOICE_MAX_SECONDS) stopRef.current(true);
      }, 200);
      rec.onstop = () => {
        window.clearInterval(tick);
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setSeconds(0);
        const secs = (Date.now() - startedAt) / 1000;
        if (!sendRef.current) return;
        if (secs < VOICE_MIN_SECONDS || chunks.length === 0) {
          toast("Hold the mic to record, release to send");
          return;
        }
        finishRef.current({
          blob: new Blob(chunks, { type: rec.mimeType || format?.type || "audio/webm" }),
          seconds: secs,
        });
      };
      recRef.current = rec;
      sendRef.current = false;
      rec.start();
      setSeconds(0);
      setRecording(true);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotFoundError") toast.error("No microphone was found on this device.");
      else if (name === "NotReadableError")
        toast.error("The microphone is being used by another app. Close it and try again.");
      else toast.error(MIC_DENIED_MESSAGE);
    } finally {
      startingRef.current = false;
    }
  };

  useEffect(() => () => stopRef.current(false), []);
  return { recording, seconds, start, stop };
}

/** The mic button: hold to record, release to send, slide left to cancel. Enter / Space also toggles. */
export function MicButton({
  recording,
  start,
  stop,
  onCancelling,
  disabled,
}: {
  recording: boolean;
  start: () => Promise<void>;
  stop: (send: boolean) => void;
  onCancelling: (cancelling: boolean) => void;
  disabled?: boolean;
}) {
  const startX = useRef(0);
  const cancelling = useRef(false);
  const setCancel = (v: boolean) => {
    if (cancelling.current === v) return;
    cancelling.current = v;
    onCancelling(v);
  };
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={recording ? "Send voice message" : "Hold to record a voice message"}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button > 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        startX.current = e.clientX;
        setCancel(false);
        void start();
      }}
      onPointerMove={(e) => {
        if (recording) setCancel(e.clientX - startX.current < -70);
      }}
      onPointerUp={() => {
        stop(!cancelling.current);
        setCancel(false);
      }}
      onPointerCancel={() => {
        stop(false);
        setCancel(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (e.repeat) return;
        if (recording) stop(true);
        else void start();
      }}
      className={`relative grid h-11 w-11 shrink-0 touch-none sm:h-12 sm:w-12 select-none place-items-center rounded-full bg-[var(--wa-accent)] text-white shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
        recording ? "scale-125" : ""
      }`}
    >
      {recording && (
        <span
          aria-hidden="true"
          className="voice-pulse absolute inset-0 rounded-full bg-[var(--wa-accent)]"
        />
      )}
      <Mic className="relative h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
    </button>
  );
}

/** Replaces the text box while recording: a trash button, a live timer and moving bars. */
export function RecordingBar({
  seconds,
  cancelling,
  onCancel,
}: {
  seconds: number;
  cancelling: boolean;
  onCancel: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="off"
      className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-[var(--wa-input)] sm:min-h-12 sm:gap-3 px-3 text-[var(--wa-input-fg)] shadow-sm"
    >
      <span
        aria-hidden="true"
        className="voice-dot h-2.5 w-2.5 shrink-0 rounded-full bg-destructive"
      />
      <span className="w-9 shrink-0 text-sm tabular-nums sm:w-10 sm:text-base">
        {formatClock(seconds)}
      </span>
      <span aria-hidden="true" className="flex h-5 flex-1 items-center gap-[3px] overflow-hidden">
        {Array.from({ length: 18 }, (_, i) => (
          <span
            key={i}
            className="voice-wave w-[3px] shrink-0 rounded-full bg-[var(--wa-accent)]"
            style={{ animationDelay: `${(i % 6) * 90}ms` }}
          />
        ))}
      </span>
      <span
        className={`shrink-0 text-xs sm:text-sm ${cancelling ? "font-semibold text-destructive" : "text-[var(--wa-meta)]"}`}
      >
        {cancelling ? "Release to cancel" : "‹ Slide to cancel"}
      </span>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel recording"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

let playing: HTMLAudioElement | null = null;
const SPEEDS = [1, 1.5, 2] as const;
const BAR_COUNT = 34;

/**
 * A voice message, laid out like WhatsApp: play button, a thin waveform with a moving dot,
 * the length underneath (and `footer` - the time / ticks - at the right of that line), and the
 * sender's photo with a small mic. While it plays, the photo turns into a 1x / 1.5x / 2x button.
 */
export function VoiceBubble({
  url,
  seconds,
  own,
  avatarUrl,
  name,
  footer,
}: {
  url: string;
  seconds: number;
  own: boolean;
  avatarUrl?: string | null | undefined;
  name?: string | undefined;
  footer?: ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [heard, setHeard] = useState(false);
  const total = Math.max(1, seconds);

  // a smooth, even waveform that is the same every time for the same message
  const bars = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < url.length; i++) h = Math.imul(h ^ url.charCodeAt(i), 16777619);
    const rnd = () => {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
      return (h % 1000) / 1000;
    };
    const raw = Array.from({ length: BAR_COUNT + 2 }, rnd);
    return Array.from({ length: BAR_COUNT }, (_, i) => {
      // neighbours are blended, so it flows up and down instead of jumping
      const v = raw[i]! * 0.25 + raw[i + 1]! * 0.5 + raw[i + 2]! * 0.25;
      const t = Math.min(1, Math.max(0, (v - 0.25) / 0.5));
      const swell = 0.6 + 0.4 * Math.sin((Math.PI * (i + 0.5)) / BAR_COUNT);
      return Math.round(22 + 78 * t * swell);
    });
  }, [url]);

  useEffect(
    () => () => {
      const a = audioRef.current;
      if (a && playing === a) playing = null;
    },
    [],
  );

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      a.pause();
      return;
    }
    if (playing && playing !== a) playing.pause();
    playing = a;
    a.playbackRate = SPEEDS[speedIdx] ?? 1;
    setFailed(false);
    void a.play().catch(() => setFailed(true));
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = f * total;
    setProgress(f);
  };
  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next] ?? 1;
  };

  // WhatsApp: the dot is blue until you have listened, green after
  const knob = heard ? "bg-[var(--wa-accent)]" : "bg-[var(--wa-tick)]";

  return (
    <div className="flex w-[min(15.5rem,66vw)] max-w-full items-center gap-1.5 py-0.5 sm:w-[min(17rem,72vw)] sm:gap-2">
      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onPlay={() => {
          setIsPlaying(true);
          setHeard(true);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setProgress(0);
          if (audioRef.current) audioRef.current.currentTime = 0;
        }}
        onTimeUpdate={(e) => setProgress(Math.min(1, e.currentTarget.currentTime / total))}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? "Pause voice message" : "Play voice message"}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--wa-icon)] transition active:scale-90 sm:h-9 sm:w-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {isPlaying ? (
          <Pause className="h-6 w-6 fill-current sm:h-7 sm:w-7" aria-hidden="true" />
        ) : (
          <Play className="h-6 w-6 fill-current sm:h-7 sm:w-7" aria-hidden="true" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div
          onClick={seek}
          className="relative flex h-6 cursor-pointer items-center justify-between"
          role="progressbar"
          aria-label="Voice message progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          {bars.map((h, i) => (
            <span
              key={i}
              className={`w-[2px] shrink-0 rounded-full ${
                i / bars.length < progress ? "bg-[var(--wa-icon)]" : "bg-[var(--wa-meta)]/45"
              }`}
              style={{ height: `${h}%` }}
            />
          ))}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow ${knob}`}
            style={{ left: `${Math.min(97, Math.max(2, progress * 100))}%` }}
          />
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] leading-none text-[var(--wa-meta)] sm:text-[11px]">
          <span className="tabular-nums">
            {failed ? "Couldn't play" : formatClock(isPlaying ? progress * total : total)}
          </span>
          {footer}
        </div>
      </div>
      <div className="relative h-10 w-10 shrink-0 sm:h-11 sm:w-11">
        {isPlaying ? (
          <button
            type="button"
            onClick={cycleSpeed}
            aria-label={`Playback speed ${SPEEDS[speedIdx]}x`}
            className="grid h-full w-full place-items-center rounded-full bg-black/10 text-sm font-semibold text-[var(--wa-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/15"
          >
            {SPEEDS[speedIdx]}x
          </button>
        ) : (
          <>
            <Avatar src={avatarUrl} name={name} size={40} />
            <span
              aria-hidden="true"
              className={`absolute -bottom-0.5 -left-1 grid h-5 w-5 place-items-center rounded-full ${
                own ? "bg-[var(--wa-out)]" : "bg-[var(--wa-in)]"
              } ${heard ? "text-[var(--wa-accent)]" : "text-[var(--wa-tick)]"}`}
            >
              <Mic className="h-3.5 w-3.5 fill-current" />
            </span>
          </>
        )}
      </div>
    </div>
  );
}
