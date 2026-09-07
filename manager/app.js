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
  const content = activeTab === "ホーム" ? `<div id="managerContent"><div class="card"><p class="welcome">${name}さん</p><h2>RE:CORDARE Manager</h2><button class="secondary" type="button" id="openChemicalsButton">ケミカル・在庫</button><a class="return-link" href="/">← Detailing Managerへ戻る</a></div></div>` : `<div id="managerContent">${activeTab === "顧客" || activeTab === "予約" || activeTab === "施工" ? '<div class="card placeholder"><p class="muted">読み込んでいます…</p></div>' : `<div class="card placeholder"><h2>${activeTab}</h2><p class="muted">この機能は準備中です。</p></div>`}</div>`;
  app.innerHTML = `<section class="screen"><header class="topbar"><div><div class="brand">RE:CORDARE Manager</div><h1>${activeTab}</h1></div><button class="icon-button" type="button" aria-label="設定" id="settingsButton">⚙</button></header>${content}</section><nav class="manager-nav" aria-label="管理メニュー">${tabs.map((tab) => `<button type="button" data-tab="${tab}" class="${tab === activeTab ? "active" : ""}">${tab}</button>`).join("")}</nav><div class="settings-panel hidden" id="settingsPanel"><div class="settings-box"><h2>設定</h2><p class="muted">管理者：${name}</p><p class="muted">Build: ${escapeHtml(buildSha)}</p><button class="secondary" type="button" id="signOutButton">ログアウト</button><button class="secondary" type="button" id="closeSettingsButton" style="margin-top:10px">閉じる</button></div></div>`;
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { activeTab = button.dataset.tab; renderManager(); }));
  document.getElementById("settingsButton").addEventListener("click", () => document.getElementById("settingsPanel").classList.remove("hidden"));
  document.getElementById("closeSettingsButton").addEventListener("click", () => document.getElementById("settingsPanel").classList.add("hidden"));
  document.getElementById("signOutButton").addEventListener("click", async () => { await supabase.auth.signOut(); profile = null; renderLogin(); });
  document.getElementById("openChemicalsButton")?.addEventListener("click", renderChemicalList);
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
const chemicalCategories = ["プレウォッシュ","シャンプー / コンタクトウォッシュ","リンスレス","鉄粉除去","スケール / 酸性洗浄","下地処理","脱脂","コーティング / 保護剤","ガラス洗浄","ガラス油膜除去","ガラスウロコ除去","ガラス撥水","タイヤ・ホイール洗浄","タイヤ・ホイール保護","未塗装樹脂洗浄","未塗装樹脂保護","虫汚れ","ピッチ・タール","その他"];
const chemicalAdjustmentReasons = { initial: "初期在庫登録", inventory: "棚卸修正", spill: "こぼれ・漏れ", discard: "廃棄", usage_missing: "使用量記録漏れ", other: "その他" };
const chemicalUsageStatuses = { recorded: "使用量を記録", unrecorded: "使用したが量不明", unused: "未使用" };
const chemicalUsageCostText = (usage) => {
  if (!usage || usage.usage_status !== "recorded") return "原価対象外";
  const knownCost = Math.round(Number(usage.known_cost_amount || 0));
  if (usage.cost_status === "known") return `原価 ${yen(knownCost)}`;
  if (usage.cost_status === "partial") return `原価 ${yen(knownCost)} + 価格不明分${Number(usage.unknown_cost_applied_amount || 0)}mL`;
  return "原価 未計算（価格不明）";
};
const relatedChemicalCatalog = (chemical) => Array.isArray(chemical?.chemical_catalog_products) ? chemical.chemical_catalog_products[0] : chemical?.chemical_catalog_products;
const recordareChemicalName = (chemical) => { const catalog = relatedChemicalCatalog(chemical); return [catalog?.manufacturer, catalog?.product_name].filter(Boolean).join(" ") || "名称なし"; };
const normalizeChemicalName = (value) => String(value || "").toLowerCase().replace(/[\s\-_/・]/g, "");
const detailingChemicals = () => {
  try {
    const stored = JSON.parse(localStorage.getItem("chemicals") || "[]");
    const items = Array.isArray(stored) ? stored : Array.isArray(stored?.items) ? stored.items : Array.isArray(stored?.chemicals) ? stored.chemicals : [];
    return items.filter((item) => item && typeof item === "object");
  } catch { return []; }
};
const detailingChemicalFields = (chemical) => ({
  manufacturer: chemical.manufacturer || chemical.maker || chemical.brand || "",
  name: chemical.name || chemical.product_name || chemical.productName || chemical.product || chemical.title || "名称なし",
  category: chemical.type || chemical.category || ""
});

async function renderChemicalList() {
  setCustomerContent('<div class="card placeholder"><p class="muted">ケミカルを読み込んでいます…</p></div>');
  const { data, error } = await supabase.from("recordare_chemicals").select("id,status,unit,current_stock,reorder_threshold,target_stock,chemical_catalog_products(manufacturer,product_name,category)").order("created_at", { ascending: false });
  if (error) return setCustomerContent(`<div class="card"><p class="error">${escapeHtml(saveErrorMessage(error))}</p></div>`);
  const rows = data.length ? data.map((item) => {
    const alertText = item.current_stock != null && item.reorder_threshold != null && Number(item.current_stock) <= Number(item.reorder_threshold) ? " ・ 在庫少なめ" : "";
    return `<button class="customer-row" type="button" data-chemical-id="${item.id}"><span><strong>${escapeHtml(item.chemical_catalog_products.manufacturer)} ${escapeHtml(item.chemical_catalog_products.product_name)}</strong><small>${escapeHtml(item.chemical_catalog_products.category || "未分類")} ・ 在庫 ${item.current_stock == null ? "未登録" : `${escapeHtml(item.current_stock)}${escapeHtml(item.unit)}`} ・ ${item.status === "active" ? "使用中" : "休止"}${alertText}</small></span><span>›</span></button>`;
  }).join("") : '<p class="muted">マイケミカルはまだありません。</p>';
  setCustomerContent(`<button class="primary" type="button" id="addChemicalButton">＋ ケミカルを追加</button><button class="secondary" type="button" id="chemicalPlannerButton">在庫予測・買い物リスト</button><div class="customer-list">${rows}</div><button class="text-button" type="button" id="backHome">← ホームへ戻る</button>`);
  document.getElementById("addChemicalButton").addEventListener("click", renderChemicalAdd);
  document.getElementById("chemicalPlannerButton").addEventListener("click", renderChemicalPlanner);
  document.getElementById("backHome").addEventListener("click", renderManager);
  document.querySelectorAll("[data-chemical-id]").forEach((b) => b.addEventListener("click", () => renderChemicalDetail(b.dataset.chemicalId)));
}

async function renderChemicalPlanner() {
  setCustomerContent('<div class="card placeholder"><p class="muted">在庫予測を計算しています…</p></div>');
  const todayDate = new Date();
  const horizonDate = new Date(todayDate);
  horizonDate.setDate(horizonDate.getDate() + 30);
  const today = todayDate.toLocaleDateString("en-CA");
  const horizon = horizonDate.toLocaleDateString("en-CA");

  const [{ data: chemicals, error: chemicalError }, { data: completedRecords, error: completedError }, { data: usages, error: usageError }, { data: reservations, error: reservationError }] = await Promise.all([
    supabase.from("recordare_chemicals").select("id,status,unit,current_stock,reorder_threshold,target_stock,chemical_catalog_products(manufacturer,product_name)").eq("status", "active").order("created_at"),
    supabase.from("service_records").select("id,course_code").eq("status", "completed"),
    supabase.from("service_chemical_usages").select("service_record_id,recordare_chemical_id,usage_status,actual_amount"),
    supabase.from("reservations").select("course_code,reservation_date,status").eq("is_active", true).gte("reservation_date", today).lte("reservation_date", horizon).in("status", ["tentative","confirmed"]),
  ]);
  if (chemicalError || completedError || usageError || reservationError) {
    return setCustomerContent(`<div class="card"><p class="error">${escapeHtml(saveErrorMessage(chemicalError || completedError || usageError || reservationError))}</p><button class="text-button" id="backChemicals">← ケミカル一覧へ戻る</button></div>`);
  }

  const courseByRecord = new Map((completedRecords || []).map((record) => [record.id, record.course_code]));
  const trackedRecordIds = new Set((usages || []).map((usage) => usage.service_record_id));
  const completedCounts = new Map();
  trackedRecordIds.forEach((recordId) => {
    const course = courseByRecord.get(recordId);
    if (course) completedCounts.set(course, (completedCounts.get(course) || 0) + 1);
  });

  const usageTotals = new Map();
  (usages || []).forEach((usage) => {
    if (usage.usage_status !== "recorded") return;
    const course = courseByRecord.get(usage.service_record_id);
    if (!course) return;
    const key = `${usage.recordare_chemical_id}|${course}`;
    usageTotals.set(key, (usageTotals.get(key) || 0) + Number(usage.actual_amount || 0));
  });

  const futureCounts = new Map();
  (reservations || []).forEach((reservation) => futureCounts.set(reservation.course_code, (futureCounts.get(reservation.course_code) || 0) + 1));
  const futureReservationCount = (reservations || []).length;

  const shopping = [];
  const rows = (chemicals || []).map((chemical) => {
    let forecast = 0;
    let coveredReservations = 0;
    for (const [course, count] of futureCounts.entries()) {
      const completedCount = completedCounts.get(course) || 0;
      if (!completedCount) continue;
      const average = (usageTotals.get(`${chemical.id}|${course}`) || 0) / completedCount;
      forecast += average * count;
      coveredReservations += count;
    }
    const current = chemical.current_stock == null ? null : Number(chemical.current_stock);
    const threshold = chemical.reorder_threshold == null ? null : Number(chemical.reorder_threshold);
    const target = chemical.target_stock == null ? null : Number(chemical.target_stock);
    const projected = current == null ? null : current - forecast;
    const basis = target ?? threshold;
    const buyAmount = current == null || basis == null ? null : Math.max(0, Math.ceil((forecast + basis - current) * 1000) / 1000);
    const alert = projected != null && threshold != null && projected <= threshold;
    const name = recordareChemicalName(chemical);
    if (buyAmount != null && buyAmount > 0) shopping.push({ name, amount: buyAmount, unit: chemical.unit || "mL" });
    const forecastText = `${Math.round(forecast * 1000) / 1000}${chemical.unit || "mL"}`;
    const projectedText = projected == null ? "在庫未登録" : `${Math.round(projected * 1000) / 1000}${chemical.unit || "mL"}`;
    const settingText = threshold == null && target == null ? "在庫管理設定なし" : `アラート ${threshold == null ? "未設定" : threshold + (chemical.unit || "mL")} / 目標 ${target == null ? "未設定" : target + (chemical.unit || "mL")}`;
    const coverageText = futureReservationCount ? `${coveredReservations}/${futureReservationCount}件を実績から予測` : "今後30日の予約なし";
    const buyText = buyAmount == null ? "購入目安は在庫管理設定後に表示" : buyAmount > 0 ? `購入目安 ${buyAmount}${chemical.unit || "mL"}` : "購入目安なし";
    return `<section class="card"><h2>${escapeHtml(name)}</h2><p>現在在庫 ${current == null ? "未登録" : escapeHtml(current + (chemical.unit || "mL"))}</p><p>30日予測使用量 ${escapeHtml(forecastText)} / 予測後 ${escapeHtml(projectedText)}</p><p class="muted">${escapeHtml(settingText)} ・ ${escapeHtml(coverageText)}</p><p><strong>${alert ? "在庫アラート ・ " : ""}${escapeHtml(buyText)}</strong></p></section>`;
  }).join("");

  const shoppingRows = shopping.length
    ? shopping.map((item) => `<p><strong>${escapeHtml(item.name)}</strong> ・ ${escapeHtml(item.amount)}${escapeHtml(item.unit)} 以上</p>`).join("")
    : '<p class="muted">現在の設定と予約予測では購入候補はありません。</p>';

  setCustomerContent(`<section class="card"><h2>30日 在庫予測</h2><p>対象予約 ${futureReservationCount}件</p><p class="muted">完了済み施工の実使用量をコース別に平均し、今後30日の予約件数へ当てはめた参考値です。実績が少ない間は低めに出る場合があります。</p></section><section class="card"><h2>買い物リスト</h2>${shoppingRows}</section>${rows || '<p class="muted">使用中のマイケミカルはありません。</p>'}<button class="text-button" id="backChemicals">← ケミカル一覧へ戻る</button>`);
  document.getElementById("backChemicals").addEventListener("click", renderChemicalList);
}

