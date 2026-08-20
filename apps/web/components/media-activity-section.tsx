"use client";

import { useCallback, useRef, useState } from "react";

import type { Route } from "next";
import Link from "next/link";

import {
  CheckIcon,
  ChevronRightIcon,
  DownloadIcon,
  PlayIcon,
  ServerIcon,
} from "@/components/icons";
import { OverflowText } from "@/components/overflow-text";
import { PosterImage } from "@/components/poster-image";
import {
  fetchMediaActivity,
  type ActiveFileDownload,
  type ActivePlaybackSession,
  type MediaActivitySnapshot,
  type MediaActivityTarget,
  type MediaRecentPlay,
  type PlaybackDevice,
} from "@/lib/api/playback";
import { formatBytes } from "@/lib/format";
import { imageUrl } from "@/lib/image-proxy";
import { formatRelativeTime } from "@/lib/time";
import { useVisiblePolling } from "@/lib/use-visible-polling";

/** 实时会话的轮询节奏：比下载快照（10s）稍快，速率读数才跟得上直觉。 */
const POLL_INTERVAL_MS = 8_000;

const EMPTY_SNAPSHOT: MediaActivitySnapshot = {
  sessions: [],
  downloads: [],
  devices: [],
  recent: [],
};

export interface MediaActivityState {
  snapshot: MediaActivitySnapshot;
  loading: boolean;
  error: string | null;
}

/**
 * 媒体库活动快照的轮询装载。活动页是唯一消费方，单挂载点即可，
 * 不需要 Provider；页面隐藏时暂停，恢复可见立即校准。
 */
export function useMediaActivity(enabled: boolean): MediaActivityState {
  const [snapshot, setSnapshot] = useState<MediaActivitySnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const loaded = useRef(false);

  const refresh = useCallback(() => {
    if (!enabled || pending.current) return;
    pending.current = true;
    // 首次装载（含从非轮询视图切回）显示读取态，而不是闪一下空态
    if (!loaded.current) setLoading(true);
    void (async () => {
      try {
        setSnapshot(await fetchMediaActivity());
        setError(null);
        loaded.current = true;
      } catch (caught) {
        setError((caught as Error).message || "媒体库活动加载失败");
      } finally {
        pending.current = false;
        setLoading(false);
      }
    })();
  }, [enabled]);

  useVisiblePolling(refresh, enabled ? POLL_INTERVAL_MS : null, { leading: true });
  return { snapshot, loading, error };
}

function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** 毫秒 → 播放器习惯的 h:mm:ss / m:ss。 */
function formatPlayClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (v: number) => String(v).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

function unitLabel(media: MediaActivityTarget): string | null {
  if (media.kind !== "tv") return null;
  const season = String(media.season_number).padStart(2, "0");
  const episode = String(media.episode_number).padStart(2, "0");
  return `S${season}E${episode}`;
}

function deviceLabel(client: string, deviceName: string): string {
  if (client && deviceName && client !== deviceName) return `${client} · ${deviceName}`;
  return deviceName || client || "未知设备";
}

/** 元信息行：过滤空片段后用「·」连接，避免设备名或客户端缺失时留下悬空分隔符。 */
function MetaLine({
  parts,
  className = "",
}: {
  parts: (string | null | undefined)[];
  className?: string;
}) {
  const kept = parts.filter((part): part is string => Boolean(part && part.trim()));
  if (kept.length === 0) return null;
  return (
    <p className={`truncate text-caption leading-5 text-white/40 ${className}`}>
      {kept.map((part, index) => (
        <span key={index}>
          {index > 0 && <span className="mx-1.5 text-white/20">·</span>}
          {part}
        </span>
      ))}
    </p>
  );
}

function detailHref(media: MediaActivityTarget): Route | null {
  if (media.library_id == null) return null;
  return `/library/${media.library_id}/item/${media.media_item_id}` as Route;
}

/**
 * 「全部」视图顶部的媒体库活动汇总导航：只报数与聚合速率，明细交给
 * 媒体库视图承载，不把播放行混进任务 Feed。没有实时活动时不渲染。
 */
