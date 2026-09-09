# HHWYC

化合物理化性质与 ADME 类药性预测平台（PubChem + RDKit WASM）。

面向**原料药（API）与工艺中间体研发**的工具：结合 **PubChem**（真实/计算数据）、**RDKit WASM**（本地开源化学信息学引擎）与 **SwissADME 风格规则**（类药性估计）。

**仓库地址：** https://github.com/cm4217/HHWYC

```bash
git clone https://github.com/cm4217/HHWYC.git
cd HHWYC
```

## 功能概览

- **多类型输入**：SMILES / 化合物名称 / CAS 号 / InChI（自动识别或手动指定）
- **结构解析**：PubChem 解析 CID、分子式、Canonical SMILES、IUPAC 名，并渲染 2D 结构（RDKit SVG / PubChem PNG）
- **理化性质**：分子量、精确分子量、logP（Crippen）、XLogP、TPSA、HBD/HBA、可旋转键、芳香环数、sp³ 碳比例、摩尔折射率、Labute ASA、复杂度等
- **ADME / 类药性**：Lipinski / Veber / Egan / Muegge / Ghose、生物利用度评分、BBB / GI 吸收估计、合成可及性（近似）、BCS 分类预估
- **水溶解度（QSAR）**：ESOL（Delaney 2004）与 Ali 2012；可选 pH 依赖溶解度估算（Henderson–Hasselbalch）
- **化学友好性**：常用 PAINS / Brenk 结构警示子集
- **谱图与固态**：EI-MS 同位素峰型等本地估算；SDBS / NIST / MassBank / COD 等外部跳转检索
- **类药性雷达图**、中间体安全提示、批量预测与 CSV / JSON 导出

## 快速开始

### Windows（推荐）

1. 首次：克隆或下载仓库并解压  
2. **双击** `启动网站.bat`（会自动打开浏览器 → http://127.0.0.1:8080 ）  
3. 以后要更新再启动：双击 `更新并启动.bat`

也可在 PowerShell 中：

```powershell
cd HHWYC
.\start.ps1
```

### 命令行（任意系统）

```bash
git clone https://github.com/cm4217/HHWYC.git
cd HHWYC
python serve.py
# 默认 http://127.0.0.1:8080 ，一般会自动打开浏览器
# 不自动开浏览器：NO_BROWSER=1 python serve.py
# 换端口：PORT=8090 python serve.py
```

以 `http://localhost` 方式打开时，RDKit WASM 从本地 `assets/rdkit/` 加载，**性质预测可完全离线**（仅 PubChem 数据需要联网）。

直接双击 `index.html`（`file://`）多数情况下也可离线预测：引擎内置 wasm 的 base64 内嵌（`assets/rdkit/RDKit_minimal.wasm.b64.js`）。若遇 WASM 限制，请改用上方服务器方式。

可选：本地结构式图片 OCR 见 `部署说明.md` 与 `setup_ocr_server.bat` / `setup_ocr_server.ps1`。

## 目录结构

```
HHWYC/
├── index.html                 # 主页面（入口）
├── serve.py                   # 静态服务器（默认 127.0.0.1:8080）
├── manifest.webmanifest       # PWA 清单
├── local_ocr_server.py        # 可选：本地结构式图片 OCR 服务
├── setup_ocr_server.bat       # Windows OCR 一键安装
├── setup_ocr_server.ps1       # PowerShell OCR 一键安装
├── README.md                  # 本文件
├── 部署说明.md                # 部署与安装说明
├── .gitignore
└── assets/
    ├── styles.css
    ├── app.js                 # 主逻辑与界面
    ├── advance.js             # 高级预测
    ├── predict.js             # ADME / 类药性规则
    ├── pubchem.js             # PubChem PUG-REST
    ├── cas-kb.js              # CAS 知识库
    ├── seed-db.js             # 种子数据
    ├── compound-dict.js       # 化合物词典
    ├── examples.js            # 示例化合物
    ├── research-tools.js      # 工艺研发工具箱
    ├── rdkit-engine.js        # RDKit WASM 封装（本地优先 + CDN 兜底）
    ├── icon-192.png / icon-512.png
    ├── rdkit/                 # RDKit WASM 引擎（离线核心，请勿删除）
    │   ├── RDKit_minimal.js
    │   ├── RDKit_minimal.wasm
    │   └── RDKit_minimal.wasm.b64.js
    └── vendor/
        ├── xlsx.full.min.js   # Excel 导出
        └── jszip.min.js
```

## 数据来源

| 来源 | 用途 | 说明 |
|------|------|------|
| [PubChem PUG-REST](https://pubchem.ncbi.nlm.nih.gov/rest/pug) | CID / 实验与计算性质 / 结构图 | 站内实时拉取，需联网 |
| [RDKit](https://github.com/rdkit/rdkit)（WASM） | 本地描述符、2D 结构、离线预测 | 本地 `assets/rdkit/`，可离线 |
| [SwissADME](http://www.swissadme.ch/) | 类药性规则与溶解度分级参考 | 规则参考，非 API |
| ChemSpider / Chemicalize | 外部化合物 / pKa 等查询 | 跳转链接（密钥 / CORS / API 退役） |
| SDBS · NIST WebBook · MassBank | IR / MS / NMR 等谱图 | 外部公开库跳转 |
| COD · CCDC/WebCSD · Google Patents / Scholar | 晶型 / DSC / TGA 等固态信息 | 外部检索链接 |

> PubChem 为站内实时拉取；ChemSpider / Chemicalize / 谱图与固态库多为**跳转式外部查询**。更多细节见页面内「数据与开源说明」及 `部署说明.md`。

## 免责声明

本工具的性质与类药性结果为**计算 / 规则近似**（合成可及性、BBB / GI 等为经验模型估计），仅供研发参考，**不构成监管申报或临床依据**。基因毒性相关官能团提示仅基于结构警示，需以正式毒理 / 致突变研究为准。
