(() => {
  const originalRenderPreparationState = renderPreparationState;

  const resetOptionLabels = {
    front_glass_scale: "フロントガラス ウロコ除去",
    all_glass_scale: "全面ガラス ウロコ除去",
  };

  const preparationItemsByCourse = {
    rinseless: [
      "純水・給水まわり",
      "リンスレス洗浄液",
      "洗車用スポンジ・クロス",
      "拭き上げ用マイクロファイバー",
    ],
    maintenance: [
      "純水・給水まわり",
      "プレウォッシュ・洗浄用品",
      "メンテナンス用ケミカル",
      "マイクロファイバー",
    ],
    standard: [
      "純水・給水まわり",
      "プレウォッシュ・洗浄用品",
      "コーティング・撥水剤",
      "マイクロファイバー",
    ],
    reset_coat: [
      "純水・給水まわり",
      "プレウォッシュ・洗浄用品",
      "下地処理ケミカル",
      "コーティング剤",
      "マイクロファイバー",
    ],
  };

  const preparationItemsByOption = {
    front_glass_oil_repellent: ["ガラス用油膜除去剤・撥水剤"],
    front_glass_scale: ["フロントガラス用ウロコ除去剤・施工用品"],
    all_glass_oil_repellent: ["ガラス用油膜除去剤・撥水剤"],
    all_glass_scale: ["全面ガラス用ウロコ除去剤・施工用品"],
    body_iron_removal: ["鉄粉除去剤"],
    wheel_scale_light: ["ホイール用スケール除去剤・ブラシ類"],
    wheel_scale_heavy: ["ホイール用スケール除去剤・ブラシ類"],
    unpainted_resin_partial: ["未塗装樹脂コーティング剤・施工用品"],
    unpainted_resin_wide: ["未塗装樹脂コーティング剤・施工用品"],
  };

  const optionLabel = (courseCode, item) => {
    if (courseCode === "reset_coat" && resetOptionLabels[item.code]) return resetOptionLabels[item.code];
    const master = reservationOptions.find((option) => option.code === item.code);
    return master?.label || (item.name && item.name !== item.code ? item.name : item.code);
  };

  const preparationItems = (record) => {
    const items = [...(preparationItemsByCourse[record.course_code] || [])];
    jsonArray(record.selected_options).forEach((option) => {
      (preparationItemsByOption[option.code] || []).forEach((item) => items.push(item));
    });
    return [...new Set(items)];
  };

  renderPreparationState = async function (recordId, record, preparationSession) {
    await originalRenderPreparationState(recordId, record, preparationSession);

    const startButton = document.getElementById("startServiceButton");
    const detailCard = startButton?.closest(".detail-card");
    if (!startButton || !detailCard) return;

    const options = jsonArray(record.selected_options);
    const optionText = options.length
      ? options.map((item) => optionLabel(record.course_code, item)).filter(Boolean).join("、")
      : "なし";
    const optionTerm = [...detailCard.querySelectorAll("dt")].find((element) => element.textContent.trim() === "オプション");
    if (optionTerm?.nextElementSibling) optionTerm.nextElementSibling.textContent = optionText;

    const checklistItems = preparationItems(record);
    if (checklistItems.length && !document.getElementById("servicePreparationChecklist")) {
      const checklist = document.createElement("section");
      checklist.className = "card";
      checklist.id = "servicePreparationChecklist";
      checklist.innerHTML = `<h2>準備物</h2><p class="muted">コースとオプションから自動表示しています。準備できたものをタップして確認できます。</p>${checklistItems.map((item, index) => `<div class="pricing-choice"><label class="pricing-choice-main" for="servicePreparationItem${index}"><input type="checkbox" id="servicePreparationItem${index}" /><span><strong>${escapeHtml(item)}</strong></span></label></div>`).join("")}`;
      detailCard.insertAdjacentElement("afterend", checklist);
    }

    if (!document.getElementById("cancelPreparationButton")) {
      const cancelButton = document.createElement("button");
      cancelButton.className = "text-button";
      cancelButton.type = "button";
      cancelButton.id = "cancelPreparationButton";
      cancelButton.textContent = "準備前に戻す";
      startButton.insertAdjacentElement("afterend", cancelButton);
      cancelButton.addEventListener("click", async () => {
        if (!confirm("準備開始を取り消して、準備前に戻しますか？")) return;
        cancelButton.disabled = true;
        cancelButton.textContent = "戻しています…";
        const { error } = await supabase.from("service_sessions")
          .update({ ended_at: new Date().toISOString(), status: "interrupted" })
          .eq("id", preparationSession.id)
          .eq("status", "active")
          .is("ended_at", null);
        if (error) {
          cancelButton.disabled = false;
          cancelButton.textContent = "準備前に戻す";
          return alert(saveErrorMessage(error));
        }
        clearServiceElapsed();
        await renderServiceDetail(recordId);
      });
    }
  };
})();
