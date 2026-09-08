import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  (() => {
    try {
      const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
      return String(keys.service_role || keys.default || "");
    } catch {
      return "";
    }
  })();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase service configuration is missing.");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function getSecret(name: string) {
  const { data, error } = await db.rpc("get_manager_notification_secret", { p_name: name });
  if (error || !data) throw new Error(`Notification secret missing: ${name}`);
  return String(data);
}

async function managerUser(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("AUTH_REQUIRED");
  const { data: authData, error: authError } = await db.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) throw new Error("AUTH_REQUIRED");
  const { data: profile, error: profileError } = await db
    .from("manager_profiles")
    .select("id,is_active,role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile?.is_active || !["admin", "staff"].includes(profile.role)) {
    throw new Error("MANAGER_REQUIRED");
  }
  return user;
}

function pushSubscription(row: { endpoint: string; p256dh: string; auth: string }) {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };
}

async function configureWebPush() {
  const [publicKey, privateKey] = await Promise.all([
    getSecret("manager_vapid_public_key"),
    getSecret("manager_vapid_private_key"),
  ]);
  webpush.setVapidDetails("mailto:notifications@re-cordare.jp", publicKey, privateKey);
  return publicKey;
}

async function sendPayload(
  subscriptions: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
  payload: Record<string, unknown>,
) {
  if (!subscriptions.length) return { sent: 0, failed: 0 };
  await configureWebPush();
  let sent = 0;
  let failed = 0;
  const body = JSON.stringify(payload);
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(pushSubscription(subscription), body, { TTL: 86400 });
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
      console.error("Manager push failed", { statusCode, message: String((error as Error)?.message || error) });
      if ([404, 410].includes(statusCode)) {
        await db
          .from("manager_push_subscriptions")
          .update({ enabled: false, updated_at: new Date().toISOString() })
          .eq("id", subscription.id);
      }
    }
  }
  return { sent, failed };
}

