import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  Check,
  CircleAlert,
  Copy,
  LoaderCircle,
  Network,
  Plus,
  Radar,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  DeviceIcon,
  deviceTypes,
  historyPoints,
  Modal,
  nameOf,
  number,
  parsePorts,
  parseTags,
  Status,
  timeOf,
  Toggle,
  TrendChart,
  useDialogFocus,
} from "./components";
import type {
  AppState,
  Device,
  DeviceDraft,
  HistorySample,
  Settings,
} from "./types";

export type Mutate = (
  path: string,
  method: string,
  body?: unknown,
) => Promise<unknown>;
export type Notify = (
  message: string,
  kind?: "success" | "error" | "info",
) => void;

// Keep untouched fields live while polling, and retain only the user's edits.
function useFormDraft<T extends object>(source: T) {
  const [edits, setEdits] = useState<Partial<T>>({});
  useEffect(() => {
    setEdits((current) => {
      const keys = (Object.keys(current) as (keyof T)[]).filter((key) =>
        Object.is(current[key], source[key]),
      );
      if (!keys.length) return current;
      const next = { ...current };
      keys.forEach((key) => {
        delete next[key];
      });
      return next;
    });
  }, [source]);
  const set = <K extends keyof T>(key: K, value: T[K]) =>
    setEdits((current) => {
      const next = { ...current, [key]: value };
      if (Object.is(value, source[key])) delete next[key];
      return next;
    });
  const accept = (submitted: Partial<T>) =>
    setEdits((current) => {
      const next = { ...current };
      (Object.keys(submitted) as (keyof T)[]).forEach((key) => {
        if (Object.is(current[key], submitted[key])) delete next[key];
      });
      return next;
    });
  return {
    draft: { ...source, ...edits },
    edits,
    set,
    accept,
    reset: () => setEdits({}),
    dirty: Object.keys(edits).length > 0,
  };
}

function discoverySubnet(ip: string, subnet: string) {
  const prefix = Number(subnet.split("/")[1]);
  return prefix > 0 && prefix < 22
    ? `${ip.split(".").slice(0, 3).join(".")}.0/24`
    : subnet;
}

