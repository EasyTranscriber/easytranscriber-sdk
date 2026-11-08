import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from email.utils import format_datetime
from unittest.mock import AsyncMock, Mock, call

import httpx
import pytest

from easytranscriber_sdk import (
    APIError,
    APIResponseError,
    AsyncEasyTranscriber,
    EasyTranscriber,
)

BASE = "https://www.easytranscriber.com/api/v1"
KEY = "et_test_not_a_real_key"
VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
TRANSCRIPT = {
    "video_id": "dQw4w9WgXcQ",
    "video_title": None,
    "transcript": "Example transcript.",
    "method": "innertube",
    "cached": True,
    "credits_used": 0,
}
SEARCH_RESULT = {
    "video_id": None,
    "channel_id": "UCexample",
    "title": "Example channel",
    "channel": "Example",
    "published_at": "2026-01-01T00:00:00Z",
    "thumbnail": None,
}
VIDEO = {
    "video_id": "dQw4w9WgXcQ",
    "title": "Example video",
    "published_at": "2026-01-01T00:00:00Z",
    "thumbnail": None,
}
REPLY = {
    "author": "Viewer",
    "text": "Helpful explanation.",
    "likes": 2,
    "published_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-01T00:00:00Z",
}
PAGE = {"next_page_token": "next+/=", "total_results": None, "credits_used": 1}


@asynccontextmanager
async def client_for(mode, **kwargs):
    if mode == "sync":
        with EasyTranscriber(KEY, **kwargs) as client:
            yield client
    else:
        async with AsyncEasyTranscriber(KEY, **kwargs) as client:
            yield client


async def invoke(client, method, *args, **kwargs):
    result = getattr(client, method)(*args, **kwargs)
    if isinstance(client, AsyncEasyTranscriber):
        return await result
    return result


@pytest.fixture(params=["sync", "async"])
def mode(request):
    return request.param


@pytest.fixture
def sleeps(monkeypatch):
    sync_sleep = Mock()
    async_sleep = AsyncMock()
    monkeypatch.setattr("easytranscriber_sdk.client.time.sleep", sync_sleep)
    monkeypatch.setattr("easytranscriber_sdk.client.asyncio.sleep", async_sleep)
    return {"sync": sync_sleep, "async": async_sleep}


