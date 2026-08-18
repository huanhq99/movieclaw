from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, UniqueConstraint

from movieclaw_db.models.base import TimestampMixin


class RatioBoostTaskSample(TimestampMixin, table=True):
    """刷流任务的小时级采样：每任务每小时一行，保存该小时末的累计值快照。

    台账（RatioBoostTask）只有"最新累计值 + EMA"，回答不了曲线形状类问题：
    产出在完成后第几小时开始衰减、该在什么时点汰换、不同体积档的下载耗时
    分布如何。本表由引擎对账 tick 顺手 upsert（同一小时内后写覆盖先写，
    行值始终是该小时最后一次观测的累计量），相邻桶差分即得小时增量曲线。

    行数可控：活跃任务数 × 24 行/天，30 天保留后由引擎顺手清理。
    任务行删除时级联删除采样（台账行实际只置终态不删除，级联是防御性的）。
    """

    __tablename__ = "ratio_boost_task_sample"
    __table_args__ = (UniqueConstraint("task_id", "bucket_start"),)

    id: int | None = Field(default=None, primary_key=True)
    task_id: int = Field(
        foreign_key="ratio_boost_task.id",
        ondelete="CASCADE",
        index=True,
        description="所属刷流任务",
    )
    # 小时对齐的桶起点（naive UTC，与全库时间约定一致）
    bucket_start: datetime = Field(index=True, description="小时桶起点（UTC 整点）")
    uploaded_bytes: int = Field(default=0, description="该小时末的累计上传量（字节）")
    downloaded_bytes: int = Field(default=0, description="该小时末的累计下载量（字节）")
    # 该小时末观测的蜂群规模；NULL=下载器未提供
    swarm_seeders: int | None = Field(default=None, description="蜂群做种数；NULL=未知")
    swarm_leechers: int | None = Field(default=None, description="蜂群下载数；NULL=未知")
