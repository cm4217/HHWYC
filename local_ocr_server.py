#!/usr/bin/env python3
"""
本地化学结构式识别服务（Local OCR Server for chem-prop-predictor）
====================================================================
用途：为 chem-prop-predictor 的「图片识别」功能提供可靠的后端，
      避免依赖 HuggingFace 免费 Space / OSRA 在线服务等不稳定公共接口。

支持的识别引擎（按优先级尝试）：
  1. MolScribe  （pip install molscribe）
  2. DECIMER    （pip install decimer）
  3. MolNexTR   （pip install molnextr）

接口：
  POST http://localhost:8765/ocr
  Content-Type: application/json
  Body: { "image": "data:image/png;base64,iVBORw0KGgo..." }

  成功返回：{ "ok": true, "smiles": "...", "source": "MolScribe" }
  失败返回：{ "ok": false, "error": "..." }

启动：
  python local_ocr_server.py
  或指定端口：python local_ocr_server.py --port 8765

首次使用需安装依赖（建议新建虚拟环境）：
  python -m venv venv_ocr
  venv_ocr\\Scripts\\activate        # Windows
  # source venv_ocr/bin/activate   # Linux/macOS
  pip install molscribe decimer molnextr pillow rdkit

说明：
- 首次启动会自动下载模型权重，可能需要 1~5 分钟（视网络）。
- 模型文件会缓存在 HuggingFace 默认缓存目录，后续启动很快。
- 如果只想用一个引擎，安装对应的包即可；未安装的引擎会自动跳过。
"""

import argparse
import base64
import io
import json
import logging
import re
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("local_ocr")

# 尝试导入各个引擎
try:
    from molscribe import MolScribe
    from huggingface_hub import hf_hub_download
    MOLSCRIBE_AVAILABLE = True
except Exception as e:
    logger.info("MolScribe 未安装或导入失败：%s", e)
    MOLSCRIBE_AVAILABLE = False

try:
    from DECIMER import predict_SMILES
    DECIMER_AVAILABLE = True
except Exception as e:
    logger.info("DECIMER 未安装或导入失败：%s", e)
    DECIMER_AVAILABLE = False

try:
    import MolNexTR
    MOLNEXTR_AVAILABLE = True
except Exception as e:
    logger.info("MolNexTR 未安装或导入失败：%s", e)
    MOLNEXTR_AVAILABLE = False

# 模型单例缓存
_molscribe_model = None
_molnextr_model = None


def load_molscribe():
    global _molscribe_model
    if _molscribe_model is not None:
        return _molscribe_model
    if not MOLSCRIBE_AVAILABLE:
        return None
    try:
        logger.info("正在加载 MolScribe 模型（首次下载约 1~3 分钟）...")
        ckpt_path = hf_hub_download("yujieq/MolScribe", "swin_base_char_aux_1m680k.pth")
        import torch
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        _molscribe_model = MolScribe(ckpt_path, device=device)
        logger.info("MolScribe 模型加载完成。")
        return _molscribe_model
    except Exception as e:
        logger.error("MolScribe 加载失败：%s", e)
        return None


def load_molnextr():
    global _molnextr_model
    if _molnextr_model is not None:
        return _molnextr_model
    if not MOLNEXTR_AVAILABLE:
        return None
    try:
        logger.info("正在加载 MolNexTR 模型（首次下载约 1~3 分钟）...")
        import torch
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        # MolNexTR 自动下载模型
        _molnextr_model = MolNexTR.molnextr(None, device)
        logger.info("MolNexTR 模型加载完成。")
        return _molnextr_model
    except Exception as e:
        logger.error("MolNexTR 加载失败：%s", e)
        return None


def decode_image(data_url_or_b64):
    """把 data URL 或纯 base64 转成 PIL Image。"""
    if data_url_or_b64.startswith("data:"):
        m = re.match(r"data:image/\w+;base64,(.+)", data_url_or_b64)
        if not m:
            raise ValueError("不支持的 data URL 格式")
        b64 = m.group(1)
    else:
        b64 = data_url_or_b64
    raw = base64.b64decode(b64)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def recognize_with_molscribe(img):
    model = load_molscribe()
    if model is None:
        return None
    # 保存为临时文件（molscribe 接口需要路径）
    tmp = io.BytesIO()
    img.save(tmp, format="PNG")
    tmp_path = "/tmp/chemprop_ocr_molscribe.png"
    try:
        with open(tmp_path, "wb") as f:
            f.write(tmp.getvalue())
    except Exception:
        tmp_path = "chemprop_ocr_molscribe.png"
        with open(tmp_path, "wb") as f:
            f.write(tmp.getvalue())
    result = model.predict_image_file(tmp_path)
    smiles = result.get("smiles")
    if smiles:
        return smiles.strip()
    return None


