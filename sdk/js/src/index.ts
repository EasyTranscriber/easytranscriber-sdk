import type {
  ChannelLatestResponse,
  ChannelRequest,
  ChannelSearchRequest,
  ChannelSearchResponse,
  ChannelVideosRequest,
  ChannelVideosResponse,
  CommentsRequest,
  CommentsResponse,
  CreditsResponse,
  PlaylistVideosRequest,
  PlaylistVideosResponse,
  ResolveChannelResponse,
  SearchRequest,
  SearchResponse,
  SummarizeRequest,
  SummarizeResponse,
  TranscribeRequest,
  TranscribeResponse,
} from "./models.js";

export type * from "./models.js";

export class APIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "APIError";
  }
}

export class NetworkError extends Error {
  constructor() {
    super("The API request or response transfer failed. It was not retried; credits may have been spent.");
    this.name = "NetworkError";
  }
}

export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`The API request exceeded ${timeoutMs}ms. It was not retried; credits may have been spent.`);
    this.name = "TimeoutError";
  }
}

export class ResponseError extends Error {
  constructor(public readonly status: number) {
    super("The API returned an invalid JSON object. It was not retried; credits may have been spent.");
    this.name = "ResponseError";
  }
}

export interface EasyTranscriberOptions {
  apiKey: string;
  /** Include /api/v1. Defaults to the production HTTPS endpoint. */
  baseUrl?: string;
  /** Per-attempt timeout including reading the response body. Default: 330000. */
  timeoutMs?: number;
  /** Additional attempts for HTTP 429 only (0–10). Default: 2. */
  maxRetries?: number;
  /** Initial exponential backoff delay. Default: 1000ms. */
  retryDelayMs?: number;
  /** Maximum retry wait. Longer Retry-After values stop retries. Default: 60000ms. */
  maxRetryDelayMs?: number;
  /** Optional fetch implementation for server-side adapters and tests. */
  fetch?: typeof globalThis.fetch;
}

function boundedInteger(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  // Do not interpret negative numeric delays as dates.
  if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/** Server-side client. No automatic pagination and no retries except HTTP 429. */
export class EasyTranscriber {
  #apiKey: string;
  #baseUrl: string;
  #timeoutMs: number;
  #maxRetries: number;
  #retryDelayMs: number;
  #maxRetryDelayMs: number;
  #fetch: typeof globalThis.fetch;

  constructor(options: EasyTranscriberOptions) {
    if (typeof window !== "undefined") {
      throw new Error("EasyTranscriber is server-side only. Never expose an API key in browser code.");
    }
    if (typeof options.apiKey !== "string" || !options.apiKey.trim()) {
      throw new TypeError("apiKey must be a nonempty API key");
    }
    const baseUrl = new URL(options.baseUrl ?? "https://www.easytranscriber.com/api/v1");
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new TypeError("baseUrl must be an HTTP(S) URL without credentials, query, or fragment");
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = baseUrl.href.replace(/\/+$/, "");
    this.#timeoutMs = boundedInteger("timeoutMs", options.timeoutMs ?? 330_000, 1, 2_147_483_647);
    this.#maxRetries = boundedInteger("maxRetries", options.maxRetries ?? 2, 0, 10);
    this.#retryDelayMs = boundedInteger("retryDelayMs", options.retryDelayMs ?? 1000, 0, 2_147_483_647);
    this.#maxRetryDelayMs = boundedInteger("maxRetryDelayMs", options.maxRetryDelayMs ?? 60_000, 0, 2_147_483_647);
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") throw new TypeError("A native or injected fetch implementation is required");
  }

  transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    return this.#request("transcribe", "POST", request);
  }

  /** JSON summary only; costs one additional credit, separate from transcription. */
  summarize(request: SummarizeRequest): Promise<SummarizeResponse> {
    return this.#request("summarize", "POST", request);
  }

  credits(): Promise<CreditsResponse> {
    return this.#request("credits", "GET");
  }

  search(request: SearchRequest): Promise<SearchResponse> {
    return this.#request("youtube/search", "GET", request);
  }

  resolveChannel(request: ChannelRequest): Promise<ResolveChannelResponse> {
    return this.#request("youtube/channel/resolve", "GET", request);
  }

  channelLatest(request: ChannelRequest): Promise<ChannelLatestResponse> {
    return this.#request("youtube/channel/latest", "GET", request);
  }

  channelSearch(request: ChannelSearchRequest): Promise<ChannelSearchResponse> {
    return this.#request("youtube/channel/search", "GET", request);
  }

  channelVideos(request: ChannelVideosRequest): Promise<ChannelVideosResponse> {
    return this.#request("youtube/channel/videos", "GET", request);
  }

  playlistVideos(request: PlaylistVideosRequest): Promise<PlaylistVideosResponse> {
    return this.#request("youtube/playlist/videos", "GET", request);
  }

  comments(request: CommentsRequest): Promise<CommentsResponse> {
    return this.#request("youtube/comments", "GET", request);
  }

  async #request<T>(path: string, method: "GET" | "POST", parameters?: object): Promise<T> {
    const url = new URL(`${this.#baseUrl}/${path}`);
    if (method === "GET" && parameters) {
      for (const [key, value] of Object.entries(parameters)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    const body = method === "POST" ? JSON.stringify(parameters) : undefined;
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      let response: Response;
      let text: string;
      try {
        response = await this.#fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            Accept: "application/json",
            ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
          },
          ...(body === undefined ? {} : { body }),
          signal: controller.signal,
          // Redirects can change a billed POST or expose credentials to another endpoint.
          redirect: "error",
        });
        text = await response.text();
      } catch {
        if (controller.signal.aborted) throw new TimeoutError(this.#timeoutMs);
        throw new NetworkError();
      } finally {
        clearTimeout(timeout);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        if (response.ok) throw new ResponseError(response.status);
      }
      if (response.ok) {
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
          throw new ResponseError(response.status);
        }
        return payload as T;
      }

      const retryAfterMs = retryAfterMilliseconds(response.headers.get("retry-after"));
      const error = typeof payload === "object" && payload !== null && "error" in payload
        && typeof payload.error === "object" && payload.error !== null
        ? payload.error : undefined;
      const apiError = new APIError(
        error && "message" in error && typeof error.message === "string" ? error.message : `API request failed with HTTP ${response.status}`,
        response.status,
        error && "code" in error && typeof error.code === "string" ? error.code : "http_error",
        retryAfterMs,
      );
      if (response.status !== 429 || attempt >= this.#maxRetries) throw apiError;
      if (retryAfterMs !== null && retryAfterMs > this.#maxRetryDelayMs) throw apiError;
      const backoff = Math.min(this.#retryDelayMs * 2 ** attempt, this.#maxRetryDelayMs);
      const delay = Math.max(backoff, retryAfterMs ?? 0);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, delay);
      await promise;
    }
  }
}
