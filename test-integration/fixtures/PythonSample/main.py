# Servidor mínimo de la prueba. El print no usa flush a propósito: DotPilot debe iniciar Python sin búfer.
import http.server
import os
import socketserver

port = int(os.environ.get("PORT", "5190"))


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"dotpilot-python")

    def log_message(self, *args):
        pass


with socketserver.TCPServer(("127.0.0.1", port), Handler) as server:
    print(f"Serving at http://127.0.0.1:{port}/")
    server.serve_forever()
