(() => {
  const API_BASE = "https://recordare-line-webhook.vercel.app";
  const baseReservationFormForQuote = renderReservationForm;
  let quotePollTimer = null;

  const normalizeRows = (value) => Array.isArray(value) ? value : [];
  const originalReservationText = (reservation) => {
    const notes = String(reservation?.notes || "");
    const marker = "予約申込原文";
    const index = notes.indexOf(marker);
    return index < 0 ? "" : notes.slice(index + marker.length).replace(/^\s+/, "").trim();
  };

  const relationOne = (value) => Array.isArray(value) ? value[0] : value;
  const stableRows = (value) => normalizeRows(value)
    .map((row) => ({ code: row?.code || "", amount: Number(row?.amount || 0) }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const quoteSignature = (reservation) => JSON.stringify({
    customer_id: reservation?.customer_id || "",
    vehicle_id: reservation?.vehicle_id || "",
    reservation_date: reservationDate(reservation?.reservation_date || ""),
    start_time: reservationTime(reservation?.start_time || ""),
    course_code: reservation?.course_code || "",
    vehicle_size_class: reservation?.vehicle_size_class || "",
    selected_options: stableRows(reservation?.selected_options),
    selected_discounts: stableRows(reservation?.selected_discounts),
    travel_zone: reservation?.travel_zone || "",
    base_price: Number(reservation?.base_price || 0),
    options_total: Number(reservation?.options_total || 0),
    travel_fee: Number(reservation?.travel_fee || 0),
    discount_total: Number(reservation?.discount_total || 0),
    final_total: Number(reservation?.final_total || 0),
  });

  const optionLines = (reservation) => {
    const rows = stableRows(reservation?.selected_options);
    if (!rows.length) return ["・なし"];
    return rows.map((row) => {
      const option = reservationOptions.find((item) => item.code === row.code);
      return `・${option?.label || row.code}：+${yen(row.amount)}`;
    });
  };

  const discountLabels = (reservation) => {
    const rows = stableRows(reservation?.selected_discounts);
    if (!rows.length) return "なし";
    return rows.map((row) => reservationDiscounts.find((item) => item.code === row.code)?.label || row.code).join("、");
  };

  const quoteMessage = (reservation) => {
    const customer = relationOne(reservation?.customers);
    const vehicle = relationOne(reservation?.customer_vehicles);
    const customerName = customer?.name || "お客様";
    const vehicleName = [vehicle?.manufacturer, vehicle?.model, vehicle?.color].filter(Boolean).join(" ");
    const course = reservationCourses[reservation?.course_code] || reservation?.course_code || "確認中";
    const date = reservationDate(reservation?.reservation_date || "");
    const time = reservationTime(reservation?.start_time || "");
    const optionText = optionLines(reservation).join("\n");
    const travel = Number(reservation?.travel_fee || 0);
    const discount = Number(reservation?.discount_total || 0);
    const base = Number(reservation?.base_price || 0);
    const total = Number(reservation?.final_total || 0);

    return `${customerName}様

RE:CORDAREです。
ご予約内容をもとに、お見積を作成しました。

【ご予約内容】
日時：${date} ${time}〜
お車：${vehicleName || "確認中"}
コース：${course}

【オプション】
${optionText}

【料金内訳】
コース料金：${yen(base)}
出張料：+${yen(travel)}
割引：−${yen(discount)}
適用割引：${discountLabels(reservation)}

【お見積合計】
${yen(total)}

内容をご確認のうえ、下のボタンからお選びください。
「了承する」を選んだあと、回答を確定いただくと、この内容で予約確定となります。
ご不明点がある場合は「相談」をお選びください。`;
  };

  const apiRequest = async (payload) => {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error("Managerのログイン情報を確認できませんでした。");
    const config = window.RECORDARE_SUPABASE_CONFIG || {};
    const response = await fetch(`${API_BASE}/api/reservation-confirmation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...payload,
        reservationQuoteRequest: true,
        supabaseUrl: config.url,
        anonKey: config.anonKey,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) {
      const error = new Error(result?.error || `見積LINEエラー (${response.status})`);
      error.code = result?.error || "quote_request_failed";
      throw error;
    }
    return result;
  };

  const fetchCurrentReservation = async (id) => {
    const { data, error } = await supabase.from("reservations")
      .select("id,customer_id,vehicle_id,reservation_date,start_time,course_code,vehicle_size_class,selected_options,selected_discounts,travel_zone,base_price,options_total,travel_fee,discount_total,final_total,status,notes,customers(name),customer_vehicles(manufacturer,model,color)")
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error("予約情報を確認できませんでした。");
    return data;
  };

  const statusLabel = (quote) => {
    if (!quote) return "見積未送信";
    if (!quote.confirmedAt) {
      if (quote.decision === "approved") return "お客様が了承を選択中（回答確定待ち）";
      if (quote.decision === "consult") return "お客様が相談を選択中（回答確定待ち）";
      if (quote.decision === "declined") return "お客様が見送るを選択中（回答確定待ち）";
      return "お客様の回答待ち";
    }
    if (quote.decision === "approved") return "見積了承済み";
    if (quote.decision === "consult") return "相談希望";
    if (quote.decision === "declined") return "見送り";
    return "回答済み";
  };

  const applyApprovedQuote = async (reservation, quote, statusTarget) => {
    const current = await fetchCurrentReservation(reservation.id);
    if (quoteSignature(current) !== quote.signature) {
      statusTarget.textContent = "⚠ 見積送信後に予約内容が変更されています。自動確定せず、最新内容で見積を再送してください。";
      statusTarget.classList.remove("hidden");
      return false;
    }

    if (current.status !== "confirmed") {
      const { error } = await supabase.from("reservations")
        .update({ status: "confirmed", updated_at: new Date().toISOString() })
        .eq("id", reservation.id)
        .eq("is_active", true);
      if (error) throw error;
      await window.RECORDARE_CALENDAR_SYNC?.upsert?.(reservation.id);
      await window.RECORDARE_LINE_RESERVATION_REQUESTS?.afterReservationResolved?.(reservation.id, "confirmed");
    }

    reservation.status = "confirmed";
    const statusSelect = document.getElementById("reservationStatus");
    if (statusSelect) statusSelect.value = "confirmed";
    statusTarget.textContent = "見積了承済み・予約を「確定」に更新しました。";
    statusTarget.classList.remove("hidden");
    return true;
  };

  const syncQuoteStatus = async (reservation, statusTarget, errorTarget) => {
    const result = await apiRequest({ action: "status", reservationId: reservation.id });
    const quote = result?.quote || null;
    if (!quote) {
      statusTarget.textContent = "まだ見積は送信されていません。";
      statusTarget.classList.remove("hidden");
      return { final: false, quote: null };
    }

    statusTarget.textContent = statusLabel(quote);
    statusTarget.classList.remove("hidden");
    if (!quote.confirmedAt) return { final: false, quote };

    if (quote.decision === "approved") {
      await applyApprovedQuote(reservation, quote, statusTarget);
    } else if (quote.decision === "consult") {
      statusTarget.textContent = "お客様：相談希望。予約はまだ確定していません。";
    } else if (quote.decision === "declined") {
      statusTarget.textContent = "お客様：見送り。予約はまだ確定していません。";
    }
    statusTarget.classList.remove("hidden");
    errorTarget?.classList.add("hidden");
    return { final: true, quote };
  };

  const startPolling = (reservation, statusTarget, errorTarget) => {
    clearTimeout(quotePollTimer);
    const poll = async () => {
      if (!document.getElementById("reservationQuotePanel")) return;
      try {
        const state = await syncQuoteStatus(reservation, statusTarget, errorTarget);
        if (!state.final) quotePollTimer = setTimeout(poll, 5000);
      } catch (error) {
        console.error("見積LINE回答の確認に失敗しました", error);
        quotePollTimer = setTimeout(poll, 5000);
      }
    };
    poll();
  };

  const installQuoteButton = (reservation) => {
    if (!reservation?.id || reservation.status !== "tentative") return;
    const form = document.getElementById("reservationForm");
    if (!form || document.getElementById("reservationQuoteButton")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "reservationQuoteButton";
    button.className = "secondary service-create-button";
    button.textContent = "見積LINEを確認";
    const anchor = document.getElementById("reservationPrePlanButton") || form.querySelector("h2");
    anchor?.insertAdjacentElement("afterend", button);

    button.addEventListener("click", async () => {
      let panel = document.getElementById("reservationQuotePanel");
      if (panel) {
        panel.remove();
        clearTimeout(quotePollTimer);
        return;
      }

      panel = document.createElement("section");
      panel.id = "reservationQuotePanel";
      panel.className = "card";
      panel.style.margin = "12px 0";
      panel.innerHTML = `<h3>見積LINE</h3><p class="muted">保存済みの予約内容から自動作成しています。必要な場合だけ文章を修正できます。</p><textarea id="reservationQuoteText" rows="20"></textarea><p class="error hidden" id="reservationQuoteError"></p><p class="muted hidden" id="reservationQuoteStatus"></p><button class="primary" type="button" id="sendReservationQuoteLine">LINEで見積を送る</button><button class="text-button" type="button" id="closeReservationQuoteLine">閉じる</button>`;
      button.insertAdjacentElement("afterend", panel);

      const text = document.getElementById("reservationQuoteText");
      const errorTarget = document.getElementById("reservationQuoteError");
      const statusTarget = document.getElementById("reservationQuoteStatus");
      text.value = quoteMessage(reservation);

      document.getElementById("closeReservationQuoteLine")?.addEventListener("click", () => {
        clearTimeout(quotePollTimer);
        panel.remove();
      });

      document.getElementById("sendReservationQuoteLine")?.addEventListener("click", async (event) => {
        const reservationText = originalReservationText(reservation);
        if (!reservationText) {
          errorTarget.textContent = "この予約はLINE送信先と自動紐づけされていないため、見積を直接送信できません。";
          errorTarget.classList.remove("hidden");
          return;
        }
        const message = String(text.value || "").trim();
        if (!message) return;
        if (!confirm("この見積内容をお客様のLINEへ送信しますか？")) return;

        const sendButton = event.currentTarget;
        sendButton.disabled = true;
        sendButton.textContent = "送信中…";
        errorTarget.classList.add("hidden");
        try {
          await apiRequest({
            action: "send",
            reservationId: reservation.id,
            reservationText,
            quoteId: crypto.randomUUID(),
            signature: quoteSignature(reservation),
            message,
          });
          statusTarget.textContent = "見積LINEを送信しました。お客様の回答待ちです。";
          statusTarget.classList.remove("hidden");
          sendButton.textContent = "見積を再送";
          sendButton.disabled = false;
          startPolling(reservation, statusTarget, errorTarget);
        } catch (error) {
          sendButton.disabled = false;
          sendButton.textContent = "LINEで見積を送る";
          errorTarget.textContent = error?.code === "reservation_not_linked"
            ? "この予約はLINE送信先と自動紐づけされていません。"
            : `見積LINEを送信できませんでした。（${error?.message || error}）`;
          errorTarget.classList.remove("hidden");
        }
      });

      startPolling(reservation, statusTarget, errorTarget);
    });
  };

  renderReservationForm = async function(...args) {
    clearTimeout(quotePollTimer);
    const result = await baseReservationFormForQuote(...args);
    installQuoteButton(args[0] || null);
    return result;
  };
})();
