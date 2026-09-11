(() => {
  const API_BASE = "https://recordare-line-webhook.vercel.app";
  const baseReservationFormForConfirmation = renderReservationForm;

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

  const originalReservationText = (reservation) => {
    const notes = String(reservation?.notes || "");
    const marker = "予約申込原文";
    const index = notes.indexOf(marker);
    if (index < 0) return "";
    return notes.slice(index + marker.length).replace(/^\s+/, "").trim();
  };

  const optionSummary = (reservation) => {
    const rows = normalizeRows(reservation?.selected_options);
    if (!rows.length) return "なし";
    return rows.map((row) => {
      const code = typeof row === "string" ? row : row?.code;
      const option = reservationOptions.find((item) => item.code === code);
      return option?.label || code || "";
    }).filter(Boolean).join("、") || "なし";
  };

  const confirmationMessage = (reservation) => {
    const customer = reservation?.customers?.name || "お客様";
    const vehicle = [
      reservation?.customer_vehicles?.manufacturer,
      reservation?.customer_vehicles?.model,
      reservation?.customer_vehicles?.color,
    ].filter(Boolean).join(" ");
    const date = reservationDate(reservation?.reservation_date || "");
    const time = reservationTime(reservation?.start_time || "");
    const course = reservationCourses[reservation?.course_code] || reservation?.course_code || "";
    const total = reservation?.final_total != null ? yen(reservation.final_total) : "確認中";

    return `${customer}様\n\nご予約ありがとうございます。\n内容を確認し、下記でご予約を確定いたしました。\n\n【ご予約内容】\n日時：${date} ${time}〜\nお車：${vehicle || "確認中"}\nコース：${course}\nオプション：${optionSummary(reservation)}\n予定金額：${total}\n\n※当日の天候や施工環境によって、安全に施工できない場合は日程変更をご相談させていただくことがあります。\n\n内容の変更や気になる点がありましたら、このLINEへお気軽にご連絡ください。\nよろしくお願いいたします。\n\nRE:CORDARE`;
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

  const sendConfirmation = async (reservation, message) => {
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        reservationText,
        message,
        supabaseUrl: config.url,
        anonKey: config.anonKey,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `LINE送信エラー (${response.status})`);
      error.code = payload.error || "line_send_failed";
      throw error;
    }
    return payload;
  };

  const installConfirmationButton = (reservation) => {
    if (!reservation?.id) return;
    const form = document.getElementById("reservationForm");
    if (!form || document.getElementById("reservationConfirmationButton")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "reservationConfirmationButton";
    button.className = "secondary service-create-button";
    button.textContent = "予約確定LINEを確認";

    const anchor = document.getElementById("reservationPrePlanButton") || form.querySelector("h2");
    anchor?.insertAdjacentElement("afterend", button);

    button.addEventListener("click", () => {
      let panel = document.getElementById("reservationConfirmationPanel");
      if (panel) {
        panel.remove();
        return;
      }

      panel = document.createElement("section");
      panel.id = "reservationConfirmationPanel";
      panel.className = "card";
      panel.style.margin = "12px 0";
      panel.innerHTML = `<h3>予約確定LINE</h3><p class="muted">内容を確認・修正してから送信します。自動送信はしません。</p><textarea id="reservationConfirmationText" rows="16"></textarea><p class="error hidden" id="reservationConfirmationError"></p><p class="muted hidden" id="reservationConfirmationStatus"></p><button class="primary" type="button" id="sendReservationConfirmationLine">LINEで送信</button><button class="secondary" type="button" id="copyReservationConfirmationLine" style="margin-top:10px">文面をコピー</button><button class="text-button" type="button" id="closeReservationConfirmationLine">閉じる</button>`;
      button.insertAdjacentElement("afterend", panel);

      const text = document.getElementById("reservationConfirmationText");
      text.value = confirmationMessage(reservation);

      document.getElementById("closeReservationConfirmationLine")?.addEventListener("click", () => panel.remove());
      document.getElementById("copyReservationConfirmationLine")?.addEventListener("click", async () => {
        await copyText(text.value);
        const status = document.getElementById("reservationConfirmationStatus");
        status.textContent = "文面をコピーしました。";
        status.classList.remove("hidden");
      });

      document.getElementById("sendReservationConfirmationLine")?.addEventListener("click", async (event) => {
        const sendButton = event.currentTarget;
        const errorTarget = document.getElementById("reservationConfirmationError");
        const status = document.getElementById("reservationConfirmationStatus");
        const message = String(text.value || "").trim();
        if (!message) return;
        if (!confirm("この内容をお客様のLINEへ送信しますか？")) return;

        sendButton.disabled = true;
        sendButton.textContent = "送信中…";
        errorTarget.classList.add("hidden");
        status.classList.add("hidden");
        try {
          await sendConfirmation(reservation, message);
          status.textContent = "予約確定LINEを送信しました。";
          status.classList.remove("hidden");
          sendButton.textContent = "送信済み";
        } catch (error) {
          sendButton.disabled = false;
          sendButton.textContent = "LINEで送信";
          if (error?.code === "reservation_not_linked") {
            await copyText(message).catch(() => false);
            errorTarget.textContent = "この予約はLINE送信先の自動紐づけ前に受け付けたため、直接送信できません。文面をコピーしました。今回だけ公式LINEから送信してください。今後の予約は申込時に送信先を自動紐づけします。";
          } else {
            errorTarget.textContent = `LINEを送信できませんでした。（${error?.message || error}）`;
          }
          errorTarget.classList.remove("hidden");
        }
      });
    });
  };

  renderReservationForm = async function(...args) {
    const result = await baseReservationFormForConfirmation(...args);
    installConfirmationButton(args[0] || null);
    return result;
  };
})();
