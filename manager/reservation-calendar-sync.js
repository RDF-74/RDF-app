(() => {
  const API_BASE = "https://recordare-line-webhook.vercel.app";
  const baseReservationFormForCalendarSync = renderReservationForm;
  let activeReservationId = null;

  const relationOne = (value) => Array.isArray(value) ? value[0] : value;

  const fetchReservationForCalendar = async (reservationId) => {
    const { data, error } = await supabase.from("reservations")
      .select("id,reservation_date,start_time,planned_prep_minutes,planned_service_minutes,planned_cleanup_minutes,planned_slot_minutes,course_code,final_total,customers(name),customer_vehicles(manufacturer,model,color)")
      .eq("id", reservationId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error("予約情報を取得できませんでした。");
    return data;
  };

  const calendarPayload = async (reservationId, action) => {
    if (action === "delete") return { reservationId, action };

    const reservation = await fetchReservationForCalendar(reservationId);
    const customer = relationOne(reservation.customers);
    const vehicle = relationOne(reservation.customer_vehicles);
    const date = String(reservation.reservation_date || "").trim();
    const time = String(reservation.start_time || "").slice(0, 5);
    if (!date || !time) throw new Error("予約日時を確認できませんでした。");

    const start = new Date(`${date}T${time}:00+09:00`);
    if (Number.isNaN(start.getTime())) throw new Error("予約日時を読み取れませんでした。");

    const plannedMinutes = Number(reservation.planned_slot_minutes || 0)
      || Number(reservation.planned_prep_minutes || 0)
        + Number(reservation.planned_service_minutes || 0)
        + Number(reservation.planned_cleanup_minutes || 0)
      || Number(reservation.planned_service_minutes || 0)
      || 120;
    const end = new Date(start.getTime() + plannedMinutes * 60 * 1000);

    const customerName = String(customer?.name || "お客様").trim();
    const vehicleName = [vehicle?.manufacturer, vehicle?.model, vehicle?.color].filter(Boolean).join(" ");
    const course = reservationCourses[reservation.course_code] || reservation.course_code || "未設定";
    const total = reservation.final_total == null
      ? "確認中"
      : `¥${Number(reservation.final_total).toLocaleString("ja-JP")}`;

    return {
      reservationId,
      action,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      title: `RE:CORDARE｜${customerName}様${vehicle?.model ? ` ${vehicle.model}` : ""}`,
      description: [
        `顧客：${customerName}様`,
        `車両：${vehicleName || "確認中"}`,
        `コース：${course}`,
        `予定金額：${total}`,
      ].join("\n"),
      location: "",
    };
  };

  const syncCalendar = async (reservationId, action) => {
    if (!reservationId) return;
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error("Managerのログイン情報を確認できませんでした。");

    const config = window.RECORDARE_SUPABASE_CONFIG || {};
    const body = await calendarPayload(reservationId, action);
    const response = await fetch(`${API_BASE}/api/google-calendar-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...body,
        supabaseUrl: config.url,
        anonKey: config.anonKey,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Googleカレンダー連携エラー (${response.status})`);
    }
    return payload;
  };

  const syncStatusElement = (element, action, errorId) => {
    if (!element || !activeReservationId) return;
    if (["pending", "done", "failed"].includes(element.dataset.calendarSyncState || "")) return;
    element.dataset.calendarSyncState = "pending";
    syncCalendar(activeReservationId, action)
      .then(() => {
        element.dataset.calendarSyncState = "done";
      })
      .catch((error) => {
        element.dataset.calendarSyncState = "failed";
        const errorTarget = document.getElementById(errorId);
        if (!errorTarget) return;
        errorTarget.textContent = `予約処理は完了しましたが、Googleカレンダーへ反映できませんでした。（${error?.message || error}）`;
        errorTarget.classList.remove("hidden");
      });
  };

  const scanForCompletedReservationActions = () => {
    if (!activeReservationId) return;

    const confirmation = document.getElementById("reservationConfirmationStatus");
    if (confirmation?.textContent?.includes("予約状態を「確定」に更新しました")) {
      syncStatusElement(confirmation, "upsert", "reservationConfirmationError");
    }

    const change = document.getElementById("reservationChangeLineStatus");
    if (change?.textContent?.includes("変更履歴に記録しました")) {
      syncStatusElement(change, "upsert", "reservationChangeLineError");
    }

    const cancellation = document.getElementById("reservationCancellationStatus");
    if (cancellation?.textContent?.includes("予約状態を「キャンセル」に更新しました")) {
      syncStatusElement(cancellation, "delete", "reservationCancellationError");
    }
  };

  renderReservationForm = async function(...args) {
    activeReservationId = args[0]?.id || null;
    const result = await baseReservationFormForCalendarSync(...args);
    queueMicrotask(scanForCompletedReservationActions);
    return result;
  };

  const appRoot = document.getElementById("app");
  if (appRoot) {
    new MutationObserver(scanForCompletedReservationActions)
      .observe(appRoot, { childList: true, characterData: true, subtree: true });
  }

  window.RECORDARE_CALENDAR_SYNC = Object.freeze({
    upsert: (reservationId) => syncCalendar(reservationId, "upsert"),
    remove: (reservationId) => syncCalendar(reservationId, "delete"),
  });
})();
