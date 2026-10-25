// Hand-written types for the tables used by the app.
// (Can be replaced by `supabase gen types typescript` output later.)
export type Profile = {
  id: string;
  full_name: string;
  username: string;
  bio: string | null;
  location: string | null;
  avatar_url: string | null;
  interests: string[];
  account_type: "personal" | "business";
  onboarding_completed: boolean;
  /** Private accounts need follow requests to be accepted (needs 20261021000000_private_accounts.sql). */
  is_private: boolean;
  notifications_seen_at: string;
  created_at: string;
};

export type ProfileUpdate = Partial<Omit<Profile, "id" | "created_at">>;

export type Audience = "Public" | "Friends" | "Local Community";

export type PostRow = {
  id: string;
  author_id: string;
  content: string;
  image_url: string | null;
  audience: Audience;
  created_at: string;
  media_type: "image" | "video";
  video_url: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  /** Optional location (needs 20261019000000_post_location_tags.sql). Rows from a database
   *  that has not run it omit these, so treat missing as "no location". */
  location_place_id?: string | null;
  location_name?: string | null;
  location_address?: string | null;
  location_city?: string | null;
};

/** A person tagged in a post (id is the stable reference; the rest is display data). */
export type TaggedPerson = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
};

export type CommentRow = {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
};

export type StoryRow = {
  id: string;
  author_id: string;
  /** null for video stories */
  image_url: string | null;
  created_at: string;
  media_type: "image" | "video";
  video_url: string | null;
  /** all segments of one video upload share this id */
  upload_id: string | null;
  segment_index: number;
  segment_count: number;
  /** the part of video_url (in seconds) that this story plays */
  segment_start: number;
  segment_end: number | null;
  duration_seconds: number | null;
};

/** One row of `story_views`: someone who viewed a story, and whether they liked it */
export type StoryViewRow = {
  story_id: string;
  viewer_id: string;
  viewed_at: string;
  liked: boolean;
  liked_at: string | null;
  /** when they FIRST liked it; set by the database, drives the "liked your story" notification */
  first_liked_at: string | null;
};

/** One row of `get_story_viewers` (only the story's author gets rows) */
export type StoryViewerRow = {
  viewer_id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  viewed_at: string;
  liked: boolean;
  liked_at: string | null;
};

/** One row of `get_story_engagement` */
export type StoryEngagementRow = {
  story_id: string;
  view_count: number;
  like_count: number;
  liked_by_me: boolean;
};

/** One row of `get_localities` */
export type LocalityRow = { locality: string; people: number };

/** One row of `get_feed` */
export type FeedRow = {
  id: string;
  author_id: string;
  content: string;
  image_url: string | null;
  audience: Audience;
  created_at: string;
  author_name: string;
  author_username: string;
  author_avatar: string | null;
  author_account_type: "personal" | "business";
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  /** Video columns (get_feed / get_saved_posts). Rows from a database that has not yet
   *  run 20261016000000_video_share_feed.sql omit them, so treat missing as an image post. */
  media_type: "image" | "video";
  video_url: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  /** Filled in by the app after the feed loads (see lib/post-extras.ts). */
  location_place_id?: string | null;
  location_name?: string | null;
  location_address?: string | null;
  location_city?: string | null;
  tagged_people?: TaggedPerson[];
};

export type VideoFeedRow = FeedRow & {
  media_type: "video";
  video_url: string;
  thumbnail_url: string | null;
  duration_seconds: number;
  is_following: boolean;
};

/** One row of `get_people` */
export type PersonRow = {
  id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  account_type: "personal" | "business";
  mutual_count: number;
  is_following: boolean;
};

export type TrendingRow = { tag: string; uses: number };

/** One row of `get_saved_posts` (same shape as the feed, plus when it was saved) */
export type SavedFeedRow = FeedRow & { saved_at: string };

export type GroupRow = {
  id: string;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
  is_private: boolean;
};

/** Up to three members shown as overlapping photos on a group's icon */
export type MemberPreview = { name: string; avatar_url: string | null };

/** One row of `get_groups` */
export type GroupListRow = GroupRow & {
  member_count: number;
  is_member: boolean;
  my_role: "admin" | "member" | null;
  has_invite: boolean;
  conversation_id: string | null;
  member_preview: MemberPreview[];
};

/** One row of `get_my_group_invites` */
export type GroupInviteRow = {
  group_id: string;
  group_name: string;
  description: string;
  is_private: boolean;
  member_count: number;
  invited_by: string;
  inviter_name: string;
  inviter_username: string;
  inviter_avatar: string | null;
  created_at: string;
  member_preview: MemberPreview[];
};

