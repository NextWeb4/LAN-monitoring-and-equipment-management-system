export interface Settings {
  siteName: string;
  subnet: string;
  intervalSeconds: number;
  timeoutMs: number;
  pingCount: number;
  defaultPorts: number[];
  failureThreshold: number;
  recoveryThreshold: number;
  latencyThresholdMs: number;
  lossThresholdPercent: number;
  retentionDays: number;
  monitoringEnabled: boolean;
  autoDiscoveryEnabled: boolean;
  discoveryIntervalMinutes: number;
}

export interface PortResult {
  port: number;
  status: string;
  latencyMs: number | null;
  error?: string | null;
}
export interface Probe {
  ip: string;
  timestamp: string;
  sent: number;
  received: number;
  rttSumMs: number;
  latencyMs: number | null;
  lossPercent: number | null;
  reachable: boolean;
  isComplete: boolean;
  error: string | null;
  mac: string | null;
  hostname: string | null;
  evidence: string[];
  ports: PortResult[];
}
export interface Device {
  id: string;
  ip: string;
  mac: string | null;
  hostname: string | null;
  alias: string;
  type: string;
  group: string;
  tags: string[];
  owner: string;
  location: string;
  notes: string;
  subnet: string;
  monitoringEnabled: boolean;
  ports: number[];
  status: "online" | "offline" | "unknown";
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  firstSeen: string;
  lastSeen: string | null;
  lastChecked: string | null;
  lastProbe: Probe | null;
  addressHistory: { ip: string; observedAt: string }[];
}
export interface Incident {
  id: string;
  key: string;
  deviceId: string | null;
  deviceName: string;
  kind: string;
  severity: string;
  message: string;
  status: string;
  acknowledged: boolean;
  openedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}
export interface Adapter {
  id: string;
  name: string;
  ip: string;
  subnet: string;
  gateway: string | null;
  mac: string | null;
}
export interface HistorySample {
  deviceId: string;
  probe: Probe;
}
export interface AppState {
  settings: Settings;
  devices: Device[];
  incidents: Incident[];
  scan: {
    status: string;
    subnet: string;
    total: number;
    completed: number;
    found: number;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  };
  collector: {
    status: string;
    lastCycleAt: string | null;
    error: string | null;
  };
  adapters: Adapter[];
  history: HistorySample[];
  storage: { mode: string; retentionDays: number };
  now: string;
}
export interface DeviceDraft {
  alias: string;
  type: string;
  group: string;
  tags: string;
  owner: string;
  location: string;
  notes: string;
  ports: string;
  monitoringEnabled: boolean;
}
export interface NetworkReportGroup {
  name: string;
  devices: number;
  online: number;
  offline: number;
  unknown: number;
}
export interface NetworkReportRisk {
  deviceId: string;
  name: string;
  ip: string;
  group: string;
  status: string;
  score: number;
  reasons: string[];
  latencyMs: number | null;
  lossPercent: number | null;
  failedPorts: number[];
}
export interface NetworkReportIncident {
  id: string;
  deviceName: string;
  kind: string;
  severity: string;
  message: string;
  acknowledged: boolean;
  openedAt: string;
  updatedAt: string;
}
export interface NetworkReport {
  generatedAt: string;
  requestedHours: number;
  windowStart: string;
  samplesFrom: string | null;
  samplesTo: string | null;
  totalDevices: number;
  monitoredDevices: number;
  pausedDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  unknownDevices: number;
  onlineRate: number | null;
  completeDeviceProbes: number;
  averageLatencyMs: number | null;
  lossPercent: number | null;
  samples: number;
  sentPackets: number;
  receivedPackets: number;
  checkedPorts: number;
  openPorts: number;
  unavailablePorts: number;
  activeIncidents: number;
  unacknowledgedIncidents: number;
  groups: NetworkReportGroup[];
  atRiskDevices: NetworkReportRisk[];
  recommendations: string[];
  recentIncidents: NetworkReportIncident[];
}
export type View =
  | "overview"
  | "devices"
  | "topology"
  | "incidents"
  | "report"
  | "settings";
