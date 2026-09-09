import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

# 本地默认 127.0.0.1:8080，避免 Windows 上撞 3000 / 绑定 0.0.0.0 权限问题。
# 云部署可设 HOST=0.0.0.0 与平台注入的 PORT。
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8080"))
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        # 减少日志噪音
        pass


if __name__ == "__main__":
    server = HTTPServer((HOST, PORT), Handler)
    print(f"Static server listening on http://{HOST}:{PORT}/  root={ROOT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
