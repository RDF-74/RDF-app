(function () {
  "use strict";

  const DASHBOARD_ID = "dmUpcomingDashboard";
  const DAY_MS = 86400000;
  let queued = false;

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function getCars() {
    const value = loadJson("cars", []);
    return Array.isArray(value) ? value : [];
  }

  function validDate(value) {
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }

  function parseDate(value) {
    const text = validDate(value);
    if (!text) return null;
    const [year, month, day] = text.split("-").map(Number);
    const date = new Date(year, month - 1, day, 0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(value, days) {
    const date = value instanceof Date ? new Date(value.getTime()) : parseDate(value);
    if (!date) return null;
    date.setDate(date.getDate() + Number(days || 0));
    return date;
  }

  function dateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function serial(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
  }

  function daysFromToday(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round(serial(date) - serial(today));
  }

  function formatDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function buildItems() {
    const items = [];
    for (const car of getCars()) {
      const carName = String(car?.name || "愛車");
      const carId = String(car?.id || carName);

      const inspection = parseDate(car?.inspectionExpiry);
      if (inspection) {
        items.push({
          id: `inspection-${carId}-${dateKey(inspection)}`,
          type: "inspection",
          typeLabel: "車検",
          carName,
          target: inspection,
          days: daysFromToday(inspection),
          detail: "車検満了日",
        });
      }

      const coatedAt = parseDate(car?.coatDate);
      const cycle = Number(car?.maintDays || 0);
      if (coatedAt && Number.isFinite(cycle) && cycle > 0) {
        const maintenance = addDays(coatedAt, cycle);
        items.push({
          id: `coating-${carId}-${dateKey(maintenance)}`,
          type: "coating",
          typeLabel: "コーティング",
          carName,
          target: maintenance,
          days: daysFromToday(maintenance),
          detail: "メンテ目安",
        });
      }
    }
    return items.sort((a, b) => a.days - b.days || a.carName.localeCompare(b.carName, "ja"));
  }

  function urgencyText(days) {
    if (days < 0) return `${Math.abs(days)}日超過`;
    if (days === 0) return "今日";
    if (days <= 7) return `あと${days}日`;
    if (days <= 30) return `あと${days}日`;
    return `あと${days}日`;
  }

  function urgencyStyle(days) {
    if (days < 0) return "background:rgba(255,80,80,.15);border-color:rgba(255,80,80,.4)";
    if (days <= 7) return "background:rgba(255,170,60,.14);border-color:rgba(255,170,60,.38)";
    if (days <= 30) return "background:rgba(90,160,255,.12);border-color:rgba(90,160,255,.32)";
    return "background:rgba(127,127,127,.06);border-color:rgba(127,127,127,.2)";
  }

  function itemMarkup(item) {
    return `
      <div style="padding:11px 12px;border:1px solid;border-radius:13px;${urgencyStyle(item.days)}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
              <span style="font-size:10px;font-weight:800;letter-spacing:.04em;padding:3px 7px;border-radius:999px;background:rgba(127,127,127,.18)">${escapeHtml(item.typeLabel)}</span>
              <b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.carName)}</b>
            </div>
            <div style="font-size:11px;opacity:.66;margin-top:5px">${escapeHtml(item.detail)} ${escapeHtml(formatDate(item.target))}</div>
          </div>
          <b style="white-space:nowrap;font-size:13px">${escapeHtml(urgencyText(item.days))}</b>
        </div>
      </div>
    `;
  }

  function dashboardMarkup() {
    const cars = getCars();
    const items = buildItems();
    const overdue = items.filter((item) => item.days < 0).length;
    const within30 = items.filter((item) => item.days >= 0 && item.days <= 30).length;
    const inspectionMissing = cars.filter((car) => !validDate(car?.inspectionExpiry)).length;
    const visible = items.slice(0, 8);
    const remaining = Math.max(0, items.length - visible.length);

    return `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div>
          <div style="font-size:15px;font-weight:900">これからの予定</div>
          <div style="font-size:11px;opacity:.65;margin-top:3px">全車両の車検とコーティングメンテを期限順に表示</div>
        </div>
        <span style="font-size:11px;font-weight:800;padding:4px 8px;border-radius:999px;background:rgba(127,127,127,.14)">${items.length}件</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px">
        <div style="padding:9px;border-radius:11px;background:rgba(127,127,127,.07);text-align:center"><b style="display:block;font-size:16px">${overdue}</b><span style="font-size:10px;opacity:.65">期限超過</span></div>
        <div style="padding:9px;border-radius:11px;background:rgba(127,127,127,.07);text-align:center"><b style="display:block;font-size:16px">${within30}</b><span style="font-size:10px;opacity:.65">30日以内</span></div>
        <div style="padding:9px;border-radius:11px;background:rgba(127,127,127,.07);text-align:center"><b style="display:block;font-size:16px">${cars.length}</b><span style="font-size:10px;opacity:.65">登録車両</span></div>
      </div>
      <div style="display:grid;gap:8px;margin-top:12px">
        ${visible.length ? visible.map(itemMarkup).join("") : '<div style="padding:12px 0;font-size:12px;opacity:.65">予定を表示するには、車検満了日またはコーティング日・メンテ周期を登録してください。</div>'}
      </div>
      ${remaining ? `<div style="font-size:11px;opacity:.6;margin-top:9px">ほか${remaining}件の予定があります。</div>` : ""}
      ${inspectionMissing ? `<div style="font-size:11px;opacity:.62;margin-top:9px">車検満了日が未登録の車両：${inspectionMissing}台</div>` : ""}
    `;
  }

  function anchor() {
    return document.getElementById("dmInspectionHomeSummary") || document.getElementById("nextMaint")?.closest(".grid3") || document.getElementById("nextMaint")?.parentElement;
  }

  function render() {
    const target = anchor();
    if (!target?.parentElement) return false;
    let box = document.getElementById(DASHBOARD_ID);
    if (!box) {
      box = document.createElement("section");
      box.id = DASHBOARD_ID;
      box.style.cssText = "margin-top:12px;padding:14px;border:1px solid #263340;border-radius:17px;background:#0e151d";
      target.insertAdjacentElement("afterend", box);
    }
    const markup = dashboardMarkup();
    if (box.dataset.markup === markup) return true;
    box.dataset.markup = markup;
    box.innerHTML = markup;
    return true;
  }

  function scheduleRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  }

  function init() {
    if (!render()) {
      const timer = setInterval(() => {
        if (render()) clearInterval(timer);
      }, 100);
      setTimeout(() => clearInterval(timer), 12000);
    }
    const observer = new MutationObserver(scheduleRender);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("dm-inspection-updated", scheduleRender);
  }

  window.DMHomeDashboard = Object.freeze({ refresh: render, buildItems });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
