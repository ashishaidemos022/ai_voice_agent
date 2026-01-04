/*
  # Fix Provider Key RLS Grants

  ## Summary
  - Allow authenticated users to insert/update/delete their own provider keys.
  - Keep select access limited to metadata columns.
  - Recreate the owner policy to ensure the RLS rule is present.
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
