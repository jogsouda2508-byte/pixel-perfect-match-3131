import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, Pause, Play, Trash2 } from "lucide-react";
import {
  formatClock,
  pickVoiceFormat,
  VOICE_MAX_SECONDS,
  VOICE_MIN_SECONDS,
  voiceSupported,
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
      toast.error("Voice messages aren't supported on this device.");
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
    } catch {
      toast.error("Allow microphone access to record a voice message.");
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
      className={`relative grid h-11 w-11 shrink-0 touch-none select-none place-items-center rounded-full text-primary-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
        recording ? "scale-125 bg-destructive" : "bg-gradient-brand"
      }`}
    >
      {recording && (
        <span
          aria-hidden="true"
          className="voice-pulse absolute inset-0 rounded-full bg-destructive"
        />
      )}
      <Mic className="relative h-5 w-5" aria-hidden="true" />
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
      className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-full border px-3 transition-colors ${
        cancelling ? "border-destructive bg-destructive/10" : "border-border bg-elevated/60"
      }`}
    >
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel recording"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
      <span
        aria-hidden="true"
        className="voice-dot h-2.5 w-2.5 shrink-0 rounded-full bg-destructive"
      />
      <span className="w-10 shrink-0 text-sm font-semibold tabular-nums">
        {formatClock(seconds)}
      </span>
      <span aria-hidden="true" className="flex h-5 flex-1 items-center gap-[3px] overflow-hidden">
        {Array.from({ length: 18 }, (_, i) => (
          <span
            key={i}
            className="voice-wave w-[3px] shrink-0 rounded-full bg-primary"
            style={{ animationDelay: `${(i % 6) * 90}ms` }}
          />
        ))}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {cancelling ? "Release to cancel" : "‹ Slide to cancel"}
      </span>
    </div>
  );
}

let playing: HTMLAudioElement | null = null;

/** A voice message in the chat: play / pause, a waveform you can tap to seek, and its length. */
export function VoiceBubble({ url, seconds, own }: { url: string; seconds: number; own: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const total = Math.max(1, seconds);

  // a steady, unique-looking waveform for every message
  const bars = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < url.length; i++) h = Math.imul(h ^ url.charCodeAt(i), 16777619);
    return Array.from({ length: 30 }, () => {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
      return 20 + (h % 80);
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

  const tone = own
    ? {
        btn: "bg-primary-foreground text-primary",
        off: "bg-primary-foreground/40",
        on: "bg-primary-foreground",
        txt: "text-primary-foreground/80",
      }
    : {
        btn: "bg-primary text-primary-foreground",
        off: "bg-foreground/25",
        on: "bg-primary",
        txt: "text-muted-foreground",
      };

  return (
    <div className="flex w-56 max-w-full items-center gap-2.5 py-0.5">
      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onPlay={() => setIsPlaying(true)}
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
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full shadow-sm transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone.btn}`}
      >
        {isPlaying ? (
          <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
        ) : (
          <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div
          onClick={seek}
          className="flex h-7 cursor-pointer items-center gap-[2px]"
          role="progressbar"
          aria-label="Voice message progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          {bars.map((h, i) => (
            <span
              key={i}
              className={`w-[3px] flex-1 rounded-full ${i / bars.length < progress ? tone.on : tone.off}`}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <p className={`mt-0.5 text-xs tabular-nums ${tone.txt}`}>
          {failed ? "Couldn't play" : formatClock(isPlaying ? progress * total : total)}
        </p>
      </div>
    </div>
  );
}
