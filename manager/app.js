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
  const content = activeTab === "ホーム" ? `<div class="card"><p class="welcome">${name}さん</p><h2>RE:CORDARE Manager</h2><p class="muted">Phase 1の管理画面基盤です。業務機能は今後追加されます。</p><a class="return-link" href="/">← Detailing Managerへ戻る</a></div>` : `<div id="managerContent">${activeTab === "顧客" || activeTab === "予約" ? '<div class="card placeholder"><p class="muted">読み込んでいます…</p></div>' : `<div class="card placeholder"><h2>${activeTab}</h2><p class="muted">この機能は準備中です。</p></div>`}</div>`;
  app.innerHTML = `<section class="screen"><header class="topbar"><div><div class="brand">RE:CORDARE Manager</div><h1>${activeTab}</h1></div><button class="icon-button" type="button" aria-label="設定" id="settingsButton">⚙</button></header>${content}</section><nav class="manager-nav" aria-label="管理メニュー">${tabs.map((tab) => `<button type="button" data-tab="${tab}" class="${tab === activeTab ? "active" : ""}">${tab}</button>`).join("")}</nav><div class="settings-panel hidden" id="settingsPanel"><div class="settings-box"><h2>設定</h2><p class="muted">管理者：${name}</p><p class="muted">Build: ${escapeHtml(buildSha)}</p><button class="secondary" type="button" id="signOutButton">ログアウト</button><button class="secondary" type="button" id="closeSettingsButton" style="margin-top:10px">閉じる</button></div></div>`;
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { activeTab = button.dataset.tab; renderManager(); }));
  document.getElementById("settingsButton").addEventListener("click", () => document.getElementById("settingsPanel").classList.remove("hidden"));
  document.getElementById("closeSettingsButton").addEventListener("click", () => document.getElementById("settingsPanel").classList.add("hidden"));
  document.getElementById("signOutButton").addEventListener("click", async () => { await supabase.auth.signOut(); profile = null; renderLogin(); });
  if (activeTab === "顧客") renderCustomerList();
  if (activeTab === "予約") renderReservationList();
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
let reservationFilter = "upcoming";

const reservationDate = (value) => value ? String(value).slice(0, 10) : "";
const reservationTime = (value) => value ? String(value).slice(0, 5) : "";
const reservationVehicleName = (vehicle) => vehicle ? `${vehicle.manufacturer} ${vehicle.model}` : "車両未設定";
const setReservationContent = (content) => {
  const target = document.getElementById("managerContent");
  if (target) target.innerHTML = content;
};

async function renderReservationList() {
  const { data, error } = await supabase.from("reservations").select("id, customer_id, vehicle_id, course_code, reservation_date, start_time, status, notes, customers(name), customer_vehicles(manufacturer, model, color)").eq("is_active", true).order("reservation_date", { ascending: true }).order("start_time", { ascending: true });
  if (activeTab !== "予約") return;
  if (error) return setReservationContent('<div class="card"><p class="error">予約一覧を読み込めませんでした。</p></div>');
  const today = new Date().toLocaleDateString("en-CA");
  const filtered = data.filter((reservation) => {
    if (reservationFilter === "today") return reservationDate(reservation.reservation_date) === today;
    if (reservationFilter === "upcoming") return reservationDate(reservation.reservation_date) >= today && reservation.status !== "cancelled";
    if (reservationFilter === "active") return reservation.status !== "cancelled";
    return true;
  });
  const rows = filtered.length ? filtered.map((reservation) => `<button class="reservation-row" type="button" data-reservation-id="${reservation.id}"><span><strong>${escapeHtml(reservationDate(reservation.reservation_date))} ${escapeHtml(reservationTime(reservation.start_time))}</strong><small>${escapeHtml(reservation.customers?.name || "顧客未設定")} ・ ${escapeHtml(reservationVehicleName(reservation.customer_vehicles))}</small><small>${escapeHtml(reservationCourses[reservation.course_code] || reservation.course_code)}</small></span><span class="reservation-status">${escapeHtml(reservationStatuses[reservation.status] || reservation.status)}</span></button>`).join("") : '<div class="empty-state">該当する予約はありません。</div>';
  setReservationContent(`<button class="primary add-button" type="button" id="newReservationButton">＋ 予約を登録</button><div class="reservation-filters">${[["today", "今日"], ["upcoming", "今後"], ["all", "すべて"], ["active", "キャンセル除外"]].map(([value, label]) => `<button class="filter-button ${reservationFilter === value ? "active" : ""}" type="button" data-reservation-filter="${value}">${label}</button>`).join("")}</div><div class="customer-list">${rows}</div>`);
  document.getElementById("newReservationButton").addEventListener("click", () => renderReservationForm());
  document.querySelectorAll("[data-reservation-filter]").forEach((button) => button.addEventListener("click", () => { reservationFilter = button.dataset.reservationFilter; renderReservationList(); }));
  document.querySelectorAll("[data-reservation-id]").forEach((button) => button.addEventListener("click", () => renderReservationForm(data.find((reservation) => reservation.id === button.dataset.reservationId))));
}

