import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  FileJson2,
  FileSpreadsheet,
  Gauge,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TimerReset,
  Wifi,
} from "lucide-react";
import { EmptyState, number, timeOf } from "./components";
import type { NetworkReport } from "./types";

type RequestState = {
  report: NetworkReport | null;
  error: string;
  loading: boolean;
};
const intervals = [
  { value: 1, label: "近 1 小时" },
  { value: 24, label: "近 24 小时" },
  { value: 168, label: "近 7 天" },
  { value: 720, label: "近 30 天" },
];

function csvValue(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return text.includes(",") || text.includes('"') || text.includes("\n")
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}
function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportReportCsv(report: NetworkReport) {
  const summary = [
    ["报告生成时间", new Date(report.generatedAt).toLocaleString("zh-CN")],
    ["报告窗口", `近 ${report.requestedHours} 小时`],
    ["设备总数", report.totalDevices],
    ["正在监测", report.monitoredDevices],
    ["当前在线", report.onlineDevices],
    ["当前离线", report.offlineDevices],
    ["待确认", report.unknownDevices],
    [
      "在线率",
      report.onlineRate == null ? "—" : `${number(report.onlineRate)}%`,
    ],
    [
      "平均延迟",
      report.averageLatencyMs == null
        ? "—"
        : `${number(report.averageLatencyMs)} ms`,
    ],
    [
      "丢包率",
      report.lossPercent == null ? "—" : `${number(report.lossPercent)}%`,
    ],
    ["完整采样", report.samples],
    ["TCP 检查", report.checkedPorts],
    ["端口异常", report.unavailablePorts],
    ["活动告警", report.activeIncidents],
  ];
  const risk = [
    [
      "风险设备",
      "IP 地址",
      "分组",
      "状态",
      "风险原因",
      "延迟(ms)",
      "丢包(%)",
      "异常端口",
    ],
    ...report.atRiskDevices.map((item) => [
      item.name,
      item.ip,
      item.group,
      item.status,
      item.reasons.join("；"),
      number(item.latencyMs),
      number(item.lossPercent),
      item.failedPorts.join(", "),
    ]),
  ];
  const groups = [
    ["设备分组", "设备数", "在线", "离线", "待确认"],
    ...report.groups.map((group) => [
      group.name,
      group.devices,
      group.online,
      group.offline,
      group.unknown,
    ]),
  ];
  const text = [
    summary.map((row) => row.map(csvValue).join(",")).join("\n"),
    "",
    risk.map((row) => row.map(csvValue).join(",")).join("\n"),
    "",
    groups.map((row) => row.map(csvValue).join(",")).join("\n"),
  ].join("\n");
  download(
    `lantern-network-report-${new Date().toISOString().slice(0, 10)}.csv`,
    `\uFEFF${text}`,
    "text/csv;charset=utf-8",
  );
}
function statusText(status: string) {
  return (
    (
      { online: "在线", offline: "离线", unknown: "待确认" } as Record<
        string,
        string
      >
    )[status] || status
  );
}
function statusClass(status: string) {
  return ["offline", "unknown"].includes(status) ? status : "online";
}

