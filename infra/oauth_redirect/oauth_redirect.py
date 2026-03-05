#!/usr/bin/env python3
"""
OAuth redirect + token exchange for Google Sign-In.
- GET /oauth/google/callback?code=...&state=... → redirect to lifeos:// so the app gets the code.
- POST /oauth/exchange → body { code, code_verifier, redirect_uri }; exchange with Google (client_secret);
  return { access_token, refresh_token, expires_in } so the app can store tokens without needing client_secret.

Set env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. redirect_uri in request must match the Web client config.
"""
import json
import os
import urllib.parse
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 3090
CALLBACK_PATH = "/oauth/google/callback"
EXCHANGE_PATH = "/oauth/exchange"

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


class OAuthRedirectHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == CALLBACK_PATH:
            qs = parsed.query
            location = "lifeos://oauth" + ("?" + qs if qs else "")
            self.send_response(302)
            self.send_header("Location", location)
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != EXCHANGE_PATH:
            self.send_response(404)
            self.end_headers()
            return

        client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
        if not client_id or not client_secret:
            self._send_json(400, {"error": "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            data = json.loads(body)
        except (ValueError, json.JSONDecodeError) as e:
            self._send_json(400, {"error": "Invalid JSON body", "detail": str(e)})
            return

        code = data.get("code") or data.get("authorization_code")
        code_verifier = data.get("code_verifier")
        redirect_uri = data.get("redirect_uri")
        if not code or not code_verifier or not redirect_uri:
            self._send_json(400, {"error": "Missing code, code_verifier, or redirect_uri"})
            return

        # Exchange code for tokens (Web client: client_secret + PKCE code_verifier)
        payload = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
            "code_verifier": code_verifier,
        }
        req = urllib.request.Request(
            GOOGLE_TOKEN_URL,
            data=urllib.parse.urlencode(payload).encode("utf-8"),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                token_data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8") if e.fp else ""
            try:
                err_json = json.loads(err_body)
            except json.JSONDecodeError:
                err_json = {"error": err_body or str(e)}
            self._send_json(e.code, err_json)
            return
        except Exception as e:
            self._send_json(502, {"error": "Token exchange failed", "detail": str(e)})
            return

        self._send_json(200, {
            "access_token": token_data.get("access_token"),
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in", 3600),
        })

    def _send_json(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), OAuthRedirectHandler)
    server.serve_forever()
