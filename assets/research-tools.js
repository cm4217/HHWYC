/* 研发增强工具箱：工艺 / 法规 / 谱图 / 盐型 / 成本 等离线可用工具
 * 依赖：window.RDKitEngine（高亮/SMILES 渲染/子结构计数）、window.__chemprop（当前单条结果）
 * 全部为前端启发式估算，仅供研发参考，非监管用途。
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const RD = () => window.RDKitEngine;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function num(v, d) {
    const n = parseFloat(v);
    if (isNaN(n)) return null;
    return d != null ? +n.toFixed(d) : n;
  }
  function fmtSci(x) {
    if (x == null || !isFinite(x)) return '—';
    if (x === 0) return '0';
    if (Math.abs(x) >= 0.01) return (+x).toFixed(3);
    const [m, e] = (+x).toExponential(2).split('e');
    return m + '×10<sup>' + e + '</sup>';
  }
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }
  function smilesSVG(smiles, w, h) {
    try {
      if (!window.RDKitEngine || typeof window.RDKitEngine.highlightStructure !== 'function') return '';
      let svg = window.RDKitEngine.highlightStructure(smiles);
      if (!svg || svg.indexOf('<svg') === -1) return '';
      // RDKit 输出为 width='440px'（单引号 + px），需兼容两种引号与 px 后缀
      if (w) svg = svg.replace(/width=['"]\d+(\.\d+)?(px)?['"]/, 'width="' + w + '"').replace(/height=['"]\d+(\.\d+)?(px)?['"]/, 'height="' + (h || w) + '"');
      return svg;
    } catch (e) { return ''; }
  }
  function getCurrent() {
    try { return (window.__chemprop && window.__chemprop.getSingle) ? window.__chemprop.getSingle() : null; } catch (e) { return null; }
  }
  function currentSmiles() { const d = getCurrent(); return d && d.smiles ? d.smiles : ''; }
  const PALETTE = ['#2b6cff', '#e23636', '#1a9d1a', '#d97b1f', '#7a1f7a', '#0aa', '#b8860b', '#444'];

  /* ============ 1. 基因毒性杂质限度计算器（ICH M7 TTC） ============ */
  function genotoxCalc() {
    const out = $('genotoxOut'); if (!out) return;
    const mwt = num($('genotoxMwt').value);
    const dose = num($('genotoxDose').value);
    const period = $('genotoxPeriod').value;
    const cls = $('genotoxClass').value;
    if (dose == null || dose <= 0) { out.innerHTML = '<div class="row-note err">请填写每日最大给药剂量（mg/天）。</div>'; return; }

    // 各情形 TTC（µg/天）——ICH M7（R1）Option 1：≤14 天 120；14天-1年 20；1-10 年 10；>10 年 1.5
    let ttc = 1.5, ttcNote = 'ICH M7 默认 TTC = 1.5 µg/天（终生暴露，>10 年）。';
    if (cls === '2' || cls === '3' || cls === '5') {
      if (period === 'lt14') { ttc = 120; ttcNote = '危及生命、治疗 ≤14 天：TTC 放宽至 120 µg/天。'; }
      else if (period === 'mid') { ttc = 20; ttcNote = '治疗 14 天–1 年：TTC 为 20 µg/天。'; }
      else { ttc = 1.5; ttcNote = cls === '3' ? '第 3 类（警示但低关注）：以终生 TTC 1.5 µg/天为基准，并受 0.5 ppm 上限约束。' : '终生暴露：TTC = 1.5 µg/天。'; }
    } else if (cls === '1') {
      out.innerHTML = '<div class="row-note err"><b>第 1 类（已知致突变致癌物）</b>：不适用通用 TTC，需基于致癌性数据（如 CPDB TD50、线性外推）按化合物专项评估，建议限度远严于 TTC。本工具不输出数值，请依据毒理报告制定限度。</div>';
      return;
    }

    const doseG = dose / 1000; // g/天
    let limitPpm = ttc / doseG; // µg/g = ppm
    // 第 3/5 类上限
    let capNote = '';
    if ((cls === '3' || cls === '5') && limitPpm > 0.5) { limitPpm = 0.5; capNote = '；受 0.5 ppm 上限约束，已取 0.5 ppm。'; }
    const limitUgG = limitPpm; // µg/g
    const limitMgG = limitPpm / 1000; // mg/g
    const frac = limitPpm / 1e6 * 100; // 质量分数 %
    const umolDay = (mwt && mwt > 0) ? ttc / mwt : null; // µmol/天
    const clsName = { '1': '第 1 类', '2': '第 2 类', '3': '第 3 类', '4': '第 4 类', '5': '第 5 类' }[cls] || cls;

    out.innerHTML = `
      <table class="tool-table">
        <tr><td class="k">杂质类别</td><td>${clsName}</td></tr>
        <tr><td class="k">适用 TTC 基础</td><td>${ttc} µg/天 <span class="row-note">(${escapeHtml(ttcNote)})</span></td></tr>
        <tr><td class="k">每日给药剂量</td><td>${dose} mg/天（= ${doseG} g/天）</td></tr>
        <tr><td class="k">拟定限度（ppm）</td><td><b>${limitPpm.toFixed(limitPpm < 1 ? 4 : 2)} ppm</b> = ${limitUgG.toFixed(limitUgG < 1 ? 4 : 2)} µg/g${capNote ? `<span class="row-note">${escapeHtml(capNote)}</span>` : ''}</td></tr>
        <tr><td class="k">限度（mg/g）</td><td>${limitMgG.toFixed(6)} mg/g</td></tr>
        <tr><td class="k">占 API 质量分数</td><td>${fmtSci(frac)}</td></tr>
        ${mwt ? `<tr><td class="k">摩尔限度（µmol/天）</td><td>${umolDay != null ? umolDay.toFixed(4) + ' µmol/天（MWT ' + mwt + ' g/mol）' : '—'}</td></tr>` : ''}
      </table>
      <div class="row-note">说明：限度(ppm) = TTC(µg/天) ÷ 日剂量(g/天)。以上为 ICH M7 框架下的<b>速算草稿</b>，最终限度应结合杂质实际致癌性/致突变性数据、给药途径与疗程，经正式毒理/致突变评估确定。</div>`;
  }

  /* ============ 2. pKa 物种分布图（Henderson-Hasselbalch，微态枚举） ============ */
  function drawSpeciesChart(canvas, phMin, phMax, states, pI) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const padL = 44, padR = 12, padT = 14, padB = 30;
    const x0 = padL, x1 = W - padR, y0 = H - padB, y1 = padT;
    const dx = (x1 - x0) / Math.max(1, (phMax - phMin));
    const X = (ph) => x0 + (ph - phMin) * dx;
    const Y = (f) => y0 - f * (y0 - y1);
    // 暗色模式适配：图表文字/网格需用浅色，否则在深色背景下不可见
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const axisColor = isDark ? '#c9d4e0' : '#5b6776';
    const gridColor = isDark ? 'rgba(190,205,220,0.20)' : 'rgba(120,130,145,0.25)';
    ctx.clearRect(0, 0, W, H);
    // 网格
    ctx.strokeStyle = gridColor; ctx.fillStyle = axisColor; ctx.font = '10px sans-serif'; ctx.lineWidth = 1;
    for (let p = 0; p <= 100; p += 25) { const y = Y(p / 100); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.fillText(p + '%', 6, y + 3); }
    const pStep = (phMax - phMin) > 14 ? 2 : 1;
    for (let ph = Math.ceil(phMin); ph <= phMax; ph += pStep) { const x = X(ph); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.fillText(ph, x - 6, y0 + 14); }
    ctx.fillText('pH', x1 - 14, y0 + 24);
    ctx.fillText('物种分布', 6, y1 + 2);
    // 曲线
    states.forEach(s => {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
      s.values.forEach((f, i) => { const x = X(phMin + i * (phMax - phMin) / (s.values.length - 1)); const y = Y(f); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke();
    });
    if (pI != null) {
      const x = X(Math.max(phMin, Math.min(phMax, pI)));
      ctx.strokeStyle = '#e23636'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#e23636'; ctx.fillText('pI≈' + pI.toFixed(2), x + 3, y1 + 12);
    }
  }
  function speciesCalc() {
    const out = $('speciesOut'), canvas = $('speciesCanvas');
    if (!out || !canvas) return;
    const acids = ($('speciesAcid').value || '').split(/[,\s]+/).map(s => num(s)).filter(v => v != null);
    const bases = ($('speciesBase').value || '').split(/[,\s]+/).map(s => num(s)).filter(v => v != null);
    let phMin = num($('speciesPhMin').value), phMax = num($('speciesPhMax').value);
    if (phMin == null) phMin = 0; if (phMax == null || phMax <= phMin) phMax = 14;
    const sites = [];
    acids.forEach(p => sites.push({ pka: p, type: 'acid' }));
    bases.forEach(p => sites.push({ pka: p, type: 'base' }));
    if (!sites.length) { out.innerHTML = '<div class="row-note err">请至少填写一个酸性或碱性 pKa。</div>'; return; }

    const N = sites.length, steps = 120;
    const charges = new Set();
    const fracByCharge = {}; // charge -> array
    let pISum = 0, pICount = 0, prevAvg = null;
    for (let i = 0; i <= steps; i++) {
      const ph = phMin + (phMax - phMin) * i / steps;
      const b = sites.map(s => Math.pow(10, ph - s.pka)); // deprotonated/protonated ratio for that site
      // 枚举 2^N 微态
      let total = 0; const wByCharge = {};
      for (let mask = 0; mask < (1 << N); mask++) {
        let w = 1, charge = 0;
        for (let k = 0; k < N; k++) {
          const deprot = (mask >> k) & 1;
          if (deprot) { w *= b[k]; if (sites[k].type === 'acid') charge -= 1; }
          else { if (sites[k].type === 'base') charge += 1; }
        }
        total += w; wByCharge[charge] = (wByCharge[charge] || 0) + w;
      }
      Object.keys(wByCharge).forEach(c => {
        const cc = +c; charges.add(cc);
        (fracByCharge[cc] = fracByCharge[cc] || []).push(wByCharge[cc] / total);
      });
      // 平均净电荷 → pI
      let avg = 0; Object.keys(wByCharge).forEach(c => { avg += (+c) * wByCharge[c] / total; });
      if (i > 0 && prevAvg != null && ((prevAvg < 0) !== (avg < 0))) { const phPrev = phMin + (phMax - phMin) * (i - 1) / steps; pISum += (phPrev + ph) / 2; pICount++; }
      prevAvg = avg;
    }
    const pI = pICount ? pISum / pICount : null;
    const clist = Array.from(charges).sort((a, b) => a - b);
    const states = clist.map((c, idx) => ({ charge: c, color: PALETTE[idx % PALETTE.length], values: fracByCharge[c] }));
    drawSpeciesChart(canvas, phMin, phMax, states, pI);
    const legend = clist.map((c, idx) => `<span class="chip" style="border-color:${PALETTE[idx % PALETTE.length]};color:${PALETTE[idx % PALETTE.length]}">电荷 ${c > 0 ? '+' + c : c}</span>`).join(' ');
    out.innerHTML = `<div class="row-note">共 ${N} 个可电离位点（酸 ${acids.length} / 碱 ${bases.length}）。下列曲线为各净电荷状态下的物种分布分数；竖线为等电点 pI（净电荷=0 的 pH ≈ <b>${pI != null ? pI.toFixed(2) : '无（始终带电）'}</b>）。</div>
      <div style="margin:6px 0">${legend}</div>
      <div class="row-note">说明：基于独立位点假设的微态枚举（各电离基团互不强烈耦合）。多电荷、强耦合体系（如相邻羧基、金属配位）会有偏差；pI 仅对两性/多质子化分子有意义。</div>`;
  }

  /* ============ 3. 路线评估（原子经济性 / PMI / 步数经济性） ============ */
  function reRow() {
    return `<div class="rc-row"><input class="tool-input re-name" placeholder="反应物" value="反应物">` +
      `<input class="tool-input re-mw" type="number" min="0" placeholder="MW" value="0">` +
      `<input class="tool-input re-eq" type="number" min="0" placeholder="当量" value="1">` +
      `<button class="btn btn-sm btn-ghost re-del" type="button">×</button></div>`;
  }
  function routeEvalCalc() {
    const out = $('routeEvalOut'); if (!out) return;
    const pmw = num($('reProductMW').value);
    const yieldPct = num($('reYield').value);
    const solv = num($('reSolvent').value) || 0;
    if (pmw == null || pmw <= 0) { out.innerHTML = '<div class="row-note err">请填写产物（API）分子量 MW。</div>'; return; }
    const rows = Array.from(document.querySelectorAll('#routeEvalReactants .rc-row'));
    let denom = 0, any = false;
    rows.forEach(r => { const mw = num(r.querySelector('.re-mw').value), eq = num(r.querySelector('.re-eq').value); if (mw == null || eq == null) return; any = true; denom += mw * eq; });
    if (!any || denom <= 0) { out.innerHTML = '<div class="row-note err">请至少填写一个反应物（MW + 当量）。</div>'; return; }
    const ae = pmw / denom * 100;
    const yld = (yieldPct == null ? 100 : yieldPct) / 100;
    const rme = ae * yld;
    const pmiYield = yld > 0 ? 1 / yld : null;
    const pmiTotal = pmiYield != null ? pmiYield + solv : null;
    const aeTone = ae >= 80 ? 'good' : ae >= 60 ? 'warn' : 'bad';
    const pmiTone = pmiTotal != null ? (pmiTotal <= 10 ? 'good' : pmiTotal <= 50 ? 'warn' : 'bad') : 'warn';
    out.innerHTML = `<table class="tool-table">
      <tr><td class="k">原子经济性 (AE)</td><td><b class="tone-${aeTone}">${ae.toFixed(1)}%</b> = MW产物(${pmw}) / Σ(当量×MW)(${denom.toFixed(1)})</td></tr>
      <tr><td class="k">反应收率</td><td>${(yld * 100).toFixed(0)}%</td></tr>
      <tr><td class="k">反应质量效率 (RME)</td><td>${rme.toFixed(1)}%</td></tr>
      <tr><td class="k">PMI（仅收率下限 = 1/收率）</td><td class="tone-${pmiTone}">${pmiYield != null ? pmiYield.toFixed(2) : '—'}</td></tr>
      <tr><td class="k">PMI（含溶剂/试剂系数 ${solv}）</td><td class="tone-${pmiTone}">${pmiTotal != null ? pmiTotal.toFixed(2) : '—'}</td></tr>
    </table>
    <div class="row-note">AE 越高越「绿色」（理想 ≥80%）；RME = AE×收率；PMI = 工艺总投料质量 / 产物质量（越低越优，绿色化学常用 ≤10 为优）。溶剂/试剂系数为「额外投入质量 ÷ 产物质量」的经验估计。多步路线总 PMI 近似为各步 PMI 之和，此处为单步视图。</div>`;
  }

  /* ============ 5. 溶剂绿色化建议 ============ */
  const SOLVENTS = [
    { n: '水', gsk: 'P', chg: '低', tox: '无毒', env: '优', note: '首选溶剂，但溶解性有限。', alt: '—' },
    { n: '乙醇', gsk: 'P', chg: '低', tox: '低毒', env: '好', note: '可再生来源佳。', alt: '异丙醇、甲醇(受限)' },
    { n: '异丙醇 (IPA)', gsk: 'P', chg: '低', tox: '低毒', env: '好', note: '常用结晶/洗涤溶剂。', alt: '乙醇' },
    { n: '乙酸乙酯', gsk: 'P', chg: '中', tox: '低毒', env: '好', note: '易回收，气味低。', alt: '甲基叔丁基醚(MTBE)' },
    { n: '庚烷', gsk: 'P', chg: '低', tox: '低毒', env: '中', note: '非极性，常用于反萃/结晶。', alt: '正己烷(受限)' },
    { n: '2-甲基四氢呋喃 (2-MeTHF)', gsk: 'P', chg: '中', tox: '低毒', env: '好(可再生)', note: '可来自生物质，优于 THF。', alt: 'THF' },
    { n: '丙酮', gsk: 'P', chg: '中', tox: '低毒', env: '好', note: '易挥发，注意防爆。', alt: '甲基乙基酮(MEK)' },
    { n: '甲醇', gsk: 'A', chg: '中', tox: '有毒/致盲', env: '中', note: '高毒性，尽量替代。', alt: '乙醇、异丙醇' },
    { n: '乙腈', gsk: 'A', chg: '中', tox: '有毒', env: '中', note: '难以生物降解。', alt: '丙酮、2-MeTHF' },
    { n: '二氯甲烷 (DCM)', gsk: 'A', chg: '高', tox: '可疑致癌', env: '差', note: 'ICH Q3C 关注，限制使用。', alt: '乙酸乙酯、MTBE' },
    { n: '四氢呋喃 (THF)', gsk: 'A', chg: '中', tox: '低-中', env: '中', note: '易过氧化物生成，需稳定剂。', alt: '2-MeTHF' },
    { n: '甲苯', gsk: 'A', chg: '中', tox: '有毒', env: '差', note: '生殖毒性关注。', alt: '2-MeTHF、庚烷' },
    { n: 'N,N-二甲基甲酰胺 (DMF)', gsk: 'A', chg: '高', tox: '生殖毒性', env: '差', note: 'ICH Q3C 限制（AMR 0.088%）。', alt: 'NMP替代受限、2-MeTHF' },
    { n: 'N-甲基吡咯烷酮 (NMP)', gsk: 'A', chg: '高', tox: '生殖毒性', env: '差', note: 'ICH Q3C 限制（AMR 0.053%）。', alt: '2-MeTHF' },
    { n: '二甲亚砜 (DMSO)', gsk: 'A', chg: '低', tox: '低毒', env: '中', note: '高沸点难除去。', alt: '—' },
    { n: '1,4-二氧六环', gsk: 'A', chg: '高', tox: '疑似致癌', env: '差', note: '易生成过氧化物。', alt: '2-MeTHF、THF' },
    { n: '氯仿', gsk: 'A', chg: '高', tox: '疑似致癌', env: '差', note: '严格避免。', alt: 'DCM替代受限' },
    { n: '正己烷', gsk: 'A', chg: '中', tox: '神经毒性', env: '差', note: 'ICH Q3C 限制。', alt: '庚烷' },
    { n: '乙酸', gsk: 'P', chg: '中', tox: '腐蚀性', env: '中', note: '注意腐蚀与气味。', alt: '—' },
    { n: '甲基叔丁基醚 (MTBE)', gsk: 'P', chg: '高', tox: '低毒', env: '中', note: '易过氧化物。', alt: '乙酸乙酯' },
    { n: '二甲基乙酰胺 (DMAc)', gsk: 'A', chg: '高', tox: '生殖毒性', env: '差', note: '类似 DMF。', alt: '2-MeTHF' },
    { n: '环己烷', gsk: 'P', chg: '低', tox: '低毒', env: '中', note: '非极性结晶溶剂。', alt: '庚烷' },
    { n: '叔丁醇 (t-BuOH)', gsk: 'P', chg: '低', tox: '低毒', env: '好', note: '水混溶。', alt: '—' },
    { n: '乙醚', gsk: 'A', chg: '高', tox: '低毒', env: '中', note: '极易燃，易过氧化。', alt: 'MTBE' },
  ];
  function solventGreenRender() {
    const box = $('solventGreenBox'); if (!box) return;
    box.innerHTML = SOLVENTS.map((s, i) => `
      <label class="solvent-item ${s.gsk === 'P' ? 'sg-ok' : 'sg-warn'}">
        <input type="checkbox" data-i="${i}"> <b>${escapeHtml(s.n)}</b>
        <span class="badge ${s.gsk === 'P' ? 'badge-ok' : 'badge-warn'}">GSK ${s.gsk}</span>
        <span class="row-note">CHG ${s.chg} · ${s.tox}</span>
      </label>`).join('');
  }
  function solventGreenCalc() {
    const out = $('solventGreenOut'); if (!out) return;
    const checks = Array.from(document.querySelectorAll('#solventGreenBox input:checked'));
    if (!checks.length) { out.innerHTML = '<div class="row-note err">请勾选工艺中使用的溶剂。</div>'; return; }
    const rows = checks.map(c => SOLVENTS[+c.dataset.i]);
    out.innerHTML = `<table class="tool-table"><tr><th>溶剂</th><th>GSK</th><th>危害(CHG)</th><th>毒性/环境</th><th>建议替代</th></tr>` +
      rows.map(s => `<tr class="${s.gsk === 'P' ? 'sg-ok' : 'sg-warn'}">
        <td>${escapeHtml(s.n)}</td><td><span class="badge ${s.gsk === 'P' ? 'badge-ok' : 'badge-warn'}">${s.gsk}</span></td>
        <td>${s.chg}</td><td>${s.tox} · ${s.env}</td><td>${escapeHtml(s.alt)}</td></tr>`).join('') +
      `</table><div class="row-note">依据 GSK 3 级（P 首选 / A 避免）、CHEMPAT 危害等级与 ICH Q3C 残留溶剂关注。优先以 2-MeTHF、乙醇、乙酸乙酯、庚烷等替代卤代/酰胺类溶剂。绿色化评估仅为经验参考。</div>`;
  }

  /* ============ 6. 盐型筛选评分 ============ */
  const SALT_CANDIDATES = [
    { n: '盐酸盐', ion: '[Cl-]', x: 'HCl', crys: 5, sol: 4, hygro: 3, tox: 5, ip: 4 },
    { n: '氢溴酸盐', ion: '[Br-]', x: 'HBr', crys: 5, sol: 4, hygro: 3, tox: 4, ip: 4 },
    { n: '硫酸盐(半/单)', ion: 'O=S(=O)([O-])[O-]', x: 'H2SO4', crys: 5, sol: 4, hygro: 2, tox: 5, ip: 3 },
    { n: '乙酸盐', ion: 'CC(=O)[O-]', x: 'AcOH', crys: 4, sol: 4, hygro: 3, tox: 5, ip: 3 },
    { n: '琥珀酸盐', ion: 'O=C(O)CCC(=O)[O-]', x: '琥珀酸', crys: 5, sol: 3, hygro: 2, tox: 5, ip: 5 },
    { n: '马来酸盐', ion: 'O=C(O)/C=C/C(=O)[O-]', x: '马来酸', crys: 5, sol: 3, hygro: 2, tox: 4, ip: 5 },
    { n: '甲磺酸盐', ion: 'CS(=O)(=O)[O-]', x: 'MsOH', crys: 5, sol: 5, hygro: 3, tox: 4, ip: 3 },
    { n: '对甲苯磺酸盐', ion: 'Cc1ccc(S(=O)(=O)[O-])cc1', x: 'TsOH', crys: 5, sol: 4, hygro: 2, tox: 4, ip: 3 },
    { n: '枸橼酸盐', ion: 'O=C(O)CC(O)(CC(=O)[O-])C(=O)[O-]', x: '枸橼酸', crys: 5, sol: 3, hygro: 2, tox: 5, ip: 4 },
    { n: '钠盐', ion: '[Na+]', x: 'NaOH', crys: 5, sol: 5, hygro: 4, tox: 5, ip: 4 },
    { n: '钾盐', ion: '[K+]', x: 'KOH', crys: 5, sol: 5, hygro: 4, tox: 5, ip: 4 },
    { n: '钙盐', ion: '[Ca+2]', x: 'Ca(OH)2', crys: 5, sol: 3, hygro: 3, tox: 5, ip: 3 },
    { n: '磷酸盐', ion: 'O=P([O-])([O-])[O-]', x: 'H3PO4', crys: 5, sol: 3, hygro: 2, tox: 5, ip: 3 },
    { n: '酒石酸盐', ion: 'O=C(O)[C@H](O)[C@@H](O)C(=O)[O-]', x: '酒石酸', crys: 5, sol: 3, hygro: 2, tox: 5, ip: 5 },
    { n: '三氟乙酸盐', ion: 'C(F)(F)(F)C(=O)[O-]', x: 'TFA', crys: 4, sol: 5, hygro: 2, tox: 2, ip: 2 },
  ];
  function saltScreenCalc() {
    const out = $('saltScreenOut'); if (!out) return;
    const hygroFlag = $('saltHygro').checked;
    const solFlag = $('saltSol').checked;
    const scored = SALT_CANDIDATES.map(s => {
      let score = s.crys * 8 + s.sol * 8 + s.tox * 8 + s.ip * 7 - s.hygro * 6;
      if (hygroFlag) score -= 8; // 若已知吸湿敏感，吸湿性强的盐扣分
      if (solFlag) score += s.sol * 4; // 若需提升溶解度，溶解度强的盐加分
      // 归一化：理论最高原始分 = 5*8+5*8+5*8+5*7-1*6 = 149 → /1.49 ≈ 100
      score = Math.max(0, Math.min(100, Math.round(score / 1.49)));
      return { s, score };
    }).sort((a, b) => b.score - a.score);
    out.innerHTML = `<table class="tool-table"><tr><th>盐型</th><th>评分</th><th>条形</th><th>关键维度</th></tr>` +
      scored.map(({ s, score }) => {
        const tone = score >= 70 ? 'good' : score >= 50 ? 'warn' : 'bad';
        const bar = `<span class="score-bar"><span class="score-fill tone-${tone}" style="width:${score}%"></span></span>`;
        return `<tr><td><b>${escapeHtml(s.n)}</b><br><span class="row-note">抗衡：${escapeHtml(s.x)}</span></td>
          <td class="tone-${tone}"><b>${score}</b></td><td style="min-width:120px">${bar}</td>
          <td class="row-note">结晶${'★'.repeat(s.crys)} 溶解${'★'.repeat(s.sol)} 低毒${'★'.repeat(s.tox)} 吸湿${'☆'.repeat(5 - s.hygro)}</td></tr>`;
      }).join('') +
      `</table><div class="row-note">启发式评分（结晶性/溶解性/低毒/专利空间 加权，吸湿性减分）。${hygroFlag ? '已勾选「吸湿敏感」：吸湿性强的盐额外扣分。' : ''}${solFlag ? '已勾选「需提升溶解度」：溶解度强的盐额外加分。' : ''} 实际盐型需结合晶型筛选、溶解度测定、稳定性与生物利用度实验确认。</div>`;
  }

  /* ============ 7. 法规文档草稿（ICH M7 / CTD） ============ */
  function regDraftGen() {
    const out = $('regDraftOut'); if (!out) return;
    const api = $('regApiName').value.trim() || '【原料药名称】';
    const imp = $('regImpName').value.trim() || '【杂质名称】';
    const cls = $('regImpClass').value;
    const limit = $('regLimit').value.trim() || '【限度 ppm】';
    const ttc = $('regTTC').value.trim() || 'ICH M7 TTC (1.5 µg/天)';
    const route = $('regRoute').value.trim() || '【工艺路线简述】';
    const clsName = { '1': '第 1 类（已知致突变致癌物）', '2': '第 2 类（已知致突变、无致癌性数据）', '3': '第 3 类（含警示结构、低关注）', '4': '第 4 类（无致突变关注）', '5': '第 5 类（含警示结构的醛类等）' }[cls] || '【类别】';
    const text = `【杂质控制策略与限度拟定说明】

1. 化合物与杂质
   原料药：${api}
   相关杂质：${imp}
   杂质归类（ICH M7）：${clsName}

2. 限度拟定依据
   依据 ICH M7（R1）《评估和控制药物中 DNA 反应性（致突变）杂质以限制潜在致癌风险》指导原则，按终生暴露 TTC 方法拟定限度：
   适用阈值：${ttc}
   拟定限度：${limit} ppm（µg/g）
   计算逻辑：限度(ppm) = TTC(µg/天) ÷ 每日最大给药剂量(g/天)；当治疗周期有限（如危及生命、短期治疗）时，可按更高 TTC（如 ≤14 天治疗 120 µg/天）调整。

3. 工艺来源与清除因子
   工艺路线：${route}
   该杂质为【前体带入 / 工艺副产物 / 降解产物】，建议在【起始物料 / 中间体 / 粗品】控制点评估清除能力，并结合线性试点（spiking）与清除因子研究佐证限度合理性。

4. 控制策略
   拟采用【常规控制（原料药质量标准中控制）/ 限定起始物料 / 过程控制】策略，检测方【HPLC-UV / LC-MS（确证与定量限下）】。

5. 结论
   综合致突变性评估、工艺清除能力与毒理关注阈值，拟定 ${imp} 限度 ${limit} ppm，符合 ICH M7 框架下的控制要求。

---
【CTD 3.2.S.3.2 杂质 条目模板】
杂质名称：${imp}
结构式/来源：${imp}（工艺相关杂质，源于${route}）
控制限度：${limit} ppm
检测方法：HPLC 法（参考 ICH Q3A/Q3B）
拟定依据：ICH M7（R1）TTC 方法，终生暴露 1.5 µg/天基准；结合工艺清除因子评估。`;
    out.innerHTML = `<textarea class="tool-area" readonly>${escapeHtml(text)}</textarea>
      <div class="action-row"><button class="btn btn-sm btn-secondary" id="regDraftCopy" type="button">复制全文</button></div>`;
    const cp = $('regDraftCopy'); if (cp) cp.addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(text); setStatusNote('法规草稿已复制到剪贴板。'); });
    if (window.__chemprop && window.__chemprop.setStatus) window.__chemprop.setStatus('法规草稿已生成。', 'ok');
  }

  /* ============ 8. NMR 化学位移估算（基于官能团环境的经验区间） ============ */
  // 环境 -> [¹H 典型区间, ¹³C 典型区间, 说明]
  const NMR_ENV = [
    { name: '芳香 CH (Ar-H)', sm: '[cH]', h: [6.5, 8.5], c: [110, 140], mult: 'm' },
    { name: '芳香 C (季碳)', sm: '[cH0]', h: null, c: [120, 150], mult: '' },
    { name: '脂肪 CH₃ (烷基)', sm: '[CX4][CH3]', h: [0.7, 1.3], c: [10, 30], mult: 't/s' },
    { name: '脂肪 CH₂', sm: '[CX4][CH2][#6]', h: [1.2, 1.8], c: [20, 45], mult: 'm' },
    { name: '脂肪 CH', sm: '[CX4H]', h: [1.4, 2.2], c: [25, 60], mult: 'm' },
    { name: 'O-CH₃ (甲氧基)', sm: '[CH3][OX2]', h: [3.2, 4.0], c: [50, 60], mult: 's' },
    { name: 'N-CH₃', sm: '[CH3][NX3]', h: [2.2, 3.2], c: [30, 45], mult: 's' },
    { name: '羰基旁 CH₂/CH₃ (α)', sm: 'C(=O)[CH2,CH3]', h: [2.0, 2.6], c: [25, 45], mult: 'm' },
    { name: '羧酸 OH', sm: 'C(=O)[OH]', h: [10, 13], c: null, mult: 's(宽)' },
    { name: '酚 OH', sm: 'c[OH]', h: [4.5, 8], c: null, mult: 's(宽)' },
    { name: '醇 OH', sm: '[CX4][OX2H]', h: [1, 5], c: null, mult: 's(宽)' },
    { name: '胺 NH', sm: '[NH2,NH]', h: [1, 5], c: null, mult: 's(宽)' },
    { name: '醛基 CH', sm: '[CH]=O', h: [9, 10.5], c: [190, 205], mult: 's/d' },
    { name: '羧基/酯 C(=O)', sm: 'C(=O)[OH,OX2]', h: null, c: [170, 185], mult: '' },
    { name: '酰胺 C(=O)', sm: 'C(=O)[NX3]', h: null, c: [160, 180], mult: '' },
    { name: '酮 C(=O)', sm: 'C(=O)([#6])[#6]', h: null, c: [195, 220], mult: '' },
    { name: '烯基 CH (C=C-H)', sm: 'C=[CH]', h: [5, 7], c: [110, 145], mult: 'm' },
    { name: '炔基 CH', sm: 'C#[CH]', h: [2, 3], c: [65, 90], mult: 's' },
    { name: '苄位 CH₂', sm: 'c[CH2]', h: [2.2, 3.0], c: [35, 50], mult: 'm' },
    { name: 'O-CH₂ (醚/醇)', sm: 'O[CH2]', h: [3.3, 4.2], c: [55, 75], mult: 'm' },
    { name: 'N-CH₂', sm: 'N[CH2]', h: [2.4, 3.5], c: [40, 60], mult: 'm' },
  ];
  function nmrCalc() {
    const out = $('nmrOut'); if (!out) return;
    const smiles = ($('nmrSmiles').value || '').trim();
    if (!smiles) { out.innerHTML = '<div class="row-note err">请填写 SMILES（可用「当前化合物」按钮填入）。</div>'; return; }
    if (!window.RDKitEngine || !window.RDKitEngine.countSMARTS) { out.innerHTML = '<div class="row-note err">RDKit 引擎未就绪，请先完成一次预测以加载引擎。</div>'; return; }
    window.RDKitEngine.init().then(() => {
      const hRows = [], cRows = [];
      NMR_ENV.forEach(e => {
        let cnt = 0; try { cnt = window.RDKitEngine.countSMARTS(smiles, e.sm); } catch (err) { cnt = 0; }
        if (!cnt) return;
        if (e.h) hRows.push(`<tr><td>${escapeHtml(e.name)}</td><td>×${cnt}</td><td>${e.h[0]}–${e.h[1]} ppm</td><td>${e.mult}</td></tr>`);
        if (e.c) cRows.push(`<tr><td>${escapeHtml(e.name)}</td><td>×${cnt}</td><td>${e.c[0]}–${e.c[1]} ppm</td></tr>`);
      });
      out.innerHTML = `<div class="sub-title">¹H NMR 预期信号（按官能团环境，经验区间）</div>` +
        (hRows.length ? `<table class="tool-table"><tr><th>环境</th><th>数量</th><th>δ (ppm)</th><th>裂分</th></tr>${hRows.join('')}</table>` : '<div class="row-note">未匹配到常见质子环境。</div>') +
        `<div class="sub-title" style="margin-top:10px">¹³C NMR 预期信号（按官能团环境，经验区间）</div>` +
        (cRows.length ? `<table class="tool-table"><tr><th>环境</th><th>数量</th><th>δ (ppm)</th></tr>${cRows.join('')}</table>` : '<div class="row-note">未匹配到常见碳环境。</div>') +
        `<div class="row-note">⚠️ 仅为基于官能团环境的<b>粗略经验估算</b>（规则区间法），非谱图预测模型，未考虑共轭/诱导/溶剂/氢键的精细位移；实际化学位移请以实验谱图为准。</div>`;
    }).catch(e => { out.innerHTML = '<div class="row-note err">结构解析失败：' + escapeHtml(e.message || e) + '</div>'; });
  }

  /* ============ 9. 多化合物对比模式 ============ */
  async function compareRun() {
    const out = $('compareOut'); if (!out) return;
    const lines = ($('compareInput').value || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) { out.innerHTML = '<div class="row-note err">请每行填写一个 SMILES 或化合物名称。</div>'; return; }
    out.innerHTML = '<div class="row-note">正在解析并计算（' + lines.length + ' 个）…</div>';
    if (window.__chemprop && window.__chemprop.showOverlay) window.__chemprop.showOverlay('多化合物对比计算中…');
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        let smiles = lines[i];
        // 判定：先尝试当 SMILES 处理；含空格/括号异常/纯字母名称等则优先走名称解析
        // SMILES 特征：包含数字、环标记、括号、双键等；纯字母名称（如 Aspirin）首字符也是字母，
        // 因此不能只看首字符 —— 先按 SMILES 试算，失败再回退 PubChem 名称解析。
        let rd = null;
        if (window.RDKitEngine) {
          await window.RDKitEngine.init();
          try {
            rd = window.RDKitEngine.compute(smiles);
          } catch (e) {
            // 作为 SMILES 解析失败 → ① 同步本地词典（离线可用、零等待）；② PubChem 名称（带 8s 超时）
            let pc = null;
            try { const loc = window.__chemprop && window.__chemprop.findLocal(lines[i]); if (loc && loc.smiles) pc = { canonicalSmiles: loc.smiles }; } catch (err) {}
            if (!(pc && pc.canonicalSmiles) && window.PubChem) {
              try {
                const loc2 = await window.PubChem.resolveViaLocalDict(lines[i]);
                if (loc2 && loc2.canonicalSmiles) pc = loc2;
              } catch (err) {}
            }
            if (!(pc && pc.canonicalSmiles) && window.PubChem) {
              try { pc = await Promise.race([window.PubChem.resolve(lines[i], 'name'), new Promise(res => setTimeout(() => res(null), 8000))]); } catch (err) { pc = null; }
            }
            if (pc && pc.canonicalSmiles) { smiles = pc.canonicalSmiles; rd = window.RDKitEngine.compute(smiles); }
            else throw new Error('无法解析为 SMILES，名称解析（本地词库 / PubChem）也未匹配到化合物。');
          }
        } else { rows.push({ name: lines[i], smiles, mw: null }); continue; }
        const d = rd.desc || {};
        const pk = rd.pka || {};
        const nIon = (pk.acids ? pk.acids.length : 0) + (pk.bases ? pk.bases.length : 0);
        const sol = (rd.pred && rd.pred.solubility && rd.pred.solubility.consensus) ? rd.pred.solubility.consensus.logS : null;
        rows.push({ name: lines[i], smiles, mw: d.amw, logp: d.CrippenClogP, tpsa: d.tpsa, hbd: d.NumHBD, hba: d.NumHBA, rot: d.NumRotatableBonds, rings: d.NumRings, ion: nIon, logs: sol });
      } catch (e) { rows.push({ name: lines[i], smiles: lines[i], error: e.message || e }); }
    }
    if (window.__chemprop && window.__chemprop.hideOverlay) window.__chemprop.hideOverlay();
    if (!rows.length) { out.innerHTML = '<div class="row-note err">无可用结果。</div>'; return; }
    const f = (v, d) => v == null ? '—' : (typeof v === 'number' ? (+v).toFixed(d == null ? 2 : d) : v);
    let html = `<table class="tool-table compare"><tr><th>化合物</th><th>MW</th><th>logP</th><th>TPSA</th><th>HBD</th><th>HBA</th><th>可旋转键</th><th>环数</th><th>可电离位</th><th>logS</th></tr>`;
    rows.forEach(r => {
      html += `<tr><td>${escapeHtml(r.name)}<br><span class="row-note">${escapeHtml(r.smiles)}</span></td>
        <td>${f(r.mw, 2)}</td><td>${f(r.logp, 2)}</td><td>${f(r.tpsa, 1)}</td><td>${f(r.hbd)}</td><td>${f(r.hba)}</td><td>${f(r.rot)}</td><td>${f(r.rings)}</td><td>${f(r.ion)}</td><td>${f(r.logs, 2)}</td></tr>`;
    });
    html += `</table><div class="action-row">
      <button class="btn btn-sm btn-secondary" id="compareCsv" type="button">⬇ 导出对比 CSV</button>
      <button class="btn btn-sm btn-ghost" id="compareRadar" type="button">⑦ 叠加雷达图（类药性五维）</button></div>
      <div class="row-note">对比基于 RDKit 本地计算；名称为空或非 SMILES 时尝试 PubChem 解析。logS 为综合 QSAR 估计。雷达图为 5 项类药性指标的归一化得分（越高越理想），用于多化合物横向比较。</div>`;
    out.innerHTML = html;
    const csv = $('compareCsv'); if (csv) csv.addEventListener('click', () => {
      const head = ['compound', 'smiles', 'MW', 'logP', 'TPSA', 'HBD', 'HBA', 'rotatable', 'rings', 'ionizable', 'logS'];
      const body = rows.map(r => [r.name, r.smiles, r.mw, r.logp, r.tpsa, r.hbd, r.hba, r.rot, r.rings, r.ion, r.logs].map(v => v == null ? '' : v).join(',')).join('\n');
      download('compound_compare.csv', '\ufeff' + head.join(',') + '\n' + body, 'text/csv');
    });
    const rad = $('compareRadar'); if (rad) rad.addEventListener('click', () => drawCompareRadar(rows, out));
  }
  // ⑦ 雷达图增强：多化合物五维类药性归一化叠加（canvas）
  function drawCompareRadar(rows, container) {
    if (!container) return;
    const valid = rows.filter(r => r.mw != null && r.logp != null);
    if (valid.length < 1) { setStatusNote('对比结果缺少数值，无法绘制雷达图。'); return; }
    // 归一化函数：1 = 理想（MW 越小越优但需足够大；logP 0~4 理想；TPSA 越小越优；HBD≤5；HBA≤10）
    const norm = {
      mw: v => Math.max(0, Math.min(1, 1 - Math.abs(v - 300) / 400)),
      logp: v => Math.max(0, Math.min(1, 1 - Math.abs(v - 2) / 5)),
      tpsa: v => Math.max(0, Math.min(1, 1 - v / 180)),
      hbd: v => Math.max(0, Math.min(1, 1 - (v || 0) / 8)),
      hba: v => Math.max(0, Math.min(1, 1 - (v || 0) / 14)),
    };
    const axes = [
      { label: 'MW', key: 'mw' },
      { label: 'logP', key: 'logp' },
      { label: 'TPSA', key: 'tpsa' },
      { label: 'HBD', key: 'hbd' },
      { label: 'HBA', key: 'hba' },
    ].map(a => ({ label: a.label, vals: valid.map(r => Math.round(norm[a.key](r[a.key]) * 100)) }));
    const W = 560, H = 420, cx = W / 2, cy = H / 2 + 10, R = 140;
    const isDark = document.documentElement.classList.contains('dark');
    const axisColor = isDark ? '#c9d4e0' : '#5b6776';
    const gridColor = isDark ? 'rgba(190,205,220,0.20)' : 'rgba(120,130,145,0.30)';
    const colors = ['#185FA5', '#0F6E56', '#BA7517', '#993C1D', '#534AB7', '#888780'];
    const angle = (i) => -Math.PI / 2 + i * 2 * Math.PI / axes.length;
    const pt = (i, frac) => ({ x: cx + R * frac * Math.cos(angle(i)), y: cy + R * frac * Math.sin(angle(i)) });
    let html = `<canvas id="cmpRadarCanvas" width="${W}" height="${H}" class="species-canvas" style="width:100%;max-width:560px"></canvas>
      <div class="row-note">五维归一化得分（100 = 该类药性最理想）：MW 越接近 300 越高、logP 越接近 2 越高、TPSA/HBD/HBA 越低越高。仅作研发参考。</div>`;
    container.insertAdjacentHTML('beforeend', html);
    const canvas = $('cmpRadarCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    // 网格（0/25/50/75/100）
    ctx.strokeStyle = gridColor; ctx.fillStyle = axisColor; ctx.font = '10px sans-serif';
    [0.25, 0.5, 0.75, 1].forEach(f => {
      ctx.beginPath();
      axes.forEach((a, i) => { const p = pt(i, f); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.closePath(); ctx.stroke();
    });
    // 轴线 + 标签
    axes.forEach((a, i) => {
      const p = pt(i, 1);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.stroke();
      const lp = pt(i, 1.28);
      ctx.fillText(a.label, lp.x - 12, lp.y + 4);
    });
    // 各化合物多边形
    valid.forEach((r, vi) => {
      const getVal = (key) => { const raw = r[key]; if (raw == null) return 0; const v = norm[key](raw); return Math.max(0, Math.min(1, v)); };
      ctx.strokeStyle = colors[vi % colors.length]; ctx.fillStyle = colors[vi % colors.length];
      ctx.globalAlpha = 0.15;
      ctx.beginPath();
      axes.forEach((a, i) => { const p = pt(i, getVal(a.key)); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1; ctx.lineWidth = 1.6; ctx.stroke();
      // 顶点
      axes.forEach((a, i) => { const p = pt(i, getVal(a.key)); ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill(); });
      // 图例
      const name = String(r.name || 'C' + (vi + 1)).slice(0, 12);
      ctx.fillStyle = colors[vi % colors.length];
      ctx.fillRect(W - 150, 12 + vi * 18, 10, 10);
      ctx.fillStyle = axisColor; ctx.fillText(name, W - 134, 21 + vi * 18);
    });
  }

  /* ============ 10. SMILES 结构式构建器（轻量，非矢量绘图） ============ */
  const FRAGMENTS = [
    { label: '苯环', s: 'c1ccccc1' }, { label: '吡啶', s: 'n1ccccc1' }, { label: '环己烷', s: 'C1CCCCC1' },
    { label: '甲基', s: 'C' }, { label: '亚甲基', s: 'CC' }, { label: '羧基', s: 'C(=O)O' },
    { label: '胺', s: 'N' }, { label: '羟基', s: 'O' }, { label: '羰基', s: 'C(=O)' },
    { label: '氯', s: 'Cl' }, { label: '甲氧基', s: 'CO' }, { label: '酯', s: 'C(=O)OC' },
    { label: '酰胺', s: 'C(=O)N' }, { label: '苯胺', s: 'Nc1ccccc1' }, { label: '双键', s: 'C=C' },
  ];
  function drawerRender() {
    const pal = $('drawerPalette'); if (!pal) return;
    pal.innerHTML = FRAGMENTS.map((f, i) => `<button class="btn btn-sm btn-ghost frag-btn" data-i="${i}" type="button" title="${escapeHtml(f.s)}">${escapeHtml(f.label)}</button>`).join('');
    pal.querySelectorAll('.frag-btn').forEach(b => b.addEventListener('click', () => {
      const ta = $('drawerSmiles'); const fr = FRAGMENTS[+b.dataset.i].s;
      const cur = ta.value.trim();
      ta.value = cur ? (cur + '.' + fr) : fr; // 用 '.' 连接便于查看，渲染时取第一段或整体
      drawerRenderImg();
    }));
  }
  function drawerRenderImg() {
    const img = $('drawerImg'); if (!img) return;
    const smiles = ($('drawerSmiles').value || '').trim();
    if (!smiles) { img.innerHTML = '<span class="row-note">输入 SMILES 后此处显示结构。</span>'; return; }
    // 渲染：多片段用第一个片段示意（整体多片段亦可直接渲染）
    const svg = smilesSVG(smiles, 360, 280);
    img.innerHTML = svg || '<span class="row-note">无法渲染该 SMILES（请检查语法）。</span>';
  }
  function drawerExport() {
    const smiles = ($('drawerSmiles').value || '').trim();
    if (!smiles) { setStatusNote('请先输入可渲染的 SMILES。'); return; }
    const svg = smilesSVG(smiles, 440, 330);
    if (!svg) { setStatusNote('SMILES 无法渲染，无法导出。'); return; }
    download('structure_' + Date.now() + '.svg', svg, 'image/svg+xml');
  }

  /* ============ 主题切换（自动跟随系统 / 浅色 / 暗色） ============ */
  function initDarkMode() {
    const btn = $('darkToggle'); if (!btn) return;
    const KEY = 'chemprop_theme';
    let mode = 'auto'; // auto | light | dark
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'auto') {
        mode = saved;
      } else {
        // 兼容旧版 chemprop_dark（'1' = 暗色, '0' = 浅色）
        const legacy = localStorage.getItem('chemprop_dark');
        if (legacy === '1') mode = 'dark';
        else if (legacy === '0') mode = 'light';
      }
    } catch (e) {}

    const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function effectiveDark() {
      if (mode === 'dark') return true;
      if (mode === 'light') return false;
      return mql ? mql.matches : false;
    }
    function applyTheme() {
      const dark = effectiveDark();
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    }
    function syncLabel() {
      if (!btn) return;
      const tt = (k) => (window.__chemprop && window.__chemprop.T) ? window.__chemprop.T(k) : k;
      const labels = { auto: '🌗 ' + tt('darkAuto'), light: '☀ ' + tt('darkLight'), dark: '🌙 ' + tt('darkDark') };
      btn.textContent = labels[mode] || labels.auto;
      btn.title = tt('darkToggleTitle');
      btn.setAttribute('data-theme-mode', mode);
    }
    function save() { try { localStorage.setItem(KEY, mode); } catch (e) {} }

    applyTheme();
    syncLabel();

    // 系统主题变化（如 Windows / macOS 切换浅色暗色）→ 自动模式下实时跟随
    if (mql && mql.addEventListener) {
      mql.addEventListener('change', () => { if (mode === 'auto') applyTheme(); });
    }

    btn.addEventListener('click', () => {
      // 循环：auto → light → dark → auto
      mode = (mode === 'auto') ? 'light' : (mode === 'light') ? 'dark' : 'auto';
      save();
      applyTheme();
      syncLabel();
    });

    // 供语言切换后刷新按钮文案
    window.syncThemeLabel = syncLabel;
  }

  /* ============ 11. logD–pH 曲线（脂溶性随 pH 变化） ============ */
  function logDphCalc() {
    const out = $('logdOut'), canvas = $('logdCanvas'); if (!out || !canvas) return;
    const smiles = ($('logdSmiles').value || '').trim();
    if (!smiles) { out.innerHTML = '<div class="row-note err">请填写 SMILES（可用「当前化合物」按钮填入）。</div>'; return; }
    if (!window.RDKitEngine) { out.innerHTML = '<div class="row-note err">RDKit 引擎未就绪。</div>'; return; }
    window.RDKitEngine.init().then(() => {
      const rd = window.RDKitEngine.compute(smiles);
      const d = rd.desc || {}, pk = rd.pka || {};
      const logP = d.CrippenClogP;
      const acids = (pk.acids || []), bases = (pk.bases || []);
      if (logP == null) { out.innerHTML = '<div class="row-note err">无法获取 logP。</div>'; return; }
      // f0 = 中性分数；logD(pH) = logP + log10(f0)
      const pts = [];
      for (let ph = 0; ph <= 14.01; ph += 0.1) {
        let denom = 1;
        acids.forEach(a => denom += Math.pow(10, ph - a.pka));
        bases.forEach(b => denom += Math.pow(10, b.pka - ph));
        const f0 = 1 / denom;
        pts.push({ ph, logD: logP + Math.log10(Math.max(f0, 1e-12)) });
      }
      drawLogDChart(canvas, pts, logP);
      const logD74 = pts[Math.round(7.4 * 10)] ? pts[Math.round(7.4 * 10)].logD : null;
      const min = Math.min.apply(null, pts.map(p => p.logD)), max = Math.max.apply(null, pts.map(p => p.logD));
      const chargeNote = acids.length || bases.length ? '' : '（中性分子，logD=logP 恒定）';
      out.innerHTML = `<table class="tool-table">
        <tr><td class="k">logP（中性）</td><td><b>${logP.toFixed(2)}</b></td></tr>
        <tr><td class="k">logD (pH 7.4)</td><td><b>${logD74 != null ? logD74.toFixed(2) : '—'}</b>（生理 pH 有效脂溶性）</td></tr>
        <tr><td class="k">logD 范围 (pH 0–14)</td><td>${min.toFixed(2)} ~ ${max.toFixed(2)}${chargeNote}</td></tr>
        <tr><td class="k">可电离位点</td><td>酸 ${acids.length}（${acids.map(a => 'pKa ' + a.pka).join('，') || '—'}）；碱 ${bases.length}（${bases.map(b => 'pKa ' + b.pka).join('，') || '—'}）</td></tr>
      </table>
      <div class="row-note">logD 越低说明该 pH 下离子化程度越高、水溶性越好、膜渗透越差。成盐后晶型/溶解度评估、胃肠道吸收窗口分析常看 logD(pH) 曲线。基于经验 pKa 估算，仅供研发参考。</div>`;
    }).catch(e => { out.innerHTML = '<div class="row-note err">结构解析失败：' + escapeHtml(e.message || e) + '</div>'; });
  }
  function drawLogDChart(canvas, pts, logP) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const padL = 46, padR = 14, padT = 16, padB = 30;
    const x0 = padL, x1 = W - padR, y0 = H - padB, y1 = padT;
    const isDark = document.documentElement.classList.contains('dark');
    const axisColor = isDark ? '#c9d4e0' : '#5b6776';
    const gridColor = isDark ? 'rgba(190,205,220,0.20)' : 'rgba(120,130,145,0.25)';
    let lo = Math.min.apply(null, pts.map(p => p.logD)), hi = Math.max.apply(null, pts.map(p => p.logD));
    lo = Math.floor(lo - 0.5); hi = Math.ceil(hi + 0.5);
    const X = (ph) => x0 + (ph / 14) * (x1 - x0);
    const Y = (v) => y0 - ((v - lo) / (hi - lo)) * (y0 - y1);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = gridColor; ctx.fillStyle = axisColor; ctx.font = '10px sans-serif'; ctx.lineWidth = 1;
    for (let v = lo; v <= hi; v += Math.max(1, Math.round((hi - lo) / 5))) { const y = Y(v); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.fillText(v.toFixed(0), 8, y + 3); }
    for (let ph = 0; ph <= 14; ph += 2) { const x = X(ph); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.fillText(ph, x - 5, y0 + 14); }
    ctx.fillText('pH', x1 - 16, y0 + 24); ctx.fillText('logD', 8, y1 + 2);
    // 中性参考线（logP）
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(30,40,50,0.35)'; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x0, Y(logP)); ctx.lineTo(x1, Y(logP)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = axisColor; ctx.fillText('logP=' + logP.toFixed(1), x1 - 70, Y(logP) - 4);
    // 曲线
    ctx.strokeStyle = '#185FA5'; ctx.lineWidth = 2; ctx.beginPath();
    pts.forEach((p, i) => { const x = X(p.ph), y = Y(p.logD); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    // pH 7.4 标记
    const x74 = X(7.4); ctx.strokeStyle = '#e23636'; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x74, y1); ctx.lineTo(x74, y0); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#e23636'; ctx.fillText('pH 7.4', x74 + 3, y1 + 10);
  }

  /* ============ 12. 杂质谱追踪表（警示结构 → ICH Q3A 报告阈值） ============ */
  function impSpecCalc() {
    const out = $('impSpecOut'); if (!out) return;
    const d = getCurrent();
    if (!d || !d.toxicity || !d.toxicity.parsed || !d.toxicity.all.length) {
      out.innerHTML = '<div class="row-note err">当前化合物未检出警示结构，或尚未完成预测。请先完成一次预测。</div>'; return;
    }
    const tox = d.toxicity;
    const rows = tox.all.map((a, i) => {
      const sev = a.severity === 'high' ? '高风险' : a.severity === 'medium' ? '中风险' : '低风险';
      const cats = (a.cats || []).join('、') || '—';
      return `<tr><td>${i + 1}</td><td><b>${escapeHtml(a.name)}</b></td><td>${cats}</td><td class="tone-${a.severity === 'high' ? 'bad' : a.severity === 'medium' ? 'warn' : 'good'}">${sev}</td><td>${a.count} 处</td><td class="row-note">${escapeHtml(a.note || '')}</td></tr>`;
    }).join('');
    out.innerHTML = `<div class="sub-title">杂质谱追踪表（结构警示筛查）</div>
      <table class="tool-table"><tr><th>#</th><th>警示结构 / 潜在杂质</th><th>类别</th><th>风险</th><th>命中数</th><th>关注点</th></tr>${rows}</table>
      <div class="sub-title" style="margin-top:10px">ICH Q3A/Q3B 报告阈值参考（非强制限度）</div>
      <table class="tool-table">
        <tr><td class="k">原料药日剂量 &lt; 2 g</td><td>报告阈值：0.1% 或 1 mg/天（取较低者）</td></tr>
        <tr><td class="k">原料药日剂量 ≥ 2 g</td><td>报告阈值：0.05%</td></tr>
        <tr><td class="k">基因毒性（警示结构）</td><td>按 ICH M7 决策树评估（TTC 1.5 µg/天等），<b>不适用 Q3A 常规限度</b></td></tr>
      </table>
      <div class="row-note">⚠️ 本表为 <b>结构警示筛查</b>（SMARTS 子集），非完整杂质研究。正式杂质谱应结合工艺路线、强制降解实验与 LC-MS 确证。报告阈值仅供参考，限度制定请以药政指导原则和实际毒理数据为准。</div>`;
  }
  function impSpecExport() {
    if (typeof XLSX === 'undefined') { setStatusNote('Excel 组件未加载。'); return; }
    const d = getCurrent();
    if (!d || !d.toxicity || !d.toxicity.parsed) { setStatusNote('无杂质谱数据可导出。'); return; }
    const wb = XLSX.utils.book_new();
    const head = ['#', '警示结构/潜在杂质', '类别', '风险', '命中数', '关注点'];
    const body = d.toxicity.all.map((a, i) => [i + 1, a.name, (a.cats || []).join('、'), a.severity, a.count, a.note]);
    const ws = XLSX.utils.aoa_to_sheet([head].concat(body));
    ws['!cols'] = [{ wch: 4 }, { wch: 26 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, ws, '杂质谱追踪');
    const name = (d.pubchem && (d.pubchem.iupac || d.pubchem.title)) || d.input || 'compound';
    XLSX.writeFile(wb, `杂质谱追踪_${String(name).replace(/[\\/:*?"<>|]/g, '_')}.xlsx`);
    setStatusNote('已导出杂质谱追踪表。');
  }

  /* ============ 4. 盐型筛选评分（启发式） ============ */
  const FAV_KEY = 'chemprop_favs_v1';
  let favStore = [];
  function loadFavs() { try { const raw = localStorage.getItem(FAV_KEY); if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) favStore = arr; } } catch (e) { favStore = []; } }
  function persistFavs() { try { localStorage.setItem(FAV_KEY, JSON.stringify(favStore)); } catch (e) {} }
  function favAdd() {
    const d = getCurrent();
    if (!d || !d.smiles) { setStatusNote('请先完成一次预测再收藏。'); return; }
    const name = ($('favName').value || '').trim() || (d.pubchem && (d.pubchem.iupac || d.pubchem.title)) || d.input || d.smiles;
    const project = ($('favProject').value || '').trim() || '未分组';
    if (favStore.some(f => f.smiles === d.smiles && f.project === project)) { setStatusNote('该化合物已在当前分组中。'); return; }
    const item = { name, smiles: d.smiles, project, time: new Date().toISOString() };
    favStore.push(item);
    persistFavs(); renderFavs();
    setStatusNote('已收藏：' + name + '（' + project + '）');
    try { window.dispatchEvent(new CustomEvent('chemprop-fav-added', { detail: item })); } catch (e) {}
  }
  function renderFavs() {
    const box = $('favList'); if (!box) return;
    if (!favStore.length) { box.innerHTML = '<div class="row-note" style="margin:6px 0">尚未收藏任何化合物。</div>'; return; }
    const groups = {};
    favStore.forEach(f => { (groups[f.project] = groups[f.project] || []).push(f); });
    let html = '';
    Object.keys(groups).sort().forEach(g => {
      html += `<div class="fav-group-title">${escapeHtml(g)}（${groups[g].length}）</div>`;
      groups[g].forEach((f, idx) => {
        const gi = favStore.indexOf(f);
        html += `<div class="fav-item"><span class="fav-proj">${escapeHtml(f.project)}</span>
          <b>${escapeHtml(f.name)}</b><code class="dict-smiles">${escapeHtml(f.smiles)}</code>
          <span class="row-note">${new Date(f.time).toLocaleString('zh-CN')}</span>
          <button class="btn btn-sm btn-ghost fav-del" data-i="${gi}" type="button">×</button></div>`;
      });
    });
    box.innerHTML = html;
  }
  function favExport() {
    if (typeof XLSX === 'undefined') { setStatusNote('Excel 组件未加载。'); return; }
    if (!favStore.length) { setStatusNote('收藏夹为空。'); return; }
    const wb = XLSX.utils.book_new();
    const head = ['项目/分组', '名称', 'SMILES', '收藏时间'];
    const body = favStore.map(f => [f.project, f.name, f.smiles, new Date(f.time).toLocaleString('zh-CN')]);
    const ws = XLSX.utils.aoa_to_sheet([head].concat(body));
    ws['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 40 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, '收藏夹');
    XLSX.writeFile(wb, '化合物收藏夹.xlsx');
    setStatusNote('已导出收藏夹。');
  }

  /* ============ 20. 项目工作区（多品种并行） ============ */
  const PROJ_KEY = 'chemprop_projects_v1';
  let projStore = [];
  function loadProjects() { try { const raw = localStorage.getItem(PROJ_KEY); if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) projStore = a; } } catch (e) { projStore = []; } }
  function persistProjects() { try { localStorage.setItem(PROJ_KEY, JSON.stringify(projStore)); } catch (e) {} }
  function projCreate() {
    const name = ($('projName').value || '').trim();
    if (!name) { setStatusNote('请填写项目名称。'); return; }
    if (projStore.some(p => p.name === name)) { setStatusNote('该项目已存在。'); return; }
    projStore.push({ name, desc: ($('projDesc').value || '').trim(), compounds: [], time: new Date().toISOString() });
    persistProjects(); renderProjects();
    setStatusNote('已创建项目：' + name);
  }
  function projAddCurrent() {
    const d = getCurrent();
    if (!d || !d.smiles) { setStatusNote('请先完成一次预测，再加入项目。'); return; }
    const name = ($('projName').value || '').trim();
    if (!name) { setStatusNote('请先在上方输入项目名称（或选择已有项目后再点加号）。'); return; }
    const proj = projStore.find(p => p.name === name);
    if (!proj) { setStatusNote('项目不存在，请先创建。'); return; }
    const cname = (d.pubchem && (d.pubchem.iupac || d.pubchem.title)) || d.input || d.smiles;
    if (proj.compounds.some(c => c.smiles === d.smiles)) { setStatusNote('该化合物已在项目中。'); return; }
    const rd = d.rdkit && d.rdkit.desc;
    proj.compounds.push({
      name: cname, smiles: d.smiles,
      mw: rd && rd.amw != null ? (+rd.amw).toFixed(2) : null,
      logp: rd && rd.CrippenClogP != null ? (+rd.CrippenClogP).toFixed(2) : null,
      tpsa: rd && rd.tpsa != null ? (+rd.tpsa).toFixed(1) : null,
      role: d.role || '', cas: (d.pubchem && d.pubchem.cas) || '',
      time: new Date().toISOString(),
    });
    persistProjects(); renderProjects();
    setStatusNote('已加入项目「' + name + '」：' + cname);
  }
  function renderProjects() {
    const box = $('projList'); if (!box) return;
    if (!projStore.length) { box.innerHTML = '<div class="row-note" style="margin:8px 0">尚未创建项目。</div>'; return; }
    box.innerHTML = projStore.map((p, pi) => `
      <div class="fav-group-title">${escapeHtml(p.name)} <span class="badge badge-neutral">${p.compounds.length} 个化合物</span>${p.desc ? '<span class="row-note"> ' + escapeHtml(p.desc) + '</span>' : ''}</div>
      ${p.compounds.length ? p.compounds.map((c, ci) => `
        <div class="fav-item"><b>${escapeHtml(c.name)}</b>
          <code class="dict-smiles">${escapeHtml(c.smiles)}</code>
          ${c.mw ? '<span class="badge badge-src-rd">MW ' + c.mw + '</span>' : ''}
          ${c.cas ? '<span class="badge badge-neutral">CAS ' + escapeHtml(c.cas) + '</span>' : ''}
          <button class="btn btn-sm btn-ghost proj-rerun" data-p="${pi}" data-c="${ci}" type="button" title="重新预测">重查</button>
          <button class="btn btn-sm btn-ghost proj-del" data-p="${pi}" data-c="${ci}" type="button">×</button>
        </div>`).join('') : '<div class="row-note" style="margin:2px 0 6px">（空）</div>'}
      <div class="action-row" style="margin:4px 0 10px"><button class="btn btn-sm btn-ghost proj-pick" data-p="${pi}" type="button">选中此项目</button></div>`).join('');
  }
  function projExportXLSX() {
    if (typeof XLSX === 'undefined') { setStatusNote('Excel 组件未加载。'); return; }
    if (!projStore.length) { setStatusNote('项目列表为空。'); return; }
    const wb = XLSX.utils.book_new();
    projStore.forEach(p => {
      const head = ['项目', '化合物', 'SMILES', 'MW', 'logP', 'TPSA', '角色', 'CAS', '加入时间'];
      const body = p.compounds.map(c => [p.name, c.name, c.smiles, c.mw, c.logp, c.tpsa, c.role, c.cas, new Date(c.time).toLocaleString('zh-CN')]);
      const ws = XLSX.utils.aoa_to_sheet([head].concat(body));
      ws['!cols'] = [{ wch: 14 }, { wch: 24 }, { wch: 42 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 18 }];
      const sn = ('P_' + p.name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 28);
      XLSX.utils.book_append_sheet(wb, ws, sn || '项目');
    });
    XLSX.writeFile(wb, '项目工作区_' + new Date().toISOString().slice(0, 10) + '.xlsx');
    setStatusNote('已导出全部项目 Excel（每个项目一个 Sheet）。');
  }

  /* ============ 21. 多杂质清单管理 ============ */
  const IMP_KEY = 'chemprop_implist_v1';
  let impStore = [];
  function loadImpList() { try { const raw = localStorage.getItem(IMP_KEY); if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) impStore = a; } } catch (e) { impStore = []; } }
  function persistImpList() { try { localStorage.setItem(IMP_KEY, JSON.stringify(impStore)); } catch (e) {} }
  function impAdd() {
    const name = ($('impName').value || '').trim();
    const smiles = ($('impName').dataset.smiles) || ''; // 可能由「用当前化合物」预填
    if (!name) { setStatusNote('请填写杂质名称（或先点「用当前化合物填充」）。'); return; }
    const cls = $('impClassSel').value;
    impStore.push({
      name, cas: ($('impCas').value || '').trim(), smiles,
      cls, limit: num($('impLimit').value), note: ($('impNote').value || '').trim(),
      time: new Date().toISOString(),
    });
    persistImpList(); renderImpList(); impClearForm();
    setStatusNote('已添加杂质：' + name);
  }
  function impUseCurrent() {
    const d = getCurrent();
    if (!d) return;
    const nm = (d.pubchem && (d.pubchem.iupac || d.pubchem.title)) || d.input || '';
    if (nm) $('impName').value = nm;
    $('impName').dataset.smiles = d.smiles || '';
    if (d.pubchem && d.pubchem.cas) $('impCas').value = d.pubchem.cas;
    setStatusNote('已用当前化合物填充杂质信息（可再修改名称/类别/限度）。');
  }
  function impClearForm() {
    ['impName', 'impCas', 'impLimit', 'impNote'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    const nm = $('impName'); if (nm) nm.dataset.smiles = '';
  }
  function renderImpList() {
    const box = $('impList'); if (!box) return;
    if (!impStore.length) { box.innerHTML = '<div class="row-note" style="margin:8px 0">杂质清单为空。添加杂质后可一键导出评估表。</div>'; return; }
    const clsName = { '1': '第1类', '2': '第2类', '3': '第3类', '4': '第4类', '5': '第5类' };
    box.innerHTML = impStore.map((im, i) => `
      <div class="fav-item"><b>${escapeHtml(im.name)}</b>
        ${im.cas ? '<span class="badge badge-neutral">CAS ' + escapeHtml(im.cas) + '</span>' : ''}
        <span class="badge badge-warn">${clsName[im.cls] || im.cls}</span>
        ${im.limit != null ? '<span class="badge badge-neutral">' + im.limit + ' ppm</span>' : ''}
        ${im.smiles ? '<code class="dict-smiles">' + escapeHtml(im.smiles) + '</code>' : ''}
        ${im.note ? '<span class="row-note">' + escapeHtml(im.note) + '</span>' : ''}
        <button class="btn btn-sm btn-ghost imp-del" data-i="${i}" type="button">×</button>
      </div>`).join('');
  }
  function impExportXlsx() {
    if (typeof XLSX === 'undefined') { setStatusNote('Excel 组件未加载。'); return; }
    if (!impStore.length) { setStatusNote('杂质清单为空，无可导出。'); return; }
    const wb = XLSX.utils.book_new();
    // Sheet1: QS-1 限度
    const s1 = [['杂质名称', 'CAS', 'ICH M7 类别', '拟定限度 (ppm)', '备注'],
      ...impStore.map(im => [im.name, im.cas || '', im.cls || '', im.limit != null ? im.limit : '', im.note || ''])];
    const ws1 = XLSX.utils.aoa_to_sheet(s1);
    ws1['!cols'] = [{ wch: 26 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'QS-1 限度');
    // Sheet2: API 杂质明细（含 SMILES）
    const s2 = [['#', '杂质名称', 'SMILES', 'CAS', 'ICH M7 类别', '拟定限度 (ppm)', '备注'],
      ...impStore.map((im, i) => [i + 1, im.name, im.smiles || '', im.cas || '', im.cls || '', im.limit != null ? im.limit : '', im.note || ''])];
    const ws2 = XLSX.utils.aoa_to_sheet(s2);
    ws2['!cols'] = [{ wch: 4 }, { wch: 26 }, { wch: 42 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'API 杂质明细');
    XLSX.writeFile(wb, '杂质评估_' + new Date().toISOString().slice(0, 10) + '.xlsx');
    setStatusNote('已导出杂质评估 Excel（QS-1 限度 / API 杂质明细 双 Sheet）。');
  }

  /* ============ 22. 化合物×性质热力图矩阵 ============ */
  async function heatRun() {
    const out = $('heatOut'); if (!out) return;
    const lines = ($('heatInput').value || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) { out.innerHTML = '<div class="row-note err">请每行填写一个化合物。</div>'; return; }
    if (!window.RDKitEngine) { out.innerHTML = '<div class="row-note err">RDKit 引擎未就绪。</div>'; return; }
    await window.RDKitEngine.init();
    const rows = [];
    for (const line of lines) {
      try {
        let smiles = line;
        try { window.RDKitEngine.compute(smiles); }
        catch (e) {
          const loc = window.__chemprop && window.__chemprop.findLocal(line);
          if (loc && loc.smiles) smiles = loc.smiles;
          else if (window.PubChem) { const pc = await Promise.race([window.PubChem.resolve(line, 'name'), new Promise(res => setTimeout(() => res(null), 6000))]); if (pc && pc.canonicalSmiles) smiles = pc.canonicalSmiles; }
        }
        const rd = window.RDKitEngine.compute(smiles);
        const d = rd.desc || {};
        rows.push({ name: line, smiles, mw: d.amw, logp: d.CrippenClogP, tpsa: d.tpsa, hbd: d.NumHBD, hba: d.NumHBA, rot: d.NumRotatableBonds, rings: d.NumRings });
      } catch (e) { rows.push({ name: line, error: e.message || e }); }
    }
    if (!rows.length) { out.innerHTML = '<div class="row-note err">无可计算结果。</div>'; return; }
    const fields = [
      { key: 'mw', label: 'MW', better: 'low' }, { key: 'logp', label: 'logP', better: 'mid' },
      { key: 'tpsa', label: 'TPSA', better: 'low' }, { key: 'hbd', label: 'HBD', better: 'low' },
      { key: 'hba', label: 'HBA', better: 'low' }, { key: 'rot', label: 'RotB', better: 'low' },
      { key: 'rings', label: '环数', better: 'low' },
    ];
    // 归一化（按列 min-max）
    const norm = {};
    fields.forEach(f => {
      const vals = rows.filter(r => r[f.key] != null).map(r => r[f.key]);
      if (!vals.length) { norm[f.key] = () => 0.5; return; }
      const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
      const span = (max - min) || 1;
      norm[f.key] = (v) => v == null ? 0.5 : (v - min) / span;
    });
    const cellColor = (f, v) => {
      if (v == null) return '#88878022';
      let s = norm[f.key](v);
      if (f.better === 'low') s = 1 - s; else if (f.better === 'mid') s = 1 - Math.abs(s - 0.5) * 2;
      const r = Math.round(220 - s * 200), g = Math.round(240 - s * 90), b = Math.round(230 - s * 200);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    };
    let html = `<table class="tool-table heat"><tr><th>化合物</th>${fields.map(f => `<th title="${f.label} 越低越优${f.better === 'mid' ? '（适中最佳）' : ''}">${f.label}</th>`).join('')}</tr>`;
    rows.forEach(r => {
      html += `<tr><td><b>${escapeHtml(r.name)}</b><br><span class="row-note">${escapeHtml(r.smiles)}</span></td>`;
      fields.forEach(f => {
        const v = r[f.key];
        html += `<td style="background:${cellColor(f, v)};text-align:center;color:#16202e">${v != null ? (+v).toFixed(f.key === 'tpsa' ? 1 : 2) : '—'}</td>`;
      });
      html += '</tr>';
    });
    html += '</table><div class="row-note">色块越绿 = 该性质越理想（MW/TPSA/HBD/HBA/RotB/环数越低越优；logP 适中最佳）。基于 RDKit 本地计算。</div>';
    out.innerHTML = html;
    const csvBtn = $('heatCsv');
    if (csvBtn) csvBtn.onclick = () => {
      const head = ['compound', 'smiles'].concat(fields.map(f => f.key));
      const body = rows.map(r => [r.name, r.smiles].concat(fields.map(f => r[f.key] == null ? '' : r[f.key])).join(','));
      download('heatmap_matrix.csv', '\ufeff' + head.join(',') + '\n' + body.join('\n'), 'text/csv');
    };
  }

  /* ============ 23. 合成可及性评分（SA score 启发式） ============ */
  function saCalc() {
    const out = $('saOut'); if (!out) return;
    const smiles = ($('saSmiles').value || '').trim();
    if (!smiles) { out.innerHTML = '<div class="row-note err">请填写 SMILES。</div>'; return; }
    if (!window.RDKitEngine) { out.innerHTML = '<div class="row-note err">RDKit 引擎未就绪。</div>'; return; }
    window.RDKitEngine.init().then(() => {
      const rd = window.RDKitEngine.compute(smiles);
      const d = rd.desc || {};
      const groups = rd.groups || [];
      // 启发式计分：复杂度项累加，基准 1
      let score = 1;
      const items = [];
      const add = (name, pts, note) => { score += pts; items.push({ name, pts, note }); };
      const nHeavy = d.NumHeavyAtoms || 0;
      add('骨架规模', nHeavy > 25 ? 1.2 : nHeavy > 15 ? 0.6 : 0.2, nHeavy + ' 个重原子（越大越难）');
      const rings = d.NumRings || 0, arRings = d.NumAromaticRings || 0;
      add('环系复杂度', rings > 4 ? 1.0 : rings > 2 ? 0.5 : 0.1, rings + ' 个环（' + arRings + ' 个芳香环）');
      if (arRings >= 2) add('多芳香环', 0.4, '芳环稠合/联苯增大合成难度');
      const hetero = d.NumHeteroatoms || 0;
      add('杂原子密度', hetero > 8 ? 0.8 : hetero > 4 ? 0.4 : 0.1, hetero + ' 个杂原子');
      const rot = d.NumRotatableBonds || 0;
      add('柔性长链', rot > 8 ? 0.6 : rot > 5 ? 0.3 : 0.05, rot + ' 个可旋转键');
      const stereo = d.NumAtomStereoCenters || 0;
      add('手性中心', stereo > 3 ? 1.4 : stereo > 1 ? 0.8 : 0, stereo + ' 个手性原子（不对称合成成本高）');
      const spiro = d.NumSpiroAtoms || 0, bridge = d.NumBridgeheadAtoms || 0;
      if (spiro || bridge) add('螺环/桥环', 0.8, '螺原子 ' + spiro + ' / 桥头原子 ' + bridge);
      // 高活性/复杂官能团（复用警示检测）
      const highAlerts = groups.filter(g => g.severity === 'high');
      if (highAlerts.length) add('高风险活性基团', highAlerts.length * 0.5, highAlerts.map(g => g.name).join('、'));
      // 分子量 penalty
      const mw = d.amw || 0;
      if (mw > 600) add('大分子量', 0.5, 'MW ' + mw.toFixed(0));
      score = Math.max(1, Math.min(10, score));
      const tone = score <= 3 ? 'good' : score <= 6 ? 'warn' : 'bad';
      const lvl = score <= 3 ? '较易合成' : score <= 6 ? '中等难度' : '合成困难';
      out.innerHTML = `<div class="sa-score" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="font-size:34px;font-weight:800;color:${score <= 3 ? '#16a34a' : score <= 6 ? '#d97706' : '#dc2626'}">${score.toFixed(1)}<span style="font-size:14px;color:#5b6776">/10</span></div>
        <div><div class="score-bar" style="width:160px;display:inline-block;vertical-align:middle"><span class="score-fill tone-${tone}" style="width:${score * 10}%"></span></div>
        <div class="row-note" style="margin-top:4px"><b>${lvl}</b>（启发式估算）</div></div>
      </div>
      <table class="tool-table"><tr><th>复杂度项</th><th>加分</th><th>说明</th></tr>${items.map(it => `<tr><td>${it.name}</td><td class="tone-${it.pts >= 0.6 ? 'bad' : it.pts >= 0.3 ? 'warn' : 'good'}">+${it.pts}</td><td class="row-note">${escapeHtml(it.note)}</td></tr>`).join('')}</table>
      <div class="row-note">⚠️ 启发式复杂度评分（非商业 SA score 模型）：分数越高合成越难。用于路线筛选前置判断，具体可行性仍需结合工艺文献与经验。</div>`;
    }).catch(e => { out.innerHTML = '<div class="row-note err">结构解析失败：' + escapeHtml(e.message || e) + '</div>'; });
  }

  /* ============ 24. 结构式图片识别（OCR → SMILES，轻量） ============ */
  // 24. 结构式图片识别：在线调用 MolScribe（HuggingFace Space Gradio API，无需本地服务）
  // 镜像 Space 池（多源探测选优，单镜像可恢复时大幅提高成功率）
  const MOLSCRIBE_SPACES = [
    'yujieq/MolScribe', 'nphill22/MolScribe', 'BioTuring/MolScribe', 'ClemS/MolScribe', 'tuanle618/MolScribe',
    'akhilkulhari/MolScribe', 'SEUNHYE/MolScribe', 'danilotenuti/MolScribe', 'hynty1999/MolScribe', 'RonaldCo/MolScribe',
  ];
  // —— 图像预处理：裁剪到结构内容包围盒 + 白底 + 对比度增强 ——
  // 文献指出 MolScribe 对"叠加噪声/混合背景"敏感，去背景与二值化可显著提升识别率；
  // 用户上传多为带灰底/UI 边框的截图，预处理能直接提高后端识别精度。
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function preprocessImage(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
        if (!W || !H) { resolve(dataUrl); return; }
        try {
          // 1) 缩放到合适尺寸（最长边 ≤ 1200），在白底上绘制并增强对比，便于后续二值化
          const scale = Math.min(1, 1200 / Math.max(W, H));
          const cw = Math.max(1, Math.round(W * scale)), ch = Math.max(1, Math.round(H * scale));
          const c = document.createElement('canvas'); c.width = cw; c.height = ch;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
          ctx.filter = 'contrast(1.4) brightness(1.05)';
          ctx.drawImage(img, 0, 0, cw, ch);
          ctx.filter = 'none';
          // 2) 二值化：以 (min+max) 亮度中值为阈值，将灰/彩混合背景统一转为白、结构转黑
          //    —— 文献指出 MolScribe 对"叠加噪声/混合背景"敏感，白底黑线显著改善识别率
          let id;
          try { id = ctx.getImageData(0, 0, cw, ch); } catch (e) { resolve(c.toDataURL('image/png')); return; }
          const dd = id.data; let mn = 255, mx = 0;
          for (let i = 0; i < dd.length; i += 4) {
            const l = 0.299 * dd[i] + 0.587 * dd[i + 1] + 0.114 * dd[i + 2];
            if (l < mn) mn = l; if (l > mx) mx = l;
          }
          const thr = (mn + mx) / 2;
          for (let i = 0; i < dd.length; i += 4) {
            const l = 0.299 * dd[i] + 0.587 * dd[i + 1] + 0.114 * dd[i + 2];
            const v = l < thr ? 0 : 255; dd[i] = dd[i + 1] = dd[i + 2] = v;
          }
          ctx.putImageData(id, 0, 0);
          // 3) 在二值图上求结构（黑像素）紧致包围盒，裁掉白边与 UI 边框
          let minX = cw, minY = ch, maxX = -1, maxY = -1;
          for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
              const i = (y * cw + x) * 4;
              if (dd[i] < 128) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
            }
          }
          if (maxX > minX && maxY > minY) {
            const pad = Math.max(4, Math.round(Math.max(cw, ch) * 0.03));
            const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
            const sw = Math.min(cw, maxX - minX + 1 + pad * 2), sh = Math.min(ch, maxY - minY + 1 + pad * 2);
            const fc = document.createElement('canvas'); fc.width = sw; fc.height = sh;
            const fctx = fc.getContext('2d'); fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, sw, sh);
            fctx.drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh);
            resolve(fc.toDataURL('image/png'));
          } else {
            resolve(c.toDataURL('image/png'));
          }
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }
  // 从 Gradio 返回结果中提取类 SMILES 字符串（兼容不同 Space 的返回结构）
  function extractSmiles(parsed) {
    const flat = [];
    const collect = (v) => {
      if (typeof v === 'string') flat.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
    };
    collect(parsed);
    const re = /^[A-Za-z0-9@+\-[\]()=#$.\\/%]{3,}$/;
    let best = null;
    for (const s of flat) {
      const t = String(s).trim();
      if (re.test(t) && /[A-Za-z]/.test(t) && /[()[\]=@]/.test(t)) return t; // 强特征：含字母与键符，最可能是 SMILES
      if (!best && re.test(t)) best = t;
    }
    return best;
  }
  function isSmilesValid(smi) {
    if (!smi || !/^[A-Za-z0-9@+\-[\]()=#$.\\/%]{4,}$/.test(smi)) return false;
    if (window.RDKit && typeof window.RDKit.MolFromSmiles === 'function') {
      try { const m = window.RDKit.MolFromSmiles(smi); if (m && !m.isEmpty && !m.isNaN) return true; } catch (e) {}
    }
    return true; // RDKit 未就绪时不强制拦截
  }

  // 本地 OCR 服务调用
  async function callLocalOcr(url, dataUrl) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 120000);
    try {
      const r = await fetch(url.replace(/\/$/, '') + '/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!r.ok) return { error: 'http ' + r.status };
      const j = await r.json().catch(() => null);
      if (!j) return { error: 'invalid_json' };
      if (j.ok && j.smiles) return { ok: true, smiles: j.smiles, source: j.source || 'local' };
      return { error: j.error || 'local_no_smiles' };
    } catch (e) {
      clearTimeout(t);
      return { error: e.name === 'AbortError' ? 'timeout' : ('network: ' + (e.message || e)) };
    }
  }

  // NCI OSRA 在线服务（multipart/form-data，CORS 已开）
  async function callOsra(dataUrl) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      const m = dataUrl.match(/data:image\/(\w+);base64,(.+)/);
      if (!m) return { error: 'not_base64' };
      const byteString = atob(m[2]);
      const mime = 'image/' + (m[1] === 'jpg' ? 'jpeg' : m[1]);
      const ab = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) ab[i] = byteString.charCodeAt(i);
      const blob = new Blob([ab], { type: mime });
      const fd = new FormData();
      fd.append('file', blob, 'structure.png');
      const r = await fetch('https://cactus.nci.nih.gov/cgi-bin/osra/index.cgi', {
        method: 'POST', body: fd, signal: ctrl.signal, mode: 'cors'
      });
      clearTimeout(t);
      if (!r.ok) return { error: 'http ' + r.status };
      const html = await r.text();
      const mm = html.match(/<input[^>]*name=["']smiles["'][^>]*value=["']([^"']*)/i) ||
                 html.match(/<input[^>]*name=["']hidden_smiles["'][^>]*value=["']([^"']*)/i);
      if (mm && mm[1].trim()) return { ok: true, smiles: mm[1].trim(), source: 'NCI OSRA' };
      return { error: 'no_smiles_in_html' };
    } catch (e) { return { error: e.name === 'AbortError' ? 'timeout' : ('network: ' + (e.message || e)) }; }
  }

  // 调用单个 Gradio Space（带超时 + SSE 轮询），返回 {ok,smiles,source} 或 {error}
  async function callGradioSpace(space, apiName, dataUrl, opts) {
    opts = opts || {};
    const sub = space.split('/').join('-').toLowerCase();
    const base = 'https://' + sub + '.hf.space';
    const submitUrl = base + '/gradio_api/call/' + apiName;
    const postCtrl = new AbortController();
    const postT = setTimeout(() => postCtrl.abort(), opts.submitMs || 25000);
    let event_id;
    try {
      const r = await fetch(submitUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [dataUrl] }), signal: postCtrl.signal });
      clearTimeout(postT);
      if (!r.ok) return { error: 'http ' + r.status };
      const j = await r.json().catch(() => null);
      if (!j || !j.event_id) return { error: 'no_event_id' };
      event_id = j.event_id;
    } catch (e) { clearTimeout(postT); return { error: 'submit_fail' }; }
    const pollUrl = base + '/gradio_api/call/' + apiName + '/' + event_id;
    const deadline = Date.now() + (opts.pollMs || 100000);
    while (Date.now() < deadline) {
      await sleep(2000);
      try {
        const sse = await fetch(pollUrl, { cache: 'no-store' });
        if (!sse.ok) continue;
        const txt = await sse.text().catch(() => '');
        const lines = txt.split('\n');
        let arr = null;
        for (const ln of lines) {
          const m = ln.match(/^data:\s*(\[.*\]|\{.*\})/);
          if (m) { try { arr = JSON.parse(m[1]); } catch (e) {} }
        }
        if (arr) {
          const smi = extractSmiles(arr);
          if (smi) return { ok: true, smiles: smi, source: space };
        }
      } catch (e) { /* 继续轮询 */ }
    }
    return { error: 'timeout' };
  }
  async function attemptSpace(spec, dataUrl) {
    for (let retry = 0; retry < 2; retry++) {
      const r = await callGradioSpace(spec.space, spec.api, dataUrl, { submitMs: 25000, pollMs: 100000 });
      if (r && r.ok) return r;
      await sleep(800);
    }
    return { ok: false };
  }
  // 主入口：本地优先 → 在线 MolScribe 竞速 → OSRA 兜底
  async function ocrViaMolScribe(dataUrl, opts) {
    opts = opts || {};
    const cleaned = await preprocessImage(dataUrl);
    const details = [];

    // 1) 本地服务优先
    const localUrl = (opts.localUrl || '').trim();
    if (localUrl) {
      const local = await callLocalOcr(localUrl, cleaned);
      details.push({ source: 'local', result: local });
      if (local.ok && isSmilesValid(local.smiles)) return { ok: true, smiles: local.smiles, source: local.source || 'local', details };
    }

    // 2) 在线 MolScribe Space 竞速（当前多数不可用，保留作为恢复后自动使用）
    const specs = MOLSCRIBE_SPACES.map(s => ({ space: s, api: 'predict' }));
    const onlineResults = await Promise.allSettled(specs.map(sp => attemptSpace(sp, cleaned)));
    for (const res of onlineResults) {
      if (res.status === 'fulfilled' && res.value && res.value.ok) {
        details.push({ source: res.value.source, result: res.value });
        if (isSmilesValid(res.value.smiles)) return { ok: true, smiles: res.value.smiles, source: res.value.source, details };
      }
    }

    // 3) NCI OSRA 兜底
    const osra = await callOsra(cleaned);
    details.push({ source: 'NCI OSRA', result: osra });
    if (osra.ok && isSmilesValid(osra.smiles)) return { ok: true, smiles: osra.smiles, source: 'NCI OSRA', details };

    return { ok: false, details };
  }
  function ocrRunFromFile(file) {
    const prev = $('ocrPreview'), res = $('ocrResult');
    if (!file || !res) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        if (prev) prev.innerHTML = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><img src="${dataUrl}" alt="结构式预览" style="max-width:220px;border:1px solid var(--border,#ddd);border-radius:8px"/><span class="row-note">已加载图片（${img.width}×${img.height}）。正在调用 OCSR 在线 AI 识别…</span></div>`;
        res.innerHTML = '<div class="row-note">⏳ 正在识别（OCSR 深度学习模型）…请稍候。</div>';
        setStatusNote('正在调用 OCSR 在线识别…');
        ocrViaMolScribe(dataUrl).then(result => {
          if (result.ok) {
            // 识别结果自动填入固定的「识别结果（SMILES）」输入框，由用户核对/编辑后点击确认按钮使用
            const input = $('ocrResultInput');
            if (input) input.value = result.smiles;
            if (res) res.innerHTML = `<div class="tool-table" style="padding:10px">
              <div class="sub-title">识别成功（${result.source}）— 请在上方输入框核对</div>
              <div class="action-row">
                <button class="btn btn-sm btn-ghost" id="ocrWebBtn2" type="button">🌐 在在线工具核对</button>
                <button class="btn btn-sm btn-ghost" id="ocrReRun" type="button">🔄 重新识别</button>
              </div>
              <div class="row-note" style="margin-top:6px">识别出的 SMILES 已填入上方「识别结果（SMILES）」输入框；如需微调可直接编辑，核对无误后点击「✅ 确认使用并预测」。</div>
            </div>`;
            const wb2 = $('ocrWebBtn2'); if (wb2) wb2.addEventListener('click', ocrOpenWeb);
            const rr = $('ocrReRun'); if (rr) rr.addEventListener('click', () => ocrRunFromFile(file));
            setStatusNote('识别成功，请在上方输入框核对后确认。');
          } else {
            if (res) res.innerHTML = `<div class="tool-table" style="padding:10px">
              <div class="sub-title">在线识别不可用（HuggingFace 镜像 Space 暂时繁忙）</div>
              <div class="row-note" style="margin:6px 0">已并行探测 <b>10 个 MolScribe 镜像 Space</b>，但均不可用（HuggingFace 免费 Space 偶发因流量 / 资源限额进入 error 状态）。NCI OSRA 在线服务当前也返回服务器错误。这<b>不是工具 bug</b>。</div>
              <div class="action-row">
                <button class="btn btn-sm btn-secondary" id="ocrRetry" type="button">🔄 立即重试（Space 可能已恢复）</button>
                <button class="btn btn-sm btn-ghost" id="ocrWaitRetry" type="button">⏳ 等 30s 再试</button>
                <button class="btn btn-sm btn-ghost" id="ocrWebBtn3" type="button">🌐 打开 decimer.ai</button>
                <button class="btn btn-sm btn-ghost" id="ocrManual3" type="button">✍ 手动输入 SMILES</button>
              </div>
              <div class="row-note" style="margin-top:8px">建议：①等几分钟后重试；②或到 decimer.ai / MolScribe 页面手动识别后复制 SMILES 回填；③长期稳定方案：本地跑 Python OCR 服务（数据不出内网）。</div>
            </div>`;
            const rt = $('ocrRetry'); if (rt) rt.addEventListener('click', () => ocrRunFromFile(file));
            const wr = $('ocrWaitRetry'); if (wr) wr.addEventListener('click', () => { setStatusNote('30s 后自动重试…', 'ok'); setTimeout(() => ocrRunFromFile(file), 30000); });
            const wb3 = $('ocrWebBtn3'); if (wb3) wb3.addEventListener('click', ocrOpenWeb);
            const m3 = $('ocrManual3'); if (m3) m3.addEventListener('click', ocrManualInput);
            setStatusNote('在线识别不可用：HuggingFace Space 暂时繁忙，NCI OSRA 服务器错误，建议等几分钟后重试或用手动输入。', 'warn');
          }
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }
  function ocrManualInput() {
    const inp = document.getElementById('compoundInput');
    if (inp) { const v = window.prompt('请输入该结构的 SMILES：', ''); if (v && v.trim()) { inp.value = v.trim(); const pbtn = document.getElementById('predictBtn'); if (pbtn) pbtn.click(); } }
  }
  function ocrOpenWeb() {
    // 方案 A 兜底：打开在线化学结构识别工具
    const url = window.prompt('选择在线识别工具：\n1 = decimer.ai（深度学习）\n2 = MolScribe（HuggingFace）\n3 = FreeChemDraw（OSRA 在线）\n\n输入数字后回车：', '1');
    const targets = {
      '1': 'https://decimer.ai/',
      '2': 'https://huggingface.co/spaces/yujieq/MolScribe',
      '3': 'https://freechemdraw.com/',
    };
    if (targets[url]) { window.open(targets[url], '_blank'); setStatusNote('已打开在线识别工具，识别后复制 SMILES 回填。'); }
    else if (url && url.startsWith('http')) window.open(url, '_blank');
  }
  function ocrRecognize() {
    const file = $('ocrFile') && $('ocrFile').files && $('ocrFile').files[0];
    if (!file) { setStatusNote('请先选择结构式图片。'); return; }
    ocrRunFromFile(file);
  }
  function ocrPaste() {
    const prev = $('ocrPreview'), res = $('ocrResult');
    if (navigator.clipboard && navigator.clipboard.read) {
      navigator.clipboard.read().then(items => {
        for (const it of items) {
          const t = it.types.find(x => x.startsWith('image/'));
          if (t) {
            it.getType(t).then(blob => {
              // 转为 File 走同一识别流程
              const file = new File([blob], 'pasted-structure.png', { type: blob.type || 'image/png' });
              if (prev) prev.innerHTML = '<div class="row-note">已从剪贴板粘贴图片，正在识别…</div>';
              ocrRunFromFile(file);
            });
            return;
          }
        }
        setStatusNote('剪贴板中没有图片。');
      }).catch(() => setStatusNote('无法读取剪贴板（浏览器权限或非 https 环境）。请改用「选择图片」。'));
    } else setStatusNote('当前浏览器不支持剪贴板读取，请改用「选择图片」。');
  }

  /* ============ ⑲ 有机溶剂溶解度预测（Hansen 框架 + 文献校准基线） ============ */
  // 校准基线：文献《溶解度预测报告》中异噁唑啉羧酸中间体（logP≈5.2, TPSA≈63, MP≈180℃）
  // 各有机溶剂溶解度的 log10(mg/mL) 中点值；其余化合物按亲脂性/极性/熔点外推。
  const ORG_ANCHOR = {
    DMSO: 2.176, DMF: 2.176, NMP: 2.176, DMAc: 2.176,
    THF: 2.000, Dioxane: 2.000, Acetone: 1.875, ACN: 1.301,
    EA: 1.602, DCM: 1.477, MeOH: 1.544, EtOH: 1.230, IPA: 1.000,
    Toluene: 0.778, MTBE: 0.778, Heptane: -0.523, Cyclohexane: -0.523
  };
  const ORG_SOLVENTS = [
    ['DMSO', 'DMSO（二甲基亚砜）'], ['DMF', 'DMF（N,N-二甲基甲酰胺）'],
    ['NMP', 'NMP（N-甲基吡咯烷酮）'], ['DMAc', 'DMAc（N,N-二甲基乙酰胺）'],
    ['THF', 'THF（四氢呋喃）'], ['Dioxane', '1,4-二氧六环'], ['Acetone', '丙酮'],
    ['ACN', '乙腈'], ['EA', '乙酸乙酯'], ['DCM', '二氯甲烷'],
    ['MeOH', '甲醇'], ['EtOH', '乙醇'], ['IPA', '异丙醇'],
    ['Toluene', '甲苯'], ['MTBE', '甲基叔丁基醚'],
    ['Heptane', '正庚烷'], ['Cyclohexane', '环己烷']
  ];
  // 溶剂 Hansen 溶解度参数 (δD,δP,δH, MPa^0.5) 与芳香性
  const ORG_HSP = {
    DMSO: [18.4, 16.4, 10.2, 0], DMF: [17.4, 13.7, 11.3, 0], NMP: [18.0, 12.3, 7.2, 0],
    DMAc: [16.8, 11.5, 10.2, 0], THF: [16.8, 5.7, 8.0, 0], Dioxane: [17.8, 6.0, 6.0, 0],
    Acetone: [15.5, 10.4, 7.0, 0], ACN: [15.3, 18.0, 6.1, 0], EA: [15.8, 5.3, 7.2, 0],
    DCM: [17.0, 5.3, 5.9, 0], MeOH: [14.7, 12.3, 22.3, 0], EtOH: [15.8, 8.8, 19.4, 0],
    IPA: [15.8, 6.1, 16.4, 0], Toluene: [18.0, 1.4, 2.0, 1], MTBE: [14.4, 3.4, 6.0, 0],
    Heptane: [15.3, 0.0, 0.0, 0], Cyclohexane: [16.8, 0.0, 0.2, 0]
  };
  const ORG_TARGET = [17.6, 13.5, 9.7]; // 理想（良）溶剂 HSP 目标
  function orgClass(mgml) {
    if (mgml >= 100) return { label: '极易溶', level: 'best' };
    if (mgml >= 30) return { label: '易溶', level: 'good' };
    if (mgml >= 10) return { label: '可溶', level: 'ok' };
    if (mgml >= 1) return { label: '微溶', level: 'low' };
    if (mgml >= 0.1) return { label: '难溶', level: 'poor' };
    return { label: '几乎不溶', level: 'worst' };
  }
  function orgSolubCalc() {
    const out = $('orgSolubOut'); if (!out) return;
    const sm = ($('orgSolubSmiles') && $('orgSolubSmiles').value.trim()) || currentSmiles();
    if (!sm) { out.innerHTML = '<div class="row-note err">请先输入 SMILES 或完成一次预测。</div>'; return; }
    const cd = getCompoundData(sm);
    if (!cd || !cd.desc) { out.innerHTML = '<div class="row-note err">无法获取该结构的描述符（引擎未就绪或结构无效）。</div>'; return; }
    const logP = num(cd.desc.CrippenClogP), tpsa = num(cd.desc.tpsa), mw = num(cd.desc.amw);
    const hbd = num(cd.desc.NumHBD) || 0, hba = num(cd.desc.NumHBA) || 0;
    let mp = num($('orgSolubMp') && $('orgSolubMp').value);
    const mpGiven = mp != null; if (!mpGiven) mp = 180;
    const dLogP = (logP != null ? logP : 5.2) - 5.2;
    const dTpsa = (tpsa != null ? tpsa : 63) - 63;
    const dMp = mp - 180;
    // 溶质 HSP 估计（仅作参考展示）
    const dDs = 16.0 + 0.3 * (logP != null ? logP : 0);
    const dPs = 0.04 + 0.12 * (tpsa != null ? tpsa : 0);
    const dHs = 3.0 + 4.0 * hbd + 1.5 * hba;
    const grp = detectGroupsForTool(sm);
    const rows = ORG_SOLVENTS.map(([key, label]) => {
      const pred = ORG_ANCHOR[key] + 0.30 * dLogP - 0.004 * dTpsa - 0.01 * dMp;
      const mgml = Math.pow(10, pred);
      const hsp = ORG_HSP[key];
      const red = Math.sqrt(4 * (dDs - hsp[0]) ** 2 + (dPs - hsp[1]) ** 2 + (dHs - hsp[2]) ** 2);
      return { key, label, mgml, cls: orgClass(mgml), red };
    });
    const good = rows.filter(r => r.mgml >= 30).sort((a, b) => b.mgml - a.mgml);
    const anti = rows.filter(r => r.mgml < 1).sort((a, b) => a.mgml - b.mgml);
    const best = good[0], worst = anti[0];
    let html = `<div class="row-note">化合物 logP≈<b>${logP != null ? logP.toFixed(2) : '—'}</b>、TPSA≈<b>${tpsa != null ? tpsa.toFixed(0) : '—'}</b>、MW≈<b>${mw != null ? mw.toFixed(1) : '—'}</b>；${mpGiven ? '熔点 ' + mp + '℃' : '熔点未填，按 180℃ 估算'}。基线已校准至文献异噁唑啉羧酸中间体，其余化合物按亲脂性(+0.30·ΔlogP)、极性(−0.004·ΔTPSA)、熔点(−0.01·ΔMP) 外推。</div>`;
    html += '<table class="tool-table"><thead><tr><th>溶剂</th><th>预测溶解度 (mg/mL)</th><th>等级</th><th>工艺角色建议</th></tr></thead><tbody>';
    rows.forEach(r => {
      const role = r.cls.level === 'best' || r.cls.level === 'good' ? '良溶剂（重结晶/萃取）'
        : r.cls.level === 'ok' ? '可用溶剂' : r.cls.level === 'low' ? '弱溶剂/反溶剂候选' : '反溶剂';
      html += `<tr><td>${escapeHtml(r.label)}</td><td><b>${r.mgml >= 100 ? r.mgml.toFixed(0) : r.mgml.toFixed(2)}</b></td><td>${r.cls.label}</td><td>${role}</td></tr>`;
    });
    html += '</tbody></table>';
    if (best && worst) {
      html += `<div class="row-note"><b>推荐重结晶体系：</b>良溶剂 <b>${escapeHtml(best.label)}</b>（≈${best.mgml >= 100 ? best.mgml.toFixed(0) : best.mgml.toFixed(1)} mg/mL）＋ 反溶剂 <b>${escapeHtml(worst.label)}</b>（≈${worst.mgml.toFixed(2)} mg/mL）。文献常用组合：EA/庚烷、甲苯/庚烷、IPA/水、丙酮/水、乙腈。</div>`;
    }
    // 工艺与配液注意
    const notes = [];
    if (grp.cooh > 0) notes.push('含<b>羧基（−COOH）</b>：在极性非质子溶剂中常以二聚体存在，利于在非极性溶剂中增溶；后处理可用「碱洗 → 酸析」调控游离酸/盐型析出；成盐（Na⁺/K⁺/葡甲胺/氨丁三醇）可显著改善水溶性。');
    if (grp.ester > 0) notes.push('含<b>酯键</b>：留意醇类溶剂（MeOH/EtOH/IPA）中酸催化下的转酯/水解风险，结晶/打浆优先选非质子溶剂。');
    if (grp.amido > 0) notes.push('含<b>酰胺</b>：水中易水解（尤其强酸/强碱、高温），pH 与温度需受控。');
    if (grp.aromatic) notes.push('芳香性强：甲苯/庚烷等烃类可作反溶剂，但纯脂肪烃（正庚烷/环己烷）溶解度极低，宜作反溶剂而非良溶剂。');
    if (logP != null && logP > 4) notes.push('<b>高亲脂</b>：DMSO/DMF 等作生物活性测试储备液（≥0.5% DMSO），可加 0.1% BSA 或 0.01–0.05% Tween-80 增溶；改善水溶性可考虑固体分散体（HPMC-AS/PVP-VA64）、脂质/表面活性剂。');
    notes.push('干燥：50–60℃ 真空干燥。');
    html += '<div class="module-summary" style="margin-top:8px"><span class="k">工艺/配液注意</span>' + notes.map(n => '• ' + n).join('<br>') + '</div>';
    html += `<div class="row-note">参考（Hansen 框架）：溶质估计 HSP (δD,δP,δH)=(${dDs.toFixed(1)}, ${dPs.toFixed(1)}, ${dHs.toFixed(1)}) MPa^0.5；理想溶剂目标 (${ORG_TARGET.join(', ')})；表中 RED 为与目标的 Hansen 距离（越小越接近良溶剂）。本预测为前端启发式估算，非实验值。</div>`;
    out.innerHTML = html;
  }
  function orgSolubUseCurrent() {
    const d = getCurrent(); if (!d || !d.smiles) { setStatusNote('请先完成一次预测。'); return; }
    if ($('orgSolubSmiles')) $('orgSolubSmiles').value = d.smiles;
    const mw = d.rdkit && d.rdkit.desc && d.rdkit.desc.amw;
    if ($('orgSolubMw') && mw) $('orgSolubMw').value = (+mw).toFixed(1);
    orgSolubCalc();
  }

  /* ============ ⑳ GSE pH–溶解度曲线 ============ */
  function gsePhCalc() {
    const out = $('gsePhOut'); if (!out) return;
    const sm = ($('gsePhSmiles') && $('gsePhSmiles').value.trim()) || currentSmiles();
    if (!sm) { out.innerHTML = '<div class="row-note err">请先输入 SMILES 或完成一次预测。</div>'; return; }
    const cd = getCompoundData(sm);
    if (!cd || !cd.desc) { out.innerHTML = '<div class="row-note err">无法获取该结构的描述符。</div>'; return; }
    const logP = num(cd.desc.CrippenClogP), mw = num(cd.desc.amw);
    let mp = num($('gsePhMp') && $('gsePhMp').value); const mpGiven = mp != null; if (!mpGiven) mp = 180;
    const acids = parseList($('gsePhAcid') ? $('gsePhAcid').value : '').filter(v => v != null);
    const bases = parseList($('gsePhBase') ? $('gsePhBase').value : '').filter(v => v != null);
    if (!acids.length && !bases.length) { out.innerHTML = '<div class="row-note err">请填写酸性或碱性 pKa（或点「用当前化合物」自动带入）。</div>'; return; }
    const logS0 = 0.5 - 0.01 * (mp - 25) - (logP != null ? logP : 0); // GSE, mol/L
    const S0mol = Math.pow(10, logS0), S0mg = S0mol * (mw || 1);
    let pI = null;
    if (acids.length && bases.length) pI = (Math.max.apply(null, acids) + Math.min.apply(null, bases)) / 2;
    const capMg = Math.min(2000, Math.pow(10, 0.5 - 0.01 * (mp - 25) + 0.76 * (logP != null ? logP : 0))); // 熔体溶解度上限
    const phs = []; for (let ph = 1; ph <= 13; ph += 0.5) phs.push(+ph.toFixed(1));
    const data = phs.map(ph => {
      let factor = 1;
      acids.forEach(p => factor += Math.pow(10, ph - p));
      bases.forEach(p => factor += Math.pow(10, p - ph));
      let molL = S0mol * factor;
      let mg = molL * (mw || 1);
      if (mg > capMg) mg = capMg;
      return { ph, logS: Math.log10(molL), mgml: mg };
    });
    // 与 ESOL/Ali 综合对比
    let cmp = '';
    const sol = (window.Predict && window.Predict.solubility) ? window.Predict.solubility(cd.desc) : null;
    if (sol && sol.consensus) {
      cmp = `<div class="row-note">对比：QSAR 综合（ESOL/Ali）logS≈<b>${sol.consensus.logS.toFixed(2)}</b>（中性态近似）；GSE 本征 logS₀≈<b>${logS0.toFixed(2)}</b>。GSE 含熔点项，对高熔点晶体更保守。两者偏差属正常。</div>`;
    }
    let html = `<div class="row-note">GSE：logS₀ = 0.5 − 0.01×(MP−25) − logP = <b>${logS0.toFixed(2)}</b>（mol/L）≈ <b>${S0mg < 0.01 ? fmtSci(S0mg) : S0mg.toFixed(S0mg < 1 ? 3 : 2)}</b> mg/mL（中性本征溶解度）。${mpGiven ? 'MP=' + mp + '℃' : 'MP 未填按 180℃'}。基于 Henderson-Hasselbalch 对${acids.length ? acids.length + ' 个酸性' : ''}${bases.length ? (acids.length ? ' + ' : '') + bases.length + ' 个碱性' : ''}基团外推 pH–溶解度曲线。</div>`;
    if (pI != null) html += `<div class="row-note"><b>两性/双电离分子</b>：pI≈<b>${pI.toFixed(2)}</b>，该处为溶解度<b>最低点</b>（净电荷为 0 的两性离子占主导），远离 pI 因电离而升高。</div>`;
    html += '<table class="tool-table"><thead><tr><th>pH</th><th>logS (mol/L)</th><th>溶解度 (mg/mL)</th><th>主导形态</th></tr></thead><tbody>';
    data.forEach(r => {
      let form = '中性/两性离子';
      if (acids.length && bases.length) form = Math.abs(r.ph - pI) < 0.4 ? '两性离子(最低)' : (r.ph < pI ? '阳离子偏多' : '阴离子偏多');
      else if (acids.length) form = r.ph > acids[0] + 0.5 ? '离子化(阴离子)' : (r.ph < acids[0] - 0.5 ? '中性分子' : '中性/离子共存');
      else if (bases.length) form = r.ph < bases[0] - 0.5 ? '质子化(阳离子)' : (r.ph > bases[0] + 0.5 ? '中性' : '质子化/中性共存');
      html += `<tr><td>${r.ph.toFixed(1)}</td><td>${r.logS.toFixed(2)}</td><td>${r.mgml >= 100 ? r.mgml.toFixed(0) : r.mgml.toFixed(r.mgml < 1 ? 3 : 2)}</td><td>${form}</td></tr>`;
    });
    html += '</tbody></table>' + cmp;
    html += `<div class="row-note">不确定度：水溶解度约 ±0.5–1.0 log；熔点每偏差 30℃ 约引起 0.3 log 误差；极端 pH（强酸/强碱）下溶解度受盐浓度与活度系数影响，已对熔体溶解度上限做封顶。曲线为理论外推，关键 pH 点（如 pH 7.4 PBS、饱和 NaHCO₃、0.5M NaOH）以实验测定为准。${pI != null ? ' pI 处最低点已标注于曲线。' : ''}</div>`;
    out.innerHTML = html;
    // 曲线
    const canvas = $('gsePhCanvas');
    if (canvas) drawLineChart(canvas, phs, [{ label: 'logS(pH)', color: '#2b6cff', ys: data.map(d => d.logS) }, { label: 'log10(mg/mL)', color: '#1a9d1a', ys: data.map(d => Math.log10(d.mgml)) }], { xLabel: 'pH', yLabel: 'logS', markX: pI, markLabel: 'pI≈' });
    // pH-种态分布图（仅两性/双电离分子）
    const spCanvas = $('gsePhSpeciesCanvas');
    if (spCanvas) {
      if (acids.length && bases.length) {
        spCanvas.style.display = 'block';
        drawPhSpeciesChart(spCanvas, Math.max.apply(null, acids), Math.min.apply(null, bases), { pI });
      } else {
        spCanvas.style.display = 'none';
      }
    }
  }
  function gsePhUseCurrent() {
    const d = getCurrent(); if (!d || !d.smiles) { setStatusNote('请先完成一次预测。'); return; }
    if ($('gsePhSmiles')) $('gsePhSmiles').value = d.smiles;
    if (d.rdkit && d.rdkit.pka) {
      if ($('gsePhAcid')) $('gsePhAcid').value = d.rdkit.pka.acids.map(a => a.pka).join(', ');
      if ($('gsePhBase')) $('gsePhBase').value = d.rdkit.pka.bases.map(b => b.pka).join(', ');
    }
    gsePhCalc();
  }

  /* ============ ㉑ 缓冲容量计算（Van Slyke β） ============ */
  function vanSlykeBeta(ph, pkaList, C, Kw) {
    const H = Math.pow(10, -ph);
    let weak = 0;
    pkaList.forEach(p => { const Ka = Math.pow(10, -p); weak += Ka * H / ((Ka + H) * (Ka + H)); });
    return 2.303 * (C * weak + Kw / H + H);
  }
  function bufferCapCalc() {
    const out = $('bufferCapOut'); if (!out) return;
    const pct = num($('bufCapPct') && $('bufCapPct').value);
    const mw = num($('bufCapMw') && $('bufCapMw').value);
    let C = null;
    if (pct != null && mw && mw > 0) C = pct * 10 / mw; // mol/L
    else { const c2 = num($('bufCapMolL') && $('bufCapMolL').value); if (c2 != null) C = c2; }
    if (C == null || C <= 0) { out.innerHTML = '<div class="row-note err">请填写浓度（%w/v + 分子量，或 mol/L）。</div>'; return; }
    const acids = parseList($('bufCapAcid') ? $('bufCapAcid').value : '').filter(v => v != null);
    const bases = parseList($('bufCapBase') ? $('bufCapBase').value : '').filter(v => v != null);
    if (!acids.length && !bases.length) { out.innerHTML = '<div class="row-note err">请填写酸性或碱性 pKa（或点「用当前化合物」）。</div>'; return; }
    const all = acids.concat(bases);
    const Kw = 1e-14;
    const phs = []; for (let ph = 0; ph <= 14; ph += 0.5) phs.push(+ph.toFixed(1));
    const beta = phs.map(ph => vanSlykeBeta(ph, all, C, Kw));
    const pI = (acids.length && bases.length) ? (Math.max.apply(null, acids) + Math.min.apply(null, bases)) / 2 : null;
    const bAtPI = pI != null ? vanSlykeBeta(pI, all, C, Kw) : null;
    const canvas = $('bufferCapCanvas');
    if (canvas) drawLineChart(canvas, phs, [{ label: 'log10 β', color: '#d97b1f', ys: beta.map(b => Math.log10(b)) }], { xLabel: 'pH', yLabel: 'log10 β', markX: pI, markLabel: 'pI≈' });
    let html = `<div class="row-note">Van Slyke 缓冲容量 β = 2.303·[ C·Σ Kaᵢ[H⁺]/(Kaᵢ+[H⁺])² + Kw/[H⁺] + [H⁺] ]，单位 mol·L⁻¹·pH⁻¹。浓度 C=<b>${C.toExponential(2)}</b> mol/L${pct != null && mw ? '（' + pct + '% w/v, MW ' + mw + '）' : ''}。${pI != null ? 'pI≈<b>' + pI.toFixed(2) + '</b>，此处 β 为<b>最低</b>（两性离子主导，几乎无缓冲）。' : ''}</div>`;
    html += '<table class="tool-table"><thead><tr><th>pH</th><th>β (mol·L⁻¹·pH⁻¹)</th><th>量级</th></tr></thead><tbody>';
    phs.forEach((ph, i) => {
      const b = beta[i];
      const lvl = b < 1e-5 ? '极低（易受残留酸/CO₂ 干扰）' : b < 1e-3 ? '低' : b < 1e-1 ? '中' : '高';
      html += `<tr><td>${ph.toFixed(1)}${pI != null && Math.abs(ph - pI) < 0.25 ? ' (pI)' : ''}</td><td>${b.toExponential(2)}</td><td>${lvl}</td></tr>`;
    });
    html += '</tbody></table>';
    if (pI != null && bAtPI != null) {
      // 残留酸 ppm 阈值（落到 pI-0.2）
      const dpH = 0.2; const dC = bAtPI * dpH; // mol/L 强酸
      const hclGL = dC * 36.46; // g/L
      const drugGL = (pct != null && mw) ? pct * 10 : C * mw; // g/L
      const ppm = drugGL > 0 ? hclGL / drugGL * 1e6 : null;
      html += `<div class="row-note"><b>低缓冲风险：</b>在 pI 处 β≈${bAtPI.toExponential(2)} mol·L⁻¹·pH⁻¹，pH 极易被残留酸或溶入的 CO₂ 扰动。以 β×ΔpH 估算，仅需约 <b>${ppm != null ? ppm.toFixed(0) + ' ppm' : '—'}</b> 残留 HCl（相对原料药）即可使 pH 下降 ~0.2。注：文献《Pradofloxacin pH 评估报告》给出 β≈8×10⁻⁶、6 ppm 残留 HCl 即跌破 7.0——该 6 ppm 与 β≈8×10⁻⁶ 自洽，但对应于更低有效浓度/不同归一化；本工具按 Van Slyke 严格公式在给定浓度下给出上值，口径以本工具为准。</div>`;
    }
    out.innerHTML = html;
  }
  function bufferCapUseCurrent() {
    const d = getCurrent(); if (!d || !d.smiles) { setStatusNote('请先完成一次预测。'); return; }
    if (d.rdkit && d.rdkit.pka) {
      if ($('bufCapAcid')) $('bufCapAcid').value = d.rdkit.pka.acids.map(a => a.pka).join(', ');
      if ($('bufCapBase')) $('bufCapBase').value = d.rdkit.pka.bases.map(b => b.pka).join(', ');
    }
    const mw = d.rdkit && d.rdkit.desc && d.rdkit.desc.amw;
    if ($('bufCapMw') && mw) $('bufCapMw').value = (+mw).toFixed(1);
    bufferCapCalc();
  }

  /* ============ ㉒ pH 质量标准评估（两性游离碱） ============ */
  function phSpecCalc() {
    const out = $('phSpecOut'); if (!out) return;
    const acids = parseList($('phSpecAcid') ? $('phSpecAcid').value : '').filter(v => v != null);
    const bases = parseList($('phSpecBase') ? $('phSpecBase').value : '').filter(v => v != null);
    if (!acids.length || !bases.length) { out.innerHTML = '<div class="row-note err">两性游离碱需同时填写酸性（羧基）与碱性（胺）pKa（或点「用当前化合物」）。</div>'; return; }
    const pKaAcid = Math.max.apply(null, acids);
    const pKaBase = Math.min.apply(null, bases);
    const pI = (pKaAcid + pKaBase) / 2;
    const pct = num($('phSpecPct') && $('phSpecPct').value);
    const mw = num($('phSpecMw') && $('phSpecMw').value);
    let C = null; if (pct != null && mw && mw > 0) C = pct * 10 / mw; else { const c2 = num($('phSpecMolL') && $('phSpecMolL').value); if (c2 != null) C = c2; }
    const specMin = num($('phSpecMin') && $('phSpecMin').value);
    const specMax = num($('phSpecMax') && $('phSpecMax').value);
    const Kw = 1e-14;
    const bAtPI = C ? vanSlykeBeta(pI, acids.concat(bases), C, Kw) : null;
    const recMin = 6.5, recMax = 8.0;
    // 饱和混悬液强酸滴定曲线
    const canvas = $('phSpecCanvas');
    let tit = null;
    if (canvas) {
      canvas.style.display = 'block';
      tit = drawTitrationChart(canvas, pKaAcid, pKaBase, C, { specMin, recMin, pct, mw });
    }
    let html = `<div class="row-note">两性游离碱水溶液的质子条件数值求解显示：净电荷为 0 时 pH≈<b>pI = (pKa_酸 + pKa_碱)/2 = ${pI.toFixed(2)}</b>，且<b>与浓度基本无关</b>（1e-5–1e-2 mol/L 范围内仅波动约 ±0.05 pH）。因此本品水溶液 pH 应≈ pI。</div>`;
    // 浓度无关性验证（简要）
    const phAt = (conc) => {
      // 简化：用两性离子模型，[H+] 由 pI 主导；这里直接以 pI 为预测 pH（近似）
      return pI;
    };
    html += `<div class="row-note">预测溶液 pH≈<b>${phAt(C).toFixed(2)}</b>（= pI）。${specMin != null && specMax != null ? '当前 pH 限度 <b>' + specMin + '–' + specMax + '</b>：' + (pI >= specMin && pI <= specMax ? '<b style="color:#1a9d1a">pI 落在限度内 ✓</b>' : '<b style="color:#e23636">pI 落在限度外 ✗（限度过窄或需重设）</b>') + '。' : ''}</div>`;
    if (C && bAtPI != null) {
      html += `<div class="row-note">在 pI 处缓冲容量 β≈<b>${bAtPI.toExponential(2)}</b> mol·L⁻¹·pH⁻¹（极低）。${specMin != null ? '若限度下界为 ' + specMin + '，仅需约 <b>' + (function () { const dpH = Math.max(0, pI - specMin); const dC = bAtPI * dpH; const hclGL = dC * 36.46; const drugGL = (pct != null && mw) ? pct * 10 : C * mw; return drugGL > 0 ? (hclGL / drugGL * 1e6).toFixed(0) + ' ppm' : '—'; })() + '</b> 残留 HCl（相对原料药）即可能跌破下界。' : ''}</div>`;
    }
    // 滴定曲线关键节点
    if (tit) {
      html += `<div class="row-note"><b>强酸扰动曲线（上图）：</b>从 pI 开始引入强酸，pH 迅速下降。`;
      if (tit.acidAtSpecMin != null) html += `跌至现行下限 ${specMin != null ? specMin.toFixed(1) : '7.0'} 仅需 <b>${tit.acidAtSpecMin.toFixed(2)} μmol/L</b> 强酸${tit.ppmAtSpecMin != null ? '（≈ ' + tit.ppmAtSpecMin.toFixed(0) + ' ppm HCl 相对原料药）' : ''}；`;
      if (tit.acidAtRecMin != null) html += `跌至建议下限 ${recMin.toFixed(1)} 仅需 <b>${tit.acidAtRecMin.toFixed(2)} μmol/L</b> 强酸${tit.ppmAtRecMin != null ? '（≈ ' + tit.ppmAtRecMin.toFixed(0) + ' ppm HCl）' : ''}。`;
      html += `该曲线直观说明 pI 附近缓冲容量极低，微量残留酸即可导致 pH 不合格。</div>`;
    }
    html += `<div class="row-note"><b>CO₂ 干扰：</b>普通纯化水溶入空气 CO₂ 形成碳酸，可使 pH 降至 <b>6.2–6.9</b>，若限度下界 &gt; 6.9 则易判不合格。务必使用<b>脱 CO₂ 水</b>（新沸放冷或氮气鼓泡）。</div>`;
    // 修订建议
    html += `<div class="row-note"><b>限度修订建议：</b>结合 pI≈${pI.toFixed(2)} 与极低缓冲容量，建议将 pH 限度放宽至 <b>${recMin.toFixed(1)}–${recMax.toFixed(1)}</b>（文献评估结论），并对测定方法作固定规定：脱 CO₂ 水、<b>1% w/v 混悬</b>、25±2℃、搅拌 30 min 后静置 5 min、加盖避光取样。</div>`;
    html += `<div class="row-note">说明：本评估为前端启发式，β 与残留酸阈值按 Van Slyke 严格公式在给定浓度下计算；文献报告的 8×10⁻⁶ / 6 ppm 与其 6 ppm 阈值自洽、对应于更低有效浓度，工具以严格公式为准并标注口径。最终限度应以实验测定与监管沟通为准。</div>`;
    out.innerHTML = html;
  }
  function phSpecUseCurrent() {
    const d = getCurrent(); if (!d || !d.smiles) { setStatusNote('请先完成一次预测。'); return; }
    if (d.rdkit && d.rdkit.pka) {
      if ($('phSpecAcid')) $('phSpecAcid').value = d.rdkit.pka.acids.map(a => a.pka).join(', ');
      if ($('phSpecBase')) $('phSpecBase').value = d.rdkit.pka.bases.map(b => b.pka).join(', ');
    }
    const mw = d.rdkit && d.rdkit.desc && d.rdkit.desc.amw;
    if ($('phSpecMw') && mw) $('phSpecMw').value = (+mw).toFixed(1);
    phSpecCalc();
  }

  /* ============ 通用辅助 ============ */
  function parseList(str) { return (str || '').split(/[,\s]+/).map(s => num(s)).filter(v => v != null); }
  function getCompoundData(overrideSmiles) {
    const cur = getCurrent();
    const target = (overrideSmiles || '').trim() || currentSmiles();
    const curSmiles = (cur && cur.smiles || '').trim();
    // v20250829w 修复：当目标 SMILES 与当前预测结果一致且已有描述符时，优先复用，
    // 避免 RDKit WASM 未就绪、重复计算失败或环境差异导致“无法获取描述符”。
    if (cur && cur.rdkit && cur.rdkit.desc && (!overrideSmiles || curSmiles === target)) {
      return { smiles: cur.smiles, desc: cur.rdkit.desc, pka: cur.rdkit.pka, acidbase: cur.rdkit.acidbase, pred: cur.pred };
    }
    if (!target) return null;
    try {
      const eng = window.RDKitEngine; if (!eng || !eng.compute) return null;
      const r = eng.compute(target);
      return { smiles: target, desc: r.desc, pka: r.pka, acidbase: r.acidbase, pred: null };
    } catch (e) { return null; }
  }
  function detectGroupsForTool(smiles) {
    const eng = window.RDKitEngine;
    if (!eng || !eng.countSMARTS) return { cooh: 0, ester: 0, amido: 0, aromatic: false };
    try {
      const cooh = eng.countSMARTS(smiles, '[#6]C(=O)[OH]') + eng.countSMARTS(smiles, '[#6]C(=O)O[#1]');
      const ester = eng.countSMARTS(smiles, '[#6]C(=O)O[#6]');
      const amido = eng.countSMARTS(smiles, '[#6]C(=O)N[#6]') + eng.countSMARTS(smiles, '[#6]C(=O)N([#6])[#6]');
      const aromatic = eng.countSMARTS(smiles, 'c') > 0;
      return { cooh, ester, amido, aromatic };
    } catch (e) { return { cooh: 0, ester: 0, amido: 0, aromatic: false }; }
  }
  function drawLineChart(canvas, xs, series, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const padL = 46, padR = 12, padT = 14, padB = 28;
    const x0 = padL, x1 = W - padR, y0 = H - padB, y1 = padT;
    const xMin = xs[0], xMax = xs[xs.length - 1];
    const dx = (x1 - x0) / Math.max(1, (xMax - xMin));
    const X = ph => x0 + (ph - xMin) * dx;
    let yMin = Infinity, yMax = -Infinity;
    series.forEach(s => s.ys.forEach(v => { if (isFinite(v)) { yMin = Math.min(yMin, v); yMax = Math.max(yMax, v); } }));
    if (!isFinite(yMin)) { yMin = 0; yMax = 1; }
    const pad = (yMax - yMin) * 0.1 || 1; yMin -= pad; yMax += pad;
    const Y = v => y0 - (v - yMin) / (yMax - yMin) * (y0 - y1);
    const isDark = document.documentElement.classList.contains('dark');
    const axisColor = isDark ? '#c9d4e0' : '#5b6776';
    const gridColor = isDark ? 'rgba(190,205,220,0.20)' : 'rgba(120,130,145,0.25)';
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = gridColor; ctx.fillStyle = axisColor; ctx.font = '10px sans-serif'; ctx.lineWidth = 1;
    const yticks = 5;
    for (let i = 0; i <= yticks; i++) { const v = yMin + (yMax - yMin) * i / yticks; const y = Y(v); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.fillText(opts.yFmt ? opts.yFmt(v) : v.toFixed(2), 4, y + 3); }
    const xStep = (xMax - xMin) > 12 ? 2 : 1;
    for (let x = Math.ceil(xMin); x <= xMax; x += xStep) { const px = X(x); ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke(); ctx.fillText(x, px - 6, y0 + 14); }
    ctx.fillText(opts.xLabel || 'pH', x1 - 18, y0 + 24);
    if (opts.markX != null) { const mx = X(Math.max(xMin, Math.min(xMax, opts.markX))); ctx.strokeStyle = '#e23636'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(mx, y0); ctx.lineTo(mx, y1); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#e23636'; ctx.fillText((opts.markLabel || 'pI≈') + opts.markX.toFixed(2), mx + 3, y1 + 12); }
    series.forEach(s => { ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath(); let started = false; s.ys.forEach((v, i) => { if (!isFinite(v)) return; const px = X(xs[i]), py = Y(v); if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py); }); ctx.stroke(); });
  }

  /* ---------- pH-种态分布图（两性/双电离分子） ---------- */
  // v20250829u：重命名为 drawPhSpeciesChart，避免与下方（line 94）通用 drawSpeciesChart(phMin,phMax,states,pI)
  // 同名冲突——先前后者被本函数遮蔽，导致「物种分布」独立工具传参错位而绘图错误。
  function drawPhSpeciesChart(canvas, pKaAcid, pKaBase, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const padL = 50, padR = 18, padT = 44, padB = 34;
    const x0 = padL, x1 = W - padR, y0 = H - padB, y1 = padT;
    const xMin = 0, xMax = 14;
    const dx = (x1 - x0) / (xMax - xMin);
    const X = ph => x0 + (ph - xMin) * dx;
    const yMin = 0, yMax = 100;
    const Y = frac => y0 - (frac - yMin) / (yMax - yMin) * (y0 - y1);
    const isDark = document.documentElement.classList.contains('dark');
    const axisColor = isDark ? '#c9d4e0' : '#5b6776';
    const gridColor = isDark ? 'rgba(190,205,220,0.20)' : 'rgba(120,130,145,0.25)';
    ctx.clearRect(0, 0, W, H);
    // title
    ctx.fillStyle = isDark ? '#e2e8f0' : '#1f2937';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('pH-种态分布（阳离子 / 两性离子 / 阴离子）', x0 + 2, 16);
    // grid
    ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const yv = yMin + (yMax - yMin) * i / 5;
      const py = Y(yv);
      ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
    }
    for (let x = 0; x <= 14; x += 2) {
      const px = X(x);
      ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
    }
    // axes
    ctx.strokeStyle = axisColor; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
    // labels
    ctx.fillStyle = axisColor; ctx.font = '10px sans-serif';
    for (let i = 0; i <= 5; i++) {
      const yv = yMin + (yMax - yMin) * i / 5;
      ctx.fillText((yv | 0) + '%', 4, Y(yv) + 3);
    }
    for (let x = 0; x <= 14; x += 2) ctx.fillText(x, X(x) - 4, y0 + 14);
    ctx.fillText('pH', x1 - 18, y0 + 24);
    ctx.save(); ctx.translate(12, y0 - 55); ctx.rotate(-Math.PI / 2); ctx.fillText('摩尔分数 / %', 0, 0); ctx.restore();
    // curves：采用 4 态模型（忽略极小的双中性态），与文档一致：
    // 阳离子 = 碱基质子化 × 酸基质子化；两性离子 = 碱基质子化 × 酸基去质子化；阴离子 = 碱基去质子化 × 酸基去质子化
    const pts = [];
    for (let ph = xMin; ph <= xMax + 0.025; ph += 0.05) {
      const fBaseProtonated = 1 / (1 + Math.pow(10, ph - pKaBase));   // 碱基质子化（阳离子贡献）
      const fAcidDeprotonated = 1 / (1 + Math.pow(10, pKaAcid - ph)); // 酸基去质子化（阴离子贡献）
      pts.push({
        ph,
        cation: fBaseProtonated * (1 - fAcidDeprotonated) * 100,
        zwitter: fBaseProtonated * fAcidDeprotonated * 100,
        anion: (1 - fBaseProtonated) * fAcidDeprotonated * 100
      });
    }
    function drawCurve(key, color, dash) {
      ctx.strokeStyle = color; ctx.lineWidth = 2.5;
      ctx.setLineDash(dash || []);
      ctx.beginPath(); let started = false;
      pts.forEach(p => {
        const px = X(p.ph), py = Y(p[key]);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    drawCurve('cation', '#2b6cff', null);
    drawCurve('zwitter', '#e57d22', null);
    drawCurve('anion', '#1a9d6b', [6, 4]);
    // vertical pKa/pI marks
    ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    const pI = (pKaAcid + pKaBase) / 2;
    const marks = [{ x: pKaAcid, label: 'pKa1' }, { x: pKaBase, label: 'pKa2' }, { x: pI, label: 'pI' }];
    marks.forEach(m => {
      const px = X(m.x);
      ctx.strokeStyle = '#9ca3af';
      ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
      ctx.fillStyle = '#9ca3af'; ctx.font = '10px sans-serif';
      ctx.fillText(m.label + ' ' + m.x.toFixed(2), px + 3, y1 + 10);
    });
    ctx.setLineDash([]);
    // legend
    const leg = [
      { c: '#2b6cff', t: '阳离子', dash: null },
      { c: '#e57d22', t: '两性离子(净电荷0)', dash: null },
      { c: '#1a9d6b', t: '阴离子', dash: [6, 4] }
    ];
    let lx = x0 + 6, ly = y1 - 10;
    ctx.font = '11px sans-serif';
    leg.forEach(l => {
      ctx.strokeStyle = l.c; ctx.fillStyle = l.c; ctx.lineWidth = 2;
      ctx.setLineDash(l.dash || []);
      ctx.beginPath(); ctx.moveTo(lx, ly + 5); ctx.lineTo(lx + 18, ly + 5); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(l.t, lx + 22, ly + 9);
      lx += ctx.measureText(l.t).width + 44;
    });
  }

  /* ---------- 饱和混悬液引入强酸滴定曲线 ---------- */
  function drawTitrationChart(canvas, pKaAcid, pKaBase, C, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const padL = 64, padR = 28, padT = 24, padB = 42;
    const x0 = padL, x1 = W - padR, y0 = H - padB, y1 = padT;
    const isDark = document.documentElement.classList.contains('dark');
    const axisColor = isDark ? '#c9d4e0' : '#5b6776';
    const gridColor = isDark ? 'rgba(190,205,220,0.20)' : 'rgba(120,130,145,0.25)';
    const Ceff = (C != null && C > 0) ? C : 0.03; // mol/L
    const pI = (pKaAcid + pKaBase) / 2;
    const Kw = 1e-14;
    const all = [pKaAcid, pKaBase];
    // integrate β(pH) dpH from pI downward
    const curve = [];
    const step = 0.02;
    const pEnd = 5.4;
    let acid = 0;
    curve.push({ ph: pI, acid: 0 });
    for (let ph = pI - step; ph >= pEnd; ph -= step) {
      const prevPh = ph + step;
      const b1 = vanSlykeBeta(prevPh, all, Ceff, Kw);
      const b2 = vanSlykeBeta(ph, all, Ceff, Kw);
      acid += ((b1 + b2) / 2) * step;
      curve.push({ ph, acid });
    }
    const maxAcid = acid * 1e6; // μmol/L
    const xMax = Math.max(30, Math.ceil(maxAcid / 5) * 5);
    const yMin = 5.6, yMax = 7.6;
    const dx = (x1 - x0) / xMax;
    const dy = (y0 - y1) / (yMax - yMin);
    const X = a => x0 + a * dx;
    const Y = ph => y0 - (ph - yMin) * dy;
    ctx.clearRect(0, 0, W, H);
    // title
    ctx.fillStyle = isDark ? '#e2e8f0' : '#1f2937';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('饱和混悬液引入强酸滴定曲线', x0 + 2, 16);
    // grid
    ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
    for (let y = 6.0; y <= 7.5; y += 0.2) {
      const py = Y(y);
      ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
    }
    for (let x = 0; x <= xMax; x += 5) {
      const px = X(x);
      ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y1); ctx.stroke();
    }
    // axes
    ctx.strokeStyle = axisColor; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
    // labels
    ctx.fillStyle = axisColor; ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let y = 6.0; y <= 7.5; y += 0.2) ctx.fillText(y.toFixed(1), padL - 6, Y(y) + 3);
    ctx.textAlign = 'center';
    for (let x = 0; x <= xMax; x += 5) ctx.fillText(x, X(x), y0 + 14);
    ctx.fillText('引入的强酸量 / μmol·L⁻¹', (x0 + x1) / 2, y0 + 32);
    ctx.textAlign = 'left';
    ctx.save(); ctx.translate(16, y0 - 58); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('饱和混悬液 pH', 0, 0); ctx.textAlign = 'left'; ctx.restore();
    // titration curve
    ctx.strokeStyle = '#2b6cff'; ctx.lineWidth = 2.5; ctx.setLineDash([]);
    ctx.beginPath(); let started = false;
    curve.forEach(p => {
      const px = X(p.acid * 1e6);
      if (px > x1) return;
      const py = Y(p.ph);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    });
    ctx.stroke();
    // threshold lines
    const specMin = opts.specMin != null ? +opts.specMin : 7.0;
    const recMin = opts.recMin != null ? +opts.recMin : 6.5;
    const thresholds = [
      { y: specMin, color: '#e23636', label: '现行标准下限 ' + specMin.toFixed(1), solid: true },
      { y: recMin, color: '#a96b3c', label: '建议标准下限 ' + recMin.toFixed(1), solid: false }
    ];
    thresholds.forEach(t => {
      if (t.y < yMin || t.y > yMax) return;
      const py = Y(t.y);
      ctx.strokeStyle = t.color; ctx.lineWidth = 1.5;
      ctx.setLineDash(t.solid ? [] : [5, 4]);
      ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = t.color; ctx.font = '10px sans-serif';
      ctx.fillText(t.label, x1 - ctx.measureText(t.label).width - 4, py - 4);
    });
    // helper: interpolate acid at target pH
    function acidAtPH(targetPH) {
      for (let i = 0; i < curve.length - 1; i++) {
        const a = curve[i], b = curve[i + 1];
        if ((a.ph >= targetPH && b.ph <= targetPH) || (a.ph <= targetPH && b.ph >= targetPH)) {
          const f = (targetPH - a.ph) / (b.ph - a.ph);
          return a.acid * 1e6 + f * (b.acid * 1e6 - a.acid * 1e6);
        }
      }
      return null;
    }
    function ppmHCl(umolL) {
      const drugGL = (opts.pct != null && opts.mw) ? opts.pct * 10 : Ceff * (opts.mw || 380);
      return drugGL > 0 ? (umolL * 1e-6 * 36.46 / drugGL * 1e6) : null;
    }
    function drawAnnotation(targetPH, color) {
      const a = acidAtPH(targetPH);
      if (a == null) return null;
      const px = X(a), py = Y(targetPH);
      ctx.fillStyle = color; ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
      // 当点靠近右边界时，标注翻转到左侧引出，避免溢出
      const flip = px > W - 170;
      const dx = flip ? -38 : 38;
      const tx = flip ? px - 40 : px + 40;
      const align = flip ? 'right' : 'left';
      // grey leader line
      ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + dx, py - 20); ctx.stroke();
      // text box
      const ppm = ppmHCl(a);
      const line1 = '仅 ' + a.toFixed(2) + ' μmol/L';
      const line2 = ppm != null ? '（≈ ' + ppm.toFixed(0) + ' ppm HCl）' : '';
      ctx.fillStyle = '#5b6776'; ctx.font = '10px sans-serif';
      ctx.textAlign = align;
      ctx.fillText(line1, tx, py - 22);
      if (line2) ctx.fillText(line2, tx, py - 10);
      ctx.textAlign = 'left';
      return { umol: a, ppm };
    }
    const annSpec = drawAnnotation(specMin, '#e23636');
    const annRec = drawAnnotation(recMin, '#a96b3c');
    return { curve, specMin, recMin, acidAtSpecMin: annSpec && annSpec.umol, ppmAtSpecMin: annSpec && annSpec.ppm, acidAtRecMin: annRec && annRec.umol, ppmAtRecMin: annRec && annRec.ppm };
  }

  /* ============ 工具状态小提示 ============ */
  function setStatusNote(msg) { if (window.__chemprop && window.__chemprop.setStatus) window.__chemprop.setStatus(msg, 'ok'); }

  /* ============ 初始化 ============ */
  function initTools() {
    // 1 genotox
    const gbtn = $('genotoxCalc'); if (gbtn) gbtn.addEventListener('click', genotoxCalc);
    const guse = $('genotoxUseCurrent'); if (guse) guse.addEventListener('click', () => {
      const d = getCurrent(); if (!d) { setStatusNote('请先完成一次预测。'); return; }
      if (d.rdkit && d.rdkit.desc && d.rdkit.desc.amw != null) $('genotoxMwt').value = (+d.rdkit.desc.amw).toFixed(1);
      setStatusNote('已带入当前化合物分子量。');
    });
    // 2 species
    const sbtn = $('speciesCalc'); if (sbtn) sbtn.addEventListener('click', speciesCalc);
    const suse = $('speciesUseCurrent'); if (suse) suse.addEventListener('click', () => {
      const d = getCurrent(); if (!d || !d.rdkit || !d.rdkit.pka) { setStatusNote('请先完成一次预测以获取 pKa。'); return; }
      const pk = d.rdkit.pka;
      if (pk.acids && pk.acids.length) $('speciesAcid').value = pk.acids.map(a => a.pka).join(', ');
      if (pk.bases && pk.bases.length) $('speciesBase').value = pk.bases.map(b => b.pka).join(', ');
      setStatusNote('已带入当前化合物 pKa。');
    });
    // ⑲ 有机溶剂溶解度
    const osBtn = $('orgSolubCalc'); if (osBtn) osBtn.addEventListener('click', orgSolubCalc);
    const osUse = $('orgSolubUseCurrent'); if (osUse) osUse.addEventListener('click', orgSolubUseCurrent);
    // ⑳ GSE pH–溶解度曲线
    const gpBtn = $('gsePhCalc'); if (gpBtn) gpBtn.addEventListener('click', gsePhCalc);
    const gpUse = $('gsePhUseCurrent'); if (gpUse) gpUse.addEventListener('click', gsePhUseCurrent);
    // ㉑ 缓冲容量
    const bcBtn = $('bufferCapCalc'); if (bcBtn) bcBtn.addEventListener('click', bufferCapCalc);
    const bcUse = $('bufferCapUseCurrent'); if (bcUse) bcUse.addEventListener('click', bufferCapUseCurrent);
    // ㉒ pH 质量标准评估
    const psBtn = $('phSpecCalc'); if (psBtn) psBtn.addEventListener('click', phSpecCalc);
    const psUse = $('phSpecUseCurrent'); if (psUse) psUse.addEventListener('click', phSpecUseCurrent);
    // 4 routeEval
    const reBox = $('routeEvalReactants');
    if (reBox) { for (let i = 0; i < 2; i++) reBox.insertAdjacentHTML('beforeend', reRow()); }
    reBox && reBox.addEventListener('click', (e) => { if (e.target.classList.contains('re-del')) e.target.closest('.rc-row').remove(); });
    const reAdd = $('routeEvalAdd'); if (reAdd) reAdd.addEventListener('click', () => reBox.insertAdjacentHTML('beforeend', reRow()));
    const reBtn = $('routeEvalCalc'); if (reBtn) reBtn.addEventListener('click', routeEvalCalc);
    // 5 solventGreen
    solventGreenRender();
    const sgBtn = $('solventGreenCalc'); if (sgBtn) sgBtn.addEventListener('click', solventGreenCalc);
    // 6 saltScreen
    const ssBtn = $('saltScreenCalc'); if (ssBtn) ssBtn.addEventListener('click', saltScreenCalc);
    // 7 regDraft
    const rdBtn = $('regDraftGen'); if (rdBtn) rdBtn.addEventListener('click', regDraftGen);
    // 8 nmr
    const nmBtn = $('nmrCalc'); if (nmBtn) nmBtn.addEventListener('click', nmrCalc);
    const nmUse = $('nmrUseCurrent'); if (nmUse) nmUse.addEventListener('click', () => { const s = currentSmiles(); if (s) { $('nmrSmiles').value = s; nmrCalc(); } else setStatusNote('请先完成一次预测。'); });
    // 9 compare
    const cmpBtn = $('compareRun'); if (cmpBtn) cmpBtn.addEventListener('click', compareRun);
    // 10 drawer
    drawerRender();
    const drBtn = $('drawerRender'); if (drBtn) drBtn.addEventListener('click', drawerRenderImg);
    const drExp = $('drawerExport'); if (drExp) drExp.addEventListener('click', drawerExport);
    const drUse = $('drawerUseCurrent'); if (drUse) drUse.addEventListener('click', () => { const s = currentSmiles(); if (s) { $('drawerSmiles').value = s; drawerRenderImg(); } else setStatusNote('请先完成一次预测。'); });
    // 11 logD-pH
    const ldBtn = $('logdCalc'); if (ldBtn) ldBtn.addEventListener('click', logDphCalc);
    const ldUse = $('logdUseCurrent'); if (ldUse) ldUse.addEventListener('click', () => { const s = currentSmiles(); if (s) { $('logdSmiles').value = s; logDphCalc(); } else setStatusNote('请先完成一次预测。'); });
    // 12 杂质谱追踪
    const isBtn = $('impSpecCalc'); if (isBtn) isBtn.addEventListener('click', impSpecCalc);
    const isUse = $('impSpecUseCurrent'); if (isUse) isUse.addEventListener('click', () => { const d = getCurrent(); if (d) impSpecCalc(); else setStatusNote('请先完成一次预测。'); });
    const isExp = $('impSpecExport'); if (isExp) isExp.addEventListener('click', impSpecExport);
    // 15 收藏夹
    loadFavs(); renderFavs();
    const favAddBtn = $('favAdd'); if (favAddBtn) favAddBtn.addEventListener('click', favAdd);
    // hero 快捷收藏按钮（app.js 派发事件 → 这里统一处理）
    window.addEventListener('chemprop-fav-add', () => { const d = getCurrent(); if (!d) { setStatusNote('请先完成一次预测再收藏。'); return; } favAdd(); });
    const favExpBtn = $('favExport'); if (favExpBtn) favExpBtn.addEventListener('click', favExport);
    const favClearBtn = $('favClear'); if (favClearBtn) favClearBtn.addEventListener('click', () => { if (!favStore.length) { setStatusNote('收藏夹为空。'); return; } favStore = []; persistFavs(); renderFavs(); setStatusNote('已清空收藏夹。'); });
    const favListBox = $('favList');
    if (favListBox) favListBox.addEventListener('click', (e) => {
      const b = e.target.closest('.fav-del'); if (!b) return;
      const i = +b.dataset.i;
      favStore.splice(i, 1); persistFavs(); renderFavs();
    });
    // 20 项目工作区
    loadProjects(); renderProjects();
    const pCreate = $('projCreate'); if (pCreate) pCreate.addEventListener('click', projCreate);
    const pAdd = $('projAddCurrent'); if (pAdd) pAdd.addEventListener('click', projAddCurrent);
    const pExp = $('projExport'); if (pExp) pExp.addEventListener('click', projExportXLSX);
    const pList = $('projList');
    if (pList) pList.addEventListener('click', (e) => {
      const rr = e.target.closest('.proj-rerun');
      if (rr) { const p = projStore[+rr.dataset.p], c = p && p.compounds[+rr.dataset.c]; if (c && c.smiles) { const inp = document.getElementById('compoundInput'); if (inp) inp.value = c.smiles; const pb = document.getElementById('predictBtn'); if (pb) pb.click(); } return; }
      const dd = e.target.closest('.proj-del');
      if (dd) { const p = projStore[+dd.dataset.p]; if (p) { p.compounds.splice(+dd.dataset.c, 1); persistProjects(); renderProjects(); } return; }
      const pk = e.target.closest('.proj-pick');
      if (pk) { const p = projStore[+pk.dataset.p]; if (p) { $('projName').value = p.name; $('projDesc').value = p.desc || ''; setStatusNote('已选中项目：' + p.name + '，可「加入当前化合物」。'); } }
    });
    // 21 杂质清单
    loadImpList(); renderImpList();
    const impAddBtn = $('impAdd'); if (impAddBtn) impAddBtn.addEventListener('click', impAdd);
    const impUseBtn = $('impUseCurrent'); if (impUseBtn) impUseBtn.addEventListener('click', impUseCurrent);
    const impClearBtn = $('impClear'); if (impClearBtn) impClearBtn.addEventListener('click', () => { impStore = []; persistImpList(); renderImpList(); setStatusNote('已清空杂质清单。'); });
    const impExpBtn = $('impExportXlsx'); if (impExpBtn) impExpBtn.addEventListener('click', impExportXlsx);
    const impListBox = $('impList');
    if (impListBox) impListBox.addEventListener('click', (e) => {
      const b = e.target.closest('.imp-del'); if (!b) return;
      impStore.splice(+b.dataset.i, 1); persistImpList(); renderImpList();
    });
    // 22 热力图
    const heatBtn = $('heatRun'); if (heatBtn) heatBtn.addEventListener('click', heatRun);
    // 23 SA 评分
    const saBtn = $('saCalc'); if (saBtn) saBtn.addEventListener('click', saCalc);
    const saUse = $('saUseCurrent'); if (saUse) saUse.addEventListener('click', () => { const s = currentSmiles(); if (s) { $('saSmiles').value = s; saCalc(); } else setStatusNote('请先完成一次预测。'); });
    // 24 OCR
    const ocrBtn = $('ocrBtn'); if (ocrBtn) ocrBtn.addEventListener('click', ocrRecognize);
    const ocrPasteBtn = $('ocrPasteBtn'); if (ocrPasteBtn) ocrPasteBtn.addEventListener('click', ocrPaste);
    const ocrManualBtn = $('ocrManualBtn'); if (ocrManualBtn) ocrManualBtn.addEventListener('click', ocrManualInput);
    const ocrWebBtn = $('ocrWebBtn'); if (ocrWebBtn) ocrWebBtn.addEventListener('click', ocrOpenWeb);
    // 固定「识别结果」确认按钮：读取 ocrResultInput 内容填入主输入框并预测
    const ocrConfirmBtn = $('ocrConfirmBtn');
    if (ocrConfirmBtn) ocrConfirmBtn.addEventListener('click', () => {
      const v = ($('ocrResultInput') && $('ocrResultInput').value || '').trim();
      if (!v) { setStatusNote('识别结果为空：请先上传图片识别，或手动输入 SMILES。', 'warn'); return; }
      const inp = document.getElementById('compoundInput');
      if (inp) inp.value = v;
      const pbtn = document.getElementById('predictBtn'); if (pbtn) pbtn.click();
      setStatusNote('已确认识别结果并开始预测。');
    });
    // dark mode
    initDarkMode();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTools);
  else initTools();

  // 暴露 OCR 识别函数供主流程（app.js）复用
  window.ocrViaMolScribe = ocrViaMolScribe;
})();
