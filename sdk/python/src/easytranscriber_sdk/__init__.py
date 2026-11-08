"""EasyTranscriber REST API SDK."""

from .client import AsyncEasyTranscriber, EasyTranscriber
from .errors import APIError, APIResponseError
from .models import (
    ChannelLatestResponse,
    ChannelResponse,
    ChannelSearchResponse,
    ChannelVideosResponse,
    Comment,
    CommentOrder,
    CommentReply,
    CommentsResponse,
    CreditsResponse,
    LatestVideo,
    PlaylistVideosResponse,
    SearchResponse,
    SearchResult,
    SearchType,
    SummaryResponse,
    TranscriptResponse,
    Video,
    VideosPage,
)

__version__ = "0.1.0"

__all__ = [
    "APIError",
    "APIResponseError",
    "AsyncEasyTranscriber",
    "ChannelLatestResponse",
    "ChannelResponse",
    "ChannelSearchResponse",
    "ChannelVideosResponse",
    "Comment",
    "CommentOrder",
    "CommentReply",
    "CommentsResponse",
    "CreditsResponse",
    "EasyTranscriber",
    "LatestVideo",
    "PlaylistVideosResponse",
    "SearchResponse",
    "SearchResult",
    "SearchType",
    "SummaryResponse",
    "TranscriptResponse",
    "Video",
    "VideosPage",
    "__version__",
]
