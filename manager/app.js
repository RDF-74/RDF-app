const app = document.getElementById("app");
const { createSupabaseClient, isSupabaseConfigured } = window.RECORDARE_SUPABASE;
const tabs = ["ホーム", "顧客", "予約", "施工", "フォロー"];
const buildSha = window.RECORDARE_MANAGER_BUILD?.sha || "unknown";
let supabase = null;
let profile = null;
let activeTab = "ホーム";

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);

function renderLogin(message = "", initializing = false) {
  app.innerHTML = `<section class="screen login-screen"><div><div class="brand">業務用管理画面</div><h1>RE:CORDARE Manager</h1><p class="muted">管理者アカウントでログインしてください。</p><form class="card" id="loginForm"><label for="email">メールアドレス</label><input id="email" name="email" type="email" autocomplete="email" required /><label for="password">パスワード</label><input id="password" name="password" type="password" autocomplete="current-password" required /><button class="primary" type="submit" ${isSupabaseConfigured && !initializing ? "" : "disabled"}>ログイン</button><p class="error ${message ? "" : "hidden"}" id="loginMessage">${escapeHtml(message)}</p>${isSupabaseConfigured ? "" : '<p class="muted">Supabase接続設定が未完了です。管理者に設定を依頼してください。</p>'}</form><a class="return-link" href="/">← Detailing Managerへ戻る</a></div></section>`;
  document.getElementById("loginForm")?.addEventListener("submit", signIn);
}

function renderManager() {
  const name = escapeHtml(profile?.display_name || "管理者");
  const content = activeTab === "ホーム" ? `<div class="card"><p class="welcome">${name}さん</p><h2>RE:CORDARE Manager</h2><p class="muted">Phase 1の管理画面基盤です。業務機能は今後追加されます。</p><a class="return-link" href="/">← Detailing Managerへ戻る</a></div>` : `<div id="managerContent">${activeTab === "顧客" || activeTab === "予約" || activeTab === "施工" ? '<div class="card placeholder"><p class="muted">読み込んでいます…</p></div>' : `<div class="card placeholder"><h2>${activeTab}</h2><p class="muted">この機能は準備中です。</p></div>`}</div>`;
  app.innerHTML = `<section class="screen"><header class="topbar"><div><div class="brand">RE:CORDARE Manager</div><h1>${activeTab}</h1></div><button class="icon-button" type="button" aria-label="設定" id="settingsButton">⚙</button></header>${content}</section><nav class="manager-nav" aria-label="管理メニュー">${tabs.map((tab) => `<button type="button" data-tab="${tab}" class="${tab === activeTab ? "active" : ""}">${tab}</button>`).join("")}</nav><div class="settings-panel hidden" id="settingsPanel"><div class="settings-box"><h2>設定</h2><p class="muted">管理者：${name}</p><p class="muted">Build: ${escapeHtml(buildSha)}</p><button class="secondary" type="button" id="signOutButton">ログアウト</button><button class="secondary" type="button" id="closeSettingsButton" style="margin-top:10px">閉じる</button></div></div>`;
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { activeTab = button.dataset.tab; renderManager(); }));
  document.getElementById("settingsButton").addEventListener("click", () => document.getElementById("settingsPanel").classList.remove("hidden"));
  document.getElementById("closeSettingsButton").addEventListener("click", () => document.getElementById("settingsPanel").classList.add("hidden"));
  document.getElementById("signOutButton").addEventListener("click", async () => { await supabase.auth.signOut(); profile = null; renderLogin(); });
  if (activeTab === "顧客") renderCustomerList();
  if (activeTab === "予約") renderReservationList();
  if (activeTab === "施工") renderServiceList();
}

const contactMethods = { line: "LINE", phone: "電話", other: "その他" };
const valueOf = (value) => escapeHtml(value || "");
const errorMessage = "保存できませんでした。入力内容と権限を確認してください。";
const emptyToNull = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};
const saveErrorMessage = (error) => error?.message ? `${errorMessage}（${error.message}）` : errorMessage;

function setCustomerContent(content) {
  const target = document.getElementById("managerContent");
  if (target) target.innerHTML = content;
}

async function renderCustomerList() {
  const { data, error } = await supabase.from("customers").select("id, name, phone, line_display_name, contact_method, updated_at").eq("is_active", true).order("name");
  if (activeTab !== "顧客") return;
  if (error) return setCustomerContent(`<div class="card"><p class="error">顧客一覧を読み込めませんでした。</p></div>`);
  const rows = data.length ? data.map((customer) => `<button class="customer-row" type="button" data-customer-id="${customer.id}"><span><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.line_display_name || customer.phone || contactMethods[customer.contact_method])}</small></span><span aria-hidden="true">›</span></button>`).join("") : '<div class="empty-state">まだ顧客が登録されていません。</div>';
  setCustomerContent(`<button class="primary add-button" type="button" id="newCustomerButton">＋ 顧客を登録</button><div class="customer-list">${rows}</div>`);
  document.getElementById("newCustomerButton").addEventListener("click", () => renderCustomerForm());
  document.querySelectorAll("[data-customer-id]").forEach((button) => button.addEventListener("click", () => renderCustomerDetail(button.dataset.customerId)));
}

