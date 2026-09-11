(() => {
  const API_BASE = "https://recordare-line-webhook.vercel.app";
  const baseReservationFormForCancellation = renderReservationForm;

  const cancellationReasons = {
    customer: "お客様都合",
    weather: "天候",
    recordare: "RE:CORDARE都合",
    duplicate: "重複・予約調整",
    other: "その他",
  };

  const originalReservationText = (reservation) => {
    const notes = String(reservation?.notes || "");
    const marker = "予約申込原文";
    const index = notes.indexOf(marker);
    if (index < 0) return "";
    return notes.slice(index + marker.length).replace(/^\s+/, "").trim();
  };

  const cancellationMessage = (reservation, reason) => {
    const customer = reservation?.customers?.name || "お客様";
    const vehicle = [
      reservation?.customer_vehicles?.manufacturer,
      reservation?.customer_vehicles?.model,
    ].filter(Boolean).join(" ");
    const date = reservationDate(reservation?.reservation_date || "");
    const time = reservationTime(reservation?.start_time || "");
    const course = reservationCourses[reservation?.course_code] || reservation?.course_code || "";

    let intro = "以下のご予約をキャンセルとして承りました。";
    if (reason === "weather") intro = "天候と施工時の安全を考慮し、以下のご予約をキャンセルとさせていただきます。";
    if (reason === "recordare") intro = "RE:CORDARE側の都合により、以下のご予約をキャンセルとさせていただきます。申し訳ございません。";
    if (reason === "duplicate") intro = "予約内容の調整のため、以下のご予約をキャンセルとして処理いたします。";

    return `${customer}様\n\n${intro}\n\n【ご予約内容】\n日時：${date} ${time}〜\nお車：${vehicle || "確認中"}\nコース：${course}\n\n別日への変更をご希望の場合は、このLINEへご連絡ください。\nよろしくお願いいたします。\n\nRE:CORDARE`;
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

  const sendCancellation = async (reservation, message) => {
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
    const response = await fetch(`${API_BASE}/api/reservation-cancellation`, {
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

  const persistCancellation = async (reservation, reason, note, sentAt) => {
    const values = {
      status: "cancelled",
      cancellation_reason: reason,
      cancellation_note: String(note || "").trim() || null,
      cancelled_at: new Date().toISOString(),
      cancellation_line_sent_at: sentAt || new Date().toISOString(),
    };
    const { data, error } = await supabase.from("reservations")
      .update(values)
      .eq("id", reservation.id)
      .in("status", ["tentative", "confirmed"])
      .select("id,status")
      .maybeSingle();
    if (error) throw error;
    if (!data?.id || data.status !== "cancelled") throw new Error("予約状態をキャンセルへ更新できませんでした。");
    reservation.status = "cancelled";
    reservation.cancellation_reason = reason;
    reservation.cancellation_note = values.cancellation_note;
    reservation.cancelled_at = values.cancelled_at;
    reservation.cancellation_line_sent_at = values.cancellation_line_sent_at;
    window.RECORDARE_RESERVATION_STATUS?.set?.("cancelled");
  };

  const installCancellationButton = (reservation) => {
    if (!reservation?.id || ["completed", "cancelled"].includes(reservation.status)) return;
    const form = document.getElementById("reservationForm");
    if (!form || document.getElementById("reservationCancellationButton")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "reservationCancellationButton";
    button.className = "text-button danger-text";
    button.textContent = "予約をキャンセル";

    const anchor = document.getElementById("reservationConfirmationButton") || document.getElementById("reservationPrePlanButton") || form.querySelector("h2");
    anchor?.insertAdjacentElement("afterend", button);

    button.addEventListener("click", () => {
      let panel = document.getElementById("reservationCancellationPanel");
      if (panel) {
        panel.remove();
        return;
      }

      panel = document.createElement("section");
      panel.id = "reservationCancellationPanel";
      panel.className = "card";
      panel.style.margin = "12px 0";
      panel.innerHTML = `<h3>予約キャンセル</h3><p class="muted">理由を記録し、LINE文面を確認してから送信します。自動送信はしません。</p><label for="reservationCancellationReason">キャンセル理由</label><select id="reservationCancellationReason" required><option value="">理由を選択</option>${Object.entries(cancellationReasons).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select><label for="reservationCancellationNote">内部メモ</label><textarea id="reservationCancellationNote" rows="3" placeholder="その他の場合は内容を入力"></textarea><label for="reservationCancellationText">LINE文面</label><textarea id="reservationCancellationText" rows="14"></textarea><p class="error hidden" id="reservationCancellationError"></p><p class="muted hidden" id="reservationCancellationStatus"></p><button class="primary" type="button" id="sendReservationCancellationLine">LINEで送信してキャンセル</button><button class="secondary hidden" type="button" id="confirmManualReservationCancellation" style="margin-top:10px">公式LINEで送信済みとしてキャンセル確定</button><button class="secondary" type="button" id="copyReservationCancellationLine" style="margin-top:10px">文面をコピー</button><button class="text-button" type="button" id="closeReservationCancellationLine">閉じる</button>`;
      button.insertAdjacentElement("afterend", panel);

      const reason = document.getElementById("reservationCancellationReason");
      const note = document.getElementById("reservationCancellationNote");
      const text = document.getElementById("reservationCancellationText");
      const errorTarget = document.getElementById("reservationCancellationError");
      const status = document.getElementById("reservationCancellationStatus");
      const sendButton = document.getElementById("sendReservationCancellationLine");
      const manualButton = document.getElementById("confirmManualReservationCancellation");
      let lineSentAt = "";

      const refreshMessage = () => {
        if (!reason.value) {
          text.value = "";
          return;
        }
        text.value = cancellationMessage(reservation, reason.value);
      };
      reason.addEventListener("change", refreshMessage);

      const validate = () => {
        if (!reason.value) {
          errorTarget.textContent = "キャンセル理由を選択してください。";
          errorTarget.classList.remove("hidden");
          return false;
        }
        if (reason.value === "other" && !String(note.value || "").trim()) {
          errorTarget.textContent = "「その他」の内容を内部メモに入力してください。";
          errorTarget.classList.remove("hidden");
          return false;
        }
        if (!String(text.value || "").trim()) {
          errorTarget.textContent = "LINE文面を確認してください。";
          errorTarget.classList.remove("hidden");
          return false;
        }
        errorTarget.classList.add("hidden");
        return true;
      };

      const finishCancellation = async (sentAt) => {
        await persistCancellation(reservation, reason.value, note.value, sentAt);
        status.textContent = "キャンセルLINEを送信し、予約状態を「キャンセル」に更新しました。";
        status.classList.remove("hidden");
        sendButton.disabled = true;
        sendButton.textContent = "キャンセル済み";
        manualButton.classList.add("hidden");
        button.disabled = true;
        button.textContent = "キャンセル済み";
      };

      document.getElementById("closeReservationCancellationLine")?.addEventListener("click", () => panel.remove());
      document.getElementById("copyReservationCancellationLine")?.addEventListener("click", async () => {
        if (!validate()) return;
        await copyText(text.value);
        status.textContent = "文面をコピーしました。";
        status.classList.remove("hidden");
      });

      manualButton.addEventListener("click", async () => {
        if (!validate()) return;
        if (!confirm("公式LINEからこの文面を送信済みですか？送信済みの場合、予約をキャンセルに変更します。")) return;
        manualButton.disabled = true;
        manualButton.textContent = "反映中…";
        try {
          await finishCancellation(new Date().toISOString());
        } catch (error) {
          manualButton.disabled = false;
          manualButton.textContent = "公式LINEで送信済みとしてキャンセル確定";
          errorTarget.textContent = `キャンセル状態を保存できませんでした。（${error?.message || error}）`;
          errorTarget.classList.remove("hidden");
        }
      });

      sendButton.addEventListener("click", async () => {
        if (!validate()) return;
        if (!lineSentAt && !confirm("この内容をお客様のLINEへ送信して、予約をキャンセルしますか？")) return;
        sendButton.disabled = true;
        sendButton.textContent = lineSentAt ? "キャンセル状態を反映中…" : "送信中…";
        errorTarget.classList.add("hidden");
        status.classList.add("hidden");
        try {
          if (!lineSentAt) {
            const result = await sendCancellation(reservation, String(text.value || "").trim());
            lineSentAt = result?.sentAt || new Date().toISOString();
          }
          await finishCancellation(lineSentAt);
        } catch (error) {
          sendButton.disabled = false;
          if (lineSentAt) {
            sendButton.textContent = "キャンセル状態を再反映";
            errorTarget.textContent = `LINEは送信済みですが、予約状態を保存できませんでした。（${error?.message || error}）`;
          } else if (error?.code === "reservation_not_linked") {
            await copyText(text.value).catch(() => false);
            sendButton.textContent = "LINEで送信してキャンセル";
            manualButton.classList.remove("hidden");
            errorTarget.textContent = "この予約はLINE送信先の自動紐づけ前に受け付けたため、直接送信できません。文面をコピーしました。公式LINEから送信後、下のボタンでキャンセルを確定してください。";
          } else {
            sendButton.textContent = "LINEで送信してキャンセル";
            errorTarget.textContent = `LINEを送信できませんでした。（${error?.message || error}）`;
          }
          errorTarget.classList.remove("hidden");
        }
      });
    });
  };

  renderReservationForm = async function(...args) {
    const result = await baseReservationFormForCancellation(...args);
    installCancellationButton(args[0] || null);
    return result;
  };
})();
