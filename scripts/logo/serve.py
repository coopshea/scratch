"""Serve the logo scene and collect rendered frames.

GET  /scene.html        the authoring scene
POST /frame?i=N         a PNG frame, saved to scripts/logo/frames/NNNN.png
Then encode with scripts/logo/encode.sh.
"""
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, "frames")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/frame":
            self.send_error(404)
            return
        i = int(parse_qs(url.query)["i"][0])
        body = self.rfile.read(int(self.headers["Content-Length"]))
        os.makedirs(FRAMES, exist_ok=True)
        with open(os.path.join(FRAMES, f"{i:04d}.png"), "wb") as f:
            f.write(body)
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5199))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