function renderCustomerForm(customer = null) {
  const isEdit = Boolean(customer);
  setCustomerContent(`<form class="card form-card" id="customerForm"><h2>${isEdit ? "顧客情報を編集" : "新規顧客登録"}</h2><label for="customerName">顧客名</label><input id="customerName" name="name" required value="${valueOf(customer?.name)}" autocomplete="name" /><label for="customerPhone">電話番号</label><input id="customerPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${valueOf(customer?.phone)}" /><label for="customerLine">LINE表示名</label><input id="customerLine" name="line_display_name" value="${valueOf(customer?.line_display_name)}" /><label for="contactMethod">主な連絡手段</label><select id="contactMethod" name="contact_method">${Object.entries(contactMethods).map(([value, label]) => `<option value="${value}" ${customer?.contact_method === value || (!customer && value === "line") ? "selected" : ""}>${label}</option>`).join("")}</select><label for="customerNotes">備考</label><textarea id="customerNotes" name="notes" rows="4">${valueOf(customer?.notes)}</textarea><p class="error hidden" id="customerFormError"></p><button class="primary" type="submit">${isEdit ? "保存" : "登録して車両を追加"}</button><button class="text-button" type="button" id="cancelCustomerButton">キャンセル</button></form>`);
  document.getElementById("cancelCustomerButton").addEventListener("click", () => isEdit ? renderCustomerDetail(customer.id) : renderCustomerList());
  document.getElementById("customerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const fields = Object.fromEntries(new FormData(form));
    const values = {
      name: fields.name.trim(),
      phone: emptyToNull(fields.phone),
      line_display_name: emptyToNull(fields.line_display_name),
      contact_method: fields.contact_method,
      notes: emptyToNull(fields.notes),
    };
    button.disabled = true;
    button.textContent = "保存中…";
    try {
      const request = isEdit ? supabase.from("customers").update(values).eq("id", customer.id).select("id").single() : supabase.from("customers").insert(values).select("id").single();
      const { data, error } = await request;
      if (error || !data?.id) throw error || new Error("保存結果を確認できませんでした。");
      await renderCustomerDetail(data.id);
    } catch (error) {
      button.disabled = false;
      button.textContent = isEdit ? "保存" : "登録して車両を追加";
      const message = document.getElementById("customerFormError");
      message.textContent = saveErrorMessage(error);
      message.classList.remove("hidden");
    }
  });
}

async function renderCustomerDetail(customerId, returnToReservation = null) {
  setCustomerContent('<div class="card placeholder"><p class="muted">顧客を読み込んでいます…</p></div>');
  const [{ data: customer, error: customerError }, { data: vehicles, error: vehicleError }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", customerId).maybeSingle(),
    supabase.from("customer_vehicles").select("*").eq("customer_id", customerId).eq("is_active", true).order("created_at")
  ]);
  if (customerError || vehicleError || !customer) return setCustomerContent(`<div class="card"><p class="error">顧客情報を読み込めませんでした。</p><button class="secondary" type="button" id="backToCustomers">一覧へ戻る</button></div>`);
  const vehicleRows = vehicles.length ? vehicles.map((vehicle) => `<div class="vehicle-row"><div><strong>${escapeHtml(vehicle.manufacturer)} ${escapeHtml(vehicle.model)}</strong><small>${escapeHtml(vehicle.color)}${vehicle.plate_last4 ? ` ・ ${escapeHtml(vehicle.plate_last4)}` : ""}${vehicle.notes ? ` ・ ${escapeHtml(vehicle.notes)}` : ""}</small></div><button class="archive-button" type="button" data-archive-vehicle="${vehicle.id}">無効化</button></div>`).join("") : '<div class="empty-state">車両はまだ登録されていません。</div>';
  setCustomerContent(`<div class="card detail-card"><div class="detail-heading"><div><h2>${escapeHtml(customer.name)}</h2><p class="muted">${escapeHtml(contactMethods[customer.contact_method])}</p></div><button class="secondary compact-button" type="button" id="editCustomerButton">編集</button></div><dl><dt>電話番号</dt><dd>${escapeHtml(customer.phone || "未登録")}</dd><dt>LINE表示名</dt><dd>${escapeHtml(customer.line_display_name || "未登録")}</dd><dt>備考</dt><dd>${escapeHtml(customer.notes || "未登録")}</dd></dl><button class="text-button danger-text" type="button" id="archiveCustomerButton">この顧客を無効化</button></div><section class="card"><div class="detail-heading"><h2>車両</h2><button class="secondary compact-button" type="button" id="addVehicleButton">＋ 追加</button></div><div class="vehicle-list">${vehicleRows}</div><div id="vehicleFormArea"></div></section><button class="text-button" type="button" id="backToCustomers">${returnToReservation ? "← 予約へ戻る" : "← 顧客一覧へ戻る"}</button>`);
  document.getElementById("editCustomerButton").addEventListener("click", () => renderCustomerForm(customer));
  document.getElementById("backToCustomers").addEventListener("click", returnToReservation || renderCustomerList);
  document.getElementById("addVehicleButton").addEventListener("click", () => renderVehicleForm(customerId));
  document.getElementById("archiveCustomerButton").addEventListener("click", async () => {
    const { error } = await supabase.from("customers").update({ is_active: false }).eq("id", customerId);
    if (error) return alert(errorMessage);
    renderCustomerList();
  });
  document.querySelectorAll("[data-archive-vehicle]").forEach((button) => button.addEventListener("click", async () => {
    const { error } = await supabase.from("customer_vehicles").update({ is_active: false }).eq("id", button.dataset.archiveVehicle);
    if (error) return alert(errorMessage);
    renderCustomerDetail(customerId);
  }));
}

function renderVehicleForm(customerId) {
  const target = document.getElementById("vehicleFormArea");
  target.innerHTML = `<form class="vehicle-form" id="vehicleForm"><label for="manufacturer">メーカー</label><input id="manufacturer" name="manufacturer" required /><label for="model">車種</label><input id="model" name="model" required /><label for="color">色</label><input id="color" name="color" required /><label for="plateLast4">ナンバー下4桁</label><input id="plateLast4" name="plate_last4" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" /><label for="vehicleNotes">備考</label><textarea id="vehicleNotes" name="notes" rows="3"></textarea><p class="error hidden" id="vehicleFormError"></p><button class="primary" type="submit">車両を登録</button><button class="text-button" type="button" id="cancelVehicleButton">キャンセル</button></form>`;
  document.getElementById("cancelVehicleButton").addEventListener("click", () => { target.innerHTML = ""; });
  document.getElementById("vehicleForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const fields = Object.fromEntries(new FormData(form));
    const values = {
      customer_id: customerId,
      manufacturer: fields.manufacturer.trim(),
      model: fields.model.trim(),
      color: fields.color.trim(),
      plate_last4: emptyToNull(fields.plate_last4),
      notes: emptyToNull(fields.notes),
    };
    button.disabled = true;
    button.textContent = "保存中…";
    try {
      const { data, error } = await supabase.from("customer_vehicles").insert(values).select("id, customer_id").single();
      if (error || !data?.id || data.customer_id !== customerId) throw error || new Error("保存結果を確認できませんでした。");
      await renderCustomerDetail(customerId);
    } catch (error) {
      button.disabled = false;
      button.textContent = "車両を登録";
      const message = document.getElementById("vehicleFormError");
      message.textContent = saveErrorMessage(error);
      message.classList.remove("hidden");
    }
  });
}

