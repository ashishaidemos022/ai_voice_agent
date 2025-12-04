/*
  # Update Supabase Auth site URL

  ## Summary
  - Ensure magic-link emails point to the deployed Vercel domain instead of localhost
*/

SELECT auth.set_config('SITE_URL', 'https://ai-voice-agent-sage.vercel.app/');
