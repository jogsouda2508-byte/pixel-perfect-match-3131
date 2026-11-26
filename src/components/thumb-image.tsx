import { useState, type ImgHTMLAttributes } from "react";
import { feedImageUrl, thumbnailUrl } from "@/lib/image-thumb";

/** Light copies that turned out not to exist (old posts): not asked for again in this session. */
const missing = new Set<string>();

/**
 * A post photo that loads a lighter copy when the post has one and quietly falls back to the
 * full photo when it doesn't (posts made before the copies existed, or a copy that failed).
 *   variant="thumb": profile grid tiles (small, the default)
 *   variant="feed":  the feed and post page (sharp at card width, a fraction of the bytes)
 */
export function ThumbImage({
  src,
  variant = "thumb",
  alt = "",
  loading = "lazy",
  ...rest
}: {
  src: string;
  variant?: "thumb" | "feed";
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "onError">) {
  const light = variant === "feed" ? feedImageUrl(src) : thumbnailUrl(src);
  // re-render when a copy turns out to be missing
  const [, bump] = useState(0);
  const useLight = light !== null && !missing.has(light);
  return (
    <img
      {...rest}
      src={useLight ? light : src}
      alt={alt}
      loading={loading}
      onError={() => {
        if (useLight) {
          missing.add(light);
          bump((n) => n + 1);
        }
      }}
    />
  );
}
