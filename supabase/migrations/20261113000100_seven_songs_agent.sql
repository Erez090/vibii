-- Vibii v0.4: seven-song first album, and the "agent" provider mode — a local Claude Code agent that
-- creates each song with the operator's own Suno account (Suno MCP), downloads it, and delivers it.

alter table public.generation_requests drop constraint if exists generation_requests_slot_check;
alter table public.generation_requests add constraint generation_requests_slot_check check (slot between 1 and 7);

alter table public.generation_requests drop constraint if exists generation_requests_provider_mode_check;
alter table public.generation_requests add constraint generation_requests_provider_mode_check
  check (provider_mode in ('demo','manual','official_api','agent'));

alter table public.provider_configuration drop constraint if exists provider_configuration_mode_check;
alter table public.provider_configuration add constraint provider_configuration_mode_check
  check (mode in ('demo','manual','official_api','agent'));

alter table public.tracks drop constraint if exists tracks_source_check;
alter table public.tracks add constraint tracks_source_check
  check (source in ('demo_fixture','suno_manual','operator_upload','suno_api','suno_agent'));

-- A seven-song album is seven provider calls; the old defaults (20/day, 2 in flight) fit five-song albums.
update public.provider_configuration
   set daily_call_cap = greatest(daily_call_cap, 35), max_concurrency = greatest(max_concurrency, 3), updated_at = now()
 where id = 1;
