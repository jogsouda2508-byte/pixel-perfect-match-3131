import { supabase } from "@/integrations/supabase/client";

/** Turns an exception raised by share_post_to_user() into text a person can read. */
export function shareErrorMessage(raw: string | null | undefined): string {
  const text = raw ?? "";
  if (text.includes("not_following_recipient"))
    return "You can only share videos with people you follow.";
  if (text.includes("recipient_cannot_view_post"))
    return "This person can't view this video because of its audience settings.";
  if (text.includes("post_not_found")) return "This video is no longer available.";
  if (text.includes("recipient_not_found")) return "That account no longer exists.";
  if (text.includes("invalid_recipient")) return "Choose someone else to share with.";
  if (text.includes("not_authenticated")) return "Please sign in again to share this video.";
  return "Couldn't share this video. Please try again.";
}

/**
 * Sends a video to someone through the existing chat (conversations + messages).
 * The server checks that the current user follows the recipient and that both people may
 * see the post, so this cannot be used to bypass those rules from the browser.
 * Resolves to the conversation id.
 */
export async function shareVideoWithUser(postId: string, recipientId: string): Promise<string> {
  const { data, error } = await supabase.rpc("share_post_to_user", {
    p_post_id: postId,
    p_recipient_id: recipientId,
  });
  if (error) {
    console.error("Sharing the video failed", error);
    throw new Error(shareErrorMessage(error.message));
  }
  if (!data) throw new Error(shareErrorMessage(null));
  return data;
}
