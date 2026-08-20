"""任务中心媒体库活动接口（GET /playback/activity）的装配测试。

成员越权由 tests/api/test_member_auth.py 的守护测试兜底（本路由挂
require_admin 且不在成员白名单），这里只测管理员视角的数据装配。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from movieclaw_api.core.config import get_settings
from movieclaw_api.services.auth import reset_auth_state
from movieclaw_api.settings.store import reset_setting_store
from movieclaw_db.crypto import reset_secret_box
from movieclaw_db.engine import get_database
from movieclaw_db.models import (
    JellyfinDevice,
    Library,
    LibraryFile,
    MediaItem,
    MediaMetadata,
    PlaybackState,
)
from movieclaw_db.models.base import utcnow
from movieclaw_playback import activity
from movieclaw_playback.events import ClientInfo


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("SECRET_KEY_FILE", str(tmp_path / ".secret_key"))
    monkeypatch.setenv("SCHEDULER_ENABLED", "false")
    get_settings.cache_clear()
    reset_setting_store()
    reset_secret_box()
    reset_auth_state()
    activity.reset()

    from movieclaw_api.app import create_app

    app = create_app()
    with TestClient(app) as c:
        c.post(
            "/api/v1/auth/bootstrap",
            json={"username": "admin", "password": "s3cret-pass"},
        )
        yield c

    activity.reset()
    reset_setting_store()
    reset_secret_box()
    reset_auth_state()
    get_settings.cache_clear()


async def test_empty_snapshot(client: TestClient) -> None:
    """全新实例：三段数据都为空，但结构完整。"""
    resp = client.get("/api/v1/playback/activity")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data == {"sessions": [], "downloads": [], "devices": [], "recent": []}


async def test_assembles_sessions_devices_and_recent(client: TestClient) -> None:
    """实时会话补齐媒体信息，设备叠加在线标记，历史来自 playback_state。"""
    async with get_database().session() as session:
        movie = MediaItem(
            kind="movie",
            tmdb_id=27205,
            title="盗梦空间",
            original_title="Inception",
            year=2010,
            aliases=[],
        )
        library = Library(name="电影库", kind="movie", root_paths=["/media/movies"])
        session.add_all([movie, library])
        await session.commit()
        session.add(MediaMetadata(media_item_id=movie.id, runtime_minutes=148))
        session.add(
            LibraryFile(
                library_id=library.id,
                media_item_id=movie.id,
                file_path="/media/movies/inception.mkv",
                size_bytes=28_000_000_000,
                container="mkv",
                resolution="2160p",
                video_codec="hevc",
                hdr="HDR10",
                bit_rate=45_000_000,
                duration_seconds=8880,
                source="scanned",
            )
        )
        session.add(
            JellyfinDevice(
                member_id=0,
                token="tok-1",
                device_id="dev-1",
                client="Infuse",
                device_name="客厅 Apple TV",
                version="8.0",
                last_seen_at=utcnow(),
            )
        )
        session.add(
            JellyfinDevice(
                member_id=0,
                token="tok-2",
                device_id="dev-2",
                client="VidHub",
                device_name="卧室 iPad",
                version="2.0",
            )
        )
        session.add(
            PlaybackState(
                member_id=0,
                media_item_id=movie.id,
                position_ms=1_000_000,
                play_count=1,
                last_played_at=utcnow(),
            )
        )
        await session.commit()
        movie_id = movie.id
        library_id = library.id

    unit = (movie_id, 0, 0)
    info = ClientInfo(
        name="Infuse", device_name="客厅 Apple TV", device_id="dev-1", version="8.0"
    )
    activity.report_start("dev-1", member_id=0, client=info, unit=unit)
    activity.report_progress(
        "dev-1", member_id=0, client=info, unit=unit, position_ms=1_200_000, paused=False
    )

    resp = client.get("/api/v1/playback/activity")
    assert resp.status_code == 200
    data = resp.json()["data"]

    assert len(data["sessions"]) == 1
    live = data["sessions"][0]
    assert live["member_name"] == "admin"
    assert live["device_name"] == "客厅 Apple TV"
    assert live["media"]["title"] == "盗梦空间"
    # 详情页落点与文件规格来自在位台账行
    assert live["media"]["library_id"] == library_id
    assert live["file"]["resolution"] == "2160p"
    assert live["file"]["hdr"] == "HDR10"
    assert live["position_ms"] == 1_200_000
    assert live["duration_ms"] == 148 * 60_000
    assert live["progress_percent"] == 14
    # 本地台账文件：即使还没看到字节也是本地直连（上报先于取流是常态），
    # 速率此刻不可测 → null，而不是伪造成 0
    assert live["play_method"] == "local"
    assert live["rate_bytes_per_second"] is None

    devices = {d["device_id"]: d for d in data["devices"]}
    assert devices["dev-1"]["online"] is True
    assert devices["dev-2"]["online"] is False
    assert devices["dev-1"]["member_name"] == "admin"

    assert len(data["recent"]) == 1
    recent = data["recent"][0]
    assert recent["member_name"] == "admin"
    assert recent["media"]["title"] == "盗梦空间"
    assert recent["media"]["library_id"] == library_id
    assert recent["progress_percent"] == 11


async def test_download_connections_aggregate_per_file(client: TestClient) -> None:
    """同设备同文件的多条 Range 连接聚合为一条：速率与字节求和，不刷屏。"""
    async with get_database().session() as session:
        movie = MediaItem(
            kind="movie",
            tmdb_id=603,
            title="黑客帝国",
            original_title="The Matrix",
            year=1999,
            aliases=[],
        )
        session.add(movie)
        await session.commit()
        movie_id = movie.id

    info = ClientInfo(name="VidHub", device_name="iPad", device_id="dev-9", version="2.0")
    meters = [
        activity.register_stream(
            device_id="dev-9",
            kind=activity.STREAM_KIND_DOWNLOAD,
            member_id=0,
            unit=(movie_id, 0, 0),
            file_id=7,
            file_name="matrix.mkv",
            size_bytes=20_000,
            client=info,
        )
        for _ in range(3)
    ]
    for meter in meters:
        meter.add(1_000)

    data = client.get("/api/v1/playback/activity").json()["data"]
    assert len(data["downloads"]) == 1
    download = data["downloads"][0]
    assert download["connections"] == 3
    assert download["bytes_sent"] == 3_000
    assert download["media"]["title"] == "黑客帝国"


async def test_strm_session_reports_remote_play_method(client: TestClient) -> None:
    """strm 网盘条目走 302 直链、流量不经过服务器：标注 remote 而非伪造速率。"""
    async with get_database().session() as session:
        movie = MediaItem(
            kind="movie",
            tmdb_id=157336,
            title="星际穿越",
            original_title="Interstellar",
            year=2014,
            aliases=[],
        )
        library = Library(name="网盘库", kind="movie", root_paths=["/media/cloud"])
        session.add_all([movie, library])
        await session.commit()
        session.add(
            LibraryFile(
                library_id=library.id,
                media_item_id=movie.id,
                file_path="/media/cloud/interstellar.strm",
                source="scanned",
            )
        )
        await session.commit()
        movie_id = movie.id

    info = ClientInfo(
        name="Infuse", device_name="客厅 Apple TV", device_id="dev-5", version="8.0"
    )
    activity.report_start("dev-5", member_id=0, client=info, unit=(movie_id, 0, 0))

    data = client.get("/api/v1/playback/activity").json()["data"]
    assert len(data["sessions"]) == 1
    assert data["sessions"][0]["play_method"] == "remote"
    assert data["sessions"][0]["rate_bytes_per_second"] is None