const reservationCourses = { rinseless: "リンスレス", maintenance: "メンテナンス", standard: "スタンダード", reset_coat: "リセット＆コート" };
const reservationStatuses = { tentative: "仮予約", confirmed: "確定", completed: "完了", cancelled: "キャンセル" };
const reservationSizeClasses = {
  kei_compact: "軽・コンパクト",
  sedan_wagon: "セダン・ワゴン",
  suv: "SUV",
  minivan: "ミニバン",
  large_hiace: "大型・ハイエース",
};
const reservationCoursePrices = {
  kei_compact: { rinseless: 5000, maintenance: 4000, standard: 5500, reset_coat: 20000 },
  sedan_wagon: { rinseless: 5500, maintenance: 4500, standard: 6000, reset_coat: 23000 },
  suv: { rinseless: 6000, maintenance: 5000, standard: 6500, reset_coat: 25000 },
  minivan: { rinseless: 6500, maintenance: 5500, standard: 7000, reset_coat: 28000 },
  large_hiace: { rinseless: 7500, maintenance: 6000, standard: 8000, reset_coat: 32000 },
};
const reservationOptions = [
  { code: "front_glass_oil_repellent", label: "フロントガラス 油膜除去＋撥水", amount: 1000, starting: true },
  { code: "front_glass_scale", label: "フロントガラス ウロコ除去＋油膜除去＋撥水", amount: 2000, starting: true },
  { code: "all_glass_oil_repellent", label: "全面ガラス 油膜除去＋撥水", amount: 3000, starting: true },
  { code: "all_glass_scale", label: "全面ガラス ウロコ除去＋油膜除去＋撥水", amount: 0, consult: true },
  { code: "body_iron_removal", label: "ボディ鉄粉除去", amount: 2000, starting: true },
  { code: "wheel_scale_light", label: "ホイール スケール除去 軽度4本", amount: 2000, starting: true },
  { code: "wheel_scale_heavy", label: "ホイール スケール除去 重度4本", amount: 4000, starting: true },
  { code: "unpainted_resin_partial", label: "未塗装樹脂コーティング 部分施工", amount: 2000, starting: true },
  { code: "unpainted_resin_wide", label: "未塗装樹脂コーティング 広範囲", amount: 4000, starting: true },
];
const reservationDiscounts = [
  { code: "maintenance_30", label: "30日以内メンテナンス", amount: 1000, capped: true },
  { code: "maintenance_31_45", label: "31〜45日以内メンテナンス", amount: 500, capped: true },
  { code: "same_address_second", label: "同一住所2台目", amount: 500, capped: false },
  { code: "referral", label: "紹介割", amount: 500, capped: true },
  { code: "referrer_reward", label: "紹介者割", amount: 500, capped: true },
];
const reservationTravelZones = {
  within_10: { label: "10km以内", fee: 0 },
  km10_20: { label: "10〜20km", fee: 500 },
  km20_30: { label: "20〜30km", fee: 1000 },
  over_30: { label: "30km以上（要相談）", fee: 0 },
};
const reservationTimeDefaults = {
  rinseless: { prep: 15, service: 60, cleanup: 15 },
  maintenance: { prep: 15, service: 60, cleanup: 15 },
  standard: { prep: 15, service: 60, cleanup: 15 },
  reset_coat: { prep: 20, service: 180, cleanup: 20 },
};
let reservationFilter = "upcoming";
let serviceViewToken = 0;

