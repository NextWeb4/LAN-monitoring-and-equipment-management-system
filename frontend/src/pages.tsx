import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileUp,
  Filter,
  Radar,
  Search,
} from "lucide-react";
import { DeviceTable, EmptyState, nameOf, number, timeOf } from "./components";
import { BulkDeviceControls, CsvImportDialog } from "./inventory-tools";
import type { AppState, Device, Incident } from "./types";
import type { Mutate, Notify } from "./forms";

export function DevicesPage({
  state,
  onSelect,
  onScan,
  onAdd,
  mutate,
  notify,
}: {
  state: AppState;
  onSelect: (d: Device) => void;
  onScan: () => void;
  onAdd: () => void;
  mutate: Mutate;
  notify: Notify;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [importOpen, setImportOpen] = useState(false);
  const filtered = state.devices.filter(
    (d) =>
      (filter === "all" ||
        (filter === "paused"
          ? !d.monitoringEnabled || !state.settings.monitoringEnabled
          : d.status === filter &&
            d.monitoringEnabled &&
            state.settings.monitoringEnabled)) &&
      `${d.ip} ${d.mac || ""} ${d.hostname || ""} ${d.alias} ${d.group} ${d.owner || ""} ${d.location || ""} ${(d.tags || []).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  useEffect(() => setPage(0), [query, filter]);
  useEffect(
    () =>
      setSelectedIds(
        (current) =>
          new Set(
            [...current].filter((id) =>
              state.devices.some((device) => device.id === id),
            ),
          ),
      ),
    [state.devices],
  );
  const pageSize = 25,
    pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)),
    currentPage = Math.min(page, pageCount - 1),
    shown = filtered.slice(
      currentPage * pageSize,
      currentPage * pageSize + pageSize,
    );
  const toggle = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = (ids: string[]) =>
    setSelectedIds((current) => {
      const next = new Set(current),
        selecting = !ids.every((id) => next.has(id));
      ids.forEach((id) => (selecting ? next.add(id) : next.delete(id)));
      return next;
    });
  return (
    <>
      <section className="panel inventory-panel">
        <div className="inventory-toolbar">
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="搜索设备"
              placeholder="搜索设备名称、IP、MAC、标签…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="toolbar-actions">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="button ghost compact"
            >
              <FileUp size={16} />
              导入 CSV
            </button>
            <a
              href="/api/devices/export.csv"
              download
              className="button ghost compact"
            >
              <ArrowDownToLine size={16} />
              导出 CSV
            </a>
            <button onClick={onAdd} className="button secondary compact">
              手动添加
            </button>
          </div>
        </div>
        <div className="filter-bar">
          <div className="filter-tabs" role="tablist" aria-label="设备筛选">
            {[
              ["all", "全部设备"],
              ["online", "在线"],
              ["offline", "离线"],
              ["unknown", "待确认"],
              ["paused", "已暂停"],
            ].map(([key, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={filter === key}
                key={key}
                className={filter === key ? "active" : ""}
                onClick={() => setFilter(key)}
              >
                {label}
                {key === "all" && <span>{state.devices.length}</span>}
              </button>
            ))}
          </div>
          <span className="subdued">
            {filtered.length} 台设备
            {selectedIds.size > 0 ? ` · 已选 ${selectedIds.size} 台` : ""}
          </span>
        </div>
        {selectedIds.size > 0 && (
          <BulkDeviceControls
            devices={state.devices}
            selectedIds={[...selectedIds]}
            mutate={mutate}
            notify={notify}
            onClear={() => setSelectedIds(new Set())}
          />
        )}
        {state.devices.length ? (
          <DeviceTable
            devices={shown}
            paused={!state.settings.monitoringEnabled}
            onSelect={onSelect}
            search={query || (filter !== "all" ? filter : "")}
            selection={{ ids: selectedIds, toggle, toggleAll }}
          />
        ) : (
          <EmptyState
            title="从第一台设备开始"
            text="选择网络适配器与网段，LANtern 会为你建立设备清单。"
          >
            <button className="button primary" onClick={onScan}>
              <Radar size={17} />
              发现设备
            </button>
            <button className="button ghost" onClick={onAdd}>
              手动添加 <ArrowRight size={15} />
            </button>
          </EmptyState>
        )}
        <div className="table-footer">
          <span>
            <span className="legend-dot gray" />
            IP 与 MAC 信息来自设备探测，未知信息显示为“—”。
          </span>
          <span className="table-pagination">
            {filtered.length > pageSize && (
              <>
                <button
                  className="icon-button"
                  aria-label="上一页设备"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {currentPage + 1} / {pageCount}
                </span>
                <button
                  className="icon-button"
                  aria-label="下一页设备"
                  disabled={currentPage >= pageCount - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </>
            )}
          </span>
        </div>
      </section>
      {importOpen && (
        <CsvImportDialog
          mutate={mutate}
          notify={notify}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  );
}

export function IncidentRows({
  incidents,
  mutate,
  notify,
  onSelect,
  devices,
  compact = false,
}: {
  incidents: Incident[];
  mutate: Mutate;
  notify: Notify;
  onSelect: (d: Device) => void;
  devices: Device[];
  compact?: boolean;
}) {
  const [pending, setPending] = useState<string[]>([]);
  const ack = async (incident: Incident) => {
    setPending((p) => [...p, incident.id]);
    try {
      await mutate(`/api/incidents/${incident.id}/ack`, "POST");
      notify("告警已确认。");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setPending((p) => p.filter((id) => id !== incident.id));
    }
  };
  return (
    <div className={`incident-list ${compact ? "compact" : ""}`}>
      {incidents.map((i) => (
        <div
          key={i.id}
          className={`incident-row ${i.status === "resolved" ? "resolved" : i.severity}`}
        >
          <div className="incident-icon">
            {i.status === "resolved" ? (
              <CheckCheck size={18} />
            ) : (
              <CircleAlert size={18} />
            )}
          </div>
          <div className="incident-copy">
            <div className="incident-heading">
              <strong>{i.message || "网络状态变化"}</strong>
              <span
                className={`incident-status ${i.status === "resolved" ? "resolved" : ""}`}
              >
                {i.status === "resolved" ? "已恢复" : "处理中"}
              </span>
            </div>
            <p>
              {i.deviceId && devices.some((d) => d.id === i.deviceId) ? (
                <button
                  className="text-link"
                  onClick={() => {
                    const d = devices.find((d) => d.id === i.deviceId);
                    if (d) onSelect(d);
                  }}
                >
                  {i.deviceName}
                </button>
              ) : (
                <span>{i.deviceName || "网络监测"}</span>
              )}
              <span className="dot-separator">·</span>
              <span>{timeOf(i.openedAt, true)}</span>
              {i.resolvedAt && !compact && (
                <>
                  <span className="dot-separator">·</span>
                  <span>恢复于 {timeOf(i.resolvedAt, true)}</span>
                </>
              )}
            </p>
          </div>
          <div className="incident-action">
            {i.acknowledged ? (
              <span className="acknowledged">
                <Check size={14} />
                已确认
              </span>
            ) : (
              <button
                className="button secondary compact"
                disabled={pending.includes(i.id)}
                onClick={() => void ack(i)}
              >
                确认
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
export function IncidentsPage({
  state,
  mutate,
  notify,
  onSelect,
}: {
  state: AppState;
  mutate: Mutate;
  notify: Notify;
  onSelect: (d: Device) => void;
}) {
  const [filter, setFilter] = useState("active");
  const [page, setPage] = useState(0);
  const active = state.incidents.filter((i) => i.status !== "resolved");
  const unresolved = active.filter((i) => !i.acknowledged);
  const incidents = [...state.incidents]
    .filter(
      (i) =>
        filter === "all" ||
        (filter === "unread"
          ? !i.acknowledged
          : filter === "active"
            ? i.status !== "resolved"
            : i.status === "resolved"),
    )
    .sort((a, b) => +new Date(b.openedAt) - +new Date(a.openedAt));
  useEffect(() => setPage(0), [filter]);
  const pageSize = 50,
    pageCount = Math.max(1, Math.ceil(incidents.length / pageSize)),
    currentPage = Math.min(page, pageCount - 1),
    shown = incidents.slice(
      currentPage * pageSize,
      currentPage * pageSize + pageSize,
    );
  return (
    <>
      <div className="incident-summary">
        <div>
          <span className="incident-summary-icon">
            <Bell size={24} />
          </span>
          <p>
            当前活动告警
            <strong>
              {active.length}
              <small>项</small>
            </strong>
          </p>
        </div>
        <div>
          <span className="incident-summary-icon amber">
            <CircleAlert size={24} />
          </span>
          <p>
            等待确认
            <strong>
              {unresolved.length}
              <small>项</small>
            </strong>
          </p>
        </div>
        <div className="incident-summary-description">
          <ShieldHint />
          <p>
            告警会记录异常发生与恢复的完整过程。
            <br />
            确认表示你已知晓，恢复状态由后续监测决定。
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="filter-bar large">
          <div className="filter-tabs" role="tablist" aria-label="提醒筛选">
            {[
              ["active", "活动告警"],
              ["unread", "未确认"],
              ["resolved", "已恢复"],
              ["all", "全部记录"],
            ].map(([key, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={filter === key}
                key={key}
                className={filter === key ? "active" : ""}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="subdued">{incidents.length} 项记录</span>
        </div>
        {incidents.length ? (
          <IncidentRows
            incidents={shown}
            mutate={mutate}
            notify={notify}
            onSelect={onSelect}
            devices={state.devices}
          />
        ) : (
          <EmptyState
            title={filter === "active" ? "当前没有活动告警" : "这里还没有记录"}
            text={
              filter === "active"
                ? "设备异常、延迟升高或端口状态变化时，将在这里提醒你。"
                : "符合当前筛选条件的告警将在这里显示。"
            }
            icon="check"
          />
        )}
        <div className="table-footer">
          <span>每页最多 50 项</span>
          {incidents.length > pageSize && (
            <span className="table-pagination">
              <button
                className="icon-button"
                aria-label="上一页提醒"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {currentPage + 1} / {pageCount}
              </span>
              <button
                className="icon-button"
                aria-label="下一页提醒"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </span>
          )}
        </div>
      </section>
    </>
  );
}
function ShieldHint() {
  return <CheckCheck size={22} />;
}

export function TopologyPage({
  state,
  onSelect,
  onScan,
}: {
  state: AppState;
  onSelect: (d: Device) => void;
  onScan: () => void;
}) {
  const [group, setGroup] = useState("all");
  const [page, setPage] = useState(0);
  const groups = [...new Set(state.devices.map((d) => d.group || "未分组"))];
  useEffect(() => {
    if (group !== "all" && !groups.includes(group)) setGroup("all");
  }, [group, groups.join("|")]);
  const filtered = state.devices.filter(
    (d) => group === "all" || d.group === group,
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount - 1);
  const devices = filtered.slice(currentPage * 10, currentPage * 10 + 10);
  const positions = devices.map((d, i) => {
    const angle = -Math.PI / 2 + (i / devices.length) * Math.PI * 2;
    return {
      d,
      x: 510 + Math.cos(angle) * 352,
      y: 345 + Math.sin(angle) * 241,
    };
  });
  const online = filtered.filter(
    (d) =>
      d.status === "online" &&
      d.monitoringEnabled &&
      state.settings.monitoringEnabled,
  ).length;
  return (
    <section className="panel topology-panel">
      <div className="topology-toolbar">
        <div>
          <h2>
            网络逻辑拓扑 <span className="beta-tag">逻辑视图</span>
          </h2>
          <p>设备按监测范围关联，连线不代表物理布线或交换机端口。</p>
        </div>
        <label className="topology-filter">
          <Filter size={15} />
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setPage(0);
            }}
            aria-label="按设备分组筛选"
          >
            <option value="all">全部分组</option>
            {groups.map((g) => (
              <option value={g} key={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
      </div>
      {devices.length ? (
        <>
          <div className="topology-canvas">
            <div className="topology-key">
              <span>
                <i className="key-dot online" />
                在线
              </span>
              <span>
                <i className="key-dot offline" />
                离线
              </span>
              <span>
                <i className="key-dot unknown" />
                待确认 / 暂停
              </span>
            </div>
            <svg
              viewBox="0 0 1020 690"
              role="img"
              aria-label={`逻辑拓扑，展示 ${devices.length} 台设备。连接表示统一监测范围。`}
            >
              <defs>
                <pattern
                  id="topology-dots"
                  width="20"
                  height="20"
                  patternUnits="userSpaceOnUse"
                >
                  <circle cx="1" cy="1" r=".8" fill="#c9d2c7" opacity=".5" />
                </pattern>
              </defs>
              <rect width="1020" height="690" fill="url(#topology-dots)" />
              <circle
                cx="510"
                cy="345"
                r="220"
                fill="none"
                stroke="#e1e8de"
                strokeDasharray="3 8"
              />
              <circle cx="510" cy="345" r="290" fill="none" stroke="#e8ece5" />
              {positions.map(({ d, x, y }) => (
                <line
                  key={`line-${d.id}`}
                  x1="510"
                  y1="345"
                  x2={x}
                  y2={y}
                  stroke={
                    d.status === "online" &&
                    d.monitoringEnabled &&
                    state.settings.monitoringEnabled
                      ? "#99b4a3"
                      : "#c8ceca"
                  }
                  strokeWidth="1.4"
                  strokeDasharray={d.status === "online" ? undefined : "5 6"}
                />
              ))}
              <g>
                <circle cx="510" cy="345" r="64" fill="#e6eee3" />
                <circle cx="510" cy="345" r="51" fill="#214b3d" />
                <path
                  d="M490 335h40m-20-10v20m-17 10v-10h34v10"
                  fill="none"
                  stroke="#d5e5ca"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <rect
                  x="488"
                  y="329"
                  width="10"
                  height="10"
                  rx="2"
                  fill="#d5e5ca"
                />
                <rect
                  x="522"
                  y="329"
                  width="10"
                  height="10"
                  rx="2"
                  fill="#d5e5ca"
                />
                <rect
                  x="505"
                  y="318"
                  width="10"
                  height="10"
                  rx="2"
                  fill="#d5e5ca"
                />
                <rect
                  x="488"
                  y="352"
                  width="10"
                  height="9"
                  rx="2"
                  fill="#d5e5ca"
                />
                <rect
                  x="522"
                  y="352"
                  width="10"
                  height="9"
                  rx="2"
                  fill="#d5e5ca"
                />
                <text
                  x="510"
                  y="427"
                  textAnchor="middle"
                  className="topology-root-name"
                >
                  {group === "all" ? state.settings.siteName : group}
                </text>
                <text
                  x="510"
                  y="447"
                  textAnchor="middle"
                  className="topology-root-note"
                >
                  统一监测 · {filtered.length} 台设备
                </text>
              </g>
              {positions.map(({ d, x, y }) => {
                const status =
                  d.monitoringEnabled && state.settings.monitoringEnabled
                    ? d.status
                    : "unknown";
                const label = nameOf(d);
                return (
                  <g
                    role="button"
                    tabIndex={0}
                    key={d.id}
                    className="topology-node"
                    aria-label={`${label}，${d.ip}，查看详情`}
                    onClick={() => onSelect(d)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(d);
                      }
                    }}
                    transform={`translate(${x - 87},${y - 37})`}
                  >
                    <title>
                      {label} · {d.ip}
                    </title>
                    <rect
                      width="174"
                      height="74"
                      rx="9"
                      fill="#fffffb"
                      stroke={status === "online" ? "#b4c8b8" : "#d8dfd5"}
                    />
                    <circle
                      cx="19"
                      cy="23"
                      r="4"
                      fill={
                        status === "online"
                          ? "#49826a"
                          : status === "offline"
                            ? "#bb6b54"
                            : "#a6ada2"
                      }
                    />
                    <text x="31" y="27" className="topology-device-name">
                      {label.length > 13 ? `${label.slice(0, 12)}…` : label}
                    </text>
                    <text x="18" y="51" className="topology-device-ip">
                      {d.ip}
                    </text>
                    <text
                      x="156"
                      y="51"
                      textAnchor="end"
                      className="topology-device-rtt"
                    >
                      {d.lastProbe?.latencyMs != null
                        ? `${number(d.lastProbe.latencyMs)}ms`
                        : "—"}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="topology-footer">
            <span>
              <b>{filtered.length}</b> 台设备 · <b>{online}</b> 台在线
            </span>
            <div>
              <button
                className="icon-button"
                aria-label="上一页设备"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                {currentPage + 1} / {pageCount}
              </span>
              <button
                className="icon-button"
                aria-label="下一页设备"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <span>点击节点查看设备详情</span>
          </div>
        </>
      ) : (
        <EmptyState
          title="你的网络，即将在这里展开"
          text="发现设备后，即可查看它们的在线状态与监测关系。"
        >
          <button className="button primary" onClick={onScan}>
            <Radar size={17} />
            发现设备
          </button>
        </EmptyState>
      )}
    </section>
  );
}
