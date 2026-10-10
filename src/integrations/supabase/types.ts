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
  created_at: string;
};

export type ProfileUpdate = Partial<Omit<Profile, "id" | "created_at">>;

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
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_username_available: { Args: { p_username: string }; Returns: boolean };
      get_login_email: { Args: { p_username: string }; Returns: string | null };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
