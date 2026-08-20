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
from movieclaw_db.models import JellyfinDevice, MediaItem, MediaMetadata, PlaybackState
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
        session.add(movie)
        await session.commit()
        session.add(MediaMetadata(media_item_id=movie.id, runtime_minutes=148))
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
    assert live["position_ms"] == 1_200_000
    assert live["duration_ms"] == 148 * 60_000
    assert live["progress_percent"] == 14
    # 没有本地取流：网盘直链/仅上报口径，速率不可测而不是 0
    assert live["play_method"] == "remote"
    assert live["rate_bytes_per_second"] is None

    devices = {d["device_id"]: d for d in data["devices"]}
    assert devices["dev-1"]["online"] is True
    assert devices["dev-2"]["online"] is False
    assert devices["dev-1"]["member_name"] == "admin"

    assert len(data["recent"]) == 1
    recent = data["recent"][0]
    assert recent["member_name"] == "admin"
    assert recent["media"]["title"] == "盗梦空间"
    assert recent["progress_percent"] == 11
