"""播放记录在 Web 业务界面的响应模型。"""

from __future__ import annotations

from datetime import datetime

from movieclaw_api.schemas.base import BaseModel
from movieclaw_media.models import MediaKind


class RecentWatchItemView(BaseModel):
    """媒体库首页的一张最近观看卡片。"""

    media_item_id: int
    library_id: int
    kind: MediaKind
    title: str
    year: int | None
    poster_url: str | None
    backdrop_url: str | None
    episode_still_url: str | None
    season_number: int
    episode_number: int
    episode_title: str | None
    # 锚点之后、当前成员从未看过且文件在位的分集数——“还能接着看几集”，
    # 不是“最近入库了几集”：看完全剧、补齐旧季与洗版都不该触发提醒。
    unwatched_ahead_count: int
    position_ms: int
    duration_ms: int | None
    progress_percent: int | None
    played: bool
    play_count: int
    last_played_at: datetime


class RecentWatchView(BaseModel):
    """最近观看横排的数据载荷。"""

    items: list[RecentWatchItemView]


# ---------------------------------------------------------------------------
# 任务中心「媒体库」分类（管理员运维视角，docs/design/task-center.md）
# ---------------------------------------------------------------------------


class MediaActivityTarget(BaseModel):
    """播放会话 / 文件下载指向的媒体条目摘要。"""

    media_item_id: int
    kind: MediaKind
    title: str
    year: int | None
    poster_url: str | None
    season_number: int
    episode_number: int
    episode_title: str | None


class PlaybackFileSpec(BaseModel):
    """正在播放文件的技术规格（来自 library_file 台账）。"""

    resolution: str | None
    video_codec: str | None
    hdr: str | None
    container: str | None
    bit_rate: int | None
    size_bytes: int | None


class ActivePlaybackSessionView(BaseModel):
    """一台设备正在进行的播放会话。"""

    device_id: str
    member_name: str
    client: str
    device_name: str
    client_version: str
    media: MediaActivityTarget
    position_ms: int | None
    duration_ms: int | None
    progress_percent: int | None
    paused: bool
    # local = 本地文件直连（速率可测）；remote = 网盘直链等不经过服务器的播放
    play_method: str
    rate_bytes_per_second: float | None
    bytes_sent: int | None
    connections: int
    file: PlaybackFileSpec | None
    started_at: datetime
    last_report_at: datetime


class ActiveFileDownloadView(BaseModel):
    """一条正在进行的整文件下载（播放器的离线缓存）。"""

    device_id: str
    member_name: str
    client: str
    device_name: str
    media: MediaActivityTarget | None
    file_name: str
    size_bytes: int
    bytes_sent: int
    rate_bytes_per_second: float
    started_at: datetime


class PlaybackDeviceView(BaseModel):
    """已登记的播放器设备。"""

    device_id: str
    device_name: str
    client: str
    client_version: str
    member_name: str
    last_seen_at: datetime | None
    online: bool


class MediaRecentPlayView(BaseModel):
    """全成员维度的一条最近观看记录。"""

    member_name: str
    media: MediaActivityTarget
    position_ms: int
    duration_ms: int | None
    progress_percent: int | None
    played: bool
    play_count: int
    last_played_at: datetime


class MediaActivityView(BaseModel):
    """任务中心媒体库分类的完整数据载荷。"""

    sessions: list[ActivePlaybackSessionView]
    downloads: list[ActiveFileDownloadView]
    devices: list[PlaybackDeviceView]
    recent: list[MediaRecentPlayView]