async function renderChemicalAdd() {
  const dm = detailingChemicals();
  const { data: catalogRows, error: catalogError } = await supabase.from("chemical_catalog_products").select("id,manufacturer,product_name,category").eq("status", "active").order("manufacturer").order("product_name");
  if (catalogError) return setCustomerContent(`<div class="card"><p class="error">${escapeHtml(saveErrorMessage(catalogError))}</p></div>`);
  setCustomerContent(`<form class="card form-card" id="chemicalAddForm"><h2>ケミカルを追加</h2><label>追加方法</label><select name="source" id="chemicalSource"><option value="manual">手入力</option><option value="detailing">Detailing Managerから追加</option><option value="catalog">メーカー / 共通カタログから追加</option></select><label id="detailLabel">候補</label><select name="detail" id="chemicalDetail"><option value="">選択してください</option></select><label>メーカー</label><input name="manufacturer" required /><label>商品名</label><input name="product_name" required /><label>カテゴリ</label><select name="category"><option value="">未分類</option>${chemicalCategories.map(x=>`<option>${escapeHtml(x)}</option>`).join("")}</select><p class="muted">標準使用量・希釈率は未設定のまま後から追加できます。</p><button class="primary" type="submit">マイケミカルへ追加</button><button class="text-button" type="button" id="backChemicals">戻る</button></form>`);
  const source = document.getElementById("chemicalSource"), detail = document.getElementById("chemicalDetail");
  const refreshChoices = () => { const isDm = source.value === "detailing", isCatalog = source.value === "catalog"; detail.parentElement.querySelector("#detailLabel").style.display = isDm || isCatalog ? "" : "none"; detail.style.display = isDm || isCatalog ? "" : "none"; detail.innerHTML = `<option value="">選択してください</option>${(isDm ? dm.map((c,i)=>{const fields=detailingChemicalFields(c);return `<option value="${i}">${escapeHtml(`${fields.manufacturer} ${fields.name}`.trim())}</option>`;}) : isCatalog ? catalogRows.map(c=>`<option value="${c.id}">${escapeHtml(`${c.manufacturer} ${c.product_name}`)}</option>`) : []).join("")}`; };
  refreshChoices(); source.addEventListener("change", refreshChoices);
  detail.addEventListener("change",()=>{const item=source.value === "detailing" ? dm[detail.value] : catalogRows.find(c=>c.id===detail.value);if(item){const fields=source.value === "detailing" ? detailingChemicalFields(item) : {manufacturer:item.manufacturer||"",name:item.product_name||"",category:item.category||""};document.querySelector('[name=manufacturer]').value=fields.manufacturer;document.querySelector('[name=product_name]').value=fields.name;document.querySelector('[name=category]').value=fields.category;}});
  document.getElementById("backChemicals").addEventListener("click",renderChemicalList);
  document.getElementById("chemicalAddForm").addEventListener("submit",async e=>{e.preventDefault();const f=e.currentTarget;const manufacturer=f.manufacturer.value.trim(), product=f.product_name.value.trim(), normalized=normalizeChemicalName(product), selected=source.value === "detailing" ? dm[detail.value] : null, sourceId=selected && (selected.id || selected.catalogId || selected.chemicalId), selectedFields=selected ? detailingChemicalFields(selected) : null;let catalog;
    if(sourceId){const {data:link,error}=await supabase.from("chemical_source_links").select("catalog_product_id").eq("source_system","detailing_manager").eq("source_chemical_id",String(sourceId)).maybeSingle();if(error)return alert(saveErrorMessage(error));if(link)catalog={id:link.catalog_product_id};}
    if(!catalog && source.value === "catalog") catalog={id:detail.value};
    if(!catalog){const {data,error}=await supabase.from("chemical_catalog_products").select("id").eq("manufacturer",manufacturer).eq("normalized_name",normalized).maybeSingle();if(error)return alert(saveErrorMessage(error));catalog=data;}
    if(!catalog){const {data,error}=await supabase.from("chemical_catalog_products").insert({manufacturer,product_name:product,normalized_name:normalized,category:f.category.value||null}).select("id").single();if(error)return alert(saveErrorMessage(error));catalog=data;}
    if(sourceId){const {error}=await supabase.from("chemical_source_links").upsert({catalog_product_id:catalog.id,source_system:"detailing_manager",source_chemical_id:String(sourceId),source_name:`${selectedFields.manufacturer} ${selectedFields.name}`.trim(),match_status:"linked"},{onConflict:"source_system,source_chemical_id"});if(error)return alert(saveErrorMessage(error));}
    const {data:existing,error:existingError}=await supabase.from("recordare_chemicals").select("id").eq("catalog_product_id",catalog.id).maybeSingle();if(existingError)return alert(saveErrorMessage(existingError));if(existing)return alert("この商品はすでにマイケミカルへ追加されています。");const {error:addError}=await supabase.from("recordare_chemicals").insert({catalog_product_id:catalog.id,category:f.category.value||null});if(addError)return alert(saveErrorMessage(addError));await renderChemicalList();});
}

