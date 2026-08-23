from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from html import unescape
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from xml.etree import ElementTree

SOURCES = [
    ("雪球", "https://xueqiu.com/hots/topic/rss"),
    ("虎嗅", "https://rss.huxiu.com"),
    ("彭博", "https://bbg.buzzing.cc/feed.xml"),
]


def plain_text(value: str) -> str:
    """Turn RSS HTML snippets into short, readable mobile summaries."""
    value = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", unescape(value)).strip()

def text(node, *names):
    for name in names:
        found = node.find(name)
        if found is not None and found.text:
            return found.text.strip()
    return ""

def fetch(name, url):
    request = Request(url, headers={"User-Agent": "FindnessRSS/1.0"})
    with urlopen(request, timeout=12) as response:
        root = ElementTree.fromstring(response.read())
    items = root.findall(".//item") + root.findall(".//{http://www.w3.org/2005/Atom}entry")
    result = []
    for item in items[:8]:
        link = text(item, "link") or next((node.attrib.get("href", "") for node in item.findall("{http://www.w3.org/2005/Atom}link") if node.attrib.get("href")), "")
        title = plain_text(text(item, "title", "{http://www.w3.org/2005/Atom}title"))
        summary = plain_text(text(item, "description", "{http://www.w3.org/2005/Atom}summary", "{http://www.w3.org/2005/Atom}content"))
        if title and link:
            result.append({"id": f"{name}:{link}", "title": title, "summary": summary[:280], "url": link, "source": name})
    return result

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        source_articles = []
        for name, url in SOURCES:
            try:
                source_articles.append(fetch(name, url))
            except Exception:
                # A single upstream feed being down must not hide the others.
                source_articles.append([])

        # Interleave sources so the first screen offers breadth rather than a
        # long single-source run. URL de-duplication covers mirrored stories.
        articles, seen_urls = [], set()
        for offset in range(8):
            for source in source_articles:
                if offset >= len(source):
                    continue
                article = source[offset]
                if article["url"] not in seen_urls:
                    articles.append(article)
                    seen_urls.add(article["url"])

        data = json.dumps(
            {"generatedAt": datetime.now(timezone.utc).isoformat(), "items": articles[:15]},
            ensure_ascii=False,
        ).encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=0, s-maxage=600, stale-while-revalidate=900")
        self.end_headers()
        self.wfile.write(data)
