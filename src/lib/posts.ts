export type UserPost = { id: string; text: string; audience: string; time: string };

// Posts are still stored in this browser only (no posts table yet), but they are
// keyed by user id so two accounts on the same device never see each other's posts.
const key = (userId: string) => `ediraa-user-posts:${userId}`;

export function getUserPosts(userId: string): UserPost[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(key(userId)) ?? "[]") as UserPost[];
  } catch {
    return [];
  }
}

export function addUserPost(userId: string, post: Omit<UserPost, "id" | "time">) {
  const posts = getUserPosts(userId);
  posts.unshift({ ...post, id: crypto.randomUUID(), time: "Just now" });
  window.localStorage.setItem(key(userId), JSON.stringify(posts));
}
