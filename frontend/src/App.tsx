import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  CircleAlert,
  CircleCheck,
  FileBarChart2,
  HardDrive,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Monitor,
  Network,
  Plus,
  Radar,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Wifi,
  X,
} from "lucide-react";
import {
  DeviceTable,
  EmptyState,
  historyPoints,
  number,
  timeOf,
  TrendChart,
} from "./components";
import {
  AddDeviceDialog,
  DeviceDrawer,
  ScanDialog,
  SettingsPage,
} from "./forms";
import type { Mutate, Notify } from "./forms";
import {
  DevicesPage,
  IncidentRows,
  IncidentsPage,
  TopologyPage,
} from "./pages";
import { ReportPage } from "./report";
import type { AppState, Device, View } from "./types";

const views: {
  id: View;
  title: string;
  subtitle: string;
  nav: string;
  icon: typeof Activity;
}[] = [
  {
    id: "overview",
    title: "网络概览",
    subtitle: "每一次连接，都清晰可见。",
    nav: "概览",
    icon: LayoutDashboard,
  },
  {
    id: "devices",
    title: "设备管理",
    subtitle: "认识网络里的每一台设备。",
    nav: "设备",
    icon: Monitor,
  },
  {
    id: "topology",
    title: "网络拓扑",
    subtitle: "在一张图里，看见整个网络。",
    nav: "拓扑",
    icon: Network,
  },
  {
    id: "incidents",
    title: "异常提醒",
    subtitle: "及时了解变化，从容处理异常。",
    nav: "提醒",
    icon: Bell,
  },
  {
    id: "report",
    title: "运行报告",
    subtitle: "让每一次采样，成为清晰的判断依据。",
    nav: "报告",
    icon: FileBarChart2,
  },
  {
    id: "settings",
    title: "工作空间设置",
    subtitle: "让监测适合你的办公网络。",
    nav: "设置",
    icon: Settings2,
  },
];
type Toast = {
  id: number;
  message: string;
  kind: "success" | "error" | "info";
};

