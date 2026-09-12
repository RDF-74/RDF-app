(() => {
  const API_BASE = "https://recordare-line-webhook.vercel.app";
  const PENDING_SAVE_KEY = "recordare_pending_reservation_change";
  const baseReservationFormForChange = renderReservationForm;
  const baseReservationListForChange = renderReservationList;

  const normalizeRows = (value) => {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const relationOne = (value) => Array.isArray(value) ? value[0] : value;

  const originalReservationText = (reservation) => {
    const notes = String(reservation?.notes || "");
    const marker = "予約申込原文";
    const index = notes.indexOf(marker);
    if (index < 0) return "";
    return notes.slice(index + marker.length).replace(/^\s+/, "").trim();
  };

  const optionSummary = (snapshot) => {
    const rows = normalizeRows(snapshot?.selected_options);
    if (!rows.length) return "なし";
    return rows.map((row) => {
      const code = typeof row === "string" ? row : row?.code;
      const option = reservationOptions.find((item) => item.code === code);
      return option?.label || code || "";
    }).filter(Boolean).join("、") || "なし";
  };

  const discountSummary = (snapshot) => {
    const rows = normalizeRows(snapshot?.selected_discounts);
    if (!rows.length) return "なし";
    return rows.map((row) => {
      const code = typeof row === "string" ? row : row?.code;
      const discount = reservationDiscounts.find((item) => item.code === code);
      return discount?.label || code || "";
    }).filter(Boolean).join("、") || "なし";
  };

  const travelSummary = (value) => reservationTravelZones[value]?.label || value || "未設定";
  const courseSummary = (value) => reservationCourses[value] || value || "未設定";
  const dateTimeSummary = (snapshot) => `${reservationDate(snapshot?.reservation_date || "")} ${reservationTime(snapshot?.start_time || "")}〜`.trim();
  const priceSummary = (value) => value == null ? "確認中" : yen(value);

  const pendingHistories = async (reservationId) => {
    const { data, error } = await supabase.from("reservation_change_history")
      .select("id,before_snapshot,after_snapshot,changed_at,line_sent_at,line_message")
      .eq("reservation_id", reservationId)
      .is("line_sent_at", null)
      .order("changed_at", { ascending: true });
    if (error) throw error;
    return data || [];
  };

  const fetchReservation = async (reservationId) => {
    const { data, error } = await supabase.from("reservations")
      .select("id,customer_id,vehicle_id,course_code,reservation_date,start_time,status,notes,vehicle_size_class,selected_options,selected_discounts,travel_zone,base_price,options_total,travel_fee,discount_total,calculated_total,final_total,planned_prep_minutes,planned_service_minutes,planned_cleanup_minutes,planned_slot_minutes,customers(name),customer_vehicles(manufacturer,model,color,size_class)")
      .eq("id", reservationId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  };

  const vehicleNames = async (beforeId, afterId) => {
    const ids = [...new Set([beforeId, afterId].filter(Boolean))];
    if (!ids.length) return new Map();
    const { data, error } = await supabase.from("customer_vehicles")
      .select("id,manufacturer,model,color")
      .in("id", ids);
    if (error) throw error;
    return new Map((data || []).map((vehicle) => [vehicle.id, [vehicle.manufacturer, vehicle.model, vehicle.color].filter(Boolean).join(" ")]));
  };

  const changedItems = async (before, after) => {
    const items = [];
    if (reservationDate(before?.reservation_date) !== reservationDate(after?.reservation_date) || reservationTime(before?.start_time) !== reservationTime(after?.start_time)) {
      items.push({ label: "日時", before: dateTimeSummary(before), after: dateTimeSummary(after) });
    }
    if (before?.vehicle_id !== after?.vehicle_id) {
      const names = await vehicleNames(before?.vehicle_id, after?.vehicle_id);
      items.push({ label: "お車", before: names.get(before?.vehicle_id) || "変更前の車両", after: names.get(after?.vehicle_id) || "変更後の車両" });
    }
    if (before?.course_code !== after?.course_code) {
      items.push({ label: "コース", before: courseSummary(before?.course_code), after: courseSummary(after?.course_code) });
    }
    const beforeOptions = optionSummary(before);
    const afterOptions = optionSummary(after);
    if (beforeOptions !== afterOptions) items.push({ label: "オプション", before: beforeOptions, after: afterOptions });
    const beforeDiscounts = discountSummary(before);
    const afterDiscounts = discountSummary(after);
    if (beforeDiscounts !== afterDiscounts) items.push({ label: "割引", before: beforeDiscounts, after: afterDiscounts });
    if (before?.travel_zone !== after?.travel_zone) {
      items.push({ label: "出張距離", before: travelSummary(before?.travel_zone), after: travelSummary(after?.travel_zone) });
    }
    if (Number(before?.final_total ?? -1) !== Number(after?.final_total ?? -1)) {
      items.push({ label: "予定金額", before: priceSummary(before?.final_total), after: priceSummary(after?.final_total) });
    }
    return items;
  };

  const currentReservationSummary = (reservation) => {
    const vehicle = relationOne(reservation?.customer_vehicles);
    return {
      vehicle: [vehicle?.manufacturer, vehicle?.model, vehicle?.color].filter(Boolean).join(" ") || "確認中",
      dateTime: `${reservationDate(reservation?.reservation_date || "")} ${reservationTime(reservation?.start_time || "")}〜`,
      course: courseSummary(reservation?.course_code),
      options: optionSummary(reservation),
      discounts: discountSummary(reservation),
      travel: travelSummary(reservation?.travel_zone),
      total: priceSummary(reservation?.final_total),
    };
  };

  const changeMessage = (reservation, items) => {
    const customer = relationOne(reservation?.customers)?.name || "お客様";
    const current = currentReservationSummary(reservation);
    const changed = items.map((item) => `・${item.label}：${item.before} → ${item.after}`).join("\n");
    return `${customer}様\n\nご予約内容の変更についてご連絡いたします。\n下記の内容へ変更いたしました。\n\n【変更内容】\n${changed}\n\n【変更後のご予約内容】\n日時：${current.dateTime}\nお車：${current.vehicle}\nコース：${current.course}\nオプション：${current.options}\n割引：${current.discounts}\n出張距離：${current.travel}\n予定金額：${current.total}\n\n内容に相違がありましたら、このLINEへご連絡ください。\nよろしくお願いいたします。\n\nRE:CORDARE`;
  };

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  };

  const sendChange = async (reservation, changeKey, message) => {
    const reservationText = originalReservationText(reservation);
    if (!reservationText) {
      const error = new Error("reservation_not_linked");
      error.code = "reservation_not_linked";
      throw error;
    }
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error("Managerのログイン情報を確認できませんでした。");
    const config = window.RECORDARE_SUPABASE_CONFIG || {};
    const response = await fetch(`${API_BASE}/api/reservation-change`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reservationText, changeKey, message, supabaseUrl: config.url, anonKey: config.anonKey }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `LINE送信エラー (${response.status})`);
      error.code = payload.error || "line_send_failed";
      throw error;
    }
    return payload;
  };

  const markHistoriesSent = async (histories, message, sentAt) => {
    const ids = histories.map((item) => item.id);
    const { error } = await supabase.from("reservation_change_history")
      .update({ line_sent_at: sentAt || new Date().toISOString(), line_message: message })
      .in("id", ids)
      .is("line_sent_at", null);
    if (error) throw error;
  };

  const installChangeButton = async (reservation, suppliedHistories = null) => {
    if (!reservation?.id || ["completed", "cancelled"].includes(reservation.status)) return;
    const form = document.getElementById("reservationForm");
    if (!form || document.getElementById("reservationChangeLineButton")) return;

    let histories;
    try {
      histories = suppliedHistories || await pendingHistories(reservation.id);
    } catch {
      return;
    }
    if (!histories.length) return;

    const before = histories[0].before_snapshot || {};
    const after = histories[histories.length - 1].after_snapshot || {};
    let items;
    try {
      items = await changedItems(before, after);
    } catch {
      return;
    }
    if (!items.length) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "reservationChangeLineButton";
    button.className = "secondary service-create-button";
    button.textContent = "予約変更LINEを確認";
    const anchor = document.getElementById("reservationCancellationButton") || document.getElementById("reservationConfirmationButton") || document.getElementById("reservationPrePlanButton") || form.querySelector("h2");
    anchor?.insertAdjacentElement("afterend", button);

    button.addEventListener("click", () => {
      let panel = document.getElementById("reservationChangeLinePanel");
      if (panel) {
        panel.remove();
        return;
      }
      panel = document.createElement("section");
      panel.id = "reservationChangeLinePanel";
      panel.className = "card";
      panel.style.margin = "12px 0";
      const comparison = items.map((item) => `<p><strong>${escapeHtml(item.label)}</strong><br><span class="muted">変更前：${escapeHtml(item.before)}<br>変更後：${escapeHtml(item.after)}</span></p>`).join("");
      panel.innerHTML = `<h3>予約変更LINE</h3><p class="muted">変更前後を確認し、必要なら文面を修正してから送信します。自動送信はしません。</p><div>${comparison}</div><label for="reservationChangeLineText">LINE文面</label><textarea id="reservationChangeLineText" rows="18"></textarea><p class="error hidden" id="reservationChangeLineError"></p><p class="muted hidden" id="reservationChangeLineStatus"></p><button class="primary" type="button" id="sendReservationChangeLine">LINEで送信</button><button class="secondary hidden" type="button" id="confirmManualReservationChangeLine" style="margin-top:10px">公式LINEで送信済みとして記録</button><button class="secondary" type="button" id="copyReservationChangeLine" style="margin-top:10px">文面をコピー</button><button class="text-button" type="button" id="closeReservationChangeLine">閉じる</button>`;
      button.insertAdjacentElement("afterend", panel);

      const text = document.getElementById("reservationChangeLineText");
      const errorTarget = document.getElementById("reservationChangeLineError");
      const status = document.getElementById("reservationChangeLineStatus");
      const sendButton = document.getElementById("sendReservationChangeLine");
      const manualButton = document.getElementById("confirmManualReservationChangeLine");
      text.value = changeMessage(reservation, items);
      let sentAt = "";

      const finish = async (timestamp) => {
        const message = String(text.value || "").trim();
        await markHistoriesSent(histories, message, timestamp);
        status.textContent = "予約変更LINEを送信し、変更履歴に記録しました。";
        status.classList.remove("hidden");
        sendButton.disabled = true;
        sendButton.textContent = "送信済み";
        manualButton.classList.add("hidden");
        button.disabled = true;
        button.textContent = "変更LINE送信済み";
      };

      document.getElementById("closeReservationChangeLine")?.addEventListener("click", () => panel.remove());
      document.getElementById("copyReservationChangeLine")?.addEventListener("click", async () => {
        const message = String(text.value || "").trim();
        if (!message) return;
        await copyText(message);
        status.textContent = "文面をコピーしました。";
        status.classList.remove("hidden");
      });

      manualButton.addEventListener("click", async () => {
        const message = String(text.value || "").trim();
        if (!message) return;
        if (!confirm("公式LINEからこの変更内容を送信済みですか？")) return;
        manualButton.disabled = true;
        manualButton.textContent = "記録中…";
        try {
          await finish(new Date().toISOString());
        } catch (error) {
          manualButton.disabled = false;
          manualButton.textContent = "公式LINEで送信済みとして記録";
          errorTarget.textContent = `変更履歴を更新できませんでした。（${error?.message || error}）`;
          errorTarget.classList.remove("hidden");
        }
      });

      sendButton.addEventListener("click", async () => {
        const message = String(text.value || "").trim();
        if (!message) return;
        if (!sentAt && !confirm("この内容をお客様のLINEへ送信しますか？")) return;
        sendButton.disabled = true;
        sendButton.textContent = sentAt ? "履歴を反映中…" : "送信中…";
        errorTarget.classList.add("hidden");
        status.classList.add("hidden");
        try {
          if (!sentAt) {
            const result = await sendChange(reservation, histories[histories.length - 1].id, message);
            sentAt = result?.sentAt || new Date().toISOString();
          }
          await finish(sentAt);
        } catch (error) {
          sendButton.disabled = false;
          if (sentAt) {
            sendButton.textContent = "履歴を再反映";
            errorTarget.textContent = `LINEは送信済みですが、変更履歴を更新できませんでした。（${error?.message || error}）`;
          } else if (error?.code === "reservation_not_linked") {
            await copyText(message).catch(() => false);
            sendButton.textContent = "LINEで送信";
            manualButton.classList.remove("hidden");
            errorTarget.textContent = "この予約はLINE送信先の自動紐づけ前に受け付けたため、直接送信できません。文面をコピーしました。公式LINEから送信後、下のボタンで送信済みとして記録してください。";
          } else {
            sendButton.textContent = "LINEで送信";
            errorTarget.textContent = `LINEを送信できませんでした。（${error?.message || error}）`;
          }
          errorTarget.classList.remove("hidden");
        }
      });
    });
  };

  renderReservationForm = async function(...args) {
    const reservation = args[0] || null;
    const result = await baseReservationFormForChange(...args);
    if (reservation?.id) {
      document.getElementById("reservationForm")?.addEventListener("submit", () => {
        try { sessionStorage.setItem(PENDING_SAVE_KEY, reservation.id); } catch {}
      });
      await installChangeButton(reservation);
    }
    return result;
  };

  renderReservationList = async function(...args) {
    let pendingId = "";
    try {
      pendingId = sessionStorage.getItem(PENDING_SAVE_KEY) || "";
      if (pendingId) sessionStorage.removeItem(PENDING_SAVE_KEY);
    } catch {}
    if (pendingId) {
      try {
        const histories = await pendingHistories(pendingId);
        if (histories.length) {
          const reservation = await fetchReservation(pendingId);
          if (reservation) {
            const result = await baseReservationFormForChange(reservation);
            document.getElementById("reservationForm")?.addEventListener("submit", () => {
              try { sessionStorage.setItem(PENDING_SAVE_KEY, reservation.id); } catch {}
            });
            await installChangeButton(reservation, histories);
            return result;
          }
        }
      } catch {}
    }
    return baseReservationListForChange(...args);
  };
})();