async function renderChemicalDetail(id) {
  const [{data:c,error},{data:purchases},{data:adjustments}] = await Promise.all([supabase.from("recordare_chemicals").select("*,chemical_catalog_products(manufacturer,product_name,category)").eq("id",id).maybeSingle(),supabase.from("chemical_purchases").select("*").eq("recordare_chemical_id",id).order("purchased_on",{ascending:false}),supabase.from("chemical_inventory_adjustments").select("*").eq("recordare_chemical_id",id).order("adjusted_on",{ascending:false})]);
  if(error||!c)return setCustomerContent('<div class="card"><p class="error">ケミカルを読み込めませんでした。</p></div>');
  const stockText=c.current_stock == null ? "未登録" : `${c.current_stock}${escapeHtml(c.unit)}`;
  const initialAdjustment=(adjustments||[]).find(x=>x.reason==="initial");
  const inventoryAdjustments=(adjustments||[]).filter(x=>x.reason!=="initial");
  setCustomerContent(`<div class="card detail-card"><h2>${escapeHtml(c.chemical_catalog_products.manufacturer)} ${escapeHtml(c.chemical_catalog_products.product_name)}</h2><dl><dt>現在在庫</dt><dd>${stockText}</dd><dt>状態</dt><dd>${c.status==="active"?"使用中":"休止"}</dd><dt>在庫アラート</dt><dd>${c.reorder_threshold == null ? "未設定" : `${c.reorder_threshold}${escapeHtml(c.unit)}以下`}</dd><dt>目標在庫</dt><dd>${c.target_stock == null ? "未設定" : `${c.target_stock}${escapeHtml(c.unit)}`}</dd></dl><button class="secondary" id="purchaseChemical">購入・補充</button>${initialAdjustment?"":'<button class="secondary" id="initialChemical">初期在庫を登録</button>'}<button class="secondary" id="adjustChemical">在庫を修正</button><button class="secondary" id="stockSettingsChemical">在庫管理設定</button></div><section class="card"><h2>初期在庫登録</h2>${initialAdjustment?`<p>${initialAdjustment.adjusted_on} ・ ${initialAdjustment.new_stock}${escapeHtml(c.unit)}${initialAdjustment.price_amount==null?" ・ 価格未設定":` ・ ¥${initialAdjustment.price_amount}`}</p>`:"<p class=muted>未登録</p>"}</section><section class="card"><h2>購入履歴</h2>${(purchases||[]).map(x=>`<p>${x.purchased_on} ・ ${x.capacity}mL × ${x.quantity}本${x.amount==null?" ・ 価格未設定":` ・ ¥${x.amount}`}</p>`).join("")||"<p class=muted>なし</p>"}</section><section class="card"><h2>在庫修正履歴</h2>${inventoryAdjustments.map(x=>`<p>${x.adjusted_on} ・ ${escapeHtml(chemicalAdjustmentReasons[x.reason] || x.reason)} ・ ${x.previous_stock == null ? "未登録" : x.previous_stock}→${x.new_stock}${escapeHtml(c.unit)}</p>`).join("")||"<p class=muted>なし</p>"}</section><button class="text-button" id="backChemicals">← 一覧へ戻る</button>`);
  const form=(title,fields,save)=>{setCustomerContent(`<form class="card form-card" id="inventoryForm"><h2>${title}</h2>${fields}<button class="primary">保存</button><button type="button" class="text-button" id="cancelInventory">戻る</button></form>`);document.getElementById("inventoryForm").addEventListener("submit",save);document.getElementById("cancelInventory").addEventListener("click",()=>renderChemicalDetail(id));};
  document.getElementById("purchaseChemical").onclick=()=>form("購入・補充",`<label>購入日<input name=date type=date value="${new Date().toLocaleDateString("en-CA")}"></label><label>購入容量mL<input name=capacity type=number min=0.001 step=0.001 required></label><label>本数<input name=quantity type=number min=1 value=1 required></label><label>支払金額<input name=amount type=number min=0></label><label>購入先<input name=store></label><label>メモ<input name=notes></label>`,async e=>{e.preventDefault();const f=e.currentTarget,total=+f.capacity.value*+f.quantity.value;const amount=f.amount.value===""?null:+f.amount.value;const {error}=await supabase.from("chemical_purchases").insert({recordare_chemical_id:id,purchased_on:f.date.value,capacity:+f.capacity.value,quantity:+f.quantity.value,amount,store:emptyToNull(f.store.value),notes:emptyToNull(f.notes.value),unit_price_per_ml:amount==null?null:amount/total});if(error)return alert(saveErrorMessage(error));const {error:updateError}=await supabase.from("recordare_chemicals").update({current_stock:(c.current_stock||0)+total,unknown_cost_stock:(c.unknown_cost_stock||0)+(amount==null?total:0)}).eq("id",id);if(updateError)return alert(saveErrorMessage(updateError));renderChemicalDetail(id);});
  const adjustment=(initial)=>form(initial?"初期在庫を登録":"在庫を修正",`<label>現在残量mL<input name=stock type=number min=0 required></label>${initial?'<label>購入価格（不明の場合は空欄）<input name=price type=number min=0></label>':''}<label>理由<select name=reason>${(initial?["initial"]:["inventory","spill","discard","usage_missing","other"]).map(x=>`<option value=${x}>${chemicalAdjustmentReasons[x] || x}</option>`).join("")}</select></label><label>メモ<input name=notes></label>`,async e=>{e.preventDefault();const f=e.currentTarget,next=+f.stock.value,price=initial&&f.price.value!==""?+f.price.value:null;const {error}=await supabase.from("chemical_inventory_adjustments").insert({recordare_chemical_id:id,previous_stock:c.current_stock,new_stock:next,reason:f.reason.value,notes:emptyToNull(f.notes.value),price_amount:price});if(error)return alert(saveErrorMessage(error));const {error:updateError}=await supabase.from("recordare_chemicals").update({current_stock:next,unknown_cost_stock:initial&&price==null?next:(c.unknown_cost_stock||0)}).eq("id",id);if(updateError)return alert(saveErrorMessage(updateError));renderChemicalDetail(id);});
  document.getElementById("initialChemical")?.addEventListener("click",()=>adjustment(true));
  document.getElementById("adjustChemical").onclick=()=>adjustment(false);
  document.getElementById("stockSettingsChemical").onclick=()=>form("在庫管理設定",`<p class="muted">アラート残量と、補充後に確保したい目標在庫を設定します。未設定に戻す場合は空欄にしてください。</p><label>在庫アラート残量mL<input name=reorder type=number min=0 step=0.001 value="${c.reorder_threshold ?? ""}"></label><label>目標在庫mL<input name=target type=number min=0 step=0.001 value="${c.target_stock ?? ""}"></label>`,async e=>{e.preventDefault();const f=e.currentTarget;const reorder=f.reorder.value===""?null:+f.reorder.value;const target=f.target.value===""?null:+f.target.value;if(reorder!=null&&target!=null&&target<reorder)return alert("目標在庫は在庫アラート残量以上にしてください。");const {error:updateError}=await supabase.from("recordare_chemicals").update({reorder_threshold:reorder,target_stock:target}).eq("id",id);if(updateError)return alert(saveErrorMessage(updateError));renderChemicalDetail(id);});
  document.getElementById("backChemicals").onclick=renderChemicalList;
}

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
  const [{ data: customer, error: customerError }, { data: vehicles, error: vehicleError }, { data: history }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", customerId).maybeSingle(),
    supabase.from("customer_vehicles").select("*").eq("customer_id", customerId).eq("is_active", true).order("created_at"),
    supabase.from("service_records").select("id, vehicle_id, service_date, course_code, selected_options, actual_service_minutes, actual_total_minutes, status").eq("customer_id", customerId).order("service_date", { ascending: false }).limit(30)
  ]);
  if (customerError || vehicleError || !customer) return setCustomerContent(`<div class="card"><p class="error">顧客情報を読み込めませんでした。</p><button class="secondary" type="button" id="backToCustomers">一覧へ戻る</button></div>`);
  const vehicleRows = vehicles.length ? vehicles.map((vehicle) => `<div class="vehicle-row" data-vehicle-id="${vehicle.id}" role="button" tabindex="0"><div><strong>${escapeHtml(vehicle.manufacturer)} ${escapeHtml(vehicle.model)}</strong><small>${escapeHtml(vehicle.color)}${vehicle.plate_last4 ? ` ・ ${escapeHtml(vehicle.plate_last4)}` : ""}${vehicle.notes ? ` ・ ${escapeHtml(vehicle.notes)}` : ""}</small></div><button class="archive-button" type="button" data-archive-vehicle="${vehicle.id}">無効化</button></div>`).join("") : '<div class="empty-state">車両はまだ登録されていません。</div>';
  const historyRows = (history || []).map((item) => `<button class="service-history-row" type="button" data-history-record="${item.id}"><strong>${escapeHtml(reservationDate(item.service_date))} ・ ${escapeHtml(reservationCourses[item.course_code] || item.course_code)}</strong><small>${escapeHtml(jsonArray(item.selected_options).map((option) => reservationOptions.find((master) => master.code === option.code)?.label || option.code).join("、") || "OPなし")} ・ 実施工 ${item.actual_service_minutes ?? "--"}分 ・ 総拘束 ${item.actual_total_minutes ?? "--"}分 ・ ${escapeHtml(serviceStatuses[item.status] || item.status)}</small></button>`).join("") || '<p class="muted">施工履歴はまだありません。</p>';
  setCustomerContent(`<div class="card detail-card"><div class="detail-heading"><div><h2>${escapeHtml(customer.name)}</h2><p class="muted">${escapeHtml(contactMethods[customer.contact_method])}</p></div><button class="secondary compact-button" type="button" id="editCustomerButton">編集</button></div><dl><dt>電話番号</dt><dd>${escapeHtml(customer.phone || "未登録")}</dd><dt>LINE表示名</dt><dd>${escapeHtml(customer.line_display_name || "未登録")}</dd><dt>備考</dt><dd>${escapeHtml(customer.notes || "未登録")}</dd></dl><button class="text-button danger-text" type="button" id="archiveCustomerButton">この顧客を無効化</button></div><section class="card"><div class="detail-heading"><h2>車両</h2><button class="secondary compact-button" type="button" id="addVehicleButton">＋ 追加</button></div><div class="vehicle-list">${vehicleRows}</div><div id="vehicleFormArea"></div></section><section class="card"><h2>施工履歴</h2><div class="service-history-list">${historyRows}</div></section><button class="text-button" type="button" id="backToCustomers">${returnToReservation ? "← 予約へ戻る" : "← 顧客一覧へ戻る"}</button>`);
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
  document.querySelectorAll("[data-vehicle-id]").forEach((row) => {
    const openVehicle = () => renderVehicleDetail(customerId, row.dataset.vehicleId);
    row.addEventListener("click", (event) => { if (!event.target.closest("[data-archive-vehicle]")) openVehicle(); });
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openVehicle(); } });
  });
  document.querySelectorAll("[data-history-record]").forEach((button) => button.addEventListener("click", () => { activeTab = "施工"; renderManager(); renderServiceDetail(button.dataset.historyRecord); }));
}

