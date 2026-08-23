from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from mobile_briefing import build_briefing, clamp_limit, load_csv, parse_reference_ids

ROOT = Path(__file__).resolve().parents[2]


class handler(BaseHTTPRequestHandler):
    def send_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=0, s-maxage=900, stale-while-revalidate=1800")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        query = parse_qs(urlparse(self.path).query)
        payload = build_briefing(
            load_csv(ROOT / "discovery-signals.csv"),
            load_csv(ROOT / "stock-pool.csv"),
            parse_reference_ids(query.get("reference_ids", [None])[0]),
            clamp_limit(query.get("limit", [None])[0]),
        )
        self.send_json(payload)
