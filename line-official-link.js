(function () {
  "use strict";

  const OFFICIAL_LINE_URL = "https://lin.ee/RWvHZqp";
  const LINK_WRAP_ID = "dmOfficialLineLinkWrap";
  let observerStarted = false;
  let scheduled = false;

  function installOfficialLineLink() {
    const panel = document.getElementById("dmLineNotificationPanel");
    if (!panel || document.getElementById(LINK_WRAP_ID)) return;

    const wrap = document.createElement("div");
    wrap.id = LINK_WRAP_ID;
    wrap.style.cssText = "margin:10px 0 12px";
    wrap.innerHTML = `
      <div style="font-size:.82em;opacity:.72;margin-bottom:7px">公式LINEをまだ友だち追加していない方はこちら</div>
      <a href="${OFFICIAL_LINE_URL}" target="_blank" rel="noopener noreferrer" style="display:inline-block;text-decoration:none;border:1px solid #06c755;border-radius:10px;padding:9px 12px;background:#06c755;color:#fff;font:inherit;font-weight:800">RE:CORDARE公式LINEを開く</a>
    `;

    const status = document.getElementById("dmLineStatus");
    if (status) status.insertAdjacentElement("afterend", wrap);
    else panel.prepend(wrap);
  }

  function scheduleInstall() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      installOfficialLineLink();
    });
  }

  function startObserver() {
    if (observerStarted || !document.body) return;
    observerStarted = true;
    const observer = new MutationObserver(scheduleInstall);
    observer.observe(document.body, { childList: true, subtree: true });
    installOfficialLineLink();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  } else {
    startObserver();
  }
})();
