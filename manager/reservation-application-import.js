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
  const reservationOptionCodes = (value) => {
    const text = normalize(value);
    if (!text || text === "なし") return [];
    const parts = text.split(/[、,，]/).map((item) => normalize(item)).filter(Boolean);
    const rules = [
      ["front_glass_scale", /フロントガラス.*ウロコ/],
      ["all_glass_scale", /全面ガラス.*ウロコ/],
      ["front_glass_oil_repellent", /フロントガラス.*油膜.*撥水/],
      ["all_glass_oil_repellent", /全面ガラス.*油膜.*撥水/],
      ["body_iron_removal", /ボディ.*鉄粉/],
      ["wheel_scale_heavy", /ホイール.*スケール.*重度/],
      ["wheel_scale_light", /ホイール.*スケール.*軽度/],
      ["unpainted_resin_wide", /未塗装樹脂.*広範囲/],
      ["unpainted_resin_partial", /未塗装樹脂.*部分/],
    ];
    return [...new Set(parts.map((part) => rules.find(([, pattern]) => pattern.test(part))?.[0]).filter(Boolean))];
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

  const manufacturers = ["メルセデス・ベンツ", "メルセデスベンツ", "フォルクスワーゲン", "Volkswagen", "VOLKSWAGEN", "TOYOTA", "LEXUS", "NISSAN", "HONDA", "MAZDA", "SUBARU", "SUZUKI", "DAIHATSU", "MITSUBISHI", "AUDI", "VOLVO", "PORSCHE", "TESLA", "トヨタ", "レクサス", "日産", "ニッサン", "ホンダ", "マツダ", "スバル", "スズキ", "ダイハツ", "三菱", "ミツビシ", "VW", "BMW", "ベンツ", "アウディ", "Audi", "ボルボ", "Volvo", "プジョー", "シトロエン", "ルノー", "MINI", "ミニ", "ポルシェ", "Porsche", "テスラ", "Tesla"];
  const manufacturerOptions = [
    "トヨタ", "レクサス", "日産", "ホンダ", "マツダ", "スバル", "スズキ", "ダイハツ", "三菱",
    "フォルクスワーゲン", "BMW", "メルセデス・ベンツ", "アウディ", "ボルボ", "プジョー", "シトロエン", "ルノー", "MINI", "ポルシェ", "テスラ",
  ];
  const canonicalManufacturer = (value) => {
    const text = normalize(value);
    const aliases = {
      "TOYOTA": "トヨタ",
      "LEXUS": "レクサス",
      "NISSAN": "日産",
      "HONDA": "ホンダ",
      "MAZDA": "マツダ",
      "SUBARU": "スバル",
      "SUZUKI": "スズキ",
      "DAIHATSU": "ダイハツ",
      "MITSUBISHI": "三菱",
      "AUDI": "アウディ",
      "VOLVO": "ボルボ",
      "PORSCHE": "ポルシェ",
      "TESLA": "テスラ",
      "VOLKSWAGEN": "フォルクスワーゲン",
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
    return aliases[text] || aliases[text.toUpperCase()] || text;
  };
  const vehicleParts = (text) => {
    const manufacturer = applicationField(text, ["メーカー", "車両メーカー", "自動車メーカー"]);
    const rawModel = applicationField(text, ["車種", "車名", "車両", "お車", "車両情報", "車種・車名"]);
    if (manufacturer || !rawModel) return { manufacturer: canonicalManufacturer(manufacturer), model: rawModel };
    const rawLower = rawModel.toLowerCase();
    const found = manufacturers.find((item) => rawLower.startsWith(item.toLowerCase()) || rawLower.includes(item.toLowerCase()));
    if (!found) return { manufacturer: "", model: rawModel };
    const index = rawLower.indexOf(found.toLowerCase());
    const model = normalize(rawModel.slice(0, index) + " " + rawModel.slice(index + found.length));
    return { manufacturer: canonicalManufacturer(found), model };
  };

  const vehicleComparable = (value) => normalize(value)
    .toLowerCase()
    .replace(/[\s　・･_\-ー\/\\()（）【】\[\]]+/g, "");
  const vehicleMatchScore = (vehicle, values) => {
    let score = 0;
    const vehicleMaker = vehicleComparable(canonicalManufacturer(vehicle.manufacturer));
    const targetMaker = vehicleComparable(canonicalManufacturer(values.manufacturer));
    const vehicleModel = vehicleComparable(vehicle.model);
    const targetModel = vehicleComparable(values.model);
    const vehicleColor = vehicleComparable(vehicle.color);
    const targetColor = vehicleComparable(values.color);
    const vehiclePlate = String(vehicle.plate_last4 || "").replace(/\D/g, "").slice(-4);
    const targetPlate = String(values.plate_last4 || values.plate || "").replace(/\D/g, "").slice(-4);

    if (vehicleMaker && targetMaker) {
      if (vehicleMaker === targetMaker) score += 5;
      else if (vehicleMaker.includes(targetMaker) || targetMaker.includes(vehicleMaker)) score += 2;
    }
    if (vehicleModel && targetModel) {
      if (vehicleModel === targetModel) score += 10;
      else if (vehicleModel.includes(targetModel) || targetModel.includes(vehicleModel)) score += 7;
      else {
        const shorter = vehicleModel.length <= targetModel.length ? vehicleModel : targetModel;
        const longer = vehicleModel.length > targetModel.length ? vehicleModel : targetModel;
        if (shorter.length >= 3 && longer.includes(shorter.slice(0, Math.max(3, Math.floor(shorter.length * 0.7))))) score += 4;
      }
    }
    if (vehicleColor && targetColor && vehicleColor === targetColor) score += 2;
    if (vehiclePlate && targetPlate && vehiclePlate === targetPlate) score += 8;
    return score;
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
      course: courseCode(applicationField(text, ["コース", "施工コース", "希望コース", "ご希望コース", "メニュー", "施工内容"]) || applicationLines(text).find((line) => courseCode(line)) || ""),
      options: reservationOptionCodes(applicationField(text, ["希望オプション", "オプション", "追加オプション"])),
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
    const { data, error } = await supabase.from("customer_vehicles").select("id,manufacturer,model,color,plate_last4,size_class").eq("customer_id", customerId).eq("is_active", true);
    if (error) throw error;
    const ranked = (data || []).map((vehicle) => ({ vehicle, score: vehicleMatchScore(vehicle, values) }))
      .sort((a, b) => b.score - a.score);
    if (!ranked.length || ranked[0].score < 7) return null;
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
    return ranked[0].vehicle;
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
    (draft.options || []).forEach((code) => {
      const checkbox = document.querySelector(`[data-option-code="${code}"]`);
      const row = checkbox?.closest(".pricing-choice");
      if (!checkbox || row?.hidden) return;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const date = document.getElementById("reservationDate");
    if (date && draft.date) date.value = draft.date;
    const time = document.getElementById("reservationTime");
    if (time && draft.time) { time.value = draft.time; time.dispatchEvent(new Event("input", { bubbles: true })); }
    const notes = document.getElementById("reservationNotes");
    if (notes && draft.originalText) notes.value = ["予約申込原文", draft.originalText].join(String.fromCharCode(10));
  }

  async function renderApplicationImport() {
    const { data: customers, error: customerError } = await supabase.from("customers")
      .select("id,name,phone,line_display_name")
      .eq("is_active", true)
      .order("name");
    if (customerError) return setReservationContent('<div class="card"><p class="error">顧客を読み込めませんでした。</p></div>');

    const manufacturerMarkup = manufacturerOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    setReservationContent(`<form class="card form-card" id="reservationApplicationForm"><h2>LINE予約申込から登録</h2><p class="muted">LINEで届いた予約申込文を貼り付けると、読み取れる項目を自動入力します。リピーターは既存のお客様・車両へ紐づけできます。</p><label>予約申込文</label><textarea id="reservationApplicationText" rows="8" placeholder="【RE 予約申込】から始まるメッセージを貼り付け"></textarea><button class="secondary" type="button" id="parseReservationApplicationButton">内容を読み取る</button><div class="pricing-group"><div class="pricing-group-title">既存のお客様</div><p class="muted">リピーターの場合は、名前・LINE名・電話番号で検索して選択してください。新規の場合は選択不要です。</p><input id="applicationCustomerSearch" type="search" placeholder="既存顧客を検索" autocomplete="off"><input id="applicationExistingCustomerId" type="hidden"><div class="picker-results" id="applicationCustomerResults"></div><p class="muted" id="applicationCustomerSelection">新規のお客様として登録</p><label>既存車両</label><select id="applicationExistingVehicle" disabled><option value="">先に既存のお客様を選択してください</option></select></div><label>お客様名</label><input id="applicationCustomerName" required autocomplete="name"><label>電話番号</label><input id="applicationPhone" type="tel" inputmode="tel"><label>LINE表示名</label><input id="applicationLineName"><label>メーカー</label><select id="applicationManufacturer" required><option value="">メーカーを選択</option>${manufacturerMarkup}<option value="__other__">その他</option></select><input id="applicationManufacturerOther" class="hidden" placeholder="メーカー名を入力"><label>車種</label><input id="applicationModel" required><label>色</label><input id="applicationColor" required><label>ナンバー下4桁</label><input id="applicationPlate" inputmode="numeric" pattern="[0-9]{4}" maxlength="4"><label>車両区分</label><select id="applicationSizeClass" required><option value="">車両区分を選択</option>${Object.entries(reservationSizeClasses).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select><label>コース</label><select id="applicationCourse"><option value="">予約画面で選択</option>${Object.entries(reservationCourses).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select><label>施工日</label><input id="applicationDate" type="date"><label>開始時間</label><input id="applicationTime" type="time"><p class="error hidden" id="reservationApplicationError"></p><button class="primary" type="submit" id="reservationApplicationSubmit">新規顧客・車両を登録して予約へ</button><button class="text-button" type="button" id="cancelReservationApplicationButton">予約一覧へ戻る</button></form>`);
    const text = document.getElementById("reservationApplicationText");
    const customerSearch = document.getElementById("applicationCustomerSearch");
    const existingCustomerId = document.getElementById("applicationExistingCustomerId");
    const customerResults = document.getElementById("applicationCustomerResults");
    const customerSelection = document.getElementById("applicationCustomerSelection");
    const existingVehicle = document.getElementById("applicationExistingVehicle");
    const submitButton = document.getElementById("reservationApplicationSubmit");
    let customerVehicles = [];

    const clean = (value) => normalize(value).toLowerCase();
    const phoneDigits = (value) => String(value || "").replace(/\D/g, "");
    const updateSubmitLabel = () => {
      if (!existingCustomerId.value) submitButton.textContent = "新規顧客・車両を登録して予約へ";
      else if (existingVehicle.value && existingVehicle.value !== "__new__") submitButton.textContent = "この顧客・車両で予約へ";
      else submitButton.textContent = "この顧客に車両を追加して予約へ";
    };
    const clearExistingCustomer = () => {
      existingCustomerId.value = "";
      customerSelection.textContent = "新規のお客様として登録";
      customerVehicles = [];
      existingVehicle.innerHTML = '<option value="">先に既存のお客様を選択してください</option>';
      existingVehicle.disabled = true;
      updateSubmitLabel();
    };
    const applyExistingVehicle = (vehicle) => {
      if (!vehicle) return;
      setManufacturerField(vehicle.manufacturer || "");
      document.getElementById("applicationModel").value = vehicle.model || "";
      document.getElementById("applicationColor").value = vehicle.color || "";
      document.getElementById("applicationPlate").value = vehicle.plate_last4 || "";
      document.getElementById("applicationSizeClass").value = vehicle.size_class || "";
    };
    const loadExistingVehicles = async (customerId) => {
      const { data, error } = await supabase.from("customer_vehicles")
        .select("id,manufacturer,model,color,plate_last4,size_class")
        .eq("customer_id", customerId)
        .eq("is_active", true)
        .order("created_at");
      if (error) throw error;
      customerVehicles = data || [];
      const target = {
        manufacturer: selectedManufacturer(),
        model: document.getElementById("applicationModel").value,
        color: document.getElementById("applicationColor").value,
        plate_last4: document.getElementById("applicationPlate").value,
      };
      const ranked = customerVehicles.map((vehicle, index) => ({ vehicle, index, score: vehicleMatchScore(vehicle, target) }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
      const best = ranked[0] || null;
      const strongMatch = Boolean(best && best.score >= 7);
      const existingOptions = ranked.map(({ vehicle }, index) => {
        const hint = strongMatch && index === 0 ? "（予約文と近い候補）" : "";
        return `<option value="${escapeHtml(vehicle.id)}">${escapeHtml(reservationVehicleName(vehicle))}（${escapeHtml(vehicle.color || "")}）${hint}</option>`;
      }).join("");
      existingVehicle.innerHTML = strongMatch
        ? `${existingOptions}<option value="__new__">＋ 新しい車両として追加</option>`
        : `<option value="__new__">＋ 新しい車両として追加</option>${existingOptions}`;
      existingVehicle.disabled = false;
      if (strongMatch) {
        existingVehicle.value = best.vehicle.id;
        applyExistingVehicle(best.vehicle);
      } else {
        existingVehicle.value = "__new__";
      }
      updateSubmitLabel();
    };
    const selectExistingCustomer = async (customer) => {
      existingCustomerId.value = customer.id;
      customerSearch.value = customer.name;
      customerResults.innerHTML = "";
      customerSelection.textContent = `既存のお客様「${customer.name}」に紐づけ`;
      document.getElementById("applicationCustomerName").value = customer.name || "";
      document.getElementById("applicationPhone").value = customer.phone || "";
      document.getElementById("applicationLineName").value = customer.line_display_name || "";
      await loadExistingVehicles(customer.id);
    };
    const showCustomers = (query = "") => {
      const q = clean(query);
      const digits = phoneDigits(query);
      if (!q && !digits) {
        customerResults.innerHTML = "";
        return;
      }
      const matches = (customers || []).filter((customer) =>
        clean(customer.name).includes(q) ||
        clean(customer.line_display_name).includes(q) ||
        (digits && phoneDigits(customer.phone).includes(digits))
      ).slice(0, 8);
      customerResults.innerHTML = matches.map((customer) => `<button class="picker-option" type="button" data-application-customer="${escapeHtml(customer.id)}"><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.line_display_name || customer.phone || "")}</small></button>`).join("");
      customerResults.querySelectorAll("[data-application-customer]").forEach((button) => button.addEventListener("click", async () => {
        const customer = customers.find((item) => item.id === button.dataset.applicationCustomer);
        if (!customer) return;
        try { await selectExistingCustomer(customer); }
        catch (error) { alert(saveErrorMessage(error)); }
      }));
    };
    const autoMatchCustomer = async (parsed) => {
      const exactPhone = phoneDigits(parsed.phone);
      const exactLine = clean(parsed.lineName);
      const exactName = clean(parsed.customerName);
      const exact = (customers || []).filter((customer) =>
        (exactPhone && phoneDigits(customer.phone) === exactPhone) ||
        (exactLine && clean(customer.line_display_name) === exactLine) ||
        (exactName && clean(customer.name) === exactName)
      );
      if (exact.length === 1) {
        await selectExistingCustomer(exact[0]);
        return true;
      }
      clearExistingCustomer();
      const query = parsed.phone || parsed.lineName || parsed.customerName;
      customerSearch.value = query;
      showCustomers(query);
      return false;
    };

    document.getElementById("applicationManufacturer").addEventListener("change", syncManufacturerOther);
    document.getElementById("parseReservationApplicationButton").addEventListener("click", async () => {
      const parsed = parseApplication(text.value);
      fillParsedFields(parsed);
      try { await autoMatchCustomer(parsed); }
      catch (error) { alert(saveErrorMessage(error)); }
    });
    customerSearch.addEventListener("input", () => {
      if (existingCustomerId.value) clearExistingCustomer();
      showCustomers(customerSearch.value);
    });
    existingVehicle.addEventListener("change", () => {
      const vehicle = customerVehicles.find((item) => item.id === existingVehicle.value);
      if (vehicle) applyExistingVehicle(vehicle);
      updateSubmitLabel();
    });
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
        let customer = customers.find((item) => item.id === existingCustomerId.value) || null;
        if (!customer) customer = await reusableCustomer(customerValues);
        if (!customer) {
          const result = await supabase.from("customers").insert(customerValues).select("id,name,phone,line_display_name").single();
          if (result.error || !result.data?.id) throw result.error || new Error("顧客の登録結果を確認できませんでした。");
          customer = result.data;
          createdCustomerId = customer.id;
        }

        const explicitExistingCustomer = existingCustomerId.value === customer.id;
        const selectedExistingVehicleId = explicitExistingCustomer ? existingVehicle.value : "";
        let vehicle = selectedExistingVehicleId && selectedExistingVehicleId !== "__new__"
          ? customerVehicles.find((item) => item.id === selectedExistingVehicleId) || null
          : null;
        if (selectedExistingVehicleId && selectedExistingVehicleId !== "__new__" && !vehicle) {
          throw new Error("選択した既存車両を確認できませんでした。");
        }
        if (!vehicle && !explicitExistingCustomer) vehicle = await reusableVehicle(customer.id, vehicleValues);
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
        updateSubmitLabel();
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
    button.textContent = "＋ LINE予約申込から登録";
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