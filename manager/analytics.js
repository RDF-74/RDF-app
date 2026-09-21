(() => {
  const money = (value) => `¥${Math.round(Number(value || 0)).toLocaleString("ja-JP")}`;
  const percent = (num, den) => den > 0 ? `${Math.round((num / den) * 100)}%` : "--";
  const dateKey = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  const addDaysKey = (key, days) => {
    const [y, m, d] = String(key).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return dateKey(date);
  };
  const periodBounds = (kind) => {
    const now = new Date();
    const today = dateKey(now);
    if (kind === "month") {
      return {
        start: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)),
        end: dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
        label: "今月",
      };
    }
    if (kind === "prev") {
      return {
        start: dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        end: dateKey(new Date(now.getFullYear(), now.getMonth(), 0)),
        label: "先月",
      };
    }
    if (kind === "year") {
      return {
        start: `${now.getFullYear()}-01-01`,
        end: `${now.getFullYear()}-12-31`,
        label: `${now.getFullYear()}年`,
      };
    }
    return { start: "0001-01-01", end: "9999-12-31", label: "全期間", today };
  };
  const inRange = (key, bounds) => key && key >= bounds.start && key <= bounds.end;
  const relationDate = (row) => String(row?.service_date || "").slice(0, 10);
  const revenueOf = (row) => Number(row?.actual_total ?? row?.planned_total ?? 0);

  const renderLoading = () => {
    const target = document.getElementById("managerContent");
    if (target) target.innerHTML = '<div class="card placeholder"><p class="muted">売上・分析を読み込んでいます…</p></div>';
  };

  const monthlyRows = (completed) => {
    const now = new Date();
    const rows = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const items = completed.filter((row) => relationDate(row).startsWith(key));
      const revenue = items.reduce((sum, row) => sum + revenueOf(row), 0);
      rows.push({
        key,
        label: `${d.getMonth() + 1}月`,
        count: items.length,
        revenue,
        average: items.length ? revenue / items.length : 0,
      });
    }
    return rows;
  };

  const computeRevisit = (allCompleted, periodCompleted, days, today) => {
    let eligible = 0;
    let revisited = 0;
    for (const row of periodCompleted) {
      const serviceDate = relationDate(row);
      if (!serviceDate || addDaysKey(serviceDate, days) > today) continue;
      eligible += 1;
      const next = allCompleted.find((candidate) =>
        candidate.customer_id === row.customer_id &&
        relationDate(candidate) > serviceDate
      );
      if (next && relationDate(next) <= addDaysKey(serviceDate, days)) revisited += 1;
    }
    return { eligible, revisited };
  };

  const buildNewRepeat = (allCompleted, periodCompleted) => {
    let newCount = 0;
    let repeatCount = 0;
    for (const row of periodCompleted) {
      const serviceDate = relationDate(row);
      const hadEarlier = allCompleted.some((candidate) =>
        candidate.customer_id === row.customer_id &&
        relationDate(candidate) < serviceDate
      );
      if (hadEarlier) repeatCount += 1;
      else newCount += 1;
    }
    return { newCount, repeatCount };
  };

  async function renderManagerAnalytics(period = "month") {
    activeTab = "ホーム";
    renderLoading();
    const target = document.getElementById("managerContent");
    if (!target) return;

    const bounds = periodBounds(period);
    const today = dateKey(new Date());

    const [
      { data: services, error: serviceError },
      { data: reservations, error: reservationError },
    ] = await Promise.all([
      supabase.from("service_records")
        .select("id,customer_id,service_date,course_code,planned_total,actual_total,status,is_active")
        .eq("is_active", true)
        .eq("status", "completed")
        .order("service_date", { ascending: true }),
      supabase.from("reservations")
        .select("id,reservation_date,status,is_active")
        .eq("is_active", true)
        .order("reservation_date", { ascending: true }),
    ]);

    if (serviceError || reservationError) {
      target.innerHTML = '<div class="card"><p class="error">売上・分析データを読み込めませんでした。</p><button class="secondary" type="button" id="analyticsBack">ホームへ戻る</button></div>';
      document.getElementById("analyticsBack")?.addEventListener("click", renderManager);
      return;
    }

    const allCompleted = (services || []).filter((row) => relationDate(row));
    const periodCompleted = allCompleted.filter((row) => inRange(relationDate(row), bounds));
    const periodReservations = (reservations || []).filter((row) => inRange(String(row.reservation_date || "").slice(0, 10), bounds));

    const serviceIds = periodCompleted.map((row) => row.id);
    let usages = [];
    let usageError = null;
    if (serviceIds.length) {
      const usageResult = await supabase.from("service_chemical_usages")
        .select("service_record_id,known_cost_amount,unknown_cost_applied_amount,cost_status")
        .in("service_record_id", serviceIds);
      usages = usageResult.data || [];
      usageError = usageResult.error;
    }

    const revenue = periodCompleted.reduce((sum, row) => sum + revenueOf(row), 0);
    const average = periodCompleted.length ? revenue / periodCompleted.length : 0;
    const knownChemicalCost = usages.reduce((sum, row) => sum + Number(row.known_cost_amount || 0), 0);
    const hasUnknownCost = usages.some((row) => Number(row.unknown_cost_applied_amount || 0) > 0 || row.cost_status === "unknown");
    const grossProfit = revenue - knownChemicalCost;
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    const { newCount, repeatCount } = buildNewRepeat(allCompleted, periodCompleted);
    const cancelled = periodReservations.filter((row) => row.status === "cancelled").length;
    const validReservationCount = periodReservations.length;
    const revisit30 = computeRevisit(allCompleted, periodCompleted, 30, today);
    const revisit45 = computeRevisit(allCompleted, periodCompleted, 45, today);
    const revisit60 = computeRevisit(allCompleted, periodCompleted, 60, today);
    const revisit90 = computeRevisit(allCompleted, periodCompleted, 90, today);
    const months = monthlyRows(allCompleted);

    target.innerHTML = `
      <div class="card">
        <div class="detail-heading">
          <div><h2>売上・分析</h2><p class="muted">施工完了データを基準に集計します。</p></div>
          <button class="secondary compact-button" type="button" id="analyticsBack">ホーム</button>
        </div>
        <label for="analyticsPeriod">集計期間</label>
        <select id="analyticsPeriod">
          <option value="month" ${period === "month" ? "selected" : ""}>今月</option>
          <option value="prev" ${period === "prev" ? "selected" : ""}>先月</option>
          <option value="year" ${period === "year" ? "selected" : ""}>今年</option>
          <option value="all" ${period === "all" ? "selected" : ""}>全期間</option>
        </select>
      </div>

      <section class="card">
        <h2>${escapeHtml(bounds.label)}の売上</h2>
        <dl>
          <dt>売上</dt><dd><strong>${escapeHtml(money(revenue))}</strong></dd>
          <dt>施工件数</dt><dd>${periodCompleted.length}件</dd>
          <dt>平均単価</dt><dd>${escapeHtml(money(average))}</dd>
          <dt>ケミカル原価</dt><dd>${usageError ? "取得失敗" : escapeHtml(money(knownChemicalCost))}</dd>
          <dt>粗利益（暫定）</dt><dd>${usageError ? "--" : escapeHtml(money(grossProfit))}</dd>
          <dt>利益率（暫定）</dt><dd>${usageError || revenue <= 0 ? "--" : `${Math.round(grossMargin)}%`}</dd>
        </dl>
        <p class="muted">粗利益は登録済みケミカル原価のみを差し引いた暫定値です。燃料・人件費・その他経費${hasUnknownCost ? "・原価不明の使用分" : ""}は含みません。</p>
      </section>

      <section class="card">
        <h2>顧客・予約</h2>
        <dl>
          <dt>リピート率</dt><dd>${escapeHtml(percent(repeatCount, newCount + repeatCount))}</dd>
          <dt>新規 / リピーター</dt><dd>${newCount}件 / ${repeatCount}件</dd>
          <dt>キャンセル率</dt><dd>${escapeHtml(percent(cancelled, validReservationCount))}（${cancelled}/${validReservationCount}件）</dd>
          <dt>紹介率</dt><dd>未計測</dd>
        </dl>
        <p class="muted">リピートは、その施工より前に完了施工があるお客様として集計します。紹介率は紹介者の保存項目がまだないため推測せず未計測です。</p>
      </section>

      <section class="card">
        <h2>再来店率</h2>
        <dl>
          <dt>30日以内</dt><dd>${escapeHtml(percent(revisit30.revisited, revisit30.eligible))}（${revisit30.revisited}/${revisit30.eligible}件）</dd>
          <dt>45日以内</dt><dd>${escapeHtml(percent(revisit45.revisited, revisit45.eligible))}（${revisit45.revisited}/${revisit45.eligible}件）</dd>
          <dt>60日以内</dt><dd>${escapeHtml(percent(revisit60.revisited, revisit60.eligible))}（${revisit60.revisited}/${revisit60.eligible}件）</dd>
          <dt>90日以内</dt><dd>${escapeHtml(percent(revisit90.revisited, revisit90.eligible))}（${revisit90.revisited}/${revisit90.eligible}件）</dd>
        </dl>
        <p class="muted">まだ30/45/60/90日が経過していない施工は、それぞれの母数から除外しています。</p>
      </section>

      <section class="card">
        <h2>直近6か月</h2>
        ${months.map((row) => `<div class="vehicle-row"><div><strong>${escapeHtml(row.label)}</strong><small>売上 ${escapeHtml(money(row.revenue))} ・ ${row.count}件 ・ 平均 ${escapeHtml(money(row.average))}</small></div></div>`).join("")}
      </section>
    `;

    document.getElementById("analyticsBack")?.addEventListener("click", renderManager);
    document.getElementById("analyticsPeriod")?.addEventListener("change", (event) => {
      renderManagerAnalytics(event.target.value);
    });
  }

  window.RECORDARE_MANAGER_ANALYTICS = Object.freeze({ open: renderManagerAnalytics });
})();
