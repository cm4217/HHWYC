/* 化合物联想词库（前端静态，无需联网）
 * 覆盖国邦 API / 中间体项目品种 + 常用实验室化合物 + ICH M7 遗传毒性杂质。
 * 字段：
 *   c  : canonical —— 提交给引擎的标识（优先英文规范名，PubChem 解析更稳）
 *   s  : SMILES —— 本地兜底用；当 PubChem/Cactus 均失败时直接交给 RDKit 计算
 *   t  : 提交类型（name / cas / smiles；省略则自动识别）
 *   cas: CAS 登记号（主号）
 *   ab : 简称 / 缩写（如 ASA、APAP、DMSO、EtOH、NaCl）
 *   cm : 通用名 / 中文俗称（如 阿司匹林、布洛芬）
 *   of : 官方名 / 文件名称（如 去甲文拉法辛琥珀酸盐、Desvenlafaxine Succinate）
 *   cat: 类别标签（仅展示用）
 *   refs: 外部库引用 { pubchem, chembook, chemsrc, guidechem, commonchemistry }
 */
window.COMPOUND_DICT = [
  // —— 解热镇痛 / NSAID ——
  { c: 'aspirin', s: 'CC(=O)Oc1ccccc1C(=O)O', ab: ['ASA'], cm: ['阿司匹林', '乙酰水杨酸'], cat: '解热镇痛' },
  { c: 'paracetamol', s: 'CC(=O)Nc1ccc(O)cc1', ab: ['APAP'], cm: ['对乙酰氨基酚', '扑热息痛'], of: ['Acetaminophen'], cat: '解热镇痛' },
  { c: 'ibuprofen', s: 'CC(C)Cc1ccc(C(C)C(=O)O)cc1', cm: ['布洛芬'], cat: 'NSAID' },
  { c: 'naproxen', s: 'COc1ccc2cc(C(C)C(=O)O)ccc2c1', cm: ['萘普生'], cat: 'NSAID' },
  { c: 'diclofenac', s: 'O=C(O)Cc1ccccc1Nc1c(Cl)cccc1Cl', cm: ['双氯芬酸'], cat: 'NSAID' },
  { c: 'salicylic acid', s: 'O=C(O)c1ccccc1O', cm: ['水杨酸'], cat: '解热镇痛' },
  { c: 'methyl salicylate', s: 'COC(=O)c1ccccc1O', cm: ['水杨酸甲酯', '冬青油'], cat: '解热镇痛' },
  { c: 'benzaldehyde', s: 'O=Cc1ccccc1', cm: ['苯甲醛'], cat: '芳香醛' },
  { c: '4-bromobenzoic acid', s: 'O=C(O)c1ccc(Br)cc1', cm: ['4-溴苯甲酸', '对溴苯甲酸'], cat: '中间体' },
  { c: 'acetyl chloride', s: 'CC(=O)Cl', cm: ['乙酰氯'], cat: '酰氯·高活性' },

  // —— 中枢 / 平喘 / 降糖 ——
  { c: 'caffeine', s: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C', cm: ['咖啡因'], cat: '中枢兴奋' },
  { c: 'theophylline', s: 'Cn1c2c(c(=O)[nH]c1=O)NC=N2', cm: ['茶碱'], cat: '平喘' },
  { c: 'metformin', s: 'CN(C)C(=N)N', cm: ['二甲双胍'], cat: '降糖' },

  // —— 抗抑郁 ——
  { c: 'venlafaxine', s: 'CN(C)CC(C1=CC=C(C=C1)OC)C2(CCCCC2)O', cas: '93413-69-4', cm: ['文拉法辛'], cat: '抗抑郁' },
  { c: 'desvenlafaxine', s: 'CN(C)CC(C1=CC=C(C=C1)O)C2(CCCCC2)O', cas: '93413-69-5', cm: ['去甲文拉法辛'], of: ['去甲文拉法辛琥珀酸盐', 'Desvenlafaxine Succinate'], cat: '抗抑郁·API' },
  { c: 'sertraline', s: 'CNS(=O)(=O)c1ccc2c(c1)C(=C(C1CC1)c1ccccc1)N2C', cm: ['舍曲林'], cat: '抗抑郁' },
  { c: 'fluoxetine', s: 'CNCCC(OC1=CC=CC=C1C1=CC=CC=C1)C1=CC=CC=C1', cm: ['氟西汀'], cat: '抗抑郁' },

  // —— 抗凝 ——
  { c: 'edoxaban', s: 'CN1CCC2=C(C1)SC(=N2)C(=O)NC3CC(CCC3NC(=O)C(=O)NC4=NC=C(C=C4)Cl)C(=O)N(C)C', cas: '480449-03-4', cas_alt: ['480449-71-6'], cm: ['艾多沙班'], cat: '抗凝·API' },
  { c: 'warfarin', s: 'CC(=O)CC(c1ccccc1)c2c(oc3ccccc23)c1', cm: ['华法林'], cat: '抗凝' },

  // —— PPI / P-CAB（拉唑类 + 伏诺拉生） ——
  { c: 'omeprazole', s: 'COc1ccc2[nH]c(S(=O)Cc3ncc(C)c(OC)c3C)nc2c1', cm: ['奥美拉唑'], cat: 'PPI·API' },
  { c: 'esomeprazole', s: 'COc1ccc2[nH]c(S(=O)Cc3ncc(C)c(OC)c3C)nc2c1', cm: ['埃索美拉唑'], of: ['艾司奥美拉唑'], cat: 'PPI·API' },
  { c: 'lansoprazole', s: 'Cc1c(OCC(F)(F)F)cnc2c1nc(S(=O)Cc1ccccc1)[nH]2', cm: ['兰索拉唑'], cat: 'PPI' },
  { c: 'pantoprazole', s: 'COc1ccc2nc(S(=O)Cc3ncc(C)c(OC)c3C)[nH]c2c1', cm: ['泮托拉唑'], cat: 'PPI' },
  { c: 'rabeprazole', s: 'CCOCc1nc2ccc(OC)cc2[nH]c1=NCc1ccccc1', cm: ['雷贝拉唑'], cat: 'PPI' },
  { c: 'vonoprazan', s: 'CNCC1=CN(C(=C1)C2=CC=CC=C2F)S(=O)(=O)C3=CN=CC=C3', cas: '881681-00-1', cas_alt: ['1260141-27-2'], cm: ['伏诺拉生'], of: ['沃诺拉赞'], cat: 'P-CAB·API' },

  // —— 喹诺酮 ——
  { c: 'prulifloxacin', s: 'CC1N2C3=CC(=C(C=C3C(=O)C(=C2S1)C(=O)O)F)N4CCN(CC4)CC5=C(OC(=O)O5)C', cas: '123447-62-1', cm: ['普拉沙星'], cat: '喹诺酮·API' },
  { c: 'orbifloxacin', s: 'CC1CN(CC(N1)C)C2=C(C3=C(C(=C2F)F)C(=O)C(=CN3C4CC4)C(=O)O)F', cas: '113559-13-0', cm: ['奥比沙星'], cat: '喹诺酮' },
  { c: 'ciprofloxacin', s: 'O=C(O)c1cn(C2CC2)c2cc(N3CCNCC3)c(F)cc2c1=O', cm: ['环丙沙星'], cat: '喹诺酮' },

  // —— 其他 API 品种 ——
  { c: 'cinacalcet', s: 'CC(C1=CC=CC2=CC=CC=C21)NCCCC3=CC(=CC=C3)C(F)(F)F', cas: '226256-56-0', cm: ['西那卡塞'], cat: '拟钙剂·API' },
  { c: 'ziprasidone', s: 'C1CN(CCN1CCC2=C(C=C3C(=C2)CC(=O)N3)Cl)C4=NSC5=CC=CC=C54', cas: '146939-27-7', cm: ['齐拉西酮'], cat: '抗精神病·API' },
  { c: 'lanthanum carbonate', cm: ['碳酸镧'], cat: '磷结合剂·API' },
  { c: 'fudosteine', s: 'C(CO)CSCC(C(=O)O)N', cas: '13189-90-3', cm: ['福多司坦'], cat: '祛痰·API' },

  // —— 其他常用药 ——
  { c: 'sildenafil', s: 'CCCc1nn(C)c2c(=O)[nH]c(nc12)c3cc(ccc3OCC)S(=O)(=O)N4CCN(C)CC4', cm: ['西地那非'], cat: 'PDE5' },
  { c: 'atorvastatin', s: 'CC(C)C1=C(C(=C(N1CCC(CC(CC(=O)O)O)O)C2=CC=C(C=C2)F)C3=CC=CC=C3)C(=O)NC4=CC=CC=C4', cas: '134523-00-5', cas_alt: ['134523-03-8'], cm: ['阿托伐他汀'], cat: '他汀' },
  { c: 'amoxicillin', s: 'CC1(C(N2C(S1)C(C2=O)NC(=O)C(C3=CC=C(C=C3)O)N)C(=O)O)C', cas: '26787-78-0', cas_alt: ['61336-70-7'], cm: ['阿莫西林'], cat: '抗生素' },

  // —— 常用溶剂 / 试剂 ——
  { c: 'ethanol', s: 'CCO', ab: ['EtOH'], cm: ['乙醇'], cat: '溶剂' },
  { c: 'methanol', s: 'CO', cm: ['甲醇'], cat: '溶剂' },
  { c: 'acetic acid', s: 'CC(=O)O', cm: ['乙酸', '醋酸'], cat: '溶剂/酸' },
  { c: 'dimethyl sulfoxide', s: 'CS(=O)C', ab: ['DMSO'], cm: ['二甲基亚砜'], cat: '溶剂' },
  { c: 'acetone', s: 'CC(=O)C', cm: ['丙酮'], cat: '溶剂' },
  { c: 'dichloromethane', s: 'ClCCl', ab: ['DCM'], cm: ['二氯甲烷'], cat: '溶剂' },
  { c: 'sodium chloride', s: '[Na+].[Cl-]', ab: ['NaCl'], cm: ['氯化钠'], cat: '盐' },
  { c: 'water', s: 'O', cm: ['水'], cat: '溶剂' },
  { c: 'benzene', s: 'c1ccccc1', ab: ['PhH'], cm: ['苯'], cat: '芳烃' },
  { c: 'toluene', s: 'Cc1ccccc1', cm: ['甲苯'], cat: '芳烃' },
  { c: 'ammonia', s: 'N', cm: ['氨'], cat: '无机' },
  { c: 'urea', s: 'NC(=O)N', cm: ['尿素'], cat: '其他' },

  // —— API 中间体 / 杂质（PubChem 同义词匹配不稳、需多源兜底）——
  { c: 'ethyl (Z)-3-(dimethylamino)acrylate', s: 'CCOC(=O)/C=C\N(C)C', cas: '114894-59-6',
    ab: ['Nifedipine Impurity 25', '3-Dimethylamino-acrylic acid ethyl ester'],
    cm: ['硝苯地平杂质25', '(2Z)-3-(二甲氨基)-2-丙烯酸乙酯'], of: ['ethyl (Z)-3-(dimethylamino)prop-2-enoate'],
    cat: '中间体·杂质',
    refs: {
      pubchem: '5357228',
      chembook: 'https://www.chemicalbook.com/ChemicalProductProperty_EN_CB53697792.htm',
      chemsrc: 'https://www.chemsrc.com/search?searchStr=114894-59-6',
      guidechem: 'https://www.guidechem.com/search/?keyword=114894-59-6',
      commonchemistry: 'https://commonchemistry.cas.org/detail?cas_rn=114894-59-6'
    }
  },

  // —— ICH M7 遗传毒性杂质（亚硝胺 / 烷基磺酸酯 / 其他）——
  // 提交 canonical 为英文规范名；ab=文件常见缩写，cm=中文名，of=英文全称
  { c: 'N-nitrosodimethylamine', s: 'CN(C)N=O', ab: ['NDMA'], cm: ['N-亚硝基二甲胺', '亚硝基二甲胺'], of: ['N-nitrosodimethylamine'], cat: '亚硝胺·GTI' },
  { c: 'N-nitrosodiethylamine', s: 'CCN(CC)N=O', ab: ['NDEA'], cm: ['N-亚硝基二乙胺', '亚硝基二乙胺'], of: ['N-nitrosodiethylamine'], cat: '亚硝胺·GTI' },
  { c: 'N-nitroso-N-methyl-ethylamine', s: 'CCN(C)N=O', ab: ['NMEA', 'NEMA'], cm: ['N-亚硝基甲乙胺', 'N-亚硝基甲基乙胺'], of: ['N-nitroso-N-methyl-ethylamine'], cat: '亚硝胺·GTI' },
  { c: 'N-nitrosodiisopropylamine', s: 'CC(C)N(C(C)C)N=O', ab: ['NDIPA'], cm: ['N-亚硝基二异丙胺'], of: ['N-nitrosodiisopropylamine'], cat: '亚硝胺·GTI' },
  { c: 'N-nitrosoisopropylethylamine', s: 'CCN(C(C)C)N=O', ab: ['NIPEA'], cm: ['N-亚硝基异丙基乙胺'], of: ['N-nitrosoisopropylethylamine'], cat: '亚硝胺·GTI' },
  { c: 'N-nitrosodibutylamine', s: 'CCCCN(CCCC)N=O', ab: ['NDBA'], cm: ['N-亚硝基二丁胺'], of: ['N-nitrosodibutylamine'], cat: '亚硝胺·GTI' },
  { c: 'N-nitrosomorpholine', s: 'O=C1CN(C(=O)CO1)N=O', ab: ['NMOR'], cm: ['N-亚硝基吗啉'], of: ['N-nitrosomorpholine'], cat: '亚硝胺·GTI' },
  { c: 'N-nitrosodiphenylamine', s: 'O=N(c1ccccc1)c1ccccc1', ab: ['NDPhA'], cm: ['N-亚硝基二苯胺'], of: ['N-nitrosodiphenylamine'], cat: '亚硝胺·GTI' },
  { c: 'N-nitroso-N-methyl-4-aminobutyric acid', s: 'CN(CCCC(=O)O)N=O', ab: ['NMBA'], cm: ['N-亚硝基-N-甲基-4-氨基丁酸'], of: ['N-nitroso-N-methyl-4-aminobutyric acid'], cat: '亚硝胺·GTI' },
  { c: 'methyl methanesulfonate', s: 'COS(=O)(=O)C', ab: ['MMS'], cm: ['甲磺酸甲酯'], of: ['methyl methanesulfonate'], cat: '烷基磺酸酯·GTI' },
  { c: 'ethyl methanesulfonate', s: 'CCOS(=O)(=O)C', ab: ['EMS'], cm: ['甲磺酸乙酯'], of: ['ethyl methanesulfonate'], cat: '烷基磺酸酯·GTI' },
  { c: 'isopropyl methanesulfonate', s: 'CC(C)OS(=O)(=O)C', ab: ['iPMS'], cm: ['异丙基甲磺酸酯'], of: ['isopropyl methanesulfonate'], cat: '烷基磺酸酯·GTI' },
  { c: 'propyl methanesulfonate', s: 'CCCOS(=O)(=O)C', ab: ['PMS'], cm: ['丙基甲磺酸酯'], of: ['propyl methanesulfonate'], cat: '烷基磺酸酯·GTI' },
  { c: '2-nitronaphthalene', s: 'O=[N+]([O-])c1ccc2ccccc2c1', ab: ['2-NA'], cm: ['2-硝基萘'], of: ['2-nitronaphthalene'], cat: '其他·GTI' },
  { c: '4-nitroquinoline N-oxide', s: '[O-][n+]1c2ccccc2cnc1[N+](=O)[O-]', ab: ['4-NQO'], cm: ['4-硝基喹啉-N-氧化物'], of: ['4-nitroquinoline N-oxide'], cat: '其他·GTI' },
  { c: 'benzo[a]pyrene', s: 'c1ccc2c(c1)cc3ccc4cccc5ccc2c3c45', ab: ['B(a)P', 'BaP'], cm: ['苯并[a]芘'], of: ['benzo[a]pyrene'], cat: '其他·GTI' },
  { c: 'hydrazine', s: 'NN', ab: ['N2H4'], cm: ['肼'], of: ['hydrazine'], cat: '其他·GTI' },
  { c: 'benzidine', s: 'c1ccc(cc1)c2ccc(cc2)N', cm: ['联苯胺'], of: ['benzidine'], cat: '其他·GTI' },
  { c: 'formaldehyde', s: 'C=O', cm: ['甲醛'], of: ['formaldehyde'], cat: '其他·GTI' },
];
