import { useEffect, useState, type ReactNode } from "react";
import { useChatMediaUrl } from "@/lib/chat-media";

/**
 * A chat photo from private storage. Shows an empty box while the signed link is fetched, asks for
 * a fresh link once if the browser rejects the old one, and shows `fallback` (default: nothing) if
 * the file can't be opened.
 */
export function ChatMediaImg({
  url,
  alt,
  className,
  loading = "lazy",
  fallback = null,
}: {
  url: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  fallback?: ReactNode;
}) {
  const media = useChatMediaUrl(url);
  const [retried, setRetried] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setRetried(false);
    setBroken(false);
  }, [url]);

  if (media.status === "error" || broken) return <>{fallback}</>;
  if (!media.src)
    return (
      <span aria-hidden="true" className={`${className ?? ""} block animate-pulse bg-black/10`} />
    );
  return (
    <img
      src={media.src}
      alt={alt}
      loading={loading}
      draggable={false}
      className={className}
      onError={() => {
        if (retried) return setBroken(true);
        setRetried(true);
        void media.refresh().then((ok) => {
          if (!ok) setBroken(true);
        });
      }}
    />
  );
}
