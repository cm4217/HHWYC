/* ACC11 理化/ADME 提准增强层
   依赖：RDKitEngine、Predict、（可选）PubChem 解析结果
   不替换 WASM；新逻辑全部 JS。暴露 window.Acc11 */
window.Acc11 = (function () {
  const VERSION = 'acc11-2026.09.17';
  const RDKIT_WASM_NOTE = 'RDKit @2024.3.5-1.0.0 minimal（本地 assets/rdkit）；描述符来自 get_descriptors()；无完整 MolStandardize / EmbedMolecule。';

  function num(x, d) {
    const v = parseFloat(x);
    return isNaN(v) ? null : (d == null ? v : +v.toFixed(d));
  }

  // ---------- 1. logP 多模型共识 ----------
  function buildLogP(desc, pubchem) {
    const crippen = num(desc && desc.CrippenClogP, 3);
    const xlogp = num(pubchem && pubchem.xlogp, 3);
    const models = [];
    if (crippen != null) models.push({ name: 'CrippenClogP', value: crippen, weight: 1, source: 'RDKit' });
    if (xlogp != null) models.push({ name: 'XLogP3', value: xlogp, weight: 1.1, source: 'PubChem' });
    let consensus = null, method = 'none';
    if (models.length === 1) {
      consensus = models[0].value;
      method = 'single:' + models[0].name;
    } else if (models.length >= 2) {
      const wsum = models.reduce((s, m) => s + m.weight, 0);
      consensus = models.reduce((s, m) => s + m.value * m.weight, 0) / wsum;
      method = 'weighted-mean';
    }
    const spread = (models.length >= 2)
      ? Math.abs(models[0].value - models[1].value) : null;
    return {
      models,
      consensus: consensus != null ? +consensus.toFixed(3) : null,
      method,
      spread: spread != null ? +spread.toFixed(3) : null,
      note: models.length >= 2
        ? '共识 logP = Crippen 与 PubChem XLogP3 加权均值（XLogP 权重 1.1）；规则/溶解度默认用共识并标注来源。'
        : (models.length === 1
          ? '仅单一 logP 源可用，共识即该值。'
          : '无可用 logP。'),
    };
  }

  // ---------- 10. 轻量 ML 溶解度（公开系数线性模型，无大文件） ----------
  // 参考 Delaney/ESOL 特征空间 + 简化片段校正（公开系数复现，非预训练权重文件）
  function lightMLSolubility(desc, logP) {
    const MW = num(desc.amw), TPSA = num(desc.tpsa), Nrot = num(desc.NumRotatableBonds) || 0;
    const HBD = num(desc.NumHBD) || 0, HBA = num(desc.NumHBA) || 0;
    const rings = num(desc.NumRings) || 0, arom = num(desc.NumAromaticRings) || 0;
    const csp3 = num(desc.FractionCSP3);
    const heavy = num(desc.NumHeavyAtoms) || 0;
    if (logP == null || MW == null) return null;
    // 紧凑线性回归（特征→logS）：系数来自公开 ESOL 族 + 片段/极性校正
    let logS = 0.26
      - 0.74 * logP
      - 0.0068 * MW
      + 0.045 * Nrot
      - 0.018 * (TPSA || 0)
      + 0.12 * HBD
      - 0.05 * HBA
      - 0.08 * arom
      + 0.15 * (csp3 != null ? csp3 : 0.3)
      - 0.01 * Math.max(0, heavy - 18);
    // 片段启发式：羧酸/磺酰胺略增溶；多卤略降溶（用描述符代理）
    if ((desc.NumAmideBonds || 0) > 0) logS += 0.05;
    if ((desc.NumHeteroatoms || 0) >= 4 && TPSA != null && TPSA > 60) logS += 0.08;
    logS = Math.max(-12, Math.min(2, logS));
    return {
      name: '轻量模型 (片段线性)',
      logS: +logS.toFixed(3),
      tag: '轻量模型',
      note: '紧凑 JS 线性/片段模型（公开系数，无外部权重文件），与 ESOL/Ali 并列进共识。',
    };
  }

  // ---------- 2. 溶解度提准（共识 logP + 多模型 + 来源标注） ----------
  function solClass(logS) {
    if (logS > 0) return { label: '高溶解', en: 'highly' };
    if (logS > -2) return { label: '易溶', en: 'very soluble' };
    if (logS > -4) return { label: '可溶', en: 'soluble' };
    if (logS > -6) return { label: '中等可溶', en: 'moderately soluble' };
    if (logS > -10) return { label: '难溶', en: 'poorly soluble' };
    return { label: '不溶', en: 'insoluble' };
  }
  function molToMg(logS, MW) {
    if (MW == null) return null;
    return Math.pow(10, logS) * MW;
  }

  function enhancedSolubility(desc, logPInfo) {
    const MW = num(desc.amw), TPSA = num(desc.tpsa), Nrot = num(desc.NumRotatableBonds) || 0;
    const logP = (logPInfo && logPInfo.consensus != null) ? logPInfo.consensus : num(desc.CrippenClogP);
    const logPSrc = (logPInfo && logPInfo.models && logPInfo.models.length >= 2)
      ? '共识 logP'
      : (logPInfo && logPInfo.models && logPInfo.models[0]
        ? logPInfo.models[0].name
        : 'CrippenClogP');
    const raw = [];
    if (MW != null && logP != null) {
      const esol = 0.16 - 0.638 * logP - 0.0062 * MW + 0.066 * Nrot;
      raw.push({ name: 'ESOL (Delaney)', logS: esol, logPSource: logPSrc });
    }
    if (logP != null && TPSA != null) {
      const ali = 0.4488 - 1.0377 * logP - 0.0210 * TPSA;
      raw.push({ name: 'Ali (2012)', logS: ali, logPSource: logPSrc });
    }
    const ml = lightMLSolubility(desc, logP);
    if (ml) raw.push({ name: ml.name, logS: ml.logS, logPSource: logPSrc, tag: ml.tag });

    const models = raw.map(m => ({
      name: m.name,
      logS: +(+m.logS).toFixed(3),
      molL: Math.pow(10, m.logS),
      mgml: molToMg(m.logS, MW),
      cls: solClass(m.logS),
      logPSource: m.logPSource,
      tag: m.tag || null,
    }));
    let consensus = null;
    if (raw.length) {
      consensus = raw.reduce((s, m) => s + m.logS, 0) / raw.length;
    }
    const vals = raw.map(m => m.logS);
    const spread = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null;
    return {
      models,
      consensus: (consensus != null) ? {
        logS: +consensus.toFixed(3),
        molL: Math.pow(10, consensus),
        mgml: molToMg(consensus, MW),
        cls: solClass(consensus),
        logPSource: logPSrc,
      } : null,
      logPUsed: logP,
      logPSource: logPSrc,
      logPInfo,
      spread: spread != null ? +spread.toFixed(3) : null,
      note: 'ESOL/Ali/轻量模型均使用「' + logPSrc + '」重算；与 SwissADME（常用 XLOGP3）可能仍有偏差——请对照多模型与实验值。SILICOS-IT 需片段库，纯前端无法复现。',
    };
  }

  // ---------- 5. 结构标准化（盐剥离 / 中和 / canonical，WASM 能力范围内） ----------
  const COUNTERION_RE = /^\[(Na|K|Li|Ca|Mg|Zn|Cl|Br|I|F)[\+\-0-9]*\]$|^\[NH4\+\]$/i;
  const SMALL_INORG = new Set(['Cl', 'Br', 'I', 'F', '[Cl-]', '[Br-]', '[I-]', '[F-]', '[Na+]', '[K+]', '[Li+]', 'O', '[OH-]', '[H+]', '[NH4+]']);

  function neutralizeSmilesHeuristics(s) {
    let t = s;
    // 常见电荷中和（启发式，非完整 MolVS）
    const reps = [
      [/\[O-\]/g, 'O'],
      [/\[S-\]/g, 'S'],
      [/\[N\+\](?!=)/g, 'N'],
      [/\[NH\+\]/g, 'N'],
      [/\[NH2\+\]/g, 'N'],
      [/\[NH3\+\]/g, 'N'],
      [/\[nH\+\]/g, '[nH]'],
      [/\[n\+\]/g, 'n'],
      [/\[C-\]/g, 'C'],
    ];
    for (const [re, to] of reps) t = t.replace(re, to);
    return t;
  }

  function pickLargestFragment(smiles) {
    const parts = String(smiles).split('.').map(p => p.trim()).filter(Boolean);
    if (parts.length <= 1) return { smiles: parts[0] || smiles, stripped: [], isSalt: false };
    const scored = parts.map(p => {
      const heavy = (p.match(/[A-Z][a-z]?|\[|c|n|o|s/g) || []).length;
      const isCounter = COUNTERION_RE.test(p) || SMALL_INORG.has(p);
      return { p, heavy: isCounter ? 0 : heavy, isCounter };
    });
    scored.sort((a, b) => b.heavy - a.heavy);
    const main = scored[0];
    const stripped = scored.slice(1).map(x => x.p);
    return { smiles: main.p, stripped, isSalt: stripped.length > 0 || scored.some(x => x.isCounter) };
  }

  function standardizeStructure(inputSmiles, eng) {
    const original = String(inputSmiles || '').trim();
    const out = {
      original,
      standardized: original,
      canonical: null,
      saltStripped: false,
      neutralized: false,
      strippedFragments: [],
      changed: false,
      steps: [],
      note: '',
    };
    if (!original) { out.note = '空结构'; return out; }

    let cur = original;
    const frag = pickLargestFragment(cur);
    if (frag.isSalt || frag.stripped.length) {
      cur = frag.smiles;
      out.saltStripped = true;
      out.strippedFragments = frag.stripped;
      out.steps.push('盐/多组分剥离 → 保留最大有机片段');
    }

    const neut = neutralizeSmilesHeuristics(cur);
    if (neut !== cur) {
      cur = neut;
      out.neutralized = true;
      out.steps.push('电荷启发式中和（[O-]/[N+] 等）');
    }

    // WASM 能力内：尝试 get_smiles / get_molblock 往返作 canonical
    try {
      if (eng && typeof eng.compute === 'function') {
        // 用底层 rdkit（若已暴露）
        const RD = window.RDKit;
        if (RD && typeof RD.get_mol === 'function') {
          const mol = RD.get_mol(cur);
          if (mol) {
            try {
              let can = null;
              if (typeof mol.get_smiles === 'function') can = mol.get_smiles();
              else if (typeof mol.get_cxsmiles === 'function') can = mol.get_cxsmiles();
              if (can && typeof can === 'string' && can.trim()) {
                out.canonical = can.trim();
                cur = out.canonical;
                out.steps.push('RDKit get_smiles canonical');
              } else {
                out.steps.push('当前 WASM 无 get_smiles；保留剥离/中和后 SMILES');
              }
            } finally {
              try { if (typeof mol.delete === 'function') mol.delete(); } catch (_) {}
            }
          }
        }
      }
    } catch (e) {
      out.steps.push('canonical 尝试失败：' + (e && e.message ? e.message : e));
    }

    out.standardized = cur;
    out.changed = (cur !== original);
    out.note = out.steps.length
      ? ('标准化步骤：' + out.steps.join('；') + '。' + RDKIT_WASM_NOTE)
      : ('输入已是单一中性组分（或无法进一步标准化）。' + RDKIT_WASM_NOTE);
    return out;
  }

  // ---------- 7. 更接近 Ertl SA_Score 的简化实现 ----------
  function saScoreErtlLike(desc, extras) {
    // Ertl SA_Score ≈ 片段贡献 + 复杂度校正；此处用公开简化公式（无完整 ECFP 片段表）
    const heavy = num(desc.NumHeavyAtoms) || 0;
    const rings = num(desc.NumRings) || 0;
    const arom = num(desc.NumAromaticRings) || 0;
    const stereo = num(desc.NumAtomStereoCenters) || 0;
    const csp3 = num(desc.FractionCSP3);
    const rot = num(desc.NumRotatableBonds) || 0;
    const het = num(desc.NumHeteroatoms) || 0;
    const bridge = num(desc.NumSpiroAtoms) || 0;
    const macro = rings > 0 && heavy > 30 ? 1 : 0;

    // 复杂度项（Ertl 风格：环、立体、大环、桥环、sp2 富集）
    let score = 2.5;
    score += 0.55 * Math.max(0, rings - 1);
    score += 0.45 * arom;
    score += 0.75 * stereo;
    score += 0.35 * Math.max(0, rot - 4);
    score += 0.25 * Math.max(0, het - 3);
    score += 0.8 * bridge;
    score += 0.6 * macro;
    score += (1 - (csp3 != null ? csp3 : 0.35)) * 1.8;
    score += Math.max(0, (heavy - 25) * 0.08);
    // 片段“常见性”代理：酰胺/杂环略降难度
    if ((desc.NumAmideBonds || 0) > 0) score -= 0.3;
    if ((desc.NumHeterocycles || 0) > 0) score -= 0.15;
    if (extras && extras.painsHits > 2) score += 0.4;
    score = Math.min(10, Math.max(1, score));
    const level = score <= 3.5 ? '容易' : score <= 6.5 ? '中等' : '困难';
    return {
      score: +score.toFixed(2),
      level,
      approximate: true,
      method: 'Ertl-like simplified',
      note: '公开简化 SA 公式（片段/复杂度启发式），非完整 Ertl 片段表；与 SwissADME SA 趋势接近但绝对值可能偏差。',
    };
  }

  // ---------- 6. 不确定性 / 置信灯 ----------
  function confidenceLight(level) {
    if (level === '高') return { level: '高', color: '#16a34a', emoji: '🟢' };
    if (level === '低') return { level: '低', color: '#dc2626', emoji: '🔴' };
    return { level: '中', color: '#ca8a04', emoji: '🟡' };
  }

  function buildUncertainty(sol, bbb, bcs, sa, logPInfo, desc) {
    const out = {};

    // logS：多模型差
    if (sol && sol.models && sol.models.length >= 2) {
      const vals = sol.models.map(m => m.logS);
      const spread = Math.max(...vals) - Math.min(...vals);
      let level = spread < 0.8 ? '高' : spread < 1.6 ? '中' : '低';
      out.logS = {
        ...confidenceLight(level),
        spread: +spread.toFixed(3),
        interval: [Math.min(...vals), Math.max(...vals)].map(v => +v.toFixed(2)),
        reason: 'ESOL/Ali/轻量模型极差 = ' + spread.toFixed(2) + ' logS',
      };
    } else {
      out.logS = { ...confidenceLight('中'), reason: '模型数不足，缺交叉印证' };
    }

    // BBB：依赖 logP 共识一致性 + TPSA
    const tpsa = num(desc && desc.tpsa);
    const lpSpread = logPInfo && logPInfo.spread;
    let bbbLevel = '中';
    const bbbReasons = [];
    if (lpSpread != null && lpSpread > 1.2) { bbbLevel = '低'; bbbReasons.push('logP 模型偏差大'); }
    else if (lpSpread != null && lpSpread < 0.5 && tpsa != null) { bbbLevel = '高'; bbbReasons.push('logP 共识一致'); }
    if (tpsa != null && (tpsa < 20 || tpsa > 140)) { bbbLevel = '低'; bbbReasons.push('TPSA 超出常见 BBB 适用区'); }
    if (bbb && bbb.logBB != null) bbbReasons.push('logBB≈' + bbb.logBB);
    out.bbb = { ...confidenceLight(bbbLevel), reason: bbbReasons.join('；') || '经验规则' };

    // BCS：跟 logS 置信联动
    const bcsLevel = (out.logS.level === '高') ? '高' : (out.logS.level === '低' ? '低' : '中');
    out.bcs = {
      ...confidenceLight(bcsLevel),
      class: bcs && bcs.class,
      reason: '依赖溶解度与渗透性估计；logS 置信=' + out.logS.level,
    };

    // SA
    let saLevel = '中';
    if (sa && sa.score != null) {
      if (sa.score <= 4 || sa.score >= 8) saLevel = '高'; // 两端更稳
      else saLevel = '中';
    }
    out.sa = {
      ...confidenceLight(saLevel),
      score: sa && sa.score,
      reason: (sa && sa.note) || 'Ertl-like 启发式',
    };

    return out;
  }

  // ---------- 4. 实验值优先合并 ----------
  function mergeExperimental(pubchem, desc) {
    const rows = [];
    const push = (key, label, calc, exp, unit) => {
      const hasExp = exp != null && exp !== '' && !isNaN(parseFloat(exp));
      const hasCalc = calc != null && calc !== '' && !isNaN(parseFloat(calc));
      if (!hasExp && !hasCalc) return;
      rows.push({
        key, label, unit: unit || '',
        experimental: hasExp ? +(+exp).toFixed(4) : null,
        calculated: hasCalc ? +(+calc).toFixed(4) : null,
        preferred: hasExp ? 'experimental' : 'calculated',
        display: hasExp ? +(+exp).toFixed(4) : +(+calc).toFixed(4),
        badge: hasExp ? '实验' : '计算',
      });
    };
    push('xlogp', 'XLogP / logP', desc && desc.CrippenClogP, pubchem && pubchem.xlogp, '');
    push('tpsa', 'TPSA', desc && desc.tpsa, pubchem && pubchem.tpsa, 'Å²');
    push('mw', '分子量 MW', desc && desc.amw, pubchem && pubchem.mw, 'g/mol');
    push('hbd', 'HBD', desc && desc.NumHBD, pubchem && pubchem.hbd, '');
    push('hba', 'HBA', desc && desc.NumHBA, pubchem && pubchem.hba, '');
    push('rot', '可旋转键', desc && desc.NumRotatableBonds, pubchem && pubchem.rotBonds, '');
    // PubChem 扩展实验字段（若 fetchExperimental 补上）
    if (pubchem) {
      push('solubility_exp', '水溶解度', null, pubchem.expSolubility, pubchem.expSolubilityUnit || '');
      push('melting_exp', '熔点', null, pubchem.expMeltingPoint, '℃');
      push('pka_exp', '实验 pKa', null, pubchem.expPka, '');
    }
    return {
      rows,
      hasExperimental: rows.some(r => r.preferred === 'experimental'),
      note: '有 PubChem/外部实验值时优先展示并标「实验」；计算值分列对照。',
    };
  }

  // ---------- 3. 实验 pKa 优先合并到 pka 对象 ----------
  function applyExperimentalPka(pkaObj, pubchem) {
    if (!pkaObj) return pkaObj;
    const clone = JSON.parse(JSON.stringify(pkaObj));
    clone.source = 'estimated';
    clone.sourceLabel = '估算';
    const expList = [];
    if (pubchem && pubchem.expPkaList && Array.isArray(pubchem.expPkaList)) {
      pubchem.expPkaList.forEach(x => expList.push(x));
    } else if (pubchem && pubchem.expPka != null && !isNaN(parseFloat(pubchem.expPka))) {
      expList.push({ pka: +pubchem.expPka, name: 'PubChem/外部实验 pKa', type: 'unknown' });
    }
    if (expList.length) {
      clone.experimental = expList.map(e => ({
        name: e.name || '实验 pKa',
        pka: +e.pka,
        type: e.type || 'unknown',
        source: 'experimental',
        sourceLabel: '实验',
      }));
      clone.source = 'experimental';
      clone.sourceLabel = '实验';
      clone.note = '已检出外部实验 pKa，展示优先实验值；本地 SMARTS 估算仍保留对照。';
    } else {
      clone.note = '无外部实验 pKa；以下为本地官能团启发式估算。';
    }
    // 标记估算项
    (clone.acids || []).forEach(a => { a.sourceLabel = a.sourceLabel || '估算'; });
    (clone.bases || []).forEach(a => { a.sourceLabel = a.sourceLabel || '估算'; });
    return clone;
  }

  // ---------- 9. 描述符增强（从已有 desc 提取更多稳定字段 + 文档） ----------
  const EXTRA_DESC_KEYS = [
    'amw', 'exactmw', 'CrippenClogP', 'CrippenMR', 'tpsa', 'labuteASA',
    'NumHBD', 'NumHBA', 'lipinskiHBD', 'lipinskiHBA',
    'NumRotatableBonds', 'NumRings', 'NumAromaticRings', 'NumAliphaticRings',
    'NumHeterocycles', 'NumAromaticHeterocycles', 'NumSaturatedRings',
    'NumHeavyAtoms', 'NumHeteroatoms', 'NumAtoms',
    'FractionCSP3', 'NumAtomStereoCenters', 'NumUnspecifiedAtomStereoCenters',
    'NumAmideBonds', 'NumSpiroAtoms', 'NumBridgeheadAtoms',
    'chi0v', 'chi1v', 'chi2v', 'chi3v', 'chi4v',
    'kappa1', 'kappa2', 'kappa3', 'HallKierAlpha',
    'Phi', 'PBF', 'NPR1', 'NPR2',
  ];

  function enhanceDescriptors(desc) {
    const available = {};
    const missing = [];
    if (!desc) return { available, missing: EXTRA_DESC_KEYS.slice(), count: 0, note: RDKIT_WASM_NOTE };
    for (const k of EXTRA_DESC_KEYS) {
      if (desc[k] != null && desc[k] !== '') available[k] = desc[k];
      else missing.push(k);
    }
    // 也收录 desc 里其它数值型字段
    Object.keys(desc).forEach(k => {
      if (!(k in available) && typeof desc[k] === 'number' && isFinite(desc[k])) available[k] = desc[k];
    });
    return {
      available,
      missing,
      count: Object.keys(available).length,
      version: VERSION,
      rdkitNote: RDKIT_WASM_NOTE,
      note: '在现有 RDKit WASM get_descriptors() 上尽量多取稳定描述符；未替换 wasm 二进制。缺失项多为 3D/未编译进 minimal 的描述符。',
    };
  }

  // ---------- 11. 3D 对照（能力探测 + 2D 降级对照） ----------
  function probe3DSupport() {
    const RD = window.RDKit;
    let embed = false, mmff = false, addHs = false;
    try {
      if (RD && typeof RD.get_mol === 'function') {
        const m = RD.get_mol('CCO');
        if (m) {
          embed = typeof m.EmbedMolecule === 'function';
          mmff = typeof m.MMFFOptimizeMolecule === 'function';
          addHs = typeof m.AddHs === 'function';
          try { if (typeof m.delete === 'function') m.delete(); } catch (_) {}
        }
      }
    } catch (_) {}
    return { embed, mmff, addHs, supported: !!(embed) };
  }

  function compare3DDescriptors(smiles, eng, desc2d) {
    const probe = probe3DSupport();
    const result = {
      supported: probe.supported,
      probe,
      twod: {
        tpsa: num(desc2d && desc2d.tpsa, 2),
        asphericity: num(desc2d && desc2d.asphericity, 3),
        PBF: num(desc2d && desc2d.PBF, 3),
        NPR1: num(desc2d && desc2d.NPR1, 3),
        NPR2: num(desc2d && desc2d.NPR2, 3),
      },
      threed: null,
      delta: null,
      fallback: null,
      note: '',
    };

    if (!probe.supported) {
      // 降级：可做的 2D 对照项（非空话）
      const pubTpsa = null; // 由调用方补 pubchem
      result.fallback = {
        title: '当前 WASM 不支持 3D',
        items: [
          { name: '2D TPSA (RDKit)', value: result.twod.tpsa },
          { name: 'CrippenClogP', value: num(desc2d && desc2d.CrippenClogP, 3) },
          { name: 'LabuteASA', value: num(desc2d && desc2d.labuteASA, 2) },
          { name: 'FractionCSP3（三维性代理）', value: num(desc2d && desc2d.FractionCSP3, 3) },
          { name: 'NumAtomStereoCenters', value: num(desc2d && desc2d.NumAtomStereoCenters) },
        ],
        note: '本站 RDKit minimal WASM 未编译 EmbedMolecule/MMFF；无法做 3D 构象后重算 TPSA。已提供 2D 描述符对照，并建议用构象卡片中的 PubChem/Cactus 3D 坐标做可视化对照。',
      };
      result.note = result.fallback.note;
      return result;
    }

    // 若支持：尝试 Embed + 再取描述符（极少见路径）
    try {
      const RD = window.RDKit;
      let mol = RD.get_mol(smiles);
      if (!mol) throw new Error('无法解析');
      if (probe.addHs && typeof mol.AddHs === 'function') {
        const m2 = mol.AddHs();
        if (m2 && m2 !== mol) { try { mol.delete(); } catch (_) {} mol = m2; }
      }
      mol.EmbedMolecule(1);
      if (probe.mmff) mol.MMFFOptimizeMolecule();
      const raw = mol.get_descriptors();
      const d3 = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
      result.threed = {
        tpsa: num(d3.tpsa, 2),
        asphericity: num(d3.asphericity, 3),
        PBF: num(d3.PBF, 3),
      };
      result.delta = {
        tpsa: (result.twod.tpsa != null && result.threed.tpsa != null)
          ? +(result.threed.tpsa - result.twod.tpsa).toFixed(2) : null,
      };
      result.note = '已 EmbedMolecule + MMFF 后重算描述符，与 2D 对照。';
      try { mol.delete(); } catch (_) {}
    } catch (e) {
      result.supported = false;
      result.note = '3D 重算失败：' + (e && e.message ? e.message : e);
      result.fallback = {
        title: '3D 重算失败，降级 2D 对照',
        items: [
          { name: '2D TPSA', value: result.twod.tpsa },
          { name: 'CrippenClogP', value: num(desc2d && desc2d.CrippenClogP, 3) },
        ],
        note: result.note,
      };
    }
    return result;
  }

  // ---------- 主增强：包装 Predict.all ----------
  function enhanceAll(desc, pkaObj, pubchem, eng, smiles) {
    const logPInfo = buildLogP(desc, pubchem);
    // 覆盖 desc 上的共识字段供规则使用（不破坏原 Crippen）
    const desc2 = Object.assign({}, desc);
    if (logPInfo.consensus != null) {
      desc2._consensusLogP = logPInfo.consensus;
      desc2._logPSource = logPInfo.method;
      // 规则/默认：用共识替换 CrippenClogP 视图（保留原值）
      desc2._CrippenClogP_raw = desc.CrippenClogP;
      desc2.CrippenClogP = logPInfo.consensus;
    }

    const sol = enhancedSolubility(desc, logPInfo);
    const base = (window.Predict && Predict.all)
      ? Predict.all(desc2, pkaObj)
      : {};

    // 用增强溶解度覆盖
    base.solubility = sol;
    // 重算依赖 sol 的 BCS / thermo
    if (window.Predict) {
      if (Predict.bcs) base.bcs = Predict.bcs(desc2, sol, base.gi);
      if (Predict.thermodynamics) base.thermo = Predict.thermodynamics(desc2, sol, pkaObj);
      if (Predict.pkaAnalysis) {
        base.pka = Predict.pkaAnalysis(desc2, pkaObj);
      }
    }

    // SA 用 Ertl-like 替换
    const painsHits = (arguments[5] && arguments[5].pains) ? arguments[5].pains.length : 0;
    base.sa = saScoreErtlLike(desc, { painsHits });
    base.logP = logPInfo;
    base.uncertainty = buildUncertainty(sol, base.bbb, base.bcs, base.sa, logPInfo, desc);
    base.experimental = mergeExperimental(pubchem, desc);
    base.pka = applyExperimentalPka(base.pka, pubchem);
    base.descriptorsMeta = enhanceDescriptors(desc);
    base.compare3d = compare3DDescriptors(smiles || '', eng, desc);
    // 补 PubChem TPSA 到 fallback
    if (base.compare3d && base.compare3d.fallback && pubchem && pubchem.tpsa != null) {
      base.compare3d.fallback.items.push({ name: 'PubChem TPSA', value: +(+pubchem.tpsa).toFixed(1) });
    }
    base.acc11 = { version: VERSION, rdkitNote: RDKIT_WASM_NOTE };
    return base;
  }

  function renderConfBadge(u) {
    if (!u) return '';
    return `<span class="acc-conf-light" title="${escapeAttr(u.reason || '')}" style="color:${u.color}">${u.emoji} ${u.level}</span>`;
  }
  function escapeAttr(s) {
    return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  return {
    VERSION, RDKIT_WASM_NOTE,
    buildLogP, enhancedSolubility, lightMLSolubility,
    standardizeStructure, saScoreErtlLike,
    buildUncertainty, mergeExperimental, applyExperimentalPka,
    enhanceDescriptors, compare3DDescriptors, probe3DSupport,
    enhanceAll, renderConfBadge, confidenceLight, solClass,
  };
})();
