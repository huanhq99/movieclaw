import { request } from "@/lib/http";
import type { MediaType } from "@/lib/media-types";

interface ApiEnvelope<T> {
  success: boolean;
  code: string;
  message: string;
  data: T;
}

export interface RecentWatchItem {
  media_item_id: number;
  library_id: number;
  kind: MediaType;
  title: string;
  year: number | null;
  poster_url: string | null;
  /** 电影横向背景剧照；缺失时前端用竖版海报生成模糊铺底。 */
  backdrop_url: string | null;
  /** 剧集最近播放那一集的 16:9 剧照；电影恒为 null。 */
  episode_still_url: string | null;
  season_number: number;
  episode_number: number;
  episode_title: string | null;
  /** 同一媒体库中排在最近播放那一集之后、仍在位且从未看过的分集数；电影恒为 0。 */
  unwatched_ahead_count: number;
  position_ms: number;
  duration_ms: number | null;
  progress_percent: number | null;
  played: boolean;
  play_count: number;
  last_played_at: string;
}

/** 当前账号在可见媒体库中的最近观看作品。 */
export async function listRecentWatch(limit = 20): Promise<RecentWatchItem[]> {
  const response = await request<ApiEnvelope<{ items: RecentWatchItem[] }>>(
    `/playback/recent?limit=${limit}`,
  );
  return response.data.items;
}

// ---------------------------------------------------------------------------
// 任务中心「媒体库」分类（管理员运维视角）
// ---------------------------------------------------------------------------

export interface MediaActivityTarget {
  media_item_id: number;
  /** 详情页落点；作品没有在位文件时为 null（此时不渲染跳转）。 */
  library_id: number | null;
  kind: MediaType;
  title: string;
  year: number | null;
  poster_url: string | null;
  season_number: number;
  episode_number: number;
  episode_title: string | null;
}

export interface PlaybackFileSpec {
  resolution: string | null;
  video_codec: string | null;
  hdr: string | null;
  container: string | null;
  bit_rate: number | null;
  size_bytes: number | null;
}

export interface ActivePlaybackSession {
  device_id: string;
  member_name: string;
  client: string;
  device_name: string;
  client_version: string;
  media: MediaActivityTarget;
  position_ms: number | null;
  duration_ms: number | null;
  progress_percent: number | null;
  paused: boolean;
  /** local = 本地文件直连（速率可测）；remote = 网盘直链等不经过服务器的播放。 */
  play_method: "local" | "remote";
  rate_bytes_per_second: number | null;
  bytes_sent: number | null;
  connections: number;
  file: PlaybackFileSpec | null;
  started_at: string;
  last_report_at: string;
}

export interface ActiveFileDownload {
  device_id: string;
  member_name: string;
  client: string;
  device_name: string;
  media: MediaActivityTarget | null;
  file_name: string;
  size_bytes: number;
  bytes_sent: number;
  rate_bytes_per_second: number;
  /** 同一设备同一文件的多条 Range 连接（断点续传）聚合后的连接数。 */
  connections: number;
  /** 已下载到文件的哪个字节位置（Range 起点 + 本次已传）。 */
  position_bytes: number;
  /** 由位置换算的完成百分比；文件大小未知时为 null。 */
  progress_percent: number | null;
  started_at: string;
}

export interface PlaybackDevice {
  device_id: string;
  device_name: string;
  client: string;
  client_version: string;
  member_name: string;
  last_seen_at: string | null;
  online: boolean;
}

export interface MediaRecentPlay {
  member_name: string;
  media: MediaActivityTarget;
  position_ms: number;
  duration_ms: number | null;
  progress_percent: number | null;
  played: boolean;
  play_count: number;
  last_played_at: string;
}

export interface MediaActivitySnapshot {
  sessions: ActivePlaybackSession[];
  downloads: ActiveFileDownload[];
  devices: PlaybackDevice[];
  recent: MediaRecentPlay[];
}

/** 任务中心媒体库分类的完整快照：正在播放/下载、设备清单与全成员最近观看。 */
export async function fetchMediaActivity(): Promise<MediaActivitySnapshot> {
  const response = await request<ApiEnvelope<MediaActivitySnapshot>>("/playback/activity");
  return response.data;
}

/** 注销一台播放器设备：凭据即刻失效，其正在进行的播放与取流一并停止。 */
export async function revokePlaybackDevice(deviceId: string): Promise<string> {
  const response = await request<ApiEnvelope<null>>(
    `/playback/devices/${encodeURIComponent(deviceId)}`,
    { method: "DELETE" },
  );
  return response.message;
}