async function readResponse(response: Response) {
  if (response.status === 204) return undefined;
  const text = await response.text();
  let result: unknown;
  try {
    result = text ? JSON.parse(text) : undefined;
  } catch {
    if (!response.ok)
      throw new Error(`服务暂时不可用（${response.status}），请稍后重试。`);
    throw new Error("服务响应格式异常，请重新连接。");
  }
  if (!response.ok)
    throw new Error(
      (result as { error?: string } | null)?.error ||
        `操作未完成（${response.status}）`,
    );
  return result;
}
function readNotificationPreference() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    return Notification.permission === "granted" &&
      localStorage.getItem("lantern-desktop-notifications") === "enabled"
      ? "enabled"
      : "disabled";
  } catch {
    return "disabled";
  }
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("overview");
  const [scanOpen, setScanOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [probing, setProbing] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [notificationState, setNotificationState] = useState(
    readNotificationPreference,
  );
  const token = useRef("");
  const knownIncidents = useRef<Set<string> | null>(null);
  const previousScan = useRef("idle");
  const refreshSequence = useRef(0);
  const refreshAbort = useRef<AbortController | null>(null);
  const notify: Notify = useCallback((message, kind = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, message, kind }]);
    window.setTimeout(
      () => setToasts((t) => t.filter((item) => item.id !== id)),
      kind === "error" ? 8000 : 5500,
    );
  }, []);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    refreshAbort.current?.abort();
    const controller = new AbortController();
    refreshAbort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("/api/state", {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      const fresh = (await readResponse(response)) as AppState;
      if (sequence === refreshSequence.current) {
        setState(fresh);
        setError("");
      }
    } catch (error) {
      if (
        (error as Error).name !== "AbortError" &&
        sequence === refreshSequence.current
      )
        setError((error as Error).message || "暂时无法连接监测服务。");
    } finally {
      window.clearTimeout(timeout);
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      if (cancelled) return;
      await refresh();
      if (!cancelled) timer = window.setTimeout(poll, 5000);
    };
    const bootstrap = async () => {
      try {
        const response = await fetch("/api/bootstrap", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = (await readResponse(response)) as { csrfToken: string };
        if (!cancelled) token.current = data.csrfToken;
      } catch (error) {
        if (!cancelled) setError((error as Error).message);
      }
      if (!cancelled) {
        await refresh();
        if (!cancelled) timer = window.setTimeout(poll, 5000);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      refreshAbort.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (!state) return;
    document.title = `${state.settings.siteName} · LANtern`;
    if (knownIncidents.current) {
      state.incidents
        .filter(
          (i) => !knownIncidents.current!.has(i.id) && i.status !== "resolved",
        )
        .forEach((i) => {
          notify(`${i.deviceName || "网络提醒"}：${i.message}`, "info");
          if (
            notificationState === "enabled" &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            try {
              const notification = new Notification("LANtern · 网络异常", {
                body: `${i.deviceName}：${i.message}`,
                tag: i.id,
              });
              notification.onclick = () => {
                window.focus();
                setView("incidents");
                notification.close();
              };
            } catch {
              /* The in-page notice remains available if this browser cannot show desktop notifications. */
            }
          }
        });
    }
    knownIncidents.current = new Set(state.incidents.map((i) => i.id));
    if (previousScan.current === "running" && state.scan.status !== "running") {
      if (state.scan.status === "completed")
        notify(`发现完成，共发现 ${state.scan.found} 台设备。`);
      else if (state.scan.status === "failed")
        notify(state.scan.error || "发现任务未完成。", "error");
    }
    previousScan.current = state.scan.status;
  }, [state, notificationState, notify]);
  const mutate: Mutate = useCallback(
    async (path, method, body) => {
      if (!token.current) {
        const response = await fetch("/api/bootstrap", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = (await readResponse(response)) as { csrfToken: string };
        token.current = data.csrfToken;
      }
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Lantern-Token": token.current,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 403) token.current = "";
      const result = await readResponse(response);
      await refresh();
      return result;
    },
    [refresh],
  );
  const probe = async () => {
    setProbing(true);
    try {
      await mutate("/api/probe", "POST");
      notify("已启动一次监测，结果会自动刷新。");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setProbing(false);
    }
  };
  const onNotifications = async () => {
    if (!("Notification" in window)) return;
    try {
      if (notificationState === "enabled") {
        localStorage.setItem("lantern-desktop-notifications", "disabled");
        setNotificationState("disabled");
        notify("桌面提醒已关闭。", "info");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        localStorage.setItem("lantern-desktop-notifications", "enabled");
        setNotificationState("enabled");
        notify("桌面提醒已启用。");
      } else {
        setNotificationState(permission === "denied" ? "denied" : "disabled");
        notify("可在浏览器站点设置中允许通知。", "info");
      }
    } catch {
      notify("无法启用桌面提醒，请检查浏览器权限。", "error");
    }
  };
  const nav = (next: View) => {
    setView(next);
    setMobileNav(false);
  };
  useEffect(() => {
    const navigation = document.getElementById("lantern-navigation");
    const syncMobileNavigation = () => {
      const hidden =
        window.matchMedia("(max-width: 560px)").matches && !mobileNav;
      if (navigation) {
        navigation.inert = hidden;
        navigation.setAttribute("aria-hidden", String(hidden));
      }
    };
    syncMobileNavigation();
    window.addEventListener("resize", syncMobileNavigation);
    return () => window.removeEventListener("resize", syncMobileNavigation);
  }, [mobileNav]);
  useEffect(() => {
    if (!mobileNav) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNav(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileNav]);
  const current = views.find((v) => v.id === view)!;
  const activeIncidents =
    state?.incidents.filter((i) => i.status !== "resolved") || [];
  const unacknowledged = activeIncidents.filter((i) => !i.acknowledged).length;
  const selected = state?.devices.find((d) => d.id === selectedId);
  const collectorWorking = [
    "running",
    "probing",
    "monitoring",
    "discovering",
  ].includes(state?.collector.status || "");
  const collectorLabel = error
    ? "服务连接中断"
    : !state
      ? "正在连接"
      : state.collector.status === "discovering"
        ? "正在发现设备"
        : !state.settings.monitoringEnabled
          ? "自动监测已暂停"
          : state.collector.status === "error"
            ? "采集异常"
            : collectorWorking
              ? "正在采集数据"
              : state.devices.length
                ? "自动监测中"
                : "等待设备接入";
  return (
    <div className="app-shell">
      <aside
        id="lantern-navigation"
        className={`sidebar ${mobileNav ? "open" : ""}`}
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            nav("overview");
          }}
        >
          <span className="brand-mark">
            <Network size={23} strokeWidth={1.7} />
          </span>
          <span>
            LANtern<span className="brand-period">.</span>
          </span>
        </a>
        <div className="sidebar-label">YOUR LOCAL NETWORK</div>
        <nav className="main-nav" aria-label="主导航">
          {views.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => nav(item.id)}
            >
              <item.icon size={19} strokeWidth={1.65} />
              <span>{item.nav}</span>
              {item.id === "incidents" && unacknowledged > 0 && (
                <b className="nav-badge">{unacknowledged}</b>
              )}
              {view === item.id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-network-icon">
            <Wifi size={23} strokeWidth={1.4} />
          </div>
          <p>
            小小网络，
            <br />
            稳稳在线。
          </p>
          <div className="sidebar-divider" />
          <div className="local-badge">
            <i />
            本地运行 · 文件存储
          </div>
          <span className="version">LANtern v1.0</span>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="mobile-nav-scrim"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="workspace-select">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(!mobileNav)}
              aria-expanded={mobileNav}
              aria-controls="lantern-navigation"
              aria-label={mobileNav ? "关闭导航" : "打开导航"}
            >
              <Menu size={21} />
            </button>
            <span className="workspace-icon">
              <Network size={17} />
            </span>
            <span>{state?.settings.siteName || "我的办公室"}</span>
            <span className="workspace-divider" />
            <span className="workspace-scope">
              {state?.settings.subnet || "本地网络"}
            </span>
          </div>
          <div className="topbar-right">
            <span className={`collector-status ${error ? "disconnected" : ""}`}>
              <i className={collectorWorking ? "pulse" : ""} />
              {collectorLabel}
            </span>
            <span className="topbar-divider" />
            <button
              className="notification-button"
              onClick={() => nav("incidents")}
              aria-label={`异常提醒，${unacknowledged} 项未确认`}
            >
              <Bell size={20} strokeWidth={1.7} />
              {unacknowledged > 0 && <i />}
            </button>
            <span className="workspace-avatar" title="本地工作空间">
              {(state?.settings.siteName || "办").slice(0, 1)}
            </span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "overview"
                  ? "A CLEAR VIEW OF YOUR NETWORK"
                  : `WORKSPACE / ${view.toUpperCase()}`}
              </div>
              <h1>{current.title}</h1>
              <p>{current.subtitle}</p>
            </div>
            <div className="page-actions">
              {view !== "settings" && (
                <>
                  <button
                    className="button secondary"
                    disabled={
                      !state ||
                      !state.devices.length ||
                      probing ||
                      collectorWorking
                    }
                    onClick={() => void probe()}
                  >
                    {probing || collectorWorking ? (
                      <LoaderCircle size={16} className="rotating" />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                    立即监测
                  </button>
                  <button
                    className="button primary"
                    disabled={!state}
                    onClick={() => setScanOpen(true)}
                  >
                    <Radar size={17} />
                    {state?.scan.status === "running"
                      ? "发现进行中"
                      : "发现设备"}
                  </button>
                </>
              )}
            </div>
          </div>
          {error && (
            <div className="connection-error" role="alert">
              <CircleAlert size={18} />
              <span>
                {state
                  ? "连接暂时中断，当前显示上次获取的数据。"
                  : "暂时无法连接本机监测服务。"}{" "}
                <small>{error}</small>
              </span>
              <button className="text-link" onClick={() => void refresh()}>
                重新连接
              </button>
            </div>
          )}
          {loading && !state ? (
            <div className="loading-state">
              <span className="loading-orbit">
                <Network size={31} />
              </span>
              <h2>正在连接你的网络空间</h2>
              <p>读取设备清单与监测状态…</p>
            </div>
          ) : !state ? (
            <section className="panel">
              <EmptyState
                title="等待监测服务上线"
                text="请确认 LANtern 服务正在这台电脑上运行，页面将自动重连。"
                icon="clock"
              >
                <button
                  className="button primary"
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={16} />
                  重新连接
                </button>
              </EmptyState>
            </section>
          ) : (
            <>
              {view === "overview" && (
                <Overview
                  state={state}
                  nav={nav}
                  onScan={() => setScanOpen(true)}
                  onAdd={() => setAddOpen(true)}
                  onSelect={(d) => setSelectedId(d.id)}
                  mutate={mutate}
                  notify={notify}
                />
              )}
              {view === "devices" && (
                <DevicesPage
                  state={state}
                  onScan={() => setScanOpen(true)}
                  onAdd={() => setAddOpen(true)}
                  onSelect={(d) => setSelectedId(d.id)}
                  mutate={mutate}
                  notify={notify}
                />
              )}
              {view === "topology" && (
                <TopologyPage
                  state={state}
                  onScan={() => setScanOpen(true)}
                  onSelect={(d) => setSelectedId(d.id)}
                />
              )}
              {view === "incidents" && (
                <IncidentsPage
                  state={state}
                  mutate={mutate}
                  notify={notify}
                  onSelect={(d) => setSelectedId(d.id)}
                />
              )}
              {view === "report" && (
                <ReportPage onSelect={(id) => setSelectedId(id)} />
              )}
              {view === "settings" && (
                <SettingsPage
                  settings={state.settings}
                  mutate={mutate}
                  notify={notify}
                  notificationState={notificationState}
                  onNotifications={() => void onNotifications()}
                />
              )}
              <footer className="workspace-footer">
                <span>
                  <ShieldCheck size={13} />
                  数据留在本机，掌控始终在你。
                </span>
                <span>
                  {state.collector.lastCycleAt
                    ? `最近采集 ${timeOf(state.collector.lastCycleAt)}`
                    : "等待首次采集"}
                  <span className="dot-separator">·</span>每{" "}
                  {state.settings.intervalSeconds} 秒监测
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {state && scanOpen && (
        <ScanDialog
          state={state}
          mutate={mutate}
          notify={notify}
          onClose={() => setScanOpen(false)}
        />
      )}
      {state && addOpen && (
        <AddDeviceDialog
          ports={state.settings.defaultPorts}
          mutate={mutate}
          notify={notify}
          onClose={() => setAddOpen(false)}
        />
      )}
      {selected && state && (
        <DeviceDrawer
          key={selected.id}
          device={selected}
          paused={!state.settings.monitoringEnabled}
          mutate={mutate}
          notify={notify}
          onClose={() => setSelectedId(null)}
        />
      )}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div className={`toast ${t.kind}`} key={t.id}>
            {t.kind === "success" ? (
              <CircleCheck size={19} />
            ) : (
              <CircleAlert size={19} />
            )}
            <span>{t.message}</span>
            <button
              aria-label="关闭提示"
              onClick={() =>
                setToasts((items) => items.filter((item) => item.id !== t.id))
              }
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Overview({
  state,
  nav,
  onScan,
  onAdd,
  onSelect,
  mutate,
  notify,
}: {
  state: AppState;
  nav: (v: View) => void;
  onScan: () => void;
  onAdd: () => void;
  onSelect: (d: Device) => void;
  mutate: Mutate;
  notify: Notify;
}) {
  const [metric, setMetric] = useState<"latencyMs" | "lossPercent">(
    "latencyMs",
  );
  const monitored = state.devices.filter(
    (d) => d.monitoringEnabled && state.settings.monitoringEnabled,
  );
  const online = monitored.filter((d) => d.status === "online");
  const offline = monitored.filter((d) => d.status === "offline");
  const unknown = monitored.filter((d) => d.status === "unknown").length;
  const active = state.incidents.filter((i) => i.status !== "resolved");
  const latency = online
    .map((d) => d.lastProbe?.latencyMs)
    .filter((n): n is number => n != null);
  const average = latency.length
    ? latency.reduce((a, b) => a + b, 0) / latency.length
    : null;
  const scan = state.scan;
  const deviceList = [...state.devices].sort(
    (a, b) =>
      (a.status === "offline" ? 0 : a.status === "unknown" ? 1 : 2) -
      (b.status === "offline" ? 0 : b.status === "unknown" ? 1 : 2),
  );
  const recentIncidents = [...state.incidents]
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, 3);
  return (
    <div className="overview">
      <section className="stat-grid">
        <div className="stat-card">
          <div className="stat-top">
            <span>设备总数</span>
            <span className="stat-icon">
              <Monitor size={18} />
            </span>
          </div>
          <div className="stat-value">
            {state.devices.length}
            <small>台</small>
          </div>
          <div className="stat-foot">
            <span className="tiny-dot gray" />
            {state.devices.length
              ? `${new Set(state.devices.map((d) => d.group)).size} 个设备分组`
              : "等待接入你的网络"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span>当前在线</span>
            <span className="stat-icon green">
              <Wifi size={19} />
            </span>
          </div>
          <div className="stat-value green">
            {online.length}
            <small>台</small>
            {state.devices.length > 0 && (
              <span className="stat-ratio">/ {state.devices.length}</span>
            )}
          </div>
          <div className="stat-foot">
            <span className="tiny-dot green" />
            {offline.length} 台离线<span className="dot-separator">·</span>
            {unknown} 台待确认
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span>平均响应延迟</span>
            <span className="stat-icon">
              <Activity size={19} />
            </span>
          </div>
          <div className="stat-value">
            {number(average)}
            <small>ms</small>
          </div>
          <div className="stat-foot">
            <span className="tiny-dot gray" />
            {latency.length
              ? `${latency.length} 台在线设备的最近采样`
              : "等待有效 Ping 响应"}
          </div>
        </div>
        <div className={`stat-card ${active.length ? "has-alerts" : ""}`}>
          <div className="stat-top">
            <span>活动告警</span>
            <span className="stat-icon amber">
              <Bell size={18} />
            </span>
          </div>
          <div className="stat-value">
            {active.length}
            <small>项</small>
          </div>
          <button
            className="stat-foot text-link"
            onClick={() => nav("incidents")}
          >
            <span className={`tiny-dot ${active.length ? "amber" : "green"}`} />
            {active.length
              ? `${active.filter((i) => !i.acknowledged).length} 项等待确认`
              : "当前没有活动告警"}
            <ArrowRight size={13} />
          </button>
        </div>
      </section>
      <section className="overview-middle">
        <div className="panel trend-panel">
          <div className="panel-heading">
            <div>
              <h2>
                网络脉搏
                <span className="live-label">
                  <i />
                  LIVE
                </span>
              </h2>
              <p>近期采样按分钟汇总 · 有效响应均值</p>
            </div>
            <div className="segment-control">
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
          <TrendChart
            points={historyPoints(state.history, metric, true)}
            metric={metric === "lossPercent" ? "loss" : "latency"}
          />
        </div>
        <div
          className={`discovery-card ${scan.status === "running" ? "scanning" : ""}`}
        >
          <div className="discovery-kicker">
            <span className="eyebrow">NETWORK DISCOVERY</span>
            <ArrowRight size={17} />
          </div>
          <div className="radar-art">
            <span className="radar-ring one" />
            <span className="radar-ring two" />
            <span className="radar-ring three" />
            <span className="radar-center">
              <Radar size={31} strokeWidth={1.2} />
            </span>
            <span className="radar-point one" />
            <span className="radar-point two" />
          </div>
          <div className="discovery-copy">
            <h2>
              {scan.status === "running"
                ? "正在认识你的网络"
                : state.devices.length
                  ? "连接，总在变化。"
                  : "从发现，开始连接。"}
            </h2>
            <p>
              {scan.status === "running"
                ? `${scan.completed} / ${scan.total} 个地址 · 已发现 ${scan.found} 台设备`
                : state.devices.length
                  ? "随时发现新设备，让清单保持完整。"
                  : "选择办公室的网段，发现设备并开始监测。"}
            </p>
            {scan.status === "running" && (
              <progress value={scan.completed} max={scan.total || 1} />
            )}
            <button onClick={onScan}>
              {scan.status === "running" ? "查看发现进度" : "发现我的设备"}
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>
      {state.collector.error && (
        <div className="inline-note collector-note">
          <CircleAlert size={17} />
          {state.collector.error}
        </div>
      )}
      <section className="panel overview-inventory">
        <div className="panel-heading">
          <div>
            <h2>
              设备清单
              <span className="count-badge">{state.devices.length}</span>
            </h2>
            <p>你的办公网络，一目了然</p>
          </div>
          <button className="text-link" onClick={() => nav("devices")}>
            查看全部
            <ArrowRight size={15} />
          </button>
        </div>
        {state.devices.length ? (
          <DeviceTable
            devices={deviceList}
            limit={5}
            paused={!state.settings.monitoringEnabled}
            onSelect={onSelect}
          />
        ) : (
          <div className="onboarding-row">
            <div className="onboarding-devices">
              <Monitor size={30} strokeWidth={1.2} />
              <Wifi size={20} strokeWidth={1.3} />
              <HardDrive size={23} strokeWidth={1.3} />
            </div>
            <div>
              <h3>这里将是你所有设备的家</h3>
              <p>自动发现局域网设备，或从一个已知的 IP 地址开始。</p>
            </div>
            <button className="button secondary" onClick={onAdd}>
              <Plus size={16} />
              手动添加
            </button>
          </div>
        )}
      </section>
      <section className="panel recent-incidents">
        <div className="panel-heading">
          <div>
            <h2>最近事件</h2>
          </div>
          <button className="text-link" onClick={() => nav("incidents")}>
            全部提醒
            <ArrowRight size={15} />
          </button>
        </div>
        {recentIncidents.length ? (
          <IncidentRows
            incidents={recentIncidents}
            mutate={mutate}
            notify={notify}
            onSelect={onSelect}
            devices={state.devices}
            compact
          />
        ) : (
          <div className="quiet-state">
            <span>
              <ShieldCheck size={20} strokeWidth={1.5} />
            </span>
            <p>
              <strong>此刻，没有待处理的网络事件。</strong>
              <small>当设备状态发生变化，LANtern 会在这里留下记录。</small>
            </p>
            <span className="quiet-flourish">All quiet.</span>
          </div>
        )}
      </section>
    </div>
  );
}
