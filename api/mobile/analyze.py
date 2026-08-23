from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SYSTEM_PROMPT = """你是 Findness（GeminiStocks 的 iOS 版）的投资挖掘助手。用中文输出 JSON，字段必须为 investmentScore、informationGapScore、conclusion、upsideCase、riskCases、whatHappened、impactPath、supportingEvidence、uncertainties、nextChecks、disclaimer。investmentScore 和 informationGapScore 为 0-100 整数；其余字段除 disclaimer 外均为字符串数组；conclusion 只能有一项。投资吸引力衡量继续研究价值，信息差衡量市场可能尚未充分消化的程度，不代表收益预测。严格区分事实、推断和待确认内容；不提供买卖建议，不编造实时数据或来源。"""


class handler(BaseHTTPRequestHandler):
    def send_json(self, payload: dict[str, object], status: HTTPStatus) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length))
            question = str(body.get("input", "")).strip()
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": {"code": "INVALID_REQUEST", "message": "请输入想研究的内容。"}}, HTTPStatus.BAD_REQUEST); return
        if not 2 <= len(question) <= 4000:
            self.send_json({"error": {"code": "INVALID_INPUT", "message": "研究内容请保持在 2 到 4000 个字符内。"}}, HTTPStatus.BAD_REQUEST); return
        key = os.environ.get("DEEPSEEK_API_KEY")
        if not key:
            self.send_json({"error": {"code": "AI_NOT_CONFIGURED", "message": "AI 服务暂未配置。"}}, HTTPStatus.SERVICE_UNAVAILABLE); return
        request = Request("https://api.deepseek.com/chat/completions", data=json.dumps({"model": os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash"), "response_format": {"type": "json_object"}, "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": question}], "temperature": 0.3, "max_tokens": 1800}).encode(), headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=55) as response:
                raw = json.loads(response.read())
            report = json.loads(raw["choices"][0]["message"]["content"])
            self.send_json({"schemaVersion": "1.0", "input": question, "report": report}, HTTPStatus.OK)
        except HTTPError as error:
            self.send_json({"error": {"code": "AI_PROVIDER_" + str(error.code), "message": "AI 服务暂时不可用，请稍后重试。"}}, HTTPStatus.BAD_GATEWAY)
        except (URLError, KeyError, IndexError, json.JSONDecodeError):
            self.send_json({"error": {"code": "AI_UNAVAILABLE", "message": "AI 分析暂时不可用，请稍后重试。"}}, HTTPStatus.BAD_GATEWAY)
