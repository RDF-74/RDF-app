// バックグラウンド通知サーバーを使う場合は、Cloudflare WorkerのURLを設定します。
// 例: window.DETAILING_MANAGER_PUSH_SERVER = "https://detailing-manager-push.example.workers.dev";
window.DETAILING_MANAGER_PUSH_SERVER = "";

// v3.7 β5 アップデート通知とバージョン表示。
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

// 車検通知拡張はnotifications.js本体より前に読み込み、履歴・請求書写真/OCR・ホーム予定を同じ順序で準備します。
(function loadVehicleInspectionFeatures() {
  if (document.querySelector('script[data-dm-vehicle-inspection]')) return;

  if (document.readyState === "loading") {
    document.write('<script src="./inspection-photo-keep.js" data-dm-inspection-photo-keep></script>');
    document.write('<script src="./vehicle-inspection.js" data-dm-vehicle-inspection></script>');
    document.write('<script src="./inspection-history.js" data-dm-inspection-history></script>');
    document.write('<script src="./inspection-documents.js" data-dm-inspection-documents></script>');
    document.write('<script src="./home-dashboard.js" data-dm-home-dashboard></script>');
    return;
  }

  const files = [
    { src: "./inspection-photo-keep.js", key: "dmInspectionPhotoKeep" },
    { src: "./vehicle-inspection.js", key: "dmVehicleInspection" },
    { src: "./inspection-history.js", key: "dmInspectionHistory" },
    { src: "./inspection-documents.js", key: "dmInspectionDocuments" },
    { src: "./home-dashboard.js", key: "dmHomeDashboard" },
  ];

  files.forEach(({ src, key }) => {
    const script = document.createElement("script");
    script.src = src;
    script.dataset[key] = "1";
    script.async = false;
    document.head.appendChild(script);
  });
})();
