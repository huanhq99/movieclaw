import type { Route } from "next";
import { redirect, RedirectType } from "next/navigation";

/**
 * 旧的任务中心路径。页面已重构为「活动」（观看 + 任务两个视角），此处永久
 * 重定向，保住用户收藏与站内历史深链——`?view=active` 这类查询原样透传，
 * 迁移后仍精确落在任务视角的对应状态。
 */
export default async function TasksRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && value[0] != null) params.set(key, value[0]);
  }
  const suffix = params.toString();
  redirect(`/activity${suffix ? `?${suffix}` : ""}` as Route, RedirectType.replace);
}
