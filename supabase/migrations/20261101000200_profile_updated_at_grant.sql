-- Listener self-service profile updates also touch updated_at.
grant update (updated_at) on public.profiles to authenticated;
