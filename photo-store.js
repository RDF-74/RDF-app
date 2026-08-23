(function () {
  "use strict";

  const DB_NAME = "DetailingManagerMedia";
  const DB_VERSION = 1;
  const STORE_NAME = "photos";
  const REF_PREFIX = "dm-photo:";
  const dataUrlPattern = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i;
  const objectUrls = new Map();
  let databasePromise = null;
  let available = false;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB is not supported"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
      request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
    }).catch((error) => {
      databasePromise = null;
      available = false;
      throw error;
    });
    return databasePromise;
  }

  async function runTransaction(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      try {
        result = operation(store, transaction);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  }

  function createId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const values = new Uint32Array(4);
    crypto.getRandomValues(values);
    return [...values].map((value) => value.toString(36)).join("-");
  }

  function isRef(value) {
    return typeof value === "string" && value.startsWith(REF_PREFIX) && value.length > REF_PREFIX.length;
  }

  function idFromRef(value) {
    return isRef(value) ? value.slice(REF_PREFIX.length) : "";
  }

  function isDataUrl(value) {
    return dataUrlPattern.test(String(value || ""));
  }

  function dataUrlToBlob(dataUrl) {
    const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/i);
    if (!match) throw new Error("Invalid image data URL");
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: match[1] });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Image read failed"));
      reader.readAsDataURL(blob);
    });
  }

  function cacheBlob(id, blob) {
    const previous = objectUrls.get(id);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob);
    objectUrls.set(id, url);
    return url;
  }

  async function init() {
    try {
      await openDatabase();
      available = true;
      await runTransaction("readonly", (store) => {
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const record = cursor.value;
          if (record && record.id && record.blob instanceof Blob) cacheBlob(record.id, record.blob);
          cursor.continue();
        };
      });
      return true;
    } catch (error) {
      console.error("Photo storage initialization failed", error);
      available = false;
      return false;
    }
  }

  async function storeBlob(blob, metadata = {}) {
    if (!(blob instanceof Blob) || !blob.size) throw new Error("Empty image blob");
    const id = createId();
    const record = {
      id,
      blob,
      bytes: blob.size,
      type: blob.type || "image/jpeg",
      createdAt: new Date().toISOString(),
      kind: String(metadata.kind || "photo"),
    };
    await runTransaction("readwrite", (store) => store.put(record));
    available = true;
    cacheBlob(id, blob);
    return `${REF_PREFIX}${id}`;
  }

  async function storeDataUrl(dataUrl, metadata = {}) {
    if (isRef(dataUrl)) return dataUrl;
    if (!isDataUrl(dataUrl)) return "";
    return storeBlob(dataUrlToBlob(dataUrl), metadata);
  }

  function resolve(value) {
    if (isDataUrl(value)) return value;
    const id = idFromRef(value);
    return id ? objectUrls.get(id) || "" : "";
  }

  async function getRecord(ref) {
    const id = idFromRef(ref);
    if (!id) return null;
    const database = await openDatabase();
    return new Promise((resolveRecord, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolveRecord(request.result || null);
      request.onerror = () => reject(request.error || new Error("Image lookup failed"));
    });
  }

  async function toDataUrl(value) {
    if (isDataUrl(value)) return value;
    const record = await getRecord(value);
    return record && record.blob instanceof Blob ? blobToDataUrl(record.blob) : "";
  }

  async function remove(value) {
    const id = idFromRef(value);
    if (!id) return;
    await runTransaction("readwrite", (store) => store.delete(id));
    const url = objectUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(id);
  }

  async function clear() {
    await runTransaction("readwrite", (store) => store.clear());
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
  }

  async function stats() {
    let count = 0;
    let bytes = 0;
    await runTransaction("readonly", (store) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const record = cursor.value || {};
        count += 1;
        bytes += Number(record.bytes || record.blob?.size || 0);
        cursor.continue();
      };
    });
    return { count, bytes };
  }

  async function cleanupUnused(refs) {
    const keep = new Set(
      [...(refs || [])]
        .map(idFromRef)
        .filter(Boolean),
    );
    const removedIds = [];
    await runTransaction("readwrite", (store) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const id = String(cursor.key || "");
        if (!keep.has(id)) {
          removedIds.push(id);
          cursor.delete();
        }
        cursor.continue();
      };
    });
    removedIds.forEach((id) => {
      const url = objectUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      objectUrls.delete(id);
    });
    return removedIds.length;
  }

  async function requestPersistence() {
    if (!navigator.storage?.persist) return false;
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }

  window.DMPhotoStore = Object.freeze({
    REF_PREFIX,
    init,
    isAvailable: () => available,
    isRef,
    isDataUrl,
    resolve,
    storeBlob,
    storeDataUrl,
    toDataUrl,
    remove,
    clear,
    stats,
    cleanupUnused,
    requestPersistence,
    blobToDataUrl,
  });
})();