async function renderVehicleDetail(customerId, vehicleId) {
  setCustomerContent('<div class="card placeholder"><p class="muted">車両を読み込んでいます…</p></div>');
  const [{ data: vehicle, error: vehicleError }, { data: history, error: historyError }] = await Promise.all([
    supabase.from("customer_vehicles").select("*").eq("id", vehicleId).eq("customer_id", customerId).maybeSingle(),
    supabase.from("service_records").select("id, service_date, course_code, selected_options, actual_service_minutes, actual_total_minutes, status").eq("vehicle_id", vehicleId).order("service_date", { ascending: false }).limit(30),
  ]);
  if (vehicleError || historyError || !vehicle) return setCustomerContent('<div class="card"><p class="error">車両を読み込めませんでした。</p></div>');
  const historyRows = history.length ? history.map((item) => `<button class="service-history-row" type="button" data-vehicle-history-record="${item.id}"><strong>${escapeHtml(reservationDate(item.service_date))} ・ ${escapeHtml(reservationCourses[item.course_code] || item.course_code)}</strong><small>実施工 ${item.actual_service_minutes ?? "--"}分 ・ 総拘束 ${item.actual_total_minutes ?? "--"}分 ・ ${escapeHtml(serviceStatuses[item.status] || item.status)}</small></button>`).join("") : '<p class="muted">施工履歴はまだありません。</p>';
  setCustomerContent(`<div class="card detail-card"><div class="detail-heading"><div><h2>${escapeHtml(vehicle.manufacturer)} ${escapeHtml(vehicle.model)}</h2><p class="muted">${escapeHtml(vehicle.color)}${vehicle.plate_last4 ? ` ・ ${escapeHtml(vehicle.plate_last4)}` : ""}</p></div></div><dl><dt>車両区分</dt><dd>${escapeHtml(reservationSizeClasses[vehicle.size_class] || "未設定")}</dd><dt>備考</dt><dd>${escapeHtml(vehicle.notes || "未登録")}</dd></dl></div><section class="card"><h2>施工履歴</h2><div class="service-history-list">${historyRows}</div></section><button class="text-button" type="button" id="backToCustomerDetail">← 顧客詳細へ戻る</button>`);
  document.getElementById("backToCustomerDetail").addEventListener("click", () => renderCustomerDetail(customerId));
  document.querySelectorAll("[data-vehicle-history-record]").forEach((button) => button.addEventListener("click", () => { activeTab = "施工"; renderManager(); renderServiceDetail(button.dataset.vehicleHistoryRecord); }));
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

  setReservationContent(`<form class="card form-card" id="reservationForm"><h2>${isEdit ? "予約を編集" : "新規予約"}</h2>${isEdit ? '<button class="secondary service-create-button" type="button" id="createServiceRecordButton">この予約から施工記録を作成</button>' : ""}<label for="reservationCustomerSearch">顧客</label><input id="reservationCustomerSearch" type="search" placeholder="顧客名で検索" autocomplete="off" value="${valueOf(initialCustomerName)}" required /><input id="reservationCustomerId" type="hidden" value="${valueOf(reservation?.customer_id)}" /><div class="picker-results" id="reservationCustomerResults"></div><button class="text-button ${reservation?.customer_id ? "" : "hidden"}" type="button" id="viewReservationCustomer">顧客詳細を見る</button><label for="reservationVehicle">車両</label><select id="reservationVehicle" name="vehicle_id" required disabled><option value="">先に顧客を選択してください</option></select><label for="reservationSizeClass">車両区分</label><select id="reservationSizeClass" name="vehicle_size_class" required><option value="">車両区分を選択</option>${Object.entries(reservationSizeClasses).map(([value, label]) => `<option value="${value}" ${reservation?.vehicle_size_class === value ? "selected" : ""}>${label}</option>`).join("")}</select><p class="muted">一度選んだ車両区分は車両情報にも保存し、次回から自動入力します。</p><label for="reservationCourse">コース</label><select id="reservationCourse" name="course_code" required>${Object.entries(reservationCourses).map(([value, label]) => `<option value="${value}" ${reservation?.course_code === value ? "selected" : ""}>${label}</option>`).join("")}</select><label for="reservationDate">施工日</label><input id="reservationDate" name="reservation_date" type="date" required value="${valueOf(reservationDate(reservation?.reservation_date) || new Date().toLocaleDateString("en-CA"))}" /><label for="reservationTime">開始時間</label><input id="reservationTime" name="start_time" type="time" required value="${valueOf(reservationTime(reservation?.start_time))}" /><div class="time-planning-group"><div class="pricing-group-title">予定時間</div><div class="time-grid"><label>準備<input id="reservationPrepMinutes" name="planned_prep_minutes" type="number" inputmode="numeric" min="0" step="5" value="${initialTimes.prep}" /></label><label>施工<input id="reservationServiceMinutes" name="planned_service_minutes" type="number" inputmode="numeric" min="0" step="5" value="${initialTimes.service}" /></label><label>片付け<input id="reservationCleanupMinutes" name="planned_cleanup_minutes" type="number" inputmode="numeric" min="0" step="5" value="${initialTimes.cleanup}" /></label></div><div class="time-summary"><span>予約枠 <strong id="reservationSlotMinutes">${initialTimes.slot}分</strong></span><span>終了予定 <strong id="reservationEndTime">--:--</strong></span></div><p class="muted">準備＋施工＋片付けを予約枠として確保します。移動時間は含みません。</p></div><div class="pricing-group"><div class="pricing-group-title">オプション</div>${optionMarkup}</div><div class="pricing-group"><div class="pricing-group-title">割引</div><p class="muted">通常割引は合計最大¥1,000。同一住所2台目割は別枠です。</p>${discountMarkup}</div><label for="reservationTravelZone">出張距離</label><select id="reservationTravelZone" name="travel_zone" required><option value="">出張距離を選択</option>${Object.entries(reservationTravelZones).map(([value, item]) => `<option value="${value}" ${initialTravelZone === value ? "selected" : ""}>${escapeHtml(item.label)}${item.fee ? `（+${escapeHtml(yen(item.fee))}）` : ""}</option>`).join("")}</select><div class="price-summary"><div class="price-line"><span>基本料金</span><strong id="priceBase">¥0</strong></div><div class="price-line"><span>オプション</span><strong id="priceOptions">¥0</strong></div><div class="price-line"><span>出張料</span><strong id="priceTravel">¥0</strong></div><div class="price-line"><span>割引</span><strong id="priceDiscount">−¥0</strong></div><div class="price-line price-calculated"><span>自動計算</span><strong id="priceCalculated">¥0</strong></div><label for="reservationFinalTotal">予定合計（手動調整可）</label><input id="reservationFinalTotal" name="final_total" type="number" inputmode="numeric" min="0" step="100" value="${reservation?.final_total ?? ""}" required /><p class="muted">「〜」料金・要相談メニューは実車確認後に予定合計を調整できます。</p></div><label for="reservationStatus">予約状態</label><select id="reservationStatus" name="status" required>${Object.entries(reservationStatuses).map(([value, label]) => `<option value="${value}" ${reservation?.status === value || (!reservation && value === "confirmed") ? "selected" : ""}>${label}</option>`).join("")}</select><label for="reservationNotes">備考</label><textarea id="reservationNotes" name="notes" rows="3">${valueOf(reservation?.notes)}</textarea><p class="error hidden" id="reservationFormError"></p><button class="primary" type="submit">${isEdit ? "変更を保存" : "予約を登録"}</button><button class="text-button" type="button" id="cancelReservationButton">予約一覧へ戻る</button></form>`);

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
    const serviceButton = document.getElementById("createServiceRecordButton");
    const { data: existingService } = await supabase.from("service_records").select("id").eq("reservation_id", reservation.id).maybeSingle();
    if (existingService?.id) serviceButton.textContent = "施工記録を見る";
    serviceButton?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = existingService?.id ? "施工記録を開いています…" : "施工記録を作成中…";
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
const formatActualTime = (value) => value
  ? new Date(value).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
  : "未記録";
const plannedCourseMinutes = {
  rinseless: { kei_compact: 45, sedan_wagon: 60, suv: 75, minivan: 75, large_hiace: 90 },
  maintenance: { kei_compact: 90, sedan_wagon: 120, suv: 150, minivan: 150, large_hiace: 180 },
  standard: { kei_compact: 90, sedan_wagon: 120, suv: 150, minivan: 150, large_hiace: 180 },
};
const plannedOptionMinutes = {
  body_iron_removal: { kei_compact: 20, sedan_wagon: 30, suv: 40, minivan: 40, large_hiace: 45 },
  front_glass_oil_repellent: { kei_compact: 30, sedan_wagon: 30, suv: 30, minivan: 30, large_hiace: 30 },
  all_glass_oil_repellent: { kei_compact: 45, sedan_wagon: 60, suv: 60, minivan: 60, large_hiace: 75 },
  all_glass_scale: { kei_compact: 60, sedan_wagon: 90, suv: 90, minivan: 90, large_hiace: 120 },
  unpainted_resin_partial: { kei_compact: 30, sedan_wagon: 30, suv: 30, minivan: 30, large_hiace: 30 },
  unpainted_resin_wide: { kei_compact: 60, sedan_wagon: 60, suv: 60, minivan: 60, large_hiace: 60 },
  wheel_scale_heavy: { kei_compact: 240, sedan_wagon: 240, suv: 240, minivan: 240, large_hiace: 240 },
};
const plannedServiceTime = (record) => {
  if (record.course_code === "reset_coat") return { minutes: null, reason: "終日枠", missingOptions: [] };
  if (!record.vehicle_size_class || !plannedCourseMinutes[record.course_code]?.[record.vehicle_size_class]) return { minutes: null, reason: "車格未設定", missingOptions: [] };
  const missingOptions = [];
  let minutes = plannedCourseMinutes[record.course_code][record.vehicle_size_class];
  jsonArray(record.selected_options).forEach((option) => {
    const optionMinutes = plannedOptionMinutes[option.code]?.[record.vehicle_size_class];
    if (optionMinutes == null) missingOptions.push(option.code);
    else minutes += optionMinutes;
  });
  return missingOptions.length ? { minutes: null, reason: "OP時間未設定", missingOptions } : { minutes, reason: null, missingOptions: [] };
};
const serviceTimeDifference = (record, planned = plannedServiceTime(record)) => {
  if (record.actual_service_minutes == null || planned.minutes == null) return "未計算";
  const diff = Number(record.actual_service_minutes) - planned.minutes;
  if (diff === 0) return "予定どおり";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)}分`;
};
const formatServiceMinutes = (minutes) => minutes == null ? "未計算" : `${minutes}分`;
const pausedMilliseconds = (pauses, startedAt, endedAt) => (pauses || []).reduce((total, pause) => {
  if (!pause.started_at || !pause.ended_at) return total;
  const start = Math.max(new Date(startedAt).getTime(), new Date(pause.started_at).getTime());
  const end = Math.min(new Date(endedAt).getTime(), new Date(pause.ended_at).getTime());
  return total + Math.max(0, end - start);
}, 0);
const intervalMinutes = (startedAt, endedAt, pauses) => (!startedAt || !endedAt ? null : Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime() - pausedMilliseconds(pauses, startedAt, endedAt)) / 60000)));
const totalSessionMinutes = (sessions, pauses) => {
  const completed = (sessions || []).filter((session) => session.started_at && session.ended_at);
  return completed.length ? completed.reduce((total, session) => total + intervalMinutes(session.started_at, session.ended_at, pauses), 0) : null;
};
const timestampLocalDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const localTimeToIso = (date, time) => new Date(`${date}T${time}:00`).toISOString();
const serviceStepMaster = [
  [100, "施工前確認"], [200, "タイヤ・ホイール"], [300, "鉄粉除去"], [400, "アルカリプレウォッシュ"], [500, "細部コンタクト"], [600, "よく流す"], [700, "細部酸性コンタクト"], [800, "未塗装樹脂洗浄"], [900, "全体スケール除去"], [1000, "全体中性コンタクト"], [1100, "拭き上げ"], [1200, "下地クリーナー"], [1300, "脱脂"], [1400, "コーティング"], [1500, "最終確認・仕上げ"],
].map(([orderGroup, name]) => ({ step_key: `step_${orderGroup}`, name, order_group: orderGroup, timed: true, skippable: orderGroup !== 100 && orderGroup !== 1500, rinseless: "prohibited" }));
const serviceOptionSteps = {
  body_iron_removal: [{ step_key: "step_300", name: "鉄粉除去", order_group: 300 }],
  wheel_scale_light: [{ step_key: "wheel_scale", name: "ホイール スケール除去", order_group: 250 }],
  wheel_scale_heavy: [{ step_key: "wheel_scale", name: "ホイール スケール除去", order_group: 250 }],
  unpainted_resin_partial: [{ step_key: "step_800", name: "未塗装樹脂洗浄", order_group: 800 }, { step_key: "resin_coat", name: "未塗装樹脂コーティング", order_group: 1410 }],
  unpainted_resin_wide: [{ step_key: "step_800", name: "未塗装樹脂洗浄", order_group: 800 }, { step_key: "resin_coat", name: "未塗装樹脂コーティング", order_group: 1410 }],
  front_glass_oil_repellent: [{ step_key: "glass_oil", name: "フロントガラス 油膜除去＋撥水", order_group: 1415 }],
  front_glass_scale: [{ step_key: "glass_scale", name: "フロントガラス ウロコ除去＋油膜除去＋撥水", order_group: 1415 }],
  all_glass_oil_repellent: [{ step_key: "glass_oil", name: "全面ガラス 油膜除去＋撥水", order_group: 1415 }],
  all_glass_scale: [{ step_key: "glass_scale", name: "全面ガラス ウロコ除去＋油膜除去＋撥水", order_group: 1415 }],
};
const buildServiceSteps = (courseCode, selectedOptions) => {
  const base = courseCode === "rinseless"
    ? [{ ...serviceStepMaster[0], rinseless: "allowed" }, { ...serviceStepMaster[1], rinseless: "allowed" }, { step_key: "rinseless_wash_dry", name: "リンスレス洗浄＋拭き上げ", order_group: 1100, timed: true, skippable: false, rinseless: "allowed" }, { ...serviceStepMaster[14], rinseless: "allowed" }]
    : courseCode === "reset_coat" ? serviceStepMaster
      : serviceStepMaster.filter((step) => [100, 200, 400, 600, 1100, 1500].includes(step.order_group));
  const byKey = new Map(base.map((step) => [step.step_key, { ...step }]));
  jsonArray(selectedOptions).forEach((option) => (serviceOptionSteps[option.code] || []).forEach((step) => { if (courseCode !== "reset_coat" || !byKey.has(step.step_key)) byKey.set(step.step_key, { ...step, timed: true, skippable: true, rinseless: courseCode === "rinseless" ? "conditional" : "allowed" }); }));
  return [...byKey.values()].sort((a, b) => a.order_group - b.order_group || a.name.localeCompare(b.name, "ja"));
};
const conditionTagLabels = ["水ジミ・スケール", "鉄粉多め", "虫汚れ多め", "傷あり", "未塗装樹脂白化", "ガラス油膜あり", "ガラスウロコあり", "ホイール汚れ強め"];
const conditionFields = (tag) => tag === "水ジミ・スケール" ? '<select name="scale_level"><option value="light">軽度</option><option value="heavy">重度</option><option value="paint_impact">塗装影響あり</option></select>' : tag === "ガラス油膜あり" || tag === "ガラスウロコあり" ? '<label><input type="checkbox" name="area" value="front"> フロント</label><label><input type="checkbox" name="area" value="side"> サイド</label><label><input type="checkbox" name="area" value="rear"> リア</label>' : tag === "ホイール汚れ強め" ? '<select name="wheel_count"><option value="1">1本</option><option value="2">2本</option><option value="3">3本</option><option value="4">4本</option></select>' : '';
let serviceElapsedInterval = null;
const clearServiceElapsed = () => {
  if (serviceElapsedInterval) clearInterval(serviceElapsedInterval);
  serviceElapsedInterval = null;
};
const formatServiceElapsed = (startedAt) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const showServiceElapsed = (elementId, startedAt) => {
  clearServiceElapsed();
  const update = () => {
    const element = document.getElementById(elementId);
    if (element) element.textContent = formatServiceElapsed(startedAt);
  };
  update();
  serviceElapsedInterval = setInterval(update, 1000);
};
const serviceConditionMarkup = (record, savedConditions) => {
  const conditionMap = new Map((savedConditions || []).map((item) => [item.tag_key, item.details || {}]));
  return `<form class="card form-card" id="serviceConditionForm"><h2>施工前状態</h2><label for="coatingState">既存コーティング状態</label><select id="coatingState" name="coating_state"><option value="unknown" ${record.coating_state === "unknown" ? "selected" : ""}>未確認</option><option value="good" ${record.coating_state === "good" ? "selected" : ""}>良好に残存</option><option value="partial" ${record.coating_state === "partial" ? "selected" : ""}>部分的に残存</option><option value="none" ${record.coating_state === "none" ? "selected" : ""}>残存なし</option></select><div class="condition-tags">${conditionTagLabels.map((tag) => `<div class="condition-tag"><label><input type="checkbox" name="condition_tag" value="${tag}" ${conditionMap.has(tag) ? "checked" : ""}> ${tag}</label><div class="condition-extra ${conditionMap.has(tag) ? "" : "hidden"}" data-condition-extra="${tag}">${conditionFields(tag)}</div></div>`).join("")}</div><button class="secondary" type="submit">施工前状態を保存</button></form>`;
};

async function renderServiceList() {
  clearServiceElapsed();
  const token = ++serviceViewToken;
  const { data, error } = await supabase.from("service_records").select("id, reservation_id, customer_name, vehicle_manufacturer, vehicle_model, course_code, service_date, planned_start_time, planned_slot_minutes, planned_total, actual_total, status").eq("is_active", true).order("service_date", { ascending: true }).order("planned_start_time", { ascending: true });
  if (token !== serviceViewToken || activeTab !== "施工") return;
  if (error) return setServiceContent('<div class="card"><p class="error">施工記録を読み込めませんでした。</p></div>');
  const rows = data.length ? data.map((record) => `<button class="reservation-row" type="button" data-service-record-id="${record.id}"><span><strong>${escapeHtml(reservationDate(record.service_date))} ${escapeHtml(reservationTime(record.planned_start_time))}〜${escapeHtml(addMinutesToTime(record.planned_start_time, record.planned_slot_minutes || 0))}</strong><small>${escapeHtml(record.customer_name)} ・ ${escapeHtml(`${record.vehicle_manufacturer} ${record.vehicle_model}`)}</small><small>${escapeHtml(reservationCourses[record.course_code] || record.course_code)}${(record.actual_total ?? record.planned_total) != null ? ` ・ ${escapeHtml(yen(record.actual_total ?? record.planned_total))}` : ""}</small></span><span class="reservation-status">${escapeHtml(serviceStatuses[record.status] || record.status)}</span></button>`).join("") : '<div class="empty-state">まだ施工記録がありません。予約から施工記録を作成できます。</div>';
  setServiceContent(`<div class="customer-list">${rows}</div>`);
  document.querySelectorAll("[data-service-record-id]").forEach((button) => button.addEventListener("click", () => renderServiceDetail(button.dataset.serviceRecordId)));
}

const bindServiceConditionForm = (recordId, rerender) => {
  document.querySelectorAll("input[name=condition_tag]").forEach((input) => input.addEventListener("change", () => {
    document.querySelector(`[data-condition-extra="${input.value}"]`)?.classList.toggle("hidden", !input.checked);
  }));
  document.getElementById("serviceConditionForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const selected = [...form.querySelectorAll("input[name=condition_tag]:checked")];
    const { error: recordError } = await supabase.from("service_records").update({ coating_state: form.coating_state.value }).eq("id", recordId);
    if (recordError) return alert(saveErrorMessage(recordError));
    const values = selected.map((input) => {
      const tag = input.closest(".condition-tag");
      return {
        service_record_id: recordId,
        tag_key: input.value,
        details: {
          scale_level: tag.querySelector("[name=scale_level]")?.value || null,
          areas: [...tag.querySelectorAll("input[name=area]:checked")].map((item) => item.value),
          wheel_count: tag.querySelector("[name=wheel_count]")?.value || null,
        },
      };
    });
    if (values.length) {
      const { error: tagError } = await supabase.from("service_condition_tags").upsert(values, { onConflict: "service_record_id,tag_key" });
      if (tagError) return alert(saveErrorMessage(tagError));
    }
    await rerender(recordId);
  });
};

async function ensureActiveServiceStep(recordId, record, existingSteps) {
  let steps = existingSteps;
  if (!steps) {
    const { data, error } = await supabase.from("service_steps").select("*").eq("service_record_id", recordId).order("sequence_no", { ascending: true });
    if (error) return error;
    steps = data;
  }
  if (!steps.length) {
    const generated = buildServiceSteps(record.course_code, record.selected_options).map((step, index) => ({
      service_record_id: recordId,
      step_key: step.step_key,
      step_name: step.name,
      order_group: step.order_group,
      sequence_no: index + 1,
      timed: step.timed,
      skippable: step.skippable,
      snapshot: { ...step, course_code: record.course_code, selected_options: jsonArray(record.selected_options) },
    }));
    const { data, error } = await supabase.from("service_steps").insert(generated).select();
    if (error) return error;
    steps = data.sort((a, b) => a.sequence_no - b.sequence_no);
  }
  if (steps.some((step) => step.started_at && !step.ended_at)) return null;
  const nextStep = steps.find((step) => !step.started_at && !step.ended_at);
  if (!nextStep) return new Error("再開できる未実施工程が見つかりませんでした。");
  const { data, error } = await supabase.from("service_steps").update({ started_at: new Date().toISOString() }).eq("id", nextStep.id).is("started_at", null).is("ended_at", null).select().maybeSingle();
  if (error) return error;
  if (!data) return new Error("工程の開始状態を保存できませんでした。");
  return null;
}

async function startServiceTimer(recordId, button) {
  button.disabled = true;
  button.textContent = "開始中…";
  const { data: record, error: recordError } = await supabase.from("service_records").select("course_code, selected_options").eq("id", recordId).maybeSingle();
  if (recordError || !record) {
    button.disabled = false;
    button.textContent = "施工開始";
    return alert(saveErrorMessage(recordError || new Error("施工記録を読み込めませんでした。")));
  }
  const stepError = await ensureActiveServiceStep(recordId, record);
  if (stepError) {
    button.disabled = false;
    button.textContent = "施工開始";
    return alert(saveErrorMessage(stepError));
  }
  const { error } = await supabase.from("service_records").update({ status: "in_progress" }).eq("id", recordId).eq("status", "planned");
  if (error) {
    button.disabled = false;
    button.textContent = "施工開始";
    return alert(saveErrorMessage(error));
  }
  await renderServiceTimer(recordId);
}

async function renderPreparationState(recordId, record, preparationSession) {
  const optionText = jsonArray(record.selected_options).map((item) => item.name || item.code).filter(Boolean).join("、") || "なし";
  setServiceContent(`<div class="card detail-card"><div class="detail-heading"><div><h2>${escapeHtml(record.customer_name)}</h2><p class="muted">${escapeHtml(`${record.vehicle_manufacturer} ${record.vehicle_model}`)}</p></div><span class="reservation-status">準備中</span></div><h2>準備中</h2><dl><dt>準備開始</dt><dd>${escapeHtml(formatActualTime(preparationSession.started_at))}</dd><dt>経過</dt><dd id="preparationElapsed"></dd><dt>コース</dt><dd>${escapeHtml(reservationCourses[record.course_code] || record.course_code)}</dd><dt>オプション</dt><dd>${escapeHtml(optionText)}</dd></dl><button class="primary service-action-button" type="button" id="startServiceButton">施工開始</button></div><button class="text-button" type="button" id="backToServiceList">← 施工一覧へ戻る</button>`);
  showServiceElapsed("preparationElapsed", preparationSession.started_at);
  document.getElementById("startServiceButton").addEventListener("click", (event) => startServiceTimer(recordId, event.currentTarget));
  document.getElementById("backToServiceList").addEventListener("click", renderServiceList);
}

async function renderServiceActualReview(recordId, record, steps, sessions, pauses) {
  clearServiceElapsed();
  const firstStep = steps.find((step) => step.started_at);
  const finalStep = [...steps].reverse().find((step) => step.ended_at);
  const actualMinutes = intervalMinutes(firstStep?.started_at, finalStep?.ended_at, pauses);
  const totalMinutes = totalSessionMinutes(sessions, pauses);
  const planned = plannedServiceTime(record);
  const plannedLabel = planned.minutes == null ? `予定時間算出不可 / ${planned.reason}` : `${planned.minutes}分`;
  setServiceContent(`<div class="card detail-card"><div class="detail-heading"><div><h2>${escapeHtml(record.customer_name)}</h2><p class="muted">${escapeHtml(`${record.vehicle_manufacturer} ${record.vehicle_model}`)}</p></div><span class="reservation-status">施工実績確認</span></div><dl><dt>施工終了</dt><dd>${escapeHtml(formatActualTime(finalStep?.ended_at))}</dd><dt>実施工時間</dt><dd>${escapeHtml(formatServiceMinutes(actualMinutes))}</dd><dt>総拘束時間</dt><dd>${escapeHtml(formatServiceMinutes(totalMinutes))}</dd><dt>予定施工時間</dt><dd>${escapeHtml(plannedLabel)}</dd><dt>予定との差</dt><dd>${escapeHtml(actualMinutes == null || planned.minutes == null ? "未計算" : serviceTimeDifference({ actual_service_minutes: actualMinutes }, planned))}</dd></dl></div><form class="card form-card" id="serviceActualForm"><h2>施工実績</h2><label for="serviceActualTotal">実売上</label><input id="serviceActualTotal" name="actual_total" type="number" inputmode="numeric" min="0" step="100" value="${escapeHtml(record.actual_total ?? record.planned_total ?? "")}" /><label for="serviceNotes">施工メモ</label><textarea id="serviceNotes" name="service_notes" rows="4">${escapeHtml(record.service_notes || "")}</textarea><p class="error hidden" id="serviceActualError"></p><button class="primary" type="submit">施工実績を保存</button></form><button class="text-button" type="button" id="backToServiceList">← 施工一覧へ戻る</button>`);
  document.getElementById("serviceActualForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "保存中…";
    const values = {
      status: "completed",
      actual_started_at: firstStep?.started_at || null,
      actual_completed_at: finalStep?.ended_at || null,
      actual_total: form.actual_total.value === "" ? null : Math.max(0, Number(form.actual_total.value)),
      actual_total_minutes: totalMinutes,
      service_notes: emptyToNull(form.service_notes.value),
    };
    const { error } = await supabase.from("service_records").update(values).eq("id", recordId).eq("status", "in_progress");
    if (error) {
      button.disabled = false;
      button.textContent = "施工実績を保存";
      const message = document.getElementById("serviceActualError");
      message.textContent = saveErrorMessage(error);
      return message.classList.remove("hidden");
    }
    const { error: timeError } = await supabase.from("service_records").update({ actual_service_minutes: actualMinutes }).eq("id", recordId).eq("status", "completed");
    if (timeError) return alert(saveErrorMessage(timeError));
    await renderServiceDetail(recordId);
  });
  document.getElementById("backToServiceList").addEventListener("click", renderServiceList);
}

async function renderCleanupState(recordId, record, steps, sessions, pauses) {
  const finalStep = [...steps].reverse().find((step) => step.ended_at);
  const activeSession = (sessions || []).find((session) => !session.ended_at);
  if (!activeSession) return renderServiceActualReview(recordId, record, steps, sessions, pauses);
  setServiceContent(`<div class="card detail-card"><div class="detail-heading"><div><h2>${escapeHtml(record.customer_name)}</h2><p class="muted">${escapeHtml(`${record.vehicle_manufacturer} ${record.vehicle_model}`)}</p></div><span class="reservation-status">片付け中</span></div><h2>片付け中</h2><dl><dt>施工終了</dt><dd>${escapeHtml(formatActualTime(finalStep?.ended_at))}</dd><dt>総拘束経過</dt><dd id="cleanupElapsed"></dd></dl><button class="primary service-action-button" type="button" id="completeCleanupButton">片付け完了</button></div><button class="text-button" type="button" id="backToServiceList">← 施工一覧へ戻る</button>`);
  showServiceElapsed("cleanupElapsed", activeSession.started_at);
  document.getElementById("completeCleanupButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "保存中…";
    const { error } = await supabase.from("service_sessions").update({ ended_at: new Date().toISOString(), status: "completed" }).eq("id", activeSession.id).is("ended_at", null);
    if (error) return alert(saveErrorMessage(error));
    await renderServiceTimer(recordId);
  });
  document.getElementById("backToServiceList").addEventListener("click", renderServiceList);
}

async function renderServiceEndState(recordId, record, steps, sessions) {
  const finalStep = [...steps].reverse().find((step) => step.ended_at);
  const activeSession = (sessions || []).find((session) => !session.ended_at);
  if (!activeSession) return;
  setServiceContent(`<div class="card detail-card"><div class="detail-heading"><div><h2>${escapeHtml(record.customer_name)}</h2><p class="muted">${escapeHtml(`${record.vehicle_manufacturer} ${record.vehicle_model}`)}</p></div><span class="reservation-status">施工中</span></div><h2>最終確認・仕上げ</h2><dl><dt>最終工程完了</dt><dd>${escapeHtml(formatActualTime(finalStep?.ended_at))}</dd></dl><button class="primary service-action-button" type="button" id="finishServiceButton">施工終了</button></div><button class="text-button" type="button" id="backToServiceList">← 施工一覧へ戻る</button>`);
  document.getElementById("finishServiceButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "保存中…";
    const { error } = await supabase.from("service_sessions").update({ status: "interrupted" }).eq("id", activeSession.id).eq("status", "active").is("ended_at", null);
    if (error) return alert(saveErrorMessage(error));
    await renderServiceTimer(recordId);
  });
  document.getElementById("backToServiceList").addEventListener("click", renderServiceList);
}

const serviceChemicalUsageStatusOptions = (selected = "recorded") => Object.entries(chemicalUsageStatuses)
  .map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`)
  .join("");

