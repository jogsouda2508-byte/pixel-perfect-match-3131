/** What the Follow button on a profile / list row should do next. */
export type FollowAction = "follow" | "unfollow" | "cancel";

/**
 * - already following            -> unfollow
 * - request waiting for approval -> cancel the request
 * - otherwise                    -> follow (the database turns this into a request for private accounts)
 */
export function nextFollowAction(following: boolean, requested: boolean): FollowAction {
  if (following) return "unfollow";
  if (requested) return "cancel";
  return "follow";
}

/** Button text for the three states. */
export function followLabel(
  following: boolean,
  requested: boolean,
): "Following" | "Requested" | "Follow" {
  if (following) return "Following";
  if (requested) return "Requested";
  return "Follow";
}

/**
 * Whether a viewer is locked out of an account's posts: the account is private, it is not their
 * own, and they are not (yet) following it.
 */
export function isProfileLocked(args: {
  isPrivate: boolean;
  isMe: boolean;
  following: boolean;
}): boolean {
  return args.isPrivate && !args.isMe && !args.following;
}
