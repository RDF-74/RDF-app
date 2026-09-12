(() => {
  const API_BASE = "https://recordare-line-webhook.vercel.app";
  const baseRenderServiceDetailForFollowup = renderServiceDetail;

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

  const followupOptionLabel = (record, row) => {
    const code = typeof row === "string" ? row : row?.code;
    if (record?.course_code === "reset_coat" && code === "front_glass_scale") return "フロントガラス ウロコ除去";
    if (record?.course_code === "reset_coat" && code === "all_glass_scale") return "全面ガラス ウロコ除去";
    const option = reservationOptions.find((item) => item.code === code);
    return option?.label || code || "";
  };

  const optionSummary = (record) => {
    const rows = normalizeRows(record?.selected_options);
    if (!rows.length) return "なし";
    return rows.map((row) => followupOptionLabel(record, row)).filter(Boolean).join("、") || "なし";
  };

  const thankYouMessage = (record) => {
    const customer = record?.customer_name || "お客様";
    const vehicle = [record?.vehicle_manufacturer, record?.vehicle_model, record?.vehicle_color].filter(Boolean).join(" ");
    const course = reservationCourses[record?.course_code] || record?.course_code || "";
    return `${customer}様\n\n本日はRE:CORDAREをご利用いただき、ありがとうございました。\n\n【今回の施工内容】\nお車：${vehicle || "確認中"}\nコース：${course}\nオプション：${optionSummary(record)}\n\n施工後に気になる点や、お手入れについて分からないことがありましたら、このLINEからいつでもご相談ください。\n\n次回のメンテナンス時期も、お車の状態に合わせてご案内いたします。\n\n本日はありがとうございました。\n\nRE:CORDARE`;
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

  const sendThankYouLine = async (reservationText, message) => {
    if (!reservationText) {
      const error = new Error("reservation_not_linked");
      error.code = "reservation_not_linked";
      throw error;
    }
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error("Managerのログイン情報を確認できませんでした。");
    const config = window.RECORDARE_SUPABASE_CONFIG || {};
    const response = await fetch(`${API_BASE}/api/service-followup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reservationText, message, supabaseUrl: config.url, anonKey: config.anonKey }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `LINE送信エラー (${response.status})`);
      error.code = payload.error || "line_send_failed";
      throw error;
    }
    return payload;
  };

  const markFollowupSent = async (record, message, sentAt = new Date().toISOString()) => {
    const { data: existing, error: selectError } = await supabase
      .from("service_followup_lines")
      .select("id")
      .eq("service_record_id", record.id)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existing?.id) {
      const { error } = await supabase
        .from("service_followup_lines")
        .update({ sent_at: sentAt, message })
        .eq("id", existing.id);
      if (error) throw error;
      return;
    }
    const completedAt = new Date(record.actual_completed_at || Date.now());
    const dueAt = new Date(completedAt.getTime() + 30 * 60 * 1000).toISOString();
    const reminderDueAt = new Date(completedAt.getTime() + 150 * 60 * 1000).toISOString();
    const { error } = await supabase.from("service_followup_lines").insert({
      service_record_id: record.id,
      due_at: dueAt,
      reminder_due_at: reminderDueAt,
      sent_at: sentAt,
      message,
    });
    if (error) throw error;
  };

  const installFollowupCard = async (record) => {
    if (!record?.id || record.status !== "completed" || document.getElementById("serviceFollowupCard")) return;
    const detailCard = document.querySelector("#managerContent .detail-card");
    if (!detailCard) return;

    const [{ data: reservation }, { data: followup }] = await Promise.all([
      supabase.from("reservations").select("id,notes").eq("id", record.reservation_id).maybeSingle(),
      supabase.from("service_followup_lines").select("id,sent_at,message").eq("service_record_id", record.id).maybeSingle(),
    ]);

    const card = document.createElement("section");
    card.id = "serviceFollowupCard";
    card.className = "card";
    if (followup?.sent_at) {
      card.innerHTML = `<h2>施工後のお礼LINE</h2><p><strong>送信済み</strong></p><p class="muted">${escapeHtml(formatActualTime(followup.sent_at))} に送信しました。</p>`;
      detailCard.insertAdjacentElement("afterend", card);
      return;
    }

    card.innerHTML = `<h2>施工後のお礼LINE</h2><p class="muted">自動送信はしません。内容を確認してから送信します。</p><button class="secondary" type="button" id="openServiceFollowupLine">お礼LINEを確認</button>`;
    detailCard.insertAdjacentElement("afterend", card);

    document.getElementById("openServiceFollowupLine")?.addEventListener("click", () => {
      let panel = document.getElementById("serviceFollowupPanel");
      if (panel) {
        panel.remove();
        return;
      }
      panel = document.createElement("div");
      panel.id = "serviceFollowupPanel";
      panel.innerHTML = `<textarea id="serviceFollowupText" rows="15"></textarea><p class="error hidden" id="serviceFollowupError"></p><p class="muted hidden" id="serviceFollowupStatus"></p><button class="primary" type="button" id="sendServiceFollowupLine">LINEで送信</button><button class="secondary" type="button" id="copyServiceFollowupLine" style="margin-top:10px">文面をコピー</button><button class="text-button hidden" type="button" id="markServiceFollowupSent">公式LINEから送ったので送信済みにする</button><button class="text-button" type="button" id="closeServiceFollowupLine">閉じる</button>`;
      card.appendChild(panel);
      const text = document.getElementById("serviceFollowupText");
      text.value = thankYouMessage(record);
      document.getElementById("closeServiceFollowupLine")?.addEventListener("click", () => panel.remove());
      document.getElementById("copyServiceFollowupLine")?.addEventListener("click", async () => {
        await copyText(text.value);
        const status = document.getElementById("serviceFollowupStatus");
        status.textContent = "文面をコピーしました。";
        status.classList.remove("hidden");
      });
      document.getElementById("markServiceFollowupSent")?.addEventListener("click", async (event) => {
        if (!confirm("公式LINEから送信済みとして記録しますか？")) return;
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await markFollowupSent(record, String(text.value || "").trim());
          await renderServiceDetail(record.id);
        } catch (error) {
          button.disabled = false;
          const target = document.getElementById("serviceFollowupError");
          target.textContent = `送信済みとして記録できませんでした。（${error?.message || error}）`;
          target.classList.remove("hidden");
        }
      });
      document.getElementById("sendServiceFollowupLine")?.addEventListener("click", async (event) => {
        const sendButton = event.currentTarget;
        const errorTarget = document.getElementById("serviceFollowupError");
        const status = document.getElementById("serviceFollowupStatus");
        const message = String(text.value || "").trim();
        if (!message) return;
        if (!confirm("この内容をお客様のLINEへ送信しますか？")) return;
        sendButton.disabled = true;
        sendButton.textContent = "送信中…";
        errorTarget.classList.add("hidden");
        status.classList.add("hidden");
        try {
          const payload = await sendThankYouLine(originalReservationText(reservation), message);
          try {
            await markFollowupSent(record, message, payload.sentAt || new Date().toISOString());
          } catch (recordError) {
            status.textContent = "LINEは送信済みですが、Managerへの送信記録保存に失敗しました。二重送信せず、送信済み記録だけ行ってください。";
            status.classList.remove("hidden");
            document.getElementById("markServiceFollowupSent")?.classList.remove("hidden");
            sendButton.textContent = "LINE送信済み";
            return;
          }
          await renderServiceDetail(record.id);
        } catch (error) {
          sendButton.disabled = false;
          sendButton.textContent = "LINEで送信";
          if (error?.code === "reservation_not_linked") {
            await copyText(message).catch(() => false);
            errorTarget.textContent = "この予約はLINE送信先が紐づいていないため直接送信できません。文面をコピーしました。公式LINEから送信したあと、下の『送信済みにする』を押してください。";
            document.getElementById("markServiceFollowupSent")?.classList.remove("hidden");
          } else {
            errorTarget.textContent = `LINEを送信できませんでした。（${error?.message || error}）`;
          }
          errorTarget.classList.remove("hidden");
        }
      });
    });
  };

  renderServiceDetail = async function(...args) {
    const result = await baseRenderServiceDetailForFollowup(...args);
    const recordId = args[0];
    if (!recordId || activeTab !== "施工") return result;
    const { data: record, error } = await supabase
      .from("service_records")
      .select("id,reservation_id,customer_name,vehicle_manufacturer,vehicle_model,vehicle_color,course_code,selected_options,status,actual_completed_at")
      .eq("id", recordId)
      .eq("is_active", true)
      .maybeSingle();
    if (!error && record?.status === "completed") await installFollowupCard(record);
    return result;
  };
})();