const reservationDate = (value) => value ? String(value).slice(0, 10) : "";
const reservationTime = (value) => value ? String(value).slice(0, 5) : "";
const reservationVehicleName = (vehicle) => vehicle ? `${vehicle.manufacturer} ${vehicle.model}` : "車両未設定";
const reservationTimes = (reservation = {}) => {
  const defaults = reservationTimeDefaults[reservation.course_code] || reservationTimeDefaults.rinseless;
  const prep = reservation.planned_prep_minutes ?? defaults.prep;
  const service = reservation.planned_service_minutes ?? defaults.service;
  const cleanup = reservation.planned_cleanup_minutes ?? defaults.cleanup;
  const slot = reservation.planned_slot_minutes ?? (prep + service + cleanup);
  return { prep, service, cleanup, slot };
};
const addMinutesToTime = (time, minutes) => {
  if (!time) return "";
  const [hours, mins] = String(time).slice(0, 5).split(":").map(Number);
  const total = (hours * 60 + mins + Number(minutes || 0)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const yen = (value) => `¥${Number(value || 0).toLocaleString("ja-JP")}`;
const jsonArray = (value) => Array.isArray(value) ? value : [];
const setReservationContent = (content) => {
  const target = document.getElementById("managerContent");
  if (target) target.innerHTML = content;
};

async function renderReservationList() {
  const { data, error } = await supabase.from("reservations").select("id, customer_id, vehicle_id, course_code, reservation_date, start_time, status, notes, vehicle_size_class, selected_options, selected_discounts, travel_zone, base_price, options_total, travel_fee, discount_total, calculated_total, final_total, planned_prep_minutes, planned_service_minutes, planned_cleanup_minutes, planned_slot_minutes, customers(name), customer_vehicles(manufacturer, model, color, size_class)").eq("is_active", true).order("reservation_date", { ascending: true }).order("start_time", { ascending: true });
  if (activeTab !== "予約") return;
  if (error) return setReservationContent('<div class="card"><p class="error">予約一覧を読み込めませんでした。</p></div>');
  const today = new Date().toLocaleDateString("en-CA");
  const filtered = data.filter((reservation) => {
    if (reservationFilter === "today") return reservationDate(reservation.reservation_date) === today;
    if (reservationFilter === "upcoming") return reservationDate(reservation.reservation_date) >= today && reservation.status !== "cancelled";
    if (reservationFilter === "active") return reservation.status !== "cancelled";
    return true;
  });
  const rows = filtered.length ? filtered.map((reservation) => `<button class="reservation-row" type="button" data-reservation-id="${reservation.id}"><span><strong>${escapeHtml(reservationDate(reservation.reservation_date))} ${escapeHtml(reservationTime(reservation.start_time))}〜${escapeHtml(addMinutesToTime(reservation.start_time, reservationTimes(reservation).slot))}</strong><small>${escapeHtml(reservation.customers?.name || "顧客未設定")} ・ ${escapeHtml(reservationVehicleName(reservation.customer_vehicles))}</small><small>${escapeHtml(reservationCourses[reservation.course_code] || reservation.course_code)}${reservation.final_total != null ? ` ・ ${escapeHtml(yen(reservation.final_total))}` : ""}</small></span><span class="reservation-status">${escapeHtml(reservationStatuses[reservation.status] || reservation.status)}</span></button>`).join("") : '<div class="empty-state">該当する予約はありません。</div>';
  setReservationContent(`<button class="primary add-button" type="button" id="newReservationButton">＋ 予約を登録</button><div class="reservation-filters">${[["today", "今日"], ["upcoming", "今後"], ["all", "すべて"], ["active", "キャンセル除外"]].map(([value, label]) => `<button class="filter-button ${reservationFilter === value ? "active" : ""}" type="button" data-reservation-filter="${value}">${label}</button>`).join("")}</div><div class="customer-list">${rows}</div>`);
  document.getElementById("newReservationButton").addEventListener("click", () => renderReservationForm());
  document.querySelectorAll("[data-reservation-filter]").forEach((button) => button.addEventListener("click", () => { reservationFilter = button.dataset.reservationFilter; renderReservationList(); }));
  document.querySelectorAll("[data-reservation-id]").forEach((button) => button.addEventListener("click", () => renderReservationForm(data.find((reservation) => reservation.id === button.dataset.reservationId))));
}

async function loadReservationVehicles(customerId, selectedVehicleId = "", onReady = null) {
  const select = document.getElementById("reservationVehicle");
  if (!select) return;
  if (!customerId) {
    select.innerHTML = '<option value="">先に顧客を選択してください</option>';
    select.disabled = true;
    onReady?.([], "");
    return;
  }
  select.disabled = true;
  select.innerHTML = '<option value="">車両を読み込んでいます…</option>';
  const { data, error } = await supabase.from("customer_vehicles").select("id, manufacturer, model, color, size_class").eq("customer_id", customerId).eq("is_active", true).order("created_at");
  if (error || !data.length) {
    select.innerHTML = '<option value="">有効な車両がありません</option>';
    onReady?.([], "");
    return;
  }
  const autoSelected = selectedVehicleId || (data.length === 1 ? data[0].id : "");
  select.innerHTML = `<option value="">車両を選択</option>${data.map((vehicle) => `<option value="${vehicle.id}" ${vehicle.id === autoSelected ? "selected" : ""}>${escapeHtml(reservationVehicleName(vehicle))}（${escapeHtml(vehicle.color)}）</option>`).join("")}`;
  select.disabled = false;
  onReady?.(data, autoSelected);
}

async function renderReservationForm(reservation = null) {
  const isEdit = Boolean(reservation);
  const { data: customers, error } = await supabase.from("customers").select("id, name, phone, line_display_name").eq("is_active", true).order("name");
  if (error) return setReservationContent('<div class="card"><p class="error">顧客を読み込めませんでした。</p></div>');

  const selectedCustomer = customers.find((customer) => customer.id === reservation?.customer_id);
  const initialCustomerName = selectedCustomer?.name || "";
  const selectedOptions = new Map(jsonArray(reservation?.selected_options).map((item) => [item.code, Number(item.amount || 0)]));
  const selectedDiscounts = new Set(jsonArray(reservation?.selected_discounts).map((item) => item.code));
  const initialTravelZone = isEdit ? (reservation?.travel_zone || "") : "within_10";
  const initialTimes = reservationTimes(reservation || { course_code: "rinseless" });

  const optionMarkup = reservationOptions.map((option) => {
    const checked = selectedOptions.has(option.code);
    const amount = checked ? selectedOptions.get(option.code) : option.amount;
    const priceLabel = option.consult ? "要相談" : `${yen(option.amount)}${option.starting ? "〜" : ""}`;
    return `<div class="pricing-choice"><label class="pricing-choice-main"><input type="checkbox" data-option-code="${option.code}" ${checked ? "checked" : ""} /><span><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(priceLabel)}</small></span></label><div class="pricing-amount ${checked ? "" : "hidden"}" data-option-amount-wrap="${option.code}"><span>金額</span><input type="number" inputmode="numeric" min="0" step="100" value="${Number(amount || 0)}" data-option-amount="${option.code}" /></div></div>`;
  }).join("");

  const discountMarkup = reservationDiscounts.map((discount) => `<label class="pricing-choice pricing-choice-main"><input type="checkbox" data-discount-code="${discount.code}" ${selectedDiscounts.has(discount.code) ? "checked" : ""} /><span><strong>${escapeHtml(discount.label)}</strong><small>−${escapeHtml(yen(discount.amount))}${discount.capped ? "（通常割引）" : "（別枠）"}</small></span></label>`).join("");

  setReservationContent(`<form class="card form-card" id="reservationForm"><h2>${isEdit ? "予約を編集" : "新規予約"}</h2><label for="reservationCustomerSearch">顧客</label><input id="reservationCustomerSearch" type="search" placeholder="顧客名で検索" autocomplete="off" value="${valueOf(initialCustomerName)}" required /><input id="reservationCustomerId" type="hidden" value="${valueOf(reservation?.customer_id)}" /><div class="picker-results" id="reservationCustomerResults"></div><button class="text-button ${reservation?.customer_id ? "" : "hidden"}" type="button" id="viewReservationCustomer">顧客詳細を見る</button><label for="reservationVehicle">車両</label><select id="reservationVehicle" name="vehicle_id" required disabled><option value="">先に顧客を選択してください</option></select><label for="reservationSizeClass">車両区分</label><select id="reservationSizeClass" name="vehicle_size_class" required><option value="">車両区分を選択</option>${Object.entries(reservationSizeClasses).map(([value, label]) => `<option value="${value}" ${reservation?.vehicle_size_class === value ? "selected" : ""}>${label}</option>`).join("")}</select><p class="muted">一度選んだ車両区分は車両情報にも保存し、次回から自動入力します。</p><label for="reservationCourse">コース</label><select id="reservationCourse" name="course_code" required>${Object.entries(reservationCourses).map(([value, label]) => `<option value="${value}" ${reservation?.course_code === value ? "selected" : ""}>${label}</option>`).join("")}</select><div class="time-planning-group"><div class="pricing-group-title">予定時間</div><div class="time-grid"><label>準備<input id="reservationPrepMinutes" name="planned_prep_minutes" type="number" inputmode="numeric" min="0" step="5" value="${initialTimes.prep}" /></label><label>施工<input id="reservationServiceMinutes" name="planned_service_minutes" type="number" inputmode="numeric" min="0" step="5" value="${initialTimes.service}" /></label><label>片付け<input id="reservationCleanupMinutes" name="planned_cleanup_minutes" type="number" inputmode="numeric" min="0" step="5" value="${initialTimes.cleanup}" /></label></div><div class="time-summary"><span>予約枠 <strong id="reservationSlotMinutes">${initialTimes.slot}分</strong></span><span>終了予定 <strong id="reservationEndTime">--:--</strong></span></div><p class="muted">準備＋施工＋片付けを予約枠として確保します。移動時間は含みません。</p></div><div class="pricing-group"><div class="pricing-group-title">オプション</div>${optionMarkup}</div><div class="pricing-group"><div class="pricing-group-title">割引</div><p class="muted">通常割引は合計最大¥1,000。同一住所2台目割は別枠です。</p>${discountMarkup}</div><label for="reservationTravelZone">出張距離</label><select id="reservationTravelZone" name="travel_zone" required><option value="">出張距離を選択</option>${Object.entries(reservationTravelZones).map(([value, item]) => `<option value="${value}" ${initialTravelZone === value ? "selected" : ""}>${escapeHtml(item.label)}${item.fee ? `（+${escapeHtml(yen(item.fee))}）` : ""}</option>`).join("")}</select><div class="price-summary"><div class="price-line"><span>基本料金</span><strong id="priceBase">¥0</strong></div><div class="price-line"><span>オプション</span><strong id="priceOptions">¥0</strong></div><div class="price-line"><span>出張料</span><strong id="priceTravel">¥0</strong></div><div class="price-line"><span>割引</span><strong id="priceDiscount">−¥0</strong></div><div class="price-line price-calculated"><span>自動計算</span><strong id="priceCalculated">¥0</strong></div><label for="reservationFinalTotal">予定合計（手動調整可）</label><input id="reservationFinalTotal" name="final_total" type="number" inputmode="numeric" min="0" step="100" value="${reservation?.final_total ?? ""}" required /><p class="muted">「〜」料金・要相談メニューは実車確認後に予定合計を調整できます。</p></div><label for="reservationDate">施工日</label><input id="reservationDate" name="reservation_date" type="date" required value="${valueOf(reservationDate(reservation?.reservation_date) || new Date().toLocaleDateString("en-CA"))}" /><label for="reservationTime">開始時間</label><input id="reservationTime" name="start_time" type="time" required value="${valueOf(reservationTime(reservation?.start_time))}" /><label for="reservationStatus">予約状態</label><select id="reservationStatus" name="status" required>${Object.entries(reservationStatuses).map(([value, label]) => `<option value="${value}" ${reservation?.status === value || (!reservation && value === "confirmed") ? "selected" : ""}>${label}</option>`).join("")}</select><label for="reservationNotes">備考</label><textarea id="reservationNotes" name="notes" rows="3">${valueOf(reservation?.notes)}</textarea><p class="error hidden" id="reservationFormError"></p><button class="primary" type="submit">${isEdit ? "変更を保存" : "予約を登録"}</button>${isEdit ? '<button class="secondary service-create-button" type="button" id="createServiceRecordButton">この予約から施工記録を作成</button>' : ""}<button class="text-button" type="button" id="cancelReservationButton">予約一覧へ戻る</button></form>`);

  const search = document.getElementById("reservationCustomerSearch");
  const customerId = document.getElementById("reservationCustomerId");
  const results = document.getElementById("reservationCustomerResults");
  const viewCustomer = document.getElementById("viewReservationCustomer");
  const vehicleSelect = document.getElementById("reservationVehicle");
  const sizeSelect = document.getElementById("reservationSizeClass");
  const courseSelect = document.getElementById("reservationCourse");
  const prepMinutes = document.getElementById("reservationPrepMinutes");
  const serviceMinutes = document.getElementById("reservationServiceMinutes");
  const cleanupMinutes = document.getElementById("reservationCleanupMinutes");
  const slotMinutes = document.getElementById("reservationSlotMinutes");
  const endTime = document.getElementById("reservationEndTime");
  const startTimeInput = document.getElementById("reservationTime");
  const travelSelect = document.getElementById("reservationTravelZone");
  const finalTotal = document.getElementById("reservationFinalTotal");
  let vehicleRecords = [];

  const selectedOptionRows = () => reservationOptions.filter((option) => document.querySelector(`[data-option-code="${option.code}"]`)?.checked).map((option) => ({
    code: option.code,
    amount: Math.max(0, Number(document.querySelector(`[data-option-amount="${option.code}"]`)?.value || 0)),
  }));

  const selectedDiscountRows = () => reservationDiscounts.filter((discount) => document.querySelector(`[data-discount-code="${discount.code}"]`)?.checked).map((discount) => ({
    code: discount.code,
    amount: discount.amount,
  }));

  const pricingValues = () => {
    const sizeClass = sizeSelect.value;
    const courseCode = courseSelect.value;
    const basePrice = Number(reservationCoursePrices[sizeClass]?.[courseCode] || 0);
    const options = selectedOptionRows();
    const optionsTotal = options.reduce((sum, item) => sum + item.amount, 0);
    const discounts = selectedDiscountRows();
    const normalDiscount = discounts.filter((item) => reservationDiscounts.find((discount) => discount.code === item.code)?.capped).reduce((sum, item) => sum + item.amount, 0);
    const separateDiscount = discounts.filter((item) => !reservationDiscounts.find((discount) => discount.code === item.code)?.capped).reduce((sum, item) => sum + item.amount, 0);
    const discountTotal = Math.min(normalDiscount, 1000) + separateDiscount;
    const travelFee = Number(reservationTravelZones[travelSelect.value]?.fee || 0);
    const calculatedTotal = Math.max(0, basePrice + optionsTotal + travelFee - discountTotal);
    return { basePrice, options, optionsTotal, discounts, discountTotal, travelFee, calculatedTotal };
  };

  const currentTimeValues = () => {
    const prep = Math.max(0, Number(prepMinutes.value || 0));
    const service = Math.max(0, Number(serviceMinutes.value || 0));
    const cleanup = Math.max(0, Number(cleanupMinutes.value || 0));
    return { prep, service, cleanup, slot: prep + service + cleanup };
  };

  const updateSchedule = () => {
    const times = currentTimeValues();
    slotMinutes.textContent = `${times.slot}分`;
    endTime.textContent = addMinutesToTime(startTimeInput.value, times.slot) || "--:--";
  };

  const applyCourseTimeDefaults = () => {
    const defaults = reservationTimeDefaults[courseSelect.value] || reservationTimeDefaults.rinseless;
    prepMinutes.value = defaults.prep;
    serviceMinutes.value = defaults.service;
    cleanupMinutes.value = defaults.cleanup;
    updateSchedule();
  };

  const updatePricing = (preserveFinal = false) => {
    const values = pricingValues();
    document.getElementById("priceBase").textContent = yen(values.basePrice);
    document.getElementById("priceOptions").textContent = `+${yen(values.optionsTotal)}`;
    document.getElementById("priceTravel").textContent = `+${yen(values.travelFee)}`;
    document.getElementById("priceDiscount").textContent = `−${yen(values.discountTotal)}`;
    document.getElementById("priceCalculated").textContent = yen(values.calculatedTotal);
    if (!preserveFinal || finalTotal.value === "") finalTotal.value = values.calculatedTotal;
  };

  const syncSizeFromVehicle = (vehicleId, preserveReservationSize = false) => {
    const vehicle = vehicleRecords.find((item) => item.id === vehicleId);
    if (!vehicle) {
      if (!preserveReservationSize) sizeSelect.value = "";
      updatePricing();
      return;
    }
    if (preserveReservationSize && reservation?.vehicle_size_class) sizeSelect.value = reservation.vehicle_size_class;
    else sizeSelect.value = vehicle.size_class || "";
    updatePricing();
  };

  const setVehicles = (records, selectedId, preserveReservationSize = false) => {
    vehicleRecords = records;
    syncSizeFromVehicle(selectedId, preserveReservationSize);
  };

  const showCustomers = (query = "") => {
    const normalized = query.trim().toLowerCase();
    const matches = customers.filter((customer) => customer.name.toLowerCase().includes(normalized) || String(customer.line_display_name || "").toLowerCase().includes(normalized)).slice(0, 8);
    results.innerHTML = matches.map((customer) => `<button class="picker-option" type="button" data-reservation-customer="${customer.id}"><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.line_display_name || customer.phone || "")}</small></button>`).join("");
    document.querySelectorAll("[data-reservation-customer]").forEach((button) => button.addEventListener("click", async () => {
      const customer = customers.find((item) => item.id === button.dataset.reservationCustomer);
      customerId.value = customer.id;
      search.value = customer.name;
      results.innerHTML = "";
      viewCustomer.classList.remove("hidden");
      await loadReservationVehicles(customer.id, "", (records, selectedId) => setVehicles(records, selectedId));
    }));
  };

  search.addEventListener("input", () => {
    customerId.value = "";
    viewCustomer.classList.add("hidden");
    loadReservationVehicles("", "", (records, selectedId) => setVehicles(records, selectedId));
    showCustomers(search.value);
  });
  search.addEventListener("focus", () => showCustomers(search.value));
  vehicleSelect.addEventListener("change", () => syncSizeFromVehicle(vehicleSelect.value));
  sizeSelect.addEventListener("change", () => updatePricing());
  courseSelect.addEventListener("change", () => { applyCourseTimeDefaults(); updatePricing(); });
  [prepMinutes, serviceMinutes, cleanupMinutes].forEach((input) => input.addEventListener("input", updateSchedule));
  startTimeInput.addEventListener("input", updateSchedule);
  travelSelect.addEventListener("change", () => updatePricing());
  document.querySelectorAll("[data-option-code]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const wrap = document.querySelector(`[data-option-amount-wrap="${checkbox.dataset.optionCode}"]`);
    wrap?.classList.toggle("hidden", !checkbox.checked);
    updatePricing();
  }));
  document.querySelectorAll("[data-option-amount]").forEach((input) => input.addEventListener("input", () => updatePricing()));
  document.querySelectorAll("[data-discount-code]").forEach((checkbox) => checkbox.addEventListener("change", () => updatePricing()));

  viewCustomer.addEventListener("click", () => renderCustomerDetail(customerId.value, () => renderReservationForm(reservation)));
  document.getElementById("cancelReservationButton").addEventListener("click", renderReservationList);

  if (reservation?.customer_id) {
    await loadReservationVehicles(reservation.customer_id, reservation.vehicle_id, (records, selectedId) => setVehicles(records, selectedId, true));
  }
  updatePricing(Boolean(reservation?.final_total != null));
  updateSchedule();

  if (isEdit) {
    document.getElementById("createServiceRecordButton")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "施工記録を作成中…";
      await createServiceRecordFromReservation(reservation.id, button);
    });
  }

  document.getElementById("reservationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const fields = Object.fromEntries(new FormData(form));
    if (!customerId.value || !fields.vehicle_id || !fields.vehicle_size_class || !fields.travel_zone) {
      const message = document.getElementById("reservationFormError");
      message.textContent = "顧客・車両・車両区分・出張距離を選択してください。";
      return message.classList.remove("hidden");
    }

    const price = pricingValues();
    const finalPrice = Math.max(0, Number(fields.final_total || 0));
    const values = {
      customer_id: customerId.value,
      vehicle_id: fields.vehicle_id,
      course_code: fields.course_code,
      reservation_date: fields.reservation_date,
      start_time: fields.start_time,
      status: fields.status,
      notes: emptyToNull(fields.notes),
      vehicle_size_class: fields.vehicle_size_class,
      selected_options: price.options,
      selected_discounts: price.discounts,
      travel_zone: fields.travel_zone,
      base_price: price.basePrice,
      options_total: price.optionsTotal,
      travel_fee: price.travelFee,
      discount_total: price.discountTotal,
      calculated_total: price.calculatedTotal,
      final_total: finalPrice,
      planned_prep_minutes: currentTimeValues().prep,
      planned_service_minutes: currentTimeValues().service,
      planned_cleanup_minutes: currentTimeValues().cleanup,
      planned_slot_minutes: currentTimeValues().slot,
    };

    button.disabled = true;
    button.textContent = "保存中…";
    try {
      const currentVehicle = vehicleRecords.find((vehicle) => vehicle.id === fields.vehicle_id);
      if (currentVehicle?.size_class !== fields.vehicle_size_class) {
        const { error: vehicleError } = await supabase.from("customer_vehicles").update({ size_class: fields.vehicle_size_class }).eq("id", fields.vehicle_id).eq("customer_id", customerId.value);
        if (vehicleError) throw vehicleError;
      }
      const request = isEdit ? supabase.from("reservations").update(values).eq("id", reservation.id).select("id").single() : supabase.from("reservations").insert(values).select("id").single();
      const { data, error } = await request;
      if (error || !data?.id) throw error || new Error("保存結果を確認できませんでした。");
      await renderReservationList();
    } catch (error) {
      button.disabled = false;
      button.textContent = isEdit ? "変更を保存" : "予約を登録";
      const message = document.getElementById("reservationFormError");
      message.textContent = saveErrorMessage(error);
      message.classList.remove("hidden");
    }
  });
}


