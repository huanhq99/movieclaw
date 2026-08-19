"""下载器：刷流安全下载包络列（带宽哨兵的 AIMD 持久化状态）

首夜数据实证：下载均速冲到 69 MB/s 的小时，上传从 5.2 MB/s 塌到 1.5
（下行拥塞拖死上传的 ACK/请求回程）。带宽哨兵据此闭环控制刷流下载：
上行受压时乘性回退包络、健康时加性恢复，收敛值持久化在本列，重启不清零。

向前兼容说明：加列 nullable（NULL=尚未观测到拥塞，不限速），旧代码忽略
即可，回退不丢数据。

Revision ID: b9c2d5e8f014
Revises: c2e5f8a1b436
Create Date: 2026-08-19 11:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b9c2d5e8f014"
down_revision: str | None = "c2e5f8a1b436"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("downloader_client", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("boost_dl_envelope_bytes", sa.BigInteger(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("downloader_client", schema=None) as batch_op:
        batch_op.drop_column("boost_dl_envelope_bytes")
