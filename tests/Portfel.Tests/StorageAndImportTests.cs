using Portfel.Models;
using Portfel.Services;

namespace Portfel.Tests;

public sealed class StorageAndImportTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"portfel-tests-{Guid.NewGuid():N}");

    [Fact]
    public async Task Sqlite_roundtrip_preserves_state()
    {
        var store = new SqliteBudgetStore(_directory);
        var state = BudgetState.CreateEmpty();
        state.Accounts[0].OpeningBalance = 900m;
        state.Transactions.Add(new Transaction
        {
            AccountId = state.Accounts[0].Id,
            Type = TransactionType.Expense,
            Amount = 125.50m,
            Description = "Test"
        });

        await store.SaveAsync(state);
        var loaded = await store.LoadAsync();

        Assert.Single(loaded.Transactions);
        Assert.Equal(125.50m, loaded.Transactions[0].Amount);
        Assert.Equal("Test", loaded.Transactions[0].Description);
    }

    [Fact]
    public async Task Csv_import_keeps_identical_real_transactions_but_gives_stable_fingerprints()
    {
        Directory.CreateDirectory(_directory);
        var path = Path.Combine(_directory, "wyciag.csv");
        await File.WriteAllTextAsync(path,
            "data;opis;kwota\n10.01.2026;Bilet;-4,80\n10.01.2026;Bilet;-4,80\n");

        var rows = await new CsvStatementParser().ParseAsync(path);

        Assert.Equal(2, rows.Count);
        Assert.NotEqual(rows[0].Fingerprint, rows[1].Fingerprint);
        Assert.EndsWith("-1", rows[0].Fingerprint);
        Assert.EndsWith("-2", rows[1].Fingerprint);
    }

    [Fact]
    public async Task Legacy_empty_deadlines_are_migrated()
    {
        Directory.CreateDirectory(_directory);
        var path = Path.Combine(_directory, "legacy.json");
        await File.WriteAllTextAsync(path, """
            {
              "version": 3,
              "goals": [{ "id": "goal_old", "name": "Cel", "target": 1000, "startDate": "2026-01-01", "deadline": "", "cadence": "monthly", "paymentDay": 10 }],
              "debts": [], "recurring": [], "budgets": [], "transactions": [],
              "settings": { "currentYear": 2026, "theme": "light", "categories": ["Inne"] }
            }
            """);

        var state = await new SqliteBudgetStore(_directory).ImportJsonAsync(path);

        Assert.Single(state.Goals);
        Assert.Null(state.Goals[0].Deadline);
        Assert.Single(state.Accounts);
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
    }
}
