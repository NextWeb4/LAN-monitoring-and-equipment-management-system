import { useMemo, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { Modal, parsePorts, parseTags } from "./components";
import type { Device } from "./types";
import type { Mutate, Notify } from "./forms";

type ImportDevice = {
  row: number;
  ip: string;
  alias: string;
  type: string;
  group: string;
  tags: string[];
  owner: string;
  location: string;
  ports: number[];
  monitoringEnabled: boolean | null;
  notes: string;
};
type PreviewRow = { device: ImportDevice; errors: string[] };
type ImportResult = {
  received: number;
  accepted: number;
  rejected: number;
  rows: { row: number; ip: string; status: string; message: string }[];
};

const headers: Record<
  | keyof Omit<ImportDevice, "row" | "tags" | "ports" | "monitoringEnabled">
  | "tags"
  | "ports"
  | "monitoringEnabled",
  string[]
> = {
  ip: ["ip", "ip地址", "地址"],
  alias: ["设备名称", "名称", "别名", "alias", "name"],
  type: ["设备类型", "类型", "type"],
  group: ["分组", "group"],
  tags: ["标签", "tags", "tag"],
  owner: ["负责人", "owner"],
  location: ["位置", "所在位置", "location"],
  ports: ["tcp端口", "端口", "ports", "port"],
  monitoringEnabled: [
    "监测启用",
    "启用监测",
    "monitoringenabled",
    "monitoring",
  ],
  notes: ["备注", "notes", "note"],
};

function normalized(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/[\s_\-]/g, "")
    .toLocaleLowerCase("zh-CN");
}
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (quoted) throw new Error("CSV 中有未闭合的双引号，请修正文件后重试。");
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}
function bool(value: string) {
  const normalizedValue = normalized(value);
  if (!normalizedValue) return null;
  if (["是", "true", "1", "启用", "开启", "yes"].includes(normalizedValue))
    return true;
  if (["否", "false", "0", "停用", "关闭", "no"].includes(normalizedValue))
    return false;
  throw new Error("“监测启用”应填写 是/否、启用/停用或 true/false。");
}
function readCsv(text: string): PreviewRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV 至少应包含标题行和一条设备记录。");
  const index = new Map(
    rows[0].map((header, column) => [normalized(header), column]),
  );
  const column = (key: keyof typeof headers) =>
    headers[key]
      .map((name) => index.get(normalized(name)))
      .find((value): value is number => value !== undefined);
  const columns = Object.fromEntries(
    Object.keys(headers).map((key) => [
      key,
      column(key as keyof typeof headers),
    ]),
  ) as Record<keyof typeof headers, number | undefined>;
  if (columns.ip === undefined)
    throw new Error("未找到“IP地址”列。请下载模板后填写，或保留此标题。");
  if (rows.length - 1 > 500)
    throw new Error("单次最多导入 500 行设备，请拆分 CSV 文件。");
  return rows.slice(1).map((values, indexInFile) => {
    const value = (key: keyof typeof headers) =>
      columns[key] === undefined ? "" : values[columns[key]!] || "";
    const device: ImportDevice = {
      row: indexInFile + 2,
      ip: value("ip").trim(),
      alias: value("alias"),
      type: value("type") || "device",
      group: value("group") || "未分组",
      tags: [],
      owner: value("owner"),
      location: value("location"),
      ports: [],
      monitoringEnabled: null,
      notes: value("notes"),
    };
    const errors: string[] = [];
    if (!device.ip) errors.push("缺少 IP 地址");
    else if (
      !/^((10|127|192\.168|172\.(1[6-9]|2\d|3[0-1]))\.)\d{1,3}\.\d{1,3}$/.test(
        device.ip,
      )
    )
      errors.push("IP 格式不属于受支持的本地 IPv4 范围");
    try {
      device.tags = parseTags(value("tags"));
    } catch (error) {
      errors.push((error as Error).message);
    }
    try {
      device.ports = parsePorts(value("ports"));
    } catch (error) {
      errors.push((error as Error).message);
    }
    try {
      device.monitoringEnabled = bool(value("monitoringEnabled"));
    } catch (error) {
      errors.push((error as Error).message);
    }
    if (
      device.alias.length > 80 ||
      device.group.length > 40 ||
      device.owner.length > 60 ||
      device.location.length > 80 ||
      device.notes.length > 1000
    )
      errors.push("有字段超出允许长度，请检查名称、分组、负责人、位置或备注。");
    return { device, errors };
  });
}
function download(
  filename: string,
  content: string,
  type = "text/csv;charset=utf-8",
) {
  const link = document.createElement("a");
  const blob = new Blob([content], { type });
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
export function downloadInventoryTemplate() {
  download(
    "lantern-device-import-template.csv",
    "\uFEFFIP地址,设备名称,设备类型,分组,标签,负责人,位置,TCP端口,监测启用,备注\n192.168.1.50,示例打印机,printer,行政,打印设备;重要,行政部,前台,80,是,导入前请删除这一示例行\n",
  );
}

export function CsvImportDialog({
  mutate,
  notify,
  onClose,
}: {
  mutate: Mutate;
  notify: Notify;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const valid = useMemo(
    () => rows.filter((row) => row.errors.length === 0),
    [rows],
  );
  const invalid = rows.length - valid.length;
  const choose = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      if (file.size > 512 * 1024) throw new Error("CSV 文件不能超过 512 KB。");
      const parsed = readCsv(await file.text());
      setName(file.name);
      setRows(parsed);
    } catch (error) {
      setName("");
      setRows([]);
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!valid.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = (await mutate("/api/devices/import", "POST", {
        rows: valid.map((row) => row.device),
      })) as ImportResult;
      setResult(response);
      notify(
        `导入完成：${response.accepted} 台已加入，${response.rejected} 台未加入。`,
        response.rejected ? "info" : "success",
      );
    } catch (error) {
      setError((error as Error).message);
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="导入设备清单"
      eyebrow="CSV INVENTORY IMPORT"
      onClose={onClose}
      wide
    >
      <div className="csv-import">
        <div className="csv-import-intro">
          <span>
            <FileSpreadsheet size={24} />
          </span>
          <div>
            <strong>使用 CSV 补充已有台账</strong>
            <p>
              会先在浏览器检查列名和格式，再由本机服务验证
              IP、端口、设备上限和重复项。
            </p>
          </div>
          <button
            className="text-link"
            type="button"
            onClick={downloadInventoryTemplate}
          >
            <Download size={15} />
            下载模板
          </button>
        </div>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void choose(event)}
        />
        <button
          type="button"
          className="csv-dropzone"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload size={22} />
          <span>{name ? name : "选择 CSV 文件"}</span>
          <small>支持 UTF-8 CSV，首行需包含 IP地址；单次最多 500 台。</small>
        </button>
        {error && (
          <p className="inline-note error-text" role="alert">
            <CircleAlert size={17} />
            {error}
          </p>
        )}
        {rows.length > 0 && (
          <>
            <div className="csv-summary">
              <span>
                <b>{rows.length}</b> 行读取
              </span>
              <span className="accepted">
                <Check size={14} />
                <b>{valid.length}</b> 行可提交
              </span>
              {invalid > 0 && (
                <span className="rejected">
                  <CircleAlert size={14} />
                  <b>{invalid}</b> 行需修正
                </span>
              )}
            </div>
            <div className="csv-preview">
              <table>
                <thead>
                  <tr>
                    <th>行</th>
                    <th>设备</th>
                    <th>分组 / 标签</th>
                    <th>端口</th>
                    <th>检查结果</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((row) => (
                    <tr key={row.device.row}>
                      <td>{row.device.row}</td>
                      <td>
                        <strong>{row.device.alias || row.device.ip}</strong>
                        <small className="mono">
                          {row.device.ip || "未填写 IP"}
                        </small>
                      </td>
                      <td>
                        {row.device.group}
                        <small>{row.device.tags.join(" · ") || "无标签"}</small>
                      </td>
                      <td className="mono">
                        {row.device.ports.join(", ") || "—"}
                      </td>
                      <td
                        className={
                          row.errors.length ? "error-text" : "accepted"
                        }
                      >
                        {row.errors.length ? row.errors.join("；") : "可导入"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 8 && (
                <p>
                  仅预览前 8 行，其他 {rows.length - 8} 行也会在提交前校验。
                </p>
              )}
            </div>
          </>
        )}
        {result && (
          <div
            className={`import-result ${result.rejected ? "with-rejections" : ""}`}
          >
            <div>
              <Check size={20} />
              <strong>已处理 {result.received} 行设备记录</strong>
              <span>
                {result.accepted} 台已加入，{result.rejected} 台未加入。
              </span>
            </div>
            {result.rejected > 0 && (
              <ul>
                {result.rows
                  .filter((row) => row.status === "rejected")
                  .slice(0, 5)
                  .map((row) => (
                    <li key={`${row.row}-${row.ip}`}>
                      第 {row.row} 行：{row.ip || "未填写 IP"}，{row.message}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
        <div className="form-footer">
          <button type="button" className="button ghost" onClick={onClose}>
            {result ? "完成" : "取消"}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || !valid.length || !!result}
            onClick={() => void submit()}
          >
            {busy ? (
              <LoaderCircle size={16} className="rotating" />
            ) : (
              <Upload size={16} />
            )}
            导入 {valid.length || ""} 台设备
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function BulkDeviceControls({
  devices,
  selectedIds,
  mutate,
  notify,
  onClear,
}: {
  devices: Device[];
  selectedIds: string[];
  mutate: Mutate;
  notify: Notify;
  onClear: () => void;
}) {
  const [groupEnabled, setGroupEnabled] = useState(false);
  const [tagsEnabled, setTagsEnabled] = useState(false);
  const [ownerEnabled, setOwnerEnabled] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [group, setGroup] = useState("");
  const [tags, setTags] = useState("");
  const [owner, setOwner] = useState("");
  const [location, setLocation] = useState("");
  const [monitoring, setMonitoring] = useState("keep");
  const [busy, setBusy] = useState(false);
  const selected = selectedIds
    .map((id) => devices.find((device) => device.id === id))
    .filter((device): device is Device => !!device);
  if (!selected.length) return null;
  const apply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        deviceIds: selected.map((device) => device.id),
      };
      if (groupEnabled) payload.group = group;
      if (tagsEnabled) payload.tags = parseTags(tags);
      if (ownerEnabled) payload.owner = owner;
      if (locationEnabled) payload.location = location;
      if (monitoring !== "keep")
        payload.monitoringEnabled = monitoring === "enable";
      if (Object.keys(payload).length === 1)
        throw new Error("请选择至少一项要批量更新的内容。");
      const result = (await mutate("/api/devices/batch", "PATCH", payload)) as {
        updated: number;
        missingIds: string[];
      };
      notify(
        `已更新 ${result.updated} 台设备${result.missingIds.length ? `，${result.missingIds.length} 台已不存在` : ""}。`,
        result.missingIds.length ? "info" : "success",
      );
      onClear();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bulk-editor" aria-label="批量编辑已选设备">
      <div className="bulk-editor-heading">
        <span>
          <SlidersHorizontal size={18} />
        </span>
        <div>
          <strong>已选择 {selected.length} 台设备</strong>
          <small>仅应用勾选的字段；标签会替换已有标签。</small>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClear}
          aria-label="取消选择"
        >
          <X size={17} />
        </button>
      </div>
      <div className="bulk-fields">
        <label className={`bulk-field ${groupEnabled ? "enabled" : ""}`}>
          <span>
            <input
              type="checkbox"
              checked={groupEnabled}
              onChange={(event) => setGroupEnabled(event.target.checked)}
            />
            更新分组
          </span>
          <input
            disabled={!groupEnabled}
            maxLength={40}
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            placeholder="留空设为未分组"
          />
        </label>
        <label className={`bulk-field ${tagsEnabled ? "enabled" : ""}`}>
          <span>
            <input
              type="checkbox"
              checked={tagsEnabled}
              onChange={(event) => setTagsEnabled(event.target.checked)}
            />
            替换标签
          </span>
          <input
            disabled={!tagsEnabled}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="留空清除标签"
          />
        </label>
        <label className={`bulk-field ${ownerEnabled ? "enabled" : ""}`}>
          <span>
            <input
              type="checkbox"
              checked={ownerEnabled}
              onChange={(event) => setOwnerEnabled(event.target.checked)}
            />
            更新负责人
          </span>
          <input
            disabled={!ownerEnabled}
            maxLength={60}
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            placeholder="留空清除"
          />
        </label>
        <label className={`bulk-field ${locationEnabled ? "enabled" : ""}`}>
          <span>
            <input
              type="checkbox"
              checked={locationEnabled}
              onChange={(event) => setLocationEnabled(event.target.checked)}
            />
            更新位置
          </span>
          <input
            disabled={!locationEnabled}
            maxLength={80}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="留空清除"
          />
        </label>
        <label className="bulk-field enabled">
          <span>监测状态</span>
          <select
            value={monitoring}
            onChange={(event) => setMonitoring(event.target.value)}
          >
            <option value="keep">保持原状</option>
            <option value="enable">启用监测</option>
            <option value="pause">暂停监测</option>
          </select>
        </label>
      </div>
      <div className="bulk-actions">
        <button type="button" className="button ghost" onClick={onClear}>
          取消选择
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => void apply()}
        >
          {busy ? (
            <LoaderCircle size={16} className="rotating" />
          ) : (
            <Check size={16} />
          )}
          应用到 {selected.length} 台
        </button>
      </div>
    </section>
  );
}
