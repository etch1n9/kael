import React, { useId, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import {
  calculateSparklineMetrics,
  CashflowChartPoint,
  formatPercentBadge,
  formatRupiah,
} from '../utils/clinicalLogic';

interface KpiMiniSparklineProps {
  values: number[];
  strokeColor?: string;
  fillColor?: string;
  dotColor?: string;
  badgeTextColor?: string;
  height?: number;
  invertTrendColor?: boolean;
  darkSurface?: boolean;
}

export const KpiMiniSparkline: React.FC<KpiMiniSparklineProps> = ({
  values,
  strokeColor = '#00897B',
  fillColor = '#00897B',
  dotColor = '#00897B',
  badgeTextColor,
  height = 46,
  invertTrendColor = false,
  darkSurface = false,
}) => {
  const gradId = useId();
  const metrics = calculateSparklineMetrics(values);

  if (!values || values.length < 2) {
    return null;
  }

  const width = 240;
  const topPad = 8;
  const bottomPad = 4;
  const leftPad = 4;
  const rightPad = 8;
  const plotW = width - leftPad - rightPad;
  const plotH = height - topPad - bottomPad;

  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = Math.max(1, maxV - minV);

  const coords = values.map((v, idx) => {
    const x = leftPad + (idx / Math.max(1, values.length - 1)) * plotW;
    const y = topPad + plotH * 0.9 - ((v - minV) / range) * (plotH * 0.8);
    return { x, y, v };
  });

  const polylinePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const firstPt = coords[0];
  const lastPt = coords[coords.length - 1];
  const baselineY = topPad + plotH;

  const areaPoints = `${firstPt.x.toFixed(1)},${baselineY} ${polylinePoints} ${lastPt.x.toFixed(
    1
  )},${baselineY}`;

  void badgeTextColor;
  void invertTrendColor;

  return (
    <div className="w-full pt-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-11 overflow-visible"
        role="img"
        aria-label={`KPI Sparkline ${metrics.formattedPeriodBadge}`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillColor} stopOpacity={darkSurface ? 0.28 : 0.18} />
            <stop offset="100%" stopColor={fillColor} stopOpacity={0.01} />
          </linearGradient>
        </defs>

        <polygon points={areaPoints} fill={`url(#${gradId})`} />

        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={polylinePoints}
        />

        <circle
          cx={lastPt.x}
          cy={lastPt.y}
          r={3.5}
          fill={dotColor}
          stroke={darkSurface ? '#08241F' : '#FFFFFF'}
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
};

export type SparklineMetricMode = 'NETO' | 'MASUK' | 'KELUAR' | 'COMBINED';

interface KpiSparklineCanvasProps {
  series: CashflowChartPoint[];
  defaultMode?: SparklineMetricMode;
  compact?: boolean;
  title?: string;
  subtitle?: string;
}

function formatAxisCompactRupiah(val: number): string {
  if (val >= 1_000_000) {
    const jt = val / 1_000_000;
    return `${jt % 1 === 0 ? jt.toFixed(0) : jt.toFixed(1)}jt`;
  }
  if (val >= 1_000) {
    return `${Math.round(val / 1_000)}rb`;
  }
  return String(Math.round(val));
}

export const KpiSparklineCanvas: React.FC<KpiSparklineCanvasProps> = ({
  series,
  defaultMode = 'NETO',
  compact = false,
  title = 'Pergerakan arus kas',
  subtitle,
}) => {
  const uid = useId();
  const [mode, setMode] = useState<SparklineMetricMode>(defaultMode);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const masukValues = series.map((s) => s.masuk);
  const keluarValues = series.map((s) => s.keluar);
  const netoValues = series.map((s) => s.neto);

  const masukMetrics = calculateSparklineMetrics(masukValues);
  const keluarMetrics = calculateSparklineMetrics(keluarValues);
  const netoMetrics = calculateSparklineMetrics(netoValues);

  const activeMetrics =
    mode === 'MASUK'
      ? masukMetrics
      : mode === 'KELUAR'
      ? keluarMetrics
      : netoMetrics;

  const activeValues =
    mode === 'MASUK'
      ? masukValues
      : mode === 'KELUAR'
      ? keluarValues
      : netoValues;

  const activeDeltas =
    mode === 'MASUK'
      ? series.map((s) => s.masukDeltaPct)
      : mode === 'KELUAR'
      ? series.map((s) => s.keluarDeltaPct)
      : series.map((s) => s.netoDeltaPct);

  const chartWidth = 880;
  const chartHeight = compact ? 185 : 225;
  const topPad = 28;
  const bottomPad = 30;
  const leftPad = 46;
  const rightPad = 28;
  const plotW = chartWidth - leftPad - rightPad;
  const plotH = chartHeight - topPad - bottomPad;
  const baselineY = topPad + plotH;

  const allRelevantValues =
    mode === 'COMBINED'
      ? [...masukValues, ...keluarValues, ...netoValues]
      : activeValues;

  const rawMax = Math.max(...allRelevantValues, 1_000_000);
  const domainMin = 0;
  const domainMax = rawMax * 1.12;
  const domainSpan = Math.max(1, domainMax - domainMin);

  const buildCoords = (vals: number[]) =>
    vals.map((val, idx) => {
      const x = leftPad + (idx / Math.max(1, vals.length - 1)) * plotW;
      const clamped = Math.max(domainMin, val);
      const ratio = (clamped - domainMin) / domainSpan;
      const y = topPad + plotH * 0.92 - ratio * (plotH * 0.84);
      return { x, y, val, idx };
    });

  const primaryCoords = buildCoords(activeValues);
  const masukCoords = buildCoords(masukValues);
  const keluarCoords = buildCoords(keluarValues);
  const netoCoords = buildCoords(netoValues);

  const toPolyline = (pts: { x: number; y: number }[]) =>
    pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const toAreaPolygon = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return '';
    const first = pts[0];
    const last = pts[pts.length - 1];
    return `${first.x.toFixed(1)},${baselineY} ${toPolyline(pts)} ${last.x.toFixed(
      1
    )},${baselineY}`;
  };

  const primaryStroke =
    mode === 'KELUAR' ? '#D99B26' : mode === 'MASUK' ? '#00897B' : '#0F766E';
  const primaryDot =
    mode === 'KELUAR' ? '#D99B26' : '#14B8A6';

  const lastPrimary = primaryCoords[primaryCoords.length - 1];
  const hoveredPoint = hoveredIdx !== null ? series[hoveredIdx] : null;
  const hoveredDelta = hoveredIdx !== null ? activeDeltas[hoveredIdx] : null;
  const hoveredVal = hoveredIdx !== null ? activeValues[hoveredIdx] : null;

  const yAxisTicks = [1, 0.66, 0.33, 0].map((r) => ({
    y: topPad + plotH * (1 - r * 0.92),
    label: r === 0 ? '0' : formatAxisCompactRupiah(rawMax * r),
  }));

  return (
    <div
      data-testid="kpi-sparkline-chart"
      className={
        compact
          ? 'space-y-2'
          : 'rounded-2xl bg-white dark:bg-[#0B211D] border border-[#E2ECE8] dark:border-[#183831] p-5 space-y-3'
      }
    >
      {/* Clean Executive Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {!compact && (
            <h3 className="text-sm font-bold text-[#0F2922] dark:text-white tracking-tight">
              {title}
            </h3>
          )}

          {/* Clean Percentage Trend Callout Badge */}
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold ${
              activeMetrics.periodChangePercent >= 0
                ? 'bg-[#E6F4F1] dark:bg-[#0F3830] text-[#00796B] dark:text-[#38E8D6]'
                : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
            }`}
          >
            {activeMetrics.periodChangePercent >= 0 ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            <span>{activeMetrics.formattedPeriodBadge}</span>
          </span>

          <span className="text-[11px] font-mono text-[#52736B] dark:text-[#86B5A9]">
            • {activeMetrics.formattedDailyBadge} hari ini
          </span>

          {subtitle && !compact && (
            <span className="hidden xl:inline text-xs text-[#52736B] dark:text-[#86B5A9]">
              • {subtitle}
            </span>
          )}
        </div>

        {/* Quiet Segmented Switcher */}
        <div className="inline-flex items-center bg-[#F3F8F6] dark:bg-[#071714] p-1 rounded-xl border border-[#DCE8E4] dark:border-[#163831]">
          {(
            [
              { key: 'NETO', label: 'Neto' },
              { key: 'MASUK', label: 'Masuk' },
              { key: 'KELUAR', label: 'Keluar' },
              { key: 'COMBINED', label: 'Semua' },
            ] as { key: SparklineMetricMode; label: string }[]
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setMode(item.key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                mode === item.key
                  ? 'bg-white dark:bg-[#0F3830] text-[#0F2922] dark:text-white shadow-2xs'
                  : 'text-[#52736B] dark:text-[#86B5A9] hover:text-[#0F2922] dark:hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Subtle Contextual Readout When Hovering a Point (or Legend at Rest) */}
      <div className="min-h-[22px] flex flex-wrap items-center justify-between gap-2 text-xs">
        {hoveredPoint && hoveredVal !== null && hoveredDelta !== null ? (
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
            <span className="font-bold text-[#0F2922] dark:text-white">
              Tanggal {hoveredPoint.dateKey}:
            </span>
            {mode === 'COMBINED' ? (
              <>
                <span className="text-[#00897B] dark:text-[#34D399]">
                  Masuk: <strong>{formatRupiah(hoveredPoint.masuk)}</strong> ·{' '}
                  {formatPercentBadge(hoveredPoint.masukDeltaPct)}
                </span>
                <span className="text-[#B7791F] dark:text-[#E5B85B]">
                  Keluar: <strong>{formatRupiah(hoveredPoint.keluar)}</strong> ·{' '}
                  {formatPercentBadge(hoveredPoint.keluarDeltaPct)}
                </span>
                <span className="text-[#0F2922] dark:text-white font-semibold">
                  Neto: <strong>{formatRupiah(hoveredPoint.neto)}</strong> ·{' '}
                  {formatPercentBadge(hoveredPoint.netoDeltaPct)}
                </span>
              </>
            ) : (
              <>
                <span className="font-bold text-[#00897B] dark:text-[#38E8D6]">
                  {formatRupiah(hoveredVal)}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded font-semibold ${
                    hoveredDelta >= 0
                      ? 'bg-[#E6F4F1] dark:bg-[#0F3830] text-[#00796B] dark:text-[#38E8D6]'
                      : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {formatPercentBadge(hoveredDelta)} vs hari sebelumnya
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-4 text-[11px] text-[#52736B] dark:text-[#86B5A9]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#00897B]" />
              <span>Masuk {masukMetrics.formattedPeriodBadge}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#D99B26]" />
              <span>Keluar {keluarMetrics.formattedPeriodBadge}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#0F766E] dark:bg-[#38E8D6]" />
              <span>Neto {netoMetrics.formattedPeriodBadge}</span>
            </span>
          </div>
        )}
      </div>

      {/* Main Clean KPI Sparkline SVG Area */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-auto min-w-[540px]"
          role="img"
          aria-label={`${title} — Pertumbuhan ${activeMetrics.formattedPeriodBadge}`}
        >
          <defs>
            <linearGradient id={`${uid}-primary-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primaryStroke} stopOpacity={0.22} />
              <stop offset="85%" stopColor={primaryStroke} stopOpacity={0.05} />
              <stop offset="100%" stopColor={primaryStroke} stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id={`${uid}-masuk-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00897B" stopOpacity={0.16} />
              <stop offset="100%" stopColor="#00897B" stopOpacity={0.0} />
            </linearGradient>
          </defs>

          {/* Y-Axis Scale & Subtle Horizontal Hairlines matching 02-cash-analytics_9209f1b2.png */}
          {yAxisTicks.map((tick, idx) => (
            <g key={idx}>
              <text
                x={leftPad - 10}
                y={tick.y + 3}
                textAnchor="end"
                className="text-[10px] font-mono fill-[#68877F] dark:fill-[#7BA69C]"
              >
                {tick.label}
              </text>
              <line
                x1={leftPad}
                y1={tick.y}
                x2={chartWidth - rightPad}
                y2={tick.y}
                stroke="currentColor"
                className="text-[#EBF2EF] dark:text-[#14352E]"
                strokeDasharray={idx === yAxisTicks.length - 1 ? undefined : '4 4'}
                strokeWidth={1}
              />
            </g>
          ))}

          {mode === 'COMBINED' ? (
            <>
              <polygon
                points={toAreaPolygon(masukCoords)}
                fill={`url(#${uid}-masuk-fill)`}
              />
              <polyline
                fill="none"
                stroke="#00897B"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={toPolyline(masukCoords)}
              />
              <polyline
                fill="none"
                stroke="#D99B26"
                strokeWidth={1.8}
                strokeDasharray="4 4"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={toPolyline(keluarCoords)}
              />
              <polyline
                fill="none"
                stroke="#0F3D35"
                className="dark:stroke-[#38E8D6]"
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={toPolyline(netoCoords)}
              />

              {netoCoords.length > 0 && (
                <g>
                  <circle
                    cx={netoCoords[netoCoords.length - 1].x}
                    cy={netoCoords[netoCoords.length - 1].y}
                    r={5}
                    fill="#14B8A6"
                    stroke="#FFFFFF"
                    strokeWidth={1.5}
                  />
                  <text
                    x={netoCoords[netoCoords.length - 1].x - 8}
                    y={Math.max(16, netoCoords[netoCoords.length - 1].y - 8)}
                    textAnchor="end"
                    className="fill-[#00796B] dark:fill-[#38E8D6] text-[12px] font-mono font-bold"
                  >
                    {netoMetrics.formattedPeriodBadge}
                  </text>
                </g>
              )}
            </>
          ) : (
            <>
              {/* Clean KPI Sparkline Shaded Area & Crisp Curve */}
              <polygon
                points={toAreaPolygon(primaryCoords)}
                fill={`url(#${uid}-primary-fill)`}
              />

              <polyline
                fill="none"
                stroke={primaryStroke}
                strokeWidth={2.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={toPolyline(primaryCoords)}
              />

              {/* Hover Hit Columns & Subtle Active Node */}
              {primaryCoords.map((pt, idx) => {
                const delta = activeDeltas[idx];
                const isLast = idx === primaryCoords.length - 1;
                const isHovered = hoveredIdx === idx;

                return (
                  <g
                    key={series[idx]?.dateKey || idx}
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    className="cursor-pointer"
                  >
                    <rect
                      x={pt.x - plotW / (series.length * 2)}
                      y={topPad}
                      width={plotW / series.length}
                      height={plotH}
                      fill="transparent"
                    />

                    {isHovered && (
                      <>
                        <line
                          x1={pt.x}
                          y1={topPad}
                          x2={pt.x}
                          y2={baselineY}
                          stroke={primaryStroke}
                          strokeDasharray="3 3"
                          strokeOpacity={0.45}
                        />
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={4.5}
                          fill={primaryDot}
                          stroke="#FFFFFF"
                          strokeWidth={1.5}
                        />
                        {idx > 0 && !isLast && (
                          <text
                            x={pt.x}
                            y={Math.max(14, pt.y - 9)}
                            textAnchor="middle"
                            className="text-[11px] font-mono font-bold fill-[#00796B] dark:fill-[#38E8D6]"
                          >
                            {formatPercentBadge(delta)}
                          </text>
                        )}
                      </>
                    )}
                  </g>
                );
              })}

              {/* Signature Endpoint Marker & Bold Percentage Callout matching erp_finance_chart_types_5_2_746aa7a7.png */}
              {lastPrimary && (
                <g>
                  <circle
                    cx={lastPrimary.x}
                    cy={lastPrimary.y}
                    r={8}
                    fill={primaryDot}
                    fillOpacity={0.2}
                  />
                  <circle
                    cx={lastPrimary.x}
                    cy={lastPrimary.y}
                    r={4.5}
                    fill={primaryDot}
                    stroke="#FFFFFF"
                    strokeWidth={1.5}
                  />
                  <text
                    x={lastPrimary.x - 8}
                    y={Math.max(18, lastPrimary.y - 10)}
                    textAnchor="end"
                    className="fill-[#00796B] dark:fill-[#3DD6A3] text-[14px] font-mono font-bold tracking-tight"
                  >
                    {activeMetrics.formattedPeriodBadge}
                  </text>
                </g>
              )}
            </>
          )}

          {/* X-Axis Date Labels */}
          {series.map((pt, idx) => {
            const x = leftPad + (idx / Math.max(1, series.length - 1)) * plotW;
            const isHovered = hoveredIdx === idx;
            return (
              <text
                key={pt.dateKey}
                x={x}
                y={baselineY + 19}
                textAnchor="middle"
                className={`text-[10px] font-mono ${
                  isHovered
                    ? 'fill-[#00796B] dark:fill-[#38E8D6] font-bold'
                    : 'fill-[#68877F] dark:fill-[#7BA69C]'
                }`}
              >
                {pt.label}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