export function ScanDialog({
  state,
  mutate,
  notify,
  onClose,
}: {
  state: AppState;
  mutate: Mutate;
  notify: Notify;
  onClose: () => void;
}) {
  const [subnet, setSubnet] = useState(state.settings.subnet);
  const [subnetNotice, setSubnetNotice] = useState("");
  const [scanError, setScanError] = useState("");
  const [busy, setBusy] = useState(false);
  const scan = state.scan,
    running = scan.status === "running";
  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setScanError("");
    try {
      await mutate("/api/scan", "POST", { subnet: subnet.trim() });
      notify("发现任务已开始，可关闭窗口继续查看设备。");
    } catch (error) {
      setScanError((error as Error).message);
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      await mutate("/api/scan/cancel", "POST");
      notify("正在停止发现任务，已发现的设备会保留。", "info");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="发现局域网设备" eyebrow="NETWORK DISCOVERY" onClose={onClose}>
      <form onSubmit={start}>
        <p className="form-intro">
          选择办公网络，发现可访问的设备并加入清单。在设置中保存网段并启用自动发现后，默认每
          10 分钟更新一次；可按需调整间隔。
        </p>
        <div className="field-label" id="adapter-list-label">
          本机网络适配器
        </div>
        <div
          className="adapter-list"
          role="group"
          aria-labelledby="adapter-list-label"
        >
          {state.adapters.length ? (
            state.adapters.map((a) => {
              const suggested = discoverySubnet(a.ip, a.subnet);
              return (
                <button
                  type="button"
                  disabled={running || busy}
                  key={`${a.id}:${a.ip}`}
                  aria-pressed={subnet === suggested}
                  className={`adapter-option ${subnet === suggested ? "selected" : ""}`}
                  onClick={() => {
                    setSubnet(suggested);
                    setScanError("");
                    setSubnetNotice(
                      suggested === a.subnet
                        ? ""
                        : `此适配器的 ${a.subnet} 超过单次扫描范围。已填入本机 IP 所在的 ${suggested}；其他子网需要另行发现。`,
                    );
                  }}
                >
                  <span className="adapter-icon">
                    <Network size={21} />
                  </span>
                  <span>
                    <strong>{a.name}</strong>
                    <small>
                      <span className="mono">{a.ip}</span> · {a.subnet}
                    </small>
                    {suggested !== a.subnet && (
                      <small>建议先发现 {suggested}</small>
                    )}
                  </span>
                  <span className="radio-dot">
                    {subnet === suggested && <Check size={12} />}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="inline-note">
              <CircleAlert size={17} />
              未找到可用的办公网络适配器，请手动填写网段。
            </div>
          )}
        </div>
        {subnetNotice && (
          <p className="inline-note" role="status">
            <CircleAlert size={17} />
            {subnetNotice}
          </p>
        )}
        <label className="field">
          <span>
            扫描网段 <small>IPv4 CIDR</small>
          </span>
          <input
            value={subnet}
            onChange={(e) => {
              setSubnet(e.target.value);
              setSubnetNotice("");
              setScanError("");
            }}
            disabled={running || busy}
            placeholder="例如 192.168.1.0/24"
            required
            autoComplete="off"
            aria-describedby="scan-subnet-help"
          />
          <small id="scan-subnet-help">
            支持私有网段 /22–/32，每次最多 1,024
            个地址。网段应属于你管理的局域网。
          </small>
        </label>
        {scanError && (
          <p className="inline-note error-text" role="alert">
            <CircleAlert size={17} />
            {scanError}
          </p>
        )}
        {scan.status !== "idle" && (
          <div
            className={`scan-progress-box ${scan.status === "failed" ? "failed" : ""}`}
          >
            <div>
              <span className={running ? "rotating" : ""}>
                <Radar size={20} />
              </span>
              <strong>
                {{
                  running: "正在发现设备",
                  completed: "发现已完成",
                  cancelled: "发现已停止",
                  failed: "发现未完成",
                }[scan.status] || scan.status}
              </strong>
              <span className="mono">
                {scan.completed} / {scan.total}
              </span>
            </div>
            <progress value={scan.completed} max={scan.total || 1} />
            <p>
              <span>{scan.subnet}</span>
              <span>
                已发现 <b>{scan.found}</b> 台
              </span>
            </p>
            {scan.error && <div className="error-text">{scan.error}</div>}
          </div>
        )}
        <div className="form-footer">
          <button type="button" className="button ghost" onClick={onClose}>
            关闭
          </button>
          {running ? (
            <button
              type="button"
              className="button danger-outline"
              onClick={cancel}
              disabled={busy}
            >
              {busy && <LoaderCircle className="rotating" size={16} />}停止发现
            </button>
          ) : (
            <button
              className="button primary"
              disabled={busy || !subnet.trim()}
            >
              {busy ? (
                <LoaderCircle className="rotating" size={16} />
              ) : (
                <Radar size={17} />
              )}
              开始发现
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

export function AddDeviceDialog({
  ports,
  mutate,
  notify,
  onClose,
}: {
  ports: number[];
  mutate: Mutate;
  notify: Notify;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
    ip: "",
    alias: "",
    type: "device",
    group: "未分组",
    tags: "",
    owner: "",
    location: "",
    ports: ports.join(", "),
  });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await mutate("/api/devices", "POST", {
        ...draft,
        ip: draft.ip.trim(),
        tags: parseTags(draft.tags),
        ports: parsePorts(draft.ports),
      });
      notify("设备已添加，即将开始监测。");
      onClose();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="添加设备" eyebrow="ADD A DEVICE" onClose={onClose}>
      <form onSubmit={save}>
        <p className="form-intro">已知设备地址时，可以直接加入监测。</p>
        <label className="field">
          <span>
            IP 地址 <em>*</em>
          </span>
          <input
            autoFocus
            placeholder="192.168.1.10"
            required
            value={draft.ip}
            onChange={(e) => setDraft({ ...draft, ip: e.target.value })}
          />
        </label>
        <label className="field">
          <span>设备名称</span>
          <input
            placeholder="例如 前台打印机"
            maxLength={80}
            value={draft.alias}
            onChange={(e) => setDraft({ ...draft, alias: e.target.value })}
          />
        </label>
        <div className="field-pair">
          <label className="field">
            <span>设备类型</span>
            <select
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value })}
            >
              {Object.entries(deviceTypes).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>分组</span>
            <input
              maxLength={40}
              value={draft.group}
              onChange={(e) => setDraft({ ...draft, group: e.target.value })}
            />
          </label>
        </div>
        <div className="field-pair">
          <label className="field">
            <span>负责人</span>
            <input
              maxLength={60}
              value={draft.owner}
              onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
            />
          </label>
          <label className="field">
            <span>所在位置</span>
            <input
              maxLength={80}
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            />
          </label>
        </div>
        <label className="field">
          <span>标签</span>
          <input
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            placeholder="例如 财务, 关键设备"
          />
          <small>使用逗号分隔，最多 12 个标签。</small>
        </label>
        <label className="field">
          <span>TCP 监测端口</span>
          <input
            value={draft.ports}
            onChange={(e) => setDraft({ ...draft, ports: e.target.value })}
            placeholder="80, 443"
          />
          <small>用逗号分隔。留空则仅监测设备可达性。</small>
        </label>
        <div className="form-footer">
          <button type="button" className="button ghost" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="rotating" />
            ) : (
              <Plus size={17} />
            )}
            添加设备
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function DeviceDrawer({
  device,
  paused,
  mutate,
  notify,
  onClose,
}: {
  device: Device;
  paused: boolean;
  mutate: Mutate;
  notify: Notify;
  onClose: () => void;
}) {
  const form = useFormDraft<DeviceDraft>({
    alias: device.alias,
    type: device.type,
    group: device.group,
    tags: (device.tags || []).join(", "),
    owner: device.owner || "",
    location: device.location || "",
    notes: device.notes,
    ports: device.ports.join(", "),
    monitoringEnabled: device.monitoringEnabled,
  });
  const { draft } = form;
  const [saveError, setSaveError] = useState("");
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [metric, setMetric] = useState<"latencyMs" | "lossPercent">(
    "latencyMs",
  );
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"status" | "edit">("status");
  const drawerRef = useRef<HTMLElement>(null);
  useDialogFocus(drawerRef, onClose);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/devices/${device.id}/history`, {
          signal: controller.signal,
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("历史数据暂时无法读取");
        const data: HistorySample[] = await response.json();
        setHistory(data);
        setHistoryError("");
      } catch (error) {
        if (!controller.signal.aborted)
          setHistoryError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [device.id]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setSaveError("");
    const submitted = { ...form.edits };
    try {
      const changes: Partial<Omit<DeviceDraft, "ports" | "tags">> & {
        ports?: number[];
        tags?: string[];
      } = {};
      for (const key of [
        "alias",
        "type",
        "group",
        "owner",
        "location",
        "notes",
      ] as const) {
        if (submitted[key] !== undefined && submitted[key] !== device[key])
          changes[key] = submitted[key];
      }
      if (
        submitted.monitoringEnabled !== undefined &&
        submitted.monitoringEnabled !== device.monitoringEnabled
      )
        changes.monitoringEnabled = submitted.monitoringEnabled;
      if (submitted.ports !== undefined) {
        const ports = parsePorts(submitted.ports).sort((a, b) => a - b);
        if (
          ports.join(",") !== [...device.ports].sort((a, b) => a - b).join(",")
        )
          changes.ports = ports;
      }
      if (submitted.tags !== undefined) {
        const tags = parseTags(submitted.tags);
        if (tags.join(",") !== (device.tags || []).join(","))
          changes.tags = tags;
      }
      if (Object.keys(changes).length)
        await mutate(`/api/devices/${device.id}`, "PATCH", changes);
      form.accept(submitted);
      notify(
        Object.keys(changes).length ? "设备信息已保存。" : "设备信息没有变化。",
      );
      setTab("status");
    } catch (error) {
      setSaveError((error as Error).message);
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await mutate(`/api/devices/${device.id}`, "DELETE");
      notify("设备已从清单中移除。");
      onClose();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-drawer-title"
        className="device-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-heading">
          <span className="eyebrow">DEVICE DETAILS</span>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="关闭设备详情"
          >
            <X size={22} />
          </button>
        </div>
        <div className="device-identity">
          <span className="device-icon large">
            <DeviceIcon type={device.type} size={29} />
          </span>
          <div>
            <h2 id="device-drawer-title">{nameOf(device)}</h2>
            <p className="mono">{device.ip}</p>
          </div>
          <Status device={device} paused={paused} />
        </div>
        <div className="drawer-tabs">
          <button
            className={tab === "status" ? "selected" : ""}
            onClick={() => setTab("status")}
          >
            运行状态
          </button>
          <button
            className={tab === "edit" ? "selected" : ""}
            onClick={() => setTab("edit")}
          >
            设备设置
          </button>
        </div>
        <div className="drawer-content">
          {tab === "status" ? (
            <>
              <div className="drawer-metrics">
                <div>
                  <small>Ping 延迟</small>
                  <strong>
                    {number(device.lastProbe?.latencyMs)}
                    <em>ms</em>
                  </strong>
                </div>
                <div>
                  <small>丢包率</small>
                  <strong>
                    {number(device.lastProbe?.lossPercent)}
                    <em>%</em>
                  </strong>
                </div>
                <div>
                  <small>收包 / 发包</small>
                  <strong className="small-number">
                    {device.lastProbe
                      ? `${device.lastProbe.received} / ${device.lastProbe.sent}`
                      : "—"}
                  </strong>
                </div>
              </div>
              <section className="drawer-section">
                <div className="section-heading">
                  <h3>采样趋势</h3>
                  <div className="segment-control small">
                    <button
                      className={metric === "latencyMs" ? "active" : ""}
                      onClick={() => setMetric("latencyMs")}
                    >
                      延迟
                    </button>
                    <button
                      className={metric === "lossPercent" ? "active" : ""}
                      onClick={() => setMetric("lossPercent")}
                    >
                      丢包
                    </button>
                  </div>
                </div>
                {historyError ? (
                  <p className="inline-note error-text">
                    <CircleAlert size={16} />
                    {historyError}
                  </p>
                ) : historyLoading ? (
                  <div className="chart-empty compact">
                    <LoaderCircle className="rotating" size={24} />
                    <span>正在读取历史采样</span>
                  </div>
                ) : (
                  <TrendChart
                    points={historyPoints(history, metric)}
                    metric={metric === "lossPercent" ? "loss" : "latency"}
                    compact
                  />
                )}
              </section>
              <section className="drawer-section">
                <h3>设备信息</h3>
                <dl className="details-list">
                  <div>
                    <dt>MAC 地址</dt>
                    <dd className="mono">{device.mac || "暂未获取"}</dd>
                  </div>
                  <div>
                    <dt>主机名称</dt>
                    <dd>{device.hostname || "暂未获取"}</dd>
                  </div>
                  <div>
                    <dt>类型 / 分组</dt>
                    <dd>
                      {deviceTypes[device.type] || device.type} · {device.group}
                    </dd>
                  </div>
                  <div>
                    <dt>负责人</dt>
                    <dd>{device.owner || "未填写"}</dd>
                  </div>
                  <div>
                    <dt>所在位置</dt>
                    <dd>{device.location || "未填写"}</dd>
                  </div>
                  <div>
                    <dt>最近检查</dt>
                    <dd>{timeOf(device.lastChecked, true)}</dd>
                  </div>
                  <div>
                    <dt>最近在线</dt>
                    <dd>{timeOf(device.lastSeen, true)}</dd>
                  </div>
                  <div>
                    <dt>首次发现</dt>
                    <dd>{timeOf(device.firstSeen, true)}</dd>
                  </div>
                </dl>
                {device.tags?.length > 0 && (
                  <div className="device-tags">
                    {device.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                )}
                {device.notes && <p className="device-notes">{device.notes}</p>}
                {device.lastProbe?.error && (
                  <p className="inline-note">
                    <CircleAlert size={16} />
                    {device.lastProbe.error}
                  </p>
                )}
              </section>
              <section className="drawer-section">
                <div className="section-heading">
                  <h3>TCP 端口</h3>
                  <span className="subdued">
                    {device.ports.length} 个配置端口
                  </span>
                </div>
                {device.lastProbe?.ports.length ? (
                  <div className="port-grid">
                    {device.lastProbe.ports.map((p) => (
                      <div className={`port-result ${p.status}`} key={p.port}>
                        <span>
                          <strong className="mono">{p.port}</strong>
                          <small>TCP</small>
                        </span>
                        <span>
                          <b>
                            {{
                              open: "开放",
                              closed: "关闭",
                              timeout: "超时",
                              error: "检测异常",
                            }[p.status] || p.status}
                          </b>
                          <small>
                            {p.status === "open"
                              ? `${number(p.latencyMs)} ms`
                              : p.error || "—"}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="subdued section-note">
                    {device.ports.length
                      ? "等待下一次端口检测。"
                      : "未配置端口，可在设备设置中添加。"}
                  </p>
                )}
              </section>
              {device.addressHistory.length > 0 && (
                <section className="drawer-section">
                  <h3>地址记录</h3>
                  <div className="address-history">
                    {[...device.addressHistory]
                      .reverse()
                      .slice(0, 10)
                      .map((h, i) => (
                        <div key={`${h.ip}-${i}`}>
                          <span className="mono">{h.ip}</span>
                          <small>{timeOf(h.observedAt, true)}</small>
                        </div>
                      ))}
                  </div>
                </section>
              )}
              <div className="drawer-bottom-note">
                <ShieldCheck size={16} />
                <span>设备状态来自最近采样。无法获取的信息显示为“—”。</span>
              </div>
            </>
          ) : (
            <form onSubmit={save} aria-busy={busy}>
              <div className="setting-toggle device-monitor-toggle">
                <div>
                  <strong>监测此设备</strong>
                  <small>暂停后保留设备信息与历史记录</small>
                </div>
                <Toggle
                  checked={draft.monitoringEnabled}
                  onChange={(v) => form.set("monitoringEnabled", v)}
                  label="监测此设备"
                />
              </div>
              <label className="field">
                <span>设备名称</span>
                <input
                  value={draft.alias}
                  maxLength={80}
                  placeholder={device.hostname || device.ip}
                  onChange={(e) => form.set("alias", e.target.value)}
                />
              </label>
              <div className="field-pair">
                <label className="field">
                  <span>设备类型</span>
                  <select
                    value={draft.type}
                    onChange={(e) => form.set("type", e.target.value)}
                  >
                    {!deviceTypes[draft.type] && (
                      <option value={draft.type}>{draft.type}</option>
                    )}
                    {Object.entries(deviceTypes).map(([key, value]) => (
                      <option key={key} value={key}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>分组</span>
                  <input
                    value={draft.group}
                    maxLength={40}
                    onChange={(e) => form.set("group", e.target.value)}
                  />
                </label>
              </div>
              <div className="field-pair">
                <label className="field">
                  <span>负责人</span>
                  <input
                    value={draft.owner}
                    maxLength={60}
                    onChange={(e) => form.set("owner", e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>所在位置</span>
                  <input
                    value={draft.location}
                    maxLength={80}
                    onChange={(e) => form.set("location", e.target.value)}
                  />
                </label>
              </div>
              <label className="field">
                <span>标签</span>
                <input
                  value={draft.tags}
                  onChange={(e) => form.set("tags", e.target.value)}
                  placeholder="例如 财务, 关键设备"
                />
                <small>多个标签用逗号分隔，最多 12 个。</small>
              </label>
              <label className="field">
                <span>TCP 监测端口</span>
                <input
                  value={draft.ports}
                  onChange={(e) => form.set("ports", e.target.value)}
                />
                <small>多个端口用逗号分隔，留空则不检测端口。</small>
              </label>
              <label className="field">
                <span>备注</span>
                <textarea
                  rows={4}
                  value={draft.notes}
                  maxLength={1000}
                  placeholder="记录设备位置、负责人或用途"
                  onChange={(e) => form.set("notes", e.target.value)}
                />
              </label>
              {saveError && (
                <p className="inline-note error-text" role="alert">
                  <CircleAlert size={16} />
                  {saveError}
                </p>
              )}
              <p className="settings-note" role="status">
                {form.dirty ? "有未保存的修改。" : "设备设置已同步。"}
              </p>
              <button
                className="button primary full-width"
                disabled={busy || !form.dirty}
              >
                {busy ? (
                  <LoaderCircle size={16} className="rotating" />
                ) : (
                  <Save size={16} />
                )}
                保存修改
              </button>
              <div className="danger-zone">
                <h3>移除设备</h3>
                <p>
                  移除后停止监测，相关活动告警会归档。再次发现时可能重新加入清单。
                </p>
                {deleting ? (
                  <div className="delete-confirm">
                    <strong>确认移除 {nameOf(device)}？</strong>
                    <div>
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => setDeleting(false)}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="button danger"
                        disabled={busy}
                        onClick={remove}
                      >
                        确认移除
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button danger-outline"
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2 size={16} />
                    移除设备
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </aside>
    </div>
  );
}

export function SettingsPage({
  settings,
  mutate,
  notify,
  notificationState,
  onNotifications,
}: {
  settings: Settings;
  mutate: Mutate;
  notify: Notify;
  notificationState: string;
  onNotifications: () => void;
}) {
  const form = useFormDraft({
    ...settings,
    autoDiscoveryEnabled: settings.autoDiscoveryEnabled ?? true,
    discoveryIntervalMinutes: settings.discoveryIntervalMinutes ?? 10,
    defaultPorts: settings.defaultPorts.join(", "),
  });
  const { draft } = form;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    error: boolean;
    message: string;
  } | null>(null);
  const set = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) => {
    form.set(key, value);
    setSaveFeedback(null);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !form.dirty) return;
    setBusy(true);
    setSaveFeedback(null);
    const submitted = { ...form.edits };
    try {
      // draft already combines the latest polled settings with only locally dirty fields.
      await mutate("/api/settings", "PUT", {
        ...draft,
        defaultPorts: parsePorts(draft.defaultPorts),
      });
      form.accept(submitted);
      setSaveFeedback({ error: false, message: "设置已保存并生效。" });
      notify("设置已保存并生效。");
    } catch (error) {
      const message = (error as Error).message;
      setSaveFeedback({ error: true, message });
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      notify("无法自动复制，请复制浏览器地址栏。", "info");
    }
  };
  return (
    <form onSubmit={save} className="settings-layout">
      <div className="settings-main">
        <section className="panel settings-section">
          <div className="settings-section-title">
            <span className="section-index">01</span>
            <div>
              <h2>工作空间</h2>
              <p>你的办公室，按自己的方式组织。</p>
            </div>
          </div>
          <label className="field">
            <span>空间名称</span>
            <input
              value={draft.siteName}
              required
              maxLength={60}
              onChange={(e) => set("siteName", e.target.value)}
            />
          </label>
          <label className="field">
            <span>默认发现网段</span>
            <input
              value={draft.subnet}
              placeholder="例如 192.168.1.0/24"
              onChange={(e) => set("subnet", e.target.value)}
            />
            <small>
              保存网段并启用自动发现后，将按设定间隔扫描此网络。留空时不自动发现。
            </small>
          </label>
          <div className="setting-toggle">
            <div>
              <strong>自动监测</strong>
              <small>按设定周期检查清单内的设备；暂停后也会暂停自动发现</small>
            </div>
            <Toggle
              checked={draft.monitoringEnabled}
              onChange={(v) => set("monitoringEnabled", v)}
              label="启用自动监测"
            />
          </div>
          <div className="auto-discovery-settings">
            <div className="setting-toggle">
              <div>
                <strong>自动发现新设备</strong>
                <small>持续更新已保存网段的设备清单</small>
              </div>
              <Toggle
                checked={draft.autoDiscoveryEnabled}
                onChange={(v) => set("autoDiscoveryEnabled", v)}
                label="启用自动发现"
              />
            </div>
            <label className="field">
              <span>
                自动发现间隔 <small>分钟</small>
              </span>
              <input
                type="number"
                min={5}
                max={1440}
                required
                disabled={!draft.autoDiscoveryEnabled}
                value={draft.discoveryIntervalMinutes}
                onChange={(e) =>
                  set("discoveryIntervalMinutes", +e.target.value)
                }
              />
              <small>
                支持 5–1,440 分钟，默认 10 分钟。需要同时启用自动监测。
              </small>
            </label>
          </div>
        </section>
        <section className="panel settings-section">
          <div className="settings-section-title">
            <span className="section-index">02</span>
            <div>
              <h2>探测与采样</h2>
              <p>为办公网络设定合适的监测节奏。</p>
            </div>
          </div>
          <div className="field-pair">
            <label className="field">
              <span>
                监测间隔 <small>秒</small>
              </span>
              <input
                type="number"
                min={15}
                max={3600}
                required
                value={draft.intervalSeconds}
                onChange={(e) => set("intervalSeconds", +e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                单次超时 <small>毫秒</small>
              </span>
              <input
                type="number"
                min={200}
                max={3000}
                required
                value={draft.timeoutMs}
                onChange={(e) => set("timeoutMs", +e.target.value)}
              />
            </label>
          </div>
          <div className="field-pair">
            <label className="field">
              <span>每轮 Ping 数量</span>
              <input
                type="number"
                min={1}
                max={5}
                required
                value={draft.pingCount}
                onChange={(e) => set("pingCount", +e.target.value)}
              />
            </label>
            <label className="field">
              <span>默认 TCP 端口</span>
              <input
                value={draft.defaultPorts}
                onChange={(e) => set("defaultPorts", e.target.value)}
                placeholder="80, 443"
              />
            </label>
          </div>
          <p className="settings-note">
            默认端口用于发现设备时检测；自动发现仅持续监测当时开放的端口。手动添加和已有设备可单独配置。
          </p>
        </section>
        <section className="panel settings-section">
          <div className="settings-section-title">
            <span className="section-index">03</span>
            <div>
              <h2>异常与提醒</h2>
              <p>持续异常后触发告警，恢复时自动结束事件。</p>
            </div>
          </div>
          <div className="field-pair">
            <label className="field">
              <span>
                连续异常触发 <small>轮</small>
              </span>
              <input
                type="number"
                min={1}
                max={10}
                required
                value={draft.failureThreshold}
                onChange={(e) => set("failureThreshold", +e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                连续正常恢复 <small>轮</small>
              </span>
              <input
                type="number"
                min={1}
                max={10}
                required
                value={draft.recoveryThreshold}
                onChange={(e) => set("recoveryThreshold", +e.target.value)}
              />
            </label>
          </div>
          <div className="field-pair">
            <label className="field">
              <span>
                高延迟阈值 <small>毫秒</small>
              </span>
              <input
                type="number"
                min={1}
                max={5000}
                required
                value={draft.latencyThresholdMs}
                onChange={(e) => set("latencyThresholdMs", +e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                丢包率阈值 <small>%</small>
              </span>
              <input
                type="number"
                min={1}
                max={100}
                required
                value={draft.lossThresholdPercent}
                onChange={(e) => set("lossThresholdPercent", +e.target.value)}
              />
            </label>
          </div>
          <div className="setting-toggle">
            <div>
              <strong>浏览器桌面提醒</strong>
              <small>
                {notificationState === "enabled"
                  ? "页面打开时，新告警将显示桌面通知"
                  : notificationState === "denied"
                    ? "通知权限被阻止，请在浏览器站点设置中更改"
                    : notificationState === "unsupported"
                      ? "当前浏览器不支持桌面通知"
                      : "页面打开时，将新告警提醒到桌面"}
              </small>
            </div>
            <button
              type="button"
              className="button secondary compact"
              disabled={
                notificationState === "unsupported" ||
                notificationState === "denied"
              }
              onClick={onNotifications}
            >
              {notificationState === "enabled" ? "已启用 · 关闭" : "启用提醒"}
            </button>
          </div>
        </section>
        <section className="panel settings-section">
          <div className="settings-section-title">
            <span className="section-index">04</span>
            <div>
              <h2>本地数据</h2>
              <p>数据保存在当前电脑，使用普通文件即可管理。</p>
            </div>
          </div>
          <label className="field">
            <span>
              历史采样保留 <small>天</small>
            </span>
            <input
              type="number"
              min={1}
              max={30}
              required
              value={draft.retentionDays}
              onChange={(e) => set("retentionDays", +e.target.value)}
            />
            <small>
              超出保留时间的历史采样将自动清理，历史文件总量最多保留 512 MB。
            </small>
          </label>
          <div className="storage-note">
            <HardDiskMark />
            <div>
              <strong>JSON 文件存储</strong>
              <p>
                设备、设置与告警保存在 data/state.json，采样按天保存在
                data/history。无需安装数据库。
              </p>
            </div>
          </div>
          <a className="button secondary" href="/api/export" download>
            <ArrowDownToLine size={16} />
            导出设备与设置
          </a>
        </section>
        {saveFeedback && (
          <p
            className={`inline-note ${saveFeedback.error ? "error-text" : ""}`}
            role={saveFeedback.error ? "alert" : "status"}
          >
            {saveFeedback.error ? (
              <CircleAlert size={17} />
            ) : (
              <Check size={17} />
            )}
            {saveFeedback.message}
          </p>
        )}
        <div className="settings-save" aria-busy={busy}>
          <span role="status">
            {form.dirty ? "有未保存的修改，保存后立即生效。" : "设置已同步。"}
          </span>
          {form.dirty && (
            <button
              type="button"
              className="button ghost"
              disabled={busy}
              onClick={() => {
                form.reset();
                setSaveFeedback(null);
              }}
            >
              撤销修改
            </button>
          )}
          <button className="button primary" disabled={busy || !form.dirty}>
            {busy ? (
              <LoaderCircle className="rotating" size={16} />
            ) : (
              <Save size={16} />
            )}
            保存设置
          </button>
        </div>
      </div>
      <aside className="settings-aside">
        <div className="settings-guide">
          <div className="eyebrow">A QUIETER NETWORK</div>
          <h3>
            让网络状态
            <br />
            一目了然。
          </h3>
          <p>保持这台 Windows 电脑开机，LANtern 会持续守望你的局域网。</p>
          <div className="guide-rule" />
          <span className="subdued">当前访问地址</span>
          <button type="button" className="address-copy mono" onClick={copy}>
            {window.location.origin}
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          <p className="small">
            浏览器页面关闭后，正在运行的后台服务仍可采集数据。桌面通知需要页面保持打开。
          </p>
        </div>
      </aside>
    </form>
  );
}
function HardDiskMark() {
  return (
    <div className="storage-icon">
      <Activity size={24} strokeWidth={1.4} />
    </div>
  );
}
