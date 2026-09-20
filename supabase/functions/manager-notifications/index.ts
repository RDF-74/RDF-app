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

function jstDateStartUtc(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+09:00`).toISOString();
}

const reservationCourseLabels: Record<string, string> = {
  rinseless: "リンスレス",
  maintenance: "メンテナンス",
  standard: "スタンダード",
  reset_coat: "リセット＆コート",
};

function reservationStartAt(reservation: { reservation_date?: string; start_time?: string }) {
  const date = String(reservation?.reservation_date || "").slice(0, 10);
  const time = String(reservation?.start_time || "").slice(0, 5);
  if (!date || !time) return null;
  const value = new Date(`${date}T${time}:00+09:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

async function verifyCronRequest(req: Request) {
  const requestSecret = req.headers.get("x-cron-secret") || "";
  const expectedSecret = await getSecret("manager_notification_cron_secret");
  return Boolean(requestSecret && requestSecret === expectedSecret);
}

async function activeManagerSubscriptions() {
  const [
    { data: subscriptions, error: subscriptionError },
    { data: profiles, error: profileError },
  ] = await Promise.all([
    db.from("manager_push_subscriptions").select("id,user_id,endpoint,p256dh,auth").eq("enabled", true),
    db.from("manager_profiles").select("id").eq("is_active", true).in("role", ["admin", "staff"]),
  ]);
  if (subscriptionError || profileError) throw subscriptionError || profileError;

  const activeUsers = new Set((profiles || []).map((item) => item.id));
  const result = new Map<string, Array<{ id: string; endpoint: string; p256dh: string; auth: string }>>();
  for (const subscription of subscriptions || []) {
    if (!activeUsers.has(subscription.user_id)) continue;
    if (!result.has(subscription.user_id)) result.set(subscription.user_id, []);
    result.get(subscription.user_id)!.push(subscription);
  }
  return result;
}

async function deliveryAlreadySent(userId: string, date: string, kind: string) {
  const { data, error } = await db
    .from("manager_notification_deliveries")
    .select("id,status")
    .eq("user_id", userId)
    .eq("notification_date", date)
    .eq("kind", kind)
    .maybeSingle();
  if (error) throw error;
  return data?.status === "sent";
}

async function recordDelivery(
  userId: string,
  date: string,
  kind: string,
  result: { sent: number; failed: number },
  details: Record<string, unknown>,
) {
  const { error } = await db.from("manager_notification_deliveries").upsert(
    {
      user_id: userId,
      notification_date: date,
      kind,
      status: result.sent > 0 ? "sent" : "failed",
      details: { ...details, sent_count: result.sent, failed_count: result.failed },
    },
    { onConflict: "user_id,notification_date,kind" },
  );
  if (error) throw error;
}

async function sendDayBeforeNotifications(req: Request, phase: string) {
  if (!(await verifyCronRequest(req))) return jsonResponse({ error: "Not allowed" }, 403);
  if (!["19", "21"].includes(phase)) return jsonResponse({ error: "Invalid phase" }, 400);

  const today = jstDateKey();
  const tomorrow = addDays(today, 1);
  const { data: reservations, error } = await db
    .from("reservations")
    .select("id,start_time,course_code,day_before_line_sent_at,customers(name),customer_vehicles(model)")
    .eq("is_active", true)
    .eq("status", "confirmed")
    .eq("reservation_date", tomorrow)
    .is("day_before_line_sent_at", null)
    .order("start_time", { ascending: true });
  if (error) throw error;
  if (!(reservations || []).length) return jsonResponse({ ok: true, sent: 0, due: 0 });

  const subsByUser = await activeManagerSubscriptions();
  const first = reservations![0];
  const customer = Array.isArray(first.customers) ? first.customers[0] : first.customers;
  const firstTime = String(first.start_time || "").slice(0, 5);
  const count = reservations!.length;
  const body = phase === "19"
    ? `明日の予約 ${count}件で前日確認LINEが未送信です。最初は${firstTime ? ` ${firstTime}〜` : ""} ${String(customer?.name || "お客様")}様です。`
    : `21時時点で、明日の予約の前日確認LINEが未送信のまま ${count}件あります。確認して送信してください。`;
  const kind = `reservation_day_before_${phase}`;

  let sent = 0;
  let failed = 0;
  for (const [userId, subscriptions] of subsByUser.entries()) {
    if (await deliveryAlreadySent(userId, today, kind)) continue;
    const result = await sendPayload(subscriptions, {
      title: "RE:CORDARE Manager",
      body,
      tag: `recordare-${kind}-${today}`,
      data: { url: "/manager" },
    });
    sent += result.sent;
    failed += result.failed;
    await recordDelivery(userId, today, kind, result, {
      phase,
      reservation_ids: reservations!.map((item) => item.id),
      due_count: count,
    });
  }
  return jsonResponse({ ok: true, sent, failed, due: count, phase });
}

async function sendStartNotifications(req: Request) {
  if (!(await verifyCronRequest(req))) return jsonResponse({ error: "Not allowed" }, 403);

  const now = new Date();
  const lower = new Date(now.getTime() + 119 * 60 * 1000);
  const upper = new Date(now.getTime() + 121 * 60 * 1000);
  const dateKeys = [...new Set([jstDateKey(lower), jstDateKey(upper)])];
  const { data: reservations, error } = await db
    .from("reservations")
    .select("id,reservation_date,start_time,course_code,customers(name),customer_vehicles(model)")
    .eq("is_active", true)
    .eq("status", "confirmed")
    .in("reservation_date", dateKeys)
    .order("reservation_date")
    .order("start_time");
  if (error) throw error;

  const due = (reservations || []).filter((reservation) => {
    const start = reservationStartAt(reservation);
    return Boolean(start && start.getTime() >= lower.getTime() && start.getTime() <= upper.getTime());
  });
  if (!due.length) return jsonResponse({ ok: true, sent: 0, due: 0 });

  const subsByUser = await activeManagerSubscriptions();
  const today = jstDateKey(now);
  let sent = 0;
  let failed = 0;

  for (const reservation of due) {
    const customer = Array.isArray(reservation.customers) ? reservation.customers[0] : reservation.customers;
    const vehicle = Array.isArray(reservation.customer_vehicles) ? reservation.customer_vehicles[0] : reservation.customer_vehicles;
    const time = String(reservation.start_time || "").slice(0, 5);
    const course = reservationCourseLabels[String(reservation.course_code || "")] || String(reservation.course_code || "");
    const kind = `reservation_start_2h_${reservation.id}`;
    const body = `${String(customer?.name || "お客様")}様の予約開始まで約2時間です。${time ? ` ${time}〜` : ""}${vehicle?.model ? ` / ${vehicle.model}` : ""}${course ? ` / ${course}` : ""}`;

    for (const [userId, subscriptions] of subsByUser.entries()) {
      if (await deliveryAlreadySent(userId, today, kind)) continue;
      const result = await sendPayload(subscriptions, {
        title: "RE:CORDARE Manager",
        body,
        tag: `recordare-${kind}`,
        data: { url: "/manager" },
      });
      sent += result.sent;
      failed += result.failed;
      await recordDelivery(userId, today, kind, result, {
        reservation_id: reservation.id,
        start_time: time,
      });
    }
  }

  return jsonResponse({ ok: true, sent, failed, due: due.length });
}

async function sendDueNotifications(req: Request) {
  const requestSecret = req.headers.get("x-cron-secret") || "";
  const expectedSecret = await getSecret("manager_notification_cron_secret");
  if (!requestSecret || requestSecret !== expectedSecret) {
    return jsonResponse({ error: "Not allowed" }, 403);
  }

  const today = jstDateKey();
  const yesterday = addDays(today, -1);
  const yesterdayStart = jstDateStartUtc(yesterday);
  const todayStart = jstDateStartUtc(today);

  const [
    { data: subscriptions, error: subscriptionError },
    { data: profiles, error: profileError },
    { data: preferences, error: preferenceError },
    { data: chemicals, error: chemicalError },
    { data: purchaseOrders, error: purchaseOrderError },
    { data: todayReservations, error: reservationError },
    { data: unpaidServices, error: unpaidServiceError },
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
    db.from("reservations")
      .select("id,start_time,day_before_line_sent_at,customers(name)")
      .eq("is_active", true)
      .eq("status", "confirmed")
      .eq("reservation_date", today)
      .is("day_before_line_sent_at", null)
      .order("start_time", { ascending: true }),
    db.from("service_records")
      .select("id,customer_name,actual_total,planned_total,actual_completed_at")
      .eq("is_active", true)
      .eq("status", "completed")
      .eq("payment_status", "unpaid")
      .gte("actual_completed_at", yesterdayStart)
      .lt("actual_completed_at", todayStart)
      .order("actual_completed_at", { ascending: true }),
  ]);

  const loadError = subscriptionError || profileError || preferenceError || chemicalError || purchaseOrderError || reservationError || unpaidServiceError;
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
    const unsentDayBefore = todayReservations || [];
    const userUnpaidServices = unpaidServices || [];

    if (!userStockAlerts.length && !userOverduePlans.length && !unsentDayBefore.length && !userUnpaidServices.length) continue;

    const { data: existingDelivery } = await db
      .from("manager_notification_deliveries")
      .select("id,status")
      .eq("user_id", userId)
      .eq("notification_date", today)
      .eq("kind", "chemical_morning_summary")
      .maybeSingle();
    if (existingDelivery?.status === "sent") continue;

    const summaryParts = [];
    if (userStockAlerts.length) summaryParts.push(`在庫アラート ${userStockAlerts.length}件`);
    if (userOverduePlans.length) summaryParts.push(`購入予定の未注文 ${userOverduePlans.length}件`);
    if (unsentDayBefore.length) summaryParts.push(`本日の予約で前日確認LINE未送信 ${unsentDayBefore.length}件`);
    if (userUnpaidServices.length) summaryParts.push(`昨日の施工で未払い ${userUnpaidServices.length}件`);
    const body = `${summaryParts.join("・")}があります。Managerで確認してください。`;

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
      day_before_unsent_count: unsentDayBefore.length,
      unpaid_service_count: userUnpaidServices.length,
      unpaid_service_ids: userUnpaidServices.map((item) => item.id),
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
    if (action === "reservation-day-before") return await sendDayBeforeNotifications(req, String(body?.phase || ""));
    if (action === "reservation-start-due") return await sendStartNotifications(req);

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
        body: "通知テストです。予約・施工後・未払い・在庫・購入予定の通知をこの端末で受け取れます。",
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
