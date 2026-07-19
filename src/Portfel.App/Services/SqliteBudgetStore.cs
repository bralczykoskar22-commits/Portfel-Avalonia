using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.Data.Sqlite;
using Portfel.Models;

namespace Portfel.Services;

public sealed class SqliteBudgetStore : IBudgetStore
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    public SqliteBudgetStore(string? dataDirectory = null)
    {
        DataDirectory = dataDirectory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Portfel");
        DatabasePath = Path.Combine(DataDirectory, "data", "portfel.sqlite");
    }

    public string DataDirectory { get; }
    public string DatabasePath { get; }
    private string BackupDirectory => Path.Combine(DataDirectory, "backups");

    public async Task<BudgetState> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await EnsureDatabaseAsync(cancellationToken);
            await using var connection = CreateConnection();
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT payload FROM app_state WHERE id = 1";
            var payload = await command.ExecuteScalarAsync(cancellationToken) as string;
            if (string.IsNullOrWhiteSpace(payload)) return BudgetState.CreateEmpty();
            return DeserializeAndMigrate(payload);
        }
        catch (Exception ex) when (ex is JsonException or SqliteException or InvalidOperationException)
        {
            await QuarantineBrokenDatabaseAsync();
            return BudgetState.CreateEmpty();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task SaveAsync(BudgetState state, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await EnsureDatabaseAsync(cancellationToken);
            state.Version = 5;
            state.Meta.AppVersion = "0.2.0-alpha.1";
            state.Meta.SavedAt = DateTimeOffset.Now;
            var payload = JsonSerializer.Serialize(state, _json);

            await using var connection = CreateConnection();
            await connection.OpenAsync(cancellationToken);
            var current = await ReadPayloadAsync(connection, cancellationToken);
            if (!string.IsNullOrWhiteSpace(current) && !string.Equals(current, payload, StringComparison.Ordinal))
                await CreateBackupAsync(current, state.Settings.BackupLimit, cancellationToken);

            await using var transaction = connection.BeginTransaction();
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO app_state(id, schema_version, payload, updated_at)
                VALUES(1, $version, $payload, $updated)
                ON CONFLICT(id) DO UPDATE SET
                    schema_version = excluded.schema_version,
                    payload = excluded.payload,
                    updated_at = excluded.updated_at;
                """;
            command.Parameters.AddWithValue("$version", state.Version);
            command.Parameters.AddWithValue("$payload", payload);
            command.Parameters.AddWithValue("$updated", state.Meta.SavedAt.Value.ToString("O"));
            await command.ExecuteNonQueryAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task ExportJsonAsync(BudgetState state, string path, CancellationToken cancellationToken = default)
    {
        var json = JsonSerializer.Serialize(state, _json);
        await AtomicWriteAsync(path, json, cancellationToken);
    }

    public async Task<BudgetState> ImportJsonAsync(string path, CancellationToken cancellationToken = default)
    {
        var json = await File.ReadAllTextAsync(path, cancellationToken);
        return DeserializeAndMigrate(json);
    }

    public IReadOnlyList<BackupInfo> GetBackups()
    {
        if (!Directory.Exists(BackupDirectory)) return [];
        return Directory.EnumerateFiles(BackupDirectory, "portfel-*.json")
            .Select(path => new FileInfo(path))
            .OrderByDescending(info => info.LastWriteTimeUtc)
            .Select(info => new BackupInfo(info.FullName, info.LastWriteTime, info.Length))
            .ToList();
    }

    public async Task<BudgetState> RestoreBackupAsync(string path, CancellationToken cancellationToken = default)
    {
        var fullPath = Path.GetFullPath(path);
        var backups = Path.GetFullPath(BackupDirectory) + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(backups, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Wybrany plik nie jest kopią programu Portfel.");
        return await ImportJsonAsync(fullPath, cancellationToken);
    }

    private SqliteConnection CreateConnection() => new($"Data Source={DatabasePath};Mode=ReadWriteCreate;Cache=Shared");

    private async Task EnsureDatabaseAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(DatabasePath)!);
        Directory.CreateDirectory(BackupDirectory);
        await using var connection = CreateConnection();
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS app_state(
                id INTEGER PRIMARY KEY CHECK(id = 1),
                schema_version INTEGER NOT NULL,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<string?> ReadPayloadAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT payload FROM app_state WHERE id = 1";
        return await command.ExecuteScalarAsync(cancellationToken) as string;
    }

    private async Task CreateBackupAsync(string payload, int requestedLimit, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(BackupDirectory);
        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff");
        var path = Path.Combine(BackupDirectory, $"portfel-{stamp}.json");
        await AtomicWriteAsync(path, payload, cancellationToken);

        var limit = Math.Clamp(requestedLimit, 3, 100);
        foreach (var old in Directory.EnumerateFiles(BackupDirectory, "portfel-*.json")
                     .Select(file => new FileInfo(file))
                     .OrderByDescending(file => file.LastWriteTimeUtc)
                     .Skip(limit))
        {
            old.Delete();
        }
    }

    private static async Task AtomicWriteAsync(string path, string contents, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        var temp = path + ".tmp";
        await File.WriteAllTextAsync(temp, contents, cancellationToken);
        File.Move(temp, path, true);
    }

    private BudgetState DeserializeAndMigrate(string payload)
    {
        var root = JsonNode.Parse(payload) as JsonObject
                   ?? throw new JsonException("Nieprawidłowy plik danych.");
        MigrateLegacyNames(root);
        var state = root.Deserialize<BudgetState>(_json) ?? BudgetState.CreateEmpty();
        Normalize(state);
        return state;
    }

    private static void MigrateLegacyNames(JsonObject root)
    {
        NullEmptyDates(root["goals"] as JsonArray, "deadline");
        NullEmptyDates(root["debts"] as JsonArray, "deadline");
        NullEmptyDates(root["recurring"] as JsonArray, "endDate");
        NullEmptyDates(root["transactions"] as JsonArray, "scheduledDate");

        if (root["recurring"] is JsonArray recurring)
        {
            foreach (var node in recurring.OfType<JsonObject>())
                if (node["isActive"] is null && node["active"] is not null)
                    node["isActive"] = node["active"]!.GetValue<bool>();
        }
        if (root["accounts"] is JsonArray accounts)
        {
            foreach (var node in accounts.OfType<JsonObject>())
                if (node["isActive"] is null && node["active"] is not null)
                    node["isActive"] = node["active"]!.GetValue<bool>();
        }
        if (root["transactions"] is JsonArray transactions)
        {
            foreach (var node in transactions.OfType<JsonObject>())
            {
                var type = node["type"]?.GetValue<string>()?.ToLowerInvariant();
                node["type"] = type switch
                {
                    "income" => nameof(TransactionType.Income),
                    "expense" => nameof(TransactionType.Expense),
                    "goal" => nameof(TransactionType.GoalContribution),
                    "goal_withdraw" => nameof(TransactionType.GoalWithdrawal),
                    "debt" => nameof(TransactionType.DebtPayment),
                    "transfer" => nameof(TransactionType.Transfer),
                    "reserve_in" => nameof(TransactionType.ReserveIn),
                    "reserve_out" => nameof(TransactionType.ReserveOut),
                    _ => node["type"]?.GetValue<string>()
                };
            }
        }
    }

    private static void NullEmptyDates(JsonArray? array, string property)
    {
        if (array is null) return;
        foreach (var node in array.OfType<JsonObject>())
            if (node[property] is JsonValue value && value.TryGetValue<string>(out var text) && string.IsNullOrWhiteSpace(text))
                node[property] = null;
    }

    private static void Normalize(BudgetState state)
    {
        state.Version = 5;
        state.Meta ??= new StateMeta();
        state.Settings ??= AppSettings.CreateDefault();
        state.Settings.Categories = state.Settings.Categories
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.CurrentCultureIgnoreCase)
            .ToList();
        if (state.Settings.Categories.Count == 0)
            state.Settings.Categories = AppSettings.CreateDefault().Categories;

        state.Accounts ??= [];
        if (state.Accounts.Count == 0)
            state.Accounts.Add(BudgetState.CreateEmpty().Accounts[0]);
        var cashId = state.Accounts.FirstOrDefault(account => account.Type == AccountType.Cash)?.Id
                     ?? state.Accounts[0].Id;

        state.Goals ??= [];
        state.Debts ??= [];
        state.Recurring ??= [];
        state.Budgets ??= [];
        state.Transactions ??= [];
        foreach (var transaction in state.Transactions)
        {
            if (string.IsNullOrWhiteSpace(transaction.AccountId)) transaction.AccountId = cashId;
            transaction.Amount = Math.Max(0m, transaction.Amount);
        }
        foreach (var goal in state.Goals) goal.Target = Math.Max(0m, goal.Target);
        foreach (var debt in state.Debts)
        {
            debt.Total = Math.Max(0m, debt.Total);
            debt.Apr = Math.Max(0m, debt.Apr);
            debt.MinimumPayment = Math.Max(0m, debt.MinimumPayment);
        }
    }

    private async Task QuarantineBrokenDatabaseAsync()
    {
        try
        {
            if (!File.Exists(DatabasePath)) return;
            Directory.CreateDirectory(BackupDirectory);
            var destination = Path.Combine(BackupDirectory, $"uszkodzona-baza-{DateTime.Now:yyyyMMdd-HHmmss}.sqlite");
            await Task.Run(() => File.Copy(DatabasePath, destination, false));
        }
        catch
        {
            // Oryginał pozostaje nienaruszony, jeśli kopia diagnostyczna się nie powiedzie.
        }
    }
}
