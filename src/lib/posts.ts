export type UserPost = { id: string; text: string; audience: string; time: string };

const KEY = "ediraa-user-posts";

export function getUserPosts(): UserPost[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as UserPost[];
  } catch {
    return [];
  }
}

export function addUserPost(post: Omit<UserPost, "id" | "time">) {
  const posts = getUserPosts();
  posts.unshift({ ...post, id: crypto.randomUUID(), time: "Just now" });
  window.localStorage.setItem(KEY, JSON.stringify(posts));
}
