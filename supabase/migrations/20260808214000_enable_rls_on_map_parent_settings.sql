/*
  # Protect MAP parent settings with row-level security

  Direct access remains restricted to postgres and service_role. Parent PIN
  verification continues through the existing SECURITY DEFINER RPC.
*/

ALTER TABLE public.map_parent_settings ENABLE ROW LEVEL SECURITY;
