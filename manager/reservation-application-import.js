(() => {
  const baseRenderReservationListForApplication = renderReservationList;
  const baseRenderReservationFormForApplication = renderReservationForm;

  const applicationNormalize = (value = "") => String(value).replace(/\u3000/g, " ").trim();
  const applicationRegexEscape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const applicationField = (text, labels) => {
    const lines = String(text || "").split(/\r?\n/).map(applicationNormalize).filter(Boolean);
    for (const label of labels) {
      const escaped = applicationRegexEscape(label);
      const pattern = new RegExp(`^(?:【\\s*)?${escaped}(?:\\s*】)?\\s*[：:]\\s*(.+)$`, "i");
      const line = lines.find((item) => pattern.test(item));
      if (line) return applicationNormalize(line.match(pattern)?.[1] || "");
    }
    return "";
  };

  const applicationCourseCode = (value) => {
    const text = applicationNormalize(value);
    if (!text) return "";
    if (/リンスレス/i.test(text)) return "rinseless";
    if (/メンテナンス/i.test(text)) return "maintenance";
    if (/スタンダード/i.test(text)) return "standard";
    if (/リセット.*コート|リセット＆コート|リセット&コート/i.test(text)) return "reset_coat";
    return "";
  };

  const applicationDate = (value) => {
    const text = applicationNormalize(value);
    if (!text) return "";
    const full = text.match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})/);
    if (full) return `${full[1]}-${String(Number(full[2])).padStart(2, "0")}-${String(Number(full[3])).padStart(2, "0")}`;
    const short = text.match(/(\d{1,2})[月\/-](\d{1,2})/);
    if (!short) return "";
    const now = new Date();
    let year = now.getFullYear();
    const candidate = new Date(year, Number(short[1]) - 1, Number(short[2]));
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    if (candidate < thirtyDaysAgo) year += 1;
    return `${year}-${String(Number(short[1])).padStart(2, "0")}-${String(Number(short[2])).padStart(2, "0")}`;
  };

  const applicationTime = (value) => {
    const match = applicationNormalize(value).match(/(?:^|\D)([01]?\d|2[0-3])[:時](\d{2})?/);
    if (!match) return "";
    return `${String(Number(match[1])).padStart(2, "0")}:${String(Number(match[2] || 0)).padStart(2, "0")}`;
  };

  const knownManufacturers = [
    "トヨタ", "レクサス", "日産", "ニッサン", "ホンダ", "マツダ", "スバル", "スズキ", "ダイハツ", "三菱", "ミツビシ",
    "フォルクスワーゲン", "Volkswagen", "VW", "BMW", "メルセデス・ベンツ", "メルセデスベンツ", "ベンツ", "アウディ", "Audi",
    "ボルボ", "Volvo", "プジョー", "シトロエン", "ルノー", "MINI", "ミニ", "ポルシェ", "Porsche", "テスラ", "Tesla",
  ];

  const applicationVehicleParts = (text) => {
    const manufacturer = applicationField(text, ["メーカー", "車両メーカー"]);
    const model = applicationField(text, ["車種", "車名", "車両"]);
    if (manufacturer || !model) return { manufacturer, model };
    const found = knownManufacturers.find((item) => model.toLowerCase().startsWith(item.toLowerCase()));
    if (!found) return { manufacturer: "", model };
    return { manufacturer: found, model: applicationNormalize(model.slice(found.length)) };
  };

  const parseReservationApplication = (text) => {
    const vehicle = applicationVehicleParts(text);
    const dateSource = applicationField(text, ["施工希望日", "希望日", "予約日", "施工日", "希望日時", "予約日時"]);
    const timeSource = applicationField(text, ["希望時間", "開始時間", "施工時間", "時間", "希望日時", "予約日時"]);
    return {
      customerName: applicationField(text, ["お名前", "氏名", "お客様名", "名前"]),
      phone: applicationField(text, ["電話番号", "電話"]),
      lineDisplayName: applicationField(text, ["LINE表示名", "LINE名"]),
      manufacturer: vehicle.manufacturer,
      model: vehicle.model,
      color: applicationField(text, ["ボディカラー", "車体色", "カラー", "色"]),
      plateLast4: applicationField(text, ["ナンバー下4桁", "ナンバー"]).replace(/\D/g, "").slice(-4),
      courseCode: applicationCourseCode(applicationField(text, ["コース", "施工コース", "希望コース"])),
      reservationDate: applicationDate(dateSource),
      startTime: applicationTime(timeSource),
      originalText: String(text || "").trim(),
    };
  };

  const setApplicationFields = (parsed) => {
    const pairs = {
      applicationCustomerName: parsed.customerName,
      applicationPhone: parsed.phone,
      applicationLineName: parsed.lineDisplayName,
      applicationManufacturer: parsed.manufacturer,
      applicationModel: parsed.model,
      applicationColor: parsed.color,
      applicationPlate: parsed.plateLast4,
      applicationCourse: parsed.courseCode,
      applicationDate: parsed.reservationDate,
      applicationTime: parsed.startTime,
    };
    Object.entries(pairs).forEach(([id, value]) => {
      const input = document.getElementById(id);
      if (input && value) input.value = value;
    });
  };

  async function findReusableCustomer(values) {
    if (values.phone) {
      const { data, error } = await supabase.from("customers").select("id,name,phone,line_display_name").eq("is_active", true).eq("phone", values.phone).limit(2);
      if (error) throw error;
      if (data?.length === 1) return data[0];
    }
    return null;
  }

  async function findReusableVehicle(customerId, values) {
    const { data, error } = await supabase.from("customer_vehicles").select("id,manufacturer,model,color,size_class").eq("customer_id", customerId).eq("is_active", true);
    if (error) throw error;
    const normalize = (value) => applicationNormalize(value).toLowerCase();
    const matched = (data || []).filter((vehicle) => normalize(vehicle.manufacturer) === normalize(values.manufacturer)
      && normalize(vehicle.model) === normalize(values.model)
      && (!values.color || normalize(vehicle.color) === normalize(values.color)));
    return matched.length === 1 ? matched[0] : null;
  }

  const prefillStandardReservationForm = async (customer, vehicle, draft) => {
    await baseRenderReservationFormForApplication();
    const search = document.getElementById("reservationCustomerSearch");
    const customerId = document.getElementById("reservationCustomerId");
    const viewCustomer = document.getElementById("viewReservationCustomer");
    const vehicleSelect = document.getElementById("reservationVehicle");
    if (!search || !customerId || !vehicleSelect) return;

    search.value = customer.name;
    customerId.value = customer.id;
    viewCustomer?.classList.remove("hidden");
    vehicleSelect.innerHTML = `<option value="${escapeHtml(vehicle.id)}" selected>${escapeHtml(reservationVehicleName(vehicle))}（${escapeHtml(vehicle.color || "")}）</option>`;
    vehicleSelect.disabled = false;

    const size = document.getElementById("reservationSizeClass");
    if (size) {
      size.value = vehicle.size_class || draft.sizeClass || "";
      size.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const course = document.getElementById("reservationCourse");
    if (course && draft.courseCode) {
      course.value = draft.courseCode;
      course.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const date = document.getElementById("reservationDate");
    if (date && draft.reservationDate) date.value = draft.reservationDate;
    const time = document.getElementById("reservationTime");
    if (time && draft.startTime) {
      time.value = draft.startTime;
      time.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const notes = document.getElementById("reservationNotes");
    if (notes && draft.originalText) notes.value = `予約申込原文\n${draft.originalText}`;
  };

  async function renderReservationApplicationImport() {
    setReservationContent(`<form class="card form-card" id="reservationApplicationForm"><h2>予約申込から登録</h2><p class="muted">LINEで届いた予約申込文を貼り付けると、読み取れる項目を自動入力します。新規顧客・車両を登録後、そのまま通常の予約登録へ進みます。</p><label for="reservationApplicationText">予約申込文</label><textarea id="reservationApplicationText" rows="8" placeholder="【RE 予約申込】から始まるメッセージを貼り付け"></textarea><button class="secondary" type="button" id="parseReservationApplicationButton">内容を読み取る</button><label for="applicationCustomerName">お客様名</label><input id="applicationCustomerName" required autocomplete="name"><label for="applicationPhone">電話番号</label><input id="applicationPhone" type="tel" inputmode="tel" autocomplete="tel"><label for="applicationLineName">LINE表示名</label><input id="applicationLineName"><label for="applicationManufacturer">メーカー</label><input id="applicationManufacturer" required><label for="applicationModel">車種</label><input id="applicationModel" required><label for="applicationColor">色</label><input id="applicationColor" required><label for="applicationPlate">ナンバー下4桁</label><input id="applicationPlate" inputmode="numeric" pattern="[0-9]{4}" maxlength="4"><label for="applicationSizeClass">車両区分</label><select id="applicationSizeClass" required><option value="">車両区分を選択</option>${Object.entries(reservationSizeClasses).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select><label for="applicationCourse">コース</label><select id="applicationCourse"><option value="">予約画面で選択</option>${Object.entries(reservationCourses).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select><label for="applicationDate">施工日</label><input id="applicationDate" type="date"><label for="applicationTime">開始時間</label><input id="applicationTime" type="time"><p class="error hidden" id="reservationApplicationError"></p><button class="primary" type="submit">顧客・車両を登録して予約へ</button><button class="text-button" type="button" id="cancelReservationApplicationButton">予約一覧へ戻る</button></form>`);

    const text = document.getElementById("reservationApplicationText");
    document.getElementById("parseReservationApplicationButton").addEventListener("click", () => setApplicationFields(parseReservationApplication(text.value)));
    document.getElementById("cancelReservationApplicationButton").addEventListener("click", renderReservationList);
    document.getElementById("reservationApplicationForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const errorTarget = document.getElementById("reservationApplicationError");
      const draft = parseReservationApplication(text.value);
      const customerValues = {
        name: applicationNormalize(document.getElementById("applicationCustomerName").value),
        phone: emptyToNull(document.getElementById("applicationPhone").value),
        line_display_name: emptyToNull(document.getElementById("applicationLineName").value),
        contact_method: "line",
        notes: null,
      };
      const vehicleValues = {
        manufacturer: applicationNormalize(document.getElementById("applicationManufacturer").value),
        model: applicationNormalize(document.getElementById("applicationModel").value),
        color: applicationNormalize(document.getElementById("applicationColor").value),
        plate_last4: emptyToNull(document.getElementById("applicationPlate").value),
        size_class: document.getElementById("applicationSizeClass").value,
        notes: null,
      };
      Object.assign(draft, {
        sizeClass: vehicleValues.size_class,
        courseCode: document.getElementById("applicationCourse").value || draft.courseCode,
        reservationDate: document.getElementById("applicationDate").value || draft.reservationDate,
        startTime: document.getElementById("applicationTime").value || draft.startTime,
      });
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
        let customer = await findReusableCustomer(customerValues);
        if (!customer) {
          const { data, error } = await supabase.from("customers").insert(customerValues).select("id,name,phone,line_display_name").single();
          if (error || !data?.id) throw error || new Error("顧客の登録結果を確認できませんでした。");
          customer = data;
          createdCustomerId = data.id;
        }

        let vehicle = await findReusableVehicle(customer.id, vehicleValues);
        if (!vehicle) {
          const { data, error } = await supabase.from("customer_vehicles").insert({ customer_id: customer.id, ...vehicleValues }).select("id,manufacturer,model,color,size_class").single();
          if (error || !data?.id) throw error || new Error("車両の登録結果を確認できませんでした。");
          vehicle = data;
          createdVehicleId = data.id;
        } else if (!vehicle.size_class && vehicleValues.size_class) {
          const { error } = await supabase.from("customer_vehicles").update({ size_class: vehicleValues.size_class }).eq("id", vehicle.id).eq("customer_id", customer.id);
          if (error) throw error;
          vehicle.size_class = vehicleValues.size_class;
        }
        await prefillStandardReservationForm(customer, vehicle, draft);
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

  const addReservationApplicationButton = () => {
    const newButton = document.getElementById("newReservationButton");
    if (!newButton || document.getElementById("reservationApplicationButton")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "reservationApplicationButton";
    button.className = "secondary add-button";
    button.textContent = "＋ 新規のお客様の予約申込から登録";
    button.addEventListener("click", renderReservationApplicationImport);
    newButton.insertAdjacentElement("afterend", button);
  };

  renderReservationList = async function(...args) {
    const result = await baseRenderReservationListForApplication(...args);
    addReservationApplicationButton();
    return result;
  };

  if (activeTab === "予約") queueMicrotask(addReservationApplicationButton);
})();
