"""add library.realtime_watch

媒体库实时监控的库级开关（默认开）：SMB/CIFS/NFS 网络挂载上 inotify 收
不到远端变更、递归建 watch 还要逐目录网络往返（issue #162），用户可按库
关闭——关闭后不建监听、没有事件驱动扫描，定期对账与手动扫描照常兜底。

向前兼容说明：纯加列、带默认值 true，存量库行为不变（全部保持实时监控）；
旧代码回退后忽略本列，不丢数据。

Revision ID: a8b1c4d7e903
Revises: f7a0b3c6d892
Create Date: 2026-08-19 11:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8b1c4d7e903"
down_revision: str | None = "f7a0b3c6d892"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("library", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "realtime_watch",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("library", schema=None) as batch_op:
        batch_op.drop_column("realtime_watch")
