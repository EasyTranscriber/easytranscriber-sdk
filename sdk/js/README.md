# EasyTranscriber JavaScript / TypeScript SDK

[![CI](https://github.com/EasyTranscriber/easytranscriber-sdk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/EasyTranscriber/easytranscriber-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/easytranscriber.svg)](https://www.npmjs.com/package/easytranscriber)
[![PyPI version](https://img.shields.io/pypi/v/easytranscriber-sdk.svg)](https://pypi.org/project/easytranscriber-sdk/)

Version 0.1.0. A server-side client for all ten EasyTranscriber REST v1 endpoints, using native `fetch` with no runtime dependencies. Requires Node.js 22 or later. Includes ESM, CommonJS, and separate declaration exports for both module formats.

Available on [npm](https://www.npmjs.com/package/easytranscriber).

Licensed under the [MIT License](LICENSE). Copyright (c) 2026 EasyTranscriber.

## Install from npm

```sh
npm install easytranscriber
```

For Python 3.10 or later, use the [Python SDK](../python/README.md):

```sh
pip install easytranscriber-sdk
```

Create an API key at [Dashboard → API Keys](https://www.easytranscriber.com/dashboard/api-keys). Configure `EASYTRANSCRIBER_API_KEY` through your server's secret manager or environment. The SDK sends `Authorization: Bearer <key>`; keys start with `et_`. It does not read the environment automatically.

Never use the SDK or embed an API key in a browser bundle, client component, public environment variable, mobile app, or logs. The constructor rejects browser execution. API keys are stored in private class fields, and the SDK does not log requests.

## Transcript and separate JSON summary

Run this as server-side ESM (for example, an `.mjs` file):

```js
import { EasyTranscriber } from "easytranscriber";

const apiKey = process.env.EASYTRANSCRIBER_API_KEY;
if (!apiKey) throw new Error("Configure EASYTRANSCRIBER_API_KEY on the server");
const client = new EasyTranscriber({ apiKey });

const transcript = await client.transcribe({
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
});
console.log(transcript.transcript, transcript.credits_used);

// This is another billed request: summaries cost 1 additional API credit.
const summary = await client.summarize({
  transcript: transcript.transcript,
  video_id: transcript.video_id, // optional; associates the summary with history
  language: "English", // optional display name; "Auto" matches the source language
});
console.log(summary.summary, summary.credits_used);
console.log((await client.credits()).balance);
```

REST transcription **does not include a summary**. A new transcript costs 1 credit, or 2 for a video longer than two hours; cached transcripts cost 0. Videos longer than four hours are rejected. `summarize` costs 1 separate credit even when transcription was cached. This differs from the first-summary inclusion on the web, extension, and mobile surfaces.

Summary requests use buffered JSON only; streaming is not exposed. The result is `{ summary, video_id, credits_used }`, with `video_id: null` when omitted. Summary languages are display names such as `"English"` and `"Spanish"`, or `"Auto"`, not ISO codes such as `"en"`. Unsupported values fall back to the server default. Transcript results contain `video_id`, nullable `video_title`, `transcript`, `method`, `cached`, and `credits_used`.

CommonJS works with the same API (use an async function for calls):

```js
const { EasyTranscriber } = require("easytranscriber");
```

Types are exported with the client:

```ts
import { EasyTranscriber, type TranscribeResponse } from "easytranscriber";

async function getTranscript(client: EasyTranscriber): Promise<TranscribeResponse> {
  return client.transcribe({ url: "https://youtu.be/dQw4w9WgXcQ" });
}
```

## Search and explicit pagination

All request and response fields retain their API `snake_case` names. Responses are plain JSON objects, **not** `{ data: ... }` envelopes. Each call retrieves only one page. There are no auto-pagination helpers or hidden requests to spend credits.

```js
const firstSearchPage = await client.search({ q: "TypeScript tutorial", type: "video" });
console.log(firstSearchPage.results);
if (firstSearchPage.next_page_token) {
  // Explicitly choosing another page spends another credit.
  const secondSearchPage = await client.search({
    q: "TypeScript tutorial",
    type: "video", // "channel" is also supported
    page_token: firstSearchPage.next_page_token,
  });
  console.log(secondSearchPage.results);
}

const firstUploadsPage = await client.channelVideos({ channel: "@GoogleDevelopers" });
console.log(firstUploadsPage.videos, firstUploadsPage.total_results);
if (firstUploadsPage.next_page_token) {
  const secondUploadsPage = await client.channelVideos({
    channel: "@GoogleDevelopers",
    page_token: firstUploadsPage.next_page_token,
  });
  console.log(secondUploadsPage.videos);
}
```

Channel inputs accept `@handle`, a channel URL, or a `UC...` ID. A null `next_page_token` means there is no next page. Search returns up to 10 results; channel and playlist videos return up to 50 per page. `total_results` may be null. Dates remain strings rather than being converted into `Date` objects.

## Remaining endpoints

These examples each perform a request; run only the calls you intend to make:

```js
// Free (still authenticated and rate limited):
const channel = await client.resolveChannel({ channel: "@GoogleDevelopers" });
const latest = await client.channelLatest({ channel: "@GoogleDevelopers" });
const credits = await client.credits();

// 1 credit per requested page:
const matches = await client.channelSearch({ channel: "@GoogleDevelopers", q: "TypeScript" });
const playlist = await client.playlistVideos({ playlist: "https://www.youtube.com/playlist?list=YOUR_PLAYLIST_ID" });
const comments = await client.comments({
  video: "dQw4w9WgXcQ", // video ID or YouTube URL
  max_results: 20, // server default 20; clamped to 1–100
  order: "relevance", // or "time"
});
```

`channelSearch`, `playlistVideos`, and `comments` also accept `page_token` for an explicitly requested next page. Search and channel search cost 1 credit per call/page. Channel resolve and latest return no `credits_used` field; `credits` returns only `{ balance }`. Latest is the RSS feed's recent videos, not a paginated archive. Comments contain top-level threads and available replies; `reply_count` may exceed the included replies.

`resolveChannel().subscribers` is a **string or null**: the SDK preserves YouTube's decimal string rather than coercing it to a number. Nullable `video_title`, thumbnails, and channel details remain null when unavailable.

## Errors, retries, and timeouts

```js
import { APIError, NetworkError, ResponseError, TimeoutError } from "easytranscriber";

try {
  await client.transcribe({ url: "https://youtu.be/dQw4w9WgXcQ" });
} catch (error) {
  if (error instanceof APIError) {
    // API error envelope: { error: { code, message } }
    console.error(error.status, error.code, error.message);
    // error.retryAfterMs: parsed Retry-After delay, or null
  } else if (error instanceof TimeoutError || error instanceof NetworkError) {
    // Do not blindly repeat billed calls: the server may already have spent credits.
    console.error(error.message);
  } else if (error instanceof ResponseError) {
    console.error("Unexpected API response", error.status);
  } else {
    throw error;
  }
}
```

Only **HTTP 429** responses are retried, because the current API applies rate limiting before charging credits. Default: two additional attempts with 1s then 2s exponential backoff, bounded by `maxRetryDelayMs`. `Retry-After` supports seconds and HTTP dates; the SDK waits at least the larger of the header delay and backoff. If the header exceeds the configured maximum wait, the SDK throws `APIError` instead of retrying early. Missing/invalid headers use backoff; exhausted retries throw the last API error. `maxRetries: 0` disables retries.

Network failures, timeouts, malformed successful JSON, 4xx other than 429, and 5xx are **never retried**, including on GET endpoints that can charge credits. HTTP redirects are rejected instead of replaying a request. A non-JSON error response still produces `APIError` with its HTTP status and `code: "http_error"`; raw bodies are not attached. Successful responses must be JSON objects; response types describe the API contract but the SDK does not perform full runtime validation of every nested field.

```js
const configured = new EasyTranscriber({
  apiKey,
  baseUrl: "https://www.easytranscriber.com/api/v1", // default; includes /api/v1
  timeoutMs: 330_000, // default, exceeds the server's 300-second maximum
  maxRetries: 2, // integer 0–10
  retryDelayMs: 1_000,
  maxRetryDelayMs: 60_000,
  // fetch: customServerFetch, // optional server-side adapter / test injection
});
```

The timeout covers each attempt, including response body reading, not the whole retry sequence. Retry waits add to total wall time. A shorter configured timeout can stop the client while the server continues processing. Use HTTPS for real credentials; HTTP base URLs are supported for local tests only. Custom fetch implementations must honor the supplied `AbortSignal` and redirect policy.

## Development and verification

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development, tests and package verification.
Tests use fixtures and loopback HTTP, not production credentials or credits.

See the public [REST API documentation](https://www.easytranscriber.com/docs/api) for the service contract and [API overview](https://www.easytranscriber.com/api) for API access. This repository contains the clients, not the hosted service implementation.

## Changes

0.1.0: initial npm release with ten REST methods, typed models, JSON summaries, explicit pagination, credit receipts, bounded 429-only retries, and dual-module builds.
