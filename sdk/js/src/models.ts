export interface TranscribeRequest {
  url: string;
}

export interface TranscribeResponse {
  video_id: string;
  video_title: string | null;
  transcript: string;
  method: "yt-dlp" | "innertube" | "deepgram";
  cached: boolean;
  credits_used: number;
}

export interface SummarizeRequest {
  transcript: string;
  video_id?: string;
  /** Summary display name (e.g. "English") or "Auto", not an ISO language code. */
  language?: string;
}

export interface SummarizeResponse {
  summary: string;
  video_id: string | null;
  credits_used: number;
}

export interface CreditsResponse {
  balance: number;
}

export interface PageRequest {
  /** Request one additional page explicitly; each page can spend a credit. */
  page_token?: string;
}

export interface SearchRequest extends PageRequest {
  q: string;
  type?: "video" | "channel";
}

export interface SearchResult {
  video_id: string | null;
  channel_id: string;
  title: string;
  channel: string;
  published_at: string;
  thumbnail: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
  next_page_token: string | null;
  credits_used: number;
}

export interface ChannelRequest {
  /** A YouTube @handle, channel URL, or UC... channel ID. */
  channel: string;
}

export interface ResolveChannelResponse {
  channel_id: string;
  name: string;
  handle: string | null;
  /** The implemented API returns YouTube's decimal string, not a JSON number. */
  subscribers: string | null;
  thumbnail: string | null;
}

export interface VideoListItem {
  video_id: string;
  title: string;
  published_at: string;
  thumbnail: string | null;
}

export interface LatestVideo extends VideoListItem {
  thumbnail: string;
}

export interface ChannelLatestResponse {
  channel_id: string;
  videos: LatestVideo[];
}

export interface ChannelSearchRequest extends ChannelRequest, PageRequest {
  q: string;
}

export interface ChannelSearchResponse extends SearchResponse {
  channel_id: string;
}

export interface ChannelVideosRequest extends ChannelRequest, PageRequest {}

export interface ChannelVideosResponse {
  channel_id: string;
  videos: VideoListItem[];
  next_page_token: string | null;
  total_results: number | null;
  credits_used: number;
}

export interface PlaylistVideosRequest extends PageRequest {
  /** A playlist ID or YouTube playlist URL. */
  playlist: string;
}

export interface PlaylistVideosResponse {
  playlist_id: string;
  videos: VideoListItem[];
  next_page_token: string | null;
  total_results: number | null;
  credits_used: number;
}

export interface CommentsRequest extends PageRequest {
  /** A YouTube video URL or video ID. */
  video: string;
  /** Defaults to 20; the server clamps values to 1–100. */
  max_results?: number;
  order?: "time" | "relevance";
}

export interface Comment {
  author: string;
  text: string;
  likes: number;
  published_at: string;
  updated_at: string;
}

export interface CommentThread extends Comment {
  reply_count: number;
  /** Available replies only, not necessarily every reply counted above. */
  replies: Comment[];
}

export interface CommentsResponse {
  video_id: string;
  comments: CommentThread[];
  next_page_token: string | null;
  total_results: number | null;
  credits_used: number;
}

export interface APIErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
