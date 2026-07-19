using System.Text.Json.Serialization;

namespace Portfel.Models;

public sealed class BudgetState
{
    public int Version { get; set; } = 5;
    public StateMeta Meta { get; set; } = new();
    public AppSettings Settings { get; set; } = AppSettings.CreateDefault();
    public List<Account> Accounts { get; set; } = [];
    public List<Goal> Goals { get; set; } = [];
    public List<Debt> Debts { get; set; } = [];
    public List<RecurringEntry> Recurring { get; set; } = [];
    public List<CategoryBudget> Budgets { get; set; } = [];
    public List<Transaction> Transactions { get; set; } = [];

    public static BudgetState CreateEmpty()
    {
        var state = new BudgetState();
        state.Accounts.Add(new Account
        {
            Id = Ids.New("acc"),
            Name = "Gotówka",
            Type = AccountType.Cash,
            OpeningBalance = 0m,
            IsActive = true,
            CreatedAt = DateTimeOffset.Now
        });
        return state;
    }
}

public sealed class StateMeta
{
    public DateTimeOffset? SavedAt { get; set; }
    public string AppVersion { get; set; } = "0.2.0-alpha.1";
}

public sealed class AppSettings
{
    public int CurrentYear { get; set; } = DateTime.Today.Year;
    public string Theme { get; set; } = "light";
    public string Currency { get; set; } = "PLN";
    public int PaydayDay { get; set; } = 10;
    public bool BankAccountsEnabled { get; set; }
    public bool StatementImportEnabled { get; set; }
    public bool AlertsEnabled { get; set; } = true;
    public bool InterestEnabled { get; set; } = true;
    public bool SpendingLimitsEnabled { get; set; } = true;
    public bool RecurringEnabled { get; set; } = true;
    public bool EnvelopesEnabled { get; set; } = true;
    public bool ForecastEnabled { get; set; } = true;
    public bool ShowCents { get; set; } = true;
    public int BackupLimit { get; set; } = 30;
    public List<string> Categories { get; set; } = [];

    public static AppSettings CreateDefault() => new()
    {
        Categories =
        [
            "Mieszkanie", "Jedzenie", "Transport", "Zdrowie", "Rachunki",
            "Rozrywka", "Zakupy", "Edukacja", "Inne"
        ]
    };
}

[JsonConverter(typeof(JsonStringEnumConverter<AccountType>))]
public enum AccountType { Cash, Bank }

public sealed class Account
{
    public string Id { get; set; } = Ids.New("acc");
    public string Name { get; set; } = "Konto";
    public AccountType Type { get; set; }
    public decimal OpeningBalance { get; set; }
    public bool IsActive { get; set; } = true;
    public string Color { get; set; } = "#18A999";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
}

public sealed class Goal
{
    public string Id { get; set; } = Ids.New("goal");
    public string Name { get; set; } = "Cel";
    public decimal Target { get; set; }
    public DateOnly StartDate { get; set; } = DateOnly.FromDateTime(DateTime.Today);
    public DateOnly? Deadline { get; set; }
    public ContributionCadence Cadence { get; set; } = ContributionCadence.Monthly;
    public int PaymentDay { get; set; } = 1;
    public string PaydayRecurringId { get; set; } = "";
    public decimal? MaxContribution { get; set; }
    public bool AlertsEnabled { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
}

[JsonConverter(typeof(JsonStringEnumConverter<ContributionCadence>))]
public enum ContributionCadence { Monthly, Weekly, Payday }

public sealed class Debt
{
    public string Id { get; set; } = Ids.New("debt");
    public string Name { get; set; } = "Dług";
    public decimal Total { get; set; }
    public DateOnly? Deadline { get; set; }
    public bool InterestEnabled { get; set; }
    public decimal Apr { get; set; }
    public decimal MinimumPayment { get; set; }
    public int PaymentDay { get; set; } = 1;
    public bool AlertsEnabled { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
}

[JsonConverter(typeof(JsonStringEnumConverter<TransactionType>))]
public enum TransactionType
{
    Income, Expense, GoalContribution, GoalWithdrawal, DebtPayment,
    Transfer, ReserveIn, ReserveOut
}

public sealed class Transaction
{
    public string Id { get; set; } = Ids.New("tx");
    public DateOnly Date { get; set; } = DateOnly.FromDateTime(DateTime.Today);
    public TransactionType Type { get; set; } = TransactionType.Expense;
    public string Category { get; set; } = "Inne";
    public string TargetId { get; set; } = "";
    public string AccountId { get; set; } = "";
    public string ToAccountId { get; set; } = "";
    public string RecurringId { get; set; } = "";
    public DateOnly? ScheduledDate { get; set; }
    public string Description { get; set; } = "";
    public decimal Amount { get; set; }
    public string Note { get; set; } = "";
    public string ImportFingerprint { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
}

[JsonConverter(typeof(JsonStringEnumConverter<RecurringType>))]
public enum RecurringType { Income, Expense }

[JsonConverter(typeof(JsonStringEnumConverter<RecurringCadence>))]
public enum RecurringCadence { Monthly, Weekly }

public sealed class RecurringEntry
{
    public string Id { get; set; } = Ids.New("rec");
    public string Name { get; set; } = "Cykliczny wpis";
    public RecurringType Type { get; set; } = RecurringType.Expense;
    public decimal Amount { get; set; }
    public string Category { get; set; } = "Inne";
    public string AccountId { get; set; } = "";
    public RecurringCadence Cadence { get; set; } = RecurringCadence.Monthly;
    public int Day { get; set; } = 1;
    public DateOnly StartDate { get; set; } = DateOnly.FromDateTime(DateTime.Today);
    public DateOnly? EndDate { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
}

public sealed class CategoryBudget
{
    public string Id { get; set; } = Ids.New("budget");
    public string Category { get; set; } = "Inne";
    public decimal Limit { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
}

public static class Ids
{
    public static string New(string prefix) => $"{prefix}_{Guid.NewGuid():N}";
}
