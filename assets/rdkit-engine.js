/* RDKit WASM 引擎封装：本地优先，base64 内嵌次之，CDN 兜底。
   暴露 window.RDKitEngine.init() 与 .compute(smiles)
   背景：部分环境（file:// 协议、预览服务器按扩展名白名单）会拦截对 .wasm 的 fetch()。
   解法：把 wasm 以 base64 内嵌进 .js 文件（RDKit_minimal.wasm.b64.js），通过 Emscripten 的
   Module.wasmBinary 直接注入，完全绕开 fetch .wasm。 */
window.RDKitEngine = (function () {
  const LOCAL_URL = 'assets/rdkit/RDKit_minimal.js';
  const LOCAL_B64_URL = 'assets/rdkit/RDKit_minimal.wasm.b64.js';
  const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@rdkit/rdkit@2024.3.5-1.0.0/dist/';
  const CDN_URL = CDN_BASE + 'RDKit_minimal.js';

  let rdkit = null;
  let loadingPromise = null;
  let usedLocal = false;

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('script load failed: ' + url));
      document.head.appendChild(s);
    });
  }

  function b64ToUint8(b64) {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch (e) {
      throw new Error('base64 解码失败：' + e.message);
    }
  }

  async function init() {
    // 返回 window.RDKitEngine 包装对象（含 compute），而非原始 RDKit 模块
    if (rdkit) return window.RDKitEngine;
    if (loadingPromise) { await loadingPromise; return window.RDKitEngine; }

    loadingPromise = (async () => {
      // file:// 协议下浏览器会拦截 fetch() 读取本地 wasm
      const isFileProtocol = typeof location !== 'undefined' && location.protocol === 'file:';

      if (typeof window.initRDKitModule === 'function') {
        // 页面 <head> 的本地脚本已就绪
        usedLocal = !isFileProtocol;
      } else {
        // 1) 尝试本地动态加载
        try {
          await loadScript(LOCAL_URL);
          usedLocal = !isFileProtocol;
        } catch (e) {
          // 2) 回退 CDN JS
          await loadScript(CDN_URL);
          usedLocal = false;
        }
      }
      if (typeof window.initRDKitModule !== 'function') {
        throw new Error('RDKit JS 引擎加载失败（本地与 CDN 均不可用，请检查网络或 assets/rdkit 目录）。');
      }

      // wasm 二进制候选，按优先级：
      //   A) 本地文件 fetch（http/https 同源，最轻量）
      //   B) base64 内嵌（.js 内联，file:// 与预览服务器等任何环境都可用，真正离线）
      //   C) CDN fetch（联网兜底）
      const candidates = [];
      if (!isFileProtocol) candidates.push({ kind: 'fetch', dir: 'assets/rdkit/', label: 'local' });
      candidates.push({ kind: 'b64', label: 'embedded' });
      candidates.push({ kind: 'fetch', dir: CDN_BASE, label: 'cdn' });

      let lastErr = null;
      for (const c of candidates) {
        try {
          if (c.kind === 'fetch') {
            rdkit = await window.initRDKitModule({ locateFile: (f) => c.dir + f });
          } else {
            // 按需懒加载 base64 脚本（.js 在任何环境下都允许加载，无 8MB 常驻开销）
            if (typeof window.RDKIT_WASM_B64 !== 'string') {
              await loadScript(LOCAL_B64_URL);
            }
            if (typeof window.RDKIT_WASM_B64 !== 'string') throw new Error('base64 内嵌数据缺失');
            const bytes = b64ToUint8(window.RDKIT_WASM_B64);
            rdkit = await window.initRDKitModule({
              locateFile: (f) => 'assets/rdkit/' + f,
              wasmBinary: bytes,
            });
          }
          usedLocal = c.label === 'local' || c.label === 'embedded';
          window.RDKit = rdkit; // 暴露原始 RDKit 模块，供 SMILES 校验等使用
          return rdkit;
        } catch (e) {
          lastErr = e;
        }
      }
      throw new Error('RDKit WASM 加载失败：' + (lastErr && lastErr.message) + '。建议通过本地 http 服务器打开（python -m http.server），或允许联网使用 CDN 兜底。');
    })();
    loadingPromise.catch(() => {}); // 避免内部挂起/失败时出现未处理的 rejection 警告

    // v20250829u：为 init 增加超时上限。部分环境（预览服务器按扩展名白名单拦截 .wasm、
    // CDN 被代理拦截、或 Emscripten WASM 实例化卡死）会导致 initRDKitModule 永不 resolve，
    // 进而使整个预测流程（await RDKitEngine.init()）静默挂起。超时后清除挂起引用并抛出，
    // 由上层 runSingle 的 catch 渲染错误，而非无限转圈。
    const TIMEOUT = 20000;
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('RDKit 引擎加载超时（20s），请刷新页面或检查网络后重试。')), TIMEOUT));
    try {
      await Promise.race([loadingPromise, timeout]);
    } catch (e) {
      loadingPromise = null; // 允许后续预测重试重新加载
      throw e;
    }
    return window.RDKitEngine;
  }

  // 检测高活性/警示官能团（用于中间体稳定性与基因毒性提示）
  const GROUPS = [
    { key: 'acyl_chloride', name: '酰氯 (-COCl)', smarts: 'C(=O)Cl', severity: 'high', note: '高活性，遇水/醇剧烈反应，需严格无水操作。' },
    { key: 'sulfonyl_chloride', name: '磺酰氯 (-SO2Cl)', smarts: 'S(=O)(=O)Cl', severity: 'high', note: '高活性，遇水分解，注意淬灭与后处理。' },
    { key: 'anhydride', name: '酸酐', smarts: 'O=C(O)C(=O)', severity: 'high', note: '高活性，易水解，关注试剂纯度与储存。' },
    { key: 'epoxide', name: '环氧基', smarts: 'C1CO1', severity: 'high', note: '三元环张力大、易开环，具潜在基因毒性警示。' },
    { key: 'isocyanate', name: '异氰酸酯 (-N=C=O)', smarts: 'N=C=O', severity: 'high', note: '高毒性/致敏，强亲电，控制残留。' },
    { key: 'azide', name: '叠氮基 (-N3)', smarts: 'N=[N+]=[N-]', severity: 'high', note: '潜在爆炸性与基因毒性警示，需专项控制。' },
    { key: 'peroxide', name: '过氧键 (-O-O-)', smarts: 'OO', severity: 'high', note: '不稳定，潜在爆炸风险，避免富集。' },
    { key: 'boronic', name: '硼酸/硼酸酯', smarts: 'B(O)(O)', severity: 'medium', note: '易与二醇络合、易水解，关注纯化与晶型。' },
    { key: 'aldehyde', name: '醛基 (-CHO)', smarts: '[CH]=O', severity: 'medium', note: '易被氧化、与胺缩合，注意储存与副反应。' },
    { key: 'nitro', name: '硝基 (-NO2)', smarts: '[N+](=O)[O-]', severity: 'medium', note: '潜在基因毒性警示，需控制残留限度。' },
    { key: 'michael', name: 'Michael 受体', smarts: 'C=C[C](=O)[#6]', severity: 'medium', note: '亲电烯烃，潜在反应活性/毒性警示。' },
    { key: 'alkyl_halide', name: '烷基卤 (-CH2X)', smarts: '[CX4][Cl,Br,I]', severity: 'medium', note: '潜在基因毒性警示（卤代烷），关注致突变。' },
    { key: 'free_amine', name: '游离胺 (-NH2/-NHR)', smarts: '[NX3;H2,H1][#6]', severity: 'low', note: '碱性，易成盐，注意盐型与稳定性。' },
  ];

  function detectGroups(mol) {
    const found = [];
    for (const g of GROUPS) {
      try {
        const q = rdkit.get_qmol(g.smarts);
        const m = mol.get_substruct_matches(q);
        // 返回值为 JSON 字符串或数组，需先解析再判断长度
        const arr = (typeof m === 'string') ? JSON.parse(m) : m;
        if (arr && arr.length > 0) found.push(g);
      } catch (e) { /* 个别 SMARTS 不支持则跳过 */ }
    }
    return found;
  }

  // 可电离基团库（用于 pKa 估算 + pH 依赖溶解度）。
  // pka = 该基团电离常数的官能团经验值（非实验值）；
  // aromatic = 是否连于芳香环（参与取代基电子效应校正）；type = acid(去质子) / base(质子化)。
  const IONIZABLE = [
    // —— 酸性（去质子化）：pka 越低酸性越强 ——
    { key: 'carboxylic_aliphatic', name: '羧酸 (-COOH)', type: 'acid', pka: 4.2, smarts: '[#6;!c]C(=O)[OH]', aromatic: false },
    { key: 'carboxylic_aryl', name: '芳香羧酸 (Ar-COOH)', type: 'acid', pka: 4.2, smarts: 'cC(=O)[OH]', aromatic: true },
    { key: 'phenol', name: '酚羟基 (Ar-OH)', type: 'acid', pka: 10.0, smarts: 'c[OH]', aromatic: true },
    { key: 'sulfonamide_nh', name: '磺酰胺 N-H', type: 'acid', pka: 10.0, smarts: 'S(=O)(=O)N', aromatic: false },
    { key: 'thiol', name: '硫醇 (-SH)', type: 'acid', pka: 10.5, smarts: '[SH][#6]', aromatic: false },
    { key: 'thiophenol', name: '芳香硫酚 (Ar-SH)', type: 'acid', pka: 6.5, smarts: 'c[SH]', aromatic: true },
    { key: 'imide_nh', name: '酰亚胺 N-H', type: 'acid', pka: 9.5, smarts: 'O=C([#6])N([#6])C(=O)', aromatic: false },
    { key: 'hydroxamic_oh', name: '异羟肟酸 O-H', type: 'acid', pka: 9.0, smarts: 'C(=O)N[OH]', aromatic: false },
    // —— 碱性（质子化）：pka 为共轭酸 pKa，越高碱性越强 ——
    { key: 'amine_prim', name: '伯脂肪胺 (-NH2)', type: 'base', pka: 10.6, smarts: '[NX3;H2;!$(NC=O);!$(Nc)][#6]', aromatic: false },
    { key: 'amine_sec', name: '仲脂肪胺 (-NHR)', type: 'base', pka: 10.7, smarts: '[NX3;H1;!$(NC=O);!$(Nc)][#6]', aromatic: false },
    { key: 'amine_tert', name: '叔脂肪胺 (-NR2)', type: 'base', pka: 9.8, smarts: '[NX3;H0;!$(NC=O)]([#6])([#6])[#6]', aromatic: false },
    { key: 'aniline_prim', name: '苯胺 (-NH2, 芳胺)', type: 'base', pka: 4.6, smarts: 'c[NH2]', aromatic: true },
    { key: 'aniline_sec', name: 'N-烷基芳胺', type: 'base', pka: 4.9, smarts: 'c[NH]([#6])', aromatic: true },
    { key: 'pyridine', name: '吡啶/杂芳环 N（如吡啶）', type: 'base', pka: 5.2, smarts: '[n;r;!$([nH])]', aromatic: true },
    { key: 'imidazole', name: '咪唑 N（碱性）', type: 'base', pka: 7.0, smarts: 'c1c[nH]cn1', aromatic: true },
    { key: 'guanidine', name: '胍基', type: 'base', pka: 13.6, smarts: 'N[C](=N)N', aromatic: false },
    { key: 'amidine', name: '脒基', type: 'base', pka: 12.4, smarts: '[#6]C(=N)N', aromatic: false },
    { key: 'hydrazine', name: '肼 (-NHNH2)', type: 'base', pka: 8.0, smarts: 'N[N;!$(NC=O)]', aromatic: false },
  ];
  const ION_MAP = {};
  IONIZABLE.forEach(g => { ION_MAP[g.key] = g; });

  // 统计芳香环上的吸电子/给电子取代基数量（用于 pKa 电子效应校正）
  function aromaticSubstituentCounts(mol) {
    const cnt = (sm) => {
      try {
        const q = rdkit.get_qmol(sm);
        const m = mol.get_substruct_matches(q);
        const a = (typeof m === 'string') ? JSON.parse(m) : m;
        return (a && a.length) ? a.length : 0;
      } catch (e) { return 0; }
    };
    // 仅统计无歧义且不会与电离基团自身原子混淆的取代基：
    // 强吸电子（硝基/氰基/磺酰/三氟甲基）+ 弱吸电子（卤素）。
    // 不给电子项：醇/酯/氨基方向歧义大，且会与电离基团自身 N/O 自匹配导致误校正。
    return {
      strong: cnt('[N+](=O)[O-]') + cnt('C#N') + cnt('S(=O)(=O)') + cnt('C(F)(F)F'),
      weak: cnt('c[Cl,Br,I,F]'),
    };
  }
  // 对芳香环上的电离基团施加取代基电子效应校正（仅吸电子取代基降 pKa；给电子不校正以规避自匹配）
  function applyPkaCorrection(mol, groups) {
    const sub = aromaticSubstituentCounts(mol);
    return groups.map(g => {
      const def = ION_MAP[g.key];
      if (!def || !def.aromatic || sub.strong + sub.weak === 0) return g;
      const shift = (g.type === 'acid')
        ? -(1.2 * sub.strong + 0.4 * sub.weak)
        : -(2.2 * sub.strong + 0.9 * sub.weak);
      const capped = Math.max(-5, Math.min(1.5, shift));
      return Object.assign({}, g, { pka: +(g.pka + capped).toFixed(2), corrected: Math.abs(capped) > 0.05 });
    });
  }
  function buildPka(groups) {
    // 咪唑的碱性 N 同时被 pyridine 规则命中（两者 SMARTS 都匹配），需扣除避免重复计数
    const imidRings = groups
      .filter(g => g.key.indexOf('imidazole') === 0)
      .reduce((s, g) => s + (g.count || 0), 0);
    const py = groups.find(g => g.key === 'pyridine');
    if (py && imidRings > 0) py.count = Math.max(0, (py.count || 0) - imidRings);
    // 剔除计数为 0 的基团，避免渲染空行
    const active = groups.filter(g => (g.count || 0) > 0);
    const acids = active.filter(g => g.type === 'acid')
      .map(g => ({ key: g.key, name: g.name, type: g.type, pka: g.pka, count: g.count, corrected: !!g.corrected }))
      .sort((a, b) => a.pka - b.pka);
    const bases = active.filter(g => g.type === 'base')
      .map(g => ({ key: g.key, name: g.name, type: g.type, pka: g.pka, count: g.count, corrected: !!g.corrected }))
      .sort((a, b) => b.pka - a.pka);
    return { hasIonizable: active.length > 0, groups: active, acids, bases };
  }

  // 常用 PAINS / Brenk 警示子集（非完整过滤库，仅覆盖高频结构警示）
  const PAINS = [
    { key: 'hydrazine', name: '肼 / 酰肼', smarts: 'N[N]' },
    { key: 'azo', name: '偶氮 (-N=N-)', smarts: '[#6]N=N[#6]' },
    { key: 'beta_dicarbonyl', name: '1,3-二羰基（可烯醇化）', smarts: 'O=C([#6])C(=O)[#6]' },
    { key: 'aniline', name: '苯胺（芳胺）', smarts: 'c[NH2]' },
    { key: 'thiol', name: '巯基 (-SH)', smarts: '[SH]' },
    { key: 'quinone', name: '醌式结构', smarts: 'O=C1C=CC(=O)C=C1' },
    { key: 'hydroxamic', name: '异羟肟酸', smarts: 'C(=O)N[OH]' },
  ];
  const BRENK = [
    { key: 'cyclopropane', name: '环丙烷（小环张力）', smarts: 'C1CC1' },
    { key: 'phosphonate', name: '膦酸/磷酸酯', smarts: 'P(=O)(O)(O)' },
    { key: 'enamine', name: '烯胺', smarts: 'C=C[N]' },
    { key: 'hemiacetal', name: '半缩醛/缩醛', smarts: 'O[C;H1,H2][O]' },
  ];

  function detectSMARTS(mol, list) {
    const found = [];
    for (const g of list) {
      try {
        const q = rdkit.get_qmol(g.smarts);
        const m = mol.get_substruct_matches(q);
        const arr = (typeof m === 'string') ? JSON.parse(m) : m;
        if (arr && arr.length > 0) {
          const item = { key: g.key, name: g.name, count: arr.length };
          if (g.type) item.type = g.type;
          if (g.pka != null) item.pka = g.pka;
          found.push(item);
        }
      } catch (e) { /* 个别 SMARTS 不支持则跳过 */ }
    }
    return found;
  }

  // ---------- 毒性 / 基因毒性结构警示库（SMARTS 子集） ----------
  // 按 ICH M7（基因毒性杂质）框架归类常见警示结构：
  //   genotoxic   基因毒性（烷化/致突变/致癌关注）
  //   herg        心脏 hERG 毒性（经验粗筛，特异性低）
  //   sensitization 皮肤致敏（hapten）
  //   cyp         CYP 代谢 / 抑制相关（肝毒性/反应代谢物粗筛）
  // 同一结构可归属多个类别（cats 数组），统计按 key 去重；severity: high/medium/low。
  const ALERTS = [
    // —— 基因毒性（ICH M7 重点关注）——
    { key: 'n_nitrosamine', name: 'N-亚硝胺', smarts: '[#7][N+](=O)[O-]', cats: ['genotoxic'], severity: 'high',
      note: 'ICH M7「特别关注队列」，强致癌物，需严格控制残留限度（如 NDMA 类）。' },
    { key: 'aziridine', name: '氮丙啶（环张力胺）', smarts: 'N1CC1', cats: ['genotoxic', 'sensitization'], severity: 'high',
      note: '三元环胺，高反应活性，潜在基因毒性烷化剂。' },
    { key: 'epoxide', name: '环氧基', smarts: 'C1CO1', cats: ['genotoxic', 'sensitization'], severity: 'high',
      note: '三元环醚，易开环发生烷化，潜在基因毒性警示。' },
    { key: 'alkyl_halide', name: '烷基卤（-CH2X）', smarts: '[#6X4][Cl,Br,I]', cats: ['genotoxic'], severity: 'medium',
      note: '亲电卤代烷，潜在基因毒性（烷化）警示。' },
    { key: 'aromatic_amine', name: '芳胺（Ar-NH2）', smarts: 'c[NH2]', cats: ['genotoxic', 'cyp'], severity: 'medium',
      note: '芳香胺可经 CYP 代谢为 N-羟基/活性中间体，潜在致突变/致癌警示。' },
    { key: 'hydrazine', name: '肼 / 酰肼', smarts: 'N[N;!$(NC=O)]', cats: ['genotoxic'], severity: 'high',
      note: '肼类强基因毒性警示（如异烟肼类结构）。' },
    { key: 'diazo', name: '重氮基（-N2）', smarts: '[#6]=[N+]#[N-]', cats: ['genotoxic'], severity: 'high',
      note: '重氮化合物高反应活性，潜在基因毒性警示。' },
    { key: 'sulfonate_ester', name: '磺酸酯（烷化剂）', smarts: '[#6][O,S](=O)(=O)[#6]', cats: ['genotoxic'], severity: 'high',
      note: '磺酸酯/硫酸酯为强烷化剂（ICH M7 高关注，如甲磺酸乙酯类基因毒性杂质）。' },
    { key: 'acyl_halide', name: '酰卤（-COX）', smarts: 'C(=O)[Cl,Br,I]', cats: ['genotoxic', 'sensitization'], severity: 'high',
      note: '高活性酰化剂，亲电反应性强。' },
    { key: 'michael', name: 'Michael 受体', smarts: 'C=C[C](=O)[#6]', cats: ['genotoxic', 'sensitization'], severity: 'medium',
      note: '亲电烯烃，可与亲核基团加成，潜在反应活性/毒性。' },
    { key: 'nitro_aryl', name: '芳香硝基（-NO2）', smarts: 'c[N+](=O)[O-]', cats: ['genotoxic', 'cyp'], severity: 'medium',
      note: '芳香硝基可还原为芳胺/羟胺，潜在基因毒性警示。' },
    // —— 皮肤致敏（hapten）——
    { key: 'isocyanate', name: '异氰酸酯（-N=C=O）', smarts: 'N=C=O', cats: ['sensitization'], severity: 'high',
      note: '高毒/致敏，强亲电。' },
    { key: 'anhydride', name: '酸酐', smarts: 'O=C(O)C(=O)', cats: ['sensitization'], severity: 'medium',
      note: '酰化剂，潜在致敏。' },
    { key: 'sulfonyl_chloride', name: '磺酰氯', smarts: 'S(=O)(=O)Cl', cats: ['sensitization'], severity: 'high',
      note: '高活性磺化/酰化剂。' },
    { key: 'aldehyde', name: '醛基（-CHO）', smarts: '[CH]=O', cats: ['sensitization', 'cyp'], severity: 'medium',
      note: '可与亲核基团反应，注意致敏与代谢。' },
    // —— hERG 心脏毒性（经验粗筛，特异性低）——
    { key: 'basic_amine', name: '碱性氮（叔/仲胺）', smarts: '[#7X3;!$(NC=O);!$(N[a])]([#6])([#6])[#6]', cats: ['herg'], severity: 'low',
      note: '碱性含氮基团为 hERG 潜在关注（粗筛，特异性低，需以实验 hERG 测定为准）。' },
    { key: 'heteroaromatic_n', name: '含氮杂芳环', smarts: '[n;r;!$([nH])]', cats: ['herg', 'cyp'], severity: 'low',
      note: '含氮杂环与 hERG / CYP 潜在相关（粗筛）。' },
    // —— CYP 代谢 / 抑制（粗筛）——
    { key: 'furan', name: '呋喃环', smarts: 'o1cccc1', cats: ['cyp'], severity: 'medium',
      note: '呋喃环易代谢为反应性中间体，CYP 相关肝毒性警示。' },
    { key: 'thiophene', name: '噻吩环', smarts: 'c1ccsc1', cats: ['cyp'], severity: 'medium',
      note: '噻吩可经 CYP 代谢，潜在肝毒性/反应代谢物警示。' },
    { key: 'imidazole', name: '咪唑环', smarts: 'c1c[nH]cn1', cats: ['cyp'], severity: 'low',
      note: '咪唑为常见 CYP 抑制/代谢位点（如抗真菌唑类）。' },
  ];
  // 由 molblock 推导涉及高亮原子的键索引（用于子结构高亮渲染）
  function highlightBonds(mol, atomSet) {
    try {
      const lines = mol.get_molblock().split('\n');
      const counts = (lines[3] || '0 0').trim().split(/\s+/).map(Number);
      const nAtoms = counts[0] || 0, nBonds = counts[1] || 0;
      const bonds = [];
      for (let i = 0; i < nBonds; i++) {
        const t = (lines[4 + nAtoms + i] || '').trim().split(/\s+/);
        const a = parseInt(t[0], 10) - 1, b = parseInt(t[1], 10) - 1;
        if (atomSet.has(a) && atomSet.has(b)) bonds.push(i);
      }
      return bonds;
    } catch (e) { return []; }
  }

  function detectAlerts(mol) {
    const found = [];
    for (const a of ALERTS) {
      try {
        const q = rdkit.get_qmol(a.smarts);
        const m = mol.get_substruct_matches(q);
        const matches = (typeof m === 'string') ? JSON.parse(m) : m;
        if (matches && matches.length > 0) {
          const atomSet = new Set();
          matches.forEach(mm => { if (Array.isArray(mm)) mm.forEach(idx => atomSet.add(idx)); });
          const atoms = Array.from(atomSet);
          found.push(Object.assign({}, a, { count: matches.length, atoms, bonds: highlightBonds(mol, atomSet) }));
        }
      } catch (e) { /* 个别 SMARTS 不支持则跳过 */ }
    }
    return found;
  }

  // 由 molblock 推导分子式（Hill 序：C、H，其余按字母序）
  // 说明：该最小 WASM 构建无 get_molformula/add_hs；molblock 只含重原子，
  // 氢总数由描述符 NumAtoms − NumHeavyAtoms 得到（RDKit 隐式氢计数，离线可用）。
  function formatHill(counts) {
    const order = [];
    if (counts.C) order.push('C');
    if (counts.H) order.push('H');
    Object.keys(counts).filter(e => e !== 'C' && e !== 'H').sort().forEach(e => order.push(e));
    return order.map(e => e + (counts[e] > 1 ? counts[e] : '')).join('');
  }
  function getFormula(mol, desc) {
    try {
      const lines = mol.get_molblock().split('\n');
      const nHeavy = (desc && desc.NumHeavyAtoms != null) ? desc.NumHeavyAtoms
        : (parseInt((lines[3] || '0').trim().split(/\s+/)[0], 10) || 0);
      const counts = {};
      for (let i = 0; i < nHeavy; i++) {
        const t = (lines[4 + i] || '').trim().split(/\s+/);
        const sym = t[3];
        if (!sym || !/^[A-Z][a-z]?$/.test(sym)) continue; // 仅接受合法元素符号，避免 molblock 异常行污染分子式
        counts[sym] = (counts[sym] || 0) + 1;
      }
      const total = (desc && desc.NumAtoms != null) ? desc.NumAtoms : null;
      if (total != null) {
        const h = total - Object.values(counts).reduce((s, v) => s + v, 0);
        if (h > 0) counts['H'] = h;
      }
      return formatHill(counts);
    } catch (e) { return ''; }
  }

  // ---------- 几何与键参数估算（键长 / 键能 / 键角） ----------
  // 共价单键半径（Å），用于未收录键长的兜底估算
  const COV_R = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, F: 0.57, P: 1.07, S: 1.05, Cl: 1.02, Br: 1.20, I: 1.39, Si: 1.11, B: 0.85, Na: 1.66, K: 2.03, Mg: 1.41, Ca: 1.76, Fe: 1.32, Zn: 1.22 };
  // 常见键的参考键长（Å），优先使用；缺失时由共价半径推算
  const BONDLEN = {
    'C-C|1': 1.54, 'C-C|2': 1.34, 'C-C|3': 1.20,
    'C-H|1': 1.09,
    'C-N|1': 1.47, 'C-N|2': 1.29, 'C-N|3': 1.16,
    'C-O|1': 1.43, 'C-O|2': 1.23,
    'C-F|1': 1.35, 'C-Cl|1': 1.77, 'C-Br|1': 1.94, 'C-I|1': 2.14,
    'C-S|1': 1.81, 'C-P|1': 1.84, 'C-Si|1': 1.87,
    'N-N|1': 1.45, 'N-N|2': 1.25, 'N-N|3': 1.10,
    'N-O|1': 1.40, 'N-O|2': 1.21,
    'O-O|1': 1.48, 'O-O|2': 1.21,
    'O-H|1': 0.96, 'N-H|1': 1.01, 'S-H|1': 1.34,
    'Si-O|1': 1.63, 'P-O|1': 1.56,
  };
  // 常见键的平均键解离能 BDE（kJ/mol），用于键能近似；缺失标为 null（见说明）
  const BDE = {
    'C-C|1': 348, 'C-C|2': 614, 'C-C|3': 839,
    'C-H|1': 413,
    'C-N|1': 305, 'C-N|2': 615, 'C-N|3': 891,
    'C-O|1': 358, 'C-O|2': 745,
    'C-F|1': 485, 'C-Cl|1': 328, 'C-Br|1': 276, 'C-I|1': 240,
    'C-S|1': 259, 'C-P|1': 264, 'C-Si|1': 318,
    'H-H|1': 436, 'H-N|1': 391, 'H-O|1': 463, 'H-F|1': 567, 'H-Cl|1': 431, 'H-Br|1': 366, 'H-I|1': 299,
    'N-N|1': 163, 'N-N|2': 418, 'N-N|3': 945,
    'N-O|1': 201, 'N-O|2': 607,
    'O-O|1': 146, 'O-O|2': 498,
    'S-H|1': 364, 'S-S|1': 266, 'S-O|1': 522, 'P-O|1': 544, 'Si-O|1': 466,
  };
  function covLen(ei, ej, order) {
    const ri = COV_R[ei] || 0.7, rj = COV_R[ej] || 0.7;
    const base = ri + rj;
    const adj = (order - 1) * 0.09 * Math.min(ri, rj); // 多键略缩短
    return +(base - adj).toFixed(2);
  }
  function angle3(a, b, c) {
    const v1 = [a.x - b.x, a.y - b.y, a.z - b.z];
    const v2 = [c.x - b.x, c.y - b.y, c.z - b.z];
    const m1 = Math.hypot(v1[0], v1[1], v1[2]);
    const m2 = Math.hypot(v2[0], v2[1], v2[2]);
    if (m1 === 0 || m2 === 0) return null;
    let cos = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (m1 * m2);
    cos = Math.max(-1, Math.min(1, cos));
    return Math.acos(cos) * 180 / Math.PI;
  }

  function computeGeometry(smiles) {
    if (!rdkit) throw new Error('RDKit 引擎尚未初始化');
    const mol = rdkit.get_mol(smiles);
    if (!mol) throw new Error('RDKit 无法解析该结构，请检查 SMILES/结构是否正确。');
    let mb;
    try { mb = mol.get_molblock(); } catch (e) { if (typeof mol.delete === 'function') mol.delete(); throw e; }
    try {
      const lines = mb.split('\n');
      const counts = (lines[3] || '0 0').trim().split(/\s+/).map(Number);
      const nAtoms = counts[0] || 0, nBonds = counts[1] || 0;
      const atoms = [];
      for (let i = 0; i < nAtoms; i++) {
        const t = (lines[4 + i] || '').trim().split(/\s+/);
        atoms.push({ idx: i, x: parseFloat(t[0]), y: parseFloat(t[1]), z: parseFloat(t[2]), sym: t[3] || 'C' });
      }
      const bonds = [];
      for (let i = 0; i < nBonds; i++) {
        const t = (lines[4 + nAtoms + i] || '').trim().split(/\s+/);
        const a = parseInt(t[0], 10) - 1, b = parseInt(t[1], 10) - 1, order = parseInt(t[2], 10) || 1;
        if (a >= 0 && b >= 0) bonds.push({ i: a, j: b, order: order });
      }
      const nbr = atoms.map(() => []);
      bonds.forEach(bd => { nbr[bd.i].push(bd.j); nbr[bd.j].push(bd.i); });

      // 每原子杂化与理想键角估计（依据配位原子数）
      const atomInfo = atoms.map((at, idx) => {
        const n = nbr[idx].length;
        let hyb = '—', ideal = null;
        if (n >= 4) { hyb = 'sp³'; ideal = 109.5; }
        else if (n === 3) { hyb = 'sp²'; ideal = 120; }
        else if (n === 2) { hyb = 'sp'; ideal = 180; }
        else if (n === 1) { hyb = '端基'; ideal = null; }
        return { idx, sym: at.sym, hyb, ideal };
      });

      // 键长 / 键能
      const bondRows = bonds.map(bd => {
        const ei = atoms[bd.i].sym, ej = atoms[bd.j].sym;
        const pair = [ei, ej].sort().join('-');
        const key = pair + '|' + bd.order;
        const len = BONDLEN[key] != null ? BONDLEN[key] : covLen(ei, ej, bd.order);
        const en = BDE[key] != null ? BDE[key] : null;
        const ot = bd.order === 1 ? '单键' : bd.order === 2 ? '双键' : bd.order === 3 ? '三键' : (bd.order === 1.5 ? '芳香键' : '键');
        return { i: bd.i, j: bd.j, ei, ej, order: bd.order, orderText: ot, len, en };
      });

      // 键角（由 molblock 坐标计算；2D 时为绘图构型角，仅作参考）
      const has3D = atoms.some(a => Math.abs(a.z) > 0.01);
      const angles = [];
      for (let c = 0; c < atoms.length; c++) {
        const nb = nbr[c];
        if (nb.length < 2) continue;
        for (let p = 0; p < nb.length; p++) {
          for (let q = p + 1; q < nb.length; q++) {
            const deg = angle3(atoms[nb[p]], atoms[c], atoms[nb[q]]);
            if (deg == null) continue;
            angles.push({ center: c, a: nb[p], d: nb[q], deg: +deg.toFixed(1) });
          }
        }
      }

      return {
        nAtoms, nBonds, has3D,
        atoms: atomInfo,
        bonds: bondRows,
        angles: angles.slice(0, 80),
      };
    } finally {
      if (typeof mol.delete === 'function') mol.delete();
    }
  }

  // ---------- 3D 构象生成（力场优化）与高亮结构图 ----------
  // 解析 molblock 为原子/键（保留 z 坐标，用于 3D 查看）
  function parseMolblock3D(mb) {
    const lines = mb.split('\n');
    // molblock 的 counts 行通常是第 4 行（0-indexed 3），但 header 可能含数字；
    // 先尝试标准位置，若无效则按“前两个字段均为正整数”搜索。
    function readCounts(idx) {
      const c = (lines[idx] || '0 0').trim().split(/\s+/).map(Number);
      return (c[0] > 0 && c[1] >= 0 && Number.isFinite(c[0]) && Number.isFinite(c[1])) ? { nAtoms: c[0], nBonds: c[1], idx } : null;
    }
    let cc = readCounts(3);
    if (!cc) {
      for (let i = 0; i < lines.length; i++) {
        const t = readCounts(i);
        if (t) { cc = t; break; }
      }
    }
    if (!cc) return { atoms: [], bonds: [], has3D: false };
    const { nAtoms, nBonds, idx: base } = cc;
    const atoms = [];
    for (let i = 0; i < nAtoms; i++) {
      const t = (lines[base + 1 + i] || '').trim().split(/\s+/);
      atoms.push({ idx: i, x: parseFloat(t[0]), y: parseFloat(t[1]), z: parseFloat(t[2]), sym: (t[3] || 'C').replace(/[^A-Za-z]/g, '') });
    }
    const bonds = [];
    for (let i = 0; i < nBonds; i++) {
      const t = (lines[base + 1 + nAtoms + i] || '').trim().split(/\s+/);
      const a = parseInt(t[0], 10) - 1, b = parseInt(t[1], 10) - 1;
      let o = parseInt(t[2], 10) || 1;
      const order = o === 4 ? 1.5 : (o === 2 ? 2 : (o === 3 ? 3 : 1));
      if (a >= 0 && b >= 0) bonds.push({ i: a, j: b, order });
    }
    const has3D = atoms.some(a => Math.abs(a.z) > 0.01);
    return { atoms, bonds, has3D };
  }

  // 简单环检测：DFS 寻找长度 3-10 的简单环，返回每个环的原子索引数组
  function findRings(atoms, bonds, maxSize) {
    maxSize = maxSize || 10;
    const n = atoms.length;
    const adj = atoms.map(() => []);
    bonds.forEach(b => {
      if (b.i >= 0 && b.i < n && b.j >= 0 && b.j < n) {
        adj[b.i].push(b.j);
        adj[b.j].push(b.i);
      }
    });
    const rings = [];
    const seen = new Set();
    function dfs(start) {
      const path = [start];
      const visited = new Set([start]);
      function go(u) {
        for (const v of adj[u]) {
          if (v === start && path.length >= 3 && path.length <= maxSize) {
            const key = path.slice().sort((a, b) => a - b).join(',');
            if (!seen.has(key)) {
              seen.add(key);
              rings.push(path.slice());
            }
            continue;
          }
          if (visited.has(v)) continue;
          if (path.length >= maxSize) continue;
          path.push(v);
          visited.add(v);
          go(v);
          path.pop();
          visited.delete(v);
        }
      }
      go(start);
    }
    for (let i = 0; i < n; i++) dfs(i);
    return rings;
  }

  // 基于 RDKit 2D molblock 生成伪 3D 构象：保留 2D (x,y) 作为投影，
  // 对非环原子按可重复哈希加小幅度 z 扰动，形成可旋转的 3D 深度感；
  // 环原子保持 z≈0 以体现平面性。化学精度不及力场，但永远可用、
  // 比纯 2D 平铺更具立体感。
  function generatePseudo3D(mol) {
    try {
      const mb = mol.get_molblock();
      const p = parseMolblock3D(mb);
      if (!p || !p.atoms || !p.atoms.length) return null;
      const rings = findRings(p.atoms, p.bonds);
      const ringAtoms = new Set();
      rings.forEach(r => r.forEach(i => ringAtoms.add(i)));
      const atoms = p.atoms.map((a, i) => {
        let z = 0;
        if (!ringAtoms.has(i)) {
          // 确定性伪随机：sin 哈希，结果在 [-0.75, 0.75] 之间
          const h = Math.sin(i * 12.9898 + a.x * 78.233 + a.y * 43.123) * 43758.5453;
          const r = h - Math.floor(h);
          z = (r - 0.5) * 1.5;
          if (a.sym === 'H') z *= 0.35;
        }
        return { idx: a.idx, x: a.x, y: a.y, z: z, sym: a.sym };
      });
      return {
        ok: true,
        has3D: false,
        atoms,
        bonds: p.bonds,
        note: '基于 RDKit 2D 坐标生成的伪 3D 投影（非真实力场构象），用于观察分子大致空间排布。'
      };
    } catch (e) {
      return null;
    }
  }

  // 生成 3D 构象：RDKit EmbedMolecule + MMFF/UFF 力场优化；失败则回退伪 3D 投影。
  function compute3D(smiles) {
    if (!rdkit) throw new Error('RDKit 引擎尚未初始化');
    let m0 = rdkit.get_mol(smiles);
    if (!m0) return { ok: false, note: 'RDKit 无法解析该结构。' };
    let work = m0, note = '';
    let res = null;
    try {
      // AddHs 成功返回新实例时才切换 work，并释放旧 m0；否则直接用 m0
      if (typeof m0.AddHs === 'function') {
        const m1 = m0.AddHs();
        if (m1 && m1 !== m0) {
          work = m1;
          if (typeof m0.delete === 'function') m0.delete();
        }
      }
      if (typeof work.EmbedMolecule === 'function') {
        work.EmbedMolecule(1);
        if (typeof work.MMFFOptimizeMolecule === 'function') work.MMFFOptimizeMolecule();
        else if (typeof work.UFFOptimizeMolecule === 'function') work.UFFOptimizeMolecule();
      }
      const mb = work.get_molblock();
      const p = parseMolblock3D(mb);
      if (p.has3D) {
        res = { ok: true, has3D: true, atoms: p.atoms, bonds: p.bonds };
        note = '基于 RDKit 力场优化（MMFF/UFF）生成的单一 3D 构象；真实分子存在多种构象异构体，此处仅为一种近似。';
      } else {
        // 力场不可用或只得到 2D：改用伪 3D，让查看器始终有立体感
        const pseudo = generatePseudo3D(work);
        if (pseudo && pseudo.atoms && pseudo.atoms.length) {
          res = pseudo;
          note = pseudo.note;
        } else {
          res = { ok: true, has3D: false, atoms: p.atoms, bonds: p.bonds };
          note = '未能生成 3D 构象（力场嵌入不可用），已用 2D 坐标平铺显示（非真实三维）。';
        }
      }
    } catch (e3) {
      // 真实 3D 失败：尝试用伪 3D 兜底，避免“无可用构象数据”
      let pseudo = null;
      try { pseudo = generatePseudo3D(rdkit.get_mol(smiles)); } catch (e) {}
      if (pseudo && pseudo.atoms && pseudo.atoms.length) {
        res = pseudo;
        note = pseudo.note;
      } else {
        try {
          const mb2 = rdkit.get_mol(smiles).get_molblock();
          const p2 = parseMolblock3D(mb2);
          res = { ok: true, has3D: false, atoms: p2.atoms, bonds: p2.bonds };
          note = '3D 构象生成不可用，已用 2D 坐标平铺显示（非真实三维）。';
        } catch (e2) {
          res = { ok: false, note: '3D 构象不可用：' + (e3 && e3.message ? e3.message : e3) };
        }
      }
    } finally {
      // 对 minimal RDKit 重复 delete 可能抛"already deleted"，吞掉异常避免覆盖返回值
      if (work && typeof work.delete === 'function') {
        try { work.delete(); } catch (_) {}
      }
    }
    if (res) res.note = note;
    return res;
  }

  // 生成带子结构高亮的 2D SVG（用于警示结构点击高亮）
  // color: 可选 RGB 数组 [r,g,b]（0~1），用于按警示等级配色；缺省红色。
  function highlightStructure(smiles, atoms, bonds, color) {
    if (!rdkit) throw new Error('RDKit 引擎尚未初始化');
    const mol = rdkit.get_mol(smiles);
    if (!mol) throw new Error('RDKit 无法解析该结构。');
    const c = (color && color.length === 3) ? color : [1.0, 0.22, 0.22];
    let svg;
    try {
      if (typeof mol.get_svg_with_highlights === 'function' && atoms && atoms.length) {
        const aColors = {}, bColors = {};
        atoms.forEach(a => { aColors[a] = c; });
        bonds.forEach(b => { bColors[b] = c; });
        svg = mol.get_svg_with_highlights(atoms, bonds, aColors, bColors, '');
      } else {
        svg = mol.get_svg(440, 330);
      }
    } finally {
      if (typeof mol.delete === 'function') mol.delete();
    }
    return svg;
  }

  // ---------- 盐型 / 互变异构提示 ----------
  // 通过 SMILES 多组分（含 '.'）与无机抗衡离子 SMARTS 判断盐型；
  // 通过常见互变异构敏感基团 SMARTS 给出提示（经验粗筛，非枚举）。
  const COUNTERIONS = [
    { sm: '[Na+]', name: 'Na⁺（钠离子）' },
    { sm: '[K+]', name: 'K⁺（钾离子）' },
    { sm: '[Li+]', name: 'Li⁺（锂离子）' },
    { sm: '[Ca+2]', name: 'Ca²⁺（钙离子）' },
    { sm: '[Mg+2]', name: 'Mg²⁺（镁离子）' },
    { sm: '[Zn+2]', name: 'Zn²⁺（锌离子）' },
    { sm: '[Cl-]', name: 'Cl⁻（氯离子）' },
    { sm: '[Br-]', name: 'Br⁻（溴离子）' },
    { sm: '[I-]', name: 'I⁻（碘离子）' },
    { sm: '[F-]', name: 'F⁻（氟离子）' },
    { sm: 'O=S(=O)([O-])[O-]', name: '硫酸根' },
    { sm: 'O=P([O-])([O-])[O-]', name: '磷酸根' },
    { sm: 'CC(=O)[O-]', name: '乙酸根' },
    { sm: 'C(F)(F)(F)C(=O)[O-]', name: '三氟乙酸根' },
    { sm: 'OS(=O)(=O)[O-]', name: '甲磺酸根' },
  ];
  // 互变异构敏感位点库（经验粗筛，覆盖更多类；非完整枚举）：
  // 每项为「一类可被互变异构影响的官能团/位点」，命中即提示该分子可能参与对应互变。
  const TAUT_SITES = [
    { key: 'amide', name: '酰胺 / 脲 / 硫酰胺', smarts: 'C(=O)N', note: 'N–C=O 与 C(OH)=N 互变（酰胺-亚胺酸式）；影响 H 键、pKa 与溶解度。' },
    { key: 'enol', name: '烯醇 / 酮-烯醇', smarts: 'O=C([#6])[C;!$(C=O)]', note: 'α-H 可被夺取形成烯醇式，常见于 1,3-二羰基（如巴比妥、非甾体抗炎药）。' },
    { key: 'imine', name: '亚胺 / 烯胺', smarts: '[#6]=N[#6]', note: 'C=N 与 C–N=C 互变（环状亚胺/烯胺常见）。' },
    { key: 'hetNH', name: '杂芳环 NH（咪唑/吡唑/三唑/嘌呤/吲哚等）', smarts: '[nH]', note: '环内 NH 存在 1H/3H 等互变异构位点（如咪唑、嘌呤碱基）。' },
    { key: 'lactam', name: '内酰胺 / 内酰亚胺', smarts: 'O=C1NCC', note: '环酰胺可互变为内酰亚胺式（如邻苯二甲酰亚胺类）。' },
    { key: 'nitro', name: '硝基-酸式 (aci)', smarts: 'C[N+](=O)[O-]', note: '硝基化合物存在酸式 (aci) 互变异构（C–N=O ⇌ C=N–OH）。' },
    { key: 'pyridone', name: '吡啶酮 / 2(4)-吡啶酮', smarts: 'O=c1cc[nH]cc1', note: '内酰胺-内酰亚胺式与芳香吡啶式互变（如 2-吡啶酮、烟酰胺内酯）。' },
    { key: 'barbituric', name: '巴比妥酸 / 海因类（环酰脲）', smarts: 'O=C1NC(=O)NC(=O)1', note: '环酰脲存在多个可互变异构的 NH/C=O 位点（巴比妥、乙内酰脲）。' },
    { key: 'guanidine', name: '胍 / 脒（amidino）', smarts: 'NC(N)=N', note: '脒/胍存在多中心质子共振互变（如阿胍类、二甲双胍骨架）。' },
    { key: 'thioamide', name: '硫酰胺（硫酮 ⇌ 硫醇）', smarts: 'C(=S)N', note: '硫酰胺存在硫酮-硫醇 (thione-thiol) 互变异构，影响反应性与配位。' },
    { key: 'oxime', name: '肟（syn/anti 及互变）', smarts: 'C=N[OH]', note: '肟存在 syn/anti 几何异构及 C=N–OH 互变（如醛/酮肟）。' },
    { key: 'enamine2', name: '烯胺 / 亚胺-烯胺', smarts: 'C=C[N;!$(NC=O)]', note: '烯胺与亚胺互变（如曼尼希碱、β-氨基烯酮）。' },
    { key: 'lactol', name: '半缩醛 / 内酯醇（环内外互变）', smarts: 'O[C;H1,H2][O]', note: '环状半缩醛可与开链羰基式互变（如糖的吡喃/呋喃环、糖苷前体）。' },
    { key: 'thiourea', name: '硫脲（硫酮 ⇌ 硫醇）', smarts: 'NC(=S)N', note: '硫脲存在硫酮-硫醇互变异构（如硫唑类、硫脲嘧啶）。' },
    { key: 'phosphoramide', name: '磷酰胺 / 磷酰胺互变', smarts: 'P(=O)(N)(N)', note: 'P(=O)(NH) 位点可能存在 NH 互变异构与手性轴/面（如磷酰胺类手性配体）。' },
  ];
  function analyzeForm(smiles) {
    if (!rdkit) throw new Error('RDKit 引擎尚未初始化');
    const mol = rdkit.get_mol(smiles);
    if (!mol) return { ok: false, isSalt: false, counterions: [], tautomers: [], note: '结构解析失败。' };
    const out = { ok: true, isSalt: false, components: 1, counterions: [], tautomers: [] };
    try {
      const dotCount = (smiles.match(/\./g) || []).length;
      out.components = dotCount + 1;
      if (out.components > 1) out.isSalt = true;
      for (const ci of COUNTERIONS) {
        try {
          const q = rdkit.get_qmol(ci.sm);
          const m = mol.get_substruct_matches(q);
          const arr = (typeof m === 'string') ? JSON.parse(m) : m;
          if (arr && arr.length > 0) { out.counterions.push({ name: ci.name, count: arr.length }); out.isSalt = true; }
        } catch (e) {}
      }
      for (const t of TAUT_SITES) {
        try {
          const q = rdkit.get_qmol(t.smarts);
          const m = mol.get_substruct_matches(q);
          const arr = (typeof m === 'string') ? JSON.parse(m) : m;
          if (arr && arr.length > 0) out.tautomers.push({ name: t.name, count: arr.length, note: t.note });
        } catch (e) {}
      }
    } finally {
      if (typeof mol.delete === 'function') mol.delete();
    }
    out.note = out.isSalt
      ? '该结构可能含盐型 / 成盐形式（含抗衡离子或共晶组分）。盐型会改变表观分子量、logP、溶解度与 pKa；建议同时以<b>游离碱 / 游离酸（游离 API）</b>评估真实理化性质，并注意登记号与结构应区分盐与游离态。'
      : '未检出典型盐型 / 成盐特征（单一中性组分）。如为已知盐，请确认输入的是否为游离 API。';
    out.tautomerNote = '已基于 <b>' + TAUT_SITES.length + ' 类</b>互变异构敏感位点 SMARTS 做经验提示（非完整枚举）。互变异构影响 pKa、logP、溶解度与 H 键模式，主互变异构体建议以实验 / 数据库（PubChem、ChEMBL）确认。';
    out.tautomerCount = TAUT_SITES.length;
    return out;
  }

  // 通用子结构计数（供外部工具：NMR 环境估算、基团统计等）
  function countSMARTS(smiles, smarts) {
    if (!rdkit) throw new Error('RDKit 引擎尚未初始化');
    const mol = rdkit.get_mol(smiles);
    if (!mol) return 0;
    try {
      const q = rdkit.get_qmol(smarts);
      const m = mol.get_substruct_matches(q);
      const arr = (typeof m === 'string') ? JSON.parse(m) : m;
      return (arr && arr.length) ? arr.length : 0;
    } catch (e) { return 0; }
    finally { if (typeof mol.delete === 'function') mol.delete(); }
  }

  function compute(smiles) {
    if (!rdkit) throw new Error('RDKit 引擎尚未初始化');
    const mol = rdkit.get_mol(smiles);
    if (!mol) throw new Error('RDKit 无法解析该结构，请检查 SMILES/结构是否正确。');
    let desc;
    const raw = mol.get_descriptors();
    try {
      // 必须深拷贝：RDKit（Emscripten 绑定）的 get_descriptors 常返回「可复用的内部对象引用」，
      // 若直接持有该引用，后续任意 compute() 调用会覆盖其内容，导致重复查询时 desc（分子量/logP/TPSA 等）被篡改。
      desc = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
    }
    catch (e) { throw new Error('描述符解析失败'); }

    const svg = mol.get_svg(440, 330);
    const inchi = mol.get_inchi();
    const inchikey = inchi ? rdkit.get_inchikey_for_inchi(inchi) : '';
    const formula = getFormula(mol, desc);
    const groups = detectGroups(mol);
    const ionGroups = detectSMARTS(mol, IONIZABLE);
    const acidbase = applyPkaCorrection(mol, ionGroups);
    const pka = buildPka(acidbase);
    const pains = detectSMARTS(mol, PAINS);
    const brenk = detectSMARTS(mol, BRENK);
    try { if (typeof mol.delete === 'function') mol.delete(); } catch (e) {}

    return { desc, svg, inchi, inchikey, formula, groups, acidbase, pka, pains, brenk, smiles };
  }

  // 毒性/基因毒性结构警示筛查：按 ALERTS 库做子结构匹配，分类汇总（去重）
  function toxicityAlerts(smiles) {
    if (!rdkit) throw new Error('RDKit 引擎尚未初始化');
    const mol = rdkit.get_mol(smiles);
    if (!mol) throw new Error('RDKit 无法解析该结构，请检查 SMILES/结构是否正确。');
    let found;
    try { found = detectAlerts(mol); }
    finally { if (typeof mol.delete === 'function') mol.delete(); }
    const cats = { genotoxic: [], herg: [], sensitization: [], cyp: [] };
    for (const a of found) for (const c of a.cats) if (cats[c]) cats[c].push(a);
    const severe = found.filter(a => a.severity === 'high').length;
    const summary = found.length === 0
      ? '未检出系统化警示结构（基于本库 SMARTS 子集，非完整毒理评估）。'
      : `共检出 ${found.length} 类警示结构（其中 ${severe} 类高风险），详见下方分类。`;
    return { parsed: true, all: found, byCat: cats, total: found.length, severe, summary };
  }

  return {
    init, compute, computeGeometry, compute3D, toxicityAlerts, highlightStructure, analyzeForm, countSMARTS,
    get version() { return rdkit ? (typeof rdkit.version === 'function' ? rdkit.version() : rdkit.version) : ''; },
    // 'local' = 离线 wasm；'cdn' = 联网兜底；'' = 尚未加载
    get source() { return rdkit ? (usedLocal ? 'local' : 'cdn') : ''; },
  };
})();
