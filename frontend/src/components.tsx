import { useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  Activity,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  HardDrive,
  Laptop,
  Monitor,
  Network,
  Printer,
  Router,
  Server,
  Smartphone,
  Wifi,
  X,
} from "lucide-react";
import type { Device, HistorySample } from "./types";

export const deviceTypes: Record<string, string> = {
  device: "通用设备",
  computer: "电脑",
  server: "服务器",
  router: "路由器",
  switch: "交换机",
  ap: "无线接入点",
  printer: "打印机",
  phone: "移动设备",
  camera: "摄像头",
  nas: "网络存储",
  other: "其他设备",
};
export const nameOf = (d: Device) => d.alias || d.hostname || d.ip;
export const number = (value: number | null | undefined, decimals = 1) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: decimals });
export const timeOf = (date: string | null | undefined, full = false) =>
  !date
    ? "尚无记录"
    : new Date(date).toLocaleString(
        "zh-CN",
        full
          ? {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            }
          : {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            },
      );
export function parsePorts(value: string) {
  if (!value.trim()) return [];
  const pieces = value.split(/[,，\s]+/).filter(Boolean);
  if (pieces.some((p) => !/^\d+$/.test(p) || +p < 1 || +p > 65535))
    throw new Error("端口应为 1–65535 的整数，多个端口用逗号分隔。");
  const values = [...new Set(pieces.map(Number))];
  if (values.length > 16) throw new Error("每台设备最多监测 16 个端口。");
  return values;
}
export function parseTags(value: string) {
  const tags = value
    .split(/[,，;；\n]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (tags.some((tag) => tag.length > 24))
    throw new Error("单个标签最长 24 个字符。");
  const unique = [
    ...new Map(
      tags.map((tag) => [tag.toLocaleLowerCase("zh-CN"), tag]),
    ).values(),
  ];
  if (unique.length > 12) throw new Error("每台设备最多使用 12 个标签。");
  return unique;
}
export function DeviceIcon({
  type,
  size = 19,
}: {
  type: string;
  size?: number;
}) {
  const Icon =
    (
      {
        computer: Laptop,
        server: Server,
        router: Router,
        switch: Network,
        ap: Wifi,
        printer: Printer,
        phone: Smartphone,
        camera: Camera,
        nas: HardDrive,
      } as Record<string, typeof Monitor>
    )[type] || Monitor;
  return <Icon size={size} strokeWidth={1.7} />;
}
export function Status({
  device,
  paused = false,
}: {
  device: Device;
  paused?: boolean;
}) {
  const status = paused || !device.monitoringEnabled ? "paused" : device.status;
  return (
    <span className={`status status-${status}`}>
      <i />
      {
        {
          online: "在线",
          offline: "离线",
          unknown: "待确认",
          paused: "已暂停",
        }[status]
      }
    </span>
  );
}
export function EmptyState({
  title,
  text,
  children,
  icon = "network",
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
  icon?: "network" | "check" | "clock" | "search";
}) {
  return (
    <div className="empty-state">
      <div className="empty-symbol">
        {icon === "check" ? (
          <Check />
        ) : icon === "clock" ? (
          <Clock3 />
        ) : icon === "search" ? (
          <CircleHelp />
        ) : (
          <Network />
        )}
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children && <div className="empty-action">{children}</div>}
    </div>
  );
}
const focusableSelector =
  'a[href], area[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"], audio[controls], video[controls], summary';
const dialogLayers: HTMLElement[] = [];
const isolatedElements = new Map<
  HTMLElement,
  { inert: boolean; hidden: string | null }
>();
let bodyOverflow = "";

