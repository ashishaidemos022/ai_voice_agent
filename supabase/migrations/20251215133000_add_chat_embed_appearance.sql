/*
  # Chat embed appearance settings

  ## Summary
  - Add optional appearance and widget settings fields to chat embeds.
*/

ALTER TABLE public.va_agent_embeds
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS brand_name text,
  ADD COLUMN IF NOT EXISTS accent_color text,
  ADD COLUMN IF NOT EXISTS background_color text,
  ADD COLUMN IF NOT EXISTS surface_color text,
  ADD COLUMN IF NOT EXISTS text_color text,
  ADD COLUMN IF NOT EXISTS button_color text,
  ADD COLUMN IF NOT EXISTS button_text_color text,
  ADD COLUMN IF NOT EXISTS helper_text_color text,
  ADD COLUMN IF NOT EXISTS corner_radius integer,
  ADD COLUMN IF NOT EXISTS font_family text,
  ADD COLUMN IF NOT EXISTS wave_color text,
  ADD COLUMN IF NOT EXISTS bubble_color text,
  ADD COLUMN IF NOT EXISTS logo_background_color text,
  ADD COLUMN IF NOT EXISTS widget_width integer,
  ADD COLUMN IF NOT EXISTS widget_height integer,
  ADD COLUMN IF NOT EXISTS button_image_url text;
