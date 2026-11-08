"""HTTPX-backed clients. Only HTTP 429 responses are retried."""

from __future__ import annotations

import asyncio
import math
import time
from datetime import timezone
from email.utils import parsedate_to_datetime
from types import TracebackType
from typing import cast

import httpx

from .errors import APIError, APIResponseError
from .models import (
    ChannelLatestResponse,
    ChannelResponse,
    ChannelSearchResponse,
    ChannelVideosResponse,
    CommentOrder,
    CommentsResponse,
    CreditsResponse,
    PlaylistVideosResponse,
    SearchResponse,
    SearchType,
    SummaryResponse,
    TranscriptResponse,
)

DEFAULT_BASE_URL = "https://www.easytranscriber.com/api/v1"
DEFAULT_TIMEOUT = 310.0


def _values(**values: str | int | None) -> dict[str, str | int]:
    return {key: value for key, value in values.items() if value is not None}


def _decode(response: httpx.Response) -> dict[str, object]:
    try:
        body = response.json()
    except ValueError:
        body = None
    if not response.is_success:
        code = "http_error"
        message = response.reason_phrase or "Request failed"
        if isinstance(body, dict) and isinstance(body.get("error"), dict):
            error = body["error"]
            if isinstance(error.get("code"), str):
                code = error["code"]
            if isinstance(error.get("message"), str):
                message = error["message"]
        raise APIError(response.status_code, code, message)
    if not isinstance(body, dict):
        raise APIResponseError(response.status_code)
    return cast(dict[str, object], body)


class _RetryPolicy:
    def __init__(self, max_retries: int, retry_backoff: float, max_retry_delay: float) -> None:
        if isinstance(max_retries, bool) or not isinstance(max_retries, int) or max_retries < 0:
            raise ValueError("max_retries must be a non-negative integer")
        if not math.isfinite(retry_backoff) or retry_backoff < 0:
            raise ValueError("retry_backoff must be finite and non-negative")
        if not math.isfinite(max_retry_delay) or max_retry_delay < 0:
            raise ValueError("max_retry_delay must be finite and non-negative")
        self.max_retries = max_retries
        self.retry_backoff = min(retry_backoff, max_retry_delay)
        self.max_retry_delay = max_retry_delay

    def delay(self, response: httpx.Response, attempt: int, backoff: float) -> float | None:
        if response.status_code != 429 or attempt >= self.max_retries:
            return None
        retry_after = response.headers.get("Retry-After")
        if retry_after is None:
            return backoff
        try:
            seconds = float(retry_after)
        except ValueError:
            try:
                date = parsedate_to_datetime(retry_after)
                if date.tzinfo is None:
                    date = date.replace(tzinfo=timezone.utc)
                seconds = date.timestamp() - time.time()
            except (ValueError, TypeError, OverflowError):
                return backoff
        if not math.isfinite(seconds):
            return backoff
        # Do not retry sooner than the server requests. If its delay exceeds
        # our bound, surface the 429 instead of sleeping indefinitely.
        seconds = max(0.0, seconds)
        if seconds > self.max_retry_delay:
            return None
        return max(backoff, seconds)


def _headers(api_key: str) -> dict[str, str]:
    if not api_key.strip():
        raise ValueError("api_key must not be empty")
    return {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}