function canFocus(element: HTMLElement) {
  return (
    element.isConnected &&
    !element.matches(":disabled") &&
    !element.closest("[inert]") &&
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden"
  );
}
function dialogControls(element: HTMLElement) {
  return Array.from(
    element.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter((item) => item.tabIndex >= 0 && canFocus(item));
}
function focusInDialog(element: HTMLElement, last = false) {
  const controls = dialogControls(element);
  (controls[last ? controls.length - 1 : 0] || element).focus({
    preventScroll: true,
  });
}
function updateDialogEnvironment(restoreFocus?: HTMLElement | null) {
  // Restore before recomputing so a newer dialog can occupy a previously inert sibling.
  isolatedElements.forEach((original, element) => {
    element.inert = original.inert;
    if (original.hidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", original.hidden);
  });
  isolatedElements.clear();
  const active = dialogLayers[dialogLayers.length - 1];
  if (
    restoreFocus &&
    canFocus(restoreFocus) &&
    (!active || active.contains(restoreFocus))
  )
    restoreFocus.focus({ preventScroll: true });
  if (active && !active.contains(document.activeElement)) focusInDialog(active);
  if (!active) return;

  // Isolate siblings along the dialog's ancestor path, without hiding its backdrop.
  let branch: HTMLElement = active;
  while (branch.parentElement) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      isolatedElements.set(sibling, {
        inert: sibling.inert,
        hidden: sibling.getAttribute("aria-hidden"),
      });
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }
    if (branch.parentElement === document.body) break;
    branch = branch.parentElement;
  }
}

