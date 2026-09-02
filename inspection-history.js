(function () {
  "use strict";

  const SECTION_ID = "dmVehicleInspectionSection";
  const COMPLETE_BUTTON_ID = "dmInspectionCompleteButton";
  const PANEL_ID = "dmInspectionCompletionPanel";
  const HISTORY_ID = "dmInspectionHistoryList";
  const FIELD_ID = "dmInspectionExpiry";
  let observerQueued = false;

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
      alert("車検履歴を保存できませんでした。端末の空き容量を確認してください。");
      return false;
    }
  }

  function getCars() {
    const value = loadJson("cars", []);
    return Array.isArray(value) ? value : [];
  }

  function activeCarId() {
    return String(loadJson("activeCarId", "") || "");
  }

  function currentCar() {
    const editId = String(document.getElementById("carEditId")?.value || "").trim();
    const id = editId || activeCarId();
    return getCars().find((car) => car.id === id) || null;
  }

  function validDate(value) {
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function formatDate(value) {
    const text = validDate(value);
    if (!text) return "—";
    const [year, month, day] = text.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
  }

  function yen(value) {
    const amount = Number(value || 0);
    return amount > 0 ? `${amount.toLocaleString("ja-JP")}円` : "未入力";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function historyOf(car) {
    return Array.isArray(car?.inspectionHistory) ? car.inspectionHistory : [];
  }

  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = "display:none;margin-top:12px;padding:12px;border:1px solid rgba(127,127,127,.3);border-radius:14px;background:rgba(127,127,127,.07)";
    panel.innerHTML = `
      <div style="font-weight:800;margin-bottom:10px">今回の車検を記録</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label style="display:block;font-size:.82em">車検実施日
          <input id="dmInspectionPerformedDate" type="date" style="width:100%;box-sizing:border-box;margin-top:5px" />
        </label>
        <label style="display:block;font-size:.82em">車検費用
          <input id="dmInspectionCost" type="number" min="0" step="1" inputmode="numeric" placeholder="例 98000" style="width:100%;box-sizing:border-box;margin-top:5px" />
        </label>
      </div>
      <label style="display:block;font-size:.82em;margin-top:10px">交換部品・メモ
        <textarea id="dmInspectionParts" rows="3" placeholder="例：ブレーキフルード、ワイパー交換" style="width:100%;box-sizing:border-box;margin-top:5px;resize:vertical"></textarea>
      </label>
      <label style="display:block;font-size:.82em;margin-top:10px">次回車検満了日 <span style="opacity:.65">（分かれば入力）</span>
        <input id="dmInspectionNextExpiry" type="date" style="width:100%;box-sizing:border-box;margin-top:5px" />
      </label>
      <div style="font-size:.76em;opacity:.68;line-height:1.5;margin-top:7px">次回満了日を入れると、今回分の残り通知を停止して次回の車検通知へ自動で切り替えます。</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
        <button id="dmInspectionCompletionCancel" type="button" style="border:1px solid rgba(127,127,127,.35);border-radius:11px;padding:10px;background:transparent;color:inherit;font:inherit;font-weight:700">キャンセル</button>
        <button id="dmInspectionCompletionSave" type="button" style="border:0;border-radius:11px;padding:10px;background:#1677ff;color:#fff;font:inherit;font-weight:800">車検完了を保存</button>
      </div>
    `;
    return panel;
  }

  function historyMarkup(car) {
    const history = historyOf(car).slice().sort((a, b) => String(b?.performedDate || b?.createdAt || "").localeCompare(String(a?.performedDate || a?.createdAt || "")));
    if (!history.length) {
      return '<div style="font-size:.8em;opacity:.65;padding:8px 0">まだ車検履歴はありません。</div>';
    }

    return history.slice(0, 8).map((item) => `
      <div style="padding:10px 0;border-top:1px solid rgba(127,127,127,.18)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <b>${escapeHtml(formatDate(item.performedDate))}</b>
          <span style="font-size:.78em;opacity:.72">${escapeHtml(yen(item.cost))}</span>
        </div>
        <div style="font-size:.78em;opacity:.72;margin-top:4px">前回満了日：${escapeHtml(formatDate(item.previousExpiry))}</div>
        ${validDate(item.nextExpiry) ? `<div style="font-size:.78em;opacity:.72;margin-top:2px">次回満了日：${escapeHtml(formatDate(item.nextExpiry))}</div>` : ""}
        ${String(item.parts || "").trim() ? `<div style="font-size:.8em;line-height:1.5;margin-top:6px">${escapeHtml(item.parts)}</div>` : ""}
      </div>
    `).join("");
  }

  function renderHistory() {
    const list = document.getElementById(HISTORY_ID);
    if (!list) return;
    const car = currentCar();
    const markup = historyMarkup(car);
    if (list.dataset.markup === markup) return;
    list.dataset.markup = markup;
    list.innerHTML = markup;
  }

  function openCompletionPanel() {
    const car = currentCar();
    if (!car?.id || !validDate(car.inspectionExpiry)) {
      alert("先にこの車両の車検満了日を登録してください。");
      return;
    }
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const performed = document.getElementById("dmInspectionPerformedDate");
    const nextExpiry = document.getElementById("dmInspectionNextExpiry");
    const cost = document.getElementById("dmInspectionCost");
    const parts = document.getElementById("dmInspectionParts");
    if (performed) performed.value = todayKey();
    if (nextExpiry) nextExpiry.value = "";
    if (cost) cost.value = "";
    if (parts) parts.value = "";
    panel.style.display = "block";
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeCompletionPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.style.display = "none";
  }

  async function syncNotifications(updatedCars) {
    try {
      await window.DMNotifications?.sync?.(updatedCars);
    } catch (error) {
      console.error("Vehicle inspection history sync failed", error);
    }
  }

  async function saveCompletion() {
    const target = currentCar();
    if (!target?.id || !validDate(target.inspectionExpiry)) {
      alert("保存する車検情報が見つかりませんでした。");
      return;
    }

    const performedDate = validDate(document.getElementById("dmInspectionPerformedDate")?.value) || todayKey();
    const nextExpiry = validDate(document.getElementById("dmInspectionNextExpiry")?.value);
    const costRaw = Number(document.getElementById("dmInspectionCost")?.value || 0);
    const cost = Number.isFinite(costRaw) && costRaw > 0 ? Math.round(costRaw) : null;
    const parts = String(document.getElementById("dmInspectionParts")?.value || "").trim().slice(0, 1000);

    if (nextExpiry && nextExpiry <= performedDate) {
      alert("次回車検満了日は車検実施日より後の日付を入力してください。");
      return;
    }

    const updatedCars = getCars();
    const index = updatedCars.findIndex((car) => car.id === target.id);
    if (index < 0) return;
    const previousExpiry = validDate(updatedCars[index].inspectionExpiry);
    const history = historyOf(updatedCars[index]).slice();
    history.push({
      id: `inspection-history-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      performedDate,
      previousExpiry,
      cost,
      parts,
      nextExpiry,
      createdAt: new Date().toISOString(),
    });

    updatedCars[index] = {
      ...updatedCars[index],
      lastInspectionExpiry: previousExpiry,
      inspectionExpiry: nextExpiry,
      inspectionCompletedAt: new Date().toISOString(),
      inspectionHistory: history.slice(-20),
    };

    if (!saveJson("cars", updatedCars)) return;

    const expiryInput = document.getElementById(FIELD_ID);
    if (expiryInput) {
      expiryInput.value = nextExpiry;
      expiryInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closeCompletionPanel();
    renderHistory();
    await syncNotifications(updatedCars);
    window.DMVehicleInspection?.refresh?.();
    window.dispatchEvent(new CustomEvent("dm-inspection-updated", { detail: { carId: target.id } }));

    alert(nextExpiry
      ? "車検履歴を保存し、次回満了日の通知へ切り替えました。"
      : "車検履歴を保存し、今回分の残り通知を停止しました。次回満了日は後から登録できます。");
  }

  function enhanceSection() {
    const section = document.getElementById(SECTION_ID);
    if (!section) return false;

    let button = document.getElementById(COMPLETE_BUTTON_ID);
    if (button && !button.dataset.historyEnhanced) {
      const replacement = button.cloneNode(true);
      replacement.dataset.historyEnhanced = "1";
      replacement.textContent = "車検完了を記録";
      button.replaceWith(replacement);
      replacement.addEventListener("click", openCompletionPanel);
      button = replacement;
    }

    if (!document.getElementById(PANEL_ID)) {
      const panel = buildPanel();
      button?.insertAdjacentElement("afterend", panel);
      document.getElementById("dmInspectionCompletionCancel")?.addEventListener("click", closeCompletionPanel);
      document.getElementById("dmInspectionCompletionSave")?.addEventListener("click", saveCompletion);
    }

    if (!document.getElementById(HISTORY_ID)) {
      const wrap = document.createElement("details");
      wrap.style.cssText = "margin-top:14px";
      wrap.innerHTML = `
        <summary style="cursor:pointer;font-weight:800">車検履歴</summary>
        <div id="${HISTORY_ID}" style="margin-top:8px"></div>
      `;
      section.appendChild(wrap);
    }

    renderHistory();
    return true;
  }

  function scheduleRefresh() {
    if (observerQueued) return;
    observerQueued = true;
    requestAnimationFrame(() => {
      observerQueued = false;
      enhanceSection();
      renderHistory();
    });
  }

  function init() {
    if (!enhanceSection()) {
      const timer = setInterval(() => {
        if (enhanceSection()) clearInterval(timer);
      }, 100);
      setTimeout(() => clearInterval(timer), 12000);
    }
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("dm-inspection-updated", scheduleRefresh);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