export function MediaActivitySummaryNav({
  snapshot,
  onOpen,
}: {
  snapshot: MediaActivitySnapshot;
  onOpen: () => void;
}) {
  const playing = snapshot.sessions.length;
  const downloading = snapshot.downloads.length;
  if (playing === 0 && downloading === 0) return null;
  const allPaused = playing > 0 && snapshot.sessions.every((s) => s.paused);
  const totalRate =
    snapshot.sessions.reduce((sum, s) => sum + (s.rate_bytes_per_second ?? 0), 0) +
    snapshot.downloads.reduce((sum, d) => sum + d.rate_bytes_per_second, 0);
  const parts: string[] = [];
  if (playing > 0) parts.push(`正在播放 ${playing}`);
  if (downloading > 0) parts.push(`正在下载 ${downloading}`);
  if (totalRate > 0) parts.push(formatRate(totalRate));
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-4 flex w-full items-center gap-3 rounded-xl border border-[var(--info)]/25 bg-[var(--info)]/[0.07] px-4 py-3 text-left transition hover:border-[var(--info)]/40 hover:bg-[var(--info)]/[0.12]"
    >
      <span className="relative flex size-2 shrink-0" aria-hidden="true">
        {!allPaused && (
          <span className="absolute inline-flex size-2 motion-safe:animate-ping rounded-full bg-[var(--info)]/60" />
        )}
        <span className="relative inline-flex size-2 rounded-full bg-[var(--info)]" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sub text-white/85">
        <span className="font-semibold">媒体库</span>
        <span className="tnum ml-2.5 text-white/60">{parts.join(" · ")}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-caption font-semibold text-[var(--info)]">
        查看明细
        <ChevronRightIcon className="size-3.5" />
      </span>
    </button>
  );
}

/** 会话/下载卡的海报位；可跳详情时整块可点。 */
function ActivityPoster({
  media,
  className,
}: {
  media: MediaActivityTarget | null;
  className: string;
}) {
  const image = (
    <PosterImage
      src={media?.poster_url ? imageUrl(media.poster_url) : null}
      alt={media?.title ?? "未知内容"}
      className={`${className} rounded-lg object-cover ring-1 ring-white/10`}
    />
  );
  const href = media ? detailHref(media) : null;
  if (!href) return <span className="shrink-0">{image}</span>;
  return (
    <Link href={href} className="shrink-0 transition hover:opacity-80">
      {image}
    </Link>
  );
}

/** 作品标题（含年份 / 季集 / 单集名）；可跳详情时标题可点。 */
function ActivityTitle({ media }: { media: MediaActivityTarget }) {
  const unit = unitLabel(media);
  const href = detailHref(media);
  const text = (
    <>
      {media.title}
      {media.year != null && <span className="ml-1.5 font-normal text-white/45">{media.year}</span>}
      {unit && <span className="tnum ml-1.5 font-normal text-white/60">{unit}</span>}
      {media.episode_title && (
        <span className="ml-1.5 font-normal text-white/45">{media.episode_title}</span>
      )}
    </>
  );
  if (!href) {
    return (
      <OverflowText lines={1} className="text-ui font-semibold text-white/90">
        {text}
      </OverflowText>
    );
  }
  return (
    <OverflowText lines={1} className="text-ui font-semibold text-white/90">
      <Link href={href} className="transition hover:text-white">
        {text}
      </Link>
    </OverflowText>
  );
}

/**
 * 状态徽标。窄屏收敛为单个彩色圆点（与任务视角既有约定一致，
 * docs/design/activity.md：状态在移动端压缩为一个彩色圆点）——
 * 文字降为 sr-only 而不是从 DOM 摘除，读屏用户仍能听到状态。
 */
