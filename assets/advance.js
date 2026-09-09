/* =============================================================================
 *  chem-prop-predictor · 进阶分析增强模块 (advance.js)
 *  在原站已有 RDKit 描述符 / Predict.all / 毒性筛查基础上，新增 12 个深度模块。
 *  所有数值均为「前端经验/规则估算」，非实验值，仅供研发趋势参考。
 *  计算输入：data.rdkit.desc、data.rdkit.pka、data.pred、data.toxicity、data.geometry
 *  渲染输出：index.html 中对应 panel 容器（按 id 填充）。
 * ============================================================================= */
window.Advance = (function () {
  'use strict';

  function num(x, d) { const v = parseFloat(x); if (isNaN(v)) return null; return d == null ? v : +v.toFixed(d); }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtSci(v, d) {
    if (v == null) return '—';
    const n = +v.toFixed(d == null ? 3 : d);
    if (Math.abs(n) !== 0 && (Math.abs(n) < 1e-3 || Math.abs(n) >= 1e4)) return n.toExponential(d == null ? 2 : d);
    return String(n);
  }
  function clsBadge(label) {
    const m = { '高溶': 'ok', '易溶': 'ok', '可溶': 'neutral', '中等可溶': 'warn', '难溶': 'bad', '不溶': 'bad' };
    return m[label] || 'neutral';
  }
  const confBadge = (lv) => ({ '高': 'ok', '中': 'warn', '低': 'bad' }[lv] || 'neutral');

  /* ---------------------------------------------------------------------------
   * 1. 可信度 / 模型质量评分
   * ------------------------------------------------------------------------- */
  function computeConfidence(d) {
    const desc = d.rdkit && d.rdkit.desc || {};
    const pred = d.pred || {};
    const sol = pred.solubility;
    const reasons = [];
    // logS 模型一致性
    let logS = null, logSLevel = '中', logSReasons = [];
    if (sol && sol.models && sol.models.length >= 2) {
      const vals = sol.models.map(m => m.logS);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const spread = Math.max(...vals) - Math.min(...vals);
      if (spread < 0.8) { logSLevel = '高'; }
      else if (spread < 1.6) { logSLevel = '中'; }
      else { logSLevel = '低'; logSReasons.push('ESOL 与 Ali 模型偏差较大 (' + spread.toFixed(2) + ' logS)，外推场景存疑'); }
      logS = mean;
    } else if (sol && sol.consensus) { logS = sol.consensus.logS; logSLevel = '中'; logSReasons.push('仅单一模型可用，缺交叉印证'); }
    const mw = num(desc.amw);
    if (mw != null && (mw < 120 || mw > 900)) { logSLevel = '低'; logSReasons.push('分子量超出常见 QSAR 适用范围 (120–900)'); }
    if (num(desc.CrippenClogP) == null || num(desc.tpsa) == null) { logSLevel = '低'; logSReasons.push('缺失 logP/TPSA 关键描述符'); }

    // pKa（RDKit 近似，无实验校准）
    const pka = d.rdkit && d.rdkit.pka;
    const pkaLevel = (pka && pka.hasIonizable) ? '中' : '高';
    const pkaReasons = (pka && pka.hasIonizable) ? ['RDKit pKa 为子结构近似，与实验值常偏差 ±1'] : ['无非电离基团，pKa 不适用'];

    // BCS（依赖 logS 与 logP）
    const bcsLevel = (logSLevel === '高') ? '高' : '中';

    // ADME 规则（依赖描述符完整度）
    const needDesc = ['amw', 'CrippenClogP', 'tpsa', 'NumHBD', 'NumHBA', 'NumRotatableBonds', 'NumRings'];
    const missing = needDesc.filter(k => num(desc[k]) == null);
    const admeLevel = missing.length === 0 ? '高' : (missing.length <= 2 ? '中' : '低');
    if (missing.length) reasons.push('缺失描述符：' + missing.join(', '));

    const levels = { '高': 3, '中': 2, '低': 1 };
    const avgLevel = (levels[logSLevel] + levels[pkaLevel] + levels[admeLevel]) / 3; // 1–3
    const overallScore = Math.round(avgLevel / 3 * 100); // 归一化到 0–100
    const overall = overallScore >= 75 ? '高' : overallScore >= 50 ? '中' : '低';

    return {
      logS: { score: logS, level: logSLevel, reasons: logSReasons },
      pka: { level: pkaLevel, reasons: pkaReasons },
      bcs: { level: bcsLevel, reasons: ['依赖综合 logS 与 logP 的可靠性'] },
      adme: { level: admeLevel, reasons: missing.length ? ['缺失 ' + missing.length + ' 项描述符'] : ['描述符完整'] },
      overall: { score: overallScore, level: overall },
    };
  }

  /* ---------------------------------------------------------------------------
   * 2. ESOL 溶解度贡献分解
   * ------------------------------------------------------------------------- */
  function computeEsolDecomp(d) {
    const desc = d.rdkit && d.rdkit.desc || {};
    const logP = num(desc.CrippenClogP), mw = num(desc.amw), nrot = num(desc.NumRotatableBonds) || 0;
    if (logP == null || mw == null) return null;
    const intercept = 0.16;
    const cLogP = -0.638 * logP;
    const cMW = -0.0062 * mw;
    const cRot = 0.066 * nrot;
    const terms = [
      { name: '截距 (物理意义项)', value: intercept, contrib: intercept },
      { name: '亲脂性 ClogP 项 (−0.638·logP)', value: cLogP, contrib: cLogP },
      { name: '分子量项 (−0.0062·MW)', value: cMW, contrib: cMW },
      { name: '柔性项 (+0.066·Nrot)', value: cRot, contrib: cRot },
    ];
    const esol = intercept + cLogP + cMW + cRot;
    // 最大负贡献项 = 主要难溶驱动
    let driver = terms[0];
    terms.forEach(t => { if (t.contrib < driver.contrib) driver = t; });
    return { terms, esol, driver: driver.name, note: 'ESOL (Delaney 2004) 线性模型拆解；负值项越大代表越拉低溶解度，定位改造位点（降 logP / 降 MW / 降柔性）可改善水溶性。' };
  }

  /* ---------------------------------------------------------------------------
   * 3. ICH M7 杂质评估面板（基于现有毒性筛查）
   * ------------------------------------------------------------------------- */
  function computeICHM7(d) {
    const tox = d.toxicity;
    if (!tox || !tox.parsed) return null;
    const all = tox.all || [];
    const classes = [];
    const tracker = [];
    all.forEach(a => {
      const cats = a.cats || [];
      let m7 = 'N/A（非遗传毒性范畴）';
      let cls = '—';
      if (cats.indexOf('genotoxic') >= 0) { m7 = '建议按 ICH M7 Class 2/3 评估（需 Ames/致突变数据确认是否需订入限度）'; cls = 'Class 2/3'; }
      else if (cats.indexOf('herg') >= 0) { m7 = '心脏毒性（ICH S7B）；非 M7 范畴'; cls = 'S7B'; }
      else if (cats.indexOf('sensitization') >= 0) { m7 = '皮肤/致敏风险（ICH S8 / 局部耐受）'; cls = 'S8'; }
      else if (cats.indexOf('cyp') >= 0) { m7 = 'CYP 代谢相互作用（PK 关注）'; cls = 'PK'; }
      tracker.push({ name: a.name, severity: a.severity, cats: cats.join('/'), m7: m7, cls });
    });
    const geno = all.filter(a => (a.cats || []).indexOf('genotoxic') >= 0);
    const severeGeno = geno.filter(a => a.severity === 'high');
    let risk = '低（未检出基因毒性警示结构）';
    if (geno.length && severeGeno.length) risk = '高（检出 ' + severeGeno.length + ' 类高风险基因毒性警示结构）';
    else if (geno.length) risk = '中（检出 ' + geno.length + ' 类基因毒性警示结构，需致突变试验确认）';
    const ttcNote = geno.length
      ? '按 ICH M7：无致癌性证据的关注化合物，限度通常基于 TTC（≤1.5 µg/天，终生）；临床阶段可放宽。需结合是否为「已有充分安全数据的原料药相关杂质」判断。'
      : '无基因毒性警示结构，按常规杂质控制即可。';
    const amesNote = geno.length
      ? '建议补做 Ames 试验确认致突变性；若 Ames 阳性，按 Class 1/2 订入限度或去除合成路线。'
      : '现有结构未触发基因毒性警示，Ames 风险较低（仍建议按注册要求执行）。';
    return { total: all.length, genoCount: geno.length, severeGeno: severeGeno.length, risk, ttcNote, amesNote, tracker };
  }

  /* ---------------------------------------------------------------------------
   * 4. 盐型 / 晶型预测 + BCS 策略
   * ------------------------------------------------------------------------- */
  function computeSaltForm(d) {
    const pka = d.rdkit && d.rdkit.pka;
    const bcs = (d.pred && d.pred.bcs) || null;
    if (!pka || !pka.hasIonizable) {
      return { none: true, note: '未检出可电离基团（中性分子），通常无需成盐；若为弱极性游离碱/酸可考虑共晶/无定形策略。', bcsStrategy: bcsStrategy(bcs) };
    }
    const acids = pka.acids || [];
    const bases = pka.bases || [];
    const candidates = [];
    if (bases.length) {
      const maxBase = Math.max(...bases.map(b => b.pka));
      const list = [
        { salt: '盐酸盐 (HCl)', strength: 4.0, note: '强酸，适用于大多数碱（pKa 任意），水溶性通常好' },
        { salt: '硫酸盐 (H₂SO₄)', strength: 3.0, note: '强酸，双电荷，常用于高剂量 API' },
        { salt: '氢溴酸盐 (HBr)', strength: 3.8, note: '强酸，溴离子安全性需评估' },
        { salt: '甲磺酸盐 (MS)', strength: 1.9, note: '中等强度，吸湿性低，工艺友好' },
        { salt: '马来酸盐', strength: 2.0, note: '中等强度，常用于中等碱性 API' },
        { salt: '琥珀酸盐', strength: 1.8, note: '中等偏弱，适用于 pKa 较高 (>8) 的碱（如去甲文拉法辛场景）' },
        { salt: '富马酸盐', strength: 2.0, note: '中等，晶型稳定' },
        { salt: '枸橼酸盐', strength: 1.7, note: '弱-中等，多齿配位，增溶好' },
        { salt: '酒石酸盐', strength: 1.7, note: '弱-中等，手性衍生' },
        { salt: '磷酸盐', strength: 2.1, note: '中等，生理相容' },
        { salt: '苯磺酸盐/对甲苯磺酸盐', strength: 1.5, note: '弱酸，适用于强碱 (pKa>9)' },
      ];
      list.forEach(s => {
        // 选盐原则：反离子 pKa（共轭酸）应显著低于 API 碱基 pKa（ΔpKa>2 成盐完全）
        const ok = (maxBase - s.strength) >= 1.0;
        const best = (maxBase - s.strength) >= 3.0;
        candidates.push({ salt: s.salt, type: '碱→盐（阳离子 API' + (bases.length > 1 ? '，多碱' : '') + '）', reason: s.note + '；ΔpKa≈' + (maxBase - s.strength).toFixed(1), fit: ok ? (best ? '优' : '可') : '慎（ΔpKa 不足）' });
      });
    } else if (acids.length) {
      const list = [
        { salt: '钠盐 (Na⁺)', note: '最常用，水溶性好' },
        { salt: '钾盐 (K⁺)', note: '水溶性好，注意钾负荷' },
        { salt: '钙盐 (Ca²⁺)', note: '双电荷，适用于二酸' },
        { salt: '镁盐 (Mg²⁺)', note: '二价，胃肠道耐受性好' },
        { salt: '赖氨酸盐', note: '碱性氨基酸，改善溶解与稳定' },
        { salt: '精氨酸盐', note: '碱性氨基酸，增溶' },
        { salt: '三乙醇胺盐', note: '有机碱，适用于强酸' },
      ];
      list.forEach(s => candidates.push({ salt: s.salt, type: '酸→盐（阴离子 API）', reason: s.note, fit: '可' }));
    }
    return { none: false, basePka: bases.map(b => b.pka), acidPka: acids.map(a => a.pka), candidates, bcsStrategy: bcsStrategy(bcs) };
  }
  function bcsStrategy(bcs) {
    if (!bcs) return 'BCS 分类不可用。';
    const c = bcs.class;
    const map = {
      I: 'BCS I（高溶高渗）：常规制剂即可，无需特殊增溶。',
      II: 'BCS II（低溶高渗）：溶解度是瓶颈 → 盐型/纳米晶/固体分散体/环糊精包合/粒径微粉化均可提升溶出。',
      III: 'BCS III（高溶低渗）：渗透性是瓶颈 → 渗透促进剂/脂质载体/P-gp 抑制策略。',
      IV: 'BCS IV（低溶低渗）：双瓶颈 → 需盐型+渗透促进+前药等多策略组合。',
    };
    return map[c] || ('BCS ' + c + '。');
  }

  /* ---------------------------------------------------------------------------
   * 5. Hansen 溶解度参数（三维，相关性经验估计）
   * ------------------------------------------------------------------------- */
  function computeHansen(d) {
    const desc = d.rdkit && d.rdkit.desc || {};
    const logP = num(desc.CrippenClogP), tpsa = num(desc.tpsa),
      hbd = num(desc.NumHBD) || 0, hba = num(desc.NumHBA) || 0, mw = num(desc.amw);
    if (logP == null || tpsa == null || mw == null) return null;
    // 相关性经验估计（非基团贡献法，仅趋势参考）
    const dD = +(16 + 1.4 * Math.max(0, logP)).toFixed(2);            // 色散：随疏水性升高
    const dP = +(0.12 * tpsa).toFixed(2);                             // 极性：随 TPSA 升高
    const dH = +(2.0 + 1.4 * (hbd + hba)).toFixed(2);                // 氢键：随 H 键位点升高
    const Ro = +Math.sqrt(dD * dD + dP * dP + dH * dH).toFixed(2);
    // 常见溶剂 HSP（近似值），用 Ra 距离判断相容性
    const solvents = [
      { n: '水', dD: 15.5, dP: 16.0, dH: 42.3 }, { n: '甲醇', dD: 14.7, dP: 12.3, dH: 22.3 },
      { n: '乙醇', dD: 15.8, dP: 8.8, dH: 19.4 }, { n: '异丙醇', dD: 15.8, dP: 6.1, dH: 16.4 },
      { n: '丙酮', dD: 15.5, dP: 10.4, dH: 7.0 }, { n: '乙酸乙酯', dD: 15.8, dP: 5.3, dH: 7.2 },
      { n: '二氯甲烷', dD: 17.0, dP: 6.5, dH: 6.3 }, { n: 'DMF', dD: 17.4, dP: 13.7, dH: 11.3 },
      { n: 'DMSO', dD: 18.4, dP: 16.4, dH: 10.2 }, { n: '乙腈', dD: 15.3, dP: 18.0, dH: 6.1 },
      { n: 'THF', dD: 16.8, dP: 5.7, dH: 8.0 }, { n: '甲苯', dD: 18.0, dP: 1.4, dH: 2.0 },
      { n: '正庚烷', dD: 15.3, dP: 0.0, dH: 0.0 }, { n: '乙酸', dD: 14.5, dP: 8.0, dH: 13.5 },
    ];
    const rows = solvents.map(s => {
      const ra = Math.sqrt((s.dD - dD) ** 2 + 0.25 * (s.dP - dP) ** 2 + (s.dH - dH) ** 2);
      return { n: s.n, ra: +ra.toFixed(2), good: ra < 8 };
    }).sort((a, b) => a.ra - b.ra);
    const goodMap = {};
    rows.forEach(r => goodMap[r.n] = r.good);
    solvents.forEach(s => s.good = goodMap[s.n]);
    return { dD, dP, dH, Ro, solvents, rows, note: 'δD/δP/δH 为「相关性经验估计」（由 logP/TPSA/H 键位点映射），非基团贡献法精确值；但相对 Ra 排序（与常见溶剂的 Hansen 距离）对良溶剂筛选具备趋势参考价值。Ra<8 通常预示良好相容性。' };
  }

  /* ---------------------------------------------------------------------------
   * 6. 种态分布（pH–物种占比，微态枚举法，正确）
   * ------------------------------------------------------------------------- */
  function computeSpeciation(d) {
    const pka = d.rdkit && d.rdkit.pka;
    if (!pka || !pka.hasIonizable) return null;
    const acids = (pka.acids || []).map(a => a.pka);
    const bases = (pka.bases || []).map(b => b.pka);
    function fracs(pH) {
      // 酸位点：解离(阴离子,q=-1)概率 = 1/(1+10^(pKa-pH))
      // 碱位点：质子化(阳离子,q=+1)概率 = 1/(1+10^(pH-pKa))
      const acidUni = acids.map(p => 1 / (1 + Math.pow(10, p - pH)));
      const baseIon = bases.map(p => 1 / (1 + Math.pow(10, pH - p)));
      // 枚举 2^(n+m) 微态
      let fNeutral = 0, fCation = 0, fAnion = 0;
      const N = acidUni.length, M = baseIon.length;
      const total = 1 << (N + M);
      for (let mask = 0; mask < total; mask++) {
        let p = 1, q = 0;
        for (let i = 0; i < N; i++) { const ion = (mask >> i) & 1; p *= ion ? acidUni[i] : (1 - acidUni[i]); q -= ion ? 1 : 0; }
        for (let j = 0; j < M; j++) { const ion = (mask >> (N + j)) & 1; p *= ion ? baseIon[j] : (1 - baseIon[j]); q += ion ? 1 : 0; }
        if (Math.abs(q) < 1e-9) fNeutral += p; else if (q > 0) fCation += p; else fAnion += p;
      }
      return { neutral: fNeutral, cation: fCation, anion: fAnion, charge: qOf(pH, acids, bases) };
    }
    function qOf(pH, acids, bases) {
      let q = 0;
      acids.forEach(p => q -= 1 / (1 + Math.pow(10, p - pH)));
      bases.forEach(p => q += 1 / (1 + Math.pow(10, pH - p)));
      return +q.toFixed(3);
    }
    const pts = [];
    for (let ph = 0; ph <= 14.0001; ph += 0.5) {
      const f = fracs(ph);
      pts.push({ ph: +ph.toFixed(1), neutral: +f.neutral.toFixed(4), cation: +f.cation.toFixed(4), anion: +f.anion.toFixed(4), charge: f.charge });
    }
    const pI = (d.pred && d.pred.pka && d.pred.pka.pI != null) ? d.pred.pka.pI : null;
    return { acids, bases, pts, pI, note: '中性/阳离子/阴离子分数之和恒为 1（微态枚举法）；阳离子=所有碱基质子化的净正电态汇总，阴离子=所有酸解离的净负电态汇总。' };
  }

  /* ---------------------------------------------------------------------------
   * 7. 温度依赖溶解度 / 重结晶相图（van't Hoff 外推）
   * ------------------------------------------------------------------------- */
  function computeTempSol(d) {
    const pred = d.pred || {};
    const sol = pred.solubility, thermo = pred.thermo;
    if (!sol || !sol.consensus) return null;
    const logS298 = sol.consensus.logS;
    const dH = (thermo && thermo.dH_solv && thermo.dH_solv.value != null) ? thermo.dH_solv.value : null; // kcal/mol
    const mw = num(d.rdkit && d.rdkit.desc && d.rdkit.desc.amw);
    const R = 1.9872041e-3;
    const T0 = 298.15;
    const pts = [];
    const temps = [278.15, 288.15, 298.15, 308.15, 318.15, 328.15, 338.15];
    temps.forEach(T => {
      let logS = logS298;
      if (dH != null) logS = logS298 - (dH / (2.303 * R)) * (1 / T - 1 / T0);
      const molL = Math.pow(10, logS);
      const mgml = mw != null ? molL * mw : null;
      pts.push({ T: +(T - 273.15).toFixed(1), logS: +logS.toFixed(3), mgml: mgml != null ? +mgml.toFixed(4) : null });
    });
    let note = '';
    if (dH != null) {
      const endo = dH > 0;
      note = 'ΔH_solv=' + dH.toFixed(2) + ' kcal/mol（' + (endo ? '吸热溶解' : '放热溶解（固有）') + '）。' +
        (endo
          ? '升温显著提升溶解度 → 适合「热溶-冷却析晶」工艺（如 API 重结晶精制）。'
          : '溶解随升温提升有限 → 冷却析晶驱动力弱，宜考虑反溶剂/蒸发析晶。');
    } else {
      note = '缺少 ΔH_solv（热力学模块），仅给出 298K 固有溶解度，未能做温度外推（按 van’t Hoff 需焓变）。';
    }
    return { logS298, dH, pts, note };
  }

  /* ---------------------------------------------------------------------------
   * 8. 绿色化学与工艺安全评分（分子级代理）
   * ------------------------------------------------------------------------- */
  function computeGreen(d) {
    const desc = d.rdkit && d.rdkit.desc || {};
    const tox = d.toxicity;
    const groups = d.rdkit && d.rdkit.groups || [];
    const formula = (d.rdkit && d.rdkit.formula) || '';
    let score = 100;
    const breakdown = [];
    // 卤素
    const halogens = (formula.match(/Cl|Br|FI|Fe|Fl/g) || []).length; // 粗略
    const fCount = (formula.match(/F/g) || []).length;
    const clCount = (formula.match(/Cl/g) || []).length;
    const brCount = (formula.match(/Br/g) || []).length;
    const iCount = (formula.match(/I/g) || []).length;
    const hal = fCount + clCount + brCount + iCount;
    if (hal > 0) { score -= hal * 4; breakdown.push({ k: '卤素原子 (' + hal + ')', v: '-' + hal * 4, note: '卤代步骤通常原子经济性低、废盐多' }); }
    // 重金属（按分子式关键字）
    const metals = (formula.match(/Na|K|Mg|Ca|Zn|Fe|Cu|Mn|Li|Pd|Pt|Au|Ba|Al|Si/g) || []);
    // 注意：Na/K 等可能为成盐/试剂，这里仅作提示，不重罚
    // 结构警示
    const alerts = (tox && tox.total) || 0;
    if (alerts > 0) { score -= alerts * 3; breakdown.push({ k: '毒性警示结构 (' + alerts + ')', v: '-' + alerts * 3, note: '含高活性片段，工艺安全与废物处理需关注' }); }
    // 分子量 / 复杂度
    const mw = num(desc.amw);
    if (mw != null && mw > 600) { score -= 6; breakdown.push({ k: '高分子量 (>600)', v: -6, note: '合成步骤可能较多' }); }
    const rings = num(desc.NumRings) || 0;
    if (rings > 4) { score -= (rings - 4) * 2; breakdown.push({ k: '多环 (' + rings + ')', v: '-' + (rings - 4) * 2, note: '环系越多合成越复杂' }); }
    const rot = num(desc.NumRotatableBonds) || 0;
    if (rot > 12) { score -= 4; breakdown.push({ k: '高柔性 (>12 旋转键)', v: -4, note: '构象/纯化难度上升' }); }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const level = score >= 75 ? '高' : score >= 50 ? '中' : '低';
    // 工艺安全评分（基于毒性警示结构严重度）
    let safety = 100;
    const sevs = (tox && tox.all) || [];
    sevs.forEach(t => { const s = t.severity; if (s === 'high') safety -= 30; else if (s === 'medium') safety -= 12; else if (s === 'low') safety -= 4; });
    safety = Math.max(0, Math.min(100, Math.round(safety)));
    const safetyLevel = safety >= 75 ? '高' : safety >= 50 ? '中' : '低';
    return { score, level, breakdown, safety, safetyLevel, note: '为「分子级」绿色代理评分：基于卤素/警示/复杂度扣分，未纳入具体合成路线（原子经济性、溶剂耗量、步骤数等需在路线确定后另评）。高分≠路线绿色，仅提示分子本身的处理友好度。' };
  }

  /* ---------------------------------------------------------------------------
   * 9. 辅料兼容性 / 制剂策略（BCS 驱动）
   * ------------------------------------------------------------------------- */
  function computeExcipient(d) {
    const bcs = (d.pred && d.pred.bcs) || null;
    if (!bcs) return null;
    const c = bcs.class;
    const map = {
      I: [['常规稀释剂', '微晶纤维素/乳糖/淀粉', '标准片剂填充'], ['粘合剂', 'PVP/HPMC', '湿法制粒'], ['崩解剂', '交联羧甲基纤维素钠', '常规']],
      II: [['增溶剂 (表面活性剂)', 'SLS / 泊洛沙姆 188 / TPGS', '提高润湿与表观溶解度'], ['络合剂', 'HPβCD / SBEβCD', '包合增溶'], ['固体分散体载体', 'PVP-VA / Soluplus / 共无定形', '抑制重结晶、提升溶出'], ['微粉化', '气流粉碎至微米级', '增大比表面积'], ['质子化助溶', '有机酸（针对弱碱）', '提高胃液溶出']],
      III: [['渗透促进剂', '辛酸钠 / 水杨酸钠 / EDTA', '打开 tight junction'], ['P-gp 抑制', '维生素 E TPGS', '提高肠内吸收'], ['脂质载体', '脂质体 / SEDDS', '淋巴吸收途径']],
      IV: [['组合策略', '盐型+固体分散体+渗透促进', '双瓶颈需多手段'], ['前药', '酯化/磷酸酯前药', '改善透膜'], ['新型递送', '纳米晶 + 脂质体', '同步增溶增渗']],
    };
    const items = (map[c] || []).map(r => ({ role: r[0], name: r[1], note: r[2] }));
    return { class: c, items, note: '基于 BCS 分类的经验性辅料方向提示（非处方设计，需经溶解度/稳定性/兼容性实验确认）。' };
  }

  /* ---------------------------------------------------------------------------
   * 10. 逆合成分析提示（轻量子结构切断，非完整路线）
   * ------------------------------------------------------------------------- */
  function computeRetro(d) {
    const groups = d.rdkit && d.rdkit.groups || [];
    const keys = groups.map(g => g.key);
    const dis = [];
    const add = (bond, reaction, frag) => dis.push({ bond, reaction, frag });
    if (keys.indexOf('amide') >= 0 || keys.indexOf('amide_tert') >= 0) add('酰胺 C(=O)-N', '水解 / 缩合（酸+胺，HATU/EDC）', '羧酸 + 胺');
    if (keys.indexOf('ester') >= 0 || keys.indexOf('ester_ar') >= 0) add('酯 C(=O)-O', '水解 / 醇解（酸+醇，酸催化）', '羧酸 + 醇');
    if (keys.indexOf('urea') >= 0 || keys.indexOf('carbamate') >= 0) add('脲/氨基甲酸酯 C(=O)-N', '胺+异氰酸酯 或 氯甲酸酯路线', '胺 + 异氰酸酯/氯甲酸酯');
    if (keys.indexOf('ether') >= 0 || keys.indexOf('ether_ar') >= 0) add('醚 C-O-C', 'Williamson 醚合成（醇盐+卤代烃）', '醇盐 + 卤代烃');
    if (keys.indexOf('aniline_prim') >= 0 || keys.indexOf('aniline_sec') >= 0) add('芳香胺 Ar-NH₂', '硝化-还原（芳烃→硝基→氨基）', '芳烃 + 硝化/还原试剂');
    if (keys.indexOf('sulfonamide_nh') >= 0) add('磺酰胺 S(=O)₂-NH', '磺酰氯 + 胺', '磺酰氯 + 胺');
    if (keys.indexOf('carboxylic_aliphatic') >= 0 || keys.indexOf('carboxylic_aryl') >= 0) add('羧酸 C(=O)OH', '氧化（醇/醛→酸）或 Grignard+CO₂', '醇/卤代烃 + 氧化/格氏');
    if (keys.indexOf('alcohol_prim') >= 0 || keys.indexOf('alcohol_sec') >= 0) add('醇 C-OH', '还原（醛/酮）或亲核加成', '羰基 + 还原剂');
    if (!dis.length) return { none: true, note: '未检出典型可切断键（酰胺/酯/醚/磺酰胺/胺/羧酸/醇）。分子可能以 C-C 骨架为主，需基于具体骨架设计切断。' };
    return { none: false, dis, note: '仅给出「候选切断位点 + 对应常见人名反应/砌块」，为启发式提示而非完整逆合成路线；最终路线须经可行性、成本与专利核查。' };
  }

  /* ---------------------------------------------------------------------------
   * 11. 关键物性 / 传输性质 / 相平衡（可计算项 + 临界性质经验外推）
   * ------------------------------------------------------------------------- */
  function computeKeyProps(d) {
    const desc = d.rdkit && d.rdkit.desc || {};
    const logP = num(desc.CrippenClogP), mw = num(desc.amw), mr = num(desc.CrippenMR),
      tpsa = num(desc.tpsa), hbd = num(desc.NumHBD), hba = num(desc.NumHBA),
      nrot = num(desc.NumRotatableBonds), nrings = num(desc.NumRings),
      nar = num(desc.NumAromaticRings), csp3 = num(desc.FractionCSP3), nheavy = num(desc.NumHeavyAtoms);
    if (mw == null) return null;
    // 摩尔体积与折射率代理
    const Vm = mr != null ? +(mr * 0.6 + mw * 0.2).toFixed(1) : null; // 粗略（McGowan 思路近似）
    const nD = mr != null ? +(1 + (mr / mw) * 0.5).toFixed(3) : null;  // 经验折射率代理
    // 临界性质经验外推（强 caveat：非 Joback 基团贡献）
    // 沸点 Tb ≈ 关联 MW 与 logP 的粗略 QSPR（仅趋势）
    const Tb = (logP != null) ? +(198 + 1.05 * mw + 30 * logP).toFixed(1) : null; // K
    const Tc = Tb != null ? +(Tb / 0.6).toFixed(1) : null;
    const Pc = mw != null ? +( (1.0e7) / (Math.pow(mw, 0.5) * (Vm || mw)) ).toFixed(3) : null; // 粗略 (bar)
    const Vc = Vm != null ? +(2.66 * Vm).toFixed(1) : null;
    const Tm = (logP != null && mw != null) ? +( (logP - 2.0) * -20 + 0.4 * mw - 60 ).toFixed(1) : null; // 极粗略 K
    return {
      transport: [
        { k: '分配系数 logP (Crippen)', v: logP != null ? logP.toFixed(2) : '—' },
        { k: '拓扑极性表面积 TPSA', v: tpsa != null ? tpsa.toFixed(1) + ' Å²' : '—' },
        { k: '摩尔折射 MR', v: mr != null ? mr.toFixed(1) : '—' },
        { k: '折射率 n_D (代理)', v: nD != null ? String(nD) : '—' },
        { k: '摩尔体积 Vm (代理, cm³/mol)', v: Vm != null ? String(Vm) : '—' },
        { k: 'HBD / HBA', v: (hbd != null ? hbd : '—') + ' / ' + (hba != null ? hba : '—') },
        { k: '可旋转键 / 环数', v: (nrot != null ? nrot : '—') + ' / ' + (nrings != null ? nrings : '—') },
        { k: '芳香环 / sp³ 比例', v: (nar != null ? nar : '—') + ' / ' + (csp3 != null ? csp3.toFixed(2) : '—') },
        { k: '重原子数', v: nheavy != null ? String(nheavy) : '—' },
      ],
      critical: [
        { k: '沸点 Tb (经验外推, K)', v: Tb != null ? String(Tb) : '—' },
        { k: '临界温度 Tc (经验外推, K)', v: Tc != null ? String(Tc) : '—' },
        { k: '临界压力 Pc (经验外推, bar)', v: Pc != null ? String(Pc) : '—' },
        { k: '临界体积 Vc (经验外推, cm³/mol)', v: Vc != null ? String(Vc) : '—' },
        { k: '熔点 Tm (经验外推, K)', v: Tm != null ? String(Tm) : '—' },
      ],
      note: '传输性质中 logP/TPSA/MR 等为 RDKit 实测；折射率/摩尔体积为代理估算。临界性质 Tb/Tc/Pc/Vc/Tm 为「经验关联外推」，偏差可能较大，仅用于趋势判断；精确值需 Joback-Reid 基团贡献或实验测定。',
    };
  }

  /* ---------------------------------------------------------------------------
   * 12. 量子化学 / 电子结构（近似，诚实说明需 QM 后端）
   * ------------------------------------------------------------------------- */
  function computeElectronic(d) {
    const desc = d.rdkit && d.rdkit.desc || {};
    const tpsa = num(desc.tpsa), logP = num(desc.CrippenClogP), hbd = num(desc.NumHBD) || 0, hba = num(desc.NumHBA) || 0;
    // 仅给出「不依赖 QM 后端」的拓扑/描述符代理，并诚实说明 HOMO/LUMO/ESP 需真实 QM
    const dipoleProxy = (tpsa != null && logP != null) ? +(0.05 * tpsa + 0.3 * (hbd + hba) - 0.2 * logP + 1.0).toFixed(2) : null;
    const polarNote = (tpsa != null && tpsa > 80) ? '极性较强（TPSA 高），可能呈高偶极、亲水' : '极性较弱，可能呈低偶极、疏水';
    return {
      dipoleProxy, polarNote,
      note: '本平台为纯前端，无 DFT/半经验 QM 后端，无法计算真实的 HOMO/LUMO 能级、能隙 Egap、静电势 ESP 表面与精确偶极矩。上方为基于 TPSA/logP/氢键位点的「拓扑代理」偶极估算（仅趋势参考）。如需定量电子结构，建议将 SMILES 提交至 ORCA / Gaussian / MOPAC (PM7) 或在线 QM 服务（如 molcalc.org）计算后回填。',
      needs: ['HOMO/LUMO 能级与能隙', '静电势 (ESP) 表面', '精确偶极矩与四极矩', '自然键轨道 (NBO) 分析', '反应过渡态能量'],
    };
  }

  /* ===========================================================================
   *  主计算入口
   * ========================================================================= */
  /* ---------------------------------------------------------------------------
   * 13. pH–表观溶解度分布图（S_app = S₀ / χ_neutral）
   * ------------------------------------------------------------------------- */
  function computeSolDist(d) {
    const pred = d.pred || {};
    const sol = pred.solubility;
    if (!sol || !sol.consensus) return null;
    const logS0 = sol.consensus.logS;
    const s0 = Math.pow(10, logS0);
    const mw = num(d.rdkit && d.rdkit.desc && d.rdkit.desc.amw);
    const sp = computeSpeciation(d);
    if (!sp) return null;
    const pts = sp.pts.map(p => {
      const fN = Math.max(p.neutral, 1e-6);
      const appS = s0 / fN;
      return { ph: p.ph, fNeutral: +fN.toFixed(4), appLogS: +Math.log10(appS).toFixed(3), appMgml: mw != null ? +(appS * mw).toFixed(4) : null };
    });
    return { s0, logS0, pts, note: '表观溶解度 S_app(pH) = S₀ / χ_neutral（S₀ 为固有溶解度，由共识 logS 反推）。中性分数越低（强电离区）表观溶解度越高——解释「成盐 / 调 pH 增溶」机理；与「GSE pH–溶解度曲线」同源互补。' };
  }

  /* ---------------------------------------------------------------------------
   * 14. 毒性 / ICH M7 风险矩阵（类别 × 严重度）
   * ------------------------------------------------------------------------- */
  function computeToxMatrix(d) {
    const tox = d.toxicity || {};
    const all = tox.all || [];
    const map = {
      genotoxic: { name: '基因毒性', sev: -1, cnt: 0 },
      herg: { name: 'hERG 心脏', sev: -1, cnt: 0 },
      skin: { name: '皮肤致敏', sev: -1, cnt: 0 },
      cyp: { name: 'CYP 代谢', sev: -1, cnt: 0 },
    };
    const sevIdx = { high: 2, medium: 1, low: 0 };
    all.forEach(t => { (t.cats || []).forEach(c => { if (map[c]) { map[c].cnt++; const si = sevIdx[t.severity] != null ? sevIdx[t.severity] : 0; if (si > map[c].sev) map[c].sev = si; } }); });
    const sevName = ['低', '中', '高'];
    const cats = Object.keys(map).map(k => ({ key: k, name: map[k].name, severity: map[k].sev >= 0 ? sevName[map[k].sev] : '无', count: map[k].cnt, sevIdx: map[k].sev }));
    return { cats, note: '按检出警示结构的类别与最高严重度着色；空格＝未检出。基因毒性高严重度需重点评估（ICH M7）。' };
  }

  function compute(d) {
    if (!d || !d.rdkit || !d.rdkit.desc) return null;
    return {
      confidence: computeConfidence(d),
      esol: computeEsolDecomp(d),
      ichm7: computeICHM7(d),
      salt: computeSaltForm(d),
      hansen: computeHansen(d),
      speciation: computeSpeciation(d),
      tempSol: computeTempSol(d),
      green: computeGreen(d),
      excipient: computeExcipient(d),
      retro: computeRetro(d),
      keyProps: computeKeyProps(d),
      electronic: computeElectronic(d),
      solDist: computeSolDist(d),
      toxMatrix: computeToxMatrix(d),
    };
  }

  /* ===========================================================================
   *  SVG 折线图助手
   * ========================================================================= */
  function svgLineChart(series, opts) {
    opts = opts || {};
    const W = opts.w || 640, H = opts.h || 300;
    const padL = 46, padR = 16, padT = 26, padB = 34;
    const xMin = opts.xMin, xMax = opts.xMax, yMin = opts.yMin, yMax = opts.yMax;
    const xr = (xMax - xMin) || 1, yr = (yMax - yMin) || 1;
    const sx = x => padL + (x - xMin) / xr * (W - padL - padR);
    const sy = y => H - padB - (y - yMin) / yr * (H - padT - padB);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="max-width:${W}px">`;
    // y 网格
    const ySteps = opts.ySteps || 4;
    for (let i = 0; i <= ySteps; i++) {
      const yv = yMin + yr * i / ySteps;
      const y = sy(yv);
      s += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eef2f6" stroke-width="1"/>`;
      s += `<text x="${padL - 6}" y="${y + 3}" font-size="10" fill="#5b6776" text-anchor="end">${opts.yFmt ? opts.yFmt(yv) : (Math.abs(yv) < 1e-3 ? '0' : yv.toFixed(1))}</text>`;
    }
    // x 网格/标签
    const xSteps = opts.xSteps || 7;
    for (let i = 0; i <= xSteps; i++) {
      const xv = xMin + xr * i / xSteps;
      const x = sx(xv);
      s += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" stroke="#f3f6f9" stroke-width="1"/>`;
      s += `<text x="${x}" y="${H - padB + 14}" font-size="10" fill="#5b6776" text-anchor="middle">${opts.xFmt ? opts.xFmt(xv) : xv.toFixed(1)}</text>`;
    }
    // 零线（charge 图）
    if (yMin < 0 && yMax > 0) {
      const yz = sy(0);
      s += `<line x1="${padL}" y1="${yz}" x2="${W - padR}" y2="${yz}" stroke="#c0c8d4" stroke-width="1" stroke-dasharray="4 3"/>`;
    }
    // 曲线
    series.forEach(ser => {
      const pts = ser.points.map(p => sx(p[0]) + ',' + sy(p[1])).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="${ser.color}" stroke-width="2"/>`;
    });
    // y 标题（左上）
    if (opts.yTitle) s += `<text x="${padL}" y="13" font-size="10.5" fill="#5b6776">${esc(opts.yTitle)}</text>`;
    // 图例（右上，带白底，绝不溢出 viewBox）
    if (series.length) {
      const gap = 16;
      const segs = series.map(se => ({ c: se.color, l: se.label, w: 18 + (se.label.length * 7.5) }));
      const totalW = segs.reduce((a, b) => a + b.w, 0) + gap * (series.length - 1);
      let lx = W - padR - totalW; if (lx < padL + 4) lx = padL + 4;
      const ly = 14;
      s += `<rect x="${lx - 4}" y="${ly - 9}" width="${totalW + 8}" height="15" rx="4" fill="#ffffff" opacity="0.92"/>`;
      let cur = lx;
      segs.forEach(se => {
        s += `<line x1="${cur}" y1="${ly - 3}" x2="${cur + 13}" y2="${ly - 3}" stroke="${se.c}" stroke-width="3"/>`;
        s += `<text x="${cur + 17}" y="${ly + 1}" font-size="10.5" fill="#475569">${esc(se.l)}</text>`;
        cur += se.w + gap;
      });
    }
    s += `</svg>`;
    return s;
  }

  /* ===========================================================================
   *  渲染：各卡片填充
   * ========================================================================= */
  function set(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
  function badge(level, text) { return `<span class="badge badge-${confBadge(level)}">${esc(text || level)}</span>`; }

  function renderConfidence(a) {
    if (!a || !a.confidence) { set('advConfidence', ''); return; }
    const c = a.confidence;
    const rows = [
      ['水溶解度 logS', c.logS, c.logS.reasons],
      ['pKa 电离常数', c.pka, c.pka.reasons],
      ['BCS 分类', c.bcs, c.bcs.reasons],
      ['ADME 类药性规则', c.adme, c.adme.reasons],
    ];
    let html = '<div class="score-line" style="margin-bottom:10px">'
      + `<div class="score-box"><div class="s-label">综合模型可信度</div><div class="s-val">${c.overall.score}</div><div style="font-size:11.5px;color:#5b6776">${badge(c.overall.level)}</div></div></div>`;
    html += '<table class="data"><thead><tr><th>预测模块</th><th>可信度</th><th>依据 / 风险提示</th></tr></thead><tbody>';
    rows.forEach(r => {
      html += `<tr><td>${r[0]}</td><td>${badge(r[1].level)}</td><td>${(r[2] || []).map(esc).join('；') || '—'}</td></tr>`;
    });
    html += '</tbody></table>';
    html += '<div class="row-note" style="margin-top:8px">可信度仅反映「模型适用性与交叉印证程度」，不代表预测值与实验值的绝对吻合；写报告/工艺决策时建议标注该等级。</div>';
    set('advConfidence', html);
  }

  function renderEsol(a) {
    const e = a.esol; if (!e) { set('advEsol', '<div class="row-note">缺少 logP/MW，无法分解。</div>'); return; }
    let html = '<div class="sub-title" style="margin:4px 0 2px">贡献分解条形图（负值=拉低溶解度）</div>'
      + svgHBar(e.terms.map(t => ({ label: t.name.replace(/[（(].*$/, ''), value: t.contrib })))
      + '<table class="data" style="margin-top:10px"><thead><tr><th>贡献项</th><th>数值</th><th>对 logS 的贡献</th></tr></thead><tbody>';
    e.terms.forEach(t => {
      const v = t.contrib;
      const color = v < 0 ? '#c0392b' : (v > 0 ? '#1e7e34' : '#5b6776');
      html += `<tr><td>${esc(t.name)}</td><td>${v.toFixed(3)}</td><td style="color:${color};font-weight:600">${v >= 0 ? '+' : ''}${v.toFixed(3)}</td></tr>`;
    });
    html += `<tr class="consensus-row"><td><b>ESOL logS (合计)</b></td><td><b>${e.esol.toFixed(2)}</b></td><td>主要难溶驱动：${esc(e.driver)}</td></tr>`;
    html += '</tbody></table>';
    html += `<div class="row-note" style="margin-top:8px">${esc(e.note)}</div>`;
    set('advEsol', html);
  }

  function renderICHM7(a) {
    const m = a.ichm7; if (!m) { set('advIchm7', '<div class="row-note">毒性模块不可用。</div>'); return; }
    let html = `<div class="row-note" style="margin-bottom:8px">基因毒性警示结构：<b>${m.genoCount}</b> 类（其中高风险 <b>${m.severeGeno}</b> 类）；总体 M7 风险 ${badge(m.genoCount ? (m.severeGeno ? '低' : '中') : '高', m.risk)}。</div>`;
    if (m.tracker.length) {
      html += '<table class="data"><thead><tr><th>检出结构</th><th>严重度</th><th>类别</th><th>ICH M7 建议归类</th></tr></thead><tbody>';
      m.tracker.forEach(t => {
        html += `<tr><td>${esc(t.name)}</td><td>${esc(t.severity)}</td><td>${esc(t.cats)}</td><td><span class="badge badge-${confBadge(t.cls.indexOf('Class 2') >= 0 ? '中' : '低')}">${esc(t.cls)}</span> ${esc(t.m7)}</td></tr>`;
      });
      html += '</tbody></table>';
    }
    html += '<div style="margin-top:8px">'
      + `<div class="sub-title" style="margin:6px 0">Ames 试验建议</div><div class="row-note">${esc(m.amesNote)}</div>`
      + `<div class="sub-title" style="margin:6px 0">TTC 限度建议</div><div class="row-note">${esc(m.ttcNote)}</div>`
      + '</div>';
    if (a.toxMatrix) {
      html += '<div class="sub-title" style="margin:12px 0 2px">毒性 / ICH M7 风险矩阵（类别 × 严重度）</div>';
      html += svgToxHeatmap(a.toxMatrix);
    }
    html += '<div class="row-note" style="margin-top:8px">提示：可直接在「毒性」卡片点 <b>导出杂质评估表</b> 生成 QS-1/API 双 Sheet 工作簿，与本面板结论衔接。</div>';
    set('advIchm7', html);
  }

  function renderSalt(a) {
    const s = a.salt; if (!s) { set('advSalt', ''); return; }
    let html = '';
    if (s.none) {
      html = '<div class="row-note">' + esc(s.note) + '</div>';
    } else {
      if (s.basePka && s.basePka.length) html += `<div class="row-note">检出碱性 pKa：${s.basePka.map(p => p.toFixed(2)).join(', ')} → 成盐为<b>阳离子 API</b>。</div>`;
      if (s.acidPka && s.acidPka.length) html += `<div class="row-note">检出酸性 pKa：${s.acidPka.map(p => p.toFixed(2)).join(', ')} → 成盐为<b>阴离子 API</b>。</div>`;
      html += '<table class="data"><thead><tr><th>候选盐型</th><th>类型</th><th>适配性与理由</th><th>成盐适配</th></tr></thead><tbody>';
      s.candidates.forEach(c => {
        const fitColor = c.fit.indexOf('优') >= 0 ? 'ok' : (c.fit.indexOf('慎') >= 0 ? 'bad' : 'neutral');
        html += `<tr><td><b>${esc(c.salt)}</b></td><td>${esc(c.type)}</td><td>${esc(c.reason)}</td><td><span class="badge badge-${fitColor}">${esc(c.fit)}</span></td></tr>`;
      });
      html += '</tbody></table>';
    }
    html += `<div class="row-note" style="margin-top:8px"><b>BCS 制剂策略：</b>${esc(s.bcsStrategy)}</div>`;
    set('advSalt', html);
  }

  function renderHansen(a) {
    const h = a.hansen; if (!h) { set('advHansen', '<div class="row-note">缺少描述符，无法估计。</div>'); return; }
    let html = '<div class="score-line" style="margin-bottom:10px">'
      + `<div class="score-box"><div class="s-label">δD 色散</div><div class="s-val">${h.dD}</div><div style="font-size:11px;color:#5b6776">MPa^½</div></div>`
      + `<div class="score-box"><div class="s-label">δP 极性</div><div class="s-val">${h.dP}</div><div style="font-size:11px;color:#5b6776">MPa^½</div></div>`
      + `<div class="score-box"><div class="s-label">δH 氢键</div><div class="s-val">${h.dH}</div><div style="font-size:11px;color:#5b6776">MPa^½</div></div>`
      + `<div class="score-box"><div class="s-label">Ro 总参数</div><div class="s-val">${h.Ro}</div><div style="font-size:11px;color:#5b6776">MPa^½</div></div></div>`;
    html += '<div class="sub-title" style="margin:10px 0 4px">与常见溶剂的 Hansen 距离 Ra（升序＝越可能良溶）</div>';
    html += '<table class="data"><thead><tr><th>溶剂</th><th>Ra</th><th>相容性</th></tr></thead><tbody>';
    h.rows.slice(0, 8).forEach(r => {
      html += `<tr><td>${esc(r.n)}</td><td>${r.ra}</td><td><span class="badge badge-${r.good ? 'ok' : 'warn'}">${r.good ? '良溶剂候选' : '一般'}</span></td></tr>`;
    });
    html += '</tbody></table>';
    html += '<div class="sub-title" style="margin:12px 0 2px">Hansen 三维溶解度球体（等距投影）</div>';
    html += svgHansenSphere(h);
    html += `<div class="row-note" style="margin-top:8px">${esc(h.note)}</div>`;
    set('advHansen', html);
  }

  function renderSpeciation(a) {
    const sp = a.speciation; if (!sp) { set('advSpeciation', '<div class="row-note">未检出可电离基团，无种态分布。</div>'); return; }
    const series = [
      { label: '中性', color: '#2563eb', points: sp.pts.map(p => [p.ph, p.neutral]) },
      { label: '阳离子', color: '#c0392b', points: sp.pts.map(p => [p.ph, p.cation]) },
      { label: '阴离子', color: '#1e7e34', points: sp.pts.map(p => [p.ph, p.anion]) },
    ];
    const chart = svgLineChart(series, { w: 640, h: 300, xMin: 0, xMax: 14, yMin: 0, yMax: 1, yTitle: '物种分数 (0–1)', xSteps: 7, ySteps: 5 });
    const chargeSeries = [
      { label: '净电荷', color: '#7c3aed', points: sp.pts.map(p => [p.ph, p.charge]) },
    ];
    const chargeChart = svgLineChart(chargeSeries, { w: 640, h: 220, xMin: 0, xMax: 14, yMin: -3, yMax: 3, yTitle: '净电荷 q', xSteps: 7, ySteps: 6, yFmt: v => v.toFixed(0) });
    let html = chart + '<div class="sub-title" style="margin:10px 0 4px">净电荷–pH 曲线</div>' + chargeChart;
    html += `<div class="row-note" style="margin-top:8px">pI（等电点）≈ <b>${sp.pI != null ? sp.pI : '—'}</b>。${esc(sp.note)}</div>`;
    set('advSpeciation', html);
  }

  function renderTempSol(a) {
    const t = a.tempSol; if (!t) { set('advTempSol', '<div class="row-note">缺少溶解度共识，无法外推。</div>'); return; }
    let html = '<table class="data"><thead><tr><th>温度 (℃)</th><th>logS</th><th>溶解度 (mg/mL)</th></tr></thead><tbody>';
    t.pts.forEach(p => {
      html += `<tr><td>${p.T}</td><td>${p.logS.toFixed(3)}</td><td>${p.mgml != null ? fmtSci(p.mgml, 4) : '—'}</td></tr>`;
    });
    html += '</tbody></table>';
    html += `<div class="row-note" style="margin-top:8px">${esc(t.note)}</div>`;
    set('advTempSol', html);
  }

  function renderGreen(a) {
    const g = a.green; if (!g) { set('advGreen', ''); return; }
    let html = '<div class="gauge-pair">'
      + `<div class="gauge-cell">${svgGauge(g.score, { label: '绿色评分' })}</div>`
      + `<div class="gauge-cell">${svgGauge(g.safety, { label: '工艺安全' })}</div>`
      + '</div>';
    if (g.breakdown.length) {
      html += '<table class="data"><thead><tr><th>扣分项</th><th>扣分</th><th>说明</th></tr></thead><tbody>';
      g.breakdown.forEach(b => { html += `<tr><td>${esc(b.k)}</td><td style="color:#c0392b">${b.v}</td><td>${esc(b.note)}</td></tr>`; });
      html += '</tbody></table>';
    } else {
      html += '<div class="row-note">分子结构未见明显绿色减分项。</div>';
    }
    html += `<div class="row-note" style="margin-top:8px">${esc(g.note)}</div>`;
    set('advGreen', html);
  }

  function renderExcipient(a) {
    const e = a.excipient; if (!e) { set('advExcipient', '<div class="row-note">BCS 不可用。</div>'); return; }
    let html = `<div class="row-note" style="margin-bottom:8px">BCS 第 <b>${e.class}</b> 类 → 辅料方向：</div>`;
    html += '<table class="data"><thead><tr><th>类别</th><th>候选辅料</th><th>作用</th></tr></thead><tbody>';
    e.items.forEach(it => { html += `<tr><td>${esc(it.role)}</td><td><b>${esc(it.name)}</b></td><td>${esc(it.note)}</td></tr>`; });
    html += '</tbody></table>';
    html += `<div class="row-note" style="margin-top:8px">${esc(e.note)}</div>`;
    set('advExcipient', html);
  }

  function renderRetro(a) {
    const r = a.retro; if (!r) { set('advRetro', ''); return; }
    if (r.none) { set('advRetro', '<div class="row-note">' + esc(r.note) + '</div>'); return; }
    let html = '<table class="data"><thead><tr><th>候选切断键</th><th>对应反应/砌块</th><th>断开产物</th></tr></thead><tbody>';
    r.dis.forEach(d => { html += `<tr><td><b>${esc(d.bond)}</b></td><td>${esc(d.reaction)}</td><td>${esc(d.frag)}</td></tr>`; });
    html += '</tbody></table>';
    html += `<div class="row-note" style="margin-top:8px">${esc(r.note)}</div>`;
    set('advRetro', html);
  }

  function renderKeyProps(a) {
    const k = a.keyProps; if (!k) { set('advKeyProps', '<div class="row-note">缺少描述符。</div>'); return; }
    let html = '<div class="sub-title" style="margin:4px 0">传输 / 可计算物性</div>';
    html += '<table class="data"><tbody>' + k.transport.map(r => `<tr><td>${esc(r.k)}</td><td><b>${esc(r.v)}</b></td></tr>`).join('') + '</tbody></table>';
    html += '<div class="sub-title" style="margin:10px 0 4px">临界 / 相平衡（经验外推）</div>';
    html += '<table class="data"><tbody>' + k.critical.map(r => `<tr><td>${esc(r.k)}</td><td><b>${esc(r.v)}</b></td></tr>`).join('') + '</tbody></table>';
    html += `<div class="row-note" style="margin-top:8px">${esc(k.note)}</div>`;
    set('advKeyProps', html);
  }

  function renderElectronic(a) {
    const e = a.electronic; if (!e) { set('advElectronic', ''); return; }
    let html = `<div class="score-line" style="margin-bottom:8px"><div class="score-box"><div class="s-label">偶极矩代理 (D)</div><div class="s-val">${e.dipoleProxy != null ? e.dipoleProxy : '—'}</div><div style="font-size:11px;color:#5b6776">拓扑估算</div></div></div>`;
    html += `<div class="row-note">${esc(e.polarNote)}</div>`;
    html += '<div class="sub-title" style="margin:8px 0 4px">需真实 QM 后端方可计算的项</div><div class="alert-list">';
    html += e.needs.map(n => `<span class="badge badge-warn">${esc(n)}</span>`).join(' ');
    html += '</div>';
    html += `<div class="row-note" style="margin-top:8px">${esc(e.note)}</div>`;
    set('advElectronic', html);
  }

  /* ===========================================================================
   *  V5.5 风格绘图：SVG 辅助函数 + 5 个图表
   * ========================================================================= */
  function polar(cx, cy, r, deg) { const a = deg * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }

  // 半圆仪表盘（绿色评分 / 工艺安全）
  function svgGauge(value, opts) {
    opts = opts || {};
    const max = opts.max || 100, label = opts.label || '';
    const W = 260, H = 172, cx = 130, cy = 142, r = 104;
    const f = Math.max(0, Math.min(1, value / max));
    const col = value >= 75 ? '#1e7e34' : (value >= 50 ? '#e0922b' : '#c0392b');
    const a0 = 180, a1 = 180 - 180 * f;
    const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
    const large = (a0 - a1) > 180 ? 1 : 0;
    const pb0 = polar(cx, cy, r, 180), pb1 = polar(cx, cy, r, 0);
    const uid = 'gg_' + Math.random().toString(36).slice(2, 7);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet" style="max-width:100%;height:auto">`;
    s += `<defs><linearGradient id="${uid}" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="${col}" stop-opacity="0.82"/><stop offset="100%" stop-color="${col}" stop-opacity="1"/></linearGradient></defs>`;
    s += `<path d="M ${pb0[0]} ${pb0[1]} A ${r} ${r} 0 0 1 ${pb1[0]} ${pb1[1]}" fill="none" stroke="#e8edf2" stroke-width="15" stroke-linecap="round"/>`;
    s += `<path d="M ${p0[0]} ${p0[1]} A ${r} ${r} 0 ${large} 1 ${p1[0]} ${p1[1]}" fill="none" stroke="url(#${uid})" stroke-width="15" stroke-linecap="round"/>`;
    [0, 25, 50, 75, 100].forEach(t => {
      const ang = 180 - 180 * (t / 100);
      const a = polar(cx, cy, r - 12, ang), b = polar(cx, cy, r + 2, ang);
      s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#9aa6b5" stroke-width="1"/>`;
    });
    s += `<text x="${cx}" y="${cy - 22}" font-size="34" font-weight="700" fill="${col}" text-anchor="middle">${Math.round(value)}</text>`;
    s += `<text x="${cx}" y="${cy - 4}" font-size="11" fill="#475569" text-anchor="middle" font-weight="500">${esc(label)}</text>`;
    s += `<text x="${cx}" y="${cy + 14}" font-size="10" fill="#94a3b8" text-anchor="middle">满分 ${max}</text>`;
    s += `</svg>`;
    return s;
  }

  // 水平条形图（带正负基线，负值标红）—— ESOL 贡献分解
  function svgHBar(items, opts) {
    opts = opts || {};
    const rowH = 30, padT = 6, padB = 20;
    const labelX = 196;                 // 类别标签右端
    const trackX0 = 206;                // 轨道左端
    const trackW = 360;                 // 轨道宽
    const mid = trackX0 + trackW / 2;   // 中线
    const valX = trackX0 + trackW + 12; // 数值列（远离标签与轴，互不重叠）
    const W = 620;
    const maxAbs = Math.max(0.001, ...items.map(i => Math.abs(i.value)));
    const H = padT + padB + items.length * rowH;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">`;
    s += `<line x1="${mid}" y1="${padT}" x2="${mid}" y2="${H - padB}" stroke="#c0c8d4" stroke-width="1"/>`;
    items.forEach((it, idx) => {
      const y = padT + idx * rowH + rowH / 2;
      const w = Math.abs(it.value) / maxAbs * (trackW / 2 - 6);
      const col = it.color || (it.value < 0 ? '#c0392b' : '#1e7e34');
      const x = it.value >= 0 ? mid : mid - w;
      s += `<text x="${labelX}" y="${y + 4}" font-size="11.5" fill="#33414f" text-anchor="end">${esc(it.label)}</text>`;
      s += `<rect x="${x}" y="${y - 9}" width="${Math.max(1, w)}" height="18" rx="3" fill="${col}" opacity="0.88"/>`;
      s += `<text x="${valX}" y="${y + 4}" font-size="11" fill="${col}" text-anchor="start" font-weight="500">${it.value >= 0 ? '+' : ''}${it.value.toFixed(3)}</text>`;
    });
    s += `<text x="${mid}" y="${H - 5}" font-size="9.5" fill="#8a95a3" text-anchor="middle">0 基线（负值 = 拉低溶解度）</text>`;
    s += `</svg>`;
    return s;
  }

  // Hansen 三维溶解度球体（等距投影散点 + Ro 相容区）
  function svgHansenSphere(h) {
    if (!h) return '';
    const proj = (d) => { const x = (d[0] - d[1]) * Math.cos(Math.PI / 6); const y = (d[0] + d[1]) * 0.5 - d[2]; return [x, y]; };
    const pts = (h.solvents || []).map(s => ({ n: s.n, d: [s.dD, s.dP, s.dH], good: s.good }));
    const comp = [h.dD, h.dP, h.dH];
    const all = pts.map(p => proj(p.d)).concat([proj(comp)]);
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = 720, H = 460, padX = 120, padY = 64;
    const spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1;
    const sx = v => padX + (v - minX) / spanX * (W - 2 * padX);
    const sy = v => H - padY - (v - minY) / spanY * (H - 2 * padY);
    const cc = proj(comp), cx = sx(cc[0]), cy = sy(cc[1]);
    const rad = Math.max(20, Math.min(110, h.Ro * (W - 2 * padX) / spanX * 0.20));

    // 标签锚点：按点相对 API 的左右/上下选象限
    const items = pts.map(p => {
      const pr = proj(p.d);
      const x = sx(pr[0]), y = sy(pr[1]);
      const right = (x - cx) >= 0, upper = (y - cy) < 0;
      return {
        n: p.n, x, y, good: p.good,
        anchor: right ? 'start' : 'end',
        lx: right ? x + 11 : x - 11,
        ly: upper ? y - 9 : y + 13
      };
    });
    // 标签去堆叠：同侧（左/右）同列按最小间距 16px 推开，再整体夹在画幅内
    const groups = {};
    items.forEach(it => { const k = (it.x > cx ? 'R' : 'L'); (groups[k] = groups[k] || []).push(it); });
    const maxLy = H - 46, minLy = 16;
    Object.keys(groups).forEach(k => {
      const g = groups[k];
      g.sort((a, b) => a.ly - b.ly);
      for (let i = 1; i < g.length; i++) if (g[i].ly - g[i - 1].ly < 16) g[i].ly = g[i - 1].ly + 16;
      const over = g[g.length - 1].ly - maxLy; if (over > 0) g.forEach(it => it.ly -= over);
      const under = minLy - g[0].ly; if (under > 0) g.forEach(it => it.ly += under);
    });

    const uid = 'hs_' + Math.random().toString(36).slice(2, 7);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">`;
    s += `<defs><radialGradient id="${uid}" cx="50%" cy="42%" r="62%"><stop offset="0%" stop-color="#eef4ff"/><stop offset="100%" stop-color="#f6f9fc"/></radialGradient></defs>`;
    s += `<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="url(#${uid})"/>`;
    // Ro 相容圈
    s += `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="rgba(37,99,235,0.07)" stroke="rgba(37,99,235,0.55)" stroke-width="1.5" stroke-dasharray="5 3"/>`;
    s += `<text x="${cx}" y="${Math.max(16, cy - rad - 14)}" font-size="11.5" fill="#2563eb" text-anchor="middle" font-weight="600">Ro=${h.Ro} 相容区</text>`;
    // 溶剂点 + 引出线 + 标签
    items.forEach(it => {
      const col = it.good ? '#1e7e34' : '#c0392b';
      s += `<line x1="${it.x}" y1="${it.y}" x2="${it.lx}" y2="${it.ly - 3}" stroke="${col}" stroke-width="1" opacity="0.5"/>`;
      s += `<circle cx="${it.x}" cy="${it.y}" r="5.5" fill="${col}" stroke="#fff" stroke-width="1.2" opacity="0.92"/>`;
      s += `<text x="${it.lx}" y="${it.ly}" font-size="10.5" fill="${col}" text-anchor="${it.anchor}" font-weight="500">${esc(it.n)}</text>`;
    });
    // API 三角 + 标签（固定在上方，避免跟溶剂堆叠）
    s += `<path d="M ${cx} ${cy - 9} L ${cx + 9} ${cy + 6} L ${cx - 9} ${cy + 6} Z" fill="#111827" stroke="#fff" stroke-width="1.2"/>`;
    s += `<text x="${cx}" y="${cy - 16}" font-size="12.5" font-weight="700" fill="#111827" text-anchor="middle">API</text>`;
    // 标题
    s += `<text x="14" y="22" font-size="12.5" font-weight="600" fill="#33414f">Hansen 空间等距投影（δD / δP / δH）</text>`;
    // 图例
    const lgY = H - 24;
    s += `<circle cx="18" cy="${lgY - 4}" r="5.5" fill="#1e7e34" stroke="#fff" stroke-width="1.2"/>`;
    s += `<text x="30" y="${lgY}" font-size="10" fill="#5b6776">良溶剂候选 (Ra&lt;8)</text>`;
    s += `<circle cx="180" cy="${lgY - 4}" r="5.5" fill="#c0392b" stroke="#fff" stroke-width="1.2"/>`;
    s += `<text x="192" y="${lgY}" font-size="10" fill="#5b6776">相容性一般</text>`;
    s += `<path d="M 318 ${lgY - 9} L 327 ${lgY + 6} L 309 ${lgY + 6} Z" fill="#111827" stroke="#fff" stroke-width="1.2"/>`;
    s += `<text x="336" y="${lgY}" font-size="10" fill="#5b6776">API 位置</text>`;
    s += `</svg>`;
    return s;
  }

  // 毒性 / ICH M7 风险矩阵热力图（类别 × 严重度）
  function svgToxHeatmap(m) {
    if (!m) return '';
    const cols = ['高', '中', '低'], colColor = ['#c0392b', '#e0922b', '#e8c547'];
    const W = 520, cellW = 120, cellH = 40, padL = 120, padT = 30;
    const H = padT + m.cats.length * cellH + 10;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">`;
    cols.forEach((c, i) => { s += `<text x="${padL + i * cellW + cellW / 2}" y="${padT - 10}" font-size="11" fill="#5b6776" text-anchor="middle">${c}</text>`; });
    m.cats.forEach((cat, ri) => {
      const y = padT + ri * cellH;
      s += `<text x="${padL - 8}" y="${y + cellH / 2 + 4}" font-size="11" fill="#33414f" text-anchor="end">${esc(cat.name)}</text>`;
      cols.forEach((c, ci) => {
        const x = padL + ci * cellW, active = cat.severity === c;
        const fill = active ? colColor[ci] : '#f1f4f8';
        s += `<rect x="${x + 2}" y="${y + 2}" width="${cellW - 4}" height="${cellH - 4}" rx="4" fill="${fill}" opacity="${active ? 0.9 : 1}"/>`;
        if (active) s += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 4}" font-size="11" fill="#fff" text-anchor="middle">${cat.count || ''}</text>`;
      });
    });
    s += `</svg>`;
    return s;
  }

  // 溶解度分布曲线（pH–表观溶解度，复用折线助手）
  function renderSolDist(a) {
    const t = a.solDist; if (!t) { set('advSolDist', '<div class="row-note">缺少溶解度共识，无法绘制分布。</div>'); return; }
    const yVals = t.pts.map(p => p.appLogS);
    const yMin0 = Math.min(...yVals), yMax0 = Math.max(...yVals);
    // 留出 12% 边距并取整到 1.0 网格，保证坐标轴刻度整齐
    const yPad = Math.max(0.5, (yMax0 - yMin0) * 0.12);
    const yMin = Math.min(-3, Math.floor(yMin0 - yPad));
    const yMax = Math.max(1, Math.ceil(yMax0 + yPad));
    const ySteps = Math.max(4, Math.round(yMax - yMin));
    const series = [{ label: '表观 logS', color: '#2563eb', points: t.pts.map(p => [p.ph, p.appLogS]) }];
    const chart = svgLineChart(series, { w: 640, h: 300, xMin: 0, xMax: 14, yMin: yMin, yMax: yMax, yTitle: '表观 logS (mol/L)', xSteps: 7, ySteps: ySteps, yFmt: v => v.toFixed(0) });
    let html = chart;
    html += '<div class="sub-title" style="margin:10px 0 4px">关键 pH 点表观溶解度</div>';
    html += '<table class="data"><thead><tr><th>pH</th><th>中性分数 χ</th><th>表观 logS</th><th>表观溶解度 (mg/mL)</th></tr></thead><tbody>';
    [0, 2, 4, 6, 7.4, 9, 12, 14].forEach(ph => {
      const p = t.pts.reduce((a, b) => Math.abs(b.ph - ph) < Math.abs(a.ph - ph) ? b : a);
      html += `<tr><td>${p.ph}</td><td>${p.fNeutral}</td><td>${p.appLogS}</td><td>${p.appMgml != null ? p.appMgml : '—'}</td></tr>`;
    });
    html += '</tbody></table>';
    html += `<div class="row-note" style="margin-top:8px">${esc(t.note)}</div>`;
    set('advSolDist', html);
  }

  function renderAll(data) {
    if (!data || !data.advance) return;
    const a = data.advance;
    renderConfidence(a);
    renderEsol(a);
    renderICHM7(a);
    renderSalt(a);
    renderHansen(a);
    renderSpeciation(a);
    renderTempSol(a);
    renderGreen(a);
    renderExcipient(a);
    renderRetro(a);
    renderKeyProps(a);
    renderElectronic(a);
    renderSolDist(a);
  }

  return { compute, renderAll };
})();