const serviceChemicalUsageMarkup = (activeStep, usages, chemicals) => {
  const stepUsages = (usages || []).filter((item) => item.service_step_id === activeStep.id);
  const chemicalById = new Map((chemicals || []).map((chemical) => [chemical.id, chemical]));
  const linkedIds = new Set(stepUsages.map((item) => item.recordare_chemical_id));
  const usageRows = stepUsages.map((usage) => {
    const chemical = chemicalById.get(usage.recordare_chemical_id);
    const stock = chemical?.current_stock == null ? "在庫未登録" : `${chemical.current_stock}${chemical.unit || "mL"}`;
    return `<form class="service-timing-correction" data-service-chemical-form>
      <input type="hidden" name="chemical_id" value="${escapeHtml(usage.recordare_chemical_id)}" />
      <h3>${escapeHtml(recordareChemicalName(chemical))}</h3>
      <p class="muted">現在在庫 ${escapeHtml(stock)} / ${escapeHtml(chemicalUsageCostText(usage))}</p>
      <label>記録状態<select name="usage_status">${serviceChemicalUsageStatusOptions(usage.usage_status)}</select></label>
      <label>実使用量mL<input name="actual_amount" type="number" inputmode="decimal" min="0.001" step="0.001" value="${escapeHtml(usage.actual_amount ?? "")}" /></label>
      <label>メモ<input name="notes" value="${escapeHtml(usage.notes || "")}" /></label>
      <button class="secondary" type="submit">保存</button>
    </form>`;
  }).join("");
  const candidates = (chemicals || []).filter((chemical) => chemical.status === "active" && !linkedIds.has(chemical.id));
  const candidateOptions = candidates.map((chemical) => {
    const stock = chemical.current_stock == null ? "在庫未登録" : `${chemical.current_stock}${chemical.unit || "mL"}`;
    return `<option value="${escapeHtml(chemical.id)}">${escapeHtml(recordareChemicalName(chemical))}（${escapeHtml(stock)}）</option>`;
  }).join("");
  const addForm = candidateOptions
    ? `<form class="service-timing-correction" data-service-chemical-form>
        <h3>ケミカルを追加</h3>
        <label>ケミカル<select name="chemical_id" required><option value="">選択してください</option>${candidateOptions}</select></label>
        <label>記録状態<select name="usage_status">${serviceChemicalUsageStatusOptions("recorded")}</select></label>
        <label>実使用量mL<input name="actual_amount" type="number" inputmode="decimal" min="0.001" step="0.001" /></label>
        <label>メモ<input name="notes" /></label>
        <button class="secondary" type="submit">記録</button>
      </form>`
    : '<p class="muted">追加できるマイケミカルはありません。</p>';
  return `<section class="card"><h2>使用ケミカル</h2><p class="muted">この工程で実際に使用したケミカルを記録します。</p>${usageRows || '<p class="muted">まだ記録されていません。</p>'}${addForm}</section>`;
};

