(function () {
  "use strict";

  const VERSION = "v3.7 β2";
  const RELEASE_ID = "3.7-beta2-line-notifications";
  const SEEN_KEY = "dmSeenReleaseUpdate";
  const MODAL_ID = "dmReleaseUpdateModal";
  const BANNER_ID = "dmReleaseUpdateBanner";

  const releaseItems = [
    "RE:CORDARE公式LINEと6桁コードで通知連携できるようになりました。",
    "コーティングのメンテナンス予定を公式LINEへ同期できます。",
    "アプリの「○日前に通知」設定をLINE通知にも反映します。",
    "LINEテスト送信、予定の再同期、連携解除に対応しました。",
    "LINE通知用バックエンドをPrivate Blob保存とCron認証に対応しました。",
  ];

  window.DETAILING_MANAGER_VERSION = VERSION;
  document.documentElement.dataset.dmVersion = VERSION;

  function replaceVersionText(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const before = node.nodeValue || "";
      const after = before
        .replace(/v3\.7\s*β\s*1/g, VERSION)
        .replace(/v3\.7\s*beta\s*1/gi, VERSION)
        .replace(/v3\.7\s*Beta\s*1/g, VERSION);
      if (after !== before) node.nodeValue = after;
    });
  }

  function closeModal(markSeen) {
    document.getElementById(MODAL_ID)?.remove();
    if (markSeen) {
      try { localStorage.setItem(SEEN_KEY, RELEASE_ID); } catch {}
      document.getElementById(BANNER_ID)?.remove();
    }
  }

  function showModal() {
    if (document.getElementById(MODAL_ID)) return;
    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.style.cssText = [
      "position:fixed","inset:0","z-index:2147483646","background:rgba(0,0,0,.62)",
      "display:flex","align-items:center","justify-content:center","padding:20px","box-sizing:border-box"
    ].join(";");

    const card = document.createElement("div");
    card.style.cssText = [
      "width:min(520px,100%)","max-height:82vh","overflow:auto","border-radius:20px",
      "background:#15171b","color:#fff","box-shadow:0 20px 70px rgba(0,0,0,.45)",
      "padding:22px","box-sizing:border-box","font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
    ].join(";");
    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div>
          <div style="font-size:12px;font-weight:800;letter-spacing:.08em;color:#78a9ff">UPDATE</div>
          <div style="font-size:23px;font-weight:900;margin-top:5px">Detailing Manager ${VERSION}</div>
          <div style="font-size:14px;opacity:.72;margin-top:4px">LINE通知連携アップデート</div>
        </div>
        <button id="dmReleaseCloseX" type="button" aria-label="閉じる" style="border:0;background:transparent;color:#fff;font-size:26px;line-height:1;cursor:pointer;padding:2px 5px">×</button>
      </div>
      <div style="height:1px;background:rgba(255,255,255,.12);margin:18px 0"></div>
      <div style="font-size:15px;font-weight:800;margin-bottom:10px">今回のアップデート</div>
      <ul style="padding-left:20px;margin:0;line-height:1.7;font-size:14px">
        ${releaseItems.map((item) => `<li style="margin:6px 0">${item}</li>`).join("")}
      </ul>
      <button id="dmReleaseDone" type="button" style="width:100%;margin-top:20px;border:0;border-radius:13px;padding:13px 16px;background:#1677ff;color:#fff;font:inherit;font-weight:900;cursor:pointer">確認しました</button>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.getElementById("dmReleaseCloseX")?.addEventListener("click", () => closeModal(true));
    document.getElementById("dmReleaseDone")?.addEventListener("click", () => closeModal(true));
  }

  function ensureBanner() {
    if (document.getElementById(BANNER_ID)) return;
    let seen = "";
    try { seen = localStorage.getItem(SEEN_KEY) || ""; } catch {}
    if (seen === RELEASE_ID) return;

    const banner = document.createElement("button");
    banner.id = BANNER_ID;
    banner.type = "button";
    banner.style.cssText = [
      "position:fixed","top:max(10px,env(safe-area-inset-top))","left:50%","transform:translateX(-50%)",
      "z-index:2147483645","border:1px solid rgba(255,255,255,.2)","border-radius:999px",
      "background:#1677ff","color:#fff","padding:9px 14px","font:inherit","font-size:13px","font-weight:900",
      "box-shadow:0 8px 28px rgba(0,0,0,.28)","cursor:pointer","white-space:nowrap"
    ].join(";");
    banner.textContent = `NEW  ${VERSION} アップデート`;
    banner.addEventListener("click", showModal);
    document.body.appendChild(banner);
  }

  function init() {
    replaceVersionText(document.body);
    ensureBanner();
    let seen = "";
    try { seen = localStorage.getItem(SEEN_KEY) || ""; } catch {}
    if (seen !== RELEASE_ID) setTimeout(showModal, 350);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) replaceVersionText(node);
          else if (node.nodeType === Node.TEXT_NODE && node.parentElement) replaceVersionText(node.parentElement);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
