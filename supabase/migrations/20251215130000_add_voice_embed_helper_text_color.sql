/*
  # Voice embed helper text color

  ## Summary
  - Add helper_text_color to voice embed appearance fields.
*/

ALTER TABLE public.va_voice_embeds
  ADD COLUMN IF NOT EXISTS helper_text_color text;