const bindServiceChemicalUsageForms = (recordId, activeStep) => {
  document.querySelectorAll("[data-service-chemical-form]").forEach((form) => {
    const status = form.elements.usage_status;
    const amount = form.elements.actual_amount;
    const syncAmount = () => {
      const recorded = status.value === "recorded";
      amount.disabled = !recorded;
      amount.required = recorded;
      if (!recorded) amount.value = "";
    };
    syncAmount();
    status.addEventListener("change", syncAmount);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      const chemicalId = form.elements.chemical_id.value;
      const usageStatus = status.value;
      const actualAmount = usageStatus === "recorded" ? Number(amount.value) : null;
      if (!chemicalId) return;
      if (usageStatus === "recorded" && !(actualAmount > 0)) return alert("実使用量を入力してください。");
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = "保存中…";
      const { error } = await supabase.rpc("save_service_chemical_usage", {
        p_service_record_id: recordId,
        p_service_step_id: activeStep.id,
        p_recordare_chemical_id: chemicalId,
        p_usage_status: usageStatus,
        p_actual_amount: actualAmount,
        p_notes: emptyToNull(form.elements.notes.value),
      });
      if (error) {
        button.disabled = false;
        button.textContent = originalText;
        return alert(saveErrorMessage(error));
      }
      await renderServiceTimer(recordId);
    });
  });
};

