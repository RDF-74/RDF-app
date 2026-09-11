(() => {
  const includedOptionsByCourse = {
    reset_coat: new Set(["body_iron_removal", "all_glass_oil_repellent"]),
  };

  const syncIncludedOptions = () => {
    const course = document.getElementById("reservationCourse");
    if (!course) return;
    const included = includedOptionsByCourse[course.value] || new Set();
    document.querySelectorAll("[data-option-code]").forEach((checkbox) => {
      const row = checkbox.closest(".pricing-choice");
      const isIncluded = included.has(checkbox.dataset.optionCode);
      if (row) row.hidden = isIncluded;
      if (isIncluded && checkbox.checked) {
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
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
