"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useClient } from "@/lib/client-context";
import { useRequireClient } from "@/lib/use-require-client";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { getReportList, triggerReport } from "@/lib/api";
import toast from "react-hot-toast";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface GscQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  prev_position: number | null;
  prev_clicks: number | null;
}

interface GscPage {
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}

interface GscData {
  site_url: string;
  top_queries: GscQuery[];
  top_pages: GscPage[];
  total_clicks: number;
  total_impressions: number;
  prev_total_clicks: number;
  prev_total_impressions: number;
}

interface GridPoint {
  lat: number;
  lng: number;
  rank: number | null;
  prev_rank?: number | null;
  change?: number | null;
}

type SerpPeriod = "30d" | "120d" | "1y";

interface SerpSnapshot {
  timestamp: number;
  date: string;
  arp: number | null;
  solv: number;
  found_in: number;
  data_points: number;
}

interface SerpKeywordHistory {
  current: SerpSnapshot;
  "30d": SerpSnapshot | null;
  "120d": SerpSnapshot | null;
  "365d": SerpSnapshot | null;
}

interface ReportData {
  content?: { total_published: number; social: number; blog: number; gbp: number };
  reviews?: {
    total_new: number;
    responded: number;
    avg_rating: number | null;
    by_platform: Record<string, number>;
  };
  directories?: {
    total_checked: number;
    inconsistent: number;
    by_directory: Record<string, { consistent: boolean | null; issues: string[] }>;
  };
  serp?: Array<{ keyword: string; grid_data: GridPoint[] }>;
  serp_history?: Record<string, SerpKeywordHistory>;
  gsc?: GscData;
}

