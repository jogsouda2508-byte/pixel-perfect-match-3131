import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Play, Video } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { fetchVideoById, truncateCaption } from "@/lib/videos";

/**
 * A video shared inside a chat message. The post is loaded with the viewer's own
 * permissions (RLS), so if they can't see it -- or it was deleted -- they get the
 * "no longer available" state instead of the video.
 */
export function SharedVideoCard({ postId, own }: { postId: string; own: boolean }) {
  const { user } = useAuth();
  const video = useQuery({
    queryKey: ["shared-video", postId, user?.id],
    queryFn: () => fetchVideoById(postId, user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });

  const muted = own ? "text-primary-foreground/80" : "text-muted-foreground";

  if (video.isLoading) return <Skeleton className="h-56 w-44 rounded-xl" />;

  if (video.isError || !video.data) {
    return (
      <div className={`flex items-center gap-2 text-sm ${muted}`}>
        <Video className="h-4 w-4 shrink-0" aria-hidden="true" />
        {video.isError ? "Couldn't load this video." : "This video is no longer available."}
      </div>
    );
  }

  const post = video.data;
  const caption = post.content ? truncateCaption(post.content, 80).text : "";

  return (
    <Link
      to="/videos"
      search={{ video: post.id }}
      aria-label={`Watch video by ${post.author_name || post.author_username}`}
      className="block w-44 max-w-full overflow-hidden rounded-xl bg-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-[9/16] max-h-64 w-full">
        {post.thumbnail_url ? (
          <img
            src={post.thumbnail_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <Video className="h-8 w-8" aria-hidden="true" />
          </div>
        )}
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55">
            <Play className="h-6 w-6 fill-white" aria-hidden="true" />
          </span>
        </span>
      </div>
      <div className="space-y-0.5 p-2">
        <p className="truncate text-xs font-semibold">
          {post.author_name || `@${post.author_username}`}
        </p>
        {caption && <p className="line-clamp-2 break-words text-xs text-white/80">{caption}</p>}
      </div>
    </Link>
  );
}
