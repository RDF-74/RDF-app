(() => {
  const API_BASE = "https://recordare-line-webhook.vercel.app";
  const baseReservationFormForDelay = renderReservationForm;

  const delayReasons = {
    traffic: "交通状況",
    previous_service: "前の施工延長",
    weather: "天候",
    vehicle: "車両トラブル",
    other: "その他",
  };

  const relationOne = (value) => Array.isArray(value) ? value[0] : value;
  const originalReservationText = (reservation) => {
    const notes = String(reservation?.notes || "");
    const marker = "予約申込原文";
    const index = notes.indexOf(marker);
    if (index < 0) return "";
    return notes.slice(index + marker.length).replace(/^\s+/, "").trim();
  };

  const minutesFromTime = (value) => {
    const [hour, minute] = String(value || "").slice(0, 5).split(":").map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  };
  const timeFromMinutes = (value) => {
    const total = ((Number(value) % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };
  const addMinutes = (time, minutes) => {
    const base = minutesFromTime(time);
    return base == null ? "" : timeFromMinutes(base + Number(minutes || 0));
  };

  const delayMessage = (reservation, reason, newArrivalTime) => {
    const customer = relationOne(reservation?.customers)?.name || "お客様";
    const original = reservationTime(reservation?.start_time || "");
    const reasonText = delayReasons[reason] || "都合";
    return `${customer}様\n\n本日のご予約についてご連絡いたします。\n${reasonText}のため、到着が遅れる見込みです。申し訳ございません。\n\n【ご予約時間】${original}〜\n【新しい到着予定】${newArrivalTime}頃\n\nご迷惑をおかけして申し訳ありません。\n到着予定にさらに変更がある場合は、改めてご連絡いたします。\nよろしくお願いいたします。\n\nRE:CORDARE`;
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

  const fetchPendingDelay = async (reservationId) => {
    const { data, error } = await supabase.from("reservation_delay_history")
      .select("id,reason,internal_note,original_start_time,new_arrival_time,projected_end_time,line_message,line_sent_at,created_at")
      .eq("reservation_id", reservationId)
      .is("line_sent_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  };

  const ensurePendingDelay = async (reservation, values, pendingId = null) => {
    if (pendingId) {
      const { data, error } = await supabase.from("reservation_delay_history")
        .update(values)
        .eq("id", pendingId)
        .eq("reservation_id", reservation.id)
        .is("line_sent_at", null)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (data?.id) return data.id;
    }
    const { data, error } = await supabase.from("reservation_delay_history")
      .insert({ reservation_id: reservation.id, ...values })
      .select("id")
      .single();
    if (error || !data?.id) throw error || new Error("遅延履歴を作成できませんでした。");
    return data.id;
  };

  const markDelaySent = async (reservationId, delayId, sentAt, message) => {
    const { data, error } = await supabase.from("reservation_delay_history")
      .update({ line_sent_at: sentAt || new Date().toISOString(), line_message: message })
      .eq("id", delayId)
      .eq("reservation_id", reservationId)
      .is("line_sent_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) {
      const { data: existing, error: existingError } = await supabase.from("reservation_delay_history")
        .select("id,line_sent_at")
        .eq("id", delayId)
        .eq("reservation_id", reservationId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing?.line_sent_at) throw new Error("遅延履歴を送信済みに更新できませんでした。");
    }
  };

  const sendDelay = async (reservation, delayKey, message) => {
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
    const response = await fetch(`${API_BASE}/api/reservation-delay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reservationText, delayKey, message, supabaseUrl: config.url, anonKey: config.anonKey }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `LINE送信エラー (${response.status})`);
      error.code = payload.error || "line_send_failed";
      throw error;
    }
    return payload;
  };

  const findNextReservation = async (reservation) => {
    const { data, error } = await supabase.from("reservations")
      .select("id,start_time,status,customers(name)")
      .eq("is_active", true)
      .eq("reservation_date", reservationDate(reservation.reservation_date))
      .neq("id", reservation.id)
      .gt("start_time", reservation.start_time)
      .in("status", ["tentative", "confirmed"])
      .order("start_time", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  };

  const installDelayButton = async (reservation) => {
    if (!reservation?.id || reservation.status !== "confirmed") return;
    const form = document.getElementById("reservationForm");
    if (!form || document.getElementById("reservationDelayButton")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "reservationDelayButton";
    button.className = "secondary service-create-button";
    button.textContent = "遅延連絡";
    const anchor = document.getElementById("reservationChangeLineButton") || document.getElementById("reservationCancellationButton") || document.getElementById("reservationConfirmationButton") || document.getElementById("reservationPrePlanButton") || form.querySelector("h2");
    anchor?.insertAdjacentElement("afterend", button);

    button.addEventListener("click", async () => {
      let panel = document.getElementById("reservationDelayPanel");
      if (panel) {
        panel.remove();
        return;
      }

      let pending = null;
      let nextReservation = null;
      try {
        [pending, nextReservation] = await Promise.all([
          fetchPendingDelay(reservation.id),
          findNextReservation(reservation),
        ]);
      } catch (error) {
        return alert(saveErrorMessage(error));
      }

      panel = document.createElement("section");
      panel.id = "reservationDelayPanel";
      panel.className = "card";
      panel.style.margin = "12px 0";
      panel.innerHTML = `<h3>遅延連絡</h3><p class="muted">理由と新しい到着予定を確認し、LINE文面を確認してから送信します。自動送信はしません。</p><label for="reservationDelayReason">遅延理由</label><select id="reservationDelayReason" required><option value="">理由を選択</option>${Object.entries(delayReasons).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select><label for="reservationDelayPreset">到着予定</label><select id="reservationDelayPreset"><option value="15">15分遅れ</option><option value="30">30分遅れ</option><option value="45">45分遅れ</option><option value="60">60分遅れ</option><option value="90">90分遅れ</option><option value="custom">時刻を指定</option></select><input id="reservationDelayArrivalTime" type="time" required><label for="reservationDelayNote">内部メモ</label><textarea id="reservationDelayNote" rows="3" placeholder="必要な場合だけ入力"></textarea><p class="muted hidden" id="reservationDelayNextWarning"></p><label for="reservationDelayText">LINE文面</label><textarea id="reservationDelayText" rows="14"></textarea><p class="error hidden" id="reservationDelayError"></p><p class="muted hidden" id="reservationDelayStatus"></p><button class="primary" type="button" id="sendReservationDelayLine">LINEで送信</button><button class="secondary hidden" type="button" id="confirmManualReservationDelay" style="margin-top:10px">公式LINEで送信済みとして記録</button><button class="secondary" type="button" id="copyReservationDelayLine" style="margin-top:10px">文面をコピー</button><button class="text-button" type="button" id="closeReservationDelayLine">閉じる</button>`;
      button.insertAdjacentElement("afterend", panel);

      const reason = document.getElementById("reservationDelayReason");
      const preset = document.getElementById("reservationDelayPreset");
      const arrival = document.getElementById("reservationDelayArrivalTime");
      const note = document.getElementById("reservationDelayNote");
      const text = document.getElementById("reservationDelayText");
      const warning = document.getElementById("reservationDelayNextWarning");
      const errorTarget = document.getElementById("reservationDelayError");
      const status = document.getElementById("reservationDelayStatus");
      const sendButton = document.getElementById("sendReservationDelayLine");
      const manualButton = document.getElementById("confirmManualReservationDelay");
      let pendingId = pending?.id || "";
      let sentAt = "";

      if (pending) {
        reason.value = pending.reason || "";
        preset.value = "custom";
        arrival.value = reservationTime(pending.new_arrival_time || "");
        note.value = pending.internal_note || "";
        text.value = pending.line_message || "";
        status.textContent = "未完了の遅延連絡があります。内容を確認して送信を再開できます。";
        status.classList.remove("hidden");
      } else {
        arrival.value = addMinutes(reservation.start_time, 15);
      }

      const projectedEnd = () => addMinutes(arrival.value, Number(reservation.planned_slot_minutes || 0));
      const syncWarning = () => {
        if (!nextReservation?.start_time || !arrival.value) return warning.classList.add("hidden");
        const projected = minutesFromTime(projectedEnd());
        const nextStart = minutesFromTime(nextReservation.start_time);
        if (projected != null && nextStart != null && projected > nextStart) {
          const nextCustomer = relationOne(nextReservation.customers)?.name || "次のお客様";
          warning.textContent = `注意：この到着予定だと終了見込み ${projectedEnd()} 頃となり、次の予約（${reservationTime(nextReservation.start_time)}〜 ${nextCustomer}様）と重なる可能性があります。`;
          warning.classList.remove("hidden");
        } else {
          warning.classList.add("hidden");
        }
      };
      const refreshMessage = () => {
        if (reason.value && arrival.value) text.value = delayMessage(reservation, reason.value, arrival.value);
        syncWarning();
      };
      const applyPreset = () => {
        if (preset.value !== "custom") arrival.value = addMinutes(reservation.start_time, Number(preset.value));
        refreshMessage();
      };
      preset.addEventListener("change", applyPreset);
      reason.addEventListener("change", refreshMessage);
      arrival.addEventListener("change", () => { preset.value = "custom"; refreshMessage(); });
      syncWarning();
      if (!pending) refreshMessage();

      const validate = () => {
        if (!reason.value) {
          errorTarget.textContent = "遅延理由を選択してください。";
          errorTarget.classList.remove("hidden");
          return false;
        }
        if (reason.value === "other" && !String(note.value || "").trim()) {
          errorTarget.textContent = "「その他」の内容を内部メモに入力してください。";
          errorTarget.classList.remove("hidden");
          return false;
        }
        if (!arrival.value || !String(text.value || "").trim()) {
          errorTarget.textContent = "新しい到着予定とLINE文面を確認してください。";
          errorTarget.classList.remove("hidden");
          return false;
        }
        errorTarget.classList.add("hidden");
        return true;
      };

      const pendingValues = () => ({
        reason: reason.value,
        internal_note: String(note.value || "").trim() || null,
        original_start_time: reservationTime(reservation.start_time),
        new_arrival_time: arrival.value,
        projected_end_time: projectedEnd() || null,
        line_message: String(text.value || "").trim(),
      });

      const finish = async (timestamp) => {
        await markDelaySent(reservation.id, pendingId, timestamp, String(text.value || "").trim());
        status.textContent = "遅延LINEを送信し、履歴に記録しました。";
        status.classList.remove("hidden");
        sendButton.disabled = true;
        sendButton.textContent = "送信済み";
        manualButton.classList.add("hidden");
      };

      document.getElementById("closeReservationDelayLine")?.addEventListener("click", () => panel.remove());
      document.getElementById("copyReservationDelayLine")?.addEventListener("click", async () => {
        if (!validate()) return;
        await copyText(text.value);
        status.textContent = "文面をコピーしました。";
        status.classList.remove("hidden");
      });

      manualButton.addEventListener("click", async () => {
        if (!validate()) return;
        if (!confirm("公式LINEからこの遅延連絡を送信済みですか？")) return;
        manualButton.disabled = true;
        manualButton.textContent = "記録中…";
        try {
          pendingId = await ensurePendingDelay(reservation, pendingValues(), pendingId);
          await finish(new Date().toISOString());
        } catch (error) {
          manualButton.disabled = false;
          manualButton.textContent = "公式LINEで送信済みとして記録";
          errorTarget.textContent = `遅延履歴を保存できませんでした。（${error?.message || error}）`;
          errorTarget.classList.remove("hidden");
        }
      });

      sendButton.addEventListener("click", async () => {
        if (!validate()) return;
        if (!sentAt && !confirm("この内容をお客様のLINEへ送信しますか？")) return;
        sendButton.disabled = true;
        sendButton.textContent = sentAt ? "履歴を反映中…" : "送信中…";
        errorTarget.classList.add("hidden");
        status.classList.add("hidden");
        try {
          pendingId = await ensurePendingDelay(reservation, pendingValues(), pendingId);
          if (!sentAt) {
            const result = await sendDelay(reservation, pendingId, String(text.value || "").trim());
            sentAt = result?.sentAt || new Date().toISOString();
          }
          await finish(sentAt);
        } catch (error) {
          sendButton.disabled = false;
          if (sentAt) {
            sendButton.textContent = "履歴を再反映";
            errorTarget.textContent = `LINEは送信済みですが、遅延履歴を更新できませんでした。（${error?.message || error}）`;
          } else if (error?.code === "reservation_not_linked") {
            await copyText(text.value).catch(() => false);
            sendButton.textContent = "LINEで送信";
            manualButton.classList.remove("hidden");
            errorTarget.textContent = "この予約はLINE送信先が紐づいていないため直接送信できません。文面をコピーしました。公式LINEから送信後、下のボタンで送信済みとして記録してください。";
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
    const result = await baseReservationFormForDelay(...args);
    await installDelayButton(args[0] || null);
    return result;
  };
})();
