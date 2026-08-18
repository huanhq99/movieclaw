from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, UniqueConstraint

from movieclaw_db.models.base import TimestampMixin


class SiteTorrentSwarmSample(TimestampMixin, table=True):
    """新免费种的蜂群演化采样（刷流的候选控制组）。

    索引同步/搜索回灌本就在持续观测每个种子的 seeders/leechers，但每次
    观测都把旧值覆盖掉了——蜂群随时间的演化曲线全部丢失。本表把发布
    48 小时内新种的每次观测按小时桶落底（同一小时后写覆盖先写），无论
    是否免费、刷流最终收没收它：

    - **控制组**：被跳过的候选的蜂群曲线 ≈ "当时收了会怎样"的近似答案，
      不花一字节下载即可校准准入评分与门槛；
    - **需求衰减曲线**：新种 leechers 随种龄衰减的真实形状，是评分中
      体积/时间惩罚参数的拟合来源；
    - **离线回测**：评分公式改动可在历史采样上重放，先验证再上线。

    行数可控：每站每天新免费种约百余个 × 48 桶，30 天保留后顺手清理。
    """

    __tablename__ = "site_torrent_swarm_sample"
    __table_args__ = (UniqueConstraint("site_id", "torrent_id", "bucket_start"),)

    id: int | None = Field(default=None, primary_key=True)
    site_id: str = Field(index=True, description="站点标识")
    torrent_id: str = Field(description="站点内种子 ID")
    # 小时对齐的桶起点（naive UTC，与全库时间约定一致）
    bucket_start: datetime = Field(index=True, description="小时桶起点（UTC 整点）")
    seeders: int | None = Field(default=None, description="观测到的做种数；NULL=未观测")
    leechers: int | None = Field(default=None, description="观测到的下载数；NULL=未观测")
    # 观测时是否免费：免费窗口结束的时点会改变曲线的解读（付费后需求骤降
    # 不代表种子不行），回测时要能区分。NULL=促销状态未知
    is_free: bool | None = Field(default=None, description="观测时是否免费；NULL=未知")
