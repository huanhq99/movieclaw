"""刷流可观测性：入场快照、下载量台账、采样表（Phase 0）

首日数据分析暴露的记录缺口一次补齐，为策略调优提供数据依据：

- ratio_boost_task 入场快照列（entry_seeders/entry_leechers/entry_score/
  torrent_published_at）：准入瞬间的决策依据，此后永不覆盖——现有的
  swarm_* 列每 tick 被下载器观测刷新，事后无法回溯评估准入策略；
- ratio_boost_task.downloaded_bytes：累计下载量（真实带宽成本），任务被
  汰换后 qb 里已无数据，必须入台账；
- ratio_boost_stat 加 downloaded_bytes / upspeed_bytes_sum /
  dlspeed_bytes_sum / downloading_count_sum：小时桶级的带宽收支与
  饱和度观测；
- 新表 ratio_boost_task_sample：每任务小时级累计值快照，差分得产出曲线；
- 新表 site_torrent_swarm_sample：新免费种蜂群演化采样（候选控制组），
  支撑需求衰减拟合与评分离线回测。

向前兼容说明：全部为加列（nullable 或 server_default=0）与新表，旧代码
忽略即可，回退不丢数据。

Revision ID: a8b1c4d7e903
Revises: f7a0b3c6d892
Create Date: 2026-08-18 15:00:00.000000
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
    with op.batch_alter_table("ratio_boost_task", schema=None) as batch_op:
        batch_op.add_column(sa.Column("entry_seeders", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("entry_leechers", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("entry_score", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("torrent_published_at", sa.DateTime(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "downloaded_bytes",
                sa.BigInteger(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )

    with op.batch_alter_table("ratio_boost_stat", schema=None) as batch_op:
        for name in (
            "downloaded_bytes",
            "upspeed_bytes_sum",
            "dlspeed_bytes_sum",
            "downloading_count_sum",
        ):
            batch_op.add_column(
                sa.Column(
                    name,
                    sa.BigInteger(),
                    nullable=False,
                    server_default=sa.text("0"),
                )
            )

    op.create_table(
        "ratio_boost_task_sample",
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("bucket_start", sa.DateTime(), nullable=False),
        sa.Column("uploaded_bytes", sa.BigInteger(), nullable=False),
        sa.Column("downloaded_bytes", sa.BigInteger(), nullable=False),
        sa.Column("swarm_seeders", sa.Integer(), nullable=True),
        sa.Column("swarm_leechers", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["ratio_boost_task.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", "bucket_start"),
    )
    for name in ("task_id", "bucket_start"):
        op.create_index(
            f"ix_ratio_boost_task_sample_{name}",
            "ratio_boost_task_sample",
            [name],
            unique=False,
        )

    op.create_table(
        "site_torrent_swarm_sample",
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Text(), nullable=False),
        sa.Column("torrent_id", sa.Text(), nullable=False),
        sa.Column("bucket_start", sa.DateTime(), nullable=False),
        sa.Column("seeders", sa.Integer(), nullable=True),
        sa.Column("leechers", sa.Integer(), nullable=True),
        sa.Column("is_free", sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", "torrent_id", "bucket_start"),
    )
    for name in ("site_id", "bucket_start"):
        op.create_index(
            f"ix_site_torrent_swarm_sample_{name}",
            "site_torrent_swarm_sample",
            [name],
            unique=False,
        )


def downgrade() -> None:
    op.drop_table("site_torrent_swarm_sample")
    op.drop_table("ratio_boost_task_sample")
    with op.batch_alter_table("ratio_boost_stat", schema=None) as batch_op:
        for name in (
            "downloading_count_sum",
            "dlspeed_bytes_sum",
            "upspeed_bytes_sum",
            "downloaded_bytes",
        ):
            batch_op.drop_column(name)
    with op.batch_alter_table("ratio_boost_task", schema=None) as batch_op:
        batch_op.drop_column("downloaded_bytes")
        batch_op.drop_column("torrent_published_at")
        batch_op.drop_column("entry_score")
        batch_op.drop_column("entry_leechers")
        batch_op.drop_column("entry_seeders")