export function useDialogFocus(
  ref: RefObject<HTMLElement>,
  onClose: () => void,
) {
  const close = useRef(onClose);
  // Capture before React commits autofocus inside the dialog.
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const originalTabIndex = dialog.getAttribute("tabindex");
    if (originalTabIndex === null) dialog.tabIndex = -1;
    if (!dialogLayers.length) bodyOverflow = document.body.style.overflow;
    dialogLayers.push(dialog);
    document.body.style.overflow = "hidden";
    updateDialogEnvironment();
    const isTopLayer = () => dialogLayers[dialogLayers.length - 1] === dialog;
    const onKey = (event: KeyboardEvent) => {
      if (!isTopLayer() || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = dialogControls(dialog);
      const current = document.activeElement;
      if (
        !items.length ||
        !items.includes(current as HTMLElement) ||
        (event.shiftKey
          ? current === items[0]
          : current === items[items.length - 1])
      ) {
        event.preventDefault();
        focusInDialog(dialog, event.shiftKey);
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (isTopLayer() && !dialog.contains(event.target as Node))
        focusInDialog(dialog);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus, true);
      const wasTop = isTopLayer();
      const index = dialogLayers.indexOf(dialog);
      if (index >= 0) dialogLayers.splice(index, 1);
      updateDialogEnvironment(wasTop ? returnFocus.current : null);
      if (!dialogLayers.length) {
        document.body.style.overflow = bodyOverflow;
        if (wasTop && (!returnFocus.current || !canFocus(returnFocus.current)))
          dialogControls(document.body)[0]?.focus({ preventScroll: true });
      }
      if (originalTabIndex === null) dialog.removeAttribute("tabindex");
    };
  }, [ref]);
}
export function Modal({
  title,
  eyebrow,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, onClose);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`modal ${wide ? "wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "on" : ""}`}
      type="button"
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export interface ChartPoint {
  at: number;
  value: number | null;
}
export function historyPoints(
  samples: HistorySample[],
  metric: "latencyMs" | "lossPercent",
  aggregate = false,
): ChartPoint[] {
  if (!aggregate)
    return samples
      .map((s) => ({
        at: +new Date(s.probe.timestamp),
        value: s.probe.isComplete ? s.probe[metric] : null,
      }))
      .sort((a, b) => a.at - b.at);
  const buckets = new Map<
    number,
    { sent: number; received: number; rttSumMs: number }
  >();
  samples.forEach((s) => {
    const key = Math.floor(+new Date(s.probe.timestamp) / 60000) * 60000;
    if (!buckets.has(key))
      buckets.set(key, { sent: 0, received: 0, rttSumMs: 0 });
    if (s.probe.isComplete && s.probe.sent > 0) {
      const bucket = buckets.get(key)!;
      bucket.sent += s.probe.sent;
      bucket.received += s.probe.received;
      bucket.rttSumMs += s.probe.rttSumMs;
    }
  });
  return [...buckets]
    .sort(([a], [b]) => a - b)
    .map(([at, totals]) => ({
      at,
      value:
        metric === "lossPercent"
          ? totals.sent
            ? (100 * (totals.sent - totals.received)) / totals.sent
            : null
          : totals.received
            ? totals.rttSumMs / totals.received
            : null,
    }));
}
export function TrendChart({
  points,
  metric = "latency",
  compact = false,
}: {
  points: ChartPoint[];
  metric?: "latency" | "loss";
  compact?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const chartId = useId().replace(/:/g, "");
  const good = points.filter((p) => p.value != null);
  if (!good.length)
    return (
      <div className={`chart-empty ${compact ? "compact" : ""}`}>
        <Activity size={29} strokeWidth={1.2} />
        <span>等待有效采样</span>
        <small>监测开始后，趋势将在这里逐步呈现</small>
      </div>
    );
  const width = 900,
    height = compact ? 200 : 230,
    left = 44,
    right = 20,
    top = 24,
    bottom = 32;
  const max =
    metric === "loss"
      ? 100
      : Math.max(
          5,
          Math.ceil((Math.max(...good.map((p) => p.value!)) * 1.25) / 5) * 5,
        );
  const minTime = points[0].at,
    maxTime = Math.max(minTime + 1000, points[points.length - 1].at);
  const x = (at: number) =>
    left + ((at - minTime) / (maxTime - minTime)) * (width - left - right);
  const y = (val: number) =>
    height - bottom - (val / max) * (height - top - bottom);
  const deltas = points
    .slice(1)
    .map((p, i) => p.at - points[i].at)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const typicalGap = deltas[Math.floor(deltas.length / 2)] || 60000;
  const segments: ChartPoint[][] = [];
  let segment: ChartPoint[] = [];
  points.forEach((p, i) => {
    if (
      p.value == null ||
      (i > 0 && p.at - points[i - 1].at > typicalGap * 2.5)
    ) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (p.value != null) segment.push(p);
  });
  if (segment.length) segments.push(segment);
  const selected = hover == null ? null : points[hover];
  const selectNearest = (clientX: number, rect: DOMRect) => {
    const position = ((clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    points.forEach((p, i) => {
      if (
        Math.abs(x(p.at) - position) <
        Math.abs(x(points[nearest].at) - position)
      )
        nearest = i;
    });
    setHover(nearest);
  };
  return (
    <div className="trend-chart">
      <svg
        tabIndex={0}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={
          metric === "loss"
            ? "丢包率历史曲线，空缺表示无有效数据"
            : "延迟历史曲线，空缺表示无有效数据"
        }
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          setHover((current) =>
            Math.max(
              0,
              Math.min(
                points.length - 1,
                (current ?? 0) + (e.key === "ArrowRight" ? 1 : -1),
              ),
            ),
          );
        }}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) =>
          selectNearest(e.clientX, e.currentTarget.getBoundingClientRect())
        }
      >
        <defs>
          <linearGradient id={chartId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f806a" stopOpacity=".18" />
            <stop offset="100%" stopColor="#4f806a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1={left}
              x2={width - right}
              y1={y((max * i) / 4)}
              y2={y((max * i) / 4)}
              stroke="#e6e8e1"
              strokeDasharray={i ? "3 5" : undefined}
            />
            <text
              x={left - 11}
              y={y((max * i) / 4) + 4}
              textAnchor="end"
              className="axis-text"
            >
              {number((max * i) / 4, 0)}
            </text>
          </g>
        ))}
        {segments.map((s, i) => (
          <g key={i}>
            <path
              d={`M ${x(s[0].at)} ${height - bottom} L ${s.map((p) => `${x(p.at)} ${y(p.value!)}`).join(" L ")} L ${x(s[s.length - 1].at)} ${height - bottom} Z`}
              fill={`url(#${chartId})`}
            />
            <path
              d={`M ${s.map((p) => `${x(p.at)} ${y(p.value!)}`).join(" L ")}`}
              fill="none"
              stroke="#39745b"
              strokeWidth="2.4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.length === 1 && (
              <circle
                cx={x(s[0].at)}
                cy={y(s[0].value!)}
                r="3.5"
                fill="#39745b"
              />
            )}
          </g>
        ))}
        <text x={left} y={height - 7} className="axis-text">
          {timeOf(new Date(minTime).toISOString())}
        </text>
        <text
          x={width - right}
          y={height - 7}
          textAnchor="end"
          className="axis-text"
        >
          {timeOf(new Date(points[points.length - 1].at).toISOString())}
        </text>
        {selected && (
          <g>
            <line
              x1={x(selected.at)}
              x2={x(selected.at)}
              y1={top}
              y2={height - bottom}
              stroke="#779585"
              strokeDasharray="3 3"
            />
            {selected.value != null && (
              <circle
                cx={x(selected.at)}
                cy={y(selected.value)}
                r="4"
                fill="#285840"
                stroke="white"
                strokeWidth="2"
              />
            )}
          </g>
        )}
      </svg>
      <div className="chart-caption">
        <span className="legend-dot" />
        {metric === "loss" ? "丢包率 %" : "响应延迟 ms"}
        <span className="chart-hover">
          {selected
            ? `${timeOf(new Date(selected.at).toISOString())} · ${number(selected.value)} ${selected.value == null ? "" : metric === "loss" ? "%" : "ms"}`
            : `${points.length} 个时间点 · 缺失数据保留断点`}
        </span>
      </div>
    </div>
  );
}