const bindCompletedServiceChemicalUsageForms = (recordId) => {
  document.querySelectorAll("[data-completed-service-chemical-form]").forEach((form) => {
    const status = form.elements.usage_status;
    const amount = form.elements.actual_amount;
    const syncAmount = () => {
      const recorded = status.value === "recorded";
      amount.disabled = !recorded;
      amount.required = recorded;
      if (!recorded) amount.value = "";
    };
    syncAmount();
    status.addEventListener("change", syncAmount);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      const stepId = form.elements.step_id.value;
      const chemicalId = form.elements.chemical_id.value;
      const usageStatus = status.value;
      const actualAmount = usageStatus === "recorded" ? Number(amount.value) : null;
      if (!stepId || !chemicalId) return alert("工程とケミカルを選択してください。");
      if (usageStatus === "recorded" && !(actualAmount > 0)) return alert("実使用量を入力してください。");
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = "保存中…";
      const { error } = await supabase.rpc("save_service_chemical_usage", {
        p_service_record_id: recordId,
        p_service_step_id: stepId,
        p_recordare_chemical_id: chemicalId,
        p_usage_status: usageStatus,
        p_actual_amount: actualAmount,
        p_notes: emptyToNull(form.elements.notes.value),
      });
      if (error) {
        button.disabled = false;
        button.textContent = originalText;
        return alert(saveErrorMessage(error));
      }
      await renderServiceDetail(recordId);
    });
  });
};

async function renderServiceTimer(recordId) {
  clearServiceElapsed();
  const token = ++serviceViewToken;
  setServiceContent('<div class="card placeholder"><p class="muted">工程を読み込んでいます…</p></div>');
  const [{ data: record, error: recordError }, { data: steps, error: stepsError }, { data: savedConditions }, { data: sessions, error: sessionsError }, { data: pauses }, { data: chemicalUsages, error: chemicalUsagesError }, { data: chemicals, error: chemicalsError }] = await Promise.all([
    supabase.from("service_records").select("*").eq("id", recordId).maybeSingle(),
    supabase.from("service_steps").select("*").eq("service_record_id", recordId).order("sequence_no", { ascending: true }),
    supabase.from("service_condition_tags").select("tag_key, details").eq("service_record_id", recordId),
    supabase.from("service_sessions").select("id, started_at, ended_at, status").eq("service_record_id", recordId).order("started_at", { ascending: true }),
    supabase.from("service_pauses").select("started_at, ended_at").eq("service_record_id", recordId),
    supabase.from("service_chemical_usages").select("id, service_step_id, recordare_chemical_id, usage_status, actual_amount, known_cost_amount, cost_status, unknown_cost_applied_amount, notes").eq("service_record_id", recordId),
    supabase.from("recordare_chemicals").select("id, status, unit, current_stock, chemical_catalog_products(manufacturer, product_name)").order("created_at", { ascending: true }),
  ]);
  if (token !== serviceViewToken || activeTab !== "施工") return;
  if (recordError || stepsError || sessionsError || chemicalUsagesError || chemicalsError || !record) return setServiceContent('<div class="card"><p class="error">工程を読み込めませんでした。</p></div>');
  if (record.status !== "in_progress") return renderServiceDetail(recordId);
  const activeStep = steps.find((step) => step.started_at && !step.ended_at);
  if (!activeStep) {
    if (steps.length && steps.every((step) => step.ended_at)) {
      const activeSession = (sessions || []).find((session) => !session.ended_at);
      if (!activeSession) return renderServiceActualReview(recordId, record, steps, sessions, pauses);
      return activeSession.status === "interrupted" ? renderCleanupState(recordId, record, steps, sessions, pauses) : renderServiceEndState(recordId, record, steps, sessions);
    }
    const recoveryError = await ensureActiveServiceStep(recordId, record, steps);
    if (recoveryError) return setServiceContent(`<div class="card"><p class="error">${escapeHtml(saveErrorMessage(recoveryError))}</p></div>`);
    return renderServiceTimer(recordId);
  }
  const currentIndex = steps.findIndex((step) => step.id === activeStep.id);
  const nextStep = steps[currentIndex + 1];
  const isPreCheck = activeStep.step_key === "pre_check" || activeStep.sequence_no === 1;
  const chemicalMarkup = isPreCheck ? "" : serviceChemicalUsageMarkup(activeStep, chemicalUsages, chemicals);
  setServiceContent(`<div class="card detail-card"><div class="detail-heading"><div><h2>${escapeHtml(record.customer_name)}</h2><p class="muted">${escapeHtml(`${record.vehicle_manufacturer} ${record.vehicle_model}`)}</p></div><span class="reservation-status">施工中</span></div><h2>${escapeHtml(activeStep.step_name)}</h2><dl><dt>開始</dt><dd>${escapeHtml(formatActualTime(activeStep.started_at))}</dd><dt>経過</dt><dd id="serviceStepElapsed"></dd></dl></div>${isPreCheck ? serviceConditionMarkup(record, savedConditions) : ""}${chemicalMarkup}<button class="primary service-action-button" type="button" id="nextServiceStepButton">${nextStep ? "次の工程へ" : "施工終了"}</button><button class="text-button" type="button" id="backToServiceList">← 施工一覧へ戻る</button>`);
  showServiceElapsed("serviceStepElapsed", activeStep.started_at);
  if (isPreCheck) bindServiceConditionForm(recordId, renderServiceTimer);
  else bindServiceChemicalUsageForms(recordId, activeStep);
  document.getElementById("nextServiceStepButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const now = new Date().toISOString();
    const { error: endError } = await supabase.from("service_steps").update({ ended_at: now }).eq("id", activeStep.id).is("ended_at", null);
    if (endError) return alert(saveErrorMessage(endError));
    if (nextStep) {
      const { error: startError } = await supabase.from("service_steps").update({ started_at: now }).eq("id", nextStep.id).is("started_at", null);
      if (startError) return alert(saveErrorMessage(startError));
      return renderServiceTimer(recordId);
    }
    const activeSession = (sessions || []).find((session) => !session.ended_at);
    if (activeSession) {
      const { error: sessionError } = await supabase.from("service_sessions").update({ status: "interrupted" }).eq("id", activeSession.id).eq("status", "active").is("ended_at", null);
      if (sessionError) return alert(saveErrorMessage(sessionError));
    }
    await renderServiceTimer(recordId);
  });
  document.getElementById("backToServiceList").addEventListener("click", renderServiceList);
}

