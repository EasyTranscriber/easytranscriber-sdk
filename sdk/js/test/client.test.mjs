import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { inspect } from "node:util";
import {
  APIError, EasyTranscriber, NetworkError, ResponseError, TimeoutError,
} from "../dist/esm/index.js";

const video = { video_id: "abc12345678", title: "Example", published_at: "2026-01-01T00:00:00Z", thumbnail: null };
const result = { ...video, channel_id: "UCexample", channel: "Example channel" };
const transcript = { video_id: video.video_id, video_title: null, transcript: "Some words", method: "innertube", cached: false, credits_used: 1 };
const page = { next_page_token: "next+/=&", total_results: null, credits_used: 1 };
const comment = { author: "Author", text: "Text", likes: 3, published_at: video.published_at, updated_at: video.published_at };
const cases = [
  ["transcribe", "transcribe", { url: "https://youtube.com/watch?v=abc12345678" }, transcript],
  ["summarize", "summarize", { transcript: "Some words", video_id: video.video_id, language: "English" }, { summary: "Summary", video_id: video.video_id, credits_used: 1 }],
  ["credits", "credits", undefined, { balance: 5 }],
  ["search", "youtube/search", { q: "a & b", type: "channel", page_token: "next+/=&" }, { results: [{ ...result, video_id: null }], next_page_token: null, credits_used: 1 }],
  ["resolveChannel", "youtube/channel/resolve", { channel: "@example" }, { channel_id: "UCexample", name: "Example", handle: null, subscribers: "123456", thumbnail: null }],
  ["channelLatest", "youtube/channel/latest", { channel: "https://youtube.com/@example" }, { channel_id: "UCexample", videos: [{ ...video, thumbnail: "https://i.ytimg.com/vi/abc12345678/hqdefault.jpg" }] }],
  ["channelSearch", "youtube/channel/search", { channel: "@example", q: "TypeScript", page_token: "next+/=&" }, { channel_id: "UCexample", results: [result], next_page_token: null, credits_used: 1 }],
  ["channelVideos", "youtube/channel/videos", { channel: "@example", page_token: "next+/=&" }, { channel_id: "UCexample", videos: [video], ...page }],
  ["playlistVideos", "youtube/playlist/videos", { playlist: "https://youtube.com/playlist?list=PLexample", page_token: "next+/=&" }, { playlist_id: "PLexample", videos: [video], ...page }],
  ["comments", "youtube/comments", { video: video.video_id, max_results: 25, order: "time", page_token: "next+/=&" }, { video_id: video.video_id, comments: [{ ...comment, reply_count: 1, replies: [comment] }], ...page }],
];

for (const [method, path, parameters, response] of cases) {
  test(`${method} preserves the implemented payload and encodes its request`, async () => {
    const calls = [];
    const client = new EasyTranscriber({
      apiKey: "et_test_only",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return Response.json(response);
      },
    });
    assert.deepEqual(await client[method](parameters), response);
    assert.equal(calls.length, 1, "never fetches another paid page automatically");
    const { url, init } = calls[0];
    assert.equal(url.origin, "https://www.easytranscriber.com");
    assert.equal(url.pathname, `/api/v1/${path}`);
    assert.equal(init.headers.Authorization, "Bearer et_test_only");
    assert.equal(init.headers.Accept, "application/json");
    assert.equal(init.redirect, "error");
    if (method === "transcribe" || method === "summarize") {
      assert.equal(init.method, "POST");
      assert.equal(init.headers["Content-Type"], "application/json");
      assert.deepEqual(JSON.parse(init.body), parameters);
      assert.equal(url.search, "");
    } else {
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      assert.deepEqual(Object.fromEntries(url.searchParams), Object.fromEntries(Object.entries(parameters ?? {}).map(([key, value]) => [key, String(value)])));
    }
  });
}


test("supports custom API base paths and omits undefined query fields", async () => {
  const client = new EasyTranscriber({ apiKey: "et_test_only", baseUrl: "http://127.0.0.1:8080/custom/v1/", fetch: async (url) => {
    assert.equal(url.href, "http://127.0.0.1:8080/custom/v1/youtube/search?q=test");
    return Response.json({ results: [], next_page_token: null, credits_used: 1 });
  } });
  await client.search({ q: "test", page_token: undefined });
});

for (const status of [400, 401, 402, 403, 404, 500, 502, 503]) {
  test(`HTTP ${status} exposes nested API errors without retries`, async () => {
    let calls = 0;
    const client = new EasyTranscriber({ apiKey: "et_test_only", fetch: async () => {
      calls++;
      return Response.json({ error: { code: "specific_code", message: "Useful message" } }, { status });
    } });
    await assert.rejects(client.summarize({ transcript: "Some words" }), (error) => {
      assert.ok(error instanceof APIError);
      assert.equal(error.status, status);
      assert.equal(error.code, "specific_code");
      assert.equal(error.message, "Useful message");
      return true;
    });
    assert.equal(calls, 1);
  });
}

