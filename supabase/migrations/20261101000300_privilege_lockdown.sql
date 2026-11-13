-- Supabase grants ALL on new public tables to anon/authenticated by default (exposed through its
-- REST API with the public anon key). Vibii talks to Postgres only from the server, so listeners get
-- exactly the reads RLS is designed for, plus the few self-service writes below — nothing else.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles, public.consent_records, public.onboarding_answers, public.vibes, public.music_references,
  public.playlists, public.generation_requests, public.generation_request_events, public.tracks, public.covers,
  public.playlist_items, public.feedback, public.listening_events, public.entitlements, public.usage_ledger
  to authenticated;
grant select (owner_id, started_at, completed_at, current_step, profile_version, updated_at) on public.onboarding_state to authenticated;
grant insert on public.feedback to authenticated;
grant update (display_name, ui_language, song_languages, last_tab, last_vibe, last_track_id, last_position_seconds, updated_at)
  on public.profiles to authenticated;

-- Answers are written only by the server (sanitised, with credit awards); no direct listener writes.
drop policy if exists own_write on public.onboarding_answers;
drop policy if exists own_insert on public.vibes;
drop policy if exists own_insert on public.music_references;
