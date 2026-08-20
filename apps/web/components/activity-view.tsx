"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";

import { ClockIcon } from "@/components/icons";
import { MediaActivityPanel, useMediaActivity } from "@/components/media-activity-section";
import { TaskCenterView } from "@/components/task-center-view";
import { usePageChrome } from "@/lib/page-chrome";
import type { ActivityScope, TaskCenterViewName } from "@/lib/task-center";
import { useIsMobile } from "@/lib/use-media-query";

/**
 * 活动页：一级按**领域**分「观看 / 任务」，二级才是任务自己的状态切片。
 *
 * 这么分是因为两者维度不同——观看是"现在正在发生什么"（纯观察，没有
 * 需处理/成功/失败的处置语义），任务是"有什么需要我处理"。把观看塞进任务的
 * 状态 tab 会让它看起来像个过滤器、点下去却整页换内容，也会稀释"需要处理"
 * 的优先级（见 docs/design/activity.md）。
 *
 * 一级切换沿用发现页 TMDB/豆瓣 的分段控件形态，不新造交互词汇；两个视角
 * 各自持有数据，来回切不互相打断轮询。
 */
export function ActivityView({
  initialScope = "media",
  initialView = "all",
}: {
  initialScope?: ActivityScope;
  initialView?: TaskCenterViewName;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [scope, setScope] = useState<ActivityScope>(initialScope);
  const [view, setView] = useState<TaskCenterViewName>(initialView);
  // 观看视角常驻轮询：切到任务视角时停掉，避免看不见的页签持续拉取
  const mediaActivity = useMediaActivity(scope === "media");

  /** 视角与状态都反映到 URL，保证刷新和分享后落回同一处。 */
  const syncUrl = useCallback(
    (nextScope: ActivityScope, nextView: TaskCenterViewName) => {
      const query = nextScope === "tasks" ? `?view=${nextView}` : "";
      router.replace(`${pathname}${query}` as Route, { scroll: false });
    },
    [pathname, router],
  );

  const switchScope = useCallback(
    (next: ActivityScope) => {
      if (next === scope) return;
      setScope(next);
      syncUrl(next, view);
    },
    [scope, syncUrl, view],
  );

  const changeView = useCallback(
    (next: TaskCenterViewName) => {
      setView(next);
      syncUrl("tasks", next);
    },
    [syncUrl],
  );

  const liveCount =
    mediaActivity.snapshot.sessions.length + mediaActivity.snapshot.downloads.length;

  const switcher = useMemo(
    () => <ScopeSwitcher value={scope} liveCount={liveCount} onChange={switchScope} />,
    [liveCount, scope, switchScope],
  );

  // 活动页与发现页同为侧栏一级入口、没有 PageNav：视角切换若在窄屏自己占一行，
  // 会和全局顶栏摞成两排 header。移动端沿用发现页的做法挂进全局顶栏那一行
  // （字标与搜索之间本来就空着），桌面端维持页头右上角。
  const chrome = usePageChrome();
  const isMobile = useIsMobile();
  const setTopBarActions = chrome?.setTopBarActions;
  useEffect(() => {
    if (!isMobile || !setTopBarActions) return;
    return setTopBarActions(switcher);
  }, [isMobile, setTopBarActions, switcher]);

  return (
    <div className="scroll-thin scroll-safe h-full overflow-y-auto pb-10">
      <div className="mx-auto w-full max-w-[1180px] px-6 pt-7 max-md:px-4 max-md:pt-4">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <ClockIcon className="size-6 text-[var(--info)]" />
              <h1 className="text-on-image text-[26px] font-bold leading-tight tracking-[-0.02em] text-white max-md:text-[21px]">
                活动
              </h1>
            </div>
            <p className="text-on-image mt-1.5 max-w-2xl text-ui leading-6 text-[var(--text-muted)]">
              {scope === "media"
                ? "谁在看什么、用哪台设备、速率如何，媒体库的实时动静都在这里。"
                : "观察下载、入库和后台作业的完整过程，需要处理的任务会优先出现。"}
            </p>
          </div>
          {!isMobile && switcher}
        </header>

        {scope === "media" ? (
          <MediaActivityPanel {...mediaActivity} />
        ) : (
          <TaskCenterView view={view} onViewChange={changeView} />
        )}
      </div>
    </div>
  );
}

/** 一级视角切换（形态对齐发现页的数据源切换器）。 */
function ScopeSwitcher({
  value,
  liveCount,
  onChange,
}: {
  value: ActivityScope;
  liveCount: number;
  onChange: (scope: ActivityScope) => void;
}) {
  return (
    <div className="flex shrink-0 rounded-full border border-white/10 bg-black/35 p-1 backdrop-blur-xl">
      {(["media", "tasks"] as const).map((scope) => (
        <button
          key={scope}
          type="button"
          aria-pressed={value === scope}
          onClick={() => onChange(scope)}
          className={`flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sub font-semibold transition max-md:px-3.5 ${
            value === scope
              ? "bg-white/15 text-white shadow-sm"
              : "text-[var(--text-muted)] hover:text-white"
          }`}
        >
          {scope === "media" ? "观看" : "任务"}
          {scope === "media" && liveCount > 0 && (
            <span className="relative flex size-1.5" aria-hidden="true">
              <span className="absolute inline-flex size-1.5 motion-safe:animate-ping rounded-full bg-[var(--ok)]/60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-[var(--ok)]" />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