export function ReportPage({ onSelect }: { onSelect: (id: string) => void }) {
  const [hours, setHours] = useState(24);
  const [state, setState] = useState<RequestState>({
    report: null,
    error: "",
    loading: true,
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: "" }));
    const load = async () => {
      try {
        const response = await fetch(`/api/report?hours=${hours}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const text = await response.text();
        let payload: unknown;
        try {
          payload = text ? JSON.parse(text) : undefined;
        } catch {
          throw new Error("报告服务返回了无法读取的数据。");
        }
        if (!response.ok)
          throw new Error(
            (payload as { error?: string })?.error || "报告暂时无法生成。",
          );
        setState({
          report: payload as NetworkReport,
          error: "",
          loading: false,
        });
      } catch (error) {
        if (!controller.signal.aborted)
          setState((current) => ({
            ...current,
            error: (error as Error).message || "报告暂时无法生成。",
            loading: false,
          }));
      }
    };
    void load();
    return () => controller.abort();
  }, [hours, revision]);
  const report = state.report;
  const coverage = useMemo(
    () =>
      report && report.monitoredDevices
        ? Math.round(
            (report.completeDeviceProbes / report.monitoredDevices) * 100,
          )
        : null,
    [report],
  );
  if (state.loading && !report)
    return (
      <section className="panel report-loading">
        <LoaderCircle size={28} className="rotating" />
        <strong>正在整理网络运行报告</strong>
        <span>汇总已保存的采样、端口检查和事件记录…</span>
      </section>
    );
  if (!report)
    return (
      <section className="panel">
        <EmptyState
          title="暂时无法生成报告"
          text={state.error || "报告服务暂时不可用。"}
          icon="clock"
        >
          <button
            className="button primary"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={16} />
            重新生成
          </button>
        </EmptyState>
      </section>
    );
  const noData = report.monitoredDevices === 0 || report.samples === 0;
  return (
    <div className="report-page">
      <section className="report-hero panel">
        <div className="report-hero-copy">
          <div className="eyebrow">NETWORK OPERATING REPORT</div>
          <h2>运行报告</h2>
          <p>
            基于本机保存的监测采样、端口检查和异常事件生成。数据窗口：
            {report.samplesFrom
              ? `${timeOf(report.samplesFrom, true)} 至 ${timeOf(report.samplesTo, true)}`
              : "当前还没有完整采样"}
            。
          </p>
        </div>
        <div className="report-controls">
          <label>
            <span>统计范围</span>
            <select
              value={hours}
              onChange={(event) => setHours(+event.target.value)}
            >
              {intervals.map((interval) => (
                <option key={interval.value} value={interval.value}>
                  {interval.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="icon-button"
            onClick={() => setRevision((value) => value + 1)}
            disabled={state.loading}
            aria-label="刷新报告"
          >
            {state.loading ? (
              <LoaderCircle size={18} className="rotating" />
            ) : (
              <RefreshCw size={18} />
            )}
          </button>
          <div className="report-export">
            <button
              type="button"
              className="button secondary compact"
              onClick={() => exportReportCsv(report)}
            >
              <FileSpreadsheet size={16} />
              导出 CSV
            </button>
            <button
              type="button"
              className="button ghost compact"
              onClick={() =>
                download(
                  `lantern-network-report-${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify(report, null, 2),
                  "application/json",
                )
              }
            >
              <FileJson2 size={16} />
              JSON
            </button>
          </div>
        </div>
      </section>
      {state.error && (
        <p className="inline-note error-text report-error" role="alert">
          <CircleAlert size={16} />
          {state.error}，当前显示上一次已生成的报告。
        </p>
      )}
      <section className="report-metrics" aria-label="报告摘要">
        <Metric
          icon={<Wifi size={19} />}
          label="当前在线率"
          value={
            report.onlineRate == null ? "—" : `${number(report.onlineRate)}%`
          }
          detail={`${report.onlineDevices} / ${report.monitoredDevices} 台监测设备在线`}
          tone={report.offlineDevices ? "warning" : "good"}
        />
        <Metric
          icon={<Activity size={19} />}
          label="平均响应延迟"
          value={
            report.averageLatencyMs == null
              ? "—"
              : `${number(report.averageLatencyMs)} ms`
          }
          detail={
            report.samples ? `${report.samples} 条完整采样` : "等待完整采样"
          }
        />
        <Metric
          icon={<Gauge size={19} />}
          label="窗口丢包率"
          value={
            report.lossPercent == null ? "—" : `${number(report.lossPercent)}%`
          }
          detail={
            report.sentPackets
              ? `${report.receivedPackets} / ${report.sentPackets} 个响应包`
              : "等待有效 Ping 数据"
          }
          tone={
            report.lossPercent && report.lossPercent > 0 ? "warning" : undefined
          }
        />
        <Metric
          icon={<AlertTriangle size={19} />}
          label="活动告警"
          value={`${report.activeIncidents}`}
          detail={`${report.unacknowledgedIncidents} 项尚未确认 · ${report.unavailablePorts} 个端口异常`}
          tone={report.activeIncidents ? "warning" : "good"}
        />
      </section>
      {noData ? (
        <section className="panel report-empty">
          <EmptyState
            title={
              report.monitoredDevices ? "等待完成一次监测" : "先建立设备清单"
            }
            text={
              report.monitoredDevices
                ? "报告已准备就绪。执行一次监测并等待采样写入后，会在此呈现延迟、丢包和风险汇总。"
                : "可通过发现、手动添加或 CSV 导入加入设备；启用监测后报告会自动累积。"
            }
            icon="clock"
          />
        </section>
      ) : (
        <>
          <section className="report-grid">
            <section className="panel report-section">
              <div className="report-section-heading">
                <div>
                  <span className="section-marker">
                    <ShieldCheck size={17} />
                  </span>
                  <div>
                    <h3>监测覆盖</h3>
                    <p>查看当前设备状态与本次报告的数据基础。</p>
                  </div>
                </div>
                <span className="report-time">
                  <TimerReset size={14} />
                  生成于 {timeOf(report.generatedAt, true)}
                </span>
              </div>
              <div className="coverage-bar">
                <div>
                  <strong>{coverage == null ? "—" : `${coverage}%`}</strong>
                  <span>设备已有完整采样</span>
                </div>
                <div className="coverage-track">
                  <i style={{ width: `${coverage ?? 0}%` }} />
                </div>
              </div>
              <dl className="report-facts">
                <div>
                  <dt>设备总数</dt>
                  <dd>{report.totalDevices} 台</dd>
                </div>
                <div>
                  <dt>暂停监测</dt>
                  <dd>{report.pausedDevices} 台</dd>
                </div>
                <div>
                  <dt>端口检查</dt>
                  <dd>{report.checkedPorts} 项</dd>
                </div>
                <div>
                  <dt>开放端口</dt>
                  <dd>{report.openPorts} 项</dd>
                </div>
              </dl>
              <div className="group-health">
                {report.groups.length ? (
                  report.groups.map((group) => (
                    <div key={group.name}>
                      <div>
                        <strong>{group.name}</strong>
                        <span>{group.devices} 台</span>
                      </div>
                      <div className="group-bars">
                        <i
                          className="online"
                          style={{ flex: group.online || 0 }}
                        />
                        <i
                          className="offline"
                          style={{ flex: group.offline || 0 }}
                        />
                        <i
                          className="unknown"
                          style={{ flex: group.unknown || 0 }}
                        />
                      </div>
                      <small>
                        {group.online} 在线 · {group.offline} 离线 ·{" "}
                        {group.unknown} 待确认
                      </small>
                    </div>
                  ))
                ) : (
                  <p className="subdued">暂无设备分组数据。</p>
                )}
              </div>
            </section>
            <section className="panel report-section recommendations">
              <div className="report-section-heading">
                <div>
                  <span className="section-marker amber">
                    <CheckCircle2 size={17} />
                  </span>
                  <div>
                    <h3>处理建议</h3>
                    <p>根据当前数据状态给出的下一步检查项。</p>
                  </div>
                </div>
              </div>
              <ol>
                {report.recommendations.map((recommendation, index) => (
                  <li key={recommendation}>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span>{recommendation}</span>
                  </li>
                ))}
              </ol>
            </section>
          </section>
          <section className="panel report-section risk-section">
            <div className="report-section-heading">
              <div>
                <span className="section-marker danger">
                  <AlertTriangle size={17} />
                </span>
                <div>
                  <h3>需要关注的设备</h3>
                  <p>
                    按当前离线状态、最近延迟、丢包和已配置端口的探测结果排序。
                  </p>
                </div>
              </div>
              <span className="subdued">{report.atRiskDevices.length} 台</span>
            </div>
            {report.atRiskDevices.length ? (
              <div className="risk-table">
                <table>
                  <thead>
                    <tr>
                      <th>设备</th>
                      <th>状态</th>
                      <th>风险原因</th>
                      <th>最近指标</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {report.atRiskDevices.map((item) => (
                      <tr key={item.deviceId}>
                        <td>
                          <strong>{item.name}</strong>
                          <small className="mono">
                            {item.ip} · {item.group}
                          </small>
                        </td>
                        <td>
                          <span
                            className={`report-status ${statusClass(item.status)}`}
                          >
                            {statusText(item.status)}
                          </span>
                        </td>
                        <td>
                          <span className="risk-reasons">
                            {item.reasons.map((reason) => (
                              <i key={reason}>{reason}</i>
                            ))}
                          </span>
                        </td>
                        <td>
                          <span className="tabular">
                            {number(item.latencyMs)} ms
                          </span>
                          <small>
                            {number(item.lossPercent)}% 丢包
                            {item.failedPorts.length
                              ? ` · TCP ${item.failedPorts.join(", ")}`
                              : ""}
                          </small>
                        </td>
                        <td>
                          <button
                            className="text-link"
                            onClick={() => onSelect(item.deviceId)}
                          >
                            查看
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="report-ok">
                <CheckCircle2 size={22} />
                <div>
                  <strong>当前没有被标记为风险的设备</strong>
                  <span>报告仍会持续依据新的采样结果更新。</span>
                </div>
              </div>
            )}
          </section>
          <section className="panel report-section incidents-section">
            <div className="report-section-heading">
              <div>
                <span className="section-marker">
                  <CircleAlert size={17} />
                </span>
                <div>
                  <h3>近期活动告警</h3>
                  <p>仅展示尚未恢复的异常事件，完整记录在“异常提醒”中。</p>
                </div>
              </div>
              <span className="subdued">
                {report.recentIncidents.length} 项
              </span>
            </div>
            {report.recentIncidents.length ? (
              <div className="report-incidents">
                {report.recentIncidents.map((incident) => (
                  <div key={incident.id}>
                    <i className={incident.severity} />
                    <div>
                      <strong>{incident.message}</strong>
                      <small>
                        {incident.deviceName || "网络监测"} ·{" "}
                        {timeOf(incident.updatedAt, true)}
                      </small>
                    </div>
                    <span>{incident.acknowledged ? "已确认" : "待确认"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="report-ok">
                <CheckCircle2 size={22} />
                <div>
                  <strong>当前没有活动告警</strong>
                  <span>设备异常时会自动写入事件并出现在这里。</span>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: "good" | "warning";
}) {
  return (
    <article className={`report-metric ${tone || ""}`}>
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
