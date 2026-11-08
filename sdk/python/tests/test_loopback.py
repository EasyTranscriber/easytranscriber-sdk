"""Run against an installed wheel: no PYTHONPATH or editable source dependency."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from easytranscriber_sdk import AsyncEasyTranscriber, EasyTranscriber

KEY = "et_loopback_not_a_real_key"


@pytest.fixture
def loopback_server():
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass  # Keep test credentials and request contents out of server logs.

        def respond(self, payload, status=200):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def record(self, body=None):
            requests.append(
                {
                    "method": self.command,
                    "path": self.path,
                    "authorization": self.headers.get("Authorization"),
                    "body": body,
                }
            )

        def do_GET(self):
            self.record()
            if self.path == "/api/v1/credits":
                self.respond({"balance": 9})
            else:
                self.respond({"error": {"code": "not_found", "message": "Unknown path"}}, 404)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            self.record(body)
            if self.path == "/api/v1/transcribe":
                self.respond(
                    {
                        "video_id": "dQw4w9WgXcQ",
                        "video_title": None,
                        "transcript": "Loopback transcript",
                        "method": "innertube",
                        "cached": True,
                        "credits_used": 0,
                    }
                )
            elif self.path == "/api/v1/summarize":
                self.respond(
                    {
                        "summary": "Loopback summary",
                        "video_id": body.get("video_id"),
                        "credits_used": 1,
                    }
                )
            else:
                self.respond({"error": {"code": "not_found", "message": "Unknown path"}}, 404)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/api/v1", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def assert_wire_requests(requests):
    assert len(requests) == 3
    assert all(request["authorization"] == f"Bearer {KEY}" for request in requests)
    assert requests[0]["method"] == "POST"
    assert requests[0]["path"] == "/api/v1/transcribe"
    assert requests[0]["body"] == {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
    assert requests[1]["path"] == "/api/v1/summarize"
    assert requests[1]["body"] == {
        "transcript": "Loopback transcript",
        "video_id": "dQw4w9WgXcQ",
    }
    assert requests[2]["method"] == "GET"
    assert requests[2]["path"] == "/api/v1/credits"


def test_sync_packaged_client(loopback_server):
    base_url, requests = loopback_server
    with EasyTranscriber(KEY, base_url=base_url) as client:
        transcript = client.transcribe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assert transcript["video_title"] is None
        assert transcript["credits_used"] == 0
        summary = client.summarize(transcript["transcript"], video_id=transcript["video_id"])
        assert summary["summary"] == "Loopback summary"
        assert summary["credits_used"] == 1
        assert client.credits()["balance"] == 9
    assert client.is_closed
    assert_wire_requests(requests)


@pytest.mark.asyncio
async def test_async_packaged_client(loopback_server):
    base_url, requests = loopback_server
    async with AsyncEasyTranscriber(KEY, base_url=base_url) as client:
        transcript = await client.transcribe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assert transcript["video_title"] is None
        assert transcript["credits_used"] == 0
        summary = await client.summarize(transcript["transcript"], video_id=transcript["video_id"])
        assert summary["summary"] == "Loopback summary"
        assert summary["credits_used"] == 1
        assert (await client.credits())["balance"] == 9
    assert client.is_closed
    assert_wire_requests(requests)
