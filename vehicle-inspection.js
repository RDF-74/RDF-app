(function () {
  "use strict";

  const FIELD_ID = "dmInspectionExpiry";
  const SECTION_ID = "dmVehicleInspectionSection";
  const STATUS_ID = "dmInspectionStatus";
  const COMPLETE_BUTTON_ID = "dmInspectionCompleteButton";
  const HOME_ID = "dmInspectionHomeSummary";
  const DAY_MS = 86400000;
  let functionsPatched = false;

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      alert("車検情報を保存できませんでした。端末の空き容量を確認してください。");
      return false;
    }
  }

  function cars() {
    const value = loadJson("cars", []);
    return Array.isArray(value) ? value : [];
  }

  function activeCarId() {
    return String(loadJson("activeCarId", "") || "");
  }

  function validDate(value) {
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }

  function parseLocalDate(value, time = "09:00") {
    const parts = validDate(value).split("-").map(Number);
    if (parts.length !== 3) return null;
    const clock = String(time || "09:00").split(":").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2], clock[0] || 0, clock[1] || 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatDate(value) {
    const date = value instanceof Date ? value : parseLocalDate(value, "00:00");
    if (!date) return "—";
    return date.toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" });
  }

  function subtractMonths(date, months) {
    const targetMonth = date.getMonth() - months;
    const first = new Date(date.getFullYear(), targetMonth, 1, date.getHours(), date.getMinutes(), 0, 0);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    first.setDate(Math.min(date.getDate(), lastDay));
    return first;
  }

  function subtractDays(date, days) {
    return new Date(date.getTime() - days * DAY_MS);
  }

  function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  }

  function daysUntil(value) {
    const date = parseLocalDate(value, "00:00");
    if (!date) return null;
    const today = startOfToday();
    return Math.round((date.getTime() - today.getTime()) / DAY_MS);
  }

  function buildInspectionReminders(inputCars, settings = {}) {
    const output = [];
    const time = /^\d{2}:\d{2}$/.test(settings?.time || "") ? settings.time : "09:00";
    const today = startOfToday().getTime();

    for (const car of Array.isArray(inputCars) ? inputCars : []) {
      const expiryText = validDate(car?.inspectionExpiry);
      const expiry = parseLocalDate(expiryText, time);
      if (!expiry) continue;

      const carName = String(car?.name || "愛車");
      const carId = String(car?.id || carName);
      const expiryLabel = formatDate(expiry);
      const expiryKey = dateKey(expiry);
      const checkpoints = [
        {
          key: "3m",
          scheduledAt: subtractMonths(expiry, 3),
          title: `${carName}の車検まで3か月です`,
          body: `車検満了日は${expiryLabel}です。そろそろ車検の予約を検討してください。`,
        },
        {
          key: "2m",
          scheduledAt: subtractMonths(expiry, 2),
          title: `${carName}は車検を受けられる期間です`,
          body: `車検満了日は${expiryLabel}です。今日から残りの有効期間を失わずに車検を受けられる時期です。`,
        },
        {
          key: "1m",
          scheduledAt: subtractMonths(expiry, 1),
          title: `${carName}の車検まで1か月です`,
          body: `車検満了日は${expiryLabel}です。予約・入庫予定を確認してください。`,
        },
        {
          key: "7d",
          scheduledAt: subtractDays(expiry, 7),
          title: `${carName}の車検満了まであと7日です`,
          body: `車検満了日は${expiryLabel}です。未実施の場合は早めに確認してください。`,
        },
      ];

      for (const checkpoint of checkpoints) {
        if (checkpoint.scheduledAt.getTime() < today) continue;
        output.push({
          id: `inspection-${carId}-${expiryKey}-${checkpoint.key}`,
          kind: "vehicle-inspection",
          title: checkpoint.title,
          body: checkpoint.body,
          scheduledAt: checkpoint.scheduledAt.getTime(),
          dueAt: expiry.getTime(),
          carName,
          tag: `dm-inspection-${carId}-${checkpoint.key}`,
          url: "./#cars",
        });
      }
    }

    return output.sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  function extendNotifications(value) {
    if (!value || typeof value !== "object" || value.__vehicleInspectionExtended) return value;
    const originalBuild = value.buildReminders;
    if (typeof originalBuild !== "function") return value;

    return Object.freeze({
      ...value,
      __vehicleInspectionExtended: true,
      buildReminders(inputCars, settings) {
        const base = originalBuild.call(value, inputCars, settings);
        return [...(Array.isArray(base) ? base : []), ...buildInspectionReminders(inputCars, settings)]
          .sort((a, b) => Number(a?.scheduledAt || 0) - Number(b?.scheduledAt || 0));
      },
    });
  }

  function prepareNotificationExtension() {
    const descriptor = Object.getOwnPropertyDescriptor(window, "DMNotifications");
    if (descriptor?.set) {
      Object.defineProperty(window, "DMNotifications", {
        configurable: true,
        enumerable: true,
        get() {
          return descriptor.get ? descriptor.get.call(window) : undefined;
        },
        set(value) {
          descriptor.set.call(window, extendNotifications(value));
        },
      });
      return;
    }

    if (window.DMNotifications && !window.DMNotifications.__vehicleInspectionExtended) {
      try {
        Object.defineProperty(window, "DMNotifications", {
          configurable: true,
          enumerable: true,
          writable: true,
          value: extendNotifications(window.DMNotifications),
        });
      } catch {}
    }
  }

  function inspectionSection() {
    return document.getElementById(SECTION_ID);
  }

  function ensureFields() {
    if (inspectionSection()) return inspectionSection();
    const maintInput = document.getElementById("maintDays");
    const saveButton = document.getElementById("carSaveButton");
    if (!maintInput || !saveButton) return null;

    const section = document.createElement("div");
    section.id = SECTION_ID;
    section.style.cssText = [
      "margin-top:14px",
      "padding:14px",
      "border:1px solid rgba(127,127,127,.32)",
      "border-radius:16px",
      "background:rgba(127,127,127,.06)",
    ].join(";");
    section.innerHTML = `
      <div style="font-weight:800;margin-bottom:4px">車検管理</div>
      <div style="font-size:.8em;opacity:.7;line-height:1.55;margin-bottom:10px">車検満了日の3か月前・2か月前・1か月前・7日前に通知します。LINE連携済みなら公式LINEにも届きます。</div>
      <label for="${FIELD_ID}" style="display:block;margin:0 0 6px">車検満了日</label>
      <input id="${FIELD_ID}" type="date" style="width:100%;box-sizing:border-box" />
      <div id="${STATUS_ID}" style="font-size:.82em;opacity:.78;line-height:1.55;margin-top:8px">車検満了日は未登録です。</div>
      <button id="${COMPLETE_BUTTON_ID}" type="button" style="display:none;margin-top:10px;width:100%;background:#16212b;color:#fff;border:1px solid #2a3948;border-radius:12px;padding:11px 12px;font:inherit;font-weight:800">車検完了・残りの通知を停止</button>
    `;

    const grid = maintInput.closest(".grid2");
    if (grid) grid.insertAdjacentElement("afterend", section);
    else saveButton.insertAdjacentElement("beforebegin", section);

    document.getElementById(FIELD_ID)?.addEventListener("change", updateInspectionStatus);
    document.getElementById(COMPLETE_BUTTON_ID)?.addEventListener("click", completeInspection);
    updateInspectionStatus();
    return section;
  }

  function currentFormCar() {
    const editId = String(document.getElementById("carEditId")?.value || "").trim();
    const id = editId || activeCarId();
    return cars().find((car) => car.id === id) || null;
  }

  function updateInspectionStatus(car = currentFormCar()) {
    const input = document.getElementById(FIELD_ID);
    const status = document.getElementById(STATUS_ID);
    const completeButton = document.getElementById(COMPLETE_BUTTON_ID);
    if (!input || !status || !completeButton) return;

    const expiry = validDate(input.value || car?.inspectionExpiry);
    if (!expiry) {
      status.textContent = car?.inspectionCompletedAt
        ? "前回の車検は完了済みです。新しい車検証の満了日が分かったら登録してください。"
        : "車検満了日は未登録です。";
      completeButton.style.display = "none";
      return;
    }

    const days = daysUntil(expiry);
    if (days === null) return;
    if (days < 0) status.textContent = `車検満了日：${formatDate(expiry)}（${Math.abs(days)}日超過）`;
    else if (days <= 60) status.textContent = `車検満了日：${formatDate(expiry)}（あと${days}日）・車検を受けられる期間です。`;
    else status.textContent = `車検満了日：${formatDate(expiry)}（あと${days}日）`;
    completeButton.style.display = car?.id ? "block" : "none";
  }

  function fillInspectionField(car) {
    ensureFields();
    const input = document.getElementById(FIELD_ID);
    if (!input) return;
    input.value = validDate(car?.inspectionExpiry);
    updateInspectionStatus(car || null);
  }

  async function syncNotifications(updatedCars) {
    try {
      await window.DMNotifications?.sync?.(updatedCars);
    } catch (error) {
      console.error("Vehicle inspection notification sync failed", error);
    }
  }

  async function completeInspection() {
    const target = currentFormCar();
    if (!target?.id || !validDate(target.inspectionExpiry)) {
      alert("停止する車検通知がありません。");
      return;
    }

    if (!confirm(`${target.name || "この車両"}の今回の車検を完了として、残りの車検通知を停止しますか？`)) return;

    const updated = cars();
    const index = updated.findIndex((car) => car.id === target.id);
    if (index < 0) return;
    const previousExpiry = validDate(updated[index].inspectionExpiry);
    updated[index] = {
      ...updated[index],
      lastInspectionExpiry: previousExpiry,
      inspectionExpiry: "",
      inspectionCompletedAt: new Date().toISOString(),
    };
    if (!saveJson("cars", updated)) return;

    const input = document.getElementById(FIELD_ID);
    if (input) input.value = "";
    updateInspectionStatus(updated[index]);
    updateHomeSummary();
    await syncNotifications(updated);
    alert("今回の車検通知を停止しました。新しい車検満了日が分かったら車両編集から登録してください。");
  }

  function updateHomeSummary() {
    const nextMaint = document.getElementById("nextMaint");
    if (!nextMaint) return;
    const grid = nextMaint.closest(".grid3") || nextMaint.parentElement?.parentElement;
    if (!grid?.parentElement) return;

    let box = document.getElementById(HOME_ID);
    if (!box) {
      box = document.createElement("div");
      box.id = HOME_ID;
      box.style.cssText = "margin-top:10px;padding:12px 14px;border:1px solid #263340;border-radius:16px;background:#0e151d";
      grid.insertAdjacentElement("afterend", box);
    }

    const car = cars().find((item) => item.id === activeCarId()) || cars()[0] || null;
    const expiry = validDate(car?.inspectionExpiry);
    if (!car) {
      box.innerHTML = '<div style="font-size:11px;opacity:.65">車検</div><b>車両未設定</b>';
      return;
    }
    if (!expiry) {
      box.innerHTML = `<div style="font-size:11px;opacity:.65">${escapeHtml(car.name || "愛車")}の車検</div><b>満了日 未登録</b>`;
      return;
    }

    const days = daysUntil(expiry);
    let headline = "";
    if (days < 0) headline = `${Math.abs(days)}日超過`;
    else if (days === 0) headline = "今日が満了日";
    else if (days <= 60) headline = `あと${days}日・車検可能期間`;
    else headline = `あと${days}日`;
    box.innerHTML = `<div style="font-size:11px;opacity:.65">${escapeHtml(car.name || "愛車")}の車検</div><b style="display:block;margin-top:4px">${headline}</b><div style="font-size:12px;opacity:.7;margin-top:3px">満了日 ${formatDate(expiry)}</div>`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function patchFunctions() {
    if (functionsPatched) return true;
    if (typeof window.saveCar !== "function" || typeof window.fillCarForm !== "function" || typeof window.clearCarForm !== "function") return false;
    functionsPatched = true;

    const originalSaveCar = window.saveCar;
    const originalFillCarForm = window.fillCarForm;
    const originalClearCarForm = window.clearCarForm;
    const originalRender = typeof window.render === "function" ? window.render : null;

    window.fillCarForm = function patchedFillCarForm(car) {
      const result = originalFillCarForm.apply(this, arguments);
      fillInspectionField(car);
      return result;
    };

    window.clearCarForm = function patchedClearCarForm() {
      const result = originalClearCarForm.apply(this, arguments);
      fillInspectionField(null);
      return result;
    };

    window.saveCar = async function patchedSaveCar() {
      ensureFields();
      const expiry = validDate(document.getElementById(FIELD_ID)?.value);
      const editIdBeforeSave = String(document.getElementById("carEditId")?.value || "").trim();
      const result = await originalSaveCar.apply(this, arguments);

      const updated = cars();
      const targetId = editIdBeforeSave || activeCarId();
      const index = updated.findIndex((car) => car.id === targetId);
      if (index >= 0) {
        const oldExpiry = validDate(updated[index].inspectionExpiry);
        updated[index] = {
          ...updated[index],
          inspectionExpiry: expiry,
          inspectionCompletedAt: expiry && expiry !== oldExpiry ? null : updated[index].inspectionCompletedAt || null,
        };
        if (saveJson("cars", updated)) {
          fillInspectionField(updated[index]);
          updateHomeSummary();
          await syncNotifications(updated);
        }
      }
      return result;
    };

    if (originalRender) {
      window.render = function patchedRender() {
        const result = originalRender.apply(this, arguments);
        ensureFields();
        updateHomeSummary();
        const car = currentFormCar();
        if (document.getElementById("carEditId")?.value) fillInspectionField(car);
        return result;
      };
    }
    return true;
  }

  function initUi() {
    ensureFields();
    updateHomeSummary();
    if (!patchFunctions()) {
      const timer = setInterval(() => {
        ensureFields();
        if (patchFunctions()) {
          clearInterval(timer);
          updateHomeSummary();
        }
      }, 80);
      setTimeout(() => clearInterval(timer), 12000);
    }

    const observer = new MutationObserver(() => {
      ensureFields();
      updateHomeSummary();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.DMVehicleInspection = Object.freeze({
    buildReminders: buildInspectionReminders,
    refresh: updateHomeSummary,
  });

  prepareNotificationExtension();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initUi, { once: true });
  else initUi();
})();
