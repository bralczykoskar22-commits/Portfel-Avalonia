using Portfel.Models;

namespace Portfel.ViewModels;

public sealed record ChoiceItem(string Key, string Label)
{
    public override string ToString() => Label;
}

public sealed record MonthChoice(int Number, string Label)
{
    public override string ToString() => Label;
}

public sealed record TransactionRow(
    string Id, string Date, string Title, string Subtitle, string Amount, string AmountClass,
    string TypeLabel, string AccountLabel, bool IsPositive, bool IsNegative);

public sealed record GoalCard(
    string Id, string Name, string Target, string Saved, string Remaining, string Recommended,
    string RecommendationLabel, string Deadline, string Status, string StatusClass, double Percent,
    bool IsComplete, bool IsOverdue);

public sealed record DebtCard(
    string Id, string Name, string Total, string Paid, string Remaining, string Recommended,
    string Interest, string Deadline, string Status, string StatusClass, double Percent, bool IsComplete, bool IsOverdue);

public sealed record AccountCard(
    string Id, string Name, string Type, string Balance, string Color, bool IsActive, bool CanDelete);

public sealed record RecurringCard(
    string Id, string Name, string Details, string Amount, string AmountClass, string Status);

public sealed record BudgetCard(
    string Id, string Category, string Limit, string Spent, string Remaining, double Percent, string StatusClass);

public sealed record AlertCard(string Icon, string Title, string Message, string ClassName, string Page);

public sealed record MonthBar(string Month, double IncomeHeight, double OutflowHeight, string Income, string Outflow);

public sealed record CategorySlice(string Category, string Amount, double Percent, string Color);

public sealed class StatementPreviewRow : ViewModelBase
{
    private bool _isSelected = true;
    private string _category;

    public StatementPreviewRow(DateOnly date, string description, decimal signedAmount, string fingerprint, string category)
    {
        Date = date;
        Description = description;
        SignedAmount = signedAmount;
        Fingerprint = fingerprint;
        _category = category;
    }

    public DateOnly Date { get; }
    public string DateLabel => Date.ToString("dd.MM.yyyy");
    public string Description { get; }
    public decimal SignedAmount { get; }
    public string AmountLabel => $"{(SignedAmount >= 0 ? "+" : "−")}{Math.Abs(SignedAmount):N2} zł";
    public string AmountClass => SignedAmount >= 0 ? "positive" : "negative";
    public string Fingerprint { get; }
    public bool IsIncome => SignedAmount > 0;
    public bool IsExpense => SignedAmount < 0;

    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    public string Category
    {
        get => _category;
        set => SetProperty(ref _category, value);
    }
}

public abstract class PageViewModel(MainViewModel shell, string key, string eyebrow, string title)
{
    public MainViewModel Shell { get; } = shell;
    public string Key { get; } = key;
    public string Eyebrow { get; } = eyebrow;
    public string Title { get; } = title;
}

public sealed class DashboardPageViewModel(MainViewModel shell)
    : PageViewModel(shell, "dashboard", "PULPIT", "Twoje finanse w jednym miejscu");
public sealed class MonthsPageViewModel(MainViewModel shell)
    : PageViewModel(shell, "months", "MIESIĄCE", "Operacje i budżet miesiąca");
public sealed class GoalsPageViewModel(MainViewModel shell)
    : PageViewModel(shell, "goals", "OSZCZĘDZANIE", "Cele finansowe");
public sealed class DebtsPageViewModel(MainViewModel shell)
    : PageViewModel(shell, "debts", "SPŁACANIE", "Długi i raty");
public sealed class PlanPageViewModel(MainViewModel shell)
    : PageViewModel(shell, "plan", "AUTOMATYZACJA", "Plan i limity");
public sealed class AnalyticsPageViewModel(MainViewModel shell)
    : PageViewModel(shell, "analytics", "PODSUMOWANIE", "Analiza roku");
public sealed class AccountsPageViewModel(MainViewModel shell)
    : PageViewModel(shell, "accounts", "GOTÓWKA I BANK", "Konta i wyciągi");
public sealed class SettingsPageViewModel(MainViewModel shell)
    : PageViewModel(shell, "settings", "PROGRAM", "Ustawienia i dane");