CASES = [
    (
        "transcribe",
        (VIDEO_URL,),
        {},
        "POST",
        "transcribe",
        {},
        {"url": VIDEO_URL},
        TRANSCRIPT,
    ),
    (
        "summarize",
        ("Example transcript.",),
        {"video_id": "video", "language": "English"},
        "POST",
        "summarize",
        {},
        {"transcript": "Example transcript.", "video_id": "video", "language": "English"},
        {"summary": "Summary text", "video_id": "video", "credits_used": 1},
    ),
    ("credits", (), {}, "GET", "credits", {}, None, {"balance": 42}),
    (
        "search",
        ("science & space",),
        {"type": "channel", "page_token": "next+/="},
        "GET",
        "youtube/search",
        {"q": "science & space", "type": "channel", "page_token": "next+/="},
        None,
        {"results": [SEARCH_RESULT], "next_page_token": "more", "credits_used": 1},
    ),
    (
        "resolve_channel",
        ("@example",),
        {},
        "GET",
        "youtube/channel/resolve",
        {"channel": "@example"},
        None,
        {
            "channel_id": "UCexample",
            "name": "Example",
            "handle": None,
            "subscribers": "12345",
            "thumbnail": None,
        },
    ),
    (
        "channel_latest",
        ("@example",),
        {},
        "GET",
        "youtube/channel/latest",
        {"channel": "@example"},
        None,
        {
            "channel_id": "UCexample",
            "videos": [{**VIDEO, "thumbnail": "https://example.com/v.jpg"}],
        },
    ),
    (
        "channel_search",
        ("@example", "space"),
        {"page_token": "next+/="},
        "GET",
        "youtube/channel/search",
        {"channel": "@example", "q": "space", "page_token": "next+/="},
        None,
        {
            "channel_id": "UCexample",
            "results": [SEARCH_RESULT],
            "next_page_token": None,
            "credits_used": 1,
        },
    ),
    (
        "channel_videos",
        ("@example",),
        {"page_token": "next+/="},
        "GET",
        "youtube/channel/videos",
        {"channel": "@example", "page_token": "next+/="},
        None,
        {"channel_id": "UCexample", "videos": [VIDEO], **PAGE},
    ),
    (
        "playlist_videos",
        ("PLexample",),
        {"page_token": "next+/="},
        "GET",
        "youtube/playlist/videos",
        {"playlist": "PLexample", "page_token": "next+/="},
        None,
        {"playlist_id": "PLexample", "videos": [VIDEO], **PAGE},
    ),
    (
        "comments",
        (VIDEO_URL,),
        {"max_results": 50, "order": "time", "page_token": "next+/="},
        "GET",
        "youtube/comments",
        {"video": VIDEO_URL, "max_results": "50", "order": "time", "page_token": "next+/="},
        None,
        {
            "video_id": "dQw4w9WgXcQ",
            "comments": [{**REPLY, "reply_count": 1, "replies": [REPLY]}],
            **PAGE,
        },
    ),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,args,kwargs,verb,path,params,body,payload", CASES)
async def test_all_endpoints(
    mode, respx_mock, method, args, kwargs, verb, path, params, body, payload
):
    route = respx_mock.route(
        method=verb, host="www.easytranscriber.com", path=f"/api/v1/{path}"
    ).respond(200, json=payload)
    async with client_for(mode) as client:
        result = await invoke(client, method, *args, **kwargs)
        assert result == payload
        assert not client.is_closed
    assert client.is_closed
    # A next_page_token in the response must not trigger a second, billable request.
    assert route.call_count == 1
    request = route.calls[0].request
    assert request.headers["Authorization"] == f"Bearer {KEY}"
    assert request.headers["Accept"] == "application/json"
    assert dict(request.url.params) == params
    if body is not None:
        assert json.loads(request.content) == body
        assert request.headers["Content-Type"] == "application/json"
    else:
        assert request.content == b""


@pytest.mark.asyncio
async def test_summary_omits_unset_fields_and_stream(mode, respx_mock):
    route = respx_mock.post(f"{BASE}/summarize").respond(
        200, json={"summary": "Summary", "video_id": None, "credits_used": 1}
    )
    async with client_for(mode) as client:
        result = await invoke(client, "summarize", "Transcript")
    assert result["video_id"] is None
    assert result["credits_used"] == 1
    assert json.loads(route.calls[0].request.content) == {"transcript": "Transcript"}
    assert not route.calls[0].request.url.params


@pytest.mark.asyncio
async def test_explicit_pagination(mode, respx_mock):
    route = respx_mock.route(
        method="GET", host="www.easytranscriber.com", path="/api/v1/youtube/channel/videos"
    ).mock(
        side_effect=[
            httpx.Response(200, json={"channel_id": "UCexample", "videos": [VIDEO], **PAGE}),
            httpx.Response(
                200,
                json={
                    "channel_id": "UCexample",
                    "videos": [],
                    **PAGE,
                    "next_page_token": None,
                },
            ),
        ]
    )
    async with client_for(mode) as client:
        first = await invoke(client, "channel_videos", "@example")
        assert route.call_count == 1
        second = await invoke(
            client, "channel_videos", "@example", page_token=first["next_page_token"]
        )
    assert second["next_page_token"] is None
    assert dict(route.calls[0].request.url.params) == {"channel": "@example"}
    assert route.calls[1].request.url.params["page_token"] == "next+/="


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,code",
    [
        (400, "invalid_request"),
        (401, "unauthorized"),
        (402, "insufficient_credits"),
        (403, "comments_disabled"),
        (404, "not_found"),
        (500, "transcription_failed"),
        (502, "upstream_error"),
        (503, "unavailable"),
    ],
)
@pytest.mark.parametrize(
    "method,args,path,verb",
    [
        ("transcribe", (VIDEO_URL,), "transcribe", "POST"),
        ("summarize", ("Transcript",), "summarize", "POST"),
        ("search", ("science",), "youtube/search", "GET"),
    ],
)
async def test_only_429_is_retried(
    mode, respx_mock, sleeps, status, code, method, args, path, verb
):
    route = respx_mock.route(
        method=verb, host="www.easytranscriber.com", path=f"/api/v1/{path}"
    ).respond(status, json={"error": {"code": code, "message": "Request failed"}})
    async with client_for(mode) as client:
        with pytest.raises(APIError) as caught:
            await invoke(client, method, *args)
    error = caught.value
    assert (error.status, error.code, error.message) == (status, code, "Request failed")
    assert str(status) in str(error)
    assert KEY not in str(error)
    assert route.call_count == 1
    sleeps[mode].assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("exception", [httpx.ReadTimeout, httpx.ConnectError, httpx.ReadError])
