(() => {
  const API_BASE = "https://recordare-line-webhook.vercel.app";
  const baseRenderServiceTimer = renderServiceTimer;
  let pollTimer = null;

  const templates = {
    front_glass_oil_repellent: {
      detail: "フロントガラスに油膜の付着が見られます。\n油膜があると、雨の日や夜間にギラついて見えにくくなることがあります。\n安全な視界を保つため、油膜除去＋撥水をおすすめします。",
      short: "雨の日や夜間の視界を整え、安全に運転しやすくするため。",
    },
    front_glass_scale: {
      detail: "フロントガラスにウロコ状の水ジミが見られます。\nウロコが強く付着していると、雨の日や夜間、逆光時などに見えにくくなることがあります。\n見やすい視界を保つため、ウロコ除去＋油膜除去＋撥水をおすすめします。",
      short: "雨天・夜間・逆光時の見えにくさを減らし、視界を整えるため。",
    },
    all_glass_oil_repellent: {
      detail: "ガラス全面に油膜の付着が見られます。\n油膜があると、雨の日や夜間にギラついて見えにくくなることがあります。\n安全な視界を保つため、全面ガラスの油膜除去＋撥水をおすすめします。",
      short: "雨の日や夜間の視界を整え、安全に運転しやすくするため。",
    },
    all_glass_scale: {
      detail: "ガラス全面にウロコ状の水ジミが見られます。\nウロコが強く付着していると、雨の日や夜間、逆光時などに見えにくくなることがあります。\n見やすい視界を保つため、全面ガラスのウロコ除去＋油膜除去＋撥水をおすすめします。",
      short: "雨天・夜間・逆光時の見えにくさを減らし、視界を整えるため。",
    },
    body_iron_removal: {
      detail: "ボディに鉄粉の付着が見られます。\n付着した鉄粉は時間が経つと酸化してサビ、茶色い点状の汚れやザラつきの原因になります。\n固着する前の除去がおすすめです。",
      short: "鉄粉が固着して、サビ汚れやザラつきになる前に除去するため。",
    },
    wheel_scale_light: {
      detail: "ホイールに白っぽい水ジミやくすみが見られます。\n放置すると汚れが固着して、通常の洗浄では落としにくくなることがあります。\n見た目をすっきり整えるため、早めの除去がおすすめです。",
      short: "白っぽい水ジミやくすみを除去し、見た目をすっきり整えるため。",
    },
    wheel_scale_heavy: {
      detail: "ホイールに強い白っぽい水ジミやくすみが見られます。\n汚れが固着しているため、通常の洗浄だけでは落としにくい状態です。\n本来の見た目に近づけるため、スケール除去をおすすめします。",
      short: "強い白っぽい水ジミやくすみを除去し、本来の見た目に近づけるため。",
    },
    unpainted_resin_partial: {
      detail: "未塗装樹脂が白っぽくなってきています。\n紫外線や雨の影響で、時間が経つほど色あせが目立ちやすくなります。\n見た目を整えて劣化を抑えるため、未塗装樹脂コートがおすすめです。",
      short: "白っぽくなった樹脂の見た目を整え、劣化を抑えるため。",
    },
    unpainted_resin_wide: {
      detail: "未塗装樹脂が白っぽくなってきています。\n紫外線や雨の影響で、時間が経つほど色あせが目立ちやすくなります。\n見た目を整えて劣化を抑えるため、未塗装樹脂コートがおすすめです。",
      short: "白っぽくなった樹脂の見た目を整え、劣化を抑えるため。",
    },
  };

  const uuid = () => crypto.randomUUID();
  const changeRows = async (recordId) => {
    const { data, error } = await supabase.from("service_proposals")
      .select("id,title,status,step_keys,snapshot,customer_decision,customer_confirmed_at,created_at")
      .eq("service_record_id", recordId)
      .is("source_tag_key", null)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).filter((row) => row.snapshot?.type === "service_change");
  };
  const originalReservationText = (notes) => {
    const value = String(notes || "");
    const marker = "予約申込原文";
    const index = value.indexOf(marker);
    return index < 0 ? "" : value.slice(index + marker.length).replace(/^\s+/, "").trim();
  };

  const apiRequest = async (payload) => {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error("Managerのログイン情報を確認できませんでした。");
    const config = window.RECORDARE_SUPABASE_CONFIG || {};
    const response = await fetch(`${API_BASE}/api/reservation-confirmation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...payload, serviceChangeRequest: true, supabaseUrl: config.url, anonKey: config.anonKey }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || `LINE送信エラー (${response.status})`);
      error.code = result.error || "line_send_failed";
      throw error;
    }
    return result;
  };
  const addedItems = (record, form) => {
    const current = new Set(jsonArray(record.selected_options).map((item) => item.code));
    const selected = [...form.querySelectorAll('input[name="service_option"]:checked')].map((input) => input.value);
    const removed = [...current].filter((code) => !selected.includes(code));
    const courseChanged = form.course_code.value !== record.course_code;
    const added = selected.filter((code) => !current.has(code)).map((code) => {
      const option = reservationOptions.find((item) => item.code === code);
      const template = templates[code];
      const steps = serviceOptionSteps[code] || [];
      return option && template ? {
        code,
        title: option.label,
        amountDelta: Number(option.amount || 0),
        consultPrice: Boolean(option.consult),
        detail: template.detail,
        reason: template.short,
        orderGroup: steps.length ? Math.min(...steps.map((step) => Number(step.order_group || 9999))) : 9999,
        stepKeys: steps.map((step) => step.step_key),
      } : null;
    }).filter(Boolean);
    const consultItems = added.filter((item) => item.consultPrice);
    let needsPrice = false;
    if (consultItems.length === 1) {
      const fixedDelta = added.filter((item) => !item.consultPrice).reduce((sum, item) => sum + item.amountDelta, 0);
      const enteredDelta = Number(form.planned_total?.value || record.planned_total || 0) - Number(record.planned_total || 0);
      const consultDelta = enteredDelta - fixedDelta;
      if (consultDelta > 0) consultItems[0].amountDelta = consultDelta;
      else needsPrice = true;
    } else if (consultItems.length > 1) {
      needsPrice = true;
    }
    return { added, removed, courseChanged, needsPrice };
  };

  const proposalMessage = (items, baseTotal) => {
    const base = Number(baseTotal || 0);
    const delta = items.reduce((sum, item) => sum + item.amountDelta, 0);
    const total = base + delta;
    const footer = "追加施工は、このあとのボタンで「了承する」を選び、回答を確定いただいた場合のみ行います。\n「相談」「見送る」も選べます。見送った場合は、現在のご予約内容のまま施工を進めます。";
    if (items.length === 1) {
      const item = items[0];
      return `施工前にお車の状態を確認したところ、追加でご案内したい施工があります。\n\n【状態とご提案理由】\n${item.detail}\n\n【追加施工】\n${item.title}\n\n【料金】\n現在の予定金額：${yen(base)}\n追加料金：＋${yen(item.amountDelta)}\n変更後の予定金額：${yen(total)}\n\n${footer}\n\n内容をご確認のうえ、下のボタンからお選びください。`;
    }
    const lines = items.map((item, index) => `【${index + 1}】${item.title}\n${item.detail}\n追加料金：＋${yen(item.amountDelta)}`).join("\n\n");
    return `施工前にお車の状態を確認したところ、追加でご案内したい施工があります。\n\n${lines}\n\n【料金】\n現在の予定金額：${yen(base)}\n追加料金合計：＋${yen(delta)}\n変更後の予定金額：${yen(total)}\n\n${footer}\n\n内容をご確認のうえ、各項目のボタンからお選びください。`;
  };

  const proposalStateLabel = (row) => {
    const response = row.snapshot?.customer_response;
    if (response === "consult") return "相談希望";
    if (row.customer_decision === "approved") return "了承済み";
    if (row.customer_decision === "declined") return "見送り";
    return "回答待ち";
  };

  const isBlocking = (row) => {
    if (row.snapshot?.customer_response === "consult") return true;
    return row.customer_decision === "pending" && !row.customer_confirmed_at;
  };
  const applyApprovedAdditions = async (recordId, approvedRows) => {
    if (!approvedRows.length) return;
    const [{ data: record, error: recordError }, { data: steps, error: stepError }] = await Promise.all([
      supabase.from("service_records").select("*").eq("id", recordId).eq("is_active", true).maybeSingle(),
      supabase.from("service_steps").select("*").eq("service_record_id", recordId).order("sequence_no", { ascending: true }),
    ]);
    if (recordError || stepError || !record) throw recordError || stepError || new Error("施工記録を確認できませんでした。");
    const existing = new Map(jsonArray(record.selected_options).map((item) => [item.code, item]));
    approvedRows.forEach((row) => {
      const code = row.snapshot?.option_code;
      const option = reservationOptions.find((item) => item.code === code);
      const amount = Number(row.snapshot?.amount_delta ?? option?.amount ?? 0);
      if (code && option && !existing.has(code)) existing.set(code, { code, amount });
    });
    const selectedOptions = [...existing.values()];
    const basePrice = Number(reservationCoursePrices[record.vehicle_size_class]?.[record.course_code] || 0);
    const optionsTotal = selectedOptions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const calculatedTotal = Math.max(0, basePrice + optionsTotal + Number(record.travel_fee || 0) - Number(record.discount_total || 0));
    const previousValues = {
      selected_options: jsonArray(record.selected_options), base_price: record.base_price,
      options_total: record.options_total, calculated_total: record.calculated_total,
      planned_total: record.planned_total, actual_total: record.actual_total,
    };
    const { error: updateError } = await supabase.from("service_records")
      .update({ selected_options: selectedOptions, base_price: basePrice, options_total: optionsTotal, calculated_total: calculatedTotal, planned_total: calculatedTotal, actual_total: calculatedTotal })
      .eq("id", recordId).eq("status", "in_progress");
    if (updateError) throw updateError;

    const existingKeys = new Set((steps || []).map((step) => step.step_key));
    const missing = buildServiceSteps(record.course_code, selectedOptions)
      .filter((step) => step.step_key !== "step_100" && !existingKeys.has(step.step_key))
      .map((step) => ({
        step_key: step.step_key, step_name: step.name, order_group: step.order_group,
        timed: step.timed !== false, skippable: step.skippable !== false,
        snapshot: { ...step, source: "service_change_line" },
      }));
    if (missing.length) {
      const { error: addError } = await supabase.rpc("add_service_confirmation_steps", { p_service_record_id: recordId, p_steps: missing });
      if (addError) {
        await supabase.from("service_records").update(previousValues).eq("id", recordId);
        throw addError;
      }
    }
  };
  const syncConfirmedGroup = async (recordId, rows, groupId) => {
    if (rows.every((row) => row.snapshot?.manager_synced_at)) return false;
    const status = await apiRequest({ action: "status", groupId });
    if (!status.confirmedAt) return false;
    const selections = new Map((status.items || []).map((item) => [item.proposalId, item.selection]));
    const approvedRows = rows.filter((row) => selections.get(row.id) === "approved");
    await applyApprovedAdditions(recordId, approvedRows);
    const syncedAt = new Date().toISOString();
    for (const row of rows) {
      const decision = selections.get(row.id);
      const nextSnapshot = { ...row.snapshot, customer_response: decision, manager_synced_at: syncedAt };
      const values = decision === "approved"
        ? { status: "adopted", customer_decision: "approved" }
        : decision === "declined"
          ? { status: "declined", customer_decision: "declined" }
          : { status: "proposed", customer_decision: "pending" };
      const { error } = await supabase.from("service_proposals")
        .update({ ...values, snapshot: nextSnapshot, customer_confirmed_at: status.confirmedAt })
        .eq("id", row.id).eq("service_record_id", recordId);
      if (error) throw error;
    }
    return true;
  };
  const resolveConsult = async (recordId, row, decision, method) => {
    if (decision === "approved") await applyApprovedAdditions(recordId, [row]);
    const now = new Date().toISOString();
    const snapshot = { ...row.snapshot, customer_response: decision, consultation_method: method || null, consultation_resolved_at: now, manager_synced_at: now };
    const retry = decision === "retry";
    const { error } = await supabase.from("service_proposals").update({
      status: retry ? "resolved" : decision === "approved" ? "adopted" : "declined",
      customer_decision: retry ? "not_required" : decision === "approved" ? "approved" : "declined",
      customer_confirmed_at: now,
      snapshot,
    }).eq("id", row.id).eq("service_record_id", recordId);
    if (error) throw error;
  };

  const renderStatusPanel = (recordId, rows) => {
    document.getElementById("serviceChangeLineStatus")?.remove();
    if (!rows.length) return;
    const activeRows = rows.filter((row) => row.status !== "resolved");
    if (!activeRows.length) return;
    const waitingCount = activeRows.filter(isBlocking).length;
    const section = document.createElement("section");
    section.id = "serviceChangeLineStatus";
    section.className = "card";
    section.innerHTML = `<h2>追加施工のLINE確認</h2><p class="muted">${waitingCount ? `お客様確認：回答待ち ${waitingCount}件` : "お客様確認：回答済み"}</p>${activeRows.map((row) => {
      const consult = row.snapshot?.customer_response === "consult";
      return `<div class="service-timing-correction"><p><strong>${escapeHtml(row.title)}</strong></p><p class="muted">${escapeHtml(proposalStateLabel(row))}</p>${consult ? `<label>確認方法<select data-consult-method="${escapeHtml(row.id)}"><option>LINE</option><option>電話</option><option>対面</option><option>その他</option></select></label><div class="service-confirmation-actions"><button type="button" class="filter-button" data-consult-resolve="approved" data-proposal-id="${escapeHtml(row.id)}">了承で確定</button><button type="button" class="filter-button" data-consult-resolve="declined" data-proposal-id="${escapeHtml(row.id)}">見送りで確定</button><button type="button" class="filter-button" data-consult-resolve="retry" data-proposal-id="${escapeHtml(row.id)}">内容を変更して再確認</button></div>` : ""}</div>`;
    }).join("")}`;
    const anchor = document.querySelector(".detail-card");
    anchor?.insertAdjacentElement("afterend", section);
    section.querySelectorAll("[data-consult-resolve]").forEach((button) => button.addEventListener("click", async () => {
      const row = activeRows.find((item) => item.id === button.dataset.proposalId);
      if (!row) return;
      const method = section.querySelector(`[data-consult-method="${button.dataset.proposalId}"]`)?.value || "LINE";
      const decision = button.dataset.consultResolve;
      const confirmText = decision === "retry" ? "内容を変更して再確認しますか？" : `${decision === "approved" ? "了承" : "見送り"}で確定しますか？`;
      if (!confirm(confirmText)) return;
      button.disabled = true;
      try {
        await resolveConsult(recordId, row, decision, method);
        await renderServiceTimer(recordId);
        if (decision === "retry") document.getElementById("toggleServiceContentEdit")?.click();
      } catch (error) {
        button.disabled = false;
        alert(saveErrorMessage(error));
      }
    }));
  };

  const installStepBlocker = (rows, steps) => {
    const button = document.getElementById("nextServiceStepButton");
    if (!button) return;
    const active = (steps || []).find((step) => step.started_at && !step.ended_at);
    if (!active) return;
    const currentIndex = steps.findIndex((step) => step.id === active.id);
    const next = steps.slice(currentIndex + 1).find((step) => !step.skipped_reason && !step.ended_at) || null;
    button.addEventListener("click", (event) => {
      const blocker = rows.filter(isBlocking).find((row) => {
        const order = Number(row.snapshot?.order_group || 9999);
        return order > Number(active.order_group || 0) && (!next || order <= Number(next.order_group || 9999));
      });
      if (!blocker) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      alert(`お客様回答待ちです。\n「${blocker.title}」の回答後にこの工程へ進めます。`);
    }, true);
  };
  const installComposer = (recordId, record, reservation, rows) => {
    const form = document.getElementById("serviceContentEditForm");
    if (!form || form.dataset.lineProposalInstalled === "1") return;
    form.dataset.lineProposalInstalled = "1";
    const submit = form.querySelector('button[type="submit"]');

    const refresh = () => {
      document.getElementById("serviceChangeLinePreview")?.remove();
      const changes = addedItems(record, form);
      if (!changes.added.length) {
        if (submit) submit.textContent = "施工内容を保存";
        return changes;
      }
      const section = document.createElement("section");
      section.id = "serviceChangeLinePreview";
      section.className = "service-timing-correction";
      if (changes.removed.length || changes.courseChanged) {
        section.innerHTML = '<p class="error">追加施工のLINE確認と、コース変更・既存オプションの解除は分けて操作してください。</p>';
      } else if (changes.needsPrice) {
        section.innerHTML = '<p class="error">「要相談」料金のオプションがあります。予定金額に変更後の金額を入力すると、差額を自動で文面に反映します。</p>';
      } else {
        const message = proposalMessage(changes.added, record.planned_total);
        section.innerHTML = '<p><strong>LINE送信内容</strong></p><p class="muted">項目を選ぶと文面と金額を自動作成します。必要な場合だけ文章を修正できます。</p><textarea id="serviceChangeLineMessage" rows="14"></textarea>';
        section.querySelector("textarea").value = message;
      }
      submit?.insertAdjacentElement("beforebegin", section);
      if (submit) submit.textContent = "LINEで確認を送る";
      return changes;
    };

    form.course_code?.addEventListener("change", refresh);
    form.querySelectorAll('input[name="service_option"]').forEach((input) => input.addEventListener("change", refresh));
    form.planned_total?.addEventListener("input", refresh);
    form.addEventListener("submit", async (event) => {
      const changes = addedItems(record, form);
      if (!changes.added.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (changes.removed.length || changes.courseChanged) {
        return alert("追加施工と、コース変更・既存オプションの解除は分けて操作してください。");
      }
      if (changes.needsPrice) return alert("要相談料金のオプションは、変更後の予定金額を入力してから送信してください。");
      if (rows.some(isBlocking)) return alert("すでに回答待ちの追加施工があります。先にお客様の回答を確認してください。");
      const reservationText = originalReservationText(reservation?.notes);
      if (!record.customer_id && !reservationText) return alert("この予約はLINE送信先と自動紐づけされていないため、追加施工のボタン確認を送信できません。");
      const message = String(document.getElementById("serviceChangeLineMessage")?.value || "").trim();
      if (!message) return;
      if (!confirm("この内容をお客様のLINEへ送信しますか？")) return;

      const groupId = uuid();
      const proposals = changes.added.map((item) => ({ ...item, proposalId: uuid() }));
      const values = proposals.map((item) => ({
        id: item.proposalId,
        service_record_id: recordId,
        title: item.title,
        priority: "recommended",
        status: "proposed",
        source_tag_key: null,
        step_keys: item.stepKeys,
        snapshot: { type: "service_change", group_id: groupId, option_code: item.code, amount_delta: item.amountDelta, reason: item.reason, detail: item.detail, order_group: item.orderGroup },
        customer_decision: "pending",
        customer_confirmed_at: null,
      }));
      if (submit) { submit.disabled = true; submit.textContent = "送信中…"; }
      const { error: insertError } = await supabase.from("service_proposals").insert(values);
      if (insertError) {
        if (submit) { submit.disabled = false; submit.textContent = "LINEで確認を送る"; }
        return alert(saveErrorMessage(insertError));
      }
      try {
        await apiRequest({
          action: "send", customerId: record.customer_id, reservationText, groupId, message,
          baseTotal: Number(record.planned_total || 0),
          items: proposals.map((item) => ({ proposalId: item.proposalId, title: item.title, reason: proposals.length === 1 ? item.detail.replace(/\n/g, " ") : item.reason, amountDelta: item.amountDelta })),
        });
        await renderServiceTimer(recordId);
      } catch (error) {
        for (const row of values) {
          await supabase.from("service_proposals").update({
            status: "resolved", customer_decision: "not_required",
            snapshot: { ...row.snapshot, send_error: error.code || error.message || "line_send_failed" },
          }).eq("id", row.id).eq("service_record_id", recordId);
        }
        if (submit) { submit.disabled = false; submit.textContent = "LINEで確認を送る"; }
        alert(error.code === "reservation_not_linked" ? "この予約はLINE送信先と自動紐づけされていません。" : `LINEを送信できませんでした。（${error.message || error}）`);
      }
    }, true);

    refresh();
  };
  const syncPendingGroups = async (recordId, rows) => {
    const groups = new Map();
    rows.forEach((row) => {
      const groupId = row.snapshot?.group_id;
      if (!groupId || row.snapshot?.manager_synced_at || row.status === "resolved") return;
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push(row);
    });
    for (const [groupId, groupRows] of groups) {
      try {
        if (await syncConfirmedGroup(recordId, groupRows, groupId)) return true;
      } catch (error) {
        console.error("追加施工LINE回答の同期に失敗しました", error);
      }
    }
    return false;
  };

  const poll = async (recordId) => {
    clearTimeout(pollTimer);
    try {
      const rows = await changeRows(recordId);
      const changed = await syncPendingGroups(recordId, rows);
      if (changed) return renderServiceTimer(recordId);
      if (rows.some((row) => !row.snapshot?.manager_synced_at && row.status !== "resolved")) {
        pollTimer = setTimeout(() => poll(recordId), 5000);
      }
    } catch (error) {
      console.error("追加施工LINE回答の確認に失敗しました", error);
    }
  };
  const enhance = async (recordId) => {
    const [{ data: record }, { data: steps }, rows] = await Promise.all([
      supabase.from("service_records").select("*").eq("id", recordId).eq("is_active", true).maybeSingle(),
      supabase.from("service_steps").select("*").eq("service_record_id", recordId).order("sequence_no", { ascending: true }),
      changeRows(recordId),
    ]);
    if (!record || record.status !== "in_progress") return;
    if (await syncPendingGroups(recordId, rows)) return renderServiceTimer(recordId);

    const freshRows = await changeRows(recordId);
    renderStatusPanel(recordId, freshRows);
    installStepBlocker(freshRows, steps || []);

    if (document.getElementById("serviceContentEditForm") && record.reservation_id) {
      const { data: reservation } = await supabase.from("reservations").select("notes").eq("id", record.reservation_id).maybeSingle();
      installComposer(recordId, record, reservation, freshRows);
    }
    if (freshRows.some((row) => !row.snapshot?.manager_synced_at && row.status !== "resolved")) {
      pollTimer = setTimeout(() => poll(recordId), 5000);
    }
  };

  renderServiceTimer = async function(recordId) {
    clearTimeout(pollTimer);
    const result = await baseRenderServiceTimer(recordId);
    if (activeTab === "施工") await enhance(recordId);
    return result;
  };
})();