/** One row of `get_group_members` */
export type GroupMemberRow = {
  user_id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  role: "admin" | "member";
  joined_at: string;
};

/** One row of `get_notifications` */
export type NotificationRow = {
  kind:
    | "like"
    | "comment"
    | "follow"
    | "share"
    | "tag"
    | "story_like"
    | "follow_request"
    | "follow_accepted";
  actor_id: string;
  actor_name: string;
  actor_username: string;
  actor_avatar: string | null;
  post_id: string | null;
  snippet: string | null;
  created_at: string;
  i_follow_actor: boolean;
  conversation_id: string | null;
};

export type ConversationRow = {
  id: string;
  created_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  group_id: string | null;
};

export type ConversationParticipantRow = {
  conversation_id: string;
  user_id: string;
  last_read_at: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  /** Set only by the share_post_to_user() RPC; null for ordinary messages. */
  shared_post_id: string | null;
  /** Set by send_story_reply() (needs 20261028000000_story_replies_polls_notes_voice.sql). */
  story_id?: string | null;
  story_thumb?: string | null;
  story_kind?: "reply" | "reaction" | null;
  /** Set by send_voice_message() (same migration). */
  audio_url?: string | null;
  audio_seconds?: number | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string; username: string };
        Update: ProfileUpdate;
        Relationships: [];
      };
      follows: {
        Row: { follower_id: string; following_id: string; created_at: string };
        Insert: {
          follower_id: string;
          following_id: string;
          created_at?: string;
        };
        Update: { created_at?: string };
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follows_following_id_fkey";
            columns: ["following_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: PostRow;
        Insert: {
          author_id: string;
          content?: string;
          image_url?: string | null;
          audience?: Audience;
          media_type?: "image" | "video";
          video_url?: string | null;
          thumbnail_url?: string | null;
          duration_seconds?: number | null;
          location_place_id?: string | null;
          location_name?: string | null;
          location_address?: string | null;
          location_city?: string | null;
        };
        Update: {
          content?: string;
          image_url?: string | null;
          media_type?: "image" | "video";
          video_url?: string | null;
          thumbnail_url?: string | null;
          duration_seconds?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      post_likes: {
        Row: { post_id: string; user_id: string; created_at: string };
        Insert: { post_id: string; user_id: string };
        Update: { created_at?: string };
        Relationships: [];
      };
      follow_requests: {
        Row: {
          requester_id: string;
          target_id: string;
          status: "pending" | "accepted";
          created_at: string;
          responded_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "follow_requests_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_requests_target_id_fkey";
            columns: ["target_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      story_likes: {
        Row: { story_id: string; user_id: string; created_at: string };
        Insert: { story_id: string; user_id: string };
        Update: { created_at?: string };
        Relationships: [
          {
            foreignKeyName: "story_likes_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      post_tags: {
        Row: {
          post_id: string;
          tagged_user_id: string;
          tagged_by: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "post_tags_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_tags_tagged_user_id_fkey";
            columns: ["tagged_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_tags_tagged_by_fkey";
            columns: ["tagged_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      post_comments: {
        Row: CommentRow;
        Insert: { post_id: string; author_id: string; content: string };
        Update: { content?: string };
        Relationships: [
          {
            foreignKeyName: "post_comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      stories: {
        Row: StoryRow;
        Insert: {
          author_id: string;
          image_url?: string | null;
          media_type?: "image" | "video";
          video_url?: string | null;
          upload_id?: string | null;
          segment_index?: number;
          segment_count?: number;
          segment_start?: number;
          segment_end?: number | null;
          duration_seconds?: number | null;
        };
        Update: { image_url?: string | null };
        Relationships: [
          {
            foreignKeyName: "stories_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      story_views: {
        Row: StoryViewRow;
        Insert: {
          story_id: string;
          viewer_id: string;
          liked?: boolean;
          liked_at?: string | null;
        };
        Update: { liked?: boolean; liked_at?: string | null };
        Relationships: [
          {
            foreignKeyName: "story_views_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_views_viewer_id_fkey";
            columns: ["viewer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      saved_posts: {
        Row: { user_id: string; post_id: string; created_at: string };
        Insert: { user_id: string; post_id: string };
        Update: { created_at?: string };
        Relationships: [];
      };
      groups: {
        Row: GroupRow;
        Insert: {
          name: string;
          description?: string;
          created_by: string;
          is_private?: boolean;
        };
        Update: { name?: string; description?: string };
        Relationships: [];
      };
      group_members: {
        Row: {
          group_id: string;
          user_id: string;
          role: "admin" | "member";
          created_at: string;
        };
        Insert: { group_id: string; user_id: string; role?: "member" };
        Update: { role?: "admin" | "member" };
        Relationships: [];
      };
      conversations: {
        Row: ConversationRow;
        Insert: {
          id?: string;
          created_at?: string;
          last_message_at?: string | null;
          last_message_preview?: string | null;
        };
        Update: {
          last_message_at?: string | null;
          last_message_preview?: string | null;
        };
        Relationships: [];
      };
      conversation_participants: {
        Row: ConversationParticipantRow;
        Insert: {
          conversation_id: string;
          user_id: string;
          last_read_at?: string;
        };
        Update: { last_read_at?: string };
        Relationships: [];
      };
      messages: {
        Row: MessageRow;
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_username_available: { Args: { p_username: string }; Returns: boolean };
      get_login_email: { Args: { p_username: string }; Returns: string | null };
      get_feed: {
        Args: {
          p_tab: string;
          p_search: string | null;
          p_limit: number;
          p_before: string | null;
          /** the picked locality for the Local tab; omit to use the profile's own location */
          p_location?: string;
        };
        Returns: FeedRow[];
      };
      save_push_subscription: {
        Args: {
          p_endpoint: string;
          p_p256dh: string;
          p_auth: string;
          p_user_agent?: string;
        };
        Returns: undefined;
      };
      record_story_view: { Args: { p_story_id: string }; Returns: undefined };
      set_story_like: {
        Args: { p_story_id: string; p_liked: boolean };
        /** the new liked state, or null when the story isn't available to me */
        Returns: boolean | null;
      };
      get_story_engagement: {
        Args: { p_story_ids: string[] };
        Returns: StoryEngagementRow[];
      };
      get_story_viewers: {
        Args: { p_story_id: string };
        Returns: StoryViewerRow[];
      };
      get_localities: { Args: { p_limit: number }; Returns: LocalityRow[] };
      get_people: {
        Args: {
          p_query: string | null;
          p_business_only: boolean;
          p_exclude_followed: boolean;
          p_limit: number;
        };
        Returns: PersonRow[];
      };
      get_trending_topics: {
        Args: { p_limit: number };
        Returns: TrendingRow[];
      };
      get_notifications: {
        Args: { p_limit: number };
        Returns: NotificationRow[];
      };
      get_unread_notification_count: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      get_unread_chat_count: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      get_saved_posts: {
        Args: { p_limit: number; p_before: string | null };
        Returns: SavedFeedRow[];
      };
      create_group: {
        Args: {
          p_name: string;
          p_description: string;
          p_is_private: boolean;
          p_invitees: string[];
        };
        Returns: string;
      };
      get_groups: {
        Args: {
          p_query: string | null;
          p_mine_only: boolean;
          p_limit: number;
          p_group?: string | null;
        };
        Returns: GroupListRow[];
      };
      invite_to_group: {
        Args: { p_group: string; p_users: string[] };
        Returns: number;
      };
      respond_group_invite: {
        Args: { p_group: string; p_accept: boolean };
        Returns: boolean;
      };
      join_group: { Args: { p_group: string }; Returns: undefined };
      leave_group: { Args: { p_group: string }; Returns: undefined };
      remove_group_member: {
        Args: { p_group: string; p_user: string };
        Returns: undefined;
      };
      get_my_group_invites: {
        Args: Record<string, never>;
        Returns: GroupInviteRow[];
      };
      get_group_members: {
        Args: { p_group: string };
        Returns: GroupMemberRow[];
      };
      get_video_feed: {
        Args: { p_limit: number; p_offset: number };
        Returns: VideoFeedRow[];
      };
      send_follow_request: { Args: { p_target: string }; Returns: string };
      cancel_follow_request: { Args: { p_target: string }; Returns: undefined };
      respond_follow_request: {
        Args: { p_requester: string; p_accept: boolean };
        Returns: string;
      };
      set_post_tags: {
        Args: { p_post_id: string; p_user_ids: string[] };
        Returns: number;
      };
      is_conversation_member: { Args: { conv: string }; Returns: boolean };
      get_or_create_dm: { Args: { other_user: string }; Returns: string };
      share_post_to_user: {
        Args: { p_post_id: string; p_recipient_id: string };
        Returns: string;
      };
      /** How many times a post was sent to someone (0 if I can't see the post). */
      get_post_share_count: { Args: { p_post_id: string }; Returns: number };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
