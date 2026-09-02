(function () {
  "use strict";

  const API_BASE = "https://recordare-line-webhook.vercel.app";
  const PANEL_ID = "dmInspectionCompletionPanel";
  const SECTION_ID = "dmVehicleInspectionSection";
  const HISTORY_ID = "dmInspectionHistoryList";
  const COMPLETE_BUTTON_ID = "dmInspectionCompleteButton";
  const SAVE_BUTTON_ID = "dmInspectionCompletionSave";
  const CANCEL_BUTTON_ID = "dmInspectionCompletionCancel";
  const FIELD_ID = "dmInspectionExpiry";
  const MAX_PHOTOS = 3;
  const TARGET_BYTES = 650 * 1024;
  const HARD_MAX_BYTES = 1_200_000;
  const MAX_EDGE = 2000;
  const OCR_SCRIPT = "https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js";
  let pendingDocs = [];
  let observerQueued = false;
  let ocrLoadingPromise = null;
  let ocrWorker = null;
  const cloudObjectUrls = new Set();

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      alert("請求書写真を含む車検履歴を保存できませんでした。端末の空き容量を確認してください。");
      return false;
    }
  }

  function getCars() {
    const value = loadJson("cars", []);
    return Array.isArray(value) ? value : [];
  }

  function activeCarId() {
    return String(loadJson("activeCarId", "") || "");
  }

  function currentCar() {
    const editId = String(document.getElementById("carEditId")?.value || "").trim();
    const id = editId || activeCarId();
    return getCars().find((car) => car.id === id) || null;
  }

  function validDate(value) {
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function historyOf(car) {
    return Array.isArray(car?.inspectionHistory) ? car.inspectionHistory : [];
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function dataUrlToBlob(dataUrl) {
    const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/i);
    if (!match) throw new Error("invalid_image_data");
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: match[1] });
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("画像を読み込めませんでした。"));
      };
      image.src = url;
    });
  }

  async function compressInvoice(file) {
    const image = await loadImage(file);
    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;
    const longest = Math.max(width, height);
    if (longest > MAX_EDGE) {
      const scale = MAX_EDGE / longest;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("画像圧縮を開始できませんでした。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const preferredType = "image/webp";
    let quality = 0.9;
    let blob = await canvasBlob(canvas, preferredType, quality);
    if (!blob) blob = await canvasBlob(canvas, "image/jpeg", quality);
    while (blob && blob.size > TARGET_BYTES && quality > 0.54) {
      quality -= 0.07;
      blob = await canvasBlob(canvas, blob.type || preferredType, quality);
    }

    if (blob && blob.size > HARD_MAX_BYTES) {
      const scale = Math.sqrt(HARD_MAX_BYTES / blob.size) * 0.92;
      const small = document.createElement("canvas");
      small.width = Math.max(900, Math.round(width * scale));
      small.height = Math.max(900, Math.round(height * scale));
      const smallContext = small.getContext("2d", { alpha: false });
      smallContext.fillStyle = "#fff";
      smallContext.fillRect(0, 0, small.width, small.height);
      smallContext.drawImage(canvas, 0, 0, small.width, small.height);
      blob = await canvasBlob(small, preferredType, 0.72) || await canvasBlob(small, "image/jpeg", 0.76);
    }

    if (!blob) throw new Error("画像を圧縮できませんでした。");
    return blob;
  }

  function lineCredentials() {
    return {
      deviceId: String(localStorage.getItem("dmLineDeviceId") || "").trim(),
      deviceToken: String(localStorage.getItem("dmLineDeviceToken") || "").trim(),
    };
  }

  function lineLinked() {
    const auth = lineCredentials();
    return Boolean(auth.deviceId && auth.deviceToken);
  }

  async function localBlob(ref) {
    if (!window.DMPhotoStore?.toDataUrl) return null;
    const dataUrl = await window.DMPhotoStore.toDataUrl(ref);
    return dataUrl ? dataUrlToBlob(dataUrl) : null;
  }

  async function uploadCloud(carId, historyId, doc) {
    if (!lineLinked() || !doc?.localRef) return doc;
    const auth = lineCredentials();
    const blob = await localBlob(doc.localRef);
    if (!blob) return doc;

    const form = new FormData();
    form.append("deviceId", auth.deviceId);
    form.append("carId", String(carId || "car"));
    form.append("historyId", String(historyId || "history"));
    form.append("photoId", String(doc.id || crypto.randomUUID()));
    form.append("file", blob, `${doc.id || "invoice"}.${blob.type === "image/webp" ? "webp" : "jpg"}`);

    const response = await fetch(`${API_BASE}/api/photos/file`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.deviceToken}` },
      body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `写真バックアップエラー (${response.status})`);
    return {
      ...doc,
      cloudPathname: payload.pathname || "",
      cloudUploadedAt: payload.uploadedAt || new Date().toISOString(),
    };
  }

  async function cloudBlob(pathname) {
    if (!pathname || !lineLinked()) return null;
    const auth = lineCredentials();
    const params = new URLSearchParams({ deviceId: auth.deviceId, pathname });
    const response = await fetch(`${API_BASE}/api/photos/file?${params}`, {
      headers: { Authorization: `Bearer ${auth.deviceToken}` },
    });
    if (!response.ok) return null;
    return response.blob();
  }

  function localUrl(doc) {
    return doc?.localRef && window.DMPhotoStore?.resolve ? window.DMPhotoStore.resolve(doc.localRef) : "";
  }

  async function documentUrl(doc) {
    const local = localUrl(doc);
    if (local) return local;
    const blob = await cloudBlob(doc?.cloudPathname);
    if (!blob) return "";
    const url = URL.createObjectURL(blob);
    cloudObjectUrls.add(url);
    return url;
  }

  async function clearPending(removeLocal = true) {
    const docs = pendingDocs;
    pendingDocs = [];
    if (removeLocal && window.DMPhotoStore?.remove) {
      for (const doc of docs) {
        if (doc.localRef) await window.DMPhotoStore.remove(doc.localRef).catch(() => {});
      }
    }
    renderPending();
  }

  async function addFiles(fileList) {
    const files = [...(fileList || [])].filter((file) => file?.type?.startsWith("image/"));
    if (!files.length) return;
    const remaining = MAX_PHOTOS - pendingDocs.length;
    if (remaining <= 0) {
      alert(`請求書写真は1回の車検につき最大${MAX_PHOTOS}枚です。`);
      return;
    }

    const status = document.getElementById("dmInspectionDocumentStatus");
    for (const file of files.slice(0, remaining)) {
      try {
        if (status) status.textContent = `${file.name || "写真"}を圧縮中…`;
        const blob = await compressInvoice(file);
        const localRef = await window.DMPhotoStore?.storeBlob(blob, { kind: "inspection-invoice" });
        if (!localRef) throw new Error("端末内へ写真を保存できませんでした。");
        pendingDocs.push({
          id: crypto.randomUUID ? crypto.randomUUID() : `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          localRef,
          name: String(file.name || "請求書").slice(0, 120),
          type: blob.type || "image/jpeg",
          bytes: blob.size,
          cloudPathname: "",
          cloudUploadedAt: "",
        });
        renderPending();
      } catch (error) {
        alert(error?.message || "請求書写真を追加できませんでした。");
      }
    }
    if (status) status.textContent = lineLinked()
      ? "保存時に端末＋Private Blobへバックアップします。"
      : "端末内へ保存します。LINE連携するとPrivate Blobにもバックアップできます。";
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value}B`;
    return `${(value / 1024).toFixed(value >= 1024 * 500 ? 0 : 1)}KB`;
  }

  function renderPending() {
    const host = document.getElementById("dmInspectionDocumentPreview");
    if (!host) return;
    if (!pendingDocs.length) {
      host.innerHTML = '<div style="font-size:.78em;opacity:.62">まだ写真は追加されていません。</div>';
      return;
    }
    host.innerHTML = pendingDocs.map((doc, index) => {
      const src = localUrl(doc);
      return `
        <div style="position:relative;border:1px solid rgba(127,127,127,.24);border-radius:12px;overflow:hidden;background:#0a0f15">
          <button type="button" data-dm-doc-preview="${index}" style="display:block;width:100%;padding:0;border:0;background:transparent;cursor:pointer">
            ${src ? `<img src="${escapeHtml(src)}" alt="請求書写真" style="display:block;width:100%;height:96px;object-fit:cover">` : '<div style="height:96px;display:grid;place-items:center;font-size:12px;opacity:.65">写真</div>'}
          </button>
          <div style="padding:6px 8px;font-size:10px;opacity:.7">${escapeHtml(formatBytes(doc.bytes))}</div>
          <button type="button" data-dm-doc-remove="${index}" aria-label="写真を削除" style="position:absolute;top:5px;right:5px;width:26px;height:26px;border-radius:50%;border:0;background:rgba(0,0,0,.72);color:#fff;font-size:17px;line-height:1;cursor:pointer">×</button>
        </div>`;
    }).join("");

    host.querySelectorAll("[data-dm-doc-remove]").forEach((button) => {
      button.addEventListener("click", async () => {
        const index = Number(button.dataset.dmDocRemove);
        const [doc] = pendingDocs.splice(index, 1);
        if (doc?.localRef) await window.DMPhotoStore?.remove?.(doc.localRef).catch(() => {});
        renderPending();
      });
    });
    host.querySelectorAll("[data-dm-doc-preview]").forEach((button) => {
      button.addEventListener("click", () => openViewer(pendingDocs[Number(button.dataset.dmDocPreview)]));
    });
  }

  function buildDocumentUi() {
    const wrap = document.createElement("div");
    wrap.id = "dmInspectionDocumentFields";
    wrap.style.cssText = "margin-top:12px;padding:12px;border:1px solid rgba(127,127,127,.24);border-radius:14px;background:rgba(0,0,0,.12)";
    wrap.innerHTML = `
      <div style="font-weight:800">請求書・明細写真</div>
      <div style="font-size:.76em;opacity:.67;line-height:1.55;margin-top:4px">最大3枚。文字が読める画質を残しながら1枚約500〜700KBを目安に自動圧縮します。</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <label style="display:inline-block;border:0;border-radius:11px;padding:9px 12px;background:#1677ff;color:#fff;font-size:.82em;font-weight:800;cursor:pointer">
          写真を追加
          <input id="dmInspectionDocumentInput" type="file" accept="image/*" multiple style="display:none" />
        </label>
        <button id="dmInspectionOcrButton" type="button" style="border:1px solid rgba(127,127,127,.35);border-radius:11px;padding:9px 12px;background:transparent;color:inherit;font:inherit;font-size:.82em;font-weight:800">OCRで読み取る β</button>
      </div>
      <div id="dmInspectionDocumentStatus" style="font-size:.74em;opacity:.66;line-height:1.5;margin-top:8px"></div>
      <div id="dmInspectionDocumentPreview" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px"></div>
      <details id="dmInspectionOcrResult" style="display:none;margin-top:10px">
        <summary style="cursor:pointer;font-size:.8em;font-weight:800">OCR読み取り結果</summary>
        <pre id="dmInspectionOcrText" style="white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;font-size:11px;line-height:1.5;margin:8px 0 0;padding:9px;border-radius:10px;background:rgba(0,0,0,.2)"></pre>
      </details>
    `;
    return wrap;
  }

  function ensureUi() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return false;
    if (!document.getElementById("dmInspectionDocumentFields")) {
      const fields = buildDocumentUi();
      const nextExpiry = document.getElementById("dmInspectionNextExpiry")?.closest("label");
      if (nextExpiry) nextExpiry.insertAdjacentElement("beforebegin", fields);
      else panel.appendChild(fields);
      document.getElementById("dmInspectionDocumentInput")?.addEventListener("change", (event) => {
        addFiles(event.target.files).finally(() => { event.target.value = ""; });
      });
      document.getElementById("dmInspectionOcrButton")?.addEventListener("click", runOcr);
      renderPending();
    }

    const completeButton = document.getElementById(COMPLETE_BUTTON_ID);
    if (completeButton && !completeButton.dataset.documentResetHook) {
      completeButton.dataset.documentResetHook = "1";
      completeButton.addEventListener("click", () => {
        clearPending(true).catch(() => {});
        const result = document.getElementById("dmInspectionOcrResult");
        if (result) result.style.display = "none";
      });
    }

    const cancelButton = document.getElementById(CANCEL_BUTTON_ID);
    if (cancelButton && !cancelButton.dataset.documentResetHook) {
      cancelButton.dataset.documentResetHook = "1";
      cancelButton.addEventListener("click", () => clearPending(true).catch(() => {}));
    }

    const saveButton = document.getElementById(SAVE_BUTTON_ID);
    if (saveButton && !saveButton.dataset.documentsEnhanced) {
      const replacement = saveButton.cloneNode(true);
      replacement.dataset.documentsEnhanced = "1";
      saveButton.replaceWith(replacement);
      replacement.addEventListener("click", saveCompletionWithDocuments);
    }

    enhanceHistoryPhotos();
    return true;
  }

  async function syncNotifications(cars) {
    try {
      await window.DMNotifications?.sync?.(cars);
    } catch (error) {
      console.error("Inspection document notification sync failed", error);
    }
  }

  async function saveCompletionWithDocuments(event) {
    const button = event.currentTarget;
    const target = currentCar();
    if (!target?.id || !validDate(target.inspectionExpiry)) {
      alert("保存する車検情報が見つかりませんでした。");
      return;
    }

    const performedDate = validDate(document.getElementById("dmInspectionPerformedDate")?.value) || todayKey();
    const nextExpiry = validDate(document.getElementById("dmInspectionNextExpiry")?.value);
    const costRaw = Number(document.getElementById("dmInspectionCost")?.value || 0);
    const cost = Number.isFinite(costRaw) && costRaw > 0 ? Math.round(costRaw) : null;
    const parts = String(document.getElementById("dmInspectionParts")?.value || "").trim().slice(0, 1000);
    if (nextExpiry && nextExpiry <= performedDate) {
      alert("次回車検満了日は車検実施日より後の日付を入力してください。");
      return;
    }

    button.disabled = true;
    const updatedCars = getCars();
    const index = updatedCars.findIndex((car) => car.id === target.id);
    if (index < 0) {
      button.disabled = false;
      return;
    }

    const previousExpiry = validDate(updatedCars[index].inspectionExpiry);
    const history = historyOf(updatedCars[index]).slice();
    const historyId = `inspection-history-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const documents = pendingDocs.map((doc) => ({ ...doc }));
    history.push({
      id: historyId,
      performedDate,
      previousExpiry,
      cost,
      parts,
      nextExpiry,
      documents,
      createdAt: new Date().toISOString(),
    });
    updatedCars[index] = {
      ...updatedCars[index],
      lastInspectionExpiry: previousExpiry,
      inspectionExpiry: nextExpiry,
      inspectionCompletedAt: new Date().toISOString(),
      inspectionHistory: history.slice(-20),
    };

    if (!saveJson("cars", updatedCars)) {
      button.disabled = false;
      return;
    }
    pendingDocs = [];
    document.getElementById(PANEL_ID).style.display = "none";
    const expiryInput = document.getElementById(FIELD_ID);
    if (expiryInput) {
      expiryInput.value = nextExpiry;
      expiryInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await syncNotifications(updatedCars);

    if (documents.length && lineLinked()) {
      button.textContent = "写真をクラウド保存中…";
      const uploaded = [];
      let cloudFailed = false;
      for (const doc of documents) {
        try {
          uploaded.push(await uploadCloud(target.id, historyId, doc));
        } catch (error) {
          cloudFailed = true;
          uploaded.push(doc);
          console.error("Inspection document cloud backup failed", error);
        }
      }
      const latestCars = getCars();
      const carIndex = latestCars.findIndex((car) => car.id === target.id);
      if (carIndex >= 0) {
        const nextHistory = historyOf(latestCars[carIndex]).map((item) => item.id === historyId ? { ...item, documents: uploaded } : item);
        latestCars[carIndex] = { ...latestCars[carIndex], inspectionHistory: nextHistory };
        saveJson("cars", latestCars);
      }
      if (cloudFailed) {
        alert("車検履歴は端末に保存しました。写真の一部はPrivate Blobへのバックアップに失敗したため、端末保存のみになっています。");
      }
    }

    window.DMVehicleInspection?.refresh?.();
    window.DMHomeDashboard?.refresh?.();
    window.dispatchEvent(new CustomEvent("dm-inspection-updated", { detail: { carId: target.id } }));
    renderPending();
    enhanceHistoryPhotos();
    button.textContent = "車検完了を保存";
    button.disabled = false;

    if (!(documents.length && lineLinked())) {
      alert(nextExpiry
        ? "車検履歴を保存し、次回満了日の通知へ切り替えました。"
        : "車検履歴を保存し、今回分の残り通知を停止しました。次回満了日は後から登録できます。");
    } else {
      alert(nextExpiry
        ? "車検履歴と請求書写真を保存し、次回満了日の通知へ切り替えました。"
        : "車検履歴と請求書写真を保存しました。今回分の残り通知は停止しています。");
    }
  }

  function sortedHistory(car) {
    return historyOf(car).slice().sort((a, b) => String(b?.performedDate || b?.createdAt || "").localeCompare(String(a?.performedDate || a?.createdAt || ""))).slice(0, 8);
  }

  function enhanceHistoryPhotos() {
    const list = document.getElementById(HISTORY_ID);
    if (!list) return;
    const history = sortedHistory(currentCar());
    const rows = [...list.children].filter((node) => node instanceof HTMLElement);
    rows.forEach((row, index) => {
      const item = history[index];
      if (!item || row.querySelector("[data-dm-history-docs]")) return;
      const docs = Array.isArray(item.documents) ? item.documents : [];
      if (!docs.length) return;
      const wrap = document.createElement("div");
      wrap.dataset.dmHistoryDocs = "1";
      wrap.style.cssText = "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:8px";
      docs.slice(0, 3).forEach((doc) => {
        const button = document.createElement("button");
        button.type = "button";
        button.style.cssText = "height:72px;padding:0;border:1px solid rgba(127,127,127,.24);border-radius:9px;overflow:hidden;background:rgba(0,0,0,.22);color:inherit;cursor:pointer";
        const src = localUrl(doc);
        button.innerHTML = src
          ? `<img src="${escapeHtml(src)}" alt="請求書" style="display:block;width:100%;height:100%;object-fit:cover">`
          : `<span style="font-size:10px;opacity:.7">${doc.cloudPathname ? "☁ 請求書" : "請求書"}</span>`;
        button.addEventListener("click", () => openViewer(doc));
        wrap.appendChild(button);
      });
      row.appendChild(wrap);
    });
  }

  async function openViewer(doc) {
    const url = await documentUrl(doc);
    if (!url) {
      alert(doc?.cloudPathname && !lineLinked()
        ? "この写真はクラウド保存されています。RE:CORDARE公式LINEと再連携すると表示できます。"
        : "写真を読み込めませんでした。");
      return;
    }
    document.getElementById("dmInspectionDocumentViewer")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "dmInspectionDocumentViewer";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483644;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:18px";
    overlay.innerHTML = `
      <button type="button" aria-label="閉じる" style="position:absolute;top:max(16px,env(safe-area-inset-top));right:16px;width:42px;height:42px;border:0;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;font-size:28px">×</button>
      <img src="${escapeHtml(url)}" alt="請求書写真" style="max-width:100%;max-height:88vh;object-fit:contain;border-radius:8px" />
    `;
    overlay.querySelector("button")?.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  function loadOcrLibrary() {
    if (window.Tesseract?.createWorker) return Promise.resolve(window.Tesseract);
    if (ocrLoadingPromise) return ocrLoadingPromise;
    ocrLoadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = OCR_SCRIPT;
      script.async = true;
      script.onload = () => window.Tesseract?.createWorker ? resolve(window.Tesseract) : reject(new Error("OCRライブラリを読み込めませんでした。"));
      script.onerror = () => reject(new Error("OCRライブラリをダウンロードできませんでした。通信状態を確認してください。"));
      document.head.appendChild(script);
    });
    return ocrLoadingPromise;
  }

  function normalizeOcrDate(year, month, day) {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (y < 2020 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return "";
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function extractDateAfterLabel(text, labels) {
    const label = labels.join("|");
    const regexp = new RegExp(`(?:${label})[^0-9]{0,30}(20\\d{2})[\\/年.\\- ]{1,3}(\\d{1,2})[\\/月.\\- ]{1,3}(\\d{1,2})`, "i");
    const match = text.match(regexp);
    return match ? normalizeOcrDate(match[1], match[2], match[3]) : "";
  }

  function extractAmount(text) {
    const patterns = [
      /(?:ご?請求(?:金額)?|総合計|合計金額|お支払(?:い)?(?:金額)?)[^0-9]{0,25}([0-9][0-9,]{2,})\s*円?/i,
      /(?:税込合計|合計)[^0-9]{0,18}([0-9][0-9,]{2,})\s*円?/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = Number(match[1].replaceAll(",", ""));
      if (Number.isFinite(value) && value >= 1000 && value <= 5000000) return Math.round(value);
    }
    return null;
  }

  async function ensureOcrWorker(status) {
    if (ocrWorker) return ocrWorker;
    const Tesseract = await loadOcrLibrary();
    status.textContent = "OCR日本語データを準備中…（初回は少し時間がかかります）";
    ocrWorker = await Tesseract.createWorker("jpn+eng", undefined, {
      logger(message) {
        if (message?.status === "recognizing text") {
          status.textContent = `OCR読み取り中… ${Math.round(Number(message.progress || 0) * 100)}%`;
        }
      },
    });
    return ocrWorker;
  }

  async function runOcr(event) {
    const button = event.currentTarget;
    const status = document.getElementById("dmInspectionDocumentStatus");
    const resultBox = document.getElementById("dmInspectionOcrResult");
    const textBox = document.getElementById("dmInspectionOcrText");
    if (!pendingDocs.length) {
      alert("先に請求書・明細写真を1枚追加してください。");
      return;
    }
    button.disabled = true;
    try {
      status.textContent = "OCRを準備中…画像は端末内で読み取ります。";
      const worker = await ensureOcrWorker(status);
      const blob = await localBlob(pendingDocs[0].localRef);
      if (!blob) throw new Error("OCR対象の写真を読み込めませんでした。");
      const url = URL.createObjectURL(blob);
      let result;
      try {
        result = await worker.recognize(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const text = String(result?.data?.text || "").trim();
      if (!text) throw new Error("文字を読み取れませんでした。写真を正面から明るく撮り直してみてください。");

      const amount = extractAmount(text);
      const performedDate = extractDateAfterLabel(text, ["車検実施日", "検査日", "作業日", "入庫日", "発行日"]);
      const nextExpiry = extractDateAfterLabel(text, ["車検満了日", "有効期間の満了する日", "有効期間満了日"]);
      const applied = [];
      const costInput = document.getElementById("dmInspectionCost");
      const performedInput = document.getElementById("dmInspectionPerformedDate");
      const nextInput = document.getElementById("dmInspectionNextExpiry");
      if (amount && costInput) {
        costInput.value = String(amount);
        applied.push(`金額 ${amount.toLocaleString("ja-JP")}円`);
      }
      if (performedDate && performedInput) {
        performedInput.value = performedDate;
        applied.push(`実施日 ${performedDate.replaceAll("-", "/")}`);
      }
      if (nextExpiry && nextInput) {
        nextInput.value = nextExpiry;
        applied.push(`次回満了日 ${nextExpiry.replaceAll("-", "/")}`);
      }
      if (textBox) textBox.textContent = text.slice(0, 8000);
      if (resultBox) resultBox.style.display = "block";
      status.textContent = applied.length
        ? `OCR候補を入力しました：${applied.join(" / ")}。誤読する場合があるため保存前に確認してください。`
        : "OCRは完了しました。自動入力できる項目を特定できなかったため、読み取り結果を確認してください。";
    } catch (error) {
      status.textContent = error?.message || "OCRに失敗しました。";
      alert(status.textContent);
    } finally {
      button.disabled = false;
    }
  }

  function scheduleRefresh() {
    if (observerQueued) return;
    observerQueued = true;
    requestAnimationFrame(() => {
      observerQueued = false;
      ensureUi();
      enhanceHistoryPhotos();
    });
  }

  function init() {
    if (!ensureUi()) {
      const timer = setInterval(() => {
        if (ensureUi()) clearInterval(timer);
      }, 100);
      setTimeout(() => clearInterval(timer), 12000);
    }
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("dm-inspection-updated", scheduleRefresh);
    window.addEventListener("pagehide", () => {
      cloudObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      cloudObjectUrls.clear();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