async def test_transport_errors_are_never_retried(mode, respx_mock, sleeps, exception):
    route = respx_mock.post(f"{BASE}/transcribe").mock(side_effect=exception("Connection lost"))
    async with client_for(mode) as client:
        with pytest.raises(exception):
            await invoke(client, "transcribe", VIDEO_URL)
    assert route.call_count == 1
    sleeps[mode].assert_not_called()


@pytest.mark.asyncio
async def test_429_backoff_and_recovery(mode, respx_mock, sleeps):
    route = respx_mock.post(f"{BASE}/transcribe").mock(
        side_effect=[
            httpx.Response(429, json={"error": {"code": "rate_limited", "message": "Wait"}}),
            httpx.Response(429, json={"error": {"code": "rate_limited", "message": "Wait"}}),
            httpx.Response(200, json=TRANSCRIPT),
        ]
    )
    async with client_for(mode) as client:
        assert await invoke(client, "transcribe", VIDEO_URL) == TRANSCRIPT
    assert route.call_count == 3
    assert sleeps[mode].call_args_list == [call(0.5), call(1.0)]
    assert all(json.loads(item.request.content) == {"url": VIDEO_URL} for item in route.calls)


@pytest.mark.asyncio
@pytest.mark.parametrize("max_retries,expected_calls", [(0, 1), (2, 3)])
async def test_retry_exhaustion(mode, respx_mock, sleeps, max_retries, expected_calls):
    route = respx_mock.get(f"{BASE}/credits").respond(
        429, json={"error": {"code": "rate_limited", "message": "Wait"}}
    )
    async with client_for(mode, max_retries=max_retries) as client:
        with pytest.raises(APIError) as caught:
            await invoke(client, "credits")
    assert caught.value.status == 429
    assert caught.value.code == "rate_limited"
    assert route.call_count == expected_calls
    assert sleeps[mode].call_count == expected_calls - 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "retry_after,expected_delay",
    [
        ("7", 7.0),
        ("0", 0.5),
        ("-1", 0.5),
        ("invalid", 0.5),
        ("NaN", 0.5),
        ("inf", 0.5),
        (format_datetime(datetime(2026, 1, 1, 0, 0, 12, tzinfo=timezone.utc), usegmt=True), 12.0),
    ],
)
async def test_retry_after(mode, respx_mock, sleeps, monkeypatch, retry_after, expected_delay):
    monkeypatch.setattr("easytranscriber_sdk.client.time.time", lambda: 1767225600.0)
    route = respx_mock.get(f"{BASE}/credits").mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": retry_after}),
            httpx.Response(200, json={"balance": 10}),
        ]
    )
    async with client_for(mode) as client:
        assert await invoke(client, "credits") == {"balance": 10}
    assert route.call_count == 2
    sleeps[mode].assert_called_once_with(expected_delay)


@pytest.mark.asyncio
async def test_long_retry_after_is_not_shortened(mode, respx_mock, sleeps):
    route = respx_mock.get(f"{BASE}/credits").respond(429, headers={"Retry-After": "61"})
    async with client_for(mode) as client:
        with pytest.raises(APIError) as caught:
            await invoke(client, "credits")
    assert caught.value.status == 429
    assert route.call_count == 1
    sleeps[mode].assert_not_called()


