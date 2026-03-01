/*
  # Update provider key grants for multi-provider keys

  ## Summary
  - Keep encrypted_key hidden from general SELECT
  - Ensure authenticated users can CRUD their own rows via RLS
  - Align insert/update grants for multi-provider writes
*/

REVOKE ALL ON public.va_provider_keys FROM authenticated;

GRANT SELECT (id, user_id, provider, key_alias, last_four, created_at, updated_at)
  ON public.va_provider_keys TO authenticated;

GRANT INSERT (user_id, provider, key_alias, encrypted_key, last_four)
  ON public.va_provider_keys TO authenticated;

GRANT UPDATE (provider, key_alias, encrypted_key, last_four, updated_at)
  ON public.va_provider_keys TO authenticated;

GRANT DELETE ON public.va_provider_keys TO authenticated;

DROP POLICY IF EXISTS va_provider_keys_owner ON public.va_provider_keys;

CREATE POLICY va_provider_keys_owner
  ON public.va_provider_keys
  FOR ALL
  TO authenticated
  USING (user_id = public.current_va_user_id())
  WITH CHECK (user_id = public.current_va_user_id());
