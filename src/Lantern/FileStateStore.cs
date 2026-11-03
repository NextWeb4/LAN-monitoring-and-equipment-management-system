using System.Text.Json;

namespace Lantern;

public sealed class FileStateStore
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = false };
    public object Gate { get; } = new();
    public PersistedState State { get; }
    public string DataDirectory { get; }
    public string? StorageError { get; private set; }
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly SemaphoreSlim _historyGate = new(1, 1);
    private readonly Dictionary<string, Queue<HistorySample>> _recent = [];
    private readonly ILogger<FileStateStore> _logger;
    private readonly FileStream _processLock;

    public FileStateStore(ILogger<FileStateStore> logger)
    {
        _logger = logger;
        DataDirectory = Path.GetFullPath(Environment.GetEnvironmentVariable("LAN_DATA_DIR")
            ?? Path.Combine(AppContext.BaseDirectory, "data"));
        Directory.CreateDirectory(DataDirectory);
        _processLock = new FileStream(Path.Combine(DataDirectory, "state.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        Directory.CreateDirectory(Path.Combine(DataDirectory, "history"));
        var file = Path.Combine(DataDirectory, "state.json");
        var backup = file + ".bak";
        State = Load(file) ?? Load(backup) ?? (File.Exists(file) || File.Exists(backup)
            ? throw new InvalidDataException("状态文件与备份均无法读取，请保留 data 目录并修复 JSON。")
            : new PersistedState());
        foreach (var device in State.Devices)
        {
            device.Status = "unknown";
            device.ConsecutiveFailures = device.ConsecutiveSuccesses = 0;
        }
        LoadRecentHistory();
    }

    private PersistedState? Load(string file)
    {
        if (!File.Exists(file)) return null;
        try
        {
            var state = JsonSerializer.Deserialize<PersistedState>(File.ReadAllText(file), Json);
            if (state is null || state.SchemaVersion != 1 || state.Devices is null || state.Settings is null || state.Incidents is null)
                throw new InvalidDataException("不支持的状态文件格式");
            return state;
        }
        catch (Exception ex) when (ex is JsonException or IOException or InvalidDataException)
        {
            _logger.LogWarning(ex, "无法载入 {File}，将尝试备份", file);
            StorageError = "状态文件读取异常，已尝试备份恢复；原始文件仍保留。";
            return null;
        }
    }

    public PersistedState Snapshot()
    {
        lock (Gate) return Clone(State);
    }
    public static T Clone<T>(T value) => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, Json), Json)!;

    public async Task SaveAsync()
    {
        await _writeGate.WaitAsync();
        var target = Path.Combine(DataDirectory, "state.json");
        var temporary = target + ".tmp";
        try
        {
            string json;
            lock (Gate) json = JsonSerializer.Serialize(State, new JsonSerializerOptions(Json) { WriteIndented = true });
            await using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            await using (var writer = new StreamWriter(stream))
            {
                await writer.WriteAsync(json);
                await writer.FlushAsync();
                stream.Flush(true);
            }
            if (File.Exists(target)) File.Replace(temporary, target, target + ".bak", true);
            else File.Move(temporary, target);
        }
        catch (Exception ex)
        {
            StorageError = "文件写入失败，请检查磁盘空间和 data 目录权限。";
            _logger.LogError(ex, "状态文件写入失败");
            throw;
        }
        finally { _writeGate.Release(); }
    }

    public List<HistorySample> History(string id)
    {
        lock (Gate) return _recent.TryGetValue(id, out var samples) ? samples.Select(Clone).ToList() : [];
    }
    public List<HistorySample> LatestHistory()
    {
        lock (Gate) return _recent.Values.SelectMany(x => x).OrderByDescending(x => x.Probe.Timestamp).Take(120).OrderBy(x => x.Probe.Timestamp).Select(Clone).ToList();
    }
    public void ForgetHistory(string id) { lock (Gate) _recent.Remove(id); }
    private void Remember(HistorySample sample)
    {
        if (!_recent.TryGetValue(sample.DeviceId, out var queue)) _recent[sample.DeviceId] = queue = new();
        queue.Enqueue(sample);
        while (queue.Count > 240) queue.Dequeue();
    }

    public async Task AppendHistoryAsync(IReadOnlyList<HistorySample> samples)
    {
        if (samples.Count == 0) return;
        lock (Gate) foreach (var sample in samples) Remember(Clone(sample));
        await _historyGate.WaitAsync();
        try
        {
            var directory = Path.Combine(DataDirectory, "history");
            if (new DirectoryInfo(directory).EnumerateFiles("*.jsonl").Sum(x => x.Length) >= 512L * 1024 * 1024)
            {
                StorageError = "历史文件已达 512 MB 上限，本轮只保留当前状态与内存历史；请缩短保留天数或减少采集频率。";
                return;
            }
            var day = DateTime.UtcNow.ToString("yyyy-MM-dd");
            var file = Path.Combine(directory, day + ".jsonl");
            for (var part = 1; File.Exists(file) && new FileInfo(file).Length > 32L * 1024 * 1024; part++)
                file = Path.Combine(directory, $"{day}-{part:D3}.jsonl");
            await using var writer = new StreamWriter(file, append: true);
            foreach (var sample in samples) await writer.WriteLineAsync(JsonSerializer.Serialize(sample, Json));
        }
        catch (Exception ex)
        {
            StorageError = "监控历史写入失败，请检查磁盘空间。";
            _logger.LogError(ex, "监控历史写入失败");
            throw;
        }
        finally { _historyGate.Release(); }
    }

    private void LoadRecentHistory()
    {
        // Startup work is bounded; historical files remain available for export on disk.
        var ids = State.Devices.Select(x => x.Id).ToHashSet();
        var files = Directory.GetFiles(Path.Combine(DataDirectory, "history"), "*.jsonl")
            .OrderByDescending(path =>
            {
                var name = Path.GetFileNameWithoutExtension(path);
                return name.Length == 10 ? name + "-000" : name;
            }).Take(4).Reverse();
        foreach (var file in files)
        {
            try
            {
                using var stream = File.OpenRead(file);
                const long maximumBytes = 4 * 1024 * 1024;
                if (stream.Length > maximumBytes) stream.Seek(-maximumBytes, SeekOrigin.End);
                using var reader = new StreamReader(stream);
                if (stream.Position > 0) reader.ReadLine();
                while (reader.ReadLine() is { } line)
                {
                    try
                    {
                        var sample = JsonSerializer.Deserialize<HistorySample>(line, Json);
                        if (sample is not null && ids.Contains(sample.DeviceId)) Remember(sample);
                    }
                    catch (JsonException) { /* A partial last line after power loss does not invalidate earlier samples. */ }
                }
            }
            catch (IOException ex) { _logger.LogWarning(ex, "历史文件暂不可读取 {File}", file); }
        }
    }

    public async Task PruneAsync()
    {
        await _historyGate.WaitAsync();
        try
        {
            int days;
            lock (Gate) days = State.Settings.RetentionDays;
            var cutoff = DateTime.UtcNow.Date.AddDays(-Math.Clamp(days, 1, 30) + 1);
            var directory = Path.GetFullPath(Path.Combine(DataDirectory, "history"));
            var files = new DirectoryInfo(directory).GetFiles("*.jsonl").OrderBy(x => x.Name).ToList();
            long total = files.Sum(x => x.Length);
            const long maximumTotalBytes = 512L * 1024 * 1024;
            foreach (var file in files)
            {
                if (!file.FullName.StartsWith(directory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
                if (file.Name.Length < 10 || !DateTime.TryParseExact(file.Name[..10], "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var date)) continue;
                if (date < cutoff || (total > maximumTotalBytes && date < DateTime.UtcNow.Date))
                {
                    var length = file.Length;
                    file.Delete();
                    total -= length;
                }
            }
            if (total > maximumTotalBytes) StorageError = "今日历史数据已超过 512 MB，请减少监测项或延长采集周期。";
        }
        finally { _historyGate.Release(); }
    }
}
