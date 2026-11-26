import { useState } from "react";
import { thumbnailUrl } from "@/lib/image-thumb";

/**
 * A photo in a small tile (profile grid): loads the light thumbnail when the post has one and
 * quietly falls back to the full photo when it doesn't (posts made before thumbnails existed).
 */
export function ThumbImage({
  src,
  alt = "",
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const thumb = thumbnailUrl(src);
  // remember WHICH photo had no thumbnail, so a new src gets a fresh try
  const [missingFor, setMissingFor] = useState<string | null>(null);
  const useThumb = thumb !== null && missingFor !== src;
  return (
    <img
      src={useThumb ? thumb : src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => {
        if (useThumb) setMissingFor(src);
      }}
    />
  );
}
