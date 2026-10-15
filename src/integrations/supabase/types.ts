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
  image_url: string;
  created_at: string;
};

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
};

/** One row of `get_groups` */
export type GroupListRow = GroupRow & {
  member_count: number;
  is_member: boolean;
  my_role: "admin" | "member" | null;
};

/** One row of `get_notifications` */
export type NotificationRow = {
  kind: "like" | "comment" | "follow";
  actor_id: string;
  actor_name: string;
  actor_username: string;
  actor_avatar: string | null;
  post_id: string | null;
  snippet: string | null;
  created_at: string;
  i_follow_actor: boolean;
};

export type ConversationRow = {
  id: string;
  created_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
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
        Insert: { follower_id: string; following_id: string; created_at?: string };
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
        Insert: { author_id: string; image_url: string };
        Update: { image_url?: string };
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
      saved_posts: {
        Row: { user_id: string; post_id: string; created_at: string };
        Insert: { user_id: string; post_id: string };
        Update: { created_at?: string };
        Relationships: [];
      };
      groups: {
        Row: GroupRow;
        Insert: { name: string; description?: string; created_by: string };
        Update: { name?: string; description?: string };
        Relationships: [];
      };
      group_members: {
        Row: { group_id: string; user_id: string; role: "admin" | "member"; created_at: string };
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
        Args: { p_tab: string; p_search: string | null; p_limit: number; p_before: string | null };
        Returns: FeedRow[];
      };
      get_people: {
        Args: {
          p_query: string | null;
          p_business_only: boolean;
          p_exclude_followed: boolean;
          p_limit: number;
        };
        Returns: PersonRow[];
      };
      get_trending_topics: { Args: { p_limit: number }; Returns: TrendingRow[] };
      get_notifications: { Args: { p_limit: number }; Returns: NotificationRow[] };
      get_unread_notification_count: { Args: Record<PropertyKey, never>; Returns: number };
      get_saved_posts: {
        Args: { p_limit: number; p_before: string | null };
        Returns: SavedFeedRow[];
      };
      create_group: { Args: { p_name: string; p_description: string }; Returns: string };
      get_groups: {
        Args: { p_query: string | null; p_mine_only: boolean; p_limit: number };
        Returns: GroupListRow[];
      };
      get_video_feed: {
        Args: { p_limit: number; p_offset: number };
        Returns: VideoFeedRow[];
      };
      is_conversation_member: { Args: { conv: string }; Returns: boolean };
      get_or_create_dm: { Args: { other_user: string }; Returns: string };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
