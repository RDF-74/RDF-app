(() => {
  const API_URL = "https://recordare-line-webhook.vercel.app/api/reservation-confirmation";
  const markerPattern = /LINE仮予約ID:([a-f0-9]{16,64})/i;
  const baseReservationListForLineRequests = renderReservationList;

  const apiPost = async (payload) => {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error("Managerのログイン情報を確認できませんでした。");
    const config = window.RECORDARE_SUPABASE_CONFIG || {};
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...payload,
        lineReservationRequest: true,
        supabaseUrl: config.url,
        anonKey: config.anonKey,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) throw new Error(result?.error || `仮予約連携エラー (${response.status})`);
    return result;
  };

  const requestIdFromNotes = (notes) => {
    const match = String(notes || "").match(markerPattern);
    return match?.[1] || "";
  };

  const ageHours = (receivedAt) => {
    const time = new Date(receivedAt).getTime();
    return Number.isFinite(time) ? (Date.now() - time) / 3600000 : 0;
  };

  const requestStatus = (request) => {
    if (request.conflict) return "⚠ 時間重複あり";
    if (ageHours(request.receivedAt) >= 24) return "⚠ 確認待ち24時間超";
    if (!request.holdCreated) return "⚠ 枠確保要確認";
    return "仮予約・確認待ち";
  };

  const requestSummary = (request) => {
    const date = request.date || "日付確認中";
    const time = request.time || "時間確認中";
    const customer = request.customerName || request.lineDisplayName || "お客様名確認中";
    const car = request.car || "車種確認中";
    const menu = request.menuLabel || "メニュー確認中";
    return { date, time, customer, car, menu };
  };

  const openRequest = async (request) => {
    const open = window.RECORDARE_RESERVATION_IMPORT?.open;
    if (!open) return alert("予約取込画面を開けませんでした。");
    await open(request.reservationText, {
      requestId: request.id,
      lineDisplayName: request.lineDisplayName || "",
    });
  };

  const dismissRequest = async (request) => {
    if (!confirm(`${request.customerName || "このお客様"}の仮予約を見送り、確保した枠を解放しますか？`)) return;
    try {
      await apiPost({ action: "dismiss", requestId: request.id });
      await renderReservationList();
    } catch (error) {
      alert(error?.message || String(error));
    }
  };

  const insertPendingPanel = (requests) => {
    document.getElementById("lineReservationRequestPanel")?.remove();
    if (!requests.length) return;

    const anchor = document.getElementById("reservationApplicationButton")
      || document.getElementById("newReservationButton");
    if (!anchor) return;

    const overdue = requests.filter((request) => ageHours(request.receivedAt) >= 24).length;
    const panel = document.createElement("section");
    panel.id = "lineReservationRequestPanel";
    panel.className = "card";
    panel.style.margin = "12px 0";
    const warning = overdue
      ? `<p class="error">⚠ 24時間以上確認待ちの仮予約が${overdue}件あります。</p>`
      : "";
    panel.innerHTML = `<h3>LINE仮予約・確認待ち（${requests.length}件）</h3>${warning}<div id="lineReservationRequestRows"></div>`;
    anchor.insertAdjacentElement("afterend", panel);

    const rows = panel.querySelector("#lineReservationRequestRows");
    requests.forEach((request) => {
      const summary = requestSummary(request);
      const wrap = document.createElement("div");
      wrap.className = "card";
      wrap.style.margin = "10px 0";
      wrap.innerHTML = `<button class="reservation-row" type="button" data-open-line-request="${escapeHtml(request.id)}"><span><strong>${escapeHtml(summary.date)} ${escapeHtml(summary.time)}</strong><small>${escapeHtml(summary.customer)} ・ ${escapeHtml(summary.car)}</small><small>${escapeHtml(summary.menu)}</small></span><span class="reservation-status">${escapeHtml(requestStatus(request))}</span></button><button class="text-button danger-text" type="button" data-dismiss-line-request="${escapeHtml(request.id)}">見送り・枠を解放</button>`;
      rows.appendChild(wrap);
    });

    panel.querySelectorAll("[data-open-line-request]").forEach((button) => {
      button.addEventListener("click", () => openRequest(requests.find((item) => item.id === button.dataset.openLineRequest)));
    });
    panel.querySelectorAll("[data-dismiss-line-request]").forEach((button) => {
      button.addEventListener("click", () => {
        const request = requests.find((item) => item.id === button.dataset.dismissLineRequest);
        if (request) dismissRequest(request);
      });
    });
  };

  renderReservationList = async function(...args) {
    const result = await baseReservationListForLineRequests(...args);
    if (activeTab !== "予約" || !document.getElementById("newReservationButton")) return result;
    try {
      const payload = await apiPost({ action: "list" });
      if (activeTab === "予約" && document.getElementById("newReservationButton")) {
        insertPendingPanel(Array.isArray(payload.requests) ? payload.requests : []);
      }
    } catch (error) {
      console.error("LINE仮予約一覧の取得に失敗しました", error);
    }
    return result;
  };

  const afterReservationSaved = async (reservationId, values) => {
    const requestId = requestIdFromNotes(values?.notes);
    if (!requestId || !reservationId) return;
    try {
      await apiPost({ action: "mark_converted", requestId, reservationId });
    } catch (error) {
      console.error("LINE仮予約の変換記録に失敗しました", error);
    }
  };

  const afterReservationResolved = async (reservationId, resolution) => {
    if (!reservationId) return;
    try {
      await apiPost({
        action: "resolve_reservation",
        reservationId,
        resolution: resolution || "confirmed",
      });
    } catch (error) {
      console.error("LINE仮予約の枠解放に失敗しました", error);
    }
  };

  window.RECORDARE_LINE_RESERVATION_REQUESTS = Object.freeze({
    afterReservationSaved,
    afterReservationResolved,
  });

  setInterval(() => {
    if (activeTab === "予約" && document.visibilityState === "visible" && document.getElementById("newReservationButton")) {
      renderReservationList();
    }
  }, 30000);
})();
