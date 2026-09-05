const config = window.RECORDARE_SUPABASE_CONFIG || {};

export const isSupabaseConfigured = Boolean(config.url && config.anonKey);

export async function createSupabaseClient() {
  if (!isSupabaseConfigured) return null;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