function StatusBadge({ paused }: { paused: boolean }) {
  const tone = paused
    ? { pill: "bg-white/[0.08] text-white/55", dot: "bg-white/40" }
    : { pill: "bg-[var(--ok)]/12 text-[var(--ok)]", dot: "bg-[var(--ok)]" };
  return (
    <span
      title={paused ? "已暂停" : "播放中"}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-semibold max-md:bg-transparent max-md:p-0 ${tone.pill}`}
    >
      <span className="relative flex size-1.5 max-md:size-2" aria-hidden="true">
        {!paused && (
          <span
            className={`absolute inline-flex size-1.5 motion-safe:animate-ping rounded-full max-md:size-2 ${tone.dot} opacity-60`}
          />
        )}
        <span className={`relative inline-flex size-1.5 rounded-full max-md:size-2 ${tone.dot}`} />
      </span>
      <span className="max-md:sr-only">{paused ? "已暂停" : "播放中"}</span>
    </span>
  );
}

function SessionCard({ session }: { session: ActivePlaybackSession }) {
  const media = session.media;
  const percent = session.progress_percent;
  const specParts = [
    session.file?.resolution,
    session.file?.video_codec?.toUpperCase(),
    session.file?.hdr,
    session.file?.bit_rate ? `${(session.file.bit_rate / 1_000_000).toFixed(1)} Mbps` : null,
    session.file?.size_bytes ? formatBytes(session.file.size_bytes) : null,
  ].filter(Boolean) as string[];
  return (
    <ActivityCard percent={percent} muted={session.paused}>
      <ActivityPoster media={media} className="h-24 w-16 max-md:h-[76px] max-md:w-[52px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2.5">
          <ActivityTitle media={media} />
          <StatusBadge paused={session.paused} />
        </div>
        <MetaLine
          parts={[
            session.member_name,
            deviceLabel(session.client, session.device_name),
            session.client_version,
          ]}
        />
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-white/40">
          {session.play_method === "local" ? (
            <>
              {session.rate_bytes_per_second != null && session.rate_bytes_per_second > 0 ? (
                <span className="tnum font-medium text-[var(--info)]">
                  {formatRate(session.rate_bytes_per_second)}
                </span>
              ) : (
                <span className="text-white/55">本地直连</span>
              )}
              {session.bytes_sent != null && session.bytes_sent > 0 && (
                <span className="tnum">已传输 {formatBytes(session.bytes_sent)}</span>
              )}
              {session.connections > 1 && <span>{session.connections} 条连接</span>}
            </>
          ) : (
            <span>网盘直链 · 流量不经过服务器</span>
          )}
          {/* 规格串在窄屏会折成孤字行，移动端交给详情页 */}
          {specParts.length > 0 && (
            <span className="text-white/35 max-md:hidden">{specParts.join(" · ")}</span>
          )}
        </div>
        <ClockLine
          percent={percent}
          positionMs={session.position_ms}
          durationMs={session.duration_ms}
        />
      </div>
    </ActivityCard>
  );
}

/**
 * 会话/下载共用的卡片外壳：高度由海报决定，进度条贴卡片底边横跨全宽。
 *
 * 贴底全宽细条是媒体服务端的通行形态（Jellyfin 控制台、Plex 活动、
 * Netflix 缩略图）：多张卡片的进度共享同一条基线，可以互相比较；进度条
 * 只当视觉指示器，具体时刻与百分比放在文字区，不被拉到卡片另一端。
 */
function ActivityCard({
  children,
  percent,
  muted = false,
}: {
  children: React.ReactNode;
  percent?: number | null;
  muted?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03]">
      <div className="flex gap-3.5 p-3.5 pb-4 max-md:gap-3 max-md:p-3 max-md:pb-3.5">
        {children}
      </div>
      {percent != null && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/[0.06]">
          <div
            className="h-full transition-[width] duration-700"
            style={{
              width: `${Math.min(100, Math.max(1, percent))}%`,
              backgroundColor: muted ? "rgba(255,255,255,0.3)" : "var(--info)",
            }}
          />
        </div>
      )}
    </div>
  );
}

/** 时刻行：位置 / 总时长 · 百分比。进度的图形部分由卡片底边的条承担。 */
function ClockLine({
  percent,
  positionMs,
  durationMs,
}: {
  percent: number | null;
  positionMs: number | null;
  durationMs: number | null;
}) {
  if (positionMs == null && percent == null) return null;
  return (
    <p className="tnum mt-auto pt-1 text-caption text-white/45">
      {positionMs != null && (
        <>
          {formatPlayClock(positionMs)}
          {durationMs != null && (
            <span className="text-white/25"> / {formatPlayClock(durationMs)}</span>
          )}
        </>
      )}
      {percent != null && (
        <>
          {positionMs != null && <span className="mx-1.5 text-white/20">·</span>}
          <span className="font-medium text-white/60">{percent}%</span>
        </>
      )}
    </p>
  );
}

function DownloadCard({ download }: { download: ActiveFileDownload }) {
  const media = download.media;
  return (
    <ActivityCard percent={download.progress_percent}>
      <ActivityPoster media={media} className="h-24 w-16 max-md:h-[76px] max-md:w-[52px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2.5">
          {media ? (
            <ActivityTitle media={media} />
          ) : (
            <OverflowText lines={1} className="text-ui font-semibold text-white/90">
              {download.file_name}
            </OverflowText>
          )}
          <span
            title="文件下载"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--info)]/12 px-2 py-0.5 text-caption font-semibold text-[var(--info)] max-md:bg-transparent max-md:p-0"
          >
            <DownloadIcon className="size-3 max-md:size-3.5" />
            <span className="max-md:sr-only">文件下载</span>
          </span>
        </div>
        <MetaLine
          parts={[download.member_name, deviceLabel(download.client, download.device_name)]}
        />
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-white/40">
          {download.rate_bytes_per_second > 0 && (
            <span className="tnum font-medium text-[var(--info)]">
              {formatRate(download.rate_bytes_per_second)}
            </span>
          )}
          <span className="tnum">
            {formatBytes(download.position_bytes)}
            {download.size_bytes > 0 && (
              <span className="text-white/25"> / {formatBytes(download.size_bytes)}</span>
            )}
            {download.progress_percent != null && (
              <span className="ml-1.5 font-medium text-white/60">
                {download.progress_percent}%
              </span>
            )}
          </span>
          {download.connections > 1 && <span>{download.connections} 条连接</span>}
        </div>
        {media && (
          <OverflowText lines={1} className="mt-auto pt-1 text-caption text-white/30">
            {download.file_name}
          </OverflowText>
        )}
      </div>
    </ActivityCard>
  );
}

function DeviceRow({ device }: { device: PlaybackDevice }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 max-md:px-3.5">
      <span className="relative flex size-2 shrink-0" aria-hidden="true">
        {device.online && (
          <span className="absolute inline-flex size-2 motion-safe:animate-ping rounded-full bg-[var(--ok)]/50" />
        )}
        <span
          className={`relative inline-flex size-2 rounded-full ${
            device.online ? "bg-[var(--ok)]" : "bg-white/20"
          }`}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui text-white/85">
          {device.device_name || device.client || device.device_id}
        </p>
        <MetaLine
          className="mt-0.5"
          parts={[
            // 设备名缺席时客户端已经当了主标题，副行不再重复一遍
            device.device_name
              ? [device.client, device.client_version].filter(Boolean).join(" ")
              : null,
            device.member_name,
          ]}
        />
      </div>
      <span
        className={`shrink-0 text-caption ${
          device.online ? "font-medium text-[var(--ok)]" : "text-white/35"
        }`}
      >
        {device.online
          ? "正在活动"
          : device.last_seen_at
            ? formatRelativeTime(device.last_seen_at)
            : "从未使用"}
      </span>
    </div>
  );
}

function RecentRow({ entry }: { entry: MediaRecentPlay }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 max-md:px-3.5">
      <ActivityPoster media={entry.media} className="h-[42px] w-[28px]" />
      <div className="min-w-0 flex-1">
        <ActivityTitle media={entry.media} />
        <MetaLine
          className="mt-0.5"
          parts={[formatRelativeTime(entry.last_played_at), entry.member_name]}
        />
      </div>
      {entry.played ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-caption text-[var(--ok)]">
          <CheckIcon className="size-3" />
          已看完
        </span>
      ) : (
        <span className="tnum shrink-0 text-caption text-white/45">
          {entry.progress_percent != null ? `看到 ${entry.progress_percent}%` : "播放过"}
        </span>
      )}
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      {icon}
      <h2 className="text-ui font-semibold text-white/65">{title}</h2>
      <span className="tnum text-caption text-white/30">{count}</span>
      <span aria-hidden="true" className="h-px min-w-8 flex-1 bg-white/[0.09]" />
    </div>
  );
}

/**
 * 「观看」视角主体：正在播放（含整文件下载）→ 设备 → 最近观看。
 * 实时段来自内存快照（服务重启即清空），历史段来自 playback_state 领域表。
 */
export function MediaActivityPanel({ snapshot, loading, error }: MediaActivityState) {
  const liveCount = snapshot.sessions.length + snapshot.downloads.length;
  const empty =
    liveCount === 0 && snapshot.devices.length === 0 && snapshot.recent.length === 0;

  if (loading && empty) {
    return (
      <div className="flex items-center justify-center gap-2.5 py-20 text-ui text-[var(--text-muted)]">
        <span className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
        正在读取媒体库活动…
      </div>
    );
  }
  return (
    <div>
      {error && (
        <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sub leading-6 text-amber-100">
          {error}
        </p>
      )}

      <section className="mt-6" aria-label="正在播放">
        <SectionHeading
          icon={<PlayIcon className="size-4 text-[var(--info)]" />}
          title="正在播放"
          count={liveCount}
        />
        {liveCount === 0 ? (
          <p className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-6 text-center text-sub text-[var(--text-muted)]">
            当前没有设备在播放；设备开始播放后几秒内会出现在这里。
          </p>
        ) : (
          <div className="space-y-2.5">
            {snapshot.sessions.map((session) => (
              <SessionCard
                key={`${session.device_id}-${session.media.media_item_id}-${session.media.season_number}-${session.media.episode_number}`}
                session={session}
              />
            ))}
            {snapshot.downloads.map((download) => (
              <DownloadCard
                key={`${download.device_id}-${download.file_name}`}
                download={download}
              />
            ))}
          </div>
        )}
      </section>

      {snapshot.devices.length > 0 && (
        <section className="mt-7" aria-label="播放器设备">
          <SectionHeading
            icon={<ServerIcon className="size-4 text-white/40" />}
            title="设备"
            count={snapshot.devices.length}
          />
          <div className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-white/[0.02]">
            {snapshot.devices.map((device) => (
              <DeviceRow key={device.device_id} device={device} />
            ))}
          </div>
        </section>
      )}

      {snapshot.recent.length > 0 && (
        <section className="mt-7" aria-label="最近观看">
          <SectionHeading
            icon={<PlayIcon className="size-4 text-white/40" />}
            title="最近观看"
            count={snapshot.recent.length}
          />
          <div className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-white/[0.02]">
            {snapshot.recent.map((entry, index) => (
              <RecentRow
                key={`${entry.member_name}-${entry.media.media_item_id}-${index}`}
                entry={entry}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
