(() => {
  const statusLabels = {
    tentative: "仮予約",
    confirmed: "確定",
    completed: "完了",
    cancelled: "キャンセル",
  };

  let scheduled = false;

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

  document.addEventListener("submit", (event) => {
    if (event.target?.id !== "reservationForm") return;
    const select = document.getElementById("reservationStatus");
    if (select?.dataset.autoManagedStatus) select.value = select.dataset.autoManagedStatus;
  }, true);

  const appRoot = document.getElementById("app");
  if (appRoot) new MutationObserver(scheduleApply).observe(appRoot, { childList: true, subtree: true });

  window.RECORDARE_RESERVATION_STATUS = Object.freeze({
    set(status) {
      const select = document.getElementById("reservationStatus");
      if (!select || !statusLabels[status]) return;
      select.dataset.autoManagedStatus = status;
      select.value = status;
      scheduleApply();
    },
  });

  scheduleApply();
})();
