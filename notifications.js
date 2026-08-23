(function () {
  "use strict";

  const SETTINGS_KEY = "dmNotificationSettings";
  const SENT_KEY = "dmNotificationSent";
  const CLIENT_ID_KEY = "dmPushClientId";
  const CLIENT_TOKEN_KEY = "dmPushClientToken";
  const DAY_MS = 86400000;
  const defaults = {
    enabled: false,
    leadDays: 7,
    time: "09:00",
    serverUrl: "",
    remoteConnected: false,
  };

  function loadJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function normalizeServerUrl(value) {
    const url = String(value || "").trim().replace(/\/+$/, "");
    return /^https:\/\//i.test(url) ? url : "";
  }

  function getSettings() {
    const saved = loadJson(SETTINGS_KEY, {});
    const configured = normalizeServerUrl(window.DETAILING_MANAGER_PUSH_SERVER || "");
    return {
      ...defaults,
      ...(saved && typeof saved === "object" ? saved : {}),
      leadDays: Math.max(0, Math.min(30, Number(saved?.leadDays ?? defaults.leadDays))),
      time: /^\d{2}:\d{2}$/.test(saved?.time || "") ? saved.time : defaults.time,
      serverUrl: normalizeServerUrl(saved?.serverUrl) || configured,
      remoteConnected: Boolean(saved?.remoteConnected),
    };
  }

  function saveSettings(settings) {
    const normalized = {
      ...getSettings(),
      ...settings,
    };
    normalized.serverUrl = normalizeServerUrl(normalized.serverUrl);
    normalized.leadDays = Math.max(0, Math.min(30, Number(normalized.leadDays || 0)));
    normalized.time = /^\d{2}:\d{2}$/.test(normalized.time || "") ? normalized.time : defaults.time;
    saveJson(SETTINGS_KEY, normalized);
    return normalized;
  }

  function isStandalone() {
    return Boolean(
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
        window.navigator.standalone,
    );
  }

  function supportsNotifications() {
    return "Notification" in window && "serviceWorker" in navigator;
  }

  function supportsPush() {
    return supportsNotifications() && "PushManager" in window;
  }

  function permissionState() {
    return supportsNotifications() ? Notification.permission : "unsupported";
  }

  function randomToken(bytes = 18) {
    const values = new Uint8Array(bytes);
    crypto.getRandomValues(values);
    let binary = "";
    values.forEach((value) => (binary += String.fromCharCode(value)));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function clientIdentity() {
    let clientId = localStorage.getItem(CLIENT_ID_KEY);
    let token = localStorage.getItem(CLIENT_TOKEN_KEY);
    if (!clientId) {
      clientId = `dm-${randomToken(16)}`;
      localStorage.setItem(CLIENT_ID_KEY, clientId);
    }
    if (!token) {
      token = randomToken(32);
      localStorage.setItem(CLIENT_TOKEN_KEY, token);
    }
    return { clientId, token };
  }

  function parseLocalDate(value, time = "09:00") {
    const parts = String(value || "").split("-").map(Number);
    const clock = String(time || "09:00").split(":").map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
    const date = new Date(parts[0], parts[1] - 1, parts[2], clock[0] || 0, clock[1] || 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(date) {
    return date.toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" });
  }

  function buildReminders(cars, settings = getSettings()) {
    return (Array.isArray(cars) ? cars : [])
      .map((car) => {
        const base = parseLocalDate(car?.coatDate, settings.time);
        const cycle = Math.max(1, Number(car?.maintDays || 0));
        if (!base || !cycle) return null;
        const dueAt = new Date(base.getTime() + cycle * DAY_MS);
        const scheduledAt = new Date(dueAt.getTime() - settings.leadDays * DAY_MS);
        const carName = String(car?.name || "愛車");
        const dueText = settings.leadDays > 0
          ? `${formatDate(dueAt)}のメンテ目安まであと${settings.leadDays}日です。`
          : `${formatDate(dueAt)}はメンテ目安日です。`;
        return {
          id: `maintenance-${String(car?.id || carName)}-${dueAt.toISOString().slice(0, 10)}-${settings.leadDays}`,
          title: `${carName}のメンテ時期です`,
          body: dueText,
          scheduledAt: scheduledAt.getTime(),
          dueAt: dueAt.getTime(),
          carName,
          tag: `dm-maintenance-${String(car?.id || carName)}`,
          url: "./#home",
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  function daysFromToday(timestamp) {
    const target = new Date(timestamp);
    const now = new Date();
    const targetSerial = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) / DAY_MS;
    const todaySerial = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
    return Math.round(targetSerial - todaySerial);
  }

  function setBadge(reminders) {
    if (!("setAppBadge" in navigator)) return;
    const count = reminders.filter((reminder) => reminder.scheduledAt <= Date.now()).length;
    if (count > 0) navigator.setAppBadge(count).catch(() => {});
    else if ("clearAppBadge" in navigator) navigator.clearAppBadge().catch(() => {});
  }

  async function registration() {
    await navigator.serviceWorker.register("./sw.js");
    return navigator.serviceWorker.ready;
  }

  async function showLocalNotification(reminder) {
    const worker = await registration();
    await worker.showNotification(reminder.title, {
      body: reminder.body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      tag: reminder.tag,
      renotify: false,
      data: { url: reminder.url, reminderId: reminder.id },
    });
  }

  async function checkDue(cars) {
    const settings = getSettings();
    const reminders = buildReminders(cars, settings);
    if (!settings.enabled) {
      if ("clearAppBadge" in navigator) navigator.clearAppBadge().catch(() => {});
      return;
    }
    setBadge(reminders);
    if (permissionState() !== "granted") return;
    if (settings.remoteConnected && settings.serverUrl) return;
    const sent = loadJson(SENT_KEY, {});
    const cutoff = Date.now() - 400 * DAY_MS;
    Object.keys(sent).forEach((key) => {
      if (Number(sent[key] || 0) < cutoff) delete sent[key];
    });
    const due = reminders.filter((reminder) => reminder.scheduledAt <= Date.now() && !sent[reminder.id]);
    for (const reminder of due.slice(0, 3)) {
      await showLocalNotification(reminder);
      sent[reminder.id] = Date.now();
    }
    saveJson(SENT_KEY, sent);
  }

  function base64UrlToUint8Array(value) {
    const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function byteArraysEqual(left, right) {
    if (!left || !right) return false;
    const a = new Uint8Array(left);
    const b = new Uint8Array(right);
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  }

  async function api(serverUrl, path, options = {}) {
    const response = await fetch(`${serverUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `通知サーバーエラー (${response.status})`);
    return payload;
  }

  async function connectRemote(cars, settings = getSettings()) {
    if (!settings.serverUrl || !supportsPush()) return false;
    const config = await api(settings.serverUrl, "/vapid-public-key", { method: "GET", headers: {} });
    if (!config.publicKey) throw new Error("通知サーバーの公開鍵を取得できませんでした");
    const worker = await registration();
    const applicationServerKey = base64UrlToUint8Array(config.publicKey);
    let subscription = await worker.pushManager.getSubscription();
    if (
      subscription &&
      subscription.options?.applicationServerKey &&
      !byteArraysEqual(subscription.options.applicationServerKey, applicationServerKey)
    ) {
      await subscription.unsubscribe();
      subscription = null;
    }
    if (!subscription) {
      subscription = await worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }
    const identity = clientIdentity();
    await api(settings.serverUrl, "/subscribe", {
      method: "POST",
      body: JSON.stringify({ ...identity, subscription: subscription.toJSON() }),
    });
    settings = saveSettings({ ...settings, remoteConnected: true });
    await syncRemote(cars, settings);
    return true;
  }

  async function syncRemote(cars, settings = getSettings()) {
    if (!settings.enabled || !settings.remoteConnected || !settings.serverUrl) return false;
    const identity = clientIdentity();
    const reminders = buildReminders(cars, settings).map(({ dueAt, carName, ...reminder }) => reminder);
    await api(settings.serverUrl, "/sync", {
      method: "POST",
      body: JSON.stringify({ ...identity, reminders }),
    });
    return true;
  }

  async function enable(cars) {
    if (!supportsNotifications()) {
      alert("この環境では通知を利用できません。iPhoneはSafariからホーム画面へ追加し、ホーム画面のアイコンから開いてください。");
      return false;
    }
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !isStandalone()) {
      alert("iPhoneの通知は、Safariの共有ボタンからホーム画面へ追加し、ホーム画面のアイコンから開いた時に有効にできます。");
      return false;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      alert("通知が許可されませんでした。iPhoneの設定 → 通知 → Detailing Managerから変更できます。");
      return false;
    }
    let settings = saveSettings({ enabled: true });
    if (settings.serverUrl) {
      try {
        await connectRemote(cars, settings);
        settings = getSettings();
      } catch (error) {
        console.error("Push connection failed", error);
        settings = saveSettings({ remoteConnected: false });
        alert("通知は有効になりましたが、バックグラウンド通知サーバーへ接続できませんでした。アプリを開いた時のお知らせは利用できます。");
      }
    }
    await checkDue(cars);
    render(cars);
    return true;
  }

  async function disable(cars = []) {
    const settings = getSettings();
    const identity = clientIdentity();
    try {
      if (settings.serverUrl && settings.remoteConnected) {
        await api(settings.serverUrl, "/unsubscribe", {
          method: "POST",
          body: JSON.stringify(identity),
        });
      }
      const worker = await navigator.serviceWorker?.ready;
      const subscription = await worker?.pushManager?.getSubscription();
      if (subscription) await subscription.unsubscribe();
    } catch (error) {
      console.error("Push unsubscribe failed", error);
    }
    saveSettings({ enabled: false, remoteConnected: false });
    if ("clearAppBadge" in navigator) navigator.clearAppBadge().catch(() => {});
    render(cars);
  }

  async function toggle(cars) {
    if (getSettings().enabled) await disable(cars);
    else await enable(cars);
  }

  async function saveFromForm(cars) {
    const lead = Number(document.getElementById("notificationLeadDays")?.value || defaults.leadDays);
    const time = document.getElementById("notificationTime")?.value || defaults.time;
    const typedServer = document.getElementById("pushServerUrl")?.value || "";
    const previous = getSettings();
    let settings = saveSettings({
      leadDays: lead,
      time,
      serverUrl: normalizeServerUrl(typedServer),
      remoteConnected: previous.serverUrl === normalizeServerUrl(typedServer) ? previous.remoteConnected : false,
    });
    if (settings.enabled && settings.serverUrl && permissionState() === "granted") {
      try {
        await connectRemote(cars, settings);
        settings = getSettings();
      } catch (error) {
        console.error("Push settings update failed", error);
        settings = saveSettings({ remoteConnected: false });
        alert("設定は保存しましたが、バックグラウンド通知サーバーへ接続できませんでした。");
      }
    } else if (settings.enabled) {
      await checkDue(cars);
    }
    render(cars);
    return settings;
  }

  async function sync(cars) {
    const settings = getSettings();
    await checkDue(cars);
    if (!settings.enabled || !settings.serverUrl || permissionState() !== "granted") {
      render(cars);
      return;
    }
    try {
      const worker = await registration();
      const subscription = await worker.pushManager?.getSubscription();
      if (!settings.remoteConnected || !subscription)
        await connectRemote(cars, settings);
      else await syncRemote(cars, settings);
    } catch (error) {
      console.error("Push schedule sync failed", error);
      saveSettings({ remoteConnected: false });
    }
    render(cars);
  }

  async function test(cars) {
    const settings = getSettings();
    if (!settings.enabled || permissionState() !== "granted") {
      await enable(cars);
      if (permissionState() !== "granted") return;
    }
    const current = getSettings();
    if (current.remoteConnected && current.serverUrl) {
      try {
        await api(current.serverUrl, "/test", {
          method: "POST",
          body: JSON.stringify(clientIdentity()),
        });
        alert("5秒後にバックグラウンド通知を送ります。アプリを閉じて確認できます。");
        return;
      } catch (error) {
        console.error("Remote test failed", error);
        saveSettings({ remoteConnected: false });
      }
    }
    await showLocalNotification({
      id: `test-${Date.now()}`,
      title: "Detailing Manager",
      body: "メンテ通知のテストです。",
      tag: "dm-notification-test",
      url: "./#settings",
    });
  }

  function render(cars) {
    const settings = getSettings();
    const lead = document.getElementById("notificationLeadDays");
    const time = document.getElementById("notificationTime");
    const server = document.getElementById("pushServerUrl");
    const status = document.getElementById("notificationStatus");
    const button = document.getElementById("notificationEnableButton");
    const testButton = document.getElementById("notificationTestButton");
    const list = document.getElementById("notificationNextList");
    if (lead && document.activeElement !== lead) lead.value = String(settings.leadDays);
    if (time && document.activeElement !== time) time.value = settings.time;
    if (server && document.activeElement !== server) server.value = settings.serverUrl;
    if (button) button.textContent = settings.enabled ? "通知をOFFにする" : "通知を有効にする";
    if (testButton) testButton.disabled = !settings.enabled || permissionState() !== "granted";
    if (status) {
      if (!supportsNotifications()) {
        status.className = "backup-status tiny";
        status.textContent = "この開き方では通知を利用できません。iPhoneはホーム画面のアイコンから開いてください。";
      } else if (!settings.enabled) {
        status.className = "backup-status tiny";
        status.textContent = "通知はOFFです。";
      } else if (permissionState() !== "granted") {
        status.className = "backup-status tiny";
        status.textContent = "通知の許可が必要です。";
      } else if (settings.remoteConnected && settings.serverUrl) {
        status.className = "backup-status fresh tiny";
        status.textContent = "バックグラウンド通知：接続済み（アプリを閉じていても届きます）";
      } else {
        status.className = "backup-status fresh tiny";
        status.textContent = "アプリ起動時の通知：有効（バックグラウンド通知サーバーは未接続）";
      }
    }
    if (list) {
      const reminders = buildReminders(cars, settings);
      list.innerHTML = reminders.length
        ? reminders
            .slice(0, 5)
            .map((reminder) => {
              const days = daysFromToday(reminder.dueAt);
              const label = days < 0 ? `${-days}日超過` : days === 0 ? "今日" : `${days}日後`;
              return `<div class="notification-next"><b>${escapeHtml(reminder.carName)}</b><span>${formatDate(new Date(reminder.dueAt))}（${label}）</span></div>`;
            })
            .join("")
        : '<span class="muted tiny">コーティング日とメンテ周期を登録すると通知予定が表示されます。</span>';
    }
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  async function init(cars) {
    render(cars);
    const settings = getSettings();
    if (!settings.enabled || permissionState() !== "granted") {
      if (!settings.enabled && "clearAppBadge" in navigator)
        navigator.clearAppBadge().catch(() => {});
      return;
    }
    await sync(cars);
  }

  window.DMNotifications = Object.freeze({
    getSettings,
    buildReminders,
    init,
    render,
    toggle,
    enable,
    disable,
    saveFromForm,
    sync,
    test,
    checkDue,
  });
})();
