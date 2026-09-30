"""Serve the logo scene, collect rendered frames, and encode them.

GET  /scene.html              the authoring scene; /gallery.html compares variants
POST /frame?name=X&i=N        a PNG frame, saved to frames/X/NNNN.png
POST /encode?name=X           frames/X -> out/X.mp4 (preview size) for the gallery
Publish one to public/ with encode.sh X.
"""
import os
import re
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        name = q.get("name", [""])[0]
        if not re.fullmatch(r"[a-z0-9-]+", name):
            self.send_error(400, "bad name")
            return
        frames = os.path.join(HERE, "frames", name)
        if url.path == "/frame":
            i = int(q["i"][0])
            body = self.rfile.read(int(self.headers["Content-Length"]))
            os.makedirs(frames, exist_ok=True)
            with open(os.path.join(frames, f"{i:04d}.png"), "wb") as f:
                f.write(body)
        elif url.path == "/encode":
            os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
            subprocess.run([
                "ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-i", os.path.join(frames, "%04d.png"),
                "-vf", "scale=384:384:flags=lanczos", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                "-movflags", "+faststart", "-an", os.path.join(HERE, "out", f"{name}.mp4"),
            ], check=True)
        else:
            self.send_error(404)
            return
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5199))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
