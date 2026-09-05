(function () {
  const config = window.RECORDARE_SUPABASE_CONFIG || {};
  const isSupabaseConfigured = Boolean(config.url && config.anonKey);

  function createSupabaseClient() {
    if (!isSupabaseConfigured) return null;
    const createClient = window.RECORDARE_SUPABASE_VENDOR?.createClient;
    if (!createClient) throw new Error("Supabase client bundle is unavailable");
    return createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  window.RECORDARE_SUPABASE = { createSupabaseClient, isSupabaseConfigured };
})();
