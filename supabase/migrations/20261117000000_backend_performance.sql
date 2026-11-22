-- =====================================================================
-- Backend performance: missing foreign-key indexes + a cheaper unread-notification count.
-- Safe to run more than once. Changes no data, no permission and no row-level-security rule.
-- Run in Supabase Dashboard -> SQL Editor (or `supabase db push`). Details and rollback:
-- docs/BACKEND-PERFORMANCE.md
--
-- 1. FOREIGN-KEY INDEXES. When a person is deleted, Postgres must find every row that points at
--    them in every child table. Where the pointing column had no index of its own that was a full
--    table scan per table (messages, post_comments, ...), so deleting one account got slower as
--    the app grew. The same indexes speed up "all rows by this person" reads and joins.
--    (Composite primary keys only help when the person column comes FIRST; the columns below were
--    second or not in a key at all. src/test/migration-perf.test.ts keeps it that way.)
-- 2. get_unread_notification_count() used to build the whole notification list (up to 100 rows,
--    sorted, joined to profiles, including a scan of every chat message that shared a post) just
--    to count it, and the home screen asks every 30 seconds. It now counts each kind directly.
--    Same rules as before: the same seven kinds, "shares" never count, only things newer than
--    profiles.notifications_seen_at, capped at 100 like the old list.
-- =====================================================================

-- ---- 1. foreign-key indexes -----------------------------------------
create index if not exists business_reviews_reviewer_id_idx        on public.business_reviews (reviewer_id);
create index if not exists community_alert_votes_user_id_idx       on public.community_alert_votes (user_id);
create index if not exists community_alerts_author_id_idx          on public.community_alerts (author_id);
create index if not exists community_answer_helpful_user_id_idx    on public.community_answer_helpful (user_id);
create index if not exists community_answers_author_id_idx         on public.community_answers (author_id);
create index if not exists community_event_rsvps_user_id_idx       on public.community_event_rsvps (user_id);
create index if not exists community_events_host_id_idx            on public.community_events (host_id);
create index if not exists community_poll_options_poll_id_idx      on public.community_poll_options (poll_id);
create index if not exists community_poll_votes_user_id_idx        on public.community_poll_votes (user_id);
create index if not exists community_poll_votes_option_id_idx      on public.community_poll_votes (option_id);
create index if not exists community_polls_author_id_idx           on public.community_polls (author_id);
create index if not exists community_questions_author_id_idx       on public.community_questions (author_id);
create index if not exists community_questions_accepted_answer_id_idx on public.community_questions (accepted_answer_id);
create index if not exists community_quiz_keys_option_id_idx       on public.community_quiz_keys (option_id);
create index if not exists community_skill_swaps_user_id_idx       on public.community_skill_swaps (user_id);
create index if not exists group_invites_invited_by_idx            on public.group_invites (invited_by);
create index if not exists groups_created_by_idx                   on public.groups (created_by);
create index if not exists message_reactions_user_id_idx           on public.message_reactions (user_id);
create index if not exists messages_sender_id_idx                  on public.messages (sender_id);
create index if not exists poll_votes_user_id_idx                  on public.poll_votes (user_id);
create index if not exists poll_votes_option_id_idx                 on public.poll_votes (option_id);
create index if not exists polls_created_by_idx                    on public.polls (created_by);
create index if not exists post_comments_author_id_idx             on public.post_comments (author_id);
create index if not exists post_tags_tagged_by_idx                 on public.post_tags (tagged_by);
create index if not exists post_video_views_viewer_id_idx          on public.post_video_views (viewer_id);
create index if not exists saved_posts_post_id_idx                 on public.saved_posts (post_id);
create index if not exists story_views_viewer_id_idx               on public.story_views (viewer_id);
-- ON DELETE SET NULL (not cascade): the report stays, the person is cleared. Most rows are null.
create index if not exists reports_target_user_id_idx
  on public.reports (target_user_id) where target_user_id is not null;

-- ---- 2. cheaper unread-notification count ---------------------------
create or replace function public.get_unread_notification_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select pr.id as uid, pr.notifications_seen_at as seen
    from public.profiles pr
    where pr.id = auth.uid()
  )
  select least(100, (
      -- likes on my posts
      (select count(*) from me
         join public.posts p on p.author_id = me.uid
         join public.post_likes l on l.post_id = p.id
        where l.user_id <> me.uid and l.created_at > me.seen)
      -- comments on my posts
    + (select count(*) from me
         join public.posts p on p.author_id = me.uid
         join public.post_comments c on c.post_id = p.id
        where c.author_id <> me.uid and c.created_at > me.seen)
      -- new followers
    + (select count(*) from me
         join public.follows f on f.following_id = me.uid
        where f.created_at > me.seen)
      -- tagged in a post
    + (select count(*) from me
         join public.post_tags t on t.tagged_user_id = me.uid
         join public.posts tp on tp.id = t.post_id
        where t.tagged_by <> me.uid and t.created_at > me.seen)
      -- likes on my stories
    + (select count(*) from me
         join public.stories st on st.author_id = me.uid
         join public.story_views v on v.story_id = st.id
        where v.viewer_id <> me.uid and v.liked
          and v.first_liked_at is not null and v.first_liked_at > me.seen)
      -- follow requests waiting for me
    + (select count(*) from me
         join public.follow_requests fr on fr.target_id = me.uid
        where fr.status = 'pending' and fr.created_at > me.seen)
      -- accounts I asked to follow that accepted me (while I still follow them)
    + (select count(*) from me
         join public.follow_requests fr on fr.requester_id = me.uid
        where fr.status = 'accepted'
          and coalesce(fr.responded_at, fr.created_at) > me.seen
          and exists (select 1 from public.follows f
                      where f.follower_id = me.uid and f.following_id = fr.target_id))
  ))::bigint;
$$;

revoke all on function public.get_unread_notification_count() from public, anon;
grant execute on function public.get_unread_notification_count() to authenticated;