async function renderServiceDetail(recordId) {
  clearServiceElapsed();
  const token = ++serviceViewToken;
  setServiceContent('<div class="card placeholder"><p class="muted">施工記録を読み込んでいます…</p></div>');
  const { data: record, error } = await supabase.from("service_records").select("*").eq("id", recordId).maybeSingle();
  if (token !== serviceViewToken || activeTab !== "施工") return;
  if (error || !record) return setServiceContent('<div class="card"><p class="error">施工記録を読み込めませんでした。</p><button class="secondary" type="button" id="backToServiceList">施工一覧へ戻る</button></div>');
  const { data: savedConditions } = await supabase.from("service_condition_tags").select("tag_key, details").eq("service_record_id", recordId);
  const { data: preparationSession } = await supabase.from("service_sessions").select("id, started_at").eq("service_record_id", recordId).eq("status", "active").is("ended_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (record.status === "in_progress") return renderServiceTimer(recordId);
  if (record.status === "planned" && preparationSession) return renderPreparationState(recordId, record, preparationSession);

  let serviceChemicalUsageDetailMarkup = "";
  if (record.status === "completed") {
    const [{ data: completedChemicalUsages, error: completedChemicalUsagesError }, { data: completedSteps, error: completedStepsError }, { data: completedChemicals, error: completedChemicalsError }] = await Promise.all([
      supabase.from("service_chemical_usages")
        .select("service_step_id, recordare_chemical_id, usage_status, actual_amount, unit_cost_per_ml, known_cost_amount, cost_status, unknown_cost_applied_amount, notes, service_steps(step_name, sequence_no), recordare_chemicals(id, unit, current_stock, chemical_catalog_products(manufacturer, product_name))")
        .eq("service_record_id", recordId)
        .order("created_at", { ascending: true }),
      supabase.from("service_steps").select("id, step_key, step_name, sequence_no").eq("service_record_id", recordId).order("sequence_no", { ascending: true }),
      supabase.from("recordare_chemicals").select("id, status, unit, current_stock, chemical_catalog_products(manufacturer, product_name)").eq("status", "active").order("created_at", { ascending: true }),
    ]);
    if (completedChemicalUsagesError || completedStepsError || completedChemicalsError) {
      serviceChemicalUsageDetailMarkup = '<section class="card"><h2>使用ケミカル</h2><p class="error">使用ケミカル履歴を読み込めませんでした。</p></section>';
    } else {
      const rows = (completedChemicalUsages || []).map((usage) => {
        const step = Array.isArray(usage.service_steps) ? usage.service_steps[0] : usage.service_steps;
        const chemical = Array.isArray(usage.recordare_chemicals) ? usage.recordare_chemicals[0] : usage.recordare_chemicals;
        const stock = chemical?.current_stock == null ? "在庫未登録" : `${chemical.current_stock}${chemical.unit || "mL"}`;
        return `<form class="service-timing-correction" data-completed-service-chemical-form>
          <input type="hidden" name="step_id" value="${escapeHtml(usage.service_step_id)}" />
          <input type="hidden" name="chemical_id" value="${escapeHtml(usage.recordare_chemical_id)}" />
          <h3>${escapeHtml(step?.step_name || "工程不明")} / ${escapeHtml(recordareChemicalName(chemical))}</h3>
          <p class="muted">現在在庫 ${escapeHtml(stock)} / ${escapeHtml(chemicalUsageCostText(usage))}</p>
          <label>記録状態<select name="usage_status">${serviceChemicalUsageStatusOptions(usage.usage_status)}</select></label>
          <label>実使用量mL<input name="actual_amount" type="number" inputmode="decimal" min="0.001" step="0.001" value="${escapeHtml(usage.actual_amount ?? "")}" /></label>
          <label>メモ<input name="notes" value="${escapeHtml(usage.notes || "")}" /></label>
          <button class="secondary" type="submit">変更を保存</button>
        </form>`;
      }).join("");
      const stepOptions = (completedSteps || [])
        .filter((step) => step.step_key !== "pre_check")
        .map((step) => `<option value="${escapeHtml(step.id)}">${escapeHtml(step.step_name)}</option>`)
        .join("");
      const chemicalOptions = (completedChemicals || [])
        .map((chemical) => {
          const stock = chemical.current_stock == null ? "在庫未登録" : `${chemical.current_stock}${chemical.unit || "mL"}`;
          return `<option value="${escapeHtml(chemical.id)}">${escapeHtml(recordareChemicalName(chemical))}（${escapeHtml(stock)}）</option>`;
        }).join("");
      const addForm = stepOptions && chemicalOptions ? `<form class="service-timing-correction" data-completed-service-chemical-form>
        <h3>ケミカルを追加</h3>
        <label>工程<select name="step_id" required><option value="">選択してください</option>${stepOptions}</select></label>
        <label>ケミカル<select name="chemical_id" required><option value="">選択してください</option>${chemicalOptions}</select></label>
        <label>記録状態<select name="usage_status">${serviceChemicalUsageStatusOptions("recorded")}</select></label>
        <label>実使用量mL<input name="actual_amount" type="number" inputmode="decimal" min="0.001" step="0.001" /></label>
        <label>メモ<input name="notes" /></label>
        <button class="secondary" type="submit">追加して保存</button>
      </form>` : '<p class="muted">追加できる工程またはマイケミカルがありません。</p>';
      const knownCostTotal = (completedChemicalUsages || []).reduce((sum, usage) => sum + Number(usage.known_cost_amount || 0), 0);
      const hasUnknownCost = (completedChemicalUsages || []).some((usage) => usage.usage_status === "recorded" && ["partial","unknown"].includes(usage.cost_status));
      const totalCostText = `${yen(Math.round(knownCostTotal))}${hasUnknownCost ? " + 価格不明分あり" : ""}`;
      serviceChemicalUsageDetailMarkup = `<section class="card"><h2>使用ケミカル</h2><p><strong>ケミカル原価合計 ${escapeHtml(totalCostText)}</strong></p><p class="muted">施工完了後も使用量・状態・メモを修正できます。在庫と原価は差分だけ自動調整されます。</p>${rows || '<p class="muted">まだ記録されていません。</p>'}${addForm}</section>`;
    }
  }

  const optionText = jsonArray(record.selected_options).map((item) => {
    const master = reservationOptions.find((option) => option.code === item.code);
    return `${master?.label || item.code}（${yen(item.amount)}）`;
  }).join("、") || "なし";
  const discountText = jsonArray(record.selected_discounts).map((item) => {
    const master = reservationDiscounts.find((discount) => discount.code === item.code);
    return `${master?.label || item.code}（−${yen(item.amount)}）`;
  }).join("、") || "なし";
  const actualTotalValue = record.actual_total ?? record.planned_total ?? "";
  const planned = plannedServiceTime(record);

  const actionMarkup = record.status === "planned"
    ? preparationSession
      ? '<button class="primary service-action-button" type="button" id="startServiceButton">施工開始</button>'
      : '<button class="primary service-action-button" type="button" id="prepareServiceButton">準備開始</button>'
    : record.status === "in_progress"
      ? '<button class="primary service-action-button" type="button" id="completeServiceButton">施工完了</button>'
      : "";

  const actualTimeMarkup = record.actual_started_at || record.actual_completed_at || record.actual_service_minutes != null
    ? `<div class="service-actual-summary"><div><span>開始</span><strong>${escapeHtml(formatActualTime(record.actual_started_at))}</strong></div><div><span>完了</span><strong>${escapeHtml(formatActualTime(record.actual_completed_at))}</strong></div><div><span>実施工</span><strong>${record.actual_service_minutes != null ? `${escapeHtml(record.actual_service_minutes)}分` : "計測中"}</strong></div>${record.actual_service_minutes != null ? `<div><span>予定との差</span><strong>${escapeHtml(serviceTimeDifference(record, planned))}</strong></div>` : ""}</div>`
    : '<p class="muted service-status-note">施工開始を押すと実際の開始時刻を記録します。</p>';

  const timingCorrectionMarkup = record.status === "in_progress" || record.status === "completed"
    ? `<form class="service-timing-correction" id="serviceTimingForm"><h3>時刻を修正</h3><label for="serviceActualStartTime">開始時刻</label><input id="serviceActualStartTime" name="actual_start_time" type="time" required value="${escapeHtml(record.actual_started_at ? formatActualTime(record.actual_started_at) : "")}" />${record.status === "completed" ? `<label for="serviceActualCompleteTime">完了時刻</label><input id="serviceActualCompleteTime" name="actual_complete_time" type="time" required value="${escapeHtml(record.actual_completed_at ? formatActualTime(record.actual_completed_at) : "")}" />` : ""}<button class="secondary" type="submit">時刻を保存</button></form>`
    : "";

  const resetMarkup = record.status === "in_progress"
    ? '<button class="text-button danger-text" type="button" id="resetServiceToPlanned">施工開始を取り消して予定に戻す</button>'
    : record.status === "completed"
      ? '<button class="text-button danger-text" type="button" id="reopenServiceButton">完了を取り消して施工中に戻す</button>'
      : "";
  const conditionMarkup = serviceConditionMarkup(record, savedConditions);

  setServiceContent(`<div class="card detail-card"><div class="detail-heading"><div><h2>${escapeHtml(record.customer_name)}</h2><p class="muted">${escapeHtml(`${record.vehicle_manufacturer} ${record.vehicle_model}`)}</p></div><span class="reservation-status">${escapeHtml(serviceStatuses[record.status] || record.status)}</span></div>${actionMarkup}${actualTimeMarkup}${timingCorrectionMarkup}${resetMarkup}<dl><dt>コース</dt><dd>${escapeHtml(reservationCourses[record.course_code] || record.course_code)}</dd><dt>施工日</dt><dd>${escapeHtml(reservationDate(record.service_date))}</dd><dt>予定時間</dt><dd>${escapeHtml(reservationTime(record.planned_start_time))}〜${escapeHtml(addMinutesToTime(record.planned_start_time, record.planned_slot_minutes || 0))}</dd><dt>オプション</dt><dd>${escapeHtml(optionText)}</dd></dl></div>${conditionMarkup}${serviceChemicalUsageDetailMarkup}<form class="card form-card" id="serviceActualForm"><h2>施工実績</h2><label for="serviceActualTotal">実売上</label><input id="serviceActualTotal" name="actual_total" type="number" inputmode="numeric" min="0" step="100" value="${escapeHtml(actualTotalValue)}" /><label for="serviceNotes">施工メモ</label><textarea id="serviceNotes" name="service_notes" rows="4">${escapeHtml(record.service_notes || "")}</textarea><p class="error hidden" id="serviceActualError"></p><button class="secondary" type="submit">実績を保存</button></form><button class="text-button" type="button" id="backToServiceList">← 施工一覧へ戻る</button>`);
  if (record.status === "completed") bindCompletedServiceChemicalUsageForms(recordId);

  document.getElementById("prepareServiceButton")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "準備開始中…";
    const { error: sessionError } = await supabase.from("service_sessions").insert({ service_record_id: recordId, started_at: new Date().toISOString(), status: "active" });
    if (sessionError) { button.disabled = false; button.textContent = "準備開始"; return alert(saveErrorMessage(sessionError)); }
    await renderServiceDetail(recordId);
  });

  document.getElementById("startServiceButton")?.addEventListener("click", async (event) => {
    if (!confirm("施工を開始しますか？現在時刻を開始時刻として記録します。")) return;
    await startServiceTimer(recordId, event.currentTarget);
  });

  document.getElementById("completeServiceButton")?.addEventListener("click", async (event) => {
    if (!confirm("施工を完了しますか？現在時刻を完了時刻として記録します。予約も「完了」になります。")) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "完了処理中…";
    const { error } = await supabase.from("service_records").update({ status: "completed" }).eq("id", recordId).eq("status", "in_progress");
    if (error) {
      button.disabled = false;
      button.textContent = "施工完了";
      return alert(saveErrorMessage(error));
    }
    await renderServiceDetail(recordId);
  });

  document.getElementById("serviceTimingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const fields = Object.fromEntries(new FormData(form));
    const startDate = timestampLocalDate(record.actual_started_at);
    const completedDate = timestampLocalDate(record.actual_completed_at);
    const startIso = localTimeToIso(startDate, fields.actual_start_time);
    const values = { actual_started_at: startIso };

    if (record.status === "completed") {
      const completeIso = localTimeToIso(completedDate, fields.actual_complete_time);
      if (new Date(completeIso) < new Date(startIso)) {
        return alert("完了時刻は開始時刻より後にしてください。");
      }
      values.actual_completed_at = completeIso;
    }

    button.disabled = true;
    button.textContent = "保存中…";
    const { error } = await supabase.from("service_records").update(values).eq("id", recordId);
    if (error) {
      button.disabled = false;
      button.textContent = "時刻を保存";
      return alert(saveErrorMessage(error));
    }
    await renderServiceDetail(recordId);
  });

  document.getElementById("resetServiceToPlanned")?.addEventListener("click", async () => {
    if (!confirm("施工開始を取り消して「予定」に戻しますか？開始時刻は消去されます。")) return;
    const { error } = await supabase.from("service_records").update({
      status: "planned",
      actual_started_at: null,
      actual_completed_at: null,
      actual_service_minutes: null,
    }).eq("id", recordId).eq("status", "in_progress");
    if (error) return alert(saveErrorMessage(error));
    await renderServiceDetail(recordId);
  });

  document.getElementById("reopenServiceButton")?.addEventListener("click", async () => {
    if (!confirm("完了を取り消して「施工中」に戻しますか？完了時刻と実施工時間は消去され、予約は「確定」に戻ります。")) return;
    const { error } = await supabase.from("service_records").update({
      status: "in_progress",
      actual_completed_at: null,
      actual_service_minutes: null,
    }).eq("id", recordId).eq("status", "completed");
    if (error) return alert(saveErrorMessage(error));
    await renderServiceDetail(recordId);
  });

  bindServiceConditionForm(recordId, renderServiceDetail);

  document.getElementById("serviceActualForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const fields = Object.fromEntries(new FormData(form));
    button.disabled = true;
    button.textContent = "保存中…";
    const values = {
      actual_total: fields.actual_total === "" ? null : Math.max(0, Number(fields.actual_total)),
      service_notes: emptyToNull(fields.service_notes),
    };
    const { error } = await supabase.from("service_records").update(values).eq("id", recordId);
    if (error) {
      button.disabled = false;
      button.textContent = "実績を保存";
      const message = document.getElementById("serviceActualError");
      message.textContent = saveErrorMessage(error);
      return message.classList.remove("hidden");
    }
    await renderServiceDetail(recordId);
  });

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
      actual_total: reservation.final_total,
      reservation_notes: reservation.notes,
      status: "planned",
    };

    const { data, error: insertError } = await supabase.from("service_records").insert(values).select("id").single();
    if (insertError || !data?.id) throw insertError || new Error("施工記録を作成できませんでした。");
    const steps = buildServiceSteps(reservation.course_code, reservation.selected_options).map((step, index) => ({
      service_record_id: data.id, step_key: step.step_key, step_name: step.name, order_group: step.order_group,
      sequence_no: index + 1, timed: step.timed, skippable: step.skippable, snapshot: { ...step, course_code: reservation.course_code, selected_options: jsonArray(reservation.selected_options) },
    }));
    if (steps.length) {
      const { error: stepError } = await supabase.from("service_steps").insert(steps);
      if (stepError) throw stepError;
    }
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
