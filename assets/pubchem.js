/* PubChem PUG-REST 数据获取 + Cactus NCI 备用源（CAS 专用）
   暴露 window.PubChem.resolve(value, type)
   type: auto|smiles|name|cas|inchi

   修复历史：PubChem 对部分 CAS（如 93413-62-8=文拉法辛）返回的 SMILES 含有 [C] 通配符，
   RDKit 无法解析，导致"RDKit 无法解析该结构"错误。Cactus NCI 是更可靠的 CAS→SMILES 源。 */
window.PubChem = (function () {
  const BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
  const PROP_LIST = ['MolecularFormula', 'MolecularWeight', 'CanonicalSMILES', 'IsomericSMILES',
    'XLogP', 'TPSA', 'HBondDonorCount', 'HBondAcceptorCount', 'RotatableBondCount',
    'ExactMass', 'MonoisotopicMass', 'Charge', 'Complexity', 'IUPACName', 'Title'].join(',');

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // PubChem JSON GET（带限流退避重试：偶发 429 / 网络抖动会导致误报“未匹配”）
  async function getJSON(url, tries) {
    tries = tries || 4;
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000); // 单次请求 12s 上限，避免离线/弱网卡死
      try {
        const r = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok) return r.json();
        if (r.status === 404) return null;
        if (r.status === 429) { await sleep(700 * (i + 1)); continue; }  // 限流：指数退避后重试
        throw new Error('PubChem 返回 HTTP ' + r.status);
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        if (e && /Failed to fetch|network|timeout|abort/i.test(String(e.message))) { await sleep(600); continue; }
        throw e;
      }
    }
    if (lastErr) throw lastErr;
    throw new Error('PubChem 请求失败（已达重试上限）');
  }

  // Cactus NCI CAS/name → SMILES（文本格式）。NCI 偶发 5xx，加退避重试提升稳定性。
  async function cactusSMILES(query, tries) {
    tries = tries || 3;
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const r = await fetch('https://cactus.nci.nih.gov/chemical/structure/' + encodeURIComponent(query) + '/smiles', {
          headers: { 'Accept': 'text/plain' }, signal: ctrl.signal
        });
        clearTimeout(timer);
        if (r.ok) {
          const txt = (await r.text()).trim();
          // Cactus 成功返回纯文本 SMILES；失败时返回 'Not found' 或错误信息
          if (txt && !/^Not\s*found|^Error|^Invalid/i.test(txt) && txt.length <= 2000) return txt;
          return null;
        }
        // 限流(429)或偶发 5xx：退避重试
        if (r.status === 429 || r.status >= 500) { await sleep(500 * (i + 1)); continue; }
        return null;
      } catch (e) {
        lastErr = e;
        if (/Failed to fetch|network|timeout|abort/i.test(String(e.message))) { await sleep(500); continue; }
        return null;
      }
    }
    return null;
  }

  // SMILES 是否可被 RDKit 解析：剔除 PubChem 偶发的"通配符原子" [C]（未指定价的碳），
  // 同时放行合法短 SMILES（O=水、CO、Cl、[OH-] 等），仅做基本合法性判定，避免误杀有效结构。
  function looksValidSMILES(s) {
    if (!s) return false;
    s = String(s).trim();
    if (!s) return false;
    // 含 [C] 后跟非字母/数字/+/@ 的，即独立 [C] 通配符（如 C1=CC=C(C=C1)[C]），RDKit 无法解析
    if (/\[C\](?![a-zA-Z@+\-0-9])/.test(s)) return false;
    // 必须至少含一个可识别的原子符号（有机子集或方括号原子）
    if (!/[BCNOFPSKIbcnofpski]|\[[A-Z][a-z]?/.test(s)) return false;
    // 明显的错误/占位文本
    if (/^Not\s*found|^Error|^Invalid/i.test(s)) return false;
    return true;
  }

  // CAS 正则
  const CAS_RE = /^\d{2,7}-\d{2}-\d$/;
  function findCAS(synonyms) {
    if (!synonyms || !synonyms.length) return null;
    for (const s of synonyms) {
      if (CAS_RE.test(String(s).trim())) return String(s).trim();
    }
    return null;
  }

  // 由 SMILES 反查 PubChem CID
  async function getCidBySmiles(smiles) {
    const data = await getJSON(BASE + '/compound/smiles/' + encodeURIComponent(smiles) + '/cids/JSON').catch(() => null);
    if (!data || !data.IdentifierList || !data.IdentifierList.CID) return null;
    return data.IdentifierList.CID[0] || null;
  }

  // 由名称/CAS/同义词查 PubChem CID（保留，name 路径用）
  async function getCidByName(query) {
    const data = await getJSON(BASE + '/compound/name/' + encodeURIComponent(query) + '/cids/JSON').catch(() => null);
    if (!data || !data.IdentifierList || !data.IdentifierList.CID) return null;
    return data.IdentifierList.CID[0] || null;
  }

  // CAS 专用：在 PubChem 多命名空间并行取 CID（name + xref/RN 互补，覆盖更多 CAS 写法）
  async function getCidByAny(query) {
    const enc = encodeURIComponent(query);
    const urls = [
      BASE + '/compound/name/' + enc + '/cids/JSON',
      BASE + '/compound/xref/RN/' + enc + '/cids/JSON'
    ];
    const results = await Promise.all(urls.map(u => getJSON(u).catch(() => null)));
    for (const d of results) {
      if (d && d.IdentifierList && d.IdentifierList.CID && d.IdentifierList.CID[0]) return d.IdentifierList.CID[0];
    }
    return null;
  }

  // 由 CID 取完整属性对象
  async function getMetaByCid(cid) {
    try {
      const pd = await getJSON(BASE + '/compound/cid/' + cid + '/property/' + PROP_LIST + '/JSON');
      const p = pd && pd.PropertyTable && pd.PropertyTable.Properties && pd.PropertyTable.Properties[0];
      if (p) p.cid = cid;
      return p;
    } catch (e) { return null; }
  }

  // 由 CID 取同义词列表
  async function getSynonyms(cid) {
    try {
      const sd = await getJSON(BASE + '/compound/cid/' + cid + '/synonyms/JSON');
      if (sd && sd.InformationList && sd.InformationList.Information) {
        return sd.InformationList.Information[0].Synonym || [];
      }
    } catch (e) {}
    return [];
  }

  // 把 PubChem 属性对象标准化成 resolve 的返回格式
  function buildResult(p, cid, synonyms, fallbackName, fallbackSmiles, refs) {
    const cas = findCAS(synonyms) || (refs && refs.cas) || null;
    const r = {
      cid: cid || (p && p.cid),
      formula: p && p.MolecularFormula,
      mw: p && p.MolecularWeight,
      canonicalSmiles: (p && p.CanonicalSMILES) || fallbackSmiles,
      isomericSmiles: (p && p.IsomericSMILES) || fallbackSmiles,
      xlogp: p && p.XLogP,
      tpsa: p && p.TPSA,
      hbd: p && p.HBondDonorCount,
      hba: p && p.HBondAcceptorCount,
      rotBonds: p && p.RotatableBondCount,
      exactMass: p && p.ExactMass,
      monoMass: p && p.MonoisotopicMass,
      charge: p && p.Charge,
      complexity: p && p.Complexity,
      iupac: p && p.IUPACName,
      title: (p && p.Title) || fallbackName,
      cas: cas,
      synonyms: synonyms || [],
      imageUrl: (cid || (p && p.cid)) ? BASE + '/compound/cid/' + (cid || p.cid) + '/PNG?image_size=400' : null,
      refs: refs || null,
    };
    // 若已知 CAS/CID，自动补全常见外部库引用链接
    if (!r.refs) r.refs = {};
    if (cas && !r.refs.cas) r.refs.cas = cas;
    if (r.cid && !r.refs.pubchem) r.refs.pubchem = String(r.cid);
    if (cas && !r.refs.chembook) r.refs.chembook = `https://www.chemicalbook.com/ProductSearchList.aspx?keyword=${encodeURIComponent(cas)}`;
    if (cas && !r.refs.chemsrc) r.refs.chemsrc = `https://www.chemsrc.com/search?searchStr=${encodeURIComponent(cas)}`;
    if (cas && !r.refs.guidechem) r.refs.guidechem = `https://www.guidechem.com/search/?keyword=${encodeURIComponent(cas)}`;
    if (cas && !r.refs.commonchemistry) r.refs.commonchemistry = `https://commonchemistry.cas.org/detail?cas_rn=${encodeURIComponent(cas)}`;
    return r;
  }

  // 由 CID 一次性取属性+同义词（PubChem 完整路径）；casFallback 在 PubChem 同义词未含该 CAS 时兜底保留输入 CAS
  async function getFullByCid(cid, casFallback) {
    const [p, syns] = await Promise.all([getMetaByCid(cid), getSynonyms(cid)]);
    return buildResult(p, cid, syns, null, null, casFallback ? { cas: casFallback } : undefined);
  }

  async function resolveCAS(casRaw) {
    // 1) PubChem：name / xref(RN) 两个命名空间并行取 CID（覆盖更多 CAS 写法）
    let cid = null;
    try { cid = await getCidByAny(casRaw); } catch (e) { cid = null; }
    let pubRes = null;
    if (cid) {
      try { pubRes = await getFullByCid(cid, casRaw); } catch (e) { pubRes = null; }
      // PubChem 偶发仅返回 CID 但 SMILES 缺失/异常（含 [C] 通配符等），用 Cactus 补一次
      if (pubRes && !looksValidSMILES(pubRes.canonicalSmiles)) {
        const cSm = await cactusSMILES(casRaw).catch(() => null);
        if (cSm && looksValidSMILES(cSm)) { pubRes.canonicalSmiles = cSm; pubRes.isomericSmiles = cSm; }
        else if (!looksValidSMILES(pubRes.canonicalSmiles)) pubRes = null;
      }
    }
    if (pubRes && looksValidSMILES(pubRes.canonicalSmiles)) return pubRes;

    // 2) Cactus NCI 按 CAS 直查 SMILES（最可靠的 CAS 源之一）。即便 CID 反查失败（无 MW/公式），
    //    只要拿到合法 SMILES 即返回，并强制保留输入 CAS —— 避免"CAS 无法识别 + 结果不全"。
    const cactusSmi = await cactusSMILES(casRaw).catch(() => null);
    if (cactusSmi && looksValidSMILES(cactusSmi)) {
      let c2 = null, p = null, syns = [];
      try { c2 = await getCidBySmiles(cactusSmi); if (c2) { p = await getMetaByCid(c2); syns = await getSynonyms(c2); } } catch (e) {}
      return buildResult(p, c2, syns, casRaw, cactusSmi, { cas: casRaw });
    }
    return null;
  }

  // 本地化合物词典兜底：按 CAS / canonical / 简称 / 中文名 / 官方名 匹配，命中且含 SMILES 时优先本地计算
  async function resolveViaLocalDict(raw) {
    const dict = (typeof window !== 'undefined' && window.COMPOUND_DICT) ? window.COMPOUND_DICT : [];
    if (!dict.length || !raw) return null;
    const q = raw.trim().toLowerCase();
    for (const e of dict) {
      if (!e.s) continue;
      const casList = [e.cas, ...(e.cas_alt || [])].filter(Boolean).map(x => String(x).toLowerCase());
      const hay = [
        ...casList,
        (e.c || '').toLowerCase(),
        ...((e.ab || []).map(x => String(x).toLowerCase())),
        ...((e.cm || []).map(x => String(x).toLowerCase())),
        ...((e.of || []).map(x => String(x).toLowerCase())),
      ];
      if (hay.some(h => h === q || h.includes(q))) {
        const refs = Object.assign({ cas: e.cas || null }, e.refs || {});
        if (e.cas && !refs.chembook) refs.chembook = `https://www.chemicalbook.com/ProductSearchList.aspx?keyword=${encodeURIComponent(e.cas)}`;
        if (e.cas && !refs.chemsrc) refs.chemsrc = `https://www.chemsrc.com/search?searchStr=${encodeURIComponent(e.cas)}`;
        if (e.cas && !refs.guidechem) refs.guidechem = `https://www.guidechem.com/search/?keyword=${encodeURIComponent(e.cas)}`;
        if (e.cas && !refs.commonchemistry) refs.commonchemistry = `https://commonchemistry.cas.org/detail?cas_rn=${encodeURIComponent(e.cas)}`;
        // best-effort：用本地 SMILES 反查 PubChem 拿 CID / 属性 / 3D（失败则退化为纯本地计算）
        let cid = null, p = null, syns = [];
        try {
          cid = await getCidBySmiles(e.s);
          if (cid) { p = await getMetaByCid(cid); syns = await getSynonyms(cid); }
        } catch (err) { cid = null; p = null; syns = []; }
        return buildResult(p, cid, syns, e.c || raw, e.s, refs);
      }
    }
    return null;
  }

  // 主入口
  async function resolve(value, type) {
    const raw = value.trim();
    if (!raw) return null;

    // —— CAS 专用路径：先经化学知识库（缓存→种子→Wikidata→PubChem→Cactus→失败队列），
    //    再回退到既有本地词典 ——
    if (type === 'cas') {
      if (window.CAS_KB && window.CAS_KB.resolveCAS) {
        try {
          const kb = await window.CAS_KB.resolveCAS(raw);
          if (kb && (kb.canonicalSmiles || kb.isomericSmiles)) return kb;
        } catch (e) { /* KB 异常不影响既有回退 */ }
      }
      const r = await resolveCAS(raw);
      if (r) return r;
      const local = await resolveViaLocalDict(raw);
      if (local) return local;
      return null;
    }

    // —— PubChem name/smiles/inchi/auto 路径 ——
    // name / auto：先经化学知识库（种子→Wikidata→PubChem→Cactus→OPSIN→失败队列）
    if (type === 'name' || type === 'auto') {
      if (window.CAS_KB && window.CAS_KB.resolveName) {
        try {
          const kb = await window.CAS_KB.resolveName(raw, type);
          if (kb && (kb.canonicalSmiles || kb.isomericSmiles)) return kb;
        } catch (e) { /* 回退既有逻辑 */ }
      }
    }
    const v = encodeURIComponent(raw);
    const ptype = (type === 'auto') ? 'name' : type;
    const data = await getJSON(BASE + '/compound/' + ptype + '/' + v + '/cids/JSON').catch(() => null);
    const cids = data && data.IdentifierList && data.IdentifierList.CID;

    // PubChem 失败时：先尝试 Cactus name→SMILES，再尝试本地词典兜底
    if (!cids || !cids.length) {
      const cactusSmi = (type === 'name' || type === 'auto') ? await cactusSMILES(raw) : null;
      if (cactusSmi && looksValidSMILES(cactusSmi)) {
        return buildResult(null, null, [], raw, cactusSmi);
      }
      const local = await resolveViaLocalDict(raw);
      if (local) return local;
      return null;
    }

    const cid = cids[0];
    const p = await getMetaByCid(cid);
    const syns = await getSynonyms(cid);

    // PubChem 返回的 SMILES 偶尔含 [C] 通配符等异常（部分化合物），RDKit 无法解析。
    // 这种情况下用 Cactus 重新查 SMILES（也 best-effort）。
    let canonical = p && p.CanonicalSMILES;
    if (canonical && !looksValidSMILES(canonical)) {
      const cSm = await cactusSMILES(raw);
      if (cSm && looksValidSMILES(cSm)) canonical = cSm;
    }
    // 若 CID 查询成功但 property/synonyms 请求失败（网络不稳、超时等），
    // canonical 可能为空 → 用本地词典兜底，避免调用方拿到无 SMILES 的结果
    if (!canonical || !looksValidSMILES(canonical)) {
      const local = await resolveViaLocalDict(raw);
      if (local && local.canonicalSmiles) return local;
    }
    return buildResult(p, cid, syns, raw, canonical);
  }

  return { resolve, resolveCAS, cactusSMILES, resolveViaLocalDict };
})();