@pytest.mark.asyncio
async def test_backoff_is_capped(mode, respx_mock, sleeps):
    route = respx_mock.get(f"{BASE}/credits").respond(429)
    async with client_for(mode, max_retries=3, retry_backoff=2, max_retry_delay=3) as client:
        with pytest.raises(APIError):
            await invoke(client, "credits")
    assert route.call_count == 4
    assert sleeps[mode].call_args_list == [call(2), call(3), call(3)]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,body", [(502, "<html>Bad gateway</html>"), (401, '{"error": null}')]
)
async def test_nonstandard_errors(mode, respx_mock, status, body):
    respx_mock.get(f"{BASE}/credits").respond(status, text=body)
    async with client_for(mode) as client:
        with pytest.raises(APIError) as caught:
            await invoke(client, "credits")
    assert caught.value.status == status
    assert caught.value.code == "http_error"
    assert "<html>" not in str(caught.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("body", ["not JSON", "[]", "null", '"text"'])
async def test_invalid_success_is_not_retried(mode, respx_mock, sleeps, body):
    route = respx_mock.post(f"{BASE}/summarize").respond(200, text=body)
    async with client_for(mode) as client:
        with pytest.raises(APIResponseError) as caught:
            await invoke(client, "summarize", "Transcript")
    assert caught.value.status == 200
    assert route.call_count == 1
    sleeps[mode].assert_not_called()


@pytest.mark.asyncio
async def test_redirects_are_not_followed(mode, respx_mock):
    route = respx_mock.post(f"{BASE}/transcribe").respond(
        307, headers={"Location": "https://another-host.example/transcribe"}
    )
    async with client_for(mode) as client:
        with pytest.raises(APIError) as caught:
            await invoke(client, "transcribe", VIDEO_URL)
    assert caught.value.status == 307
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_custom_base_url_timeout_and_unknown_fields(mode, respx_mock):
    route = respx_mock.get("http://127.0.0.1:8123/api/v1/credits").respond(
        200, json={"balance": 0, "future_field": "preserved"}
    )
    async with client_for(
        mode, base_url="http://127.0.0.1:8123/api/v1/", timeout=httpx.Timeout(450, connect=10)
    ) as client:
        assert await invoke(client, "credits") == {"balance": 0, "future_field": "preserved"}
    assert route.calls[0].request.extensions["timeout"]["read"] == 450
    assert route.calls[0].request.extensions["timeout"]["connect"] == 10


@pytest.mark.asyncio
async def test_context_manager_closes_on_exception(mode):
    with pytest.raises(RuntimeError, match="user failure"):
        async with client_for(mode) as client:
            raise RuntimeError("user failure")
    assert client.is_closed


@pytest.mark.asyncio
async def test_explicit_close():
    sync_client = EasyTranscriber(KEY)
    sync_client.close()
    sync_client.close()
    assert sync_client.is_closed
    async_client = AsyncEasyTranscriber(KEY)
    await async_client.aclose()
    await async_client.aclose()
    assert async_client.is_closed


@pytest.mark.asyncio
async def test_async_cancellation_is_not_retried(respx_mock, sleeps):
    route = respx_mock.post(f"{BASE}/transcribe").respond(429)
    sleeps["async"].side_effect = asyncio.CancelledError()
    async with AsyncEasyTranscriber(KEY) as client:
        with pytest.raises(asyncio.CancelledError):
            await client.transcribe(VIDEO_URL)
    assert route.call_count == 1
    sleeps["async"].assert_awaited_once_with(0.5)
    assert client.is_closed


@pytest.mark.parametrize("client_type", [EasyTranscriber, AsyncEasyTranscriber])
@pytest.mark.parametrize(
    "kwargs",
    [
        {"max_retries": -1},
        {"max_retries": 1.5},
        {"max_retries": True},
        {"retry_backoff": -1},
        {"retry_backoff": float("nan")},
        {"max_retry_delay": -1},
        {"max_retry_delay": float("inf")},
    ],
)
def test_invalid_retry_configuration(client_type, kwargs):
    with pytest.raises(ValueError):
        client_type(KEY, **kwargs)
