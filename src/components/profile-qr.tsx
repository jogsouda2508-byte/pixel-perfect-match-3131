import { useEffect, useMemo, useState } from "react";
import { Download, Link2, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { makeQr } from "@/lib/qr";
import { isNativeApp, nativeCopy, nativeSaveImage, nativeShareLink } from "@/lib/native-share";

/** Background + QR colour pairs. The COLOR pill cycles through them (like Instagram). */
const THEMES = [
  { bg: "linear-gradient(165deg,#22d35f 0%,#0ea5a5 50%,#0096ff 100%)", fg: "#0b9aa3" },
  { bg: "linear-gradient(165deg,#7c3aed 0%,#c026d3 55%,#f43f5e 100%)", fg: "#7e22ce" },
  { bg: "linear-gradient(165deg,#fbbf24 0%,#f97316 50%,#e11d48 100%)", fg: "#c2410c" },
  { bg: "linear-gradient(165deg,#22d3ee 0%,#6366f1 55%,#7c3aed 100%)", fg: "#4338ca" },
  { bg: "linear-gradient(165deg,#0f172a 0%,#1e293b 55%,#334155 100%)", fg: "#0f172a" },
] as const;

const QUIET = 2; // empty modules around the code

function qrRects(modules: boolean[][]): string {
  let out = "";
  for (let y = 0; y < modules.length; y++)
    for (let x = 0; x < modules.length; x++)
      if (modules[y]![x])
        out += `<rect x="${x + QUIET}" y="${y + QUIET}" width="1.02" height="1.02" rx="0.3"/>`;
  return out;
}

/** The QR picture as a standalone SVG string (used on screen and for the download). */
function cardSvg(modules: boolean[][], fg: string, label: string): string {
  const n = modules.length + QUIET * 2;
  const W = 1000;
  const qrSize = 760;
  const scale = qrSize / n;
  const safe = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="1000" viewBox="0 0 ${W} 1000">` +
    `<rect width="${W}" height="1000" rx="70" fill="#ffffff"/>` +
    `<g transform="translate(${(W - qrSize) / 2} 90) scale(${scale})" fill="${fg}">${qrRects(modules)}</g>` +
    `<text x="${W / 2}" y="930" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="70" font-weight="700" fill="${fg}">${safe}</text>` +
    `</svg>`
  );
}

/**
 * Copies text. The modern clipboard API only works on secure pages and when the browser allows
 * it, so this falls back to the old select-and-copy method (works on http and in older webviews).
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the fallback below */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function ProfileQrSheet({
  username,
  url,
  onClose,
}: {
  username: string;
  /** the full profile link the QR code opens, e.g. https://site.com/u/name */
  url: string;
  onClose: () => void;
}) {
  const [themeIdx, setThemeIdx] = useState(0);
  // our own "send to" list, used when the phone / webview has no built-in share sheet
  const [appsOpen, setAppsOpen] = useState(false);
  // the QR as a picture to press-and-hold to save (phones that can't download files)
  const [preview, setPreview] = useState<string | null>(null);
  const theme = THEMES[themeIdx % THEMES.length]!;
  const modules = useMemo(() => makeQr(url), [url]);
  const label = `@${username}`;
  const svg = useMemo(
    () => (modules ? cardSvg(modules, theme.fg, label) : ""),
    [modules, theme.fg, label],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyLink = async () => {
    if ((await nativeCopy(url)) || (await copyText(url))) {
      toast.success("Profile link copied");
    } else {
      // last resort: show the link so it can be copied by hand
      toast.error("Couldn't copy automatically.", { description: url, duration: 10000 });
    }
  };

  /** Share profile: the phone's own share sheet when there is one, else our list of apps. */
  const shareProfile = async () => {
    // Android app: the real Android share sheet
    if (await nativeShareLink({ title: label, text: `${label} on Gicco chat`, url })) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: label, text: `${label} on Gicco chat`, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // any other failure: fall through to the list below
      }
    }
    setAppsOpen(true);
  };

  const makePng = async (): Promise<Blob> => {
    const blobUrl = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("render"));
        img.src = blobUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 1000;
      canvas.height = 1000;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 1000, 1000);
      ctx.drawImage(img, 0, 0, 1000, 1000);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("png");
      return blob;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  };

  const download = async () => {
    if (!svg) return;
    try {
      const blob = await makePng();
      const fileName = `${username}-qr.png`;
      // Android app: save into the phone's Documents folder (share sheet only if that is refused)
      const native = await nativeSaveImage(blob, fileName);
      if (native === "saved") {
        toast.success("QR code saved in your Documents folder");
        return;
      }
      if (native === "shared") return;
      // Android app without the plugins yet: its web view can't download, so show the picture
      // to press and hold.
      if (isNativeApp()) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error("read"));
          r.readAsDataURL(blob);
        });
        setPreview(dataUrl);
        return;
      }
      // Chrome (laptop or phone): a normal file download straight to Downloads.
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 2000);
      toast.success("QR code saved");
    } catch {
      toast.error("Couldn't save the QR code.");
    }
  };

  const text = encodeURIComponent(`${label} on Gicco chat: ${url}`);
  const link = encodeURIComponent(url);
  const apps = [
    { name: "WhatsApp", href: `https://wa.me/?text=${text}` },
    { name: "Telegram", href: `https://t.me/share/url?url=${link}&text=${encodeURIComponent(`${label} on Gicco chat`)}` },
    { name: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${link}` },
    { name: "X", href: `https://twitter.com/intent/tweet?text=${text}` },
    { name: "Messages", href: `sms:?&body=${text}` },
    { name: "Email", href: `mailto:?subject=${encodeURIComponent(`${label} on Gicco chat`)}&body=${text}` },
  ];

  const actionBtn =
    "flex w-24 flex-col items-center gap-2 rounded-xl text-center text-[13px] font-medium leading-tight text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900";
  const circle =
    "grid h-14 w-14 place-items-center rounded-full border border-neutral-200 bg-white";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Profile QR code"
      className="fixed inset-0 z-[100] flex flex-col overflow-y-auto text-white"
      style={{ background: theme.bg }}
    >
      <div className="relative flex items-center justify-center px-4 pb-2 pt-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute left-3 top-3 grid h-11 w-11 place-items-center rounded-full hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-7 w-7" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setThemeIdx((i) => (i + 1) % THEMES.length)}
          className="rounded-full border border-white px-5 py-1.5 text-sm font-semibold tracking-[0.18em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          COLOR
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 pb-8">
        <div className="rounded-3xl bg-white p-4 shadow-xl">
          {svg ? (
            <div
              role="img"
              aria-label={`QR code for ${label}`}
              className="mx-auto w-full [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <p className="p-6 text-center text-sm text-neutral-700">
              Couldn't make a QR code for this link.
            </p>
          )}
        </div>

        <div className="flex justify-around rounded-3xl bg-white px-2 py-4 shadow-xl">
          <button type="button" onClick={() => void shareProfile()} className={actionBtn}>
            <span className={circle}>
              <Share2 className="h-6 w-6" aria-hidden="true" />
            </span>
            Share profile
          </button>
          <button type="button" onClick={() => void copyLink()} className={actionBtn}>
            <span className={circle}>
              <Link2 className="h-6 w-6" aria-hidden="true" />
            </span>
            Copy link
          </button>
          <button
            type="button"
            onClick={() => void download()}
            disabled={!svg}
            className={`${actionBtn} disabled:opacity-50`}
          >
            <span className={circle}>
              <Download className="h-6 w-6" aria-hidden="true" />
            </span>
            Download
          </button>
        </div>
      </div>

      {appsOpen && (
        <div
          className="absolute inset-0 z-10 flex items-end bg-black/50"
          onClick={() => setAppsOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Share profile"
            className="w-full rounded-t-3xl bg-white p-5 text-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-3 text-center text-sm font-semibold">Share profile</p>
            <div className="grid grid-cols-3 gap-3">
              {apps.map((a) => (
                <a
                  key={a.name}
                  href={a.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setAppsOpen(false)}
                  className="grid min-h-12 place-items-center rounded-xl bg-neutral-100 px-2 py-3 text-center text-[13px] font-medium"
                >
                  {a.name}
                </a>
              ))}
              <button
                type="button"
                onClick={() => {
                  setAppsOpen(false);
                  void copyLink();
                }}
                className="grid min-h-12 place-items-center rounded-xl bg-neutral-100 px-2 py-3 text-center text-[13px] font-medium"
              >
                Copy link
              </button>
            </div>
            <button
              type="button"
              onClick={() => setAppsOpen(false)}
              className="mt-4 w-full rounded-xl py-2 text-sm font-semibold text-neutral-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/85 p-6"
          onClick={() => setPreview(null)}
        >
          <img
            src={preview}
            alt={`QR code for ${label}`}
            className="w-full max-w-xs rounded-3xl bg-white"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="text-center text-sm text-white">
            Press and hold the picture, then choose "Download image" or "Save image".
          </p>
          <a
            href={preview}
            download={`${username}-qr.png`}
            onClick={(e) => e.stopPropagation()}
            className="rounded-full bg-white px-6 py-2 text-sm font-semibold text-neutral-900"
          >
            Save image
          </a>
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="text-sm font-semibold text-white/80"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
