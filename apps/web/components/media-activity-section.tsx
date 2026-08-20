"use client";

import { useCallback, useRef, useState } from "react";

import { ChevronRightIcon, DownloadIcon, PlayIcon, ServerIcon } from "@/components/icons";
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
 * 媒体库活动快照的轮询装载。任务中心是唯一消费方，单挂载点即可，
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
      className="mt-4 flex w-full items-center gap-3 rounded-xl border border-[var(--info)]/25 bg-[var(--info)]/[0.07] px-4 py-3 text-left transition hover:bg-[var(--info)]/[0.12]"
    >
      <PlayIcon className="size-4 shrink-0 text-[var(--info)]" />
      <span className="min-w-0 flex-1 text-sub text-white/85">
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

/** 会话/下载卡与历史行共用的海报位。 */
function ActivityPoster({ media }: { media: MediaActivityTarget | null }) {
  return (
    <PosterImage
      src={media?.poster_url ? imageUrl(media.poster_url) : null}
      alt={media?.title ?? "未知内容"}
      className="h-[72px] w-12 shrink-0 rounded-lg object-cover"
    />
  );
}

function SessionCard({ session }: { session: ActivePlaybackSession }) {
  const media = session.media;
  const unit = unitLabel(media);
  const percent = session.progress_percent;
  const specParts = [
    session.file?.resolution,
    session.file?.video_codec?.toUpperCase(),
    session.file?.hdr,
    session.file?.bit_rate ? `${(session.file.bit_rate / 1_000_000).toFixed(1)} Mbps` : null,
    session.file?.size_bytes ? formatBytes(session.file.size_bytes) : null,
  ].filter(Boolean) as string[];
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5">
      <div className="flex gap-3">
        <ActivityPoster media={media} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2.5">
            <OverflowText lines={1} className="text-ui font-semibold text-white/90">
              {media.title}
              {media.year != null && <span className="ml-1.5 text-white/45">{media.year}</span>}
              {unit && <span className="tnum ml-1.5 text-white/60">{unit}</span>}
              {media.episode_title && (
                <span className="ml-1.5 text-white/45">{media.episode_title}</span>
              )}
            </OverflowText>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold ${
                session.paused
                  ? "bg-white/[0.08] text-white/55"
                  : "bg-[var(--ok)]/12 text-[var(--ok)]"
              }`}
            >
              {session.paused ? "已暂停" : "播放中"}
            </span>
          </div>
          <p className="mt-1 text-caption leading-5 text-white/50">
            {session.member_name} · {deviceLabel(session.client, session.device_name)}
            {session.client_version && (
              <span className="text-white/30"> {session.client_version}</span>
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-white/40">
            {session.play_method === "local" ? (
              <>
                <span className="text-white/55">本地直连</span>
                {session.rate_bytes_per_second != null && (
                  <span className="tnum">{formatRate(session.rate_bytes_per_second)}</span>
                )}
                {session.bytes_sent != null && (
                  <span className="tnum">已传输 {formatBytes(session.bytes_sent)}</span>
                )}
                {session.connections > 1 && <span>{session.connections} 条连接</span>}
              </>
            ) : (
              <span>网盘直链 · 流量不经过服务器</span>
            )}
            {specParts.length > 0 && <span>{specParts.join(" · ")}</span>}
          </div>
        </div>
      </div>
      {percent != null && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-[var(--info)] transition-[width] duration-700"
            style={{ width: `${Math.min(100, Math.max(1, percent))}%` }}
          />
        </div>
      )}
      {session.position_ms != null && (
        <p className="tnum mt-1.5 text-caption text-white/40">
          {formatPlayClock(session.position_ms)}
          {session.duration_ms != null && ` / ${formatPlayClock(session.duration_ms)}`}
          {percent != null && ` · ${percent}%`}
        </p>
      )}
    </div>
  );
}

function DownloadCard({ download }: { download: ActiveFileDownload }) {
  const media = download.media;
  const unit = media ? unitLabel(media) : null;
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5">
      <div className="flex gap-3">
        <ActivityPoster media={media} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2.5">
            <OverflowText lines={1} className="text-ui font-semibold text-white/90">
              {media ? media.title : download.file_name}
              {unit && <span className="tnum ml-1.5 text-white/60">{unit}</span>}
            </OverflowText>
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--info)]/12 px-2 py-0.5 text-caption font-semibold text-[var(--info)]">
              <DownloadIcon className="size-3" />
              文件下载
            </span>
          </div>
          <p className="mt-1 text-caption leading-5 text-white/50">
            {download.member_name} · {deviceLabel(download.client, download.device_name)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-white/40">
            <span className="tnum">{formatRate(download.rate_bytes_per_second)}</span>
            <span className="tnum">
              本次已传 {formatBytes(download.bytes_sent)}
              {download.size_bytes > 0 && ` / 文件 ${formatBytes(download.size_bytes)}`}
            </span>
            <OverflowText lines={1} className="min-w-0 max-w-full text-white/30">
              {download.file_name}
            </OverflowText>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviceRow({ device }: { device: PlaybackDevice }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="relative flex size-2 shrink-0" aria-hidden="true">
        <span
          className={`size-2 rounded-full ${
            device.online ? "bg-[var(--ok)] ring-4 ring-[var(--ok)]/15" : "bg-white/20"
          }`}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui text-white/85">
          {device.device_name || device.client || device.device_id}
          {device.client && device.device_name && (
            <span className="ml-2 text-caption text-white/45">
              {device.client}
              {device.client_version && ` ${device.client_version}`}
            </span>
          )}
        </p>
      </div>
      <span className="shrink-0 text-caption text-white/50">{device.member_name}</span>
      <span className="w-24 shrink-0 text-right text-caption text-white/35 max-md:hidden">
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
  const unit = unitLabel(entry.media);
  const result = entry.played
    ? "已看完"
    : entry.progress_percent != null
      ? `看到 ${entry.progress_percent}%`
      : "播放过";
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="w-16 shrink-0 text-caption text-white/35">
        {formatRelativeTime(entry.last_played_at)}
      </span>
      <span className="shrink-0 text-caption text-white/50">{entry.member_name}</span>
      <OverflowText lines={1} className="min-w-0 flex-1 text-ui text-white/85">
        {entry.media.title}
        {unit && <span className="tnum ml-1.5 text-white/55">{unit}</span>}
        {entry.media.episode_title && (
          <span className="ml-1.5 text-white/45">{entry.media.episode_title}</span>
        )}
      </OverflowText>
      <span
        className={`shrink-0 text-caption ${entry.played ? "text-[var(--ok)]" : "text-white/45"}`}
      >
        {result}
      </span>
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
 * 媒体库视图主体：正在播放（含整文件下载）→ 设备 → 最近观看。
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
              <SessionCard key={`${session.device_id}-${session.media.media_item_id}`} session={session} />
            ))}
            {snapshot.downloads.map((download, index) => (
              <DownloadCard key={`${download.device_id}-${download.file_name}-${index}`} download={download} />
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
              <RecentRow key={`${entry.member_name}-${entry.media.media_item_id}-${index}`} entry={entry} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
