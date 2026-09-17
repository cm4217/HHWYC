/* HHWYC 共享 Hansen 溶解度参数（溶质 HSP 估算 + 经典 Ra）
 * 供 research-tools.orgSolub 与 Advance.computeHansen 共用，避免两套公式不一致。
 * δ 值为相关性经验估计，非基团贡献精确值；仅供研发趋势参考。
 */
(function (global) {
  'use strict';

  function n(v) {
    const x = parseFloat(v);
    return isNaN(x) ? null : x;
  }

  /**
   * 由 RDKit 描述符估计溶质 δD / δP / δH（MPa^0.5）
   * @param {object} desc RDKit desc（CrippenClogP / tpsa / NumHBD / NumHBA）
   * @returns {{ dD:number, dP:number, dH:number, Ro:number, note:string }|null}
   */
  function estimateSolute(desc) {
    if (!desc) return null;
    const logP = n(desc.CrippenClogP);
    const tpsa = n(desc.tpsa);
    const hbd = n(desc.NumHBD) || 0;
    const hba = n(desc.NumHBA) || 0;
    const mw = n(desc.amw);
    if (logP == null && tpsa == null && mw == null) return null;
    const lp = logP != null ? logP : 0;
    const tp = tpsa != null ? tpsa : 0;
    // 统一经验映射：δD 随疏水性温和升高；δP 随 TPSA；δH 区分 HBD/HBA
    const dD = +(16.0 + 0.55 * Math.max(0, lp)).toFixed(2);
    const dP = +(0.04 + 0.12 * tp).toFixed(2);
    const dH = +(2.5 + 3.0 * hbd + 1.2 * hba).toFixed(2);
    const Ro = +Math.sqrt(dD * dD + dP * dP + dH * dH).toFixed(2);
    return {
      dD, dP, dH, Ro,
      note: 'δD/δP/δH 为共享相关性经验估计（由 logP/TPSA/H 键位点映射，HspShared.estimateSolute），非基团贡献精确值；相对 Ra 排序对良溶剂筛选具备趋势参考价值。'
    };
  }

  /**
   * 经典 Hansen 距离：Ra = sqrt(4ΔδD² + ΔδP² + ΔδH²)
   */
  function ra(solute, solvent) {
    if (!solute || !solvent) return null;
    const dD1 = n(solute.dD != null ? solute.dD : solute[0]);
    const dP1 = n(solute.dP != null ? solute.dP : solute[1]);
    const dH1 = n(solute.dH != null ? solute.dH : solute[2]);
    const dD2 = n(solvent.dD != null ? solvent.dD : solvent[0]);
    const dP2 = n(solvent.dP != null ? solvent.dP : solvent[1]);
    const dH2 = n(solvent.dH != null ? solvent.dH : solvent[2]);
    if ([dD1, dP1, dH1, dD2, dP2, dH2].some(v => v == null)) return null;
    return +Math.sqrt(4 * (dD1 - dD2) ** 2 + (dP1 - dP2) ** 2 + (dH1 - dH2) ** 2).toFixed(2);
  }

  /**
   * 经验估算熔点（℃）：简单 QSAR（MW/logP/HBD/环），非 Joback 精确值
   */
  function estimateMeltingPointC(desc) {
    if (!desc) return { mp: 150, source: '估算', detail: '缺描述符，默认 150℃' };
    const logP = n(desc.CrippenClogP);
    const mw = n(desc.amw);
    const hbd = n(desc.NumHBD) || 0;
    const nring = n(desc.NumRings) || 0;
    if (mw == null) return { mp: 150, source: '估算', detail: '缺 MW，默认 150℃' };
    const lp = logP != null ? logP : 2;
    let mp = 0.8 * mw - 12 * lp + 15 * hbd + 10 * nring - 30;
    mp = Math.max(40, Math.min(350, mp));
    return { mp: +mp.toFixed(1), source: '估算', detail: '描述符经验 QSAR（非实验）' };
  }

  /**
   * van't Hoff 启发式温度系数 B（K 量级），按溶剂极性
   * log10 S(T) = log10 S25 + B * (1/298.15 - 1/T)
   */
  function vantHoffB(solventHsp) {
    const dP = n(solventHsp && (solventHsp.dP != null ? solventHsp.dP : solventHsp[1])) || 0;
    const dH = n(solventHsp && (solventHsp.dH != null ? solventHsp.dH : solventHsp[2])) || 0;
    let B = 500 + 28 * (dP + dH);
    if (B < 500) B = 500;
    if (B > 1500) B = 1500;
    return +B.toFixed(0);
  }

  function solubilityAtT(mgml25, T_C, B) {
    const T = T_C + 273.15;
    const logS25 = Math.log10(Math.max(mgml25, 1e-12));
    const logST = logS25 + B * (1 / 298.15 - 1 / T);
    return Math.pow(10, logST);
  }

  global.HspShared = {
    estimateSolute,
    ra,
    estimateMeltingPointC,
    vantHoffB,
    solubilityAtT,
    classicRaNote: 'Ra = √(4ΔδD² + ΔδP² + ΔδH²)；Ra<8 通常预示良好相容性（启发式）。'
  };
})(typeof window !== 'undefined' ? window : globalThis);