test("non-JSON HTTP errors retain status without exposing response bodies", async () => {
  const client = new EasyTranscriber({ apiKey: "et_test_only", fetch: async () => new Response("<html>proxy failure</html>", { status: 502 }) });
  await assert.rejects(client.credits(), (error) => error instanceof APIError && error.status === 502 && error.code === "http_error" && !error.message.includes("<html>"));
});

for (const body of ["not-json", "null", "[]", '"text"']) {
  test(`invalid success JSON (${body}) raises ResponseError without retry`, async () => {
    let calls = 0;
    const client = new EasyTranscriber({ apiKey: "et_test_only", fetch: async () => {
      calls++;
      return new Response(body);
    } });
    await assert.rejects(client.credits(), ResponseError);
    assert.equal(calls, 1);
  });
}

test("network and response-transfer failures never retry or retain secrets", async () => {
  for (const duringBody of [false, true]) {
    let calls = 0;
    const client = new EasyTranscriber({ apiKey: "et_test_only", fetch: async () => {
      calls++;
      if (!duringBody) throw new Error("secret request details");
      return { text: async () => { throw new Error("secret response details"); } };
    } });
    await assert.rejects(client.transcribe({ url: "https://youtu.be/abc12345678" }), (error) => error instanceof NetworkError && !inspect(error).includes("secret"));
    assert.equal(calls, 1);
    assert.ok(!inspect(client).includes("et_test_only"));
  }
});

function rateLimited(retryAfter) {
  return Response.json({ error: { code: "rate_limited", message: "Slow down" } }, {
    status: 429,
    headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
  });
}

test("429 exponential backoff is capped and bounded to the configured retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const client = new EasyTranscriber({ apiKey: "et_test_only", retryDelayMs: 100, maxRetryDelayMs: 150, fetch: async () => {
    calls++;
    return rateLimited();
  } });
  const rejected = assert.rejects(client.credits(), (error) => error instanceof APIError && error.status === 429);
  await setImmediate();
  assert.equal(calls, 1);
  t.mock.timers.tick(99);
  await setImmediate();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(calls, 2);
  t.mock.timers.tick(149);
  await setImmediate();
  assert.equal(calls, 2);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(calls, 3);
});

for (const retryAfter of ["2", "Wed, 01 Jan 2025 00:00:02 GMT"]) {
  test(`429 honors Retry-After ${retryAfter} then succeeds`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date("2025-01-01T00:00:00Z") });
    let calls = 0;
    const client = new EasyTranscriber({ apiKey: "et_test_only", retryDelayMs: 10, fetch: async () => ++calls === 1 ? rateLimited(retryAfter) : Response.json({ balance: 3 }) });
    const promise = client.credits();
    await setImmediate();
    t.mock.timers.tick(1999);
    await setImmediate();
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    assert.deepEqual(await promise, { balance: 3 });
    assert.equal(calls, 2);
  });
}

for (const retryAfter of [undefined, "invalid", "-1"]) {
  test(`429 uses backoff for absent/invalid Retry-After: ${retryAfter}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let calls = 0;
    const client = new EasyTranscriber({ apiKey: "et_test_only", retryDelayMs: 100, fetch: async () => ++calls === 1 ? rateLimited(retryAfter) : Response.json({ balance: 1 }) });
    const promise = client.credits();
    await setImmediate();
    t.mock.timers.tick(99);
    await setImmediate();
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    assert.deepEqual(await promise, { balance: 1 });
  });
}

test("long Retry-After stops rather than retrying too soon", async () => {
  let calls = 0;
  const client = new EasyTranscriber({ apiKey: "et_test_only", maxRetryDelayMs: 1000, fetch: async () => { calls++; return rateLimited("120"); } });
  await assert.rejects(client.credits(), (error) => error instanceof APIError && error.retryAfterMs === 120_000);
  assert.equal(calls, 1);
});

test("maxRetries zero disables even 429 retries", async () => {
  let calls = 0;
  const client = new EasyTranscriber({ apiKey: "et_test_only", maxRetries: 0, fetch: async () => { calls++; return rateLimited("0"); } });
  await assert.rejects(client.credits(), APIError);
  assert.equal(calls, 1);
});

for (const duringBody of [false, true]) {
  test(`timeout covers ${duringBody ? "response body" : "fetch"} and never retries`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let calls = 0;
    const client = new EasyTranscriber({ apiKey: "et_test_only", timeoutMs: 300_001, fetch: async (_url, init) => {
      calls++;
      const { promise, reject } = Promise.withResolvers();
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      return duringBody ? { text: () => promise } : promise;
    } });
    const rejected = assert.rejects(client.credits(), (error) => error instanceof TimeoutError && error.timeoutMs === 300_001);
    await setImmediate();
    t.mock.timers.tick(300_000);
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(calls, 1);
  });
}


test("rejects invalid transport configuration", () => {
  for (const options of [{ apiKey: "" }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { maxRetries: -1 }, { maxRetries: 11 }, { retryDelayMs: -1 }, { baseUrl: "ftp://localhost" }, { baseUrl: "https://localhost/?key=secret" }]) {
    assert.throws(() => new EasyTranscriber({ apiKey: "et_test_only", ...options }), TypeError);
  }
});
