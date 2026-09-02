(function () {
  "use strict";

  const API_BASE = "https://recordare-line-webhook.vercel.app";
  const DEVICE_ID_KEY = "dmLineDeviceId";
  const DEVICE_TOKEN_KEY = "dmLineDeviceToken";
  const LINKED_AT_KEY = "dmLineLinkedAt";
  const LOCAL_DEVICE_ID_KEY = "dmLineLocalDeviceId";
  const PANEL_ID = "dmLineNotificationPanel";

  let lastCars = [];
  let installed = false;
  let baseNotifications = null;

  function credentials() {
    return {
      deviceId: String(localStorage.getItem(DEVICE_ID_KEY) || "").trim(),
      deviceToken: String(localStorage.getItem(DEVICE_TOKEN_KEY) || "").trim(),
      linkedAt: String(localStorage.getItem(LINKED_AT_KEY) || "").trim(),
    };
  }

  function isLinked() {
    const value = credentials();
    return Boolean(value.deviceId && value.deviceToken);
  }

  function saveCredentials(payload) {
    localStorage.setItem(DEVICE_ID_KEY, payload.deviceId);
    localStorage.setItem(DEVICE_TOKEN_KEY, payload.deviceToken);
    localStorage.setItem(LINKED_AT_KEY, payload.linkedAt || new Date().toISOString());
  }

  function clearCredentials() {
    localStorage.removeItem(DEVICE_ID_KEY);
    localStorage.removeItem(DEVICE_TOKEN_KEY);
    localStorage.removeItem(LINKED_AT_KEY);
  }

  function localDeviceId() {
    let value = String(localStorage.getItem(LOCAL_DEVICE_ID_KEY) || "").trim();
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
      value = `dmline-${crypto.randomUUID()}`;
      localStorage.setItem(LOCAL_DEVICE_ID_KEY, value);
    }
    return value;
  }

  function dateKey(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function lineApi(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `LINE通知サーバーエラー (${response.status})`);
      error.code = payload.error || "server_error";
      throw error;
    }
    return payload;
  }

  function errorMessage(error) {
    switch (error?.code) {
      case "code_not_found":
        return "連携コードが見つかりません。公式LINEで「通知連携」と送って、新しいコードを取得してください。";
      case "code_expired":
        return "連携コードの有効期限が切れました。公式LINEで「通知連携」と送って、新しいコードを取得してください。";
      case "code_already_used":
        return "この連携コードは使用済みです。新しいコードを取得してください。";
      case "invalid_token":
      case "device_not_linked":
        clearCredentials();
        return "LINE連携情報が無効になりました。もう一度連携してください。";
      default:
        return error?.message || "LINE通知の処理に失敗しました。";
    }
  }

  function lineNotifications(cars) {
    if (!baseNotifications?.buildReminders) return [];
    const settings = baseNotifications.getSettings?.();
    return baseNotifications
      .buildReminders(Array.isArray(cars) ? cars : [], settings)
      .map((reminder) => {
        const notificationDate = dateKey(reminder.scheduledAt);
        const targetDate = dateKey(reminder.dueAt);
        if (!notificationDate || !targetDate) return null;
        return {
          id: reminder.id || `${reminder.tag || "maintenance"}-${notificationDate}`,
          dueDate: notificationDate,
          targetDate,
          kind: "coating-maintenance",
          title: reminder.title || `${reminder.carName || "愛車"}のメンテナンス予定`,
          vehicleName: reminder.carName || "愛車",
          message: reminder.body || "コーティングのメンテナンス時期を確認してください。",
          active: true,
        };
      })
      .filter(Boolean);
  }

  async function syncLine(cars = lastCars) {
    if (!isLinked()) return false;
    const auth = credentials();
    const notifications = lineNotifications(cars);
    await lineApi("/api/notifications/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.deviceToken}` },
      body: JSON.stringify({
        deviceId: auth.deviceId,
        notifications,
      }),
    });
    setPanelStatus(`LINE通知：連携済み・${notifications.length}件の予定を同期済み`, true);
    return true;
  }

  async function linkLine(code, cars = lastCars) {
    const normalized = String(code || "").replace(/\D/g, "").slice(0, 6);
    if (!/^\d{6}$/.test(normalized)) {
      throw new Error("6桁の連携コードを入力してください。");
    }

    const payload = await lineApi("/api/notification-link", {
      method: "POST",
      body: JSON.stringify({
        code: normalized,
        deviceId: localDeviceId(),
      }),
    });

    saveCredentials(payload);
    await syncLine(cars);
    return payload;
  }

  async function unlinkLine() {
    if (!isLinked()) {
      clearCredentials();
      return true;
    }
    const auth = credentials();
    await lineApi("/api/notification-link", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.deviceToken}` },
      body: JSON.stringify({ deviceId: auth.deviceId }),
    });
    clearCredentials();
    return true;
  }

  async function testLine() {
    if (!isLinked()) throw new Error("先にLINE通知を連携してください。");
    const auth = credentials();
    await lineApi("/api/notifications/test", {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.deviceToken}` },
      body: JSON.stringify({ deviceId: auth.deviceId }),
    });
    return true;
  }

  function panelHost() {
    return (
      document.getElementById("notificationStatus")?.parentElement ||
      document.getElementById("notificationNextList")?.parentElement ||
      null
    );
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    const host = panelHost();
    if (!host) return null;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = [
      "margin-top:14px",
      "padding:14px",
      "border:1px solid rgba(127,127,127,.32)",
      "border-radius:14px",
      "background:rgba(127,127,127,.06)",
    ].join(";");
    host.appendChild(panel);
    return panel;
  }

  function setPanelStatus(message, fresh = false) {
    const status = document.getElementById("dmLineStatus");
    if (!status) return;
    status.textContent = message;
    status.style.opacity = fresh ? "1" : ".75";
  }

  function buttonStyle(primary = false) {
    return [
      "appearance:none",
      "border:1px solid rgba(127,127,127,.38)",
      "border-radius:10px",
      "padding:9px 12px",
      "font:inherit",
      "font-weight:700",
      "cursor:pointer",
      primary ? "background:#06c755;color:#fff;border-color:#06c755" : "background:transparent;color:inherit",
    ].join(";");
  }

  function renderLine(cars = lastCars) {
    lastCars = Array.isArray(cars) ? cars : [];
    const panel = ensurePanel();
    if (!panel) return;

    if (isLinked()) {
      panel.innerHTML = `
        <div style="font-weight:800;margin-bottom:6px">LINE通知</div>
        <div id="dmLineStatus" style="font-size:.9em;margin-bottom:10px">LINE通知：連携済み</div>
        <div style="font-size:.82em;opacity:.72;margin-bottom:12px">アプリの「○日前に通知」設定に合わせて、RE:CORDARE公式LINEへメンテナンス予定を送ります。</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="dmLineSyncButton" type="button" style="${buttonStyle(true)}">予定を同期</button>
          <button id="dmLineTestButton" type="button" style="${buttonStyle(false)}">LINEテスト</button>
          <button id="dmLineUnlinkButton" type="button" style="${buttonStyle(false)}">連携解除</button>
        </div>
      `;

      document.getElementById("dmLineSyncButton")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        setPanelStatus("予定を同期中…");
        try {
          await syncLine(lastCars);
        } catch (error) {
          setPanelStatus(errorMessage(error));
          renderLine(lastCars);
        } finally {
          button.disabled = false;
        }
      });

      document.getElementById("dmLineTestButton")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        setPanelStatus("LINEへテスト送信中…");
        try {
          await testLine();
          setPanelStatus("LINEテストを送信しました。公式LINEを確認してください。", true);
        } catch (error) {
          setPanelStatus(errorMessage(error));
          renderLine(lastCars);
        } finally {
          button.disabled = false;
        }
      });

      document.getElementById("dmLineUnlinkButton")?.addEventListener("click", async (event) => {
        if (!confirm("LINE通知の連携を解除しますか？")) return;
        const button = event.currentTarget;
        button.disabled = true;
        setPanelStatus("連携を解除中…");
        try {
          await unlinkLine();
          renderLine(lastCars);
        } catch (error) {
          setPanelStatus(errorMessage(error));
          button.disabled = false;
        }
      });
      return;
    }

    panel.innerHTML = `
      <div style="font-weight:800;margin-bottom:6px">LINE通知</div>
      <div id="dmLineStatus" style="font-size:.9em;margin-bottom:8px">LINE通知：未連携</div>
      <div style="font-size:.82em;line-height:1.55;opacity:.76;margin-bottom:10px">RE:CORDARE公式LINEに「通知連携」と送信し、届いた6桁コードを入力してください。</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="dmLineCodeInput" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6桁コード" style="width:132px;box-sizing:border-box;border:1px solid rgba(127,127,127,.4);border-radius:10px;padding:9px 10px;font:inherit;background:transparent;color:inherit" />
        <button id="dmLineLinkButton" type="button" style="${buttonStyle(true)}">LINEと連携</button>
      </div>
    `;

    const input = document.getElementById("dmLineCodeInput");
    input?.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
    });

    document.getElementById("dmLineLinkButton")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const code = input?.value || "";
      button.disabled = true;
      setPanelStatus("LINEと連携中…");
      try {
        await linkLine(code, lastCars);
        renderLine(lastCars);
      } catch (error) {
        setPanelStatus(errorMessage(error));
        button.disabled = false;
      }
    });
  }

  async function autoSync(cars) {
    if (!isLinked()) return;
    try {
      await syncLine(cars);
    } catch (error) {
      console.error("LINE notification sync failed", error);
      if (error?.code === "invalid_token" || error?.code === "device_not_linked") {
        clearCredentials();
      }
    }
  }

  function install(value) {
    if (installed || !value || typeof value !== "object") return;
    installed = true;
    baseNotifications = value;

    const wrapped = Object.freeze({
      ...value,
      async init(cars) {
        lastCars = Array.isArray(cars) ? cars : [];
        const result = await value.init(cars);
        renderLine(lastCars);
        await autoSync(lastCars);
        return result;
      },
      render(cars) {
        lastCars = Array.isArray(cars) ? cars : [];
        const result = value.render(cars);
        renderLine(lastCars);
        return result;
      },
      async sync(cars) {
        lastCars = Array.isArray(cars) ? cars : [];
        const result = await value.sync(cars);
        await autoSync(lastCars);
        renderLine(lastCars);
        return result;
      },
      async saveFromForm(cars) {
        lastCars = Array.isArray(cars) ? cars : [];
        const result = await value.saveFromForm(cars);
        await autoSync(lastCars);
        renderLine(lastCars);
        return result;
      },
      line: Object.freeze({
        isLinked,
        sync: () => syncLine(lastCars),
        test: testLine,
        unlink: unlinkLine,
      }),
    });

    Object.defineProperty(window, "DMNotifications", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: wrapped,
    });
  }

  if (window.DMNotifications) {
    install(window.DMNotifications);
  } else {
    let pending;
    Object.defineProperty(window, "DMNotifications", {
      configurable: true,
      enumerable: true,
      get() {
        return pending;
      },
      set(value) {
        pending = value;
        install(value);
      },
    });
  }
})();
