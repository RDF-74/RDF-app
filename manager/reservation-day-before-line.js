(() => {
  const API_BASE = "https://recordare-line-webhook.vercel.app";
  const baseReservationFormForDayBefore = renderReservationForm;

  const originalReservationText = (reservation) => {
    const notes = String(reservation?.notes || "");
    const marker = "予約申込原文";
    const index = notes.indexOf(marker);
    return index < 0 ? "" : notes.slice(index + marker.length).replace(/^\s+/, "").trim();
  };

  const relationOne = (value) => Array.isArray(value) ? value[0] : value;
  const optionSummary = (reservation) => {
    const rows = Array.isArray(reservation?.selected_options) ? reservation.selected_options : [];
    if (!rows.length) return "なし";
    return rows.map((row) => {
      const code = typeof row === "string" ? row : row?.code;
      return reservationOptions.find((item) => item.code === code)?.label || code || "";
    }).filter(Boolean).join("、") || "なし";
  };

  const dayBeforeMessage = (reservation) => {
    const customer = relationOne(reservation?.customers);
    const vehicle = relationOne(reservation?.customer_vehicles);
    const customerName = customer?.name || "お客様";
    const vehicleName = [vehicle?.manufacturer, vehicle?.model, vehicle?.color].filter(Boolean).join(" ");
    const date = reservationDate(reservation?.reservation_date || "");
    const time = reservationTime(reservation?.start_time || "");
    const course = reservationCourses[reservation?.course_code] || reservation?.course_code || "";
    const total = reservation?.final_total == null ? "確認中" : yen(reservation.final_total);

    return `${customerName}様

RE:CORDAREです。
明日のご予約について、前日の確認です。

【ご予約内容】
日時：${date} ${time}〜
お車：${vehicleName || "確認中"}
コース：${course}
オプション：${optionSummary(reservation)}
予定金額：${total}

施工場所や水道・電源の使用可否など、予約時から変更がありましたら、このLINEへご連絡ください。
天候や施工環境によって安全に施工できない場合は、日程変更をご相談させていただくことがあります。

明日はよろしくお願いいたします。

RE:CORDARE`;
  };

  const sendLine = async (reservation, message) => {
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

    const response = await fetch(`${API_BASE}/api/reservation-confirmation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        reservationText,
        message,
        supabaseUrl: config.url,
        anonKey: config.anonKey,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) {
      const error = new Error(result?.error || `LINE送信エラー (${response.status})`);
      error.code = result?.error || "line_send_failed";
      throw error;
    }
    return result;
  };

  const installButton = (reservation) => {
    if (!reservation?.id || reservation.status !== "confirmed") return;
    const form = document.getElementById("reservationForm");
    if (!form || document.getElementById("reservationDayBeforeButton")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "reservationDayBeforeButton";
    button.className = "secondary service-create-button";
    button.textContent = reservation.day_before_line_sent_at ? "前日確認LINEを再確認" : "前日確認LINEを確認";
    const anchor = document.getElementById("reservationQuoteButton")
      || document.getElementById("reservationPrePlanButton")
      || form.querySelector("h2");
    anchor?.insertAdjacentElement("afterend", button);

    button.addEventListener("click", () => {
      let panel = document.getElementById("reservationDayBeforePanel");
      if (panel) {
        panel.remove();
        return;
      }

      panel = document.createElement("section");
      panel.id = "reservationDayBeforePanel";
      panel.className = "card";
      panel.style.margin = "12px 0";
      panel.innerHTML = `<h3>前日確認LINE</h3><p class="muted">自動送信はしません。内容を確認してから送信します。</p><textarea id="reservationDayBeforeText" rows="18"></textarea><p class="error hidden" id="reservationDayBeforeError"></p><p class="muted hidden" id="reservationDayBeforeStatus"></p><button class="primary" type="button" id="sendReservationDayBeforeLine">LINEで送信</button><button class="text-button" type="button" id="closeReservationDayBeforeLine">閉じる</button>`;
      button.insertAdjacentElement("afterend", panel);

      const text = document.getElementById("reservationDayBeforeText");
      const errorTarget = document.getElementById("reservationDayBeforeError");
      const statusTarget = document.getElementById("reservationDayBeforeStatus");
      text.value = reservation.day_before_line_message || dayBeforeMessage(reservation);

      if (reservation.day_before_line_sent_at) {
        statusTarget.textContent = `送信済み：${new Date(reservation.day_before_line_sent_at).toLocaleString("ja-JP")}`;
        statusTarget.classList.remove("hidden");
      }

      document.getElementById("closeReservationDayBeforeLine")?.addEventListener("click", () => panel.remove());
      document.getElementById("sendReservationDayBeforeLine")?.addEventListener("click", async (event) => {
        const message = String(text.value || "").trim();
        if (!message) return;
        if (!confirm("この前日確認をお客様のLINEへ送信しますか？")) return;

        const sendButton = event.currentTarget;
        sendButton.disabled = true;
        sendButton.textContent = "送信中…";
        errorTarget.classList.add("hidden");
        try {
          const result = await sendLine(reservation, message);
          const sentAt = result?.sentAt || new Date().toISOString();
          const { error } = await supabase.from("reservations")
            .update({ day_before_line_sent_at: sentAt, day_before_line_message: message })
            .eq("id", reservation.id)
            .eq("is_active", true);
          if (error) throw error;
          reservation.day_before_line_sent_at = sentAt;
          reservation.day_before_line_message = message;
          statusTarget.textContent = "前日確認LINEを送信しました。";
          statusTarget.classList.remove("hidden");
          sendButton.textContent = "送信済み";
          button.textContent = "前日確認LINEを再確認";
        } catch (error) {
          sendButton.disabled = false;
          sendButton.textContent = "LINEで送信";
          errorTarget.textContent = error?.code === "reservation_not_linked"
            ? "この予約はLINE送信先と自動紐づけされていません。"
            : `LINEを送信できませんでした。（${error?.message || error}）`;
          errorTarget.classList.remove("hidden");
        }
      });
    });
  };

  renderReservationForm = async function(...args) {
    const result = await baseReservationFormForDayBefore(...args);
    installButton(args[0] || null);
    return result;
  };
})();
