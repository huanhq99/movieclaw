"""应用设置接口测试：读写配置、校验与重启调度。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from movieclaw_api.core.config import get_settings
from movieclaw_api.services import app_config
from movieclaw_api.services.auth import reset_auth_state
from movieclaw_api.settings.store import reset_setting_store
from movieclaw_db.crypto import reset_secret_box


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("SECRET_KEY_FILE", str(tmp_path / ".secret_key"))
    monkeypatch.setenv("SCHEDULER_ENABLED", "false")
    # 端口设置文件指到临时目录：它是「对外端口」的事实源，绝不能写到仓库的 data/
    monkeypatch.setenv("MOVIECLAW_WEB_PORT_FILE", str(tmp_path / "config" / "web-port"))
    monkeypatch.delenv("MOVIECLAW_WEB_PORT", raising=False)
    monkeypatch.delenv("MOVIECLAW_CODE_SOURCE", raising=False)
    get_settings.cache_clear()
    reset_setting_store()
    reset_secret_box()
    reset_auth_state()

    from movieclaw_api.app import create_app

    app = create_app()
    with TestClient(app) as c:
        c.post(
            "/api/v1/auth/bootstrap",
            json={"username": "admin", "password": "s3cret-pass"},
        )
        yield c

    reset_setting_store()
    reset_secret_box()
    reset_auth_state()
    get_settings.cache_clear()


def test_get_config_returns_defaults(client):
    resp = client.get("/api/v1/app/config")
    assert resp.status_code == 200
    assert resp.json()["data"]["external_url"] == ""


def test_save_external_url_strips_trailing_slash(client):
    resp = client.put(
        "/api/v1/app/config",
        json={"external_url": "http://192.168.1.10:3000/"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["external_url"] == "http://192.168.1.10:3000"
    # 重新读取还原一致
    assert (
        client.get("/api/v1/app/config").json()["data"]["external_url"]
        == "http://192.168.1.10:3000"
    )


def test_save_rejects_bad_external_url(client):
    resp = client.put(
        "/api/v1/app/config",
        json={"external_url": "192.168.1.10:3000"},
    )
    assert resp.status_code == 400
    assert "http(s)" in resp.json()["message"]


def test_save_tolerates_legacy_port_field(client):
    """历史版本落库过 port 字段；带旧字段的请求/存量记录都不应报错。"""
    resp = client.put(
        "/api/v1/app/config",
        json={"port": 12345, "external_url": "http://192.168.1.10:3000"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["external_url"] == "http://192.168.1.10:3000"
    assert "port" not in resp.json()["data"]


def test_restart_schedules_graceful_exit(client, monkeypatch):
    """重启接口只调度、不阻塞响应；此处替换调度函数以免真把测试进程杀掉。"""
    calls: list[bool] = []
    monkeypatch.setattr(app_config, "schedule_restart", lambda: calls.append(True))
    resp = client.post("/api/v1/app/restart")
    assert resp.status_code == 200
    assert calls == [True]


def test_graceful_exit_prefers_should_exit_over_signal(monkeypatch):
    """已注册 Server 实例时：置 should_exit（signal-free）而不发 SIGTERM。"""

    class FakeServer:
        should_exit = False

    fake = FakeServer()
    monkeypatch.setattr(app_config, "_uvicorn_server", fake)
    monkeypatch.setattr(app_config, "_restart_exit_code", None)
    signals: list[int] = []
    monkeypatch.setattr(app_config.os, "kill", lambda pid, sig: signals.append(sig))

    app_config._request_graceful_exit(app_config.RESTART_EXIT_CODE)
    assert fake.should_exit is True
    assert signals == []
    # main.run 停机后据此改用重启约定退出码（42）
    assert app_config.restart_exit_code() == app_config.RESTART_EXIT_CODE


def test_graceful_exit_falls_back_to_sigterm(monkeypatch):
    """未注册 Server 实例（开发热重载）时：退回向自身发 SIGTERM。"""
    monkeypatch.setattr(app_config, "_uvicorn_server", None)
    monkeypatch.setattr(app_config, "_restart_exit_code", None)
    signals: list[int] = []
    monkeypatch.setattr(app_config.os, "kill", lambda pid, sig: signals.append(sig))

    app_config._request_graceful_exit(app_config.RESTART_EXIT_CODE)
    assert signals == [app_config.signal.SIGTERM]


# ---------------------------------------------------------------------------
# 对外端口（PUT /app/port）
# ---------------------------------------------------------------------------


@pytest.fixture
def managed(monkeypatch):
    """伪装成「前端由容器入口托管」的部署（entrypoint 会导出这个变量）。"""
    monkeypatch.setenv("MOVIECLAW_CODE_SOURCE", "baseline")


@pytest.fixture
def no_restart(monkeypatch):
    """拦下重启调度，返回被请求的退出码列表。"""
    codes: list[int] = []
    monkeypatch.setattr(app_config, "schedule_restart", codes.append)
    return codes


def test_config_view_reports_default_port(client):
    data = client.get("/api/v1/app/config").json()["data"]
    assert data["web_port"] == 3000
    assert data["web_port_source"] == "default"
    assert data["web_port_default"] == 3000
    assert data["web_port_rejected"] is None
    # 测试环境没有 MOVIECLAW_CODE_SOURCE = 非容器入口托管，不给改
    assert data["web_port_configurable"] is False


def test_config_view_reports_env_port(client, monkeypatch):
    monkeypatch.setenv("MOVIECLAW_WEB_PORT", "8096")
    data = client.get("/api/v1/app/config").json()["data"]
    assert (data["web_port"], data["web_port_source"]) == (8096, "env")


def test_save_port_rejected_when_not_managed(client, no_restart):
    resp = client.put("/api/v1/app/port", json={"port": 8096})
    assert resp.status_code == 400
    assert "不支持应用内修改端口" in resp.json()["message"]
    assert no_restart == []


def test_save_port_writes_file_and_schedules_full_restart(client, managed, no_restart):
    resp = client.put("/api/v1/app/port", json={"port": 8096})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert (data["web_port"], data["web_port_source"]) == (8096, "setting")
    # 事实源是文件，且必须是 entrypoint/resolve-web-port.sh 能直接读的纯数字
    assert app_config._web_port_file().read_text().strip() == "8096"
    # 端口是前端监听的，只重后端的 42 换不了端口，必须是 43 全量重启
    assert no_restart == [app_config.FULL_RESTART_EXIT_CODE]


def test_save_port_rejects_backend_port(client, managed, no_restart):
    resp = client.put("/api/v1/app/port", json={"port": 8000})
    assert resp.status_code == 400
    assert no_restart == []
    assert not app_config._web_port_file().exists()


@pytest.mark.parametrize("bad", [0 - 1, 65536, 999999])
def test_save_port_rejects_out_of_range(client, managed, no_restart, bad):
    assert client.put("/api/v1/app/port", json={"port": bad}).status_code == 400
    assert no_restart == []


def test_clear_port_restores_default(client, managed, no_restart):
    client.put("/api/v1/app/port", json={"port": 8096})
    no_restart.clear()
    resp = client.put("/api/v1/app/port", json={"port": None})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert (data["web_port"], data["web_port_source"]) == (3000, "default")
    assert not app_config._web_port_file().exists()
    assert no_restart == [app_config.FULL_RESTART_EXIT_CODE]


def test_saving_same_port_does_not_restart(client, managed, no_restart, monkeypatch):
    """清掉设置后回落值恰好等于当前端口时不该重启——重启是纯粹的打扰。"""
    monkeypatch.setenv("MOVIECLAW_WEB_PORT", "8096")
    client.put("/api/v1/app/port", json={"port": 8096})
    assert no_restart == []  # setting 与 env 同值，生效端口没变


def test_rejected_port_is_surfaced_and_cleared_on_save(client, managed, no_restart):
    """entrypoint 废弃坏端口后留下的证据要外显，用户重设后清除。"""
    rejected = app_config._web_port_file().with_name("web-port.rejected")
    rejected.parent.mkdir(parents=True, exist_ok=True)
    rejected.write_text("8096\n")
    assert client.get("/api/v1/app/config").json()["data"]["web_port_rejected"] == 8096

    client.put("/api/v1/app/port", json={"port": 9000})
    assert not rejected.exists()
    assert client.get("/api/v1/app/config").json()["data"]["web_port_rejected"] is None