const serviceStatuses = { planned: "予定", in_progress: "施工中", completed: "完了", cancelled: "中止" };
const setServiceContent = (content) => {
  const target = document.getElementById("managerContent");
  if (target) target.innerHTML = content;
};

async function renderServiceList() {
  const token = ++serviceViewToken;
  const { data, error } = await supabase.from("service_records").select("id, reservation_id, customer_name, vehicle_manufacturer, vehicle_model, course_code, service_date, planned_start_time, planned_slot_minutes, planned_total, status").eq("is_active", true).order("service_date", { ascending: true }).order("planned_start_time", { ascending: true });
  if (token !== serviceViewToken || activeTab !== "施工") return;
  if (error) return setServiceContent('<div class="card"><p class="error">施工記録を読み込めませんでした。</p></div>');
  const rows = data.length ? data.map((record) => `<button class="reservation-row" type="button" data-service-record-id="${record.id}"><span><strong>${escapeHtml(reservationDate(record.service_date))} ${escapeHtml(reservationTime(record.planned_start_time))}〜${escapeHtml(addMinutesToTime(record.planned_start_time, record.planned_slot_minutes || 0))}</strong><small>${escapeHtml(record.customer_name)} ・ ${escapeHtml(`${record.vehicle_manufacturer} ${record.vehicle_model}`)}</small><small>${escapeHtml(reservationCourses[record.course_code] || record.course_code)}${record.planned_total != null ? ` ・ ${escapeHtml(yen(record.planned_total))}` : ""}</small></span><span class="reservation-status">${escapeHtml(serviceStatuses[record.status] || record.status)}</span></button>`).join("") : '<div class="empty-state">まだ施工記録がありません。予約から施工記録を作成できます。</div>';
  setServiceContent(`<div class="customer-list">${rows}</div>`);
  document.querySelectorAll("[data-service-record-id]").forEach((button) => button.addEventListener("click", () => renderServiceDetail(button.dataset.serviceRecordId)));
}