function jstDateKey(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function sendDueNotifications(req: Request) {
  const requestSecret = req.headers.get("x-cron-secret") || "";
  const expectedSecret = await getSecret("manager_notification_cron_secret");
  if (!requestSecret || requestSecret !== expectedSecret) {
    return jsonResponse({ error: "Not allowed" }, 403);
  }

  const [
    { data: subscriptions, error: subscriptionError },
    { data: profiles, error: profileError },
    { data: preferences, error: preferenceError },
    { data: chemicals, error: chemicalError },
    { data: purchaseOrders, error: purchaseOrderError },
  ] = await Promise.all([
    db.from("manager_push_subscriptions").select("id,user_id,endpoint,p256dh,auth").eq("enabled", true),
    db.from("manager_profiles").select("id").eq("is_active", true).in("role", ["admin", "staff"]),
    db.from("manager_notification_preferences").select("user_id,stock_enabled,purchase_reminder_enabled,purchase_reminder_days"),
    db.from("recordare_chemicals")
      .select("id,current_stock,reorder_threshold,status,chemical_catalog_products(manufacturer,product_name)")
      .eq("status", "active"),
    db.from("chemical_purchase_orders")
      .select("id,recordare_chemical_id,capacity,quantity,status,planned_on")
      .in("status", ["planned", "ordered"]),
  ]);

  const loadError = subscriptionError || profileError || preferenceError || chemicalError || purchaseOrderError;
  if (loadError) throw loadError;

  const activeUsers = new Set((profiles || []).map((item) => item.id));
  const subsByUser = new Map<string, Array<{ id: string; endpoint: string; p256dh: string; auth: string }>>();
  for (const subscription of subscriptions || []) {
    if (!activeUsers.has(subscription.user_id)) continue;
    if (!subsByUser.has(subscription.user_id)) subsByUser.set(subscription.user_id, []);
    subsByUser.get(subscription.user_id)!.push(subscription);
  }
  if (!subsByUser.size) return jsonResponse({ ok: true, sent: 0, reason: "no_subscriptions" });

  const prefByUser = new Map((preferences || []).map((item) => [item.user_id, item]));
  const orderedInbound = new Map<string, number>();
  for (const order of purchaseOrders || []) {
    if (order.status !== "ordered") continue;
    const total = Number(order.capacity || 0) * Number(order.quantity || 0);
    orderedInbound.set(order.recordare_chemical_id, (orderedInbound.get(order.recordare_chemical_id) || 0) + total);
  }

  const stockAlerts = (chemicals || []).filter((chemical) => {
    if (chemical.current_stock == null || chemical.reorder_threshold == null) return false;
    const current = Number(chemical.current_stock);
    const threshold = Number(chemical.reorder_threshold);
    const inbound = orderedInbound.get(chemical.id) || 0;
    return current <= threshold && current + inbound <= threshold;
  });

  const today = jstDateKey();
  let totalSent = 0;
  let totalFailed = 0;

  for (const [userId, userSubscriptions] of subsByUser.entries()) {
    const pref = prefByUser.get(userId) || {
      stock_enabled: true,
      purchase_reminder_enabled: true,
      purchase_reminder_days: 3,
    };
    const reminderDays = Math.max(1, Math.min(30, Number(pref.purchase_reminder_days || 3)));
    const overdueCutoff = addDays(today, -reminderDays);
    const overduePlans = (purchaseOrders || []).filter(
      (order) => order.status === "planned" && String(order.planned_on || "") <= overdueCutoff,
    );
    const userStockAlerts = pref.stock_enabled ? stockAlerts : [];
    const userOverduePlans = pref.purchase_reminder_enabled ? overduePlans : [];

    if (!userStockAlerts.length && !userOverduePlans.length) continue;

    const { data: existingDelivery } = await db
      .from("manager_notification_deliveries")
      .select("id,status")
      .eq("user_id", userId)
      .eq("notification_date", today)
      .eq("kind", "chemical_morning_summary")
      .maybeSingle();
    if (existingDelivery?.status === "sent") continue;

    let body = "";
    if (userStockAlerts.length && userOverduePlans.length) {
      body = `在庫アラート ${userStockAlerts.length}件・購入予定の未注文 ${userOverduePlans.length}件があります。`;
    } else if (userStockAlerts.length) {
      body = `在庫アラートが ${userStockAlerts.length}件あります。ケミカル在庫を確認してください。`;
    } else {
      body = `購入予定の未注文が ${userOverduePlans.length}件あります。購入予定一覧を確認してください。`;
    }

    const result = await sendPayload(userSubscriptions, {
      title: "RE:CORDARE Manager",
      body,
      tag: "recordare-manager-chemical-alert",
      data: { url: "/manager" },
    });

    totalSent += result.sent;
    totalFailed += result.failed;
    const status = result.sent > 0 ? "sent" : "failed";
    const details = {
      stock_count: userStockAlerts.length,
      purchase_reminder_count: userOverduePlans.length,
      sent_count: result.sent,
      failed_count: result.failed,
    };
    await db.from("manager_notification_deliveries").upsert(
      {
        user_id: userId,
        notification_date: today,
        kind: "chemical_morning_summary",
        status,
        details,
      },
      { onConflict: "user_id,notification_date,kind" },
    );
  }

  return jsonResponse({ ok: true, sent: totalSent, failed: totalFailed, date: today });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "send-due") return await sendDueNotifications(req);

    const user = await managerUser(req);

    if (action === "vapid-public-key") {
      const publicKey = await getSecret("manager_vapid_public_key");
      return jsonResponse({ publicKey });
    }

    if (action === "status") {
      const [{ count, error: countError }, { data: pref, error: prefError }] = await Promise.all([
        db.from("manager_push_subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("enabled", true),
        db.from("manager_notification_preferences")
          .select("stock_enabled,purchase_reminder_enabled,purchase_reminder_days")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      if (countError || prefError) throw countError || prefError;
      return jsonResponse({
        enabled: Number(count || 0) > 0,
        subscriptionCount: Number(count || 0),
        preferences: pref || {
          stock_enabled: true,
          purchase_reminder_enabled: true,
          purchase_reminder_days: 3,
        },
      });
    }

    if (action === "subscribe") {
      const subscription = body?.subscription || {};
      const endpoint = String(subscription?.endpoint || "").trim();
      const p256dh = String(subscription?.keys?.p256dh || "").trim();
      const auth = String(subscription?.keys?.auth || "").trim();
      if (!endpoint || !p256dh || !auth) return jsonResponse({ error: "Invalid subscription" }, 400);

      const { error } = await db.from("manager_push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh,
          auth,
          enabled: true,
          user_agent: String(req.headers.get("user-agent") || "").slice(0, 500),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
      if (error) throw error;
      await db.from("manager_notification_preferences").upsert(
        { user_id: user.id, updated_at: new Date().toISOString() },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
      return jsonResponse({ ok: true });
    }

    if (action === "unsubscribe") {
      const endpoint = String(body?.endpoint || "").trim();
      let query = db
        .from("manager_push_subscriptions")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);
      if (endpoint) query = query.eq("endpoint", endpoint);
      const { error } = await query;
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (action === "test") {
      const { data: rows, error } = await db
        .from("manager_push_subscriptions")
        .select("id,endpoint,p256dh,auth")
        .eq("user_id", user.id)
        .eq("enabled", true);
      if (error) throw error;
      const result = await sendPayload(rows || [], {
        title: "RE:CORDARE Manager",
        body: "通知テストです。在庫・購入予定の通知をこの端末で受け取れます。",
        tag: "recordare-manager-test",
        data: { url: "/manager" },
      });
      return jsonResponse({ ok: true, ...result });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    const message = String((error as Error)?.message || error);
    console.error("manager-notifications error", message);
    if (message === "AUTH_REQUIRED") return jsonResponse({ error: "ログインが必要です。" }, 401);
    if (message === "MANAGER_REQUIRED") return jsonResponse({ error: "Manager権限がありません。" }, 403);
    return jsonResponse({ error: message }, 500);
  }
});
