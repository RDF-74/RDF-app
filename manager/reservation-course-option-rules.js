(() => {
  const includedOptionsByCourse = {
    reset_coat: new Set([
      "body_iron_removal",
      "front_glass_oil_repellent",
      "all_glass_oil_repellent",
    ]),
  };

  const resetLabelOverrides = {
    front_glass_scale: "フロントガラス ウロコ除去",
    all_glass_scale: "全面ガラス ウロコ除去",
  };

  const syncIncludedOptions = () => {
    const course = document.getElementById("reservationCourse");
    if (!course) return;
    const isReset = course.value === "reset_coat";
    const included = includedOptionsByCourse[course.value] || new Set();

    document.querySelectorAll("[data-option-code]").forEach((checkbox) => {
      const code = checkbox.dataset.optionCode;
      const row = checkbox.closest(".pricing-choice");
      const label = row?.querySelector("strong");
      const isIncluded = included.has(code);

      if (row) row.hidden = isIncluded;
      if (isIncluded && checkbox.checked) {
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }

      if (label) {
        if (!label.dataset.originalOptionLabel) {
          label.dataset.originalOptionLabel = label.textContent || "";
        }
        const desiredLabel = isReset && resetLabelOverrides[code]
          ? resetLabelOverrides[code]
          : label.dataset.originalOptionLabel;
        if (label.textContent !== desiredLabel) label.textContent = desiredLabel;
      }
    });
  };

  document.addEventListener("change", (event) => {
    if (event.target?.id === "reservationCourse") syncIncludedOptions();
  });

  const appRoot = document.getElementById("app");
  if (appRoot) new MutationObserver(syncIncludedOptions).observe(appRoot, { childList: true, subtree: true });
  queueMicrotask(syncIncludedOptions);
})();
