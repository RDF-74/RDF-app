// バックグラウンド通知サーバーを使う場合は、Cloudflare WorkerのURLを設定します。
// 例: window.DETAILING_MANAGER_PUSH_SERVER = "https://detailing-manager-push.example.workers.dev";
window.DETAILING_MANAGER_PUSH_SERVER = "";

// RE:CORDARE公式LINE通知連携。
// このファイルはnotifications.jsより先に読み込まれるため、LINE連携ラッパーを先に準備します。
(function loadLineNotifications() {
  if (document.querySelector('script[data-dm-line-notifications]')) return;

  if (document.readyState === "loading") {
    document.write('<script src="./line-notifications.js" data-dm-line-notifications></script>');
    return;
  }

  const script = document.createElement("script");
  script.src = "./line-notifications.js";
  script.dataset.dmLineNotifications = "1";
  script.async = false;
  document.head.appendChild(script);
})();