async function renderServiceDetail(recordId) {
  const token = ++serviceViewToken;
  setServiceContent('<div class="card placeholder"><p class="muted">施工記録を読み込んでいます…</p></div>');
  const { data: record, error } = await supabase.from("service_records").select("*").eq("id", recordId).maybeSingle();
  if (token !== serviceViewToken || activeTab !== "施工") return;
  if (error || !record) return setServiceContent('<div class="card"><p class="error">施工記録を読み込めませんでした。</p><button class="secondary" type="button" id="backToServiceList">施工一覧へ戻る</button></div>');

  const optionText = jsonArray(record.selected_options).map((item) => {
    const master = reservationOptions.find((option) => option.code === item.code);
    return `${master?.label || item.code}（${yen(item.amount)}）`;
  }).join("、") || "なし";
  const discountText = jsonArray(record.selected_discounts).map((item) => {
    const master = reservationDiscounts.find((discount) => discount.code === item.code);
    return `${master?.label || item.code}（−${yen(item.amount)}）`;
  }).join("、") || "なし";

  setServiceContent(`<div class="card detail-card"><div class="detail-heading"><div><h2>${escapeHtml(record.customer_name)}</h2><p class="muted">${escapeHtml(`${record.vehicle_manufacturer} ${record.vehicle_model}`)}</p></div><span class="reservation-status">${escapeHtml(serviceStatuses[record.status] || record.status)}</span></div><dl><dt>コース</dt><dd>${escapeHtml(reservationCourses[record.course_code] || record.course_code)}</dd><dt>施工日</dt><dd>${escapeHtml(reservationDate(record.service_date))}</dd><dt>予定時間</dt><dd>${escapeHtml(reservationTime(record.planned_start_time))}〜${escapeHtml(addMinutesToTime(record.planned_start_time, record.planned_slot_minutes || 0))}</dd><dt>準備</dt><dd>${escapeHtml(record.planned_prep_minutes ?? 0)}分</dd><dt>施工</dt><dd>${escapeHtml(record.planned_service_minutes ?? 0)}分</dd><dt>片付け</dt><dd>${escapeHtml(record.planned_cleanup_minutes ?? 0)}分</dd><dt>予約枠</dt><dd>${escapeHtml(record.planned_slot_minutes ?? 0)}分</dd><dt>オプション</dt><dd>${escapeHtml(optionText)}</dd><dt>割引</dt><dd>${escapeHtml(discountText)}</dd><dt>予定料金</dt><dd>${record.planned_total != null ? escapeHtml(yen(record.planned_total)) : "未設定"}</dd><dt>予約備考</dt><dd>${escapeHtml(record.reservation_notes || "未登録")}</dd></dl></div><button class="text-button" type="button" id="backToServiceList">← 施工一覧へ戻る</button>`);
  document.getElementById("backToServiceList").addEventListener("click", renderServiceList);
}