interface Report {
  id: number;
  client_id: number;
  period_year: number;
  period_month: number;
  data: ReportData;
  generated_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function positionBadge(pos: number): string {
  if (pos <= 3) return "bg-signal-good text-ink-900";
  if (pos <= 10) return "bg-spark/20 text-signal-good";
  if (pos <= 20) return "bg-signal-warn/20 text-signal-warn";
  return "bg-ink-500 text-fg-3";
}

function deltaLabel(current: number, prev: number | null): React.ReactNode {
  if (prev === null || prev === 0) return null;
  const diff = current - prev;
  if (Math.abs(diff) < 0.5) return null;
  const improved = diff < 0; // lower position number = better rank
  return (
    <span className={`text-xs ml-1 ${improved ? "text-signal-good" : "text-signal-bad"}`}>
      {improved ? "↑" : "↓"}{Math.abs(diff).toFixed(1)}
    </span>
  );
}

function pctDelta(current: number, prev: number): string | null {
  if (!prev) return null;
  const pct = ((current - prev) / prev) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

function avgPosition(queries: GscQuery[]): number | null {
  const withData = queries.filter((q) => q.position > 0);
  if (!withData.length) return null;
  return withData.reduce((sum, q) => sum + q.position, 0) / withData.length;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string | number;
  delta?: string | null;
  hint?: string;
}) {
  return (
    <div className="bg-ink-700 rounded-xl border border-ink-600 p-5">
      <p className="text-xs font-sans font-medium text-fg-3 uppercase tracking-widest mb-2">{label}</p>
      <p className="text-3xl font-sans font-semibold text-fg-1 leading-none">{value}</p>
      {(delta || hint) && (
        <p className={`text-xs font-sans mt-2 ${delta ? (delta.startsWith("+") ? "text-signal-good" : "text-signal-bad") : "text-fg-3"}`}>
          {delta ?? hint}
        </p>
      )}
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-sans font-semibold text-fg-1 text-base">{title}</h2>
      {sub && <p className="text-xs text-fg-3 font-sans mt-0.5">{sub}</p>}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-ink-700 rounded-xl border border-ink-600 p-8 text-center">
      <p className="text-sm text-fg-3 font-sans">{message}</p>
    </div>
  );
}

function rankColor(rank: number | null): string {
  if (rank === null) return "bg-ink-500 text-fg-3";
  if (rank <= 3) return "bg-signal-good text-ink-900";
  if (rank <= 7) return "bg-spark/60 text-ink-900";
  if (rank <= 10) return "bg-signal-warn text-ink-900";
  if (rank <= 15) return "bg-signal-warn/60 text-ink-900";
  return "bg-signal-bad text-white";
}

const PERIOD_LABELS: Record<SerpPeriod, string> = { "30d": "30 days", "120d": "120 days", "1y": "1 year" };
const PERIOD_KEY_MAP: Record<SerpPeriod, keyof SerpKeywordHistory> = { "30d": "30d", "120d": "120d", "1y": "365d" };

function serpDelta(current: number | null, prev: number | null, invert = false): React.ReactNode {
  if (current === null || prev === null) return null;
  const diff = current - prev;
  if (Math.abs(diff) < 0.05) return <span className="text-xs text-fg-3 font-sans">No change</span>;
  const improved = invert ? diff < 0 : diff > 0;
  return (
    <span className={`text-xs font-sans font-medium ${improved ? "text-signal-good" : "text-signal-bad"}`}>
      {improved ? "↑" : "↓"} {Math.abs(diff).toFixed(1)}
    </span>
  );
}

function SerpStatCell({
  label,
  value,
  delta,
  description,
  insufficient,
}: {
  label: string;
  value: string;
  delta?: React.ReactNode;
  description: string;
  insufficient?: boolean;
}) {
  return (
    <div className="flex flex-col items-center text-center px-4 py-3 flex-1">
      <p className="text-xs font-sans font-medium text-fg-3 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-sans font-semibold text-fg-1 leading-none">{value}</p>
      <div className="h-4 flex items-center mt-1">
        {insufficient ? (
          <span className="text-[10px] text-fg-3 italic font-sans">Insufficient data</span>
        ) : delta ? delta : <span className="text-xs text-fg-3">—</span>}
      </div>
      <p className="text-[11px] text-fg-3 font-sans mt-1 leading-snug">{description}</p>
    </div>
  );
}

function SerpSummaryStrip({
  serp,
  history,
  period,
}: {
  serp: Array<{ keyword: string; grid_data: GridPoint[] }>;
  history: Record<string, SerpKeywordHistory> | undefined;
  period: SerpPeriod;
}) {
  const periodKey = PERIOD_KEY_MAP[period];
  const snapshots = serp
    .map((s) => history?.[s.keyword]?.current)
    .filter(Boolean) as SerpSnapshot[];
  const prevSnapshots = serp
    .map((s) => (history?.[s.keyword]?.[periodKey] as SerpSnapshot | null) ?? null);

  const arps = snapshots.filter((s) => s.arp !== null).map((s) => s.arp as number);
  const avgArp = arps.length ? arps.reduce((a, b) => a + b, 0) / arps.length : null;

  const solvs = snapshots.map((s) => s.solv);
  const avgSolv = solvs.length ? solvs.reduce((a, b) => a + b, 0) / solvs.length : null;

  const prevArps = prevSnapshots.filter((s): s is SerpSnapshot => s !== null && s.arp !== null).map((s) => s!.arp as number);
  const prevAvgArp = prevArps.length ? prevArps.reduce((a, b) => a + b, 0) / prevArps.length : null;
  const prevSolvs = prevSnapshots.filter((s): s is SerpSnapshot => s !== null).map((s) => s!.solv);
  const prevAvgSolv = prevSolvs.length ? prevSolvs.reduce((a, b) => a + b, 0) / prevSolvs.length : null;

  const improving = serp.filter((s) => {
    const cur = history?.[s.keyword]?.current;
    const prv = history?.[s.keyword]?.[periodKey] as SerpSnapshot | null;
    if (!cur || !prv || cur.arp === null || prv.arp === null) return false;
    return cur.arp < prv.arp;
  }).length;

  const hasPrevData = prevSnapshots.some((s) => s !== null);

  return (
    <div className="bg-ink-700 rounded-xl border border-ink-600 mb-4">
      <div className="flex divide-x divide-ink-600">
        <SerpStatCell
          label="Avg Rank"
          value={avgArp !== null ? avgArp.toFixed(1) : "—"}
          delta={hasPrevData ? serpDelta(avgArp, prevAvgArp, true) : undefined}
          insufficient={!hasPrevData}
          description="Average position across all keywords"
        />
        <SerpStatCell
          label="Avg SoLV"
          value={avgSolv !== null ? `${avgSolv.toFixed(1)}%` : "—"}
          delta={hasPrevData ? serpDelta(avgSolv, prevAvgSolv) : undefined}
          insufficient={!hasPrevData}
          description="Share of local voice (#1 rankings)"
        />
        <SerpStatCell
          label="Improving"
          value={hasPrevData ? `${improving} / ${serp.length}` : "—"}
          insufficient={!hasPrevData}
          description={`Keywords with better rank vs ${PERIOD_LABELS[period]} ago`}
        />
      </div>
    </div>
  );
}

function GeoGrid({
  keyword,
  gridData,
  history,
  period,
}: {
  keyword: string;
  gridData: GridPoint[];
  history?: SerpKeywordHistory;
  period: SerpPeriod;
}) {
  const periodKey = PERIOD_KEY_MAP[period];
  const cur = history?.current ?? null;
  const prv = (history?.[periodKey] as SerpSnapshot | null) ?? null;
  const hasPrev = prv !== null;

  const n = Math.round(Math.sqrt(gridData.length));
  const rows: GridPoint[][] = [];
  for (let i = 0; i < gridData.length; i += n) rows.push(gridData.slice(i, i + n));

  const ranked = gridData.filter((p) => p.rank !== null);
  const avgRank = ranked.length
    ? (ranked.reduce((s, p) => s + p.rank!, 0) / ranked.length).toFixed(1)
    : null;
  const top3 = ranked.filter((p) => p.rank! <= 3).length;

  return (
    <div className="bg-ink-700 rounded-xl border border-ink-600 p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm font-sans font-semibold text-fg-1">&ldquo;{keyword}&rdquo;</p>
          <p className="text-xs text-fg-3 font-sans mt-0.5">{gridData.length}-point geo-grid · Google Maps</p>
        </div>
        <div className="flex gap-4 text-right">
          {avgRank && (
            <div>
              <p className="text-lg font-sans font-semibold text-fg-1">{avgRank}</p>
              <p className="text-xs text-fg-3 font-sans">avg rank</p>
            </div>
          )}
          <div>
            <p className="text-lg font-sans font-semibold text-signal-good">{top3}</p>
            <p className="text-xs text-fg-3 font-sans">top 3</p>
          </div>
          <div>
            <p className="text-lg font-sans font-semibold text-fg-1">{ranked.length}/{gridData.length}</p>
            <p className="text-xs text-fg-3 font-sans">ranked</p>
          </div>
        </div>
      </div>

      <div className="inline-flex flex-col gap-1">
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-1">
            {row.map((pt, ci) => (
              <div
                key={ci}
                title={`${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)} — rank: ${pt.rank ?? "not ranked"}${pt.prev_rank != null ? ` (prev: ${pt.prev_rank})` : ""}`}
                className={`w-11 h-11 flex flex-col items-center justify-center rounded-md text-xs font-sans font-semibold ${rankColor(pt.rank)}`}
              >
                <span className="text-sm">{pt.rank ?? "—"}</span>
                {pt.change != null && pt.change !== 0 && (
                  <span className={`text-[9px] leading-none ${pt.change > 0 ? "text-signal-good/70" : "text-signal-bad/70"}`}>
                    {pt.change > 0 ? `+${pt.change}` : pt.change}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 mt-4 text-xs text-fg-3 font-sans">
        {[
          { color: "bg-signal-good", label: "#1–3" },
          { color: "bg-spark/60", label: "#4–7" },
          { color: "bg-signal-warn", label: "#8–10" },
          { color: "bg-signal-warn/60", label: "#11–15" },
          { color: "bg-signal-bad", label: "#16+" },
          { color: "bg-ink-500", label: "Not ranked" },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1">
            <span className={`w-3 h-3 rounded-sm ${color} inline-block`} />
            {label}
          </span>
        ))}
      </div>

      {/* ARP / SoLV / Coverage stats row */}
      {cur && (
        <div className="mt-4 pt-4 border-t border-ink-600 flex divide-x divide-ink-600">
          {/* ARP */}
          <div className="flex-1 flex flex-col items-center text-center px-3">
            <p className="text-xs font-sans font-medium text-fg-3 uppercase tracking-widest mb-1">ARP</p>
            <p className="text-xl font-sans font-semibold text-fg-1">
              {cur.arp !== null ? cur.arp.toFixed(1) : "—"}
            </p>
            <div className="h-4 flex items-center mt-0.5">
              {!hasPrev
                ? <span className="text-[10px] text-fg-3 italic font-sans">Insufficient data</span>
                : serpDelta(cur.arp, prv?.arp ?? null, true) ?? <span className="text-xs text-fg-3">—</span>}
            </div>
            <p className="text-[11px] text-fg-3 font-sans mt-1">Average rank position</p>
          </div>
          {/* SoLV */}
          <div className="flex-1 flex flex-col items-center text-center px-3">
            <p className="text-xs font-sans font-medium text-fg-3 uppercase tracking-widest mb-1">SoLV</p>
            <p className="text-xl font-sans font-semibold text-fg-1">{cur.solv.toFixed(1)}%</p>
            <div className="h-4 flex items-center mt-0.5">
              {!hasPrev
                ? <span className="text-[10px] text-fg-3 italic font-sans">Insufficient data</span>
                : serpDelta(cur.solv, prv?.solv ?? null) ?? <span className="text-xs text-fg-3">—</span>}
            </div>
            <p className="text-[11px] text-fg-3 font-sans mt-1">Share of local voice</p>
          </div>
          {/* Coverage */}
          <div className="flex-1 flex flex-col items-center text-center px-3">
            <p className="text-xs font-sans font-medium text-fg-3 uppercase tracking-widest mb-1">Coverage</p>
            <p className="text-xl font-sans font-semibold text-fg-1">{cur.found_in} / {cur.data_points}</p>
            <div className="h-4 flex items-center mt-0.5">
              {!hasPrev
                ? <span className="text-[10px] text-fg-3 italic font-sans">Insufficient data</span>
                : serpDelta(cur.found_in, prv?.found_in ?? null) ?? <span className="text-xs text-fg-3">—</span>}
            </div>
            <p className="text-[11px] text-fg-3 font-sans mt-1">Grid points ranked</p>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchPerformance({ gsc }: { gsc: GscData }) {
  const hasQueries = gsc.top_queries.length > 0;
  const hasPages = gsc.top_pages.length > 0;
  const avgPos = avgPosition(gsc.top_queries);

  return (
    <div className="space-y-4">
      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Organic clicks"
          value={gsc.total_clicks.toLocaleString()}
          delta={pctDelta(gsc.total_clicks, gsc.prev_total_clicks) ?? undefined}
          hint={gsc.prev_total_clicks === 0 ? "No prior data" : undefined}
        />
        <MetricCard
          label="Impressions"
          value={gsc.total_impressions.toLocaleString()}
          delta={pctDelta(gsc.total_impressions, gsc.prev_total_impressions) ?? undefined}
          hint={gsc.prev_total_impressions === 0 ? "No prior data" : undefined}
        />
        <MetricCard
          label="Avg CTR"
          value={
            gsc.total_impressions > 0
              ? ((gsc.total_clicks / gsc.total_impressions) * 100).toFixed(1) + "%"
              : "—"
          }
        />
        <MetricCard
          label="Avg position"
          value={avgPos !== null ? avgPos.toFixed(1) : "—"}
          hint="Across tracked queries"
        />
      </div>

      {/* Top Queries */}
      {hasQueries ? (
        <div className="bg-ink-700 rounded-xl border border-ink-600 overflow-hidden">
          <div className="px-6 py-4 border-b border-ink-600">
            <p className="text-sm font-sans font-semibold text-fg-1">Top search queries</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-fg-3 uppercase tracking-widest border-b border-ink-600 font-sans">
                  <th className="text-left px-6 py-3 font-medium">Query</th>
                  <th className="text-right px-4 py-3 font-medium">Position</th>
                  <th className="text-right px-4 py-3 font-medium">Clicks</th>
                  <th className="text-right px-4 py-3 font-medium">Impressions</th>
                  <th className="text-right px-6 py-3 font-medium">CTR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-600">
                {gsc.top_queries.map((row, i) => (
                  <tr key={i} className="hover:bg-ink-600/30 transition-colors duration-150">
                    <td className="px-6 py-3 text-fg-2 text-sm max-w-xs">
                      <span className="truncate block">{row.query}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-sans font-medium ${positionBadge(row.position)}`}>
                        #{row.position.toFixed(1)}
                      </span>
                      {deltaLabel(row.position, row.prev_position)}
                    </td>
                    <td className="px-4 py-3 text-right text-fg-1 font-sans font-medium">{row.clicks.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-fg-3 font-sans">{row.impressions.toLocaleString()}</td>
                    <td className="px-6 py-3 text-right text-fg-3 font-sans">{row.ctr}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState message="No query data yet — check back once Search Console has collected more data." />
      )}

      {/* Top Pages */}
      {hasPages && (
        <div className="bg-ink-700 rounded-xl border border-ink-600 overflow-hidden">
          <div className="px-6 py-4 border-b border-ink-600">
            <p className="text-sm font-sans font-semibold text-fg-1">Top pages by clicks</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-fg-3 uppercase tracking-widest border-b border-ink-600 font-sans">
                  <th className="text-left px-6 py-3 font-medium">Page</th>
                  <th className="text-right px-4 py-3 font-medium">Position</th>
                  <th className="text-right px-4 py-3 font-medium">Clicks</th>
                  <th className="text-right px-6 py-3 font-medium">Impressions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-600">
                {gsc.top_pages.map((row, i) => {
                  const path = row.page.replace(/^https?:\/\/[^/]+/, "") || "/";
                  return (
                    <tr key={i} className="hover:bg-ink-600/30 transition-colors duration-150">
                      <td className="px-6 py-3 text-fg-2 max-w-xs">
                        <span className="truncate block text-xs">{path}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-sans font-medium ${positionBadge(row.position)}`}>
                          #{row.position.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-fg-1 font-sans font-medium">{row.clicks.toLocaleString()}</td>
                      <td className="px-6 py-3 text-right text-fg-3 font-sans">{row.impressions.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ContentSection({ content }: { content: NonNullable<ReportData["content"]> }) {
  const items = [
    { label: "Social posts", value: content.social },
    { label: "Blog posts", value: content.blog },
    { label: "GBP posts", value: content.gbp },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map(({ label, value }) => (
        <div key={label} className="bg-ink-700 rounded-xl border border-ink-600 p-5 text-center">
          <p className="text-3xl font-sans font-semibold text-fg-1">{value}</p>
          <p className="text-xs text-fg-3 font-sans mt-1">{label}</p>
        </div>
      ))}
    </div>
  );
}

function ReviewsSection({ reviews }: { reviews: NonNullable<ReportData["reviews"]> }) {
  const responseRate =
    reviews.total_new > 0
      ? Math.round((reviews.responded / reviews.total_new) * 100)
      : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="New reviews" value={reviews.total_new} />
        <MetricCard
          label="Response rate"
          value={responseRate !== null ? `${responseRate}%` : "—"}
          hint={reviews.total_new > 0 ? `${reviews.responded} of ${reviews.total_new} responded` : undefined}
        />
        <MetricCard
          label="Avg rating"
          value={reviews.avg_rating !== null && reviews.avg_rating !== undefined ? `${reviews.avg_rating} / 5` : "—"}
        />
      </div>
      {Object.keys(reviews.by_platform).length > 0 && (
        <div className="bg-ink-700 rounded-xl border border-ink-600 p-5">
          <p className="text-xs font-sans font-medium text-fg-3 uppercase tracking-widest mb-3">By platform</p>
          <div className="flex flex-wrap gap-4">
            {Object.entries(reviews.by_platform).map(([platform, count]) => (
              <div key={platform} className="flex items-center gap-2">
                <span className="text-sm font-sans font-semibold text-fg-1">{count}</span>
                <span className="text-sm text-fg-3 font-sans capitalize">{platform}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DirectorySection({ directories }: { directories: NonNullable<ReportData["directories"]> }) {
  const entries = Object.entries(directories.by_directory);
  return (
    <div className="bg-ink-700 rounded-xl border border-ink-600 overflow-hidden">
      <div className="px-6 py-4 border-b border-ink-600 flex items-center justify-between">
        <p className="text-sm font-sans font-semibold text-fg-1">NAP consistency</p>
        <span className={`text-xs font-sans font-medium px-2.5 py-1 rounded-md border ${
          directories.inconsistent === 0
            ? "border-signal-good/30 text-signal-good bg-signal-good/10"
            : "border-signal-bad/30 text-signal-bad bg-signal-bad/10"
        }`}>
          {directories.inconsistent === 0
            ? "All consistent"
            : `${directories.inconsistent} issue${directories.inconsistent !== 1 ? "s" : ""}`}
        </span>
      </div>
      {entries.length > 0 && (
        <div className="divide-y divide-ink-600">
          {entries.map(([dir, info]) => (
            <div key={dir} className="px-6 py-3 flex items-center justify-between text-sm">
              <span className="text-fg-2 font-sans capitalize">{dir}</span>
              <span className={`font-sans ${info.consistent === false ? "text-signal-bad" : "text-signal-good"}`}>
                {info.consistent === false
                  ? `${info.issues.length} issue${info.issues.length !== 1 ? "s" : ""}`
                  : "Consistent"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { user, isAdmin } = useAuth();
  const { selectedClient } = useClient();
  const router = useRouter();
  const ready = useRequireClient();

  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<Report | null>(null);
  const [fetching, setFetching] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [serpPeriod, setSerpPeriod] = useState<SerpPeriod>("30d");

  useEffect(() => {
    if (!user || !selectedClient) return;
    setFetching(true);
    setReports([]);
    setSelected(null);
    getReportList(selectedClient.id)
      .then((data) => {
        setReports(data);
        if (data.length > 0) setSelected(data[0]);
      })
      .finally(() => setFetching(false));
  }, [user, selectedClient]);

  const handleGenerate = async () => {
    if (!selectedClient) return;
    setGenerating(true);
    try {
      await triggerReport(undefined, undefined, selectedClient.id);
      toast.success("Generating report — refresh in ~30 seconds");
    } catch {
      toast.error("Failed to trigger report");
    } finally {
      setGenerating(false);
    }
  };

  if (!ready) return null;

  const d = selected?.data;

  return (
    <div className="min-h-screen bg-ink-900">
      <Nav />
      <main className="max-w-5xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="font-sans font-semibold text-fg-1 text-2xl">Performance report</h1>
            {selected && (
              <p className="text-sm text-fg-3 font-sans mt-1">
                {MONTH_NAMES[selected.period_month]} {selected.period_year}
                {" · "}Generated {new Date(selected.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {reports.length > 1 && (
              <select
                value={selected?.id ?? ""}
                onChange={(e) => {
                  const r = reports.find((r) => r.id === Number(e.target.value));
                  if (r) setSelected(r);
                }}
                className="input w-auto"
              >
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {MONTH_NAMES[r.period_month]} {r.period_year}
                  </option>
                ))}
              </select>
            )}
            {isAdmin && (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="btn-primary disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate now"}
              </button>
            )}
          </div>
        </div>

        {fetching && (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-ink-600 border-t-tint rounded-full animate-spin" />
          </div>
        )}

        {!fetching && reports.length === 0 && (
          <div className="bg-ink-700 rounded-xl border border-ink-600 p-16 text-center">
            <p className="text-fg-3 font-sans text-sm mb-4">No reports generated yet.</p>
            {isAdmin && (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="btn-primary disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate first report"}
              </button>
            )}
          </div>
        )}

        {selected && d && (
          <div className="space-y-10">

            {/* Search Performance */}
            <section>
              <SectionHeader
                title="Search performance"
                sub="Organic search data via Google Search Console"
              />
              {d.gsc && d.gsc.top_queries && (d.gsc.top_queries.length > 0 || d.gsc.total_impressions > 0) ? (
                <SearchPerformance gsc={d.gsc} />
              ) : (
                <EmptyState message="Search Console data will appear here once Google has indexed the site and collected enough data." />
              )}
            </section>

            {/* Geo-grid */}
            {d.serp && d.serp.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <SectionHeader
                    title="Local map rankings"
                    sub="Google Maps rank across geographic grid points"
                  />
                  <div className="flex items-center gap-1 bg-ink-700 border border-ink-600 rounded-md p-1 text-xs font-sans font-medium">
                    {(["30d", "120d", "1y"] as SerpPeriod[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setSerpPeriod(p)}
                        className={`px-3 py-1 rounded-md transition-colors duration-150 ${
                          serpPeriod === p
                            ? "bg-ink-500 text-fg-1"
                            : "text-fg-3 hover:text-fg-2"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <SerpSummaryStrip serp={d.serp} history={d.serp_history} period={serpPeriod} />
                <div className="grid grid-cols-2 gap-4">
                  {d.serp.map((s) => (
                    <GeoGrid
                      key={s.keyword}
                      keyword={s.keyword}
                      gridData={s.grid_data}
                      history={d.serp_history?.[s.keyword]}
                      period={serpPeriod}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Content */}
            {d.content && (
              <section>
                <SectionHeader
                  title="Content published"
                  sub={`${d.content.total_published} piece${d.content.total_published !== 1 ? "s" : ""} published this month`}
                />
                <ContentSection content={d.content} />
              </section>
            )}

            {/* Reviews */}
            {d.reviews && (
              <section>
                <SectionHeader
                  title="Reviews"
                  sub="New reviews detected this month"
                />
                <ReviewsSection reviews={d.reviews} />
              </section>
            )}

            {/* Directories */}
            {d.directories && d.directories.total_checked > 0 && (
              <section>
                <SectionHeader
                  title="Directory listings"
                  sub={`${d.directories.total_checked} directories checked`}
                />
                <DirectorySection directories={d.directories} />
              </section>
            )}

          </div>
        )}
      </main>
    </div>
  );
}