export function DeviceTable({
  devices,
  paused,
  onSelect,
  search = "",
  limit,
  selection,
}: {
  devices: Device[];
  paused: boolean;
  onSelect: (device: Device) => void;
  search?: string;
  limit?: number;
  selection?: {
    ids: Set<string>;
    toggle: (id: string) => void;
    toggleAll: (ids: string[]) => void;
  };
}) {
  const shown = limit ? devices.slice(0, limit) : devices;
  const allSelected =
    shown.length > 0 && shown.every((device) => selection?.ids.has(device.id));
  return (
    <div className="table-scroll">
      <table className={`device-table ${selection ? "selectable" : ""}`}>
        <thead>
          <tr>
            {selection && (
              <th className="selection-cell">
                <input
                  type="checkbox"
                  aria-label="选择当前页全部设备"
                  checked={allSelected}
                  onChange={() =>
                    selection.toggleAll(shown.map((device) => device.id))
                  }
                />
              </th>
            )}
            <th>设备</th>
            <th>IP / MAC 地址</th>
            <th>状态</th>
            <th className="align-right">延迟</th>
            <th className="align-right">丢包率</th>
            <th>分组</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((d) => (
            <tr
              key={d.id}
              className={selection?.ids.has(d.id) ? "selected" : ""}
              onClick={() => onSelect(d)}
            >
              {selection && (
                <td className="selection-cell">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${nameOf(d)}`}
                    checked={selection.ids.has(d.id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => selection.toggle(d.id)}
                  />
                </td>
              )}
              <td>
                <button
                  className="device-cell"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(d);
                  }}
                >
                  <span
                    className={`device-icon ${d.status === "offline" ? "muted" : ""}`}
                  >
                    <DeviceIcon type={d.type} />
                  </span>
                  <span>
                    <strong>{nameOf(d)}</strong>
                    <small>{deviceTypes[d.type] || d.type}</small>
                    {d.tags?.length > 0 && (
                      <span className="table-tags">
                        {d.tags.slice(0, 2).map((tag) => (
                          <i key={tag}>{tag}</i>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              </td>
              <td>
                <span className="mono address">{d.ip}</span>
                <small className="mono subdued">
                  {d.mac || "MAC 暂未获取"}
                </small>
              </td>
              <td>
                <Status device={d} paused={paused} />
              </td>
              <td className="align-right">
                <span className="tabular">
                  {number(d.lastProbe?.latencyMs)}
                </span>
                <small className="inline-unit">ms</small>
              </td>
              <td className="align-right">
                <span
                  className={`tabular ${(d.lastProbe?.lossPercent || 0) > 0 ? "text-amber" : ""}`}
                >
                  {number(d.lastProbe?.lossPercent)}
                </span>
                <small className="inline-unit">%</small>
              </td>
              <td>
                <span className="group-tag">{d.group || "未分组"}</span>
              </td>
              <td>
                <ChevronRight size={16} className="subdued" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && (
        <EmptyState
          title={search ? "没有找到匹配的设备" : "暂无设备"}
          text={
            search
              ? "试试设备名称、IP 地址、MAC 地址、分组或标签。"
              : "选择当前办公室的网段，开始发现设备。"
          }
          icon="search"
        />
      )}
    </div>
  );
}
