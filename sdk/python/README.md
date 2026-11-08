# EasyTranscriber Python SDK

[![CI](https://github.com/EasyTranscriber/easytranscriber-sdk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/EasyTranscriber/easytranscriber-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PyPI version](https://img.shields.io/pypi/v/easytranscriber-sdk.svg)](https://pypi.org/project/easytranscriber-sdk/)
[![npm version](https://img.shields.io/npm/v/easytranscriber.svg)](https://www.npmjs.com/package/easytranscriber)

Python 3.10+; synchronous and asynchronous clients backed by HTTPX.
Available on [PyPI](https://pypi.org/project/easytranscriber-sdk/).
The examples run on a trusted server or your own machine, never in a browser.

The Python distribution name is `easytranscriber-sdk`; the import name is
`easytranscriber_sdk`. The PyPI package named `easytranscriber` belongs to an
unrelated project and is not this SDK.

## Install from PyPI

```sh
pip install easytranscriber-sdk
```

For Node.js 22 or later, use the [JavaScript / TypeScript SDK](../js/README.md):

```sh
npm install easytranscriber
```

Create an API key in your EasyTranscriber account and supply it through your
process environment as `EASYTRANSCRIBER_API_KEY`. Keys use the `et_` prefix; the
client adds `Authorization: Bearer …`. Do not commit keys or print request
headers. The SDK does not log keys or requests.

The default base URL is `https://www.easytranscriber.com/api/v1`.
[REST API documentation](https://www.easytranscriber.com/docs/api).

## Quickstart

These examples make live API requests and may spend credits; they are not test commands.

```python
import os
from easytranscriber_sdk import EasyTranscriber
with EasyTranscriber(os.environ["EASYTRANSCRIBER_API_KEY"]) as client:
    result = client.transcribe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    print(result["transcript"])
```

## Transcript and summary

```python
import os

from easytranscriber_sdk import EasyTranscriber

with EasyTranscriber(os.environ["EASYTRANSCRIBER_API_KEY"]) as client:
    transcript = client.transcribe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    print(transcript["video_title"], transcript["transcript"])
    print("Transcript credits:", transcript["credits_used"])

    # A separate API call that costs 1 additional credit.
    summary = client.summarize(
        transcript["transcript"],
        video_id=transcript["video_id"],
        language="English",
    )
    print(summary["summary"])
    print("Summary credits:", summary["credits_used"])
    print("Remaining balance:", client.credits()["balance"])
```

`transcribe` does **not** return a summary. `summarize` requires the transcript
text, not just a video URL or ID. `video_id` optionally associates the summary
with a saved transcription; the response has `video_id=None` if omitted.
`language` is optional and takes a display name such as `"English"` or `"Spanish"`,
or `"Auto"` to match the source language, **not** ISO codes such as `"en"`.
Unsupported values are silently ignored by the server. This SDK requests
buffered JSON summaries, not streaming text.

Responses are ordinary dictionaries with exported `TypedDict` models, including
`TranscriptResponse`, `SummaryResponse`, and `CreditsResponse`. There is no
`data` envelope or attribute-access wrapper. Static types describe the route
contract, not runtime schema validation; unknown JSON fields remain available.
Nulls remain `None`, dates remain strings, and `channel["subscribers"]` is a
nullable **string**, not an integer. `video_title`, thumbnails, page tokens, and
total result counts can also be null. `method` is a string (for example
`innertube`, `yt-dlp`, or `deepgram`), not the documentation example `captions`.

## Search

```python
import os

from easytranscriber_sdk import EasyTranscriber

with EasyTranscriber(os.environ["EASYTRANSCRIBER_API_KEY"]) as client:
    page = client.search("space exploration", type="video")
    for result in page["results"]:
        print(result["video_id"], result["title"])

    channel = client.resolve_channel("@NASA")  # No credit cost.
    print(channel["channel_id"], channel["subscribers"])
```

`type="channel"` searches channels instead; results can then have
`video_id=None`. Search returns up to 10 results per request.

## Channel videos and explicit pagination

```python
import os

from easytranscriber_sdk import EasyTranscriber

with EasyTranscriber(os.environ["EASYTRANSCRIBER_API_KEY"]) as client:
    page = client.channel_videos("@NASA")  # 1 credit, up to 50 uploads.
    for video in page["videos"]:
        print(video["title"])

    # Deliberate second request: consumes another credit, not an automatic iterator.
    if page["next_page_token"] is not None:
        next_page = client.channel_videos("@NASA", page_token=page["next_page_token"])
        print(next_page["videos"])
```

The SDK never automatically fetches another page. The same explicit
`page_token=` pattern applies to `search`, `channel_search`, `playlist_videos`,
and `comments`. A token may contain reserved URL characters; pass it unchanged
and HTTPX encodes it. `next_page_token=None` means there is no next page.

## All ten methods

Both clients expose the same arguments and response models. Async methods must
be awaited. Optional arguments below are keyword-only.

- `transcribe(url)` → `TranscriptResponse`: `POST /transcribe`.
- `summarize(transcript, video_id=None, language=None)` → `SummaryResponse`:
  `POST /summarize`, JSON mode only.
- `credits()` → `CreditsResponse`: `GET /credits`, containing `balance`.
- `search(q, type="video", page_token=None)` → `SearchResponse`:
  `GET /youtube/search`; `type` is `video` or `channel`.
- `resolve_channel(channel)` → `ChannelResponse`:
  `GET /youtube/channel/resolve`.
- `channel_latest(channel)` → `ChannelLatestResponse`:
  `GET /youtube/channel/latest`, recent uploads from the channel RSS feed,
  approximately 15 entries, no pagination.
- `channel_search(channel, q, page_token=None)` → `ChannelSearchResponse`:
  `GET /youtube/channel/search`, up to 10 results per page.
- `channel_videos(channel, page_token=None)` → `ChannelVideosResponse`:
  `GET /youtube/channel/videos`, up to 50 uploads per page.
- `playlist_videos(playlist, page_token=None)` → `PlaylistVideosResponse`:
  `GET /youtube/playlist/videos`, playlist ID or URL, up to 50 entries per page.
- `comments(video, max_results=20, order="relevance", page_token=None)` →
  `CommentsResponse`: `GET /youtube/comments`, video URL or ID, `order` can be
  `relevance` or `time`. The server clamps `max_results` to 1–100. Each comment
  includes `reply_count` and the replies returned by YouTube; these are not
  guaranteed to be all replies.

Channel arguments accept `@handle`, a channel URL, or a `UC...` channel ID.

## Async and connection cleanup

```python
import asyncio
import os

from easytranscriber_sdk import AsyncEasyTranscriber

async def main() -> None:
    async with AsyncEasyTranscriber(os.environ["EASYTRANSCRIBER_API_KEY"]) as client:
        latest = await client.channel_latest("@NASA")
        print(latest["videos"])
        print((await client.credits())["balance"])

asyncio.run(main())
```

Reuse a client for connection pooling. `with` / `async with` close it even if an
exception is raised. Without a context manager, call `client.close()` or
`await client.aclose()`. `client.is_closed` reports lifecycle state. A closed
client cannot be reopened.

## Errors, retries, and timeouts

```python
import os

import httpx
from easytranscriber_sdk import APIError, APIResponseError, EasyTranscriber

with EasyTranscriber(os.environ["EASYTRANSCRIBER_API_KEY"], max_retries=2) as client:
    try:
        transcript = client.transcribe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    except APIError as error:
        print(error.status, error.code, error.message)
        # Examples: 401 unauthorized, 402 insufficient_credits, 429 rate_limited.
    except APIResponseError:
        print("The API did not return a JSON object; do not blindly retry.")
    except httpx.RequestError:
        print("Network outcome unknown; check your balance/history before retrying.")
```

Non-success responses raise `APIError` with `status`, `code`, and `message`,
parsed from `{ "error": { "code": "…", "message": "…" } }`. Non-JSON or malformed
error bodies use `code="http_error"` and the HTTP reason phrase; HTML is not
included in the error. Successful non-object/non-JSON responses raise
`APIResponseError`. HTTPX transport errors propagate unchanged.

Only **HTTP 429** is retried. Authentication rate limiting occurs before billing.
The default is at most **2 retries** (3 total attempts), with 0.5s then 1s
exponential backoff. `Retry-After` seconds and HTTP dates are honored when
present. Each wait is capped by `max_retry_delay` (default 60s); if the server
asks for longer than that, the client raises the 429 immediately rather than
retrying too early. Invalid `Retry-After` values fall back to backoff.
`max_retries=0` disables retries; `retry_backoff` and `max_retry_delay` are
configurable non-negative finite seconds. Async waits do not block the event loop.

There are **no automatic retries for network failures, timeouts, or 5xx errors**,
including billable GET requests. The server might already have charged credits
before the response was lost. Redirects are not followed. Cancellation propagates.

The default HTTPX timeout is **310 seconds per network operation**, allowing the
server's 300-second processing window. It is not a total operation deadline;
retries and waits add time. Override with `timeout=450.0`, an `httpx.Timeout`
instance, or `timeout=None` to disable timeouts. `base_url=` accepts a complete
API prefix, including `/api/v1`; use plain HTTP only for trusted local testing.

## Credit costs

- Transcript: 0 credits when cached; a new transcript costs 1 credit, or 2 for
  videos longer than 2 hours. Maximum video duration is 4 hours.
- Summary: **1 separate API credit per request**, even for a cached transcript.
  The web/extension/mobile first-summary inclusion does not apply to this API.
- Search, channel search, channel videos, playlist videos, comments: 1 credit
  **per request/page**.
- Balance lookup, channel resolution, and channel latest: no credit cost. These
  responses do not invent a `credits_used` field.

Use actual `credits_used` responses and `credits()["balance"]` for accounting.
A cached transcript does not incur a transcript charge; its summary still does.
API rate limits depend on plan: Free/Plus 10, Pro 50, Scale 300 requests/minute.

## Development and packaging

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development, tests and package verification.
Tests use fixtures and loopback HTTP, not production credentials or credits.

Licensed under the [MIT License](LICENSE). Copyright (c) 2026 EasyTranscriber.
