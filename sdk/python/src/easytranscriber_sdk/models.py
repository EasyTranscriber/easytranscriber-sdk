"""Typed dictionaries matching the plain JSON returned by the v1 routes.

These are static typing contracts, not runtime validators. Unknown response
fields are preserved. Nullable values remain None and dates remain strings.
"""

from typing import Literal, TypedDict

SearchType = Literal["video", "channel"]
CommentOrder = Literal["relevance", "time"]


class TranscriptResponse(TypedDict):
    video_id: str
    video_title: str | None
    transcript: str
    method: str
    cached: bool
    credits_used: int


class SummaryResponse(TypedDict):
    summary: str
    video_id: str | None
    credits_used: int


class CreditsResponse(TypedDict):
    balance: int


class SearchResult(TypedDict):
    video_id: str | None
    channel_id: str
    title: str
    channel: str
    published_at: str
    thumbnail: str | None


class SearchResponse(TypedDict):
    results: list[SearchResult]
    next_page_token: str | None
    credits_used: int


class ChannelSearchResponse(SearchResponse):
    channel_id: str


class ChannelResponse(TypedDict):
    channel_id: str
    name: str
    handle: str | None
    subscribers: str | None
    thumbnail: str | None


class LatestVideo(TypedDict):
    video_id: str
    title: str
    published_at: str
    thumbnail: str


class ChannelLatestResponse(TypedDict):
    channel_id: str
    videos: list[LatestVideo]


class Video(TypedDict):
    video_id: str
    title: str
    published_at: str
    thumbnail: str | None


class VideosPage(TypedDict):
    videos: list[Video]
    next_page_token: str | None
    total_results: int | None
    credits_used: int


class ChannelVideosResponse(VideosPage):
    channel_id: str


class PlaylistVideosResponse(VideosPage):
    playlist_id: str


class CommentReply(TypedDict):
    author: str
    text: str
    likes: int
    published_at: str
    updated_at: str


class Comment(CommentReply):
    reply_count: int
    replies: list[CommentReply]


class CommentsResponse(TypedDict):
    video_id: str
    comments: list[Comment]
    next_page_token: str | None
    total_results: int | None
    credits_used: int
