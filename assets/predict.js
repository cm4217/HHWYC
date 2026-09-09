/* SwissADME 风格的类药性与 ADME 规则判定。
   输入为 RDKit 描述符对象（desc），输出各规则结果与综合评分。
   注意：以下为基于公开文献/规则的近似计算，非监管用途。 */
window.Predict = (function () {
  function num(x, d) { const v = parseFloat(x); return isNaN(v) ? null : (d == null ? v : +v.toFixed(d)); }

  // Lipinski 五规则
  function lipinski(d) {
    const MW = num(d.amw), logP = num(d.CrippenClogP), HBD = num(d.lipinskiHBD), HBA = num(d.lipinskiHBA);
    const crit = [
      { name: '分子量 MW ≤ 500', pass: MW != null && MW <= 500, value: MW != null ? MW.toFixed(1) : '—' },
      { name: 'logP ≤ 5', pass: logP != null && logP <= 5, value: logP != null ? logP.toFixed(2) : '—' },
      { name: 'HBD ≤ 5', pass: HBD != null && HBD <= 5, value: HBD != null ? HBD : '—' },
      { name: 'HBA ≤ 10', pass: HBA != null && HBA <= 10, value: HBA != null ? HBA : '—' },
    ];
    const viol = crit.filter(c => !c.pass).length;
    return { name: 'Lipinski 五规则', criteria: crit, violations: viol, pass: viol <= 1, note: '违反 >1 项提示口服吸收可能不佳' };
  }

  // Veber 规则
  function veber(d) {
    const TPSA = num(d.tpsa), rot = num(d.NumRotatableBonds);
    const crit = [
      { name: 'TPSA ≤ 140 Å²', pass: TPSA != null && TPSA <= 140, value: TPSA != null ? TPSA.toFixed(1) : '—' },
      { name: '可旋转键 ≤ 10', pass: rot != null && rot <= 10, value: rot != null ? rot : '—' },
    ];
    const viol = crit.filter(c => !c.pass).length;
    return { name: 'Veber 规则', criteria: crit, violations: viol, pass: viol === 0, note: '与口服生物利用度相关' };
  }

  // Egan 规则（Egg model）
  function egan(d) {
    const logP = num(d.CrippenClogP), TPSA = num(d.tpsa);
    const inLogP = logP != null && logP >= 0 && logP <= 5.88;
    const inTPSA = TPSA != null && TPSA >= 6.7 && TPSA <= 131.6;
    const crit = [
      { name: 'logP ∈ [0, 5.88]', pass: inLogP, value: logP != null ? logP.toFixed(2) : '—' },
      { name: 'TPSA ∈ [6.7, 131.6]', pass: inTPSA, value: TPSA != null ? TPSA.toFixed(1) : '—' },
    ];
    const viol = crit.filter(c => !c.pass).length;
    return { name: 'Egan 规则', criteria: crit, violations: viol, pass: viol === 0, note: '良好口服吸收区间' };
  }

  // Muegge 规则
  function muegge(d) {
    const MW = num(d.amw), logP = num(d.CrippenClogP), TPSA = num(d.tpsa),
      HBD = num(d.NumHBD), HBA = num(d.NumHBA), rings = num(d.NumRings), csp3 = num(d.FractionCSP3);
    const crit = [
      { name: '200 ≤ MW ≤ 600', pass: MW != null && MW >= 200 && MW <= 600, value: MW != null ? MW.toFixed(1) : '—' },
      { name: '-2 ≤ logP ≤ 5', pass: logP != null && logP >= -2 && logP <= 5, value: logP != null ? logP.toFixed(2) : '—' },
      { name: '75 ≤ TPSA ≤ 150', pass: TPSA != null && TPSA >= 75 && TPSA <= 150, value: TPSA != null ? TPSA.toFixed(1) : '—' },
      { name: 'HBD ≤ 5', pass: HBD != null && HBD <= 5, value: HBD != null ? HBD : '—' },
      { name: 'HBA ≤ 10', pass: HBA != null && HBA <= 10, value: HBA != null ? HBA : '—' },
      { name: '环数 ≥ 1', pass: rings != null && rings >= 1, value: rings != null ? rings : '—' },
      { name: 'sp³ 碳比例 ≥ 0.25', pass: csp3 != null && csp3 >= 0.25, value: csp3 != null ? csp3.toFixed(2) : '—' },
    ];
    const viol = crit.filter(c => !c.pass).length;
    return { name: 'Muegge 规则', criteria: crit, violations: viol, pass: viol <= 1, note: '类药空间判别（药物相似性）' };
  }

  // 生物利用度评分（SwissADME 算法）
  function bioavailability(d) {
    const N = (num(d.NumHBD) || 0) + (num(d.NumHBA) || 0);
    const MW = num(d.amw), logP = num(d.CrippenClogP);
    let score;
    if (N > 12) score = 0.0;
    else if (MW <= 500) score = 1.0;
    else if (MW <= 600 && logP <= 5) score = 0.7;
    else if (MW <= 600 && logP > 5) score = 0.5;
    else score = 0.0;
    let label = score >= 1 ? '高 (~100%)' : score >= 0.7 ? '中 (~70%)' : score >= 0.5 ? '中低 (~50%)' : '低 (~0%)';
    return { score, label };
  }

  // 血脑屏障透过（logBB 近似模型）
  function bbb(d) {
    const logP = num(d.CrippenClogP), TPSA = num(d.tpsa);
    const logBB = 0.088 * (logP || 0) - 0.014 * (TPSA || 0) - 0.287;
    let level = logBB > 0.3 ? '高 (透脑 BBB+)' : logBB > -0.3 ? '中等' : '低 (难透脑 BBB−)';
    return { logBB: +logBB.toFixed(3), level };
  }

  // 胃肠道吸收（SwissADME 风格估计）
  function giAbsorption(d) {
    const TPSA = num(d.tpsa), logP = num(d.CrippenClogP);
    let level;
    if (TPSA > 150) level = '低';
    else if (logP > 6 || logP < -1) level = '低';
    else level = '高';
    return { level };
  }

  // 合成可及性（近似代理，非 Ertl 精确 SA 评分）
  function syntheticAccessibility(d) {
    const rings = num(d.NumRings) || 0, aromatic = num(d.NumAromaticRings) || 0,
      stereo = num(d.NumAtomStereoCenters) || 0, csp3 = num(d.FractionCSP3),
      heavy = num(d.NumHeavyAtoms) || 0;
    let score = 1 + rings * 0.7 + aromatic * 0.3 + stereo * 0.8 + (1 - (csp3 || 0)) * 2 + Math.max(0, (heavy - 20) * 0.1);
    score = Math.min(10, Math.max(1, score));
    let level = score <= 4 ? '容易' : score <= 7 ? '中等' : '困难';
    return { score: +score.toFixed(1), level, approximate: true };
  }

  // 类药性雷达归一化（值越高越“类药”）
  function radar(d) {
    const f = (x, lo, hi) => {
      if (x == null) return 0;
      if (x <= lo) return 1;
      if (x >= hi) return 0;
      return +(1 - (x - lo) / (hi - lo)).toFixed(3);
    };
    const MW = num(d.amw), logP = num(d.CrippenClogP), TPSA = num(d.tpsa),
      HBD = num(d.NumHBD), HBA = num(d.NumHBA), rot = num(d.NumRotatableBonds);
    return [
      { axis: 'MW', value: f(MW, 500, 1000) },
      { axis: 'logP', value: f(Math.abs((logP || 0) - 2.5), 0, 5) },
      { axis: 'TPSA', value: f(TPSA, 140, 280) },
      { axis: 'HBD', value: f(HBD, 5, 12) },
      { axis: 'HBA', value: f(HBA, 10, 22) },
      { axis: 'RotB', value: f(rot, 10, 22) },
    ];
  }

  // ---------- 水溶解度预测（ESOL / Ali + SwissADME logS 分级） ----------
  function solClass(logS) {
    if (logS > 0) return { label: '高溶解', en: 'highly' };
    if (logS > -2) return { label: '易溶', en: 'very soluble' };
    if (logS > -4) return { label: '可溶', en: 'soluble' };
    if (logS > -6) return { label: '中等可溶', en: 'moderately soluble' };
    if (logS > -10) return { label: '难溶', en: 'poorly soluble' };
    return { label: '不溶', en: 'insoluble' };
  }
  // mol/L × MW(g/mol) = g/L = mg/mL（数值相等）
  function molToMg(logS, MW) {
    if (MW == null) return null;
    return Math.pow(10, logS) * MW;
  }
  function solubility(d) {
    const MW = num(d.amw), logP = num(d.CrippenClogP), TPSA = num(d.tpsa), Nrot = num(d.NumRotatableBonds) || 0;
    // ESOL (Delaney 2004) 3-term：logS = 0.16 − 0.638·ClogP − 0.0062·MW + 0.066·Nrot
    const esol = (MW != null && logP != null) ? (0.16 - 0.638 * logP - 0.0062 * MW + 0.066 * Nrot) : null;
    // Ali et al. 2012 (model 3)：logS = 0.4488 − 1.0377·logP − 0.0210·TPSA
    const ali = (logP != null && TPSA != null) ? (0.4488 - 1.0377 * logP - 0.0210 * TPSA) : null;
    const raw = [];
    if (esol != null) raw.push({ name: 'ESOL (Delaney)', logS: esol });
    if (ali != null) raw.push({ name: 'Ali (2012)', logS: ali });
    const models = raw.map(m => ({
      name: m.name, logS: m.logS,
      molL: Math.pow(10, m.logS),
      mgml: molToMg(m.logS, MW),
      cls: solClass(m.logS),
    }));
    let consensus = null;
    if (raw.length) {
      consensus = raw.reduce((s, m) => s + m.logS, 0) / raw.length;
    }
    return {
      models,
      consensus: (consensus != null) ? {
        logS: consensus,
        molL: Math.pow(10, consensus),
        mgml: molToMg(consensus, MW),
        cls: solClass(consensus),
      } : null,
      note: 'ESOL 以 RDKit CrippenClogP 作为 logP 项（SwissADME 用 XLOGP3 替代），绝对值可能与 SwissADME 官网略有差异；Ali 为 model 3（logP + TPSA）。SILICOS-IT 为片段贡献法，需 FILTER-IT 片段库，纯前端无法复现（可在 swissadme.ch 查询）。',
    };
  }

  // ---------- Ghose 类药性规则 ----------
  function ghose(d) {
    const MW = num(d.amw), logP = num(d.CrippenClogP), MR = num(d.CrippenMR),
      Natoms = num(d.NumHeavyAtoms);
    const crit = [
      { name: '160 ≤ MW ≤ 480', pass: MW != null && MW >= 160 && MW <= 480, value: MW != null ? MW.toFixed(1) : '—' },
      { name: '-0.4 ≤ logP ≤ 5.6', pass: logP != null && logP >= -0.4 && logP <= 5.6, value: logP != null ? logP.toFixed(2) : '—' },
      { name: '40 ≤ MR ≤ 130', pass: MR != null && MR >= 40 && MR <= 130, value: MR != null ? MR.toFixed(1) : '—' },
      { name: '20 ≤ 重原子数 ≤ 70', pass: Natoms != null && Natoms >= 20 && Natoms <= 70, value: Natoms != null ? Natoms : '—' },
    ];
    const viol = crit.filter(c => !c.pass).length;
    return { name: 'Ghose 规则', criteria: crit, violations: viol, pass: viol === 0, note: '经典类药性规则（MW / logP / MR / 重原子数）' };
  }

  // ---------- BCS 生物药剂学分类（溶解度 × 渗透性，估算） ----------
  function bcs(d, sol, gi) {
    const solHigh = !!(sol && sol.consensus && sol.consensus.logS > -4);
    const logP = num(d.CrippenClogP);
    const permHigh = (gi && gi.level === '高') || (logP != null && logP >= 0 && logP <= 5);
    let cls, desc;
    if (solHigh && permHigh) { cls = 'I'; desc = '高溶解-高渗透'; }
    else if (!solHigh && permHigh) { cls = 'II'; desc = '低溶解-高渗透'; }
    else if (solHigh && !permHigh) { cls = 'III'; desc = '高溶解-低渗透'; }
    else { cls = 'IV'; desc = '低溶解-低渗透'; }
    return { class: cls, desc, solubilityHigh: solHigh, permeabilityHigh: permHigh };
  }

  // ---------- 谱图相关可计算参数：分子式、精确/标称质量、不饱和度、同位素峰型 ----------
  // 天然同位素丰度（仅收录丰度 > ~0.1% 的同位素），用于 EI-MS 同位素分布卷积估算
  const ISOTOPES = {
    H: [[1, 99.9885], [2, 0.0115]],
    C: [[12, 98.93], [13, 1.07]],
    N: [[14, 99.632], [15, 0.368]],
    O: [[16, 99.757], [17, 0.038], [18, 0.205]],
    F: [[19, 100]],
    P: [[31, 100]],
    S: [[32, 94.93], [33, 0.76], [34, 4.29]],
    Cl: [[35, 75.78], [37, 24.22]],
    Br: [[79, 50.69], [81, 49.31]],
    I: [[127, 100]],
    Si: [[28, 92.23], [29, 4.67], [30, 3.10]],
    B: [[10, 19.9], [11, 80.1]],
    Na: [[23, 100]],
    K: [[39, 93.258], [41, 6.730]],
    Li: [[7, 92.5], [6, 7.5]],
    Mg: [[24, 78.99], [25, 10.0], [26, 11.01]],
    Ca: [[40, 96.941], [42, 0.647], [43, 0.135], [44, 2.086], [48, 0.187]],
    Fe: [[54, 5.845], [56, 91.754], [57, 2.119], [58, 0.282]],
    Zn: [[64, 48.63], [66, 27.90], [67, 4.10], [68, 18.75], [70, 0.62]],
  };
  // 最丰同位素整数质量（标称质量用）
  const NOMINAL = { H: 1, C: 12, N: 14, O: 16, F: 19, P: 31, S: 32, Cl: 35, Br: 79, I: 127, Si: 28, B: 11, Na: 23, K: 39, Li: 7, Mg: 24, Ca: 40, Fe: 56, Zn: 64 };

  function parseFormula(f) {
    if (!f) return {};
    const re = /([A-Z][a-z]?)(\d*)/g;
    const counts = {};
    let m;
    while ((m = re.exec(f)) !== null) {
      const el = m[1];
      const n = m[2] ? parseInt(m[2], 10) : 1;
      if (!(el in NOMINAL)) continue; // 跳过未收录元素（近似）
      counts[el] = (counts[el] || 0) + n;
    }
    return counts;
  }
  function convolve(a, b) {
    const out = {};
    for (const da in a) {
      for (const db in b) {
        const dm = (+da) + (+db);
        out[dm] = (out[dm] || 0) + a[da] * b[db];
      }
    }
    return out;
  }
  function elementDist(el, n) {
    const isos = ISOTOPES[el];
    if (!isos) return { 0: 1 };
    let base = null;
    const per = {};
    for (const pair of isos) {
      if (base === null) base = pair[0];
      const delta = pair[0] - base;
      per[delta] = (per[delta] || 0) + pair[1] / 100;
    }
    let dist = { 0: 1 };
    for (let i = 0; i < n; i++) dist = convolve(dist, per);
    return dist;
  }
  function isotopePattern(formula, exactMass) {
    const counts = parseFormula(formula);
    if (!Object.keys(counts).length) return null;
    let nominal = 0;
    for (const el in counts) nominal += (NOMINAL[el] || 0) * counts[el];
    let dist = { 0: 1 };
    for (const el in counts) dist = convolve(dist, elementDist(el, counts[el]));
    const sum = Object.values(dist).reduce((s, v) => s + v, 0) || 1;
    const rel = {};
    for (const d in dist) rel[d] = dist[d] / sum;
    const maxRel = Math.max(...Object.values(rel)) || 1;
    const peaks = Object.keys(rel).map(Number).sort((a, b) => a - b)
      .filter(d => (rel[d] / maxRel * 100) >= 0.3)
      .slice(0, 7)
      .map(d => ({ delta: d, relInt: +(rel[d] / maxRel * 100).toFixed(1) }));
    // 不饱和度 DBE = C − (H+X)/2 + N/2 + 1，X = 卤素
    const C = counts['C'] || 0, H = counts['H'] || 0, N = counts['N'] || 0;
    const X = (counts['Cl'] || 0) + (counts['Br'] || 0) + (counts['F'] || 0) + (counts['I'] || 0);
    const dbe = (C - (H + X) / 2 + N / 2 + 1);
    return {
      formula, nominalMass: nominal, exactMass: exactMass != null ? +(+exactMass).toFixed(4) : null,
      dbe: isFinite(dbe) ? +dbe.toFixed(2) : null,
      molecularIon: nominal, // EI-MS 分子离子标称质量（近似）
      peaks,
    };
  }

  // ---------- pKa 派生参数：logD / 净电荷 / 等电点 ----------
  // 输入：描述符 d（取 CrippenClogP）+ RDKit 产出的 pka 对象（酸/碱 pKa 列表）
  function pkaAnalysis(d, pkaObj) {
    if (!pkaObj || !pkaObj.hasIonizable) {
      return { hasIonizable: false, acids: [], bases: [], logD74: null, charge74: null, pI: null, pINote: '未检出可电离基团（中性分子），pKa 不适用。' };
    }
    const acids = pkaObj.acids;        // 已按 pKa 升序（最强酸在前）
    const bases = pkaObj.bases;        // 已按 pKa 降序（最强碱在前）
    const logP = num(d.CrippenClogP);

    // 中性分数 f0 = 1 / (1 + Σ酸 10^(pH-pKa_a) + Σ碱 10^(pKa_b-pH))
    function neutralFraction(pH) {
      let denom = 1;
      for (const a of acids) denom += Math.pow(10, pH - a.pka);
      for (const b of bases) denom += Math.pow(10, b.pka - pH);
      return 1 / denom;
    }
    // logD(pH) ≈ logP + log10(f0)（离子化物种分配系数忽略的常用近似）
    function logD(pH) {
      if (logP == null) return null;
      return +(logP + Math.log10(neutralFraction(pH))).toFixed(2);
    }
    // 净电荷：酸去质子贡献 −，碱质子化贡献 +
    function charge(pH) {
      let q = 0;
      for (const a of acids) q -= 1 / (1 + Math.pow(10, a.pka - pH));
      for (const b of bases) q += 1 / (1 + Math.pow(10, pH - b.pka));
      return +q.toFixed(3);
    }

    const logD74 = logD(7.4);
    const charge74 = charge(7.4);

    // 等电点 pI：仅当同时含酸、碱基团且净电荷跨越 0 时存在
    let pI = null, pINote = '';
    if (acids.length && bases.length) {
      let prevQ = charge(0), prevPH = 0, found = null;
      for (let ph = 0.02; ph <= 14; ph += 0.02) {
        const q = charge(ph);
        if ((prevQ < 0) !== (q < 0)) {        // 符号翻转 → 零点在 (prevPH, ph)
          found = prevPH + (ph - prevPH) * (0 - prevQ) / (q - prevQ);
          break;
        }
        prevQ = q; prevPH = ph;
      }
      if (found != null) pI = +found.toFixed(2);
      else pINote = '（电荷未在 0 处跨越，无典型等电点）';
    } else if (acids.length) {
      pINote = '不适用：无碱性基团（纯酸性）';
    } else {
      pINote = '不适用：无酸性基团（纯碱性）';
    }

    return { hasIonizable: true, acids, bases, logD74, charge74, pI, pINote };
  }

  // ---------- 热力学与溶剂化估算（SolProp_ML 框架经验复现） ----------
  // 输入：描述符 d、solubility(d) 结果（含综合 logS）、pka 对象。
  // 产出：溶剂化自由能 ΔG_solv、焓 ΔH_solv、熵 ΔS_solv（由 logS 反推），
  //       Abraham 溶剂化参数 E/S/A/B/L/V，以及 logK / logK_aq（分配系数）。
  function thermodynamics(d, sol, pkaObj) {
    const MW = num(d.amw), logP = num(d.CrippenClogP), TPSA = num(d.tpsa),
      HBD = num(d.NumHBD) || 0, HBA = num(d.NumHBA) || 0,
      MR = num(d.CrippenMR), Nrot = num(d.NumRotatableBonds) || 0,
      Nheavy = num(d.NumHeavyAtoms) || 0, Nhet = num(d.NumHeteroatoms) || 0,
      Nar = num(d.NumAromaticRings) || 0, Nrings = num(d.NumRings) || 0;

    // 溶解度：优先用 consensus logS；否则用经典 QSAR 经验式兜底（与 solubility() 思路一致）
    const consensus = (sol && sol.consensus) ? sol.consensus.logS : null;
    const logS = consensus != null ? consensus
      : ((logP != null && TPSA != null) ? (0.3 - 0.8 * logP - 0.015 * TPSA) : null);
    const solM = logS != null ? Math.pow(10, logS) : null; // mol/L

    // ΔG_solv = -RT ln(S) （S = 摩尔溶解度，单位 mol/L）。R = 1.9872e-3 kcal·mol⁻¹·K⁻¹
    const T = 298.15, Rkcal = 1.9872041e-3;
    const RT = Rkcal * T;
    const dG = (solM != null && solM > 0) ? -RT * Math.log(solM) : null;

    // ΔH_solv：由基团贡献法估算（氢键供/受体、杂原子、芳香性、环、柔性、疏水项互相平衡）
    let dH = null;
    if (dG != null) {
      let contrib = 0;
      contrib += HBD * -3.0;     // 氢键供体 → 去溶剂化放热（更负）
      contrib += HBA * -2.2;     // 氢键受体 → 去溶剂化放热
      contrib += Nhet * -1.0;    // 杂原子 → 极性相互作用
      contrib += Nar * -1.5;     // 芳香环 → 疏水 + 偶极
      contrib += Nrings * -0.5;  // 环系统 → 刚性/疏水
      contrib += Nrot * -0.2;    // 柔性 → 构象熵损失
      contrib += (logP || 0) * 0.8; // 疏水 → 进入有机相放热
      dH = 1.7 * dG + contrib * 0.2;
      dH = Math.max(-45, Math.min(10, dH)); // 物理合理性裁剪
    }

    // ΔS_solv = (ΔH − ΔG)/T，单位 cal·mol⁻¹·K⁻¹（常规报道单位）
    const dS = (dG != null && dH != null) ? ((dH - dG) / T * 1000) : null;

    // Abraham 溶剂化参数（基于分子描述符的近似映射，参考 Abraham 模型符号约定）
    const E = MR != null ? +(Math.max(0, (MR - 10) / 25)).toFixed(3) : null;            // 过剩摩尔折射
    const abS = TPSA != null ? +(Math.min(3, TPSA / 60 + Nhet * 0.05)).toFixed(3) : null; // 偶极/极性
    const A = +(Math.min(2, HBD * 0.35 + (Nhet > 0 ? 0.1 : 0))).toFixed(3);             // 氢键酸性
    const B = +(Math.min(2, HBA * 0.25 + Nhet * 0.05)).toFixed(3);                       // 氢键碱性
    const L = (logP != null && MW != null) ? +(Math.max(0, 0.6 * logP + 0.01 * MW - 0.5)).toFixed(3) : null; // 疏水
    const V = MW != null ? +(MW / 100).toFixed(3) : null;                                 // 分子体积

    const logK_aq = (logS != null) ? +(logS + 3.0).toFixed(4) : null; // 水-气分配近似
    const logK = (logP != null && logK_aq != null) ? +(logP + logK_aq).toFixed(4) : null; // 正辛醇-气近似

    function fmt(v, sd) { return v != null ? { value: +(+v).toFixed(4), sd } : null; }
    return {
      logS, solM,
      dG_solv: fmt(dG, 1.1),
      dH_solv: fmt(dH, 3.0),
      dS_solv: fmt(dS, 10.0),
      abraham: {
        E: fmt(E, 0.15), S: fmt(abS, 0.25), A: fmt(A, 0.2),
        B: fmt(B, 0.2), L: fmt(L, 0.4), V: fmt(V, 0.05),
      },
      logK: fmt(logK, 1.0),
      logK_aq: fmt(logK_aq, 1.0),
      note: '基于溶解度 logS 与基团贡献法（参考 SolProp_ML 热力学框架 ΔG/ΔH/ΔS_solv、Abraham 与 logK 参数）的经验估算；未加载其原始预训练 ML 模型，数值仅供趋势参考，非实验值。',
    };
  }

  // ---------- 类药性进阶（先导优化 / 片段筛选规则） ----------
  // 与 Lipinski/Veber 等「口服成药性」规则互补，关注先导物优化与片段筛选区间。
  function leadLikeness(d) {
    const MW = num(d.amw), logP = num(d.CrippenClogP), TPSA = num(d.tpsa),
      HBD = num(d.NumHBD), HBA = num(d.NumHBA), rot = num(d.NumRotatableBonds);
    const f2 = (x) => (x != null ? (+x).toFixed(2) : '—');
    const f1 = (x) => (x != null ? (+x).toFixed(1) : '—');
    const rules = [
      { name: 'GSK 4/400 规则', pass: MW != null && MW <= 400 && logP != null && logP <= 4,
        detail: `MW ${f1(MW)} (≤400) · logP ${f2(logP)} (≤4)`,
        note: '分子量 ≤400 且 logP ≤4 的「类先导 / 可成药」区间。' },
      { name: 'Pfizer 3/75 规则', pass: logP != null && logP <= 3 && TPSA != null && TPSA >= 75,
        detail: `logP ${f2(logP)} (≤3) · TPSA ${f1(TPSA)} (≥75)`,
        note: 'logP ≤3 且 TPSA ≥75 的先导物优化目标。' },
      { name: 'Golden Triangle（金三角）', pass: logP != null && logP >= 0 && logP <= 5 && TPSA != null && TPSA <= 140,
        detail: `logP ${f2(logP)} (0–5) · TPSA ${f1(TPSA)} (≤140)`,
        note: 'logP 0–5 且 TPSA ≤140 的「金三角」优化区间（Johnson 2009）。' },
      { name: 'Rule of Three（片段 Ro3）', pass: MW != null && MW <= 300 && logP != null && logP <= 3 && HBD != null && HBD <= 3 && HBA != null && HBA <= 3 && rot != null && rot <= 3,
        detail: `MW ${f1(MW)} (≤300) · logP ${f2(logP)} (≤3) · HBD ${HBD != null ? HBD : '—'} (≤3) · HBA ${HBA != null ? HBA : '—'} (≤3) · RotB ${rot != null ? rot : '—'} (≤3)`,
        note: '片段类候选（fragment-like）的宽松规则。' },
    ];
    const passCount = rules.filter(r => r.pass).length;
    return { rules, passCount, total: rules.length };
  }

  function all(d, pkaObj) {
    const gi = giAbsorption(d);
    const sol = solubility(d);
    const thermo = thermodynamics(d, sol, pkaObj);
    return {
      lipinski: lipinski(d),
      veber: veber(d),
      egan: egan(d),
      muegge: muegge(d),
      bioavailability: bioavailability(d),
      bbb: bbb(d),
      gi: gi,
      sa: syntheticAccessibility(d),
      ghose: ghose(d),
      solubility: sol,
      bcs: bcs(d, sol, gi),
      radar: radar(d),
      pka: pkaAnalysis(d, pkaObj),
      thermo: thermo,
      lead: leadLikeness(d),
    };
  }

  return { all, lipinski, veber, egan, muegge, bioavailability, bbb, giAbsorption, syntheticAccessibility, radar, solubility, ghose, bcs, solClass, isotopePattern, pkaAnalysis, thermodynamics, leadLikeness };
})();
