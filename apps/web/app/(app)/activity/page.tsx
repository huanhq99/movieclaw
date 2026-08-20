import type { Metadata } from "next";

import { ActivityView } from "@/components/activity-view";
import { activityScopeFromQuery, taskCenterViewFromQuery } from "@/lib/task-center";

export const metadata: Metadata = { title: "活动" };

/** 活动（/activity）：观看（媒体库实时活动）与任务（下载/入库/后台作业）两个视角。 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const initialScope = activityScopeFromQuery(query.view);
  const initialView = taskCenterViewFromQuery(query.view);
  return (
    <ActivityView
      key={`${initialScope}:${initialView}`}
      initialScope={initialScope}
      initialView={initialView}
    />
  );
}