def recognize_with_decimer(img):
    if not DECIMER_AVAILABLE:
        return None
    tmp = io.BytesIO()
    img.save(tmp, format="PNG")
    tmp_path = "/tmp/chemprop_ocr_decimer.png"
    try:
        with open(tmp_path, "wb") as f:
            f.write(tmp.getvalue())
    except Exception:
        tmp_path = "chemprop_ocr_decimer.png"
        with open(tmp_path, "wb") as f:
            f.write(tmp.getvalue())
    smiles = predict_SMILES(tmp_path)
    return smiles.strip() if smiles else None


def recognize_with_molnextr(img):
    model = load_molnextr()
    if model is None:
        return None
    tmp = io.BytesIO()
    img.save(tmp, format="PNG")
    tmp_path = "/tmp/chemprop_ocr_molnextr.png"
    try:
        with open(tmp_path, "wb") as f:
            f.write(tmp.getvalue())
    except Exception:
        tmp_path = "chemprop_ocr_molnextr.png"
        with open(tmp_path, "wb") as f:
            f.write(tmp.getvalue())
    predictions = model.predict_final_results(tmp_path, return_atoms_bonds=False)
    smiles = predictions.get("predicted_smiles")
    return smiles.strip() if smiles else None


def recognize(data_url):
    """按优先级尝试各引擎，返回 (ok, smiles, source, error)。"""
    try:
        img = decode_image(data_url)
    except Exception as e:
        return False, None, None, f"图片解码失败：{e}"

    engines = [
        ("MolScribe", recognize_with_molscribe),
        ("DECIMER", recognize_with_decimer),
        ("MolNexTR", recognize_with_molnextr),
    ]
    errors = []
    for name, fn in engines:
        try:
            logger.info("正在使用 %s 识别...", name)
            t0 = time.time()
            smiles = fn(img)
            logger.info("%s 耗时 %.2fs，结果：%s", name, time.time() - t0, smiles)
            if smiles:
                return True, smiles, name, None
            errors.append(f"{name}: 未返回 SMILES")
        except Exception as e:
            errors.append(f"{name}: {e}")
            logger.warning("%s 识别异常：%s", name, e)

    return False, None, None, "；".join(errors)


class CORSRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        logger.info("%s - %s", self.client_address[0], format % args)

    def _send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/ocr":
            self._send_json(404, {"ok": False, "error": "未知接口，请 POST /ocr"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0:
                self._send_json(400, {"ok": False, "error": "请求体为空"})
                return
            body = self.rfile.read(length).decode("utf-8")
            data = json.loads(body)
            image = data.get("image")
            if not image:
                self._send_json(400, {"ok": False, "error": "缺少 image 字段"})
                return

            ok, smiles, source, error = recognize(image)
            if ok:
                self._send_json(200, {"ok": True, "smiles": smiles, "source": source})
            else:
                self._send_json(200, {"ok": False, "error": error or "识别失败"})
        except Exception as e:
            logger.error("处理请求异常：%s\n%s", e, traceback.format_exc())
            self._send_json(500, {"ok": False, "error": f"服务器内部错误：{e}"})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json(200, {
                "ok": True,
                "MolScribe": MOLSCRIBE_AVAILABLE,
                "DECIMER": DECIMER_AVAILABLE,
                "MolNexTR": MOLNEXTR_AVAILABLE,
            })
            return
        self._send_json(404, {"ok": False, "error": "未知接口"})


def main():
    parser = argparse.ArgumentParser(description="chem-prop-predictor 本地结构式识别服务")
    parser.add_argument("--port", type=int, default=8765, help="监听端口（默认 8765）")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    args = parser.parse_args()

    if not any([MOLSCRIBE_AVAILABLE, DECIMER_AVAILABLE, MOLNEXTR_AVAILABLE]):
        logger.error("未检测到任何可用识别引擎。请先安装依赖：")
        logger.error("  pip install molscribe decimer molnextr pillow rdkit")
        sys.exit(1)

    server = HTTPServer((args.host, args.port), CORSRequestHandler)
    logger.info("本地 OCR 服务已启动：http://%s:%d", args.host, args.port)
    logger.info("可用引擎：MolScribe=%s, DECIMER=%s, MolNexTR=%s",
                MOLSCRIBE_AVAILABLE, DECIMER_AVAILABLE, MOLNEXTR_AVAILABLE)
    logger.info("在 chem-prop-predictor 图片识别页填入上述地址即可使用。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("收到中断，服务退出。")
        server.shutdown()


if __name__ == "__main__":
    main()
