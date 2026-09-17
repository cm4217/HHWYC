import os
import threading
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler

# 本地默认 127.0.0.1:8080，避免 Windows 上撞 3000 / 绑定 0.0.0.0 权限问题。
# 云部署可设 HOST=0.0.0.0 与平台注入的 PORT。
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8080"))
ROOT = os.path.dirname(os.path.abspath(__file__))
# 设 NO_BROWSER=1 可关闭自动打开浏览器
OPEN_BROWSER = os.environ.get("NO_BROWSER", "").strip() not in ("1", "true", "TRUE", "yes", "YES")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass


def _open_browser(url: str) -> None:
    try:
        webbrowser.open(url)
    except Exception:
        pass


if __name__ == "__main__":
    try:
        server = HTTPServer((HOST, PORT), Handler)
    except OSError as e:
        print(f"无法绑定 {HOST}:{PORT}（{e}）。", flush=True)
        print("端口可能已被占用。请换端口后重试，例如：", flush=True)
        print("  Windows PowerShell:  $env:PORT=8090; python serve.py", flush=True)
        print("  CMD:                 set PORT=8090 && python serve.py", flush=True)
        print("  或：                 PORT=8090 python serve.py", flush=True)
        raise SystemExit(1) from e

    url = f"http://{HOST}:{PORT}/"
    print(f"Static server listening on {url}  root={ROOT}", flush=True)
    print("按 Ctrl+C 停止服务", flush=True)
    if OPEN_BROWSER and HOST in ("127.0.0.1", "localhost"):
        threading.Timer(0.6, _open_browser, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止", flush=True)
    finally:
        server.server_close()
