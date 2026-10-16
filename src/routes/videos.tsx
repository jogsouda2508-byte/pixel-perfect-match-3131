import { createFileRoute } from "@tanstack/react-router";
import { VideoViewer } from "@/components/video-viewer";

export const Route = createFileRoute("/videos")({
  validateSearch: (search: Record<string, unknown>): { video?: string | undefined } => {
    const video = search["video"];
    return { video: typeof video === "string" ? video : undefined };
  },
  head: () => ({
    meta: [
      { title: "Videos — Ediraa" },
      { name: "description", content: "Watch short videos shared by your Ediraa community." },
    ],
  }),
  component: VideosPage,
});

function VideosPage() {
  const { video } = Route.useSearch();
  return video ? <VideoViewer initialVideoId={video} /> : <VideoViewer />;
}