async function loadReservationVehicles(customerId, selectedVehicleId = "") {
  const select = document.getElementById("reservationVehicle");
  if (!select) return;
  if (!customerId) { select.innerHTML = '<option value="">先に顧客を選択してください</option>'; select.disabled = true; return; }
  select.disabled = true;
  select.innerHTML = '<option value="">車両を読み込んでいます…</option>';
  const { data, error } = await supabase.from("customer_vehicles").select("id, manufacturer, model, color").eq("customer_id", customerId).eq("is_active", true).order("created_at");
  if (error || !data.length) { select.innerHTML = '<option value="">有効な車両がありません</option>'; return; }
  const autoSelected = selectedVehicleId || (data.length === 1 ? data[0].id : "");
  select.innerHTML = `<option value="">車両を選択</option>${data.map((vehicle) => `<option value="${vehicle.id}" ${vehicle.id === autoSelected ? "selected" : ""}>${escapeHtml(reservationVehicleName(vehicle))}（${escapeHtml(vehicle.color)}）</option>`).join("")}`;
  select.disabled = false;
}

async function renderReservationForm(reservation = null) {
  const isEdit = Boolean(reservation);
  const { data: customers, error } = await supabase.from("customers").select("id, name, phone, line_display_name").eq("is_active", true).order("name");
  if (error) return setReservationContent('<div class="card"><p class="error">顧客を読み込めませんでした。</p></div>');
  const selectedCustomer = customers.find((customer) => customer.id === reservation?.customer_id);
  const initialCustomerName = selectedCustomer?.name || "";
  setReservationContent(`<form class="card form-card" id="reservationForm"><h2>${isEdit ? "予約を編集" : "新規予約"}</h2><label for="reservationCustomerSearch">顧客</label><input id="reservationCustomerSearch" type="search" placeholder="顧客名で検索" autocomplete="off" value="${valueOf(initialCustomerName)}" required /><input id="reservationCustomerId" type="hidden" value="${valueOf(reservation?.customer_id)}" /><div class="picker-results" id="reservationCustomerResults"></div><button class="text-button ${reservation?.customer_id ? "" : "hidden"}" type="button" id="viewReservationCustomer">顧客詳細を見る</button><label for="reservationVehicle">車両</label><select id="reservationVehicle" name="vehicle_id" required disabled><option value="">先に顧客を選択してください</option></select><label for="reservationCourse">コース</label><select id="reservationCourse" name="course_code" required>${Object.entries(reservationCourses).map(([value, label]) => `<option value="${value}" ${reservation?.course_code === value ? "selected" : ""}>${label}</option>`).join("")}</select><label for="reservationDate">施工日</label><input id="reservationDate" name="reservation_date" type="date" required value="${valueOf(reservationDate(reservation?.reservation_date) || new Date().toLocaleDateString("en-CA"))}" /><label for="reservationTime">開始時間</label><input id="reservationTime" name="start_time" type="time" required value="${valueOf(reservationTime(reservation?.start_time))}" /><label for="reservationStatus">予約状態</label><select id="reservationStatus" name="status" required>${Object.entries(reservationStatuses).map(([value, label]) => `<option value="${value}" ${reservation?.status === value || (!reservation && value === "confirmed") ? "selected" : ""}>${label}</option>`).join("")}</select><label for="reservationNotes">備考</label><textarea id="reservationNotes" name="notes" rows="3">${valueOf(reservation?.notes)}</textarea><p class="error hidden" id="reservationFormError"></p><button class="primary" type="submit">${isEdit ? "変更を保存" : "予約を登録"}</button><button class="text-button" type="button" id="cancelReservationButton">予約一覧へ戻る</button></form>`);
  const search = document.getElementById("reservationCustomerSearch");
  const customerId = document.getElementById("reservationCustomerId");
  const results = document.getElementById("reservationCustomerResults");
  const viewCustomer = document.getElementById("viewReservationCustomer");
  const showCustomers = (query = "") => {
    const normalized = query.trim().toLowerCase();
    const matches = customers.filter((customer) => customer.name.toLowerCase().includes(normalized) || String(customer.line_display_name || "").toLowerCase().includes(normalized)).slice(0, 8);
    results.innerHTML = matches.map((customer) => `<button class="picker-option" type="button" data-reservation-customer="${customer.id}"><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.line_display_name || customer.phone || "")}</small></button>`).join("");
    document.querySelectorAll("[data-reservation-customer]").forEach((button) => button.addEventListener("click", () => {
      const customer = customers.find((item) => item.id === button.dataset.reservationCustomer);
      customerId.value = customer.id;
      search.value = customer.name;
      results.innerHTML = "";
      viewCustomer.classList.remove("hidden");
      loadReservationVehicles(customer.id);
    }));
  };
  search.addEventListener("input", () => { customerId.value = ""; viewCustomer.classList.add("hidden"); loadReservationVehicles(""); showCustomers(search.value); });
  search.addEventListener("focus", () => showCustomers(search.value));
  viewCustomer.addEventListener("click", () => renderCustomerDetail(customerId.value, () => renderReservationForm(reservation)));
  document.getElementById("cancelReservationButton").addEventListener("click", renderReservationList);
  if (reservation?.customer_id) await loadReservationVehicles(reservation.customer_id, reservation.vehicle_id);
  document.getElementById("reservationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const fields = Object.fromEntries(new FormData(form));
    if (!customerId.value || !fields.vehicle_id) {
      const message = document.getElementById("reservationFormError");
      message.textContent = "顧客と車両を選択してください。";
      return message.classList.remove("hidden");
    }
    const values = { customer_id: customerId.value, vehicle_id: fields.vehicle_id, course_code: fields.course_code, reservation_date: fields.reservation_date, start_time: fields.start_time, status: fields.status, notes: emptyToNull(fields.notes) };
    button.disabled = true;
    button.textContent = "保存中…";
    try {
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
