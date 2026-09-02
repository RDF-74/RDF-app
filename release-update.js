(function () {
  "use strict";

  const VERSION = "v3.7 β3";
  const RELEASE_ID = "3.7-beta3-vehicle-inspection";
  const SEEN_KEY = "dmSeenReleaseUpdate";
  const MODAL_ID = "dmReleaseUpdateModal";
  const BANNER_ID = "dmReleaseUpdateBanner";

  const releaseItems = [
    "登録車両ごとに車検満了日を保存できるようになりました。",
    "車検満了日の3か月前・2か月前・1か月前・7日前に通知します。",
    "2か月前の通知では、車検を受けられる期間に入ったことを案内します。",
    "RE:CORDARE公式LINEと連携済みの場合、車検の予定もLINEへ同期します。",
    "「車検完了」で今回分の残り通知を停止できます。新しい満了日を登録すると次回分へ自動で切り替わります。",
    "ホーム画面から選択中の車両の車検満了日と残り日数を確認できます。",
  ];

  const externalHistory = [
    {
      id: "3.7-beta3",
      label: "v3.7 β3",
      date: "2026年9月2日",
      title: "車検管理に対応しました",
      summary: "車検満了日・定期通知・LINE通知・完了処理を追加",
      changes: releaseItems,
    },
    {
      id: "3.7-beta2",
      label: "v3.7 β2",
      date: "2026年9月2日",
      title: "RE:CORDARE公式LINE通知に対応しました",
      summary: "6桁コードでLINE連携し、メンテ予定を通知",
      changes: [
        "RE:CORDARE公式LINEと6桁コードで通知連携",
        "コーティングのメンテナンス予定を公式LINEへ同期",
        "アプリの「○日前に通知」設定をLINE通知にも反映",
        "LINEテスト送信、予定の再同期、連携解除に対応",
        "LINE通知設定からRE:CORDARE公式LINEを直接開ける導線を追加",
      ],
    },
  ];

  window.DETAILING_MANAGER_VERSION = VERSION;
  document.documentElement.dataset.dmVersion = VERSION;

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function replaceVersionText(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if (node.parentElement?.closest("#updateHistoryList")) return;
      const before = node.nodeValue || "";
      const after = before
        .replace(/v3\.7\s*β\s*[12]/g, VERSION)
        .replace(/v3\.7\s*beta\s*[12]/gi, VERSION);
      if (after !== before) node.nodeValue = after;
    });
  }

  function historyMarkup(release, latest) {
    return `
      <details class="update-item${latest ? " latest" : ""}" ${latest ? "open" : ""} data-dm-external-release="${escapeHtml(release.id)}">
        <summary>
          <span class="version-badge">${escapeHtml(release.label)}</span>
          <span><b>${escapeHtml(release.title)}</b><span class="update-item-date">${escapeHtml(release.date)}</span></span>
        </summary>
        <div class="muted tiny" style="margin-top:8px">${escapeHtml(release.summary)}</div>
        <ul>${release.changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul>
      </details>`;
  }

  function ensureBuiltInHistory() {
    const badge = document.getElementById("currentVersionBadge");
    if (badge && badge.textContent !== VERSION) badge.textContent = VERSION;

    const list = document.getElementById("updateHistoryList");
    if (!list) return;
    const hasBeta3 = list.querySelector('[data-dm-external-release="3.7-beta3"]');
    const hasBeta2 = list.querySelector('[data-dm-external-release="3.7-beta2"]');
    if (hasBeta3 && hasBeta2) return;

    list.querySelectorAll(".update-item.latest").forEach((item) => {
      item.classList.remove("latest");
      item.removeAttribute("open");
    });
    list.querySelectorAll("[data-dm-external-release]").forEach((item) => item.remove());
    list.insertAdjacentHTML(
      "afterbegin",
      externalHistory.map((release, index) => historyMarkup(release, index === 0)).join(""),
    );
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
          <div style="font-size:14px;opacity:.72;margin-top:4px">車検管理アップデート</div>
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

  function refreshUi(root) {
    replaceVersionText(root || document.body);
    ensureBuiltInHistory();
  }

  function init() {
    refreshUi(document.body);
    ensureBanner();
    let seen = "";
    try { seen = localStorage.getItem(SEEN_KEY) || ""; } catch {}
    if (seen !== RELEASE_ID) setTimeout(showModal, 350);

    let queued = false;
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) replaceVersionText(node);
          else if (node.nodeType === Node.TEXT_NODE && node.parentElement) replaceVersionText(node.parentElement);
        });
      });
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        ensureBuiltInHistory();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
