// バックグラウンド通知サーバーを使う場合は、Cloudflare WorkerのURLを設定します。
// 例: window.DETAILING_MANAGER_PUSH_SERVER = "https://detailing-manager-push.example.workers.dev";
window.DETAILING_MANAGER_PUSH_SERVER = "";

// v3.7 β3 アップデート通知とバージョン表示。
(function loadReleaseUpdate() {
  if (document.querySelector('script[data-dm-release-update]')) return;

  if (document.readyState === "loading") {
    document.write('<script src="./release-update.js" data-dm-release-update></script>');
    return;
  }

  const script = document.createElement("script");
  script.src = "./release-update.js";
  script.dataset.dmReleaseUpdate = "1";
  script.async = false;
  document.head.appendChild(script);
})();

// RE:CORDARE公式LINE通知連携。
// このファイルはnotifications.jsより先に読み込まれるため、LINE連携ラッパーを先に準備します。
(function loadLineNotifications() {
  if (document.querySelector('script[data-dm-line-notifications]')) return;

  if (document.readyState === "loading") {
    document.write('<script src="./line-notifications.js" data-dm-line-notifications></script>');
    document.write('<script src="./line-official-link.js" data-dm-line-official-link></script>');
    return;
  }

  const script = document.createElement("script");
  script.src = "./line-notifications.js";
  script.dataset.dmLineNotifications = "1";
  script.async = false;
  document.head.appendChild(script);

  if (!document.querySelector('script[data-dm-line-official-link]')) {
    const officialLinkScript = document.createElement("script");
    officialLinkScript.src = "./line-official-link.js";
    officialLinkScript.dataset.dmLineOfficialLink = "1";
    officialLinkScript.async = false;
    document.head.appendChild(officialLinkScript);
  }
})();

// 車検満了日・車検通知連携。
// LINE連携ラッパーの後、notifications.js本体より前に読み込んで通知予定を拡張します。
(function loadVehicleInspection() {
  if (document.querySelector('script[data-dm-vehicle-inspection]')) return;

  if (document.readyState === "loading") {
    document.write('<script src="./vehicle-inspection.js" data-dm-vehicle-inspection></script>');
    return;
  }

  const script = document.createElement("script");
  script.src = "./vehicle-inspection.js";
  script.dataset.dmVehicleInspection = "1";
  script.async = false;
  document.head.appendChild(script);
})();
