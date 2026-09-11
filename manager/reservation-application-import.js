(() => {
  const baseReservationList = renderReservationList;
  const baseReservationForm = renderReservationForm;
  const normalize = (value = "") => String(value).replace(/\u3000/g, " ").trim();
  const applicationLines = (text) => String(text || "")
    .split(String.fromCharCode(10))
    .map((line) => normalize(line.replaceAll(String.fromCharCode(13), "")))
    .filter(Boolean);

  const applicationField = (text, labels) => {
    for (const line of applicationLines(text)) {
      const colon = line.search(/[：:]/);
      if (colon < 0) continue;
      const key = normalize(line.slice(0, colon)).replace(/^【/, "").replace(/】$/, "").trim();
      if (labels.includes(key)) return normalize(line.slice(colon + 1));
    }
    return "";
  };

  const courseCode = (value) => {
    const text = normalize(value);
    if (/リンスレス/i.test(text)) return "rinseless";
    if (/メンテナンス/i.test(text)) return "maintenance";
    if (/スタンダード/i.test(text)) return "standard";
    if (/リセット.*コート|リセット＆コート|リセット&コート/i.test(text)) return "reset_coat";
    return "";
  };

  const dateValue = (value) => {
    const text = normalize(value);
    const full = text.match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})/);
    if (full) return `${full[1]}-${String(Number(full[2])).padStart(2, "0")}-${String(Number(full[3])).padStart(2, "0")}`;
    const short = text.match(/(\d{1,2})[月\/-](\d{1,2})/);
    if (!short) return "";
    const now = new Date();
    let year = now.getFullYear();
    const candidate = new Date(year, Number(short[1]) - 1, Number(short[2]));
    if (candidate < new Date(now.getTime() - 30 * 86400000)) year += 1;
    return `${year}-${String(Number(short[1])).padStart(2, "0")}-${String(Number(short[2])).padStart(2, "0")}`;
  };

  const timeValue = (value) => {
    const match = normalize(value).match(/(?:^|\D)([01]?\d|2[0-3])[:時](\d{2})?/);
    return match ? `${String(Number(match[1])).padStart(2, "0")}:${String(Number(match[2] || 0)).padStart(2, "0")}` : "";
  };

  const manufacturers = ["トヨタ", "レクサス", "日産", "ニッサン", "ホンダ", "マツダ", "スバル", "スズキ", "ダイハツ", "三菱", "ミツビシ", "フォルクスワーゲン", "Volkswagen", "VW", "BMW", "メルセデス・ベンツ", "メルセデスベンツ", "ベンツ", "アウディ", "Audi", "ボルボ", "Volvo", "プジョー", "シトロエン", "ルノー", "MINI", "ミニ", "ポルシェ", "Porsche", "テスラ", "Tesla"];
  const manufacturerOptions = [
    "トヨタ", "レクサス", "日産", "ホンダ", "マツダ", "スバル", "スズキ", "ダイハツ", "三菱",
    "フォルクスワーゲン", "BMW", "メルセデス・ベンツ", "アウディ", "ボルボ", "プジョー", "シトロエン", "ルノー", "MINI", "ポルシェ", "テスラ",
  ];
  const canonicalManufacturer = (value) => {
    const text = normalize(value);
    const aliases = {
      "ニッサン": "日産",
      "ミツビシ": "三菱",
      "Volkswagen": "フォルクスワーゲン",
      "VW": "フォルクスワーゲン",
      "メルセデスベンツ": "メルセデス・ベンツ",
      "ベンツ": "メルセデス・ベンツ",
      "Audi": "アウディ",
      "Volvo": "ボルボ",
      "ミニ": "MINI",
      "Porsche": "ポルシェ",
      "Tesla": "テスラ",
    };
    return aliases[text] || text;
  };
  const vehicleParts = (text) => {
    const manufacturer = applicationField(text, ["メーカー", "車両メーカー"]);
    const rawModel = applicationField(text, ["車種", "車名", "車両"]);
    if (manufacturer || !rawModel) return { manufacturer: canonicalManufacturer(manufacturer), model: rawModel };
    const found = manufacturers.find((item) => rawModel.toLowerCase().startsWith(item.toLowerCase()));
    return found ? { manufacturer: canonicalManufacturer(found), model: normalize(rawModel.slice(found.length)) } : { manufacturer: "", model: rawModel };
  };

  const parseApplication = (text) => {
    const vehicle = vehicleParts(text);
    const dateSource = applicationField(text, ["施工希望日", "希望日", "予約日", "施工日", "希望日時", "予約日時"]);
    const timeSource = applicationField(text, ["希望時間", "開始時間", "施工時間", "時間", "希望日時", "予約日時"]);
    return {
      customerName: applicationField(text, ["お名前", "氏名", "お客様名", "名前"]),
      phone: applicationField(text, ["電話番号", "電話"]),
      lineName: applicationField(text, ["LINE表示名", "LINE名"]),
      manufacturer: vehicle.manufacturer,
      model: vehicle.model,
      color: applicationField(text, ["ボディカラー", "車体色", "カラー", "色"]),
      plate: applicationField(text, ["ナンバー下4桁", "ナンバー"]).replace(/\D/g, "").slice(-4),
      course: courseCode(applicationField(text, ["コース", "施工コース", "希望コース"])),
      date: dateValue(dateSource),
      time: timeValue(timeSource),
      originalText: String(text || "").trim(),
    };
  };

  const syncManufacturerOther = () => {
    const select = document.getElementById("applicationManufacturer");
    const other = document.getElementById("applicationManufacturerOther");
    if (!select || !other) return;
    const isOther = select.value === "__other__";
    other.classList.toggle("hidden", !isOther);
    other.required = isOther;
    if (!isOther) other.value = "";
  };
  const setManufacturerField = (value) => {
    const select = document.getElementById("applicationManufacturer");
    const other = document.getElementById("applicationManufacturerOther");
    if (!select || !other || !value) return;
    const canonical = canonicalManufacturer(value);
    if (manufacturerOptions.includes(canonical)) {
      select.value = canonical;
      other.value = "";
    } else {
      select.value = "__other__";
      other.value = canonical;
    }
    syncManufacturerOther();
  };
  const selectedManufacturer = () => {
    const select = document.getElementById("applicationManufacturer");
    const other = document.getElementById("applicationManufacturerOther");
    if (!select) return "";
    return select.value === "__other__" ? normalize(other?.value) : normalize(select.value);
  };

  const fillParsedFields = (parsed) => {
    const values = {
      applicationCustomerName: parsed.customerName,
      applicationPhone: parsed.phone,
      applicationLineName: parsed.lineName,
      applicationModel: parsed.model,
      applicationColor: parsed.color,
      applicationPlate: parsed.plate,
      applicationCourse: parsed.course,
      applicationDate: parsed.date,
      applicationTime: parsed.time,
    };
    Object.entries(values).forEach(([id, value]) => {
      const input = document.getElementById(id);
      if (input && value) input.value = value;
    });
    setManufacturerField(parsed.manufacturer);
  };

  async function reusableCustomer(values) {
    if (!values.phone) return null;
    const { data, error } = await supabase.from("customers").select("id,name,phone,line_display_name").eq("is_active", true).eq("phone", values.phone).limit(2);
    if (error) throw error;
    return data?.length === 1 ? data[0] : null;
  }

  async function reusableVehicle(customerId, values) {
    const { data, error } = await supabase.from("customer_vehicles").select("id,manufacturer,model,color,size_class").eq("customer_id", customerId).eq("is_active", true);
    if (error) throw error;
    const clean = (value) => normalize(value).toLowerCase();
    const matches = (data || []).filter((vehicle) => clean(vehicle.manufacturer) === clean(values.manufacturer) && clean(vehicle.model) === clean(values.model) && (!values.color || clean(vehicle.color) === clean(values.color)));
    return matches.length === 1 ? matches[0] : null;
  }

  async function openReservationWith(customer, vehicle, draft) {
    await baseReservationForm();
    const customerSearch = document.getElementById("reservationCustomerSearch");
    const customerId = document.getElementById("reservationCustomerId");
    const vehicleSelect = document.getElementById("reservationVehicle");
    if (!customerSearch || !customerId || !vehicleSelect) return;
    customerSearch.value = customer.name;
    customerId.value = customer.id;
    document.getElementById("viewReservationCustomer")?.classList.remove("hidden");
    vehicleSelect.innerHTML = `<option value="${escapeHtml(vehicle.id)}" selected>${escapeHtml(reservationVehicleName(vehicle))}（${escapeHtml(vehicle.color || "")}）</option>`;
    vehicleSelect.disabled = false;

    const size = document.getElementById("reservationSizeClass");
    if (size) { size.value = vehicle.size_class || draft.sizeClass || ""; size.dispatchEvent(new Event("change", { bubbles: true })); }
    const course = document.getElementById("reservationCourse");
    if (course && draft.course) { course.value = draft.course; course.dispatchEvent(new Event("change", { bubbles: true })); }
    const date = document.getElementById("reservationDate");
    if (date && draft.date) date.value = draft.date;
    const time = document.getElementById("reservationTime");
    if (time && draft.time) { time.value = draft.time; time.dispatchEvent(new Event("input", { bubbles: true })); }
    const notes = document.getElementById("reservationNotes");
    if (notes && draft.originalText) notes.value = ["予約申込原文", draft.originalText].join(String.fromCharCode(10));
  }

  async function renderApplicationImport() {
    const manufacturerMarkup = manufacturerOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    setReservationContent(`<form class="card form-card" id="reservationApplicationForm"><h2>予約申込から登録</h2><p class="muted">LINEで届いた予約申込文を貼り付けると、読み取れる項目を自動入力します。</p><label>予約申込文</label><textarea id="reservationApplicationText" rows="8" placeholder="【RE 予約申込】から始まるメッセージを貼り付け"></textarea><button class="secondary" type="button" id="parseReservationApplicationButton">内容を読み取る</button><label>お客様名</label><input id="applicationCustomerName" required autocomplete="name"><label>電話番号</label><input id="applicationPhone" type="tel" inputmode="tel"><label>LINE表示名</label><input id="applicationLineName"><label>メーカー</label><select id="applicationManufacturer" required><option value="">メーカーを選択</option>${manufacturerMarkup}<option value="__other__">その他</option></select><input id="applicationManufacturerOther" class="hidden" placeholder="メーカー名を入力"><label>車種</label><input id="applicationModel" required><label>色</label><input id="applicationColor" required><label>ナンバー下4桁</label><input id="applicationPlate" inputmode="numeric" pattern="[0-9]{4}" maxlength="4"><label>車両区分</label><select id="applicationSizeClass" required><option value="">車両区分を選択</option>${Object.entries(reservationSizeClasses).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select><label>コース</label><select id="applicationCourse"><option value="">予約画面で選択</option>${Object.entries(reservationCourses).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select><label>施工日</label><input id="applicationDate" type="date"><label>開始時間</label><input id="applicationTime" type="time"><p class="error hidden" id="reservationApplicationError"></p><button class="primary" type="submit">顧客・車両を登録して予約へ</button><button class="text-button" type="button" id="cancelReservationApplicationButton">予約一覧へ戻る</button></form>`);
    const text = document.getElementById("reservationApplicationText");
    document.getElementById("applicationManufacturer").addEventListener("change", syncManufacturerOther);
    document.getElementById("parseReservationApplicationButton").addEventListener("click", () => fillParsedFields(parseApplication(text.value)));
    document.getElementById("cancelReservationApplicationButton").addEventListener("click", renderReservationList);
    document.getElementById("reservationApplicationForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"]');
      const errorTarget = document.getElementById("reservationApplicationError");
      const draft = parseApplication(text.value);
      const customerValues = { name: normalize(document.getElementById("applicationCustomerName").value), phone: emptyToNull(document.getElementById("applicationPhone").value), line_display_name: emptyToNull(document.getElementById("applicationLineName").value), contact_method: "line", notes: null };
      const vehicleValues = { manufacturer: selectedManufacturer(), model: normalize(document.getElementById("applicationModel").value), color: normalize(document.getElementById("applicationColor").value), plate_last4: emptyToNull(document.getElementById("applicationPlate").value), size_class: document.getElementById("applicationSizeClass").value, notes: null };
      draft.sizeClass = vehicleValues.size_class;
      draft.course = document.getElementById("applicationCourse").value || draft.course;
      draft.date = document.getElementById("applicationDate").value || draft.date;
      draft.time = document.getElementById("applicationTime").value || draft.time;
      if (!customerValues.name || !vehicleValues.manufacturer || !vehicleValues.model || !vehicleValues.color || !vehicleValues.size_class) {
        errorTarget.textContent = "お客様名・メーカー・車種・色・車両区分を確認してください。";
        return errorTarget.classList.remove("hidden");
      }
      button.disabled = true;
      button.textContent = "登録中…";
      errorTarget.classList.add("hidden");
      let createdCustomerId = null;
      let createdVehicleId = null;
      try {
        let customer = await reusableCustomer(customerValues);
        if (!customer) {
          const result = await supabase.from("customers").insert(customerValues).select("id,name,phone,line_display_name").single();
          if (result.error || !result.data?.id) throw result.error || new Error("顧客の登録結果を確認できませんでした。");
          customer = result.data;
          createdCustomerId = customer.id;
        }
        let vehicle = await reusableVehicle(customer.id, vehicleValues);
        if (!vehicle) {
          const result = await supabase.from("customer_vehicles").insert({ customer_id: customer.id, ...vehicleValues }).select("id,manufacturer,model,color,size_class").single();
          if (result.error || !result.data?.id) throw result.error || new Error("車両の登録結果を確認できませんでした。");
          vehicle = result.data;
          createdVehicleId = vehicle.id;
        }
        await openReservationWith(customer, vehicle, draft);
      } catch (error) {
        if (createdVehicleId) await supabase.from("customer_vehicles").update({ is_active: false }).eq("id", createdVehicleId);
        if (createdCustomerId) await supabase.from("customers").update({ is_active: false }).eq("id", createdCustomerId);
        button.disabled = false;
        button.textContent = "顧客・車両を登録して予約へ";
        errorTarget.textContent = saveErrorMessage(error);
        errorTarget.classList.remove("hidden");
      }
    });
  }

  const addImportButton = () => {
    const newButton = document.getElementById("newReservationButton");
    if (!newButton || document.getElementById("reservationApplicationButton")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "reservationApplicationButton";
    button.className = "secondary add-button";
    button.textContent = "＋ 新規のお客様の予約申込から登録";
    button.addEventListener("click", renderApplicationImport);
    newButton.insertAdjacentElement("afterend", button);
  };

  renderReservationList = async function(...args) {
    const result = await baseReservationList(...args);
    addImportButton();
    return result;
  };
  if (activeTab === "予約") queueMicrotask(addImportButton);
})();