async function createServiceRecordFromReservation(reservationId, button) {
  try {
    const { data: existing, error: existingError } = await supabase.from("service_records").select("id").eq("reservation_id", reservationId).maybeSingle();
    if (existingError) throw existingError;
    if (existing?.id) {
      activeTab = "施工";
      renderManager();
      return renderServiceDetail(existing.id);
    }

    const { data: reservation, error } = await supabase.from("reservations").select("*, customers(name), customer_vehicles(manufacturer, model, color, plate_last4)").eq("id", reservationId).maybeSingle();
    if (error || !reservation) throw error || new Error("予約情報を読み込めませんでした。");

    const times = reservationTimes(reservation);
    const values = {
      reservation_id: reservation.id,
      customer_id: reservation.customer_id,
      vehicle_id: reservation.vehicle_id,
      customer_name: reservation.customers?.name || "未設定",
      vehicle_manufacturer: reservation.customer_vehicles?.manufacturer || "未設定",
      vehicle_model: reservation.customer_vehicles?.model || "未設定",
      vehicle_color: emptyToNull(reservation.customer_vehicles?.color),
      vehicle_plate_last4: emptyToNull(reservation.customer_vehicles?.plate_last4),
      course_code: reservation.course_code,
      service_date: reservation.reservation_date,
      planned_start_time: reservation.start_time,
      planned_prep_minutes: times.prep,
      planned_service_minutes: times.service,
      planned_cleanup_minutes: times.cleanup,
      planned_slot_minutes: times.slot,
      vehicle_size_class: reservation.vehicle_size_class,
      selected_options: jsonArray(reservation.selected_options),
      selected_discounts: jsonArray(reservation.selected_discounts),
      travel_zone: reservation.travel_zone,
      base_price: reservation.base_price,
      options_total: reservation.options_total || 0,
      travel_fee: reservation.travel_fee || 0,
      discount_total: reservation.discount_total || 0,
      calculated_total: reservation.calculated_total,
      planned_total: reservation.final_total,
      reservation_notes: reservation.notes,
      status: "planned",
    };

    const { data, error: insertError } = await supabase.from("service_records").insert(values).select("id").single();
    if (insertError || !data?.id) throw insertError || new Error("施工記録を作成できませんでした。");
    activeTab = "施工";
    renderManager();
    return renderServiceDetail(data.id);
  } catch (error) {
    button.disabled = false;
    button.textContent = "この予約から施工記録を作成";
    alert(saveErrorMessage(error));
  }
}

async function getActiveProfile(user) {
  const { data, error } = await supabase.from("manager_profiles").select("display_name, role, is_active").eq("id", user.id).maybeSingle();
  if (error || !data || !data.is_active || data.role !== "admin") return null;
  return data;
}

async function refreshSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return renderLogin();
  profile = await getActiveProfile(session.user);
  if (!profile) { await supabase.auth.signOut(); return renderLogin("このアカウントには管理画面へのアクセス権限がありません。"); }
  renderManager();
}

async function signIn(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  const { error } = await supabase.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
  if (error) { button.disabled = false; return renderLogin("メールアドレスまたはパスワードを確認してください。"); }
  await refreshSession();
}

async function start() {
  if (!isSupabaseConfigured) return renderLogin();
  renderLogin("接続を開始しています…", true);
  try { supabase = await createSupabaseClient(); await refreshSession(); }
  catch (error) { console.error("RE:CORDARE Manager initialization failed", error); renderLogin("接続を開始できませんでした。設定を確認してください。"); }
}
start();
