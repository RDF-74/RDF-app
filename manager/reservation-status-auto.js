(() => {
  const statusLabels = {
    tentative: "仮予約",
    confirmed: "確定",
    completed: "完了",
    cancelled: "キャンセル",
  };

  let scheduled = false;
  let activeReservation = null;

  const applyAutoStatus = () => {
    const form = document.getElementById("reservationForm");
    const select = document.getElementById("reservationStatus");
    if (!form || !select) return;

    if (!select.dataset.autoManagedStatus) {
      const isNewReservation = form.querySelector("h2")?.textContent?.includes("新規予約");
      if (isNewReservation) select.value = "tentative";
      select.dataset.autoManagedStatus = select.value || "tentative";
    }

    select.value = select.dataset.autoManagedStatus;
    select.hidden = true;
    const label = form.querySelector('label[for="reservationStatus"]');
    if (label) label.hidden = true;

    let display = document.getElementById("reservationStatusAutoDisplay");
    if (!display) {
      display = document.createElement("p");
      display.id = "reservationStatusAutoDisplay";
      display.className = "muted";
      select.insertAdjacentElement("afterend", display);
    }
    const labelText = statusLabels[select.dataset.autoManagedStatus] || select.dataset.autoManagedStatus;
    const nextText = `予約状態：${labelText}（自動管理）`;
    if (display.textContent !== nextText) display.textContent = nextText;
  };

  const scheduleApply = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      applyAutoStatus();
    });
  };

  const setDisplayedStatus = (status) => {
    const select = document.getElementById("reservationStatus");
    if (!select || !statusLabels[status]) return;
    select.dataset.autoManagedStatus = status;
    select.value = status;
    scheduleApply();
  };

  const baseReservationFormForAutoStatus = renderReservationForm;
  renderReservationForm = async function(...args) {
    activeReservation = args[0] || null;
    const result = await baseReservationFormForAutoStatus(...args);
    scheduleApply();
    return result;
  };

  document.addEventListener("submit", (event) => {
    if (event.target?.id !== "reservationForm") return;
    const select = document.getElementById("reservationStatus");
    if (select?.dataset.autoManagedStatus) select.value = select.dataset.autoManagedStatus;
  }, true);

  document.addEventListener("click", (event) => {
    if (event.target?.id !== "sendReservationConfirmationLine" || !activeReservation?.id) return;
    const sendStatus = document.getElementById("reservationConfirmationStatus");
    if (!sendStatus) return;

    let finished = false;
    const observer = new MutationObserver(async () => {
      if (finished || sendStatus.textContent !== "予約確定LINEを送信しました。") return;
      finished = true;
      observer.disconnect();

      if (["completed", "cancelled"].includes(activeReservation.status)) return;
      if (activeReservation.status === "tentative") {
        const { error } = await supabase.from("reservations")
          .update({ status: "confirmed" })
          .eq("id", activeReservation.id)
          .eq("status", "tentative");
        if (error) {
          const errorTarget = document.getElementById("reservationConfirmationError");
          if (errorTarget) {
            errorTarget.textContent = "LINEは送信済みですが、予約状態を「確定」に更新できませんでした。画面を開き直して状態を確認してください。";
            errorTarget.classList.remove("hidden");
          }
          return;
        }
      }

      activeReservation.status = "confirmed";
      setDisplayedStatus("confirmed");
      sendStatus.textContent = "予約確定LINEを送信しました。予約状態を「確定」に更新しました。";
    });

    observer.observe(sendStatus, { childList: true, characterData: true, subtree: true });
    setTimeout(() => observer.disconnect(), 30000);
  }, true);

  const appRoot = document.getElementById("app");
  if (appRoot) new MutationObserver(scheduleApply).observe(appRoot, { childList: true, subtree: true });

  window.RECORDARE_RESERVATION_STATUS = Object.freeze({ set: setDisplayedStatus });
  scheduleApply();
})();
