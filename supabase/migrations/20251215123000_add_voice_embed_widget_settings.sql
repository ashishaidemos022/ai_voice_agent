/*
  # Voice embed widget settings

  ## Summary
  - Add loader widget sizing and button image fields to voice embeds.
*/

ALTER TABLE public.va_voice_embeds
  ADD COLUMN IF NOT EXISTS widget_width integer,
  ADD COLUMN IF NOT EXISTS widget_height integer,
  ADD COLUMN IF NOT EXISTS button_image_url text;
