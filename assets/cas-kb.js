/* 化学知识库 / CAS→SMILES 自进化解析模块（四层架构）
   层级：
     L1  持久缓存（IndexedDB，跨会话留存，离线可用）
     L2  项目专属种子库（window.COMPOUND_SEED，离线优先）
     L3  在线并行解析（Wikidata > PubChem > Cactus > OPSIN）
     L4  轻量学习闭环（源成功率统计动态重排优先级 + CAS 归一化规则累积 + 失败队列人工回填）
   暴露 window.CAS_KB：
     resolveCAS(raw) / resolveName(raw,type) → 与 PubChem.resolve 兼容的结果对象
     getStats() / getCacheInfo() / getFailQueue() / addManual() / importJSON() / exportJSON()
     renderKbModal() → 在 app.js 中点击「🧠 知识库」时调用
   依赖：window.PubChem.resolveCAS / PubChem.cactusSMILES（同项目 pubchem.js） */
(function () {
  const DB_NAME = 'chemprop_kb';
  const DB_VER = 1;
  const STORE = 'kv';
  let _dbp = null;
  let _mem = {}; // indexedDB 不可用时的内存兜底

  function hasIDB() { try { return typeof indexedDB !== 'undefined'; } catch (e) { return false; } }

  function openDB() {
    if (_dbp) return _dbp;
    _dbp = new Promise((resolve, reject) => {
      if (!hasIDB()) { reject(new Error('no-idb')); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // 一旦失败，后续直接走内存兜底
    _dbp.catch(() => { _dbp = null; });
    return _dbp;
  }

  async function idbGet(key) {
    if (!hasIDB()) return _mem[key];
    try {
      const db = await openDB();
      return await new Promise((res) => {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(undefined);
      });
    } catch (e) { return _mem[key]; }
  }
  async function idbSet(key, val) {
    if (!hasIDB()) { _mem[key] = val; return; }
    try {
      const db = await openDB();
      await new Promise((res) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = () => res();
        tx.onerror = () => res();
      });
    } catch (e) { _mem[key] = val; }
  }

  // ---- 持久化键 ----
  async function getCache() { return (await idbGet('cache')) || {}; }
  async function setCache(o) { await idbSet('cache', o); }
  async function getStats() {
    const s = await idbGet('stats');
    if (s && s.sources) return s;
    return defaultStats();
  }
  async function setStats(s) { await idbSet('stats', s); }
  async function getNorm() { return (await idbGet('casNorm')) || []; }
  async function getFail() { return (await idbGet('failQueue')) || []; }
  async function setFail(a) { await idbSet('failQueue', a); }

  function defaultStats() {
    return {
      sources: {
        seed: { ok: 0, fail: 0, ms: 0 },
        cache: { ok: 0, fail: 0, ms: 0 },
        wikidata: { ok: 0, fail: 0, ms: 0 },
        pubchem: { ok: 0, fail: 0, ms: 0 },
        cactus: { ok: 0, fail: 0, ms: 0 },
        opsin: { ok: 0, fail: 0, ms: 0 }
      },
      totalResolved: 0, totalFailed: 0, byRole: {}
    };
  }

  // ---- SMILES 合法性（与 pubchem.js 保持一致，避免 RDKit 解析通配符原子）----
  function looksValidSMILES(s) {
    if (!s) return false;
    s = String(s).trim();
    if (!s) return false;
    if (/\[C\](?![a-zA-Z@+\-0-9])/.test(s)) return false;
    if (!/[BCNOFPSKIbcnofpski]|\[[A-Z][a-z]?/.test(s)) return false;
    if (/^Not\s*found|^Error|^Invalid/i.test(s)) return false;
    return true;
  }

  // ---- 学习闭环：记录源成功/失败 ----
  async function recordSuccess(source, ms, role) {
    const s = await getStats();
    const o = s.sources[source] || (s.sources[source] = { ok: 0, fail: 0, ms: 0 });
    o.ok++; if (ms > 0) o.ms = Math.round((o.ms * (o.ok - 1) + ms) / o.ok);
    s.totalResolved++;
    if (role) s.byRole[role] = (s.byRole[role] || 0) + 1;
    await setStats(s);
  }
  async function recordFailure(source) {
    const s = await getStats();
    const o = s.sources[source] || (s.sources[source] = { ok: 0, fail: 0, ms: 0 });
    o.fail++;
    s.totalFailed++;
    await setStats(s);
  }
  async function recordCacheHit(source, ms, role) {
    const s = await getStats();
    const o = s.sources[source] || (s.sources[source] = { ok: 0, fail: 0, ms: 0 });
    o.ok++; s.totalResolved++;
    if (role) s.byRole[role] = (s.byRole[role] || 0) + 1;
    await setStats(s);
  }

  // 根据历史成功率动态排序在线源（成功率优先，其次响应速度）
  async function getPriority(kind) {
    const s = await getStats();
    const online = kind === 'cas'
      ? ['wikidata', 'pubchem', 'cactus']
      : ['wikidata', 'pubchem', 'cactus', 'opsin'];
    return online.slice().sort((a, b) => {
      const sa = s.sources[a] || { ok: 0, fail: 0, ms: 9999 };
      const sb = s.sources[b] || { ok: 0, fail: 0, ms: 9999 };
      const ra = sa.ok / (sa.fail + 1);
      const rb = sb.ok / (sb.fail + 1);
      if (rb !== ra) return rb - ra;
      return (sa.ms || 9999) - (sb.ms || 9999);
    });
  }

  // ---- CAS 归一化（学习到的替换规则）----
  async function normalizeCAS(raw) {
    let s = String(raw).trim().replace(/\s+/g, '');
    const norm = await getNorm();
    for (const r of norm) { if (r.from && s === r.from) s = r.to; }
    return s;
  }
  async function addNormRule(from, to) {
    const n = await getNorm();
    if (!n.some(r => r.from === from && r.to === to)) { n.push({ from, to, ts: Date.now() }); await idbSet('casNorm', n); }
  }

  // ---- L2 种子库查表 ----
  function lookupSeed(raw) {
    const seed = (typeof window !== 'undefined' && window.COMPOUND_SEED) ? window.COMPOUND_SEED : [];
    if (!seed.length) return null;
    const q = String(raw).trim().toLowerCase();
    const casQ = q.replace(/\s+/g, '');
    for (const e of seed) {
      if (!e.s) continue;
      const casList = [e.cas, ...(e.cas_alt || [])].filter(Boolean).map(x => String(x).toLowerCase());
      const aliases = [e.cn, e.en, ...((e.ab || []).map(String)), ...((e.cm || []).map(String)), ...((e.of || []).map(String))]
        .filter(Boolean).map(x => String(x).toLowerCase());
      if (casList.some(c => c === casQ || c === q)) return e;
      if (aliases.some(a => a === q || a.includes(q) || q.includes(a))) return e;
    }
    return null;
  }

  // ---- L3 在线解析器 ----
  async function wikidataSmiles(query) {
    const casLike = /^\d{2,7}-\d{2}-\d$/.test(String(query).trim().replace(/\s+/g, ''));
    let sparql;
    if (casLike) {
      const cas = String(query).trim().replace(/\s+/g, '');
      sparql = `SELECT ?s WHERE { ?c wdt:P231 "${cas}". ?c wdt:P233 ?s. }`;
    } else {
      const lbl = String(query).trim().replace(/"/g, '');
      sparql = `SELECT ?s WHERE { ?c rdfs:label "${lbl}"@en. ?c wdt:P233 ?s. }`;
    }
    const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparql) + '&format=json';
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(url, { headers: { 'Accept': 'application/sparql-results+json' }, signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return null;
      const d = await r.json();
      const binds = (d.results && d.results.bindings) || [];
      if (!binds.length) return null;
      const smi = binds[0].s && binds[0].s.value;
      if (smi && looksValidSMILES(smi)) return { smiles: smi, ms: Date.now() - t0 };
      return null;
    } catch (e) { return null; }
  }

  async function opsinSmiles(name) {
    const url = 'https://opsin.ch.cam.ac.uk/opsin/' + encodeURIComponent(String(name).trim()) + '.json';
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return null;
      const d = await r.json();
      if (d && d.status === 'SUCCESS' && d.primaryIdentifier) return { smiles: d.primaryIdentifier, ms: Date.now() - t0 };
      return null;
    } catch (e) { return null; }
  }

  function minimalResult(smiles, cas, source) {
    return {
      canonicalSmiles: smiles, isomericSmiles: smiles, cas: cas || null, cid: null,
      title: cas || source, synonyms: [], imageUrl: null,
      refs: cas ? { cas: cas } : null, source: source
    };
  }

  // 由 SMILES 反查 PubChem 补全属性（best-effort，失败保持 minimal 结构）
  async function enrichFromSmiles(smiles, cas, source) {
    const P = (typeof window !== 'undefined' && window.PubChem) ? window.PubChem : null;
    if (!P || !P.resolve) return minimalResult(smiles, cas, source);
    try {
      const full = await P.resolve(smiles, 'smiles').catch(() => null);
      if (full && full.canonicalSmiles) {
        full.source = source;
        if (cas && !full.cas) full.cas = cas;
        return full;
      }
    } catch (e) {}
    return minimalResult(smiles, cas, source);
  }

  // ---- 主入口：CAS ----
  async function resolveCAS(raw) {
    if (!raw || !String(raw).trim()) return null;
    const norm = await normalizeCAS(raw);
    const cache = await getCache();
    // L1 缓存命中
    if (cache[norm] && cache[norm].smiles) {
      await recordCacheHit('cache', 0, cache[norm].role);
      return withSource(cache[norm], 'cache');
    }
    // L2 种子库
    const seedHit = lookupSeed(raw);
    if (seedHit) {
      cache[norm] = { cas: seedHit.cas || norm, smiles: seedHit.s, source: 'seed', role: seedHit.role, cn: seedHit.cn, en: seedHit.en, ts: Date.now() };
      await setCache(cache);
      await recordSuccess('seed', 0, seedHit.role);
      return withSource(cache[norm], 'seed');
    }
    // L3 在线（按学习到的优先级）
    const order = await getPriority('cas');
    for (const src of order) {
      let res = null;
      if (src === 'wikidata') {
        const w = await wikidataSmiles(raw);
        if (w) { await recordSuccess('wikidata', w.ms, null); res = await enrichFromSmiles(w.smiles, norm, 'wikidata'); }
        else await recordFailure('wikidata');
      } else if (src === 'pubchem') {
        const t0 = Date.now();
        const pr = (window.PubChem && window.PubChem.resolveCAS) ? await window.PubChem.resolveCAS(raw).catch(() => null) : null;
        if (pr && pr.canonicalSmiles && looksValidSMILES(pr.canonicalSmiles)) { await recordSuccess('pubchem', Date.now() - t0, pr.role); res = pr; }
        else await recordFailure('pubchem');
      } else if (src === 'cactus') {
        const t0 = Date.now();
        const c = (window.PubChem && window.PubChem.cactusSMILES) ? await window.PubChem.cactusSMILES(raw).catch(() => null) : null;
        if (c && looksValidSMILES(c)) { await recordSuccess('cactus', Date.now() - t0, null); res = await enrichFromSmiles(c, norm, 'cactus'); }
        else await recordFailure('cactus');
      } else if (src === 'opsin') {
        continue; // OPSIN 仅适用于名称
      }
      if (res && (res.canonicalSmiles || res.isomericSmiles)) {
        const smi = res.canonicalSmiles || res.isomericSmiles;
        cache[norm] = { cas: (res.cas || norm), smiles: smi, source: src, role: res.role, ts: Date.now() };
        await setCache(cache);
        return res;
      }
    }
    // L4 失败队列
    await pushFail(raw);
    return null;
  }

  // ---- 主入口：名称 / 自动 ----
  async function resolveName(raw, type) {
    if (!raw || !String(raw).trim()) return null;
    const key = 'name:' + String(raw).trim().toLowerCase();
    const cache = await getCache();
    if (cache[key] && cache[key].smiles) { await recordCacheHit('cache', 0, cache[key].role); return withSource(cache[key], 'cache'); }
    const seedHit = lookupSeed(raw);
    if (seedHit) {
      cache[key] = { cas: seedHit.cas || null, smiles: seedHit.s, source: 'seed', role: seedHit.role, cn: seedHit.cn, en: seedHit.en, ts: Date.now() };
      await setCache(cache); await recordSuccess('seed', 0, seedHit.role); return withSource(cache[key], 'seed');
    }
    const order = await getPriority('name');
    for (const src of order) {
      let res = null;
      if (src === 'wikidata') {
        const w = await wikidataSmiles(raw);
        if (w) { await recordSuccess('wikidata', w.ms, null); res = await enrichFromSmiles(w.smiles, null, 'wikidata'); }
        else await recordFailure('wikidata');
      } else if (src === 'pubchem') {
        const t0 = Date.now();
        const pr = (window.PubChem && window.PubChem.resolve) ? await window.PubChem.resolve(raw, type || 'name').catch(() => null) : null;
        if (pr && pr.canonicalSmiles && looksValidSMILES(pr.canonicalSmiles)) { await recordSuccess('pubchem', Date.now() - t0, pr.role); res = pr; }
        else await recordFailure('pubchem');
      } else if (src === 'cactus') {
        const t0 = Date.now();
        const c = (window.PubChem && window.PubChem.cactusSMILES) ? await window.PubChem.cactusSMILES(raw).catch(() => null) : null;
        if (c && looksValidSMILES(c)) { await recordSuccess('cactus', Date.now() - t0, null); res = await enrichFromSmiles(c, null, 'cactus'); }
        else await recordFailure('cactus');
      } else if (src === 'opsin') {
        const t0 = Date.now();
        const o = await opsinSmiles(raw);
        if (o && looksValidSMILES(o.smiles)) { await recordSuccess('opsin', Date.now() - t0, null); res = await enrichFromSmiles(o.smiles, null, 'opsin'); }
        else await recordFailure('opsin');
      }
      if (res && (res.canonicalSmiles || res.isomericSmiles)) {
        const smi = res.canonicalSmiles || res.isomericSmiles;
        cache[key] = { cas: (res.cas || null), smiles: smi, source: src, role: res.role, ts: Date.now() };
        await setCache(cache);
        return res;
      }
    }
    await pushFail(raw);
    return null;
  }

  async function pushFail(raw) {
    const f = await getFail();
    const item = { q: String(raw).trim(), ts: Date.now() };
    if (!f.some(x => x.q === item.q)) { f.unshift(item); if (f.length > 200) f.length = 200; await setFail(f); }
  }

  function withSource(entry, source) {
    return {
      canonicalSmiles: entry.smiles, isomericSmiles: entry.smiles,
      cas: entry.cas || null, cid: null, title: entry.cn || entry.en || entry.cas || source,
      synonyms: [], imageUrl: null, source: source, role: entry.role,
      refs: entry.cas ? { cas: entry.cas } : null
    };
  }

  // ---- 人工回填 / 导入导出（L4 闭环）----
  async function addManual(casOrName, smiles, role) {
    if (!looksValidSMILES(smiles)) return false;
    const key = String(casOrName).trim().replace(/\s+/g, '');
    const cache = await getCache();
    cache[key] = { cas: /^\d{2,7}-\d{2}-\d$/.test(key) ? key : null, smiles: smiles, source: 'manual', role: role || 'unknown', ts: Date.now() };
    await setCache(cache);
    // 从失败队列移除
    const f = await getFail();
    const nf = f.filter(x => x.q !== String(casOrName).trim());
    await setFail(nf);
    return true;
  }
  async function importJSON(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    const cache = await getCache();
    let n = 0;
    for (const k of Object.keys(obj)) { cache[k] = obj[k]; n++; }
    await setCache(cache);
    return n;
  }
  async function exportJSON() {
    const cache = await getCache();
    return { version: 'chemprop-kb', exportedAt: Date.now(), cache: cache };
  }
  async function getCacheInfo() {
    const cache = await getCache();
    const keys = Object.keys(cache);
    return {
      count: keys.length,
      seeds: (window.COMPOUND_SEED || []).length,
      entries: keys.slice(0, 200).map(k => ({ key: k, source: cache[k].source, cas: cache[k].cas, smiles: cache[k].smiles, role: cache[k].role }))
    };
  }

  // ---- 知识库管理模态（由 app.js 调用）----
  function renderKbModal() {
    return { getStats, getCacheInfo, getFail, addManual, importJSON, exportJSON, normalizeCAS, addNormRule };
  }

  window.CAS_KB = {
    resolveCAS, resolveName, getStats, getCacheInfo, getFail, getPriority,
    addManual, importJSON, exportJSON, normalizeCAS, addNormRule, looksValidSMILES, renderKbModal,
    _internal: { lookupSeed, defaultStats }
  };
})();
