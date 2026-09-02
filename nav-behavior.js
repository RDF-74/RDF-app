(function () {
  "use strict";

  const STYLE_ID = "dmNavBehaviorStyle";
  const HIDDEN_CLASS = "dm-nav-hidden";
  const KEYBOARD_CLASS = "dm-nav-keyboard";
  let lastY = Math.max(0, window.scrollY || 0);
  let ticking = false;
  let nav = null;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      nav {
        transition: transform .22s ease, opacity .22s ease;
        will-change: transform;
      }
      body.${HIDDEN_CLASS} nav,
      body.${KEYBOARD_CLASS} nav {
        transform: translateY(calc(100% + env(safe-area-inset-bottom)));
        opacity: 0;
        pointer-events: none;
      }
      @media (prefers-reduced-motion: reduce) {
        nav { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function showNav() {
    document.body?.classList.remove(HIDDEN_CLASS);
  }

  function hideNav() {
    document.body?.classList.add(HIDDEN_CLASS);
  }

  function updateOnScroll() {
    ticking = false;
    const y = Math.max(0, window.scrollY || 0);
    const delta = y - lastY;

    if (y <= 48) {
      showNav();
    } else if (delta > 10) {
      hideNav();
    } else if (delta < -6) {
      showNav();
    }

    lastY = y;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateOnScroll);
  }

  function updateKeyboardState() {
    if (!document.body) return;
    const active = document.activeElement;
    const editing = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
    const viewport = window.visualViewport;
    const keyboardLikelyOpen = editing && viewport && viewport.height < window.innerHeight * 0.82;
    document.body.classList.toggle(KEYBOARD_CLASS, Boolean(keyboardLikelyOpen));
    if (!keyboardLikelyOpen) showNav();
  }

  function init() {
    nav = document.querySelector("nav");
    if (!nav || !document.body) return;
    ensureStyle();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchstart", () => {
      lastY = Math.max(0, window.scrollY || 0);
    }, { passive: true });
    document.addEventListener("focusin", updateKeyboardState);
    document.addEventListener("focusout", () => setTimeout(updateKeyboardState, 80));
    window.visualViewport?.addEventListener("resize", updateKeyboardState);
    window.visualViewport?.addEventListener("scroll", updateKeyboardState);
    showNav();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