class EasyTranscriber:
    """Synchronous client; use with a context manager or call close()."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float | httpx.Timeout | None = DEFAULT_TIMEOUT,
        max_retries: int = 2,
        retry_backoff: float = 0.5,
        max_retry_delay: float = 60.0,
    ) -> None:
        self._retry = _RetryPolicy(max_retries, retry_backoff, max_retry_delay)
        self._client = httpx.Client(
            base_url=base_url.rstrip("/") + "/",
            headers=_headers(api_key),
            timeout=timeout,
            follow_redirects=False,
        )

    @property
    def is_closed(self) -> bool:
        return self._client.is_closed

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> EasyTranscriber:
        self._client.__enter__()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str | int] | None = None,
        json: dict[str, str | int] | None = None,
    ) -> dict[str, object]:
        backoff = self._retry.retry_backoff
        for attempt in range(self._retry.max_retries + 1):
            response = self._client.request(method, path, params=params, json=json)
            delay = self._retry.delay(response, attempt, backoff)
            if delay is None:
                return _decode(response)
            response.close()
            time.sleep(delay)
            backoff = min(backoff * 2, self._retry.max_retry_delay)
        raise AssertionError("unreachable")

    def transcribe(self, url: str) -> TranscriptResponse:
        """Transcribe a YouTube URL; this does not generate a summary."""
        return cast(TranscriptResponse, self._request("POST", "transcribe", json={"url": url}))

    def summarize(
        self, transcript: str, *, video_id: str | None = None, language: str | None = None
    ) -> SummaryResponse:
        """Generate a non-streaming JSON summary for one separate API credit."""
        return cast(
            SummaryResponse,
            self._request(
                "POST",
                "summarize",
                json=_values(transcript=transcript, video_id=video_id, language=language),
            ),
        )

    def credits(self) -> CreditsResponse:
        return cast(CreditsResponse, self._request("GET", "credits"))

    def search(
        self, q: str, *, type: SearchType = "video", page_token: str | None = None
    ) -> SearchResponse:
        return cast(
            SearchResponse,
            self._request(
                "GET", "youtube/search", params=_values(q=q, type=type, page_token=page_token)
            ),
        )

    def resolve_channel(self, channel: str) -> ChannelResponse:
        return cast(
            ChannelResponse,
            self._request("GET", "youtube/channel/resolve", params={"channel": channel}),
        )

    def channel_latest(self, channel: str) -> ChannelLatestResponse:
        return cast(
            ChannelLatestResponse,
            self._request("GET", "youtube/channel/latest", params={"channel": channel}),
        )

    def channel_search(
        self, channel: str, q: str, *, page_token: str | None = None
    ) -> ChannelSearchResponse:
        return cast(
            ChannelSearchResponse,
            self._request(
                "GET",
                "youtube/channel/search",
                params=_values(channel=channel, q=q, page_token=page_token),
            ),
        )

    def channel_videos(
        self, channel: str, *, page_token: str | None = None
    ) -> ChannelVideosResponse:
        return cast(
            ChannelVideosResponse,
            self._request(
                "GET",
                "youtube/channel/videos",
                params=_values(channel=channel, page_token=page_token),
            ),
        )

    def playlist_videos(
        self, playlist: str, *, page_token: str | None = None
    ) -> PlaylistVideosResponse:
        return cast(
            PlaylistVideosResponse,
            self._request(
                "GET",
                "youtube/playlist/videos",
                params=_values(playlist=playlist, page_token=page_token),
            ),
        )

    def comments(
        self,
        video: str,
        *,
        max_results: int = 20,
        order: CommentOrder = "relevance",
        page_token: str | None = None,
    ) -> CommentsResponse:
        return cast(
            CommentsResponse,
            self._request(
                "GET",
                "youtube/comments",
                params=_values(
                    video=video, max_results=max_results, order=order, page_token=page_token
                ),
            ),
        )


class AsyncEasyTranscriber:
    """Asynchronous client; use async with or await aclose()."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float | httpx.Timeout | None = DEFAULT_TIMEOUT,
        max_retries: int = 2,
        retry_backoff: float = 0.5,
        max_retry_delay: float = 60.0,
    ) -> None:
        self._retry = _RetryPolicy(max_retries, retry_backoff, max_retry_delay)
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/") + "/",
            headers=_headers(api_key),
            timeout=timeout,
            follow_redirects=False,
        )

    @property
    def is_closed(self) -> bool:
        return self._client.is_closed

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> AsyncEasyTranscriber:
        await self._client.__aenter__()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str | int] | None = None,
        json: dict[str, str | int] | None = None,
    ) -> dict[str, object]:
        backoff = self._retry.retry_backoff
        for attempt in range(self._retry.max_retries + 1):
            response = await self._client.request(method, path, params=params, json=json)
            delay = self._retry.delay(response, attempt, backoff)
            if delay is None:
                return _decode(response)
            await response.aclose()
            await asyncio.sleep(delay)
            backoff = min(backoff * 2, self._retry.max_retry_delay)
        raise AssertionError("unreachable")

    async def transcribe(self, url: str) -> TranscriptResponse:
        """Transcribe a YouTube URL; this does not generate a summary."""
        return cast(
            TranscriptResponse, await self._request("POST", "transcribe", json={"url": url})
        )

    async def summarize(
        self, transcript: str, *, video_id: str | None = None, language: str | None = None
    ) -> SummaryResponse:
        """Generate a non-streaming JSON summary for one separate API credit."""
        return cast(
            SummaryResponse,
            await self._request(
                "POST",
                "summarize",
                json=_values(transcript=transcript, video_id=video_id, language=language),
            ),
        )

    async def credits(self) -> CreditsResponse:
        return cast(CreditsResponse, await self._request("GET", "credits"))

    async def search(
        self, q: str, *, type: SearchType = "video", page_token: str | None = None
    ) -> SearchResponse:
        return cast(
            SearchResponse,
            await self._request(
                "GET", "youtube/search", params=_values(q=q, type=type, page_token=page_token)
            ),
        )

    async def resolve_channel(self, channel: str) -> ChannelResponse:
        return cast(
            ChannelResponse,
            await self._request("GET", "youtube/channel/resolve", params={"channel": channel}),
        )

    async def channel_latest(self, channel: str) -> ChannelLatestResponse:
        return cast(
            ChannelLatestResponse,
            await self._request("GET", "youtube/channel/latest", params={"channel": channel}),
        )

    async def channel_search(
        self, channel: str, q: str, *, page_token: str | None = None
    ) -> ChannelSearchResponse:
        return cast(
            ChannelSearchResponse,
            await self._request(
                "GET",
                "youtube/channel/search",
                params=_values(channel=channel, q=q, page_token=page_token),
            ),
        )

    async def channel_videos(
        self, channel: str, *, page_token: str | None = None
    ) -> ChannelVideosResponse:
        return cast(
            ChannelVideosResponse,
            await self._request(
                "GET",
                "youtube/channel/videos",
                params=_values(channel=channel, page_token=page_token),
            ),
        )

    async def playlist_videos(
        self, playlist: str, *, page_token: str | None = None
    ) -> PlaylistVideosResponse:
        return cast(
            PlaylistVideosResponse,
            await self._request(
                "GET",
                "youtube/playlist/videos",
                params=_values(playlist=playlist, page_token=page_token),
            ),
        )

    async def comments(
        self,
        video: str,
        *,
        max_results: int = 20,
        order: CommentOrder = "relevance",
        page_token: str | None = None,
    ) -> CommentsResponse:
        return cast(
            CommentsResponse,
            await self._request(
                "GET",
                "youtube/comments",
                params=_values(
                    video=video, max_results=max_results, order=order, page_token=page_token
                ),
            ),
        )
