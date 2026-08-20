"""播放记录的 Web 业务接口。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from movieclaw_api.api.deps import require_admin, require_login
from movieclaw_api.schemas.playback import MediaActivityView, RecentWatchView
from movieclaw_api.schemas.response import ApiResponse, ok
from movieclaw_api.services.auth import Principal
from movieclaw_api.services.library.access import visible_library_ids
from movieclaw_api.services.playback_activity import media_activity_overview
from movieclaw_api.services.playback_recent import recent_watch_items
from movieclaw_db.engine import get_session

router = APIRouter(prefix="/playback", tags=["playback"])


@router.get(
    "/recent",
    response_model=ApiResponse[RecentWatchView],
    summary="最近观看",
    operation_id="playback.recent",
    openapi_extra={"x-cli-hidden": True},
)
async def list_recent_watch(
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    principal: Principal = Depends(require_login),
    session: AsyncSession = Depends(get_session),
) -> ApiResponse[RecentWatchView]:
    """列出当前账号在可见媒体库中的最近观看作品。"""
    visible_ids = await visible_library_ids(session, principal)
    member_id = principal.member_id if principal.member_id is not None else 0
    items = await recent_watch_items(
        session,
        member_id=member_id,
        visible_library_ids=visible_ids,
        limit=limit,
    )
    return ok(RecentWatchView(items=items))


@router.get(
    "/activity",
    response_model=ApiResponse[MediaActivityView],
    summary="媒体库活动快照",
    operation_id="playback.activity",
    dependencies=[Depends(require_admin)],
    openapi_extra={"x-cli-hidden": True},
)
async def get_media_activity(
    recent_limit: Annotated[int, Query(ge=1, le=100)] = 30,
    session: AsyncSession = Depends(get_session),
) -> ApiResponse[MediaActivityView]:
    """活动页「观看」视角：正在播放/下载、设备清单与全成员最近观看。

    管理员运维视角（跨成员可见），与首页按成员隔离的最近观看接口分离。
    """
    return ok(await media_activity_overview(session, recent_limit=recent_limit))
