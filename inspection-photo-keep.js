(function () {
  "use strict";

  const store = window.DMPhotoStore;
  if (!store || store.__inspectionDocumentKeep) return;

  function loadCars() {
    try {
      const value = JSON.parse(localStorage.getItem("cars") || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function inspectionRefs() {
    const refs = [];
    for (const car of loadCars()) {
      const history = Array.isArray(car?.inspectionHistory) ? car.inspectionHistory : [];
      for (const record of history) {
        const documents = Array.isArray(record?.documents) ? record.documents : [];
        for (const document of documents) {
          const ref = String(document?.localRef || "");
          if (store.isRef?.(ref)) refs.push(ref);
        }
      }
    }
    return refs;
  }

  const wrapped = Object.freeze({
    ...store,
    __inspectionDocumentKeep: true,
    cleanupUnused(refs) {
      const keep = new Set([...(refs || []), ...inspectionRefs()]);
      return store.cleanupUnused(keep);
    },
  });

  Object.defineProperty(window, "DMPhotoStore", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: wrapped,
  });
})();
