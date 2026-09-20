(() => {
  const API_BASE = "https://recordare-line-webhook.vercel.app";
  const baseRenderServiceDetailForMaintenance = renderServiceDetail;

  const originalReservationText = (reservation) => {
    const notes = String(reservation?.notes || "");
    const marker = "予約申込原文";
    const index = notes.indexOf(marker);
    if (index < 0) return "";
    return notes.slice(index + marker.length).replace(/^\s+/, "").trim();
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

  const sendLine = async (customerId, reservationText, message) => {
    if (!customerId && !reservationText) {
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
      body: JSON.stringify({
        customerId,
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

  const maintenanceMessage = (record, dayOffset) => {
    const customer = record?.customer_name || "お客様";
    const vehicle = [record?.vehicle_manufacturer, record?.vehicle_model, record?.vehicle_color].filter(Boolean).join(" ");
    const course = reservationCourses[record?.course_code] || record?.course_code || "";
    const intro = `${customer}様\n\nRE:CORDAREです。\n前回の施工から約${dayOffset}日が経ちました。\nお車の状態はいかがでしょうか？`;
    const vehiclePart = `\n\n【前回の施工】\nお車：${vehicle || "確認中"}\nコース：${course}`;

    if (dayOffset === 30) {
      return `${intro}${vehiclePart}\n\n施工日から30日以内のメンテナンスは、¥1,000引きの対象です。\n汚れ方や撥水の状態が気になってきた場合は、このLINEからお気軽にご相談ください。\n\nRE:CORDARE`;
    }
    if (dayOffset === 45) {
      return `${intro}${vehiclePart}\n\n施工日から31〜45日以内のメンテナンスは、¥500引きの対象です。\nそろそろ一度状態を確認したい場合は、このLINEからお気軽にご相談ください。\n\nRE:CORDARE`;
    }
    if (dayOffset === 60) {
      return `${intro}${vehiclePart}\n\n汚れの付き方や撥水・ツヤの変化など、気になる点がありましたら一度状態確認がおすすめです。\n必要な内容だけご案内しますので、このLINEからお気軽にご相談ください。\n\nRE:CORDARE`;
    }
    return `${intro}${vehiclePart}\n\n前回施工から約3か月の目安です。\n汚れや保護状態を一度確認して、必要に応じてメンテナンスやリセットをご案内できます。\n気になることがありましたら、このLINEからお気軽にご相談ください。\n\nRE:CORDARE`;
  };

  const formatDueDate = (value) => {
    if (!value) return "未設定";
    const [year, month, day] = String(value).slice(0, 10).split("-");
    return `${Number(month)}/${Number(day)}`;
  };

  const markSent = async (followup, message, sentAt) => {
    const { error } = await supabase.from("service_maintenance_followups")
      .update({
        sent_at: sentAt || new Date().toISOString(),
        message,
      })
      .eq("id", followup.id)
      .is("sent_at", null);
    if (error) throw error;
  };

  const installMaintenanceCard = async (record) => {
    if (!record?.id || record.status !== "completed" || document.getElementById("serviceMaintenanceCard")) return;

    const [{ data: reservation }, { data: followups, error }] = await Promise.all([
      supabase.from("reservations").select("id,notes").eq("id", record.reservation_id).maybeSingle(),
      supabase.from("service_maintenance_followups")
        .select("id,day_offset,due_on,notified_at,sent_at,message")
        .eq("service_record_id", record.id)
        .order("day_offset", { ascending: true }),
    ]);
    if (error || !(followups || []).length) return;

    const anchor = document.getElementById("serviceFollowupCard") || document.querySelector("#managerContent .detail-card");
    if (!anchor) return;

    const card = document.createElement("section");
    card.id = "serviceMaintenanceCard";
    card.className = "card";

    const rows = followups.map((item) => {
      const sent = item.sent_at
        ? `<strong>送信済み</strong> ・ ${escapeHtml(new Date(item.sent_at).toLocaleDateString("ja-JP"))}`
        : item.notified_at
          ? "<strong>案内時期です</strong>"
          : "未送信";
      return `<div class="service-timing-correction"><p><strong>${item.day_offset}日案内</strong> ・ ${escapeHtml(formatDueDate(item.due_on))}</p><p class="muted">${sent}</p>${item.sent_at ? "" : `<button class="secondary" type="button" data-maintenance-followup="${item.id}">LINEを確認</button>`}</div>`;
    }).join("");

    card.innerHTML = `<h2>メンテナンス案内</h2><p class="muted">30・45・60・90日の目安で通知します。お客様へのLINEは内容を確認してから送信します。</p>${rows}`;
    anchor.insertAdjacentElement("afterend", card);

    card.querySelectorAll("[data-maintenance-followup]").forEach((button) => {
      button.addEventListener("click", () => {
        const followup = followups.find((item) => item.id === button.dataset.maintenanceFollowup);
        if (!followup) return;

        const existingPanel = card.querySelector("[data-maintenance-panel]");
        if (existingPanel) existingPanel.remove();

        const panel = document.createElement("div");
        panel.dataset.maintenancePanel = followup.id;
        panel.className = "service-timing-correction";
        panel.innerHTML = `<h3>${followup.day_offset}日メンテナンス案内</h3><textarea data-maintenance-text rows="15"></textarea><p class="error hidden" data-maintenance-error></p><p class="muted hidden" data-maintenance-status></p><button class="primary" type="button" data-maintenance-send>LINEで送信</button><button class="secondary" type="button" data-maintenance-copy style="margin-top:10px">文面をコピー</button><button class="text-button hidden" type="button" data-maintenance-mark>公式LINEから送ったので送信済みにする</button><button class="text-button" type="button" data-maintenance-close>閉じる</button>`;
        button.closest(".service-timing-correction")?.insertAdjacentElement("afterend", panel);

        const textArea = panel.querySelector("[data-maintenance-text]");
        const errorTarget = panel.querySelector("[data-maintenance-error]");
        const statusTarget = panel.querySelector("[data-maintenance-status]");
        const markButton = panel.querySelector("[data-maintenance-mark]");
        textArea.value = followup.message || maintenanceMessage(record, Number(followup.day_offset));

        panel.querySelector("[data-maintenance-close]")?.addEventListener("click", () => panel.remove());
        panel.querySelector("[data-maintenance-copy]")?.addEventListener("click", async () => {
          await copyText(textArea.value);
          statusTarget.textContent = "文面をコピーしました。";
          statusTarget.classList.remove("hidden");
        });

        markButton?.addEventListener("click", async (event) => {
          if (!confirm("公式LINEから送信済みとして記録しますか？")) return;
          const action = event.currentTarget;
          action.disabled = true;
          try {
            await markSent(followup, String(textArea.value || "").trim());
            await renderServiceDetail(record.id);
          } catch (markError) {
            action.disabled = false;
            errorTarget.textContent = `送信済みとして記録できませんでした。（${markError?.message || markError}）`;
            errorTarget.classList.remove("hidden");
          }
        });

        panel.querySelector("[data-maintenance-send]")?.addEventListener("click", async (event) => {
          const sendButton = event.currentTarget;
          const message = String(textArea.value || "").trim();
          if (!message) return;
          if (!confirm("このメンテナンス案内をお客様のLINEへ送信しますか？")) return;

          sendButton.disabled = true;
          sendButton.textContent = "送信中…";
          errorTarget.classList.add("hidden");
          statusTarget.classList.add("hidden");

          try {
            const payload = await sendLine(record.customer_id, originalReservationText(reservation), message);
            try {
              await markSent(followup, message, payload.sentAt || new Date().toISOString());
            } catch (recordError) {
              statusTarget.textContent = "LINEは送信済みですが、Managerへの送信記録保存に失敗しました。二重送信せず、送信済み記録だけ行ってください。";
              statusTarget.classList.remove("hidden");
              markButton?.classList.remove("hidden");
              sendButton.textContent = "LINE送信済み";
              return;
            }
            await renderServiceDetail(record.id);
          } catch (sendError) {
            sendButton.disabled = false;
            sendButton.textContent = "LINEで送信";
            if (sendError?.code === "reservation_not_linked") {
              await copyText(message).catch(() => false);
              errorTarget.textContent = "この予約はLINE送信先が紐づいていないため直接送信できません。文面をコピーしました。公式LINEから送信したあと、下の『送信済みにする』を押してください。";
              markButton?.classList.remove("hidden");
            } else {
              errorTarget.textContent = `LINEを送信できませんでした。（${sendError?.message || sendError}）`;
            }
            errorTarget.classList.remove("hidden");
          }
        });
      });
    });
  };

  renderServiceDetail = async function(...args) {
    const result = await baseRenderServiceDetailForMaintenance(...args);
    const recordId = args[0];
    if (!recordId || activeTab !== "施工") return result;
    const { data: record, error } = await supabase.from("service_records")
      .select("id,reservation_id,customer_id,customer_name,vehicle_manufacturer,vehicle_model,vehicle_color,course_code,status")
      .eq("id", recordId)
      .eq("is_active", true)
      .maybeSingle();
    if (!error && record?.status === "completed") await installMaintenanceCard(record);
    return result;
  };
})();
