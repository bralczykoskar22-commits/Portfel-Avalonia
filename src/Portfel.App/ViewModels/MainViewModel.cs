using System.Globalization;
using System.Windows.Input;
using Portfel.Models;
using Portfel.Services;

namespace Portfel.ViewModels;

public sealed class MainViewModel : ViewModelBase
{
    private static readonly CultureInfo Polish = CultureInfo.GetCultureInfo("pl-PL");
    private static readonly string[] Palette = ["#18A999", "#2D8CFF", "#F4A261", "#8B5CF6", "#E76F51", "#4FAE69", "#64748B"];
    private readonly IBudgetStore _store;
    private readonly BudgetCalculator _calculator;
    private readonly CsvStatementParser _csv;
    private readonly IPlatformService _platform;
    private BudgetState _state;
    private PageViewModel _currentPage;
    private int _selectedYear;
    private int _selectedMonth;
    private bool _isDirty;
    private bool _isSaving;
    private string _toast = "";
    private ChoiceItem? _statementAccount;
    private IReadOnlyList<StatementPreviewRow> _statementRows = [];
    private Action? _confirmAction;
    private BudgetState? _pendingImport;

    public MainViewModel(BudgetState state, IBudgetStore store, BudgetCalculator calculator,
        CsvStatementParser csv, IPlatformService platform)
    {
        _state = state;
        _store = store;
        _calculator = calculator;
        _csv = csv;
        _platform = platform;
        _selectedYear = state.Settings.CurrentYear;
        _selectedMonth = _selectedYear == DateTime.Today.Year ? DateTime.Today.Month : 1;

        Pages =
        [
            new DashboardPageViewModel(this), new MonthsPageViewModel(this), new GoalsPageViewModel(this),
            new DebtsPageViewModel(this), new PlanPageViewModel(this), new AnalyticsPageViewModel(this),
            new AccountsPageViewModel(this), new SettingsPageViewModel(this)
        ];
        _currentPage = Pages[0];
        Editor = new EditorViewModel();
        Editor.PropertyChanged += (_, args) =>
        {
            if (args.PropertyName == nameof(Editor.SelectedType))
                OnPropertiesChanged(nameof(TransactionTargetChoices), nameof(TransactionNeedsTarget),
                    nameof(TransactionIsTransfer), nameof(TransactionIsExpense));
        };

        NavigateCommand = new RelayCommand<string>(Navigate);
        SaveCommand = new AsyncRelayCommand(SaveAsync);
        ToggleThemeCommand = new RelayCommand(ToggleTheme);
        CloseEditorCommand = new RelayCommand(Editor.Close);
        SaveEditorCommand = new RelayCommand(SaveEditor);
        AddTransactionCommand = new RelayCommand(OpenNewTransaction);
        AddTransferCommand = new RelayCommand(() => { OpenNewTransaction(); Editor.SelectedType = "Przelew między kontami"; });
        EditTransactionCommand = new RelayCommand<string>(OpenTransaction);
        DeleteTransactionCommand = new RelayCommand<string>(DeleteTransaction);
        AddGoalCommand = new RelayCommand(OpenNewGoal);
        AddGoalContributionCommand = new RelayCommand<string>(id => OpenTargetTransaction(id, "Wpłata na cel"));
        AddGoalWithdrawalCommand = new RelayCommand<string>(id => OpenTargetTransaction(id, "Wypłata z celu"));
        EditGoalCommand = new RelayCommand<string>(OpenGoal);
        DeleteGoalCommand = new RelayCommand<string>(DeleteGoal);
        AddDebtCommand = new RelayCommand(OpenNewDebt);
        AddDebtPaymentCommand = new RelayCommand<string>(id => OpenTargetTransaction(id, "Spłata długu"));
        EditDebtCommand = new RelayCommand<string>(OpenDebt);
        DeleteDebtCommand = new RelayCommand<string>(DeleteDebt);
        AddAccountCommand = new RelayCommand(OpenNewAccount);
        EditAccountCommand = new RelayCommand<string>(OpenAccount);
        DeleteAccountCommand = new RelayCommand<string>(DeleteAccount);
        AddRecurringCommand = new RelayCommand(OpenNewRecurring);
        PostRecurringCommand = new RelayCommand<string>(PostRecurring);
        EditRecurringCommand = new RelayCommand<string>(OpenRecurring);
        DeleteRecurringCommand = new RelayCommand<string>(DeleteRecurring);
        AddBudgetCommand = new RelayCommand(OpenNewBudget);
        EditBudgetCommand = new RelayCommand<string>(OpenBudget);
        DeleteBudgetCommand = new RelayCommand<string>(DeleteBudget);
        ImportStatementCommand = new AsyncRelayCommand(ImportStatementAsync);
        ExportCommand = new AsyncRelayCommand(ExportAsync);
        ImportCommand = new AsyncRelayCommand(ImportAsync);
        OpenDataFolderCommand = new RelayCommand(() => _platform.OpenFolder(_store.DataDirectory));
        RestoreBackupCommand = new RelayCommand<string>(RestoreBackup);
        CheckUpdatesCommand = new RelayCommand(() => ShowToast("To wydanie testowe. Kolejne paczki będą instalowane bez utraty lokalnej bazy danych."));
        DismissToastCommand = new RelayCommand(() => { Toast = ""; OnPropertyChanged(nameof(HasToast)); });

        _statementAccount = AccountChoices.FirstOrDefault(account =>
            _state.Accounts.First(item => item.Id == account.Key).Type == AccountType.Bank);
        Refresh();
    }

    public event Action<string>? ThemeChanged;
    public IReadOnlyList<PageViewModel> Pages { get; }
    public EditorViewModel Editor { get; }

    public ICommand NavigateCommand { get; }
    public ICommand SaveCommand { get; }
    public ICommand ToggleThemeCommand { get; }
    public ICommand CloseEditorCommand { get; }
    public ICommand SaveEditorCommand { get; }
    public ICommand AddTransactionCommand { get; }
    public ICommand AddTransferCommand { get; }
    public ICommand EditTransactionCommand { get; }
    public ICommand DeleteTransactionCommand { get; }
    public ICommand AddGoalCommand { get; }
    public ICommand AddGoalContributionCommand { get; }
    public ICommand AddGoalWithdrawalCommand { get; }
    public ICommand EditGoalCommand { get; }
    public ICommand DeleteGoalCommand { get; }
    public ICommand AddDebtCommand { get; }
    public ICommand AddDebtPaymentCommand { get; }
    public ICommand EditDebtCommand { get; }
    public ICommand DeleteDebtCommand { get; }
    public ICommand AddAccountCommand { get; }
    public ICommand EditAccountCommand { get; }
    public ICommand DeleteAccountCommand { get; }
    public ICommand AddRecurringCommand { get; }
    public ICommand PostRecurringCommand { get; }
    public ICommand EditRecurringCommand { get; }
    public ICommand DeleteRecurringCommand { get; }
    public ICommand AddBudgetCommand { get; }
    public ICommand EditBudgetCommand { get; }
    public ICommand DeleteBudgetCommand { get; }
    public ICommand ImportStatementCommand { get; }
    public ICommand ExportCommand { get; }
    public ICommand ImportCommand { get; }
    public ICommand OpenDataFolderCommand { get; }
    public ICommand RestoreBackupCommand { get; }
    public ICommand CheckUpdatesCommand { get; }
    public ICommand DismissToastCommand { get; }

    public PageViewModel CurrentPage
    {
        get => _currentPage;
        private set
        {
            if (!SetProperty(ref _currentPage, value)) return;
            OnPropertiesChanged(nameof(CurrentTitle), nameof(CurrentEyebrow), nameof(IsDashboardPage),
                nameof(IsMonthsPage), nameof(IsGoalsPage), nameof(IsDebtsPage), nameof(IsPlanPage),
                nameof(IsAnalyticsPage), nameof(IsAccountsPage), nameof(IsSettingsPage));
        }
    }

    public string CurrentTitle => CurrentPage.Title;
    public string CurrentEyebrow => CurrentPage.Eyebrow;
    public bool IsDashboardPage => CurrentPage.Key == "dashboard";
    public bool IsMonthsPage => CurrentPage.Key == "months";
    public bool IsGoalsPage => CurrentPage.Key == "goals";
    public bool IsDebtsPage => CurrentPage.Key == "debts";
    public bool IsPlanPage => CurrentPage.Key == "plan";
    public bool IsAnalyticsPage => CurrentPage.Key == "analytics";
    public bool IsAccountsPage => CurrentPage.Key == "accounts";
    public bool IsSettingsPage => CurrentPage.Key == "settings";

    public int SelectedYear
    {
        get => _selectedYear;
        set
        {
            if (!SetProperty(ref _selectedYear, Math.Clamp(value, 2020, 2100))) return;
            _state.Settings.CurrentYear = _selectedYear;
            MarkDirty("Zmieniono rok");
            Refresh();
        }
    }

    public int SelectedMonth
    {
        get => _selectedMonth;
        set
        {
            if (!SetProperty(ref _selectedMonth, Math.Clamp(value, 1, 12))) return;
            Refresh();
        }
    }

    public IReadOnlyList<int> Years => Enumerable.Range(2020, 81).ToList();
    public IReadOnlyList<MonthChoice> Months => Enumerable.Range(1, 12)
        .Select(month => new MonthChoice(month, Polish.DateTimeFormat.GetMonthName(month).Capitalize())).ToList();
    public MonthChoice SelectedMonthChoice
    {
        get => Months.First(item => item.Number == SelectedMonth);
        set { if (value is not null) SelectedMonth = value.Number; }
    }

    public bool IsDirty
    {
        get => _isDirty;
        private set { if (SetProperty(ref _isDirty, value)) OnPropertiesChanged(nameof(SaveState), nameof(SaveDetail)); }
    }

    public bool IsSaving
    {
        get => _isSaving;
        private set { if (SetProperty(ref _isSaving, value)) OnPropertiesChanged(nameof(SaveState), nameof(SaveDetail)); }
    }

    public string SaveState => IsSaving ? "Zapisywanie…" : IsDirty ? "Niezapisane zmiany" : "Wszystko zapisane";
    public string SaveDetail => IsSaving ? "Lokalna baza SQLite" : IsDirty ? "Kliknij Zapisz" :
        _state.Meta.SavedAt is { } saved ? $"Zapisano {saved.LocalDateTime:dd.MM, HH:mm}" : "Nowy plik danych";

    public string Toast
    {
        get => _toast;
        private set => SetProperty(ref _toast, value);
    }
    public bool HasToast => !string.IsNullOrWhiteSpace(Toast);

    public decimal AvailableBalanceValue => _calculator.TotalAvailable(_state);
    public string AvailableBalance => Money(AvailableBalanceValue);
    public string MonthIncome => Money(CurrentMonth.Income);
    public string MonthExpenses => Money(CurrentMonth.Expenses);
    public string MonthTargets => Money(CurrentMonth.GoalContributions + CurrentMonth.DebtPayments);
    public string MonthNet => Money(CurrentMonth.Net);
    public string MonthNetClass => CurrentMonth.Net >= 0 ? "positive" : "negative";
    public bool IsMonthNetPositive => CurrentMonth.Net >= 0;
    public bool IsMonthNetNegative => CurrentMonth.Net < 0;
    public string CurrentMonthLabel => $"{Months.First(item => item.Number == SelectedMonth).Label} {SelectedYear}";
    private MonthSummary CurrentMonth => _calculator.Month(_state, SelectedYear, SelectedMonth);

    public string GoalsSaved => Money(_state.Goals.Sum(goal => _calculator.GoalSaved(_state, goal)));
    public string GoalsTarget => Money(_state.Goals.Sum(goal => goal.Target));
    public string GoalsRemaining => Money(_state.Goals.Sum(goal => _calculator.Goal(_state, goal).Remaining));
    public string GoalsRecommended => Money(_state.Goals.Sum(goal => _calculator.Goal(_state, goal).Recommended));
    public int CompletedGoals => _state.Goals.Count(goal => _calculator.Goal(_state, goal).Remaining == 0);
    public string DebtsRemaining => Money(_state.Debts.Sum(debt => _calculator.Debt(_state, debt).Remaining));
    public string DebtsPaid => Money(_state.Debts.Sum(debt => _calculator.DebtPaid(_state, debt)));
    public string DebtsTotal => Money(_state.Debts.Sum(debt => debt.Total));
    public string DebtsRecommended => Money(_state.Debts.Sum(debt => _calculator.Debt(_state, debt).Recommended));
    public int CompletedDebts => _state.Debts.Count(debt => _calculator.Debt(_state, debt).Remaining == 0);
    public int ActiveGoals => _state.Goals.Count(goal => _calculator.Goal(_state, goal).Remaining > 0);
    public int ActiveDebts => _state.Debts.Count(debt => _calculator.Debt(_state, debt).Remaining > 0);

    public SpendingAllowance Allowance => _calculator.Spending(_state);
    public string DailyAllowance => Money(Allowance.Daily);
    public string WeeklyAllowance => Money(Allowance.Weekly);
    public string AllowanceDetail => $"Po odjęciu {Money(Allowance.Commitments)} zaplanowanych wydatków • do {Allowance.NextPayday:dd.MM}";

    public IReadOnlyList<TransactionRow> Transactions => _state.Transactions
        .Where(item => item.Date.Year == SelectedYear && item.Date.Month == SelectedMonth)
        .OrderByDescending(item => item.Date).ThenByDescending(item => item.CreatedAt)
        .Select(TransactionDisplay).ToList();
    public bool HasTransactions => Transactions.Count > 0;

    public IReadOnlyList<TransactionRow> RecentTransactions => _state.Transactions
        .OrderByDescending(item => item.Date).ThenByDescending(item => item.CreatedAt).Take(6)
        .Select(TransactionDisplay).ToList();
    public bool HasRecentTransactions => RecentTransactions.Count > 0;

    public IReadOnlyList<GoalCard> GoalCards => _state.Goals.OrderBy(goal => goal.Deadline ?? DateOnly.MaxValue)
        .Select(goal =>
        {
            var info = _calculator.Goal(_state, goal);
            return new GoalCard(goal.Id, goal.Name, Money(goal.Target), Money(info.Saved), Money(info.Remaining),
                Money(info.Recommended), goal.Cadence switch
                {
                    ContributionCadence.Weekly => "Zalecane co tydzień",
                    ContributionCadence.Payday => "Zalecane przy wypłacie",
                    _ => "Zalecane miesięcznie"
                }, DeadlineLabel(goal.Deadline), GoalStatus(info), StatusClass(info.IsOverdue, info.Remaining == 0),
                (double)info.Percent, info.Remaining == 0, info.IsOverdue);
        }).ToList();
    public bool HasGoals => _state.Goals.Count > 0;

    public IReadOnlyList<DebtCard> DebtCards => _state.Debts.OrderBy(debt => debt.Deadline ?? DateOnly.MaxValue)
        .Select(debt =>
        {
            var info = _calculator.Debt(_state, debt);
            var interest = _state.Settings.InterestEnabled && debt.InterestEnabled && debt.Apr > 0
                ? $"{debt.Apr:N2}% rocznie • szac. {Money(info.EstimatedInterest)}"
                : "Odsetki wyłączone";
            return new DebtCard(debt.Id, debt.Name, Money(debt.Total), Money(info.Paid), Money(info.Remaining),
                Money(info.Recommended), interest, DeadlineLabel(debt.Deadline), DebtStatus(info),
                StatusClass(info.IsOverdue, info.Remaining == 0), (double)info.Percent, info.Remaining == 0, info.IsOverdue);
        }).ToList();
    public bool HasDebts => _state.Debts.Count > 0;

    public IReadOnlyList<AccountCard> AccountCards => _state.Accounts.Select(account => new AccountCard(
        account.Id, account.Name, account.Type == AccountType.Cash ? "Gotówka" : "Konto bankowe",
        Money(_calculator.AccountBalance(_state, account)), account.Color, account.IsActive,
        !_state.Transactions.Any(item => item.AccountId == account.Id || item.ToAccountId == account.Id))).ToList();

    public IReadOnlyList<RecurringCard> RecurringCards => _state.Recurring.Select(entry =>
    {
        var next = _calculator.Occurrences(entry, DateOnly.FromDateTime(DateTime.Today),
            DateOnly.FromDateTime(DateTime.Today.AddYears(1))).FirstOrDefault();
        var schedule = entry.Cadence == RecurringCadence.Weekly ? $"co tydzień • dzień {entry.Day}" : $"co miesiąc • dzień {entry.Day}";
        var detail = next == default ? schedule : $"{schedule} • następny {next:dd.MM.yyyy}";
        return new RecurringCard(entry.Id, entry.Name, detail, Money(entry.Amount),
            entry.Type == RecurringType.Income ? "positive" : "negative", entry.IsActive ? "Aktywny" : "Wstrzymany");
    }).ToList();
    public bool HasRecurring => _state.Recurring.Count > 0;

    public IReadOnlyList<BudgetCard> BudgetCards => _state.Budgets.Select(budget =>
    {
        var spent = _state.Transactions.Where(item => item.Date.Year == SelectedYear && item.Date.Month == SelectedMonth &&
                                                     item.Type == TransactionType.Expense &&
                                                     string.Equals(item.Category, budget.Category, StringComparison.CurrentCultureIgnoreCase))
            .Sum(item => item.Amount);
        var remaining = budget.Limit - spent;
        var percent = budget.Limit <= 0 ? 0d : Math.Min(100d, (double)(spent / budget.Limit * 100m));
        return new BudgetCard(budget.Id, budget.Category, Money(budget.Limit), Money(spent), Money(Math.Max(0, remaining)),
            percent, remaining < 0 ? "danger" : percent >= 80 ? "warning" : "good");
    }).ToList();
    public bool HasBudgets => _state.Budgets.Count > 0;

    public IReadOnlyList<AlertCard> Alerts
    {
        get
        {
            if (!_state.Settings.AlertsEnabled) return [];
            var alerts = new List<AlertCard>();
            foreach (var goal in _state.Goals.Where(goal => goal.AlertsEnabled))
            {
                var info = _calculator.Goal(_state, goal);
                if (info.IsOverdue) alerts.Add(new AlertCard("!", goal.Name, $"Cel po terminie • zostało {Money(info.Remaining)}", "danger", "goals"));
                else if (info.IsCapped) alerts.Add(new AlertCard("!", goal.Name, "Zalecana wpłata przekracza ustawione maksimum.", "warning", "goals"));
            }
            foreach (var debt in _state.Debts.Where(debt => debt.AlertsEnabled))
            {
                var info = _calculator.Debt(_state, debt);
                if (info.IsOverdue) alerts.Add(new AlertCard("!", debt.Name, $"Dług po terminie • zostało {Money(info.Remaining)}", "danger", "debts"));
            }
            if (_state.Settings.EnvelopesEnabled)
                foreach (var budget in BudgetCards.Where(item => item.StatusClass is "danger" or "warning"))
                    alerts.Add(new AlertCard("%", budget.Category, budget.StatusClass == "danger" ? "Limit został przekroczony." : "Wykorzystano co najmniej 80% limitu.", budget.StatusClass, "plan"));
            return alerts.Take(8).ToList();
        }
    }
    public bool HasAlerts => Alerts.Count > 0;

    public IReadOnlyList<MonthBar> AnnualBars
    {
        get
        {
            var summaries = Enumerable.Range(1, 12).Select(month => _calculator.Month(_state, SelectedYear, month)).ToList();
            var max = Math.Max(1m, summaries.Max(item => Math.Max(item.Income, item.Expenses + item.GoalContributions + item.DebtPayments)));
            return summaries.Select((item, index) => new MonthBar(
                Polish.DateTimeFormat.GetAbbreviatedMonthName(index + 1).TrimEnd('.').ToUpper(Polish),
                (double)(item.Income / max * 150m),
                (double)((item.Expenses + item.GoalContributions + item.DebtPayments) / max * 150m),
                Money(item.Income), Money(item.Expenses + item.GoalContributions + item.DebtPayments))).ToList();
        }
    }

    public string AnnualIncome => Money(Enumerable.Range(1, 12).Sum(month => _calculator.Month(_state, SelectedYear, month).Income));
    public string AnnualOutflow => Money(Enumerable.Range(1, 12).Sum(month =>
    {
        var summary = _calculator.Month(_state, SelectedYear, month);
        return summary.Expenses + summary.GoalContributions + summary.DebtPayments;
    }));
    public string AnnualNet => Money(Enumerable.Range(1, 12).Sum(month => _calculator.Month(_state, SelectedYear, month).Net));

    public IReadOnlyList<CategorySlice> CategorySlices
    {
        get
        {
            var values = _state.Transactions.Where(item => item.Date.Year == SelectedYear && item.Type == TransactionType.Expense)
                .GroupBy(item => string.IsNullOrWhiteSpace(item.Category) ? "Inne" : item.Category)
                .Select(group => new { Category = group.Key, Amount = group.Sum(item => item.Amount) })
                .OrderByDescending(item => item.Amount).Take(7).ToList();
            var total = Math.Max(1m, values.Sum(item => item.Amount));
            return values.Select((item, index) => new CategorySlice(item.Category, Money(item.Amount),
                (double)(item.Amount / total * 100m), Palette[index % Palette.Length])).ToList();
        }
    }
    public bool HasCategorySlices => CategorySlices.Count > 0;

    public IReadOnlyList<string> Categories => _state.Settings.Categories;
    public IReadOnlyList<string> TransactionTypeChoices => ["Wydatek", "Wpływ", "Wpłata na cel", "Wypłata z celu", "Spłata długu", "Przelew między kontami"];
    public IReadOnlyList<string> RecurringTypeChoices => ["Wydatek", "Wpływ"];
    public IReadOnlyList<string> GoalCadenceChoices => ["Miesięcznie", "Co tydzień", "Przy wypłacie"];
    public IReadOnlyList<string> RecurringCadenceChoices => ["Miesięcznie", "Co tydzień"];
    public IReadOnlyList<string> AccountTypeChoices => ["Gotówka", "Konto bankowe"];
    public IReadOnlyList<ChoiceItem> AccountChoices => _state.Accounts.Where(account => account.IsActive)
        .Select(account => new ChoiceItem(account.Id, account.Name)).ToList();
    public IReadOnlyList<ChoiceItem> GoalChoices => _state.Goals.Select(goal => new ChoiceItem(goal.Id, goal.Name)).ToList();
    public IReadOnlyList<ChoiceItem> DebtChoices => _state.Debts.Select(debt => new ChoiceItem(debt.Id, debt.Name)).ToList();
    public IReadOnlyList<ChoiceItem> TransactionTargetChoices => Editor.SelectedType is "Wpłata na cel" or "Wypłata z celu" ? GoalChoices : DebtChoices;
    public bool TransactionNeedsTarget => Editor.SelectedType is "Wpłata na cel" or "Wypłata z celu" or "Spłata długu";
    public bool TransactionIsTransfer => Editor.SelectedType == "Przelew między kontami";
    public bool TransactionIsExpense => Editor.SelectedType == "Wydatek";

    public ChoiceItem? StatementAccount
    {
        get => _statementAccount;
        set => SetProperty(ref _statementAccount, value);
    }
    public IReadOnlyList<StatementPreviewRow> StatementRows
    {
        get => _statementRows;
        private set => SetProperty(ref _statementRows, value);
    }
    public int SelectedStatementCount => StatementRows.Count(item => item.IsSelected);

    public bool BankAccountsEnabled
    {
        get => _state.Settings.BankAccountsEnabled;
        set { if (_state.Settings.BankAccountsEnabled == value) return; _state.Settings.BankAccountsEnabled = value; if (!value) { _state.Settings.StatementImportEnabled = false; if (CurrentPage.Key == "accounts") Navigate("dashboard"); } MarkDirty("Zmieniono obsługę kont"); Refresh(); }
    }
    public bool StatementImportEnabled
    {
        get => _state.Settings.StatementImportEnabled;
        set { if (_state.Settings.StatementImportEnabled == value) return; _state.Settings.StatementImportEnabled = value; MarkDirty("Zmieniono import wyciągów"); Refresh(); }
    }
    public bool AlertsEnabled
    {
        get => _state.Settings.AlertsEnabled;
        set { if (_state.Settings.AlertsEnabled == value) return; _state.Settings.AlertsEnabled = value; MarkDirty("Zmieniono ostrzeżenia"); Refresh(); }
    }
    public bool InterestEnabled
    {
        get => _state.Settings.InterestEnabled;
        set { if (_state.Settings.InterestEnabled == value) return; _state.Settings.InterestEnabled = value; MarkDirty("Zmieniono moduł odsetek"); Refresh(); }
    }
    public bool SpendingLimitsEnabled
    {
        get => _state.Settings.SpendingLimitsEnabled;
        set { if (_state.Settings.SpendingLimitsEnabled == value) return; _state.Settings.SpendingLimitsEnabled = value; MarkDirty("Zmieniono limity wydatków"); Refresh(); }
    }
    public bool RecurringEnabled
    {
        get => _state.Settings.RecurringEnabled;
        set { if (_state.Settings.RecurringEnabled == value) return; _state.Settings.RecurringEnabled = value; MarkDirty("Zmieniono wpisy cykliczne"); Refresh(); }
    }
    public bool EnvelopesEnabled
    {
        get => _state.Settings.EnvelopesEnabled;
        set { if (_state.Settings.EnvelopesEnabled == value) return; _state.Settings.EnvelopesEnabled = value; MarkDirty("Zmieniono limity kategorii"); Refresh(); }
    }
    public bool ForecastEnabled
    {
        get => _state.Settings.ForecastEnabled;
        set { if (_state.Settings.ForecastEnabled == value) return; _state.Settings.ForecastEnabled = value; MarkDirty("Zmieniono prognozę"); Refresh(); }
    }
    public bool ShowCents
    {
        get => _state.Settings.ShowCents;
        set { if (_state.Settings.ShowCents == value) return; _state.Settings.ShowCents = value; MarkDirty("Zmieniono format kwot"); Refresh(); }
    }
    public int PaydayDay
    {
        get => _state.Settings.PaydayDay;
        set { value = Math.Clamp(value, 1, 31); if (_state.Settings.PaydayDay == value) return; _state.Settings.PaydayDay = value; MarkDirty("Zmieniono dzień wypłaty"); Refresh(); }
    }
    public int BackupLimit
    {
        get => _state.Settings.BackupLimit;
        set { value = Math.Clamp(value, 3, 100); if (_state.Settings.BackupLimit == value) return; _state.Settings.BackupLimit = value; MarkDirty("Zmieniono liczbę kopii"); }
    }
    public string CategoriesText
    {
        get => string.Join(Environment.NewLine, _state.Settings.Categories);
        set
        {
            var categories = value.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Distinct(StringComparer.CurrentCultureIgnoreCase).ToList();
            if (categories.SequenceEqual(_state.Settings.Categories)) return;
            _state.Settings.Categories = categories.Count > 0 ? categories : ["Inne"];
            MarkDirty("Zmieniono kategorie");
            Refresh();
        }
    }
    public bool IsDarkTheme => _state.Settings.Theme == "dark";
    public bool HasBankAccount => _state.Accounts.Any(account => account.Type == AccountType.Bank && account.IsActive);
    public IReadOnlyList<BackupInfo> Backups => _store.GetBackups();
    public bool HasBackups => Backups.Count > 0;
    public string DatabasePath => _store.DatabasePath;
    public string AppVersion => "0.2.0-alpha.1 • Avalonia";

    public bool CanCloseWithoutPrompt => !IsDirty;

    public void RequestClose(Action closeAction) => Confirm(
        "Masz niezapisane zmiany. Zamknąć program bez zapisywania?", closeAction);

    private void Navigate(string? key)
    {
        if (string.IsNullOrWhiteSpace(key)) return;
        var page = Pages.FirstOrDefault(item => item.Key == key);
        if (page is null || (key == "accounts" && !_state.Settings.BankAccountsEnabled)) return;
        CurrentPage = page;
    }

    private async Task SaveAsync()
    {
        try
        {
            IsSaving = true;
            await _store.SaveAsync(_state);
            IsDirty = false;
            Toast = "Zapisano bezpiecznie w lokalnej bazie.";
            OnPropertiesChanged(nameof(Backups), nameof(SaveState), nameof(SaveDetail), nameof(HasToast));
        }
        catch (Exception ex)
        {
            Toast = $"Nie udało się zapisać: {ex.Message}";
            OnPropertyChanged(nameof(HasToast));
        }
        finally { IsSaving = false; }
    }

    private void ToggleTheme()
    {
        _state.Settings.Theme = _state.Settings.Theme == "dark" ? "light" : "dark";
        ThemeChanged?.Invoke(_state.Settings.Theme);
        MarkDirty("Zmieniono wygląd");
        OnPropertyChanged(nameof(IsDarkTheme));
    }

    private void OpenNewTransaction()
    {
        Editor.Reset(EditorKind.Transaction, "Dodaj operację");
        Editor.SelectedType = "Wydatek";
        Editor.SelectedCategory = Categories.FirstOrDefault() ?? "Inne";
        Editor.SelectedAccount = AccountChoices.FirstOrDefault();
    }

    private void OpenTargetTransaction(string? id, string type)
    {
        OpenNewTransaction();
        Editor.SelectedType = type;
        Editor.SelectedTarget = FindChoice(TransactionTargetChoices, id ?? "");
        Editor.Description = type;
    }

    private void OpenTransaction(string? id)
    {
        var item = _state.Transactions.FirstOrDefault(transaction => transaction.Id == id);
        if (item is null) return;
        Editor.Reset(EditorKind.Transaction, "Edytuj operację");
        Editor.EntityId = item.Id;
        Editor.Date = item.Date.ToDateTime(TimeOnly.MinValue);
        Editor.SelectedType = TransactionTypeLabel(item.Type);
        Editor.SelectedCategory = item.Category;
        Editor.Description = item.Description;
        Editor.Amount = InputMoney(item.Amount);
        Editor.Note = item.Note;
        Editor.SelectedAccount = FindChoice(AccountChoices, item.AccountId);
        Editor.SelectedToAccount = FindChoice(AccountChoices, item.ToAccountId);
        Editor.SelectedTarget = FindChoice(TransactionTargetChoices, item.TargetId);
    }

    private void DeleteTransaction(string? id) => Confirm("Usunąć tę operację? Salda, cel lub dług zostaną automatycznie przeliczone.", () =>
    {
        _state.Transactions.RemoveAll(item => item.Id == id);
        MarkDirty("Usunięto operację");
        Refresh();
    });

    private void OpenNewGoal()
    {
        Editor.Reset(EditorKind.Goal, "Dodaj cel");
        Editor.SelectedCadence = "Miesięcznie";
        Editor.Day = _state.Settings.PaydayDay;
    }

    private void OpenGoal(string? id)
    {
        var goal = _state.Goals.FirstOrDefault(item => item.Id == id);
        if (goal is null) return;
        Editor.Reset(EditorKind.Goal, "Edytuj cel");
        Editor.EntityId = goal.Id;
        Editor.Name = goal.Name;
        Editor.Amount = InputMoney(goal.Target);
        Editor.StartDate = goal.StartDate.ToDateTime(TimeOnly.MinValue);
        Editor.Deadline = goal.Deadline?.ToDateTime(TimeOnly.MinValue);
        Editor.SelectedCadence = goal.Cadence switch { ContributionCadence.Weekly => "Co tydzień", ContributionCadence.Payday => "Przy wypłacie", _ => "Miesięcznie" };
        Editor.Day = goal.PaymentDay;
        Editor.MaxContribution = goal.MaxContribution is > 0 ? InputMoney(goal.MaxContribution.Value) : "";
        Editor.AlertsEnabled = goal.AlertsEnabled;
    }

    private void DeleteGoal(string? id)
    {
        if (_state.Transactions.Any(item => item.TargetId == id && item.Type is TransactionType.GoalContribution or TransactionType.GoalWithdrawal))
        {
            ShowToast("Nie można usunąć celu z historią wpłat. Najpierw usuń powiązane operacje.");
            return;
        }
        Confirm("Usunąć ten cel?", () => { _state.Goals.RemoveAll(item => item.Id == id); MarkDirty("Usunięto cel"); Refresh(); });
    }

    private void OpenNewDebt()
    {
        Editor.Reset(EditorKind.Debt, "Dodaj dług");
        Editor.Day = _state.Settings.PaydayDay;
        Editor.InterestEnabled = _state.Settings.InterestEnabled;
    }

    private void OpenDebt(string? id)
    {
        var debt = _state.Debts.FirstOrDefault(item => item.Id == id);
        if (debt is null) return;
        Editor.Reset(EditorKind.Debt, "Edytuj dług");
        Editor.EntityId = debt.Id;
        Editor.Name = debt.Name;
        Editor.Amount = InputMoney(debt.Total);
        Editor.Deadline = debt.Deadline?.ToDateTime(TimeOnly.MinValue);
        Editor.InterestEnabled = debt.InterestEnabled;
        Editor.Apr = InputMoney(debt.Apr);
        Editor.SecondaryAmount = InputMoney(debt.MinimumPayment);
        Editor.Day = debt.PaymentDay;
        Editor.AlertsEnabled = debt.AlertsEnabled;
    }

    private void DeleteDebt(string? id)
    {
        if (_state.Transactions.Any(item => item.TargetId == id && item.Type == TransactionType.DebtPayment))
        {
            ShowToast("Nie można usunąć długu z historią spłat. Najpierw usuń powiązane operacje.");
            return;
        }
        Confirm("Usunąć ten dług?", () => { _state.Debts.RemoveAll(item => item.Id == id); MarkDirty("Usunięto dług"); Refresh(); });
    }

    private void OpenNewAccount()
    {
        Editor.Reset(EditorKind.Account, "Dodaj konto");
        Editor.SelectedType = "Konto bankowe";
        Editor.Toggle = true;
    }

    private void OpenAccount(string? id)
    {
        var account = _state.Accounts.FirstOrDefault(item => item.Id == id);
        if (account is null) return;
        Editor.Reset(EditorKind.Account, "Edytuj konto");
        Editor.EntityId = account.Id;
        Editor.Name = account.Name;
        Editor.SelectedType = account.Type == AccountType.Cash ? "Gotówka" : "Konto bankowe";
        Editor.Amount = InputMoney(account.OpeningBalance);
        Editor.Toggle = account.IsActive;
    }

    private void DeleteAccount(string? id)
    {
        if (_state.Transactions.Any(item => item.AccountId == id || item.ToAccountId == id))
        {
            ShowToast("Nie można usunąć konta z historią operacji. Możesz je wyłączyć podczas edycji.");
            return;
        }
        if (_state.Accounts.Count <= 1) { ShowToast("Musi pozostać co najmniej jedno źródło pieniędzy."); return; }
        Confirm("Usunąć to konto?", () => { _state.Accounts.RemoveAll(item => item.Id == id); MarkDirty("Usunięto konto"); Refresh(); });
    }

    private void OpenNewRecurring()
    {
        Editor.Reset(EditorKind.Recurring, "Dodaj wpis cykliczny");
        Editor.SelectedType = "Wydatek";
        Editor.SelectedCadence = "Miesięcznie";
        Editor.SelectedCategory = Categories.FirstOrDefault() ?? "Inne";
        Editor.SelectedAccount = AccountChoices.FirstOrDefault();
    }

    private void OpenRecurring(string? id)
    {
        var entry = _state.Recurring.FirstOrDefault(item => item.Id == id);
        if (entry is null) return;
        Editor.Reset(EditorKind.Recurring, "Edytuj wpis cykliczny");
        Editor.EntityId = entry.Id;
        Editor.Name = entry.Name;
        Editor.SelectedType = entry.Type == RecurringType.Income ? "Wpływ" : "Wydatek";
        Editor.Amount = InputMoney(entry.Amount);
        Editor.SelectedCategory = entry.Category;
        Editor.SelectedAccount = FindChoice(AccountChoices, entry.AccountId);
        Editor.SelectedCadence = entry.Cadence == RecurringCadence.Weekly ? "Co tydzień" : "Miesięcznie";
        Editor.Day = entry.Day;
        Editor.StartDate = entry.StartDate.ToDateTime(TimeOnly.MinValue);
        Editor.EndDate = entry.EndDate?.ToDateTime(TimeOnly.MinValue);
        Editor.Toggle = entry.IsActive;
    }

    private void DeleteRecurring(string? id) => Confirm("Usunąć ten wpis cykliczny? Zaksięgowane operacje pozostaną.", () =>
    {
        _state.Recurring.RemoveAll(item => item.Id == id);
        MarkDirty("Usunięto wpis cykliczny");
        Refresh();
    });

    private void PostRecurring(string? id)
    {
        var entry = _state.Recurring.FirstOrDefault(item => item.Id == id);
        if (entry is null || !entry.IsActive || !_state.Settings.RecurringEnabled) return;
        var today = DateOnly.FromDateTime(DateTime.Today);
        var occurrence = _calculator.Occurrences(entry, today.AddMonths(-1), today.AddYears(1))
            .FirstOrDefault(date => !_state.Transactions.Any(transaction => transaction.RecurringId == entry.Id && transaction.ScheduledDate == date));
        if (occurrence == default) { ShowToast("Brak kolejnego terminu do zaksięgowania."); return; }
        _state.Transactions.Add(new Transaction
        {
            Date = occurrence,
            ScheduledDate = occurrence,
            RecurringId = entry.Id,
            Type = entry.Type == RecurringType.Income ? TransactionType.Income : TransactionType.Expense,
            Category = entry.Category,
            AccountId = string.IsNullOrWhiteSpace(entry.AccountId) ? AccountChoices.First().Key : entry.AccountId,
            Description = entry.Name,
            Amount = entry.Amount
        });
        MarkDirty($"Zaksięgowano „{entry.Name}”");
        Refresh();
    }

    private void OpenNewBudget()
    {
        Editor.Reset(EditorKind.Budget, "Dodaj limit kategorii");
        Editor.SelectedCategory = Categories.FirstOrDefault() ?? "Inne";
    }

    private void OpenBudget(string? id)
    {
        var budget = _state.Budgets.FirstOrDefault(item => item.Id == id);
        if (budget is null) return;
        Editor.Reset(EditorKind.Budget, "Edytuj limit kategorii");
        Editor.EntityId = budget.Id;
        Editor.SelectedCategory = budget.Category;
        Editor.Amount = InputMoney(budget.Limit);
    }

    private void DeleteBudget(string? id) => Confirm("Usunąć ten limit? Operacje pozostaną bez zmian.", () =>
    {
        _state.Budgets.RemoveAll(item => item.Id == id);
        MarkDirty("Usunięto limit");
        Refresh();
    });

    private void SaveEditor()
    {
        Editor.Error = "";
        if (Editor.Kind == EditorKind.Confirm)
        {
            var action = _confirmAction;
            _confirmAction = null;
            Editor.Close();
            action?.Invoke();
            return;
        }
        try
        {
            switch (Editor.Kind)
            {
                case EditorKind.Transaction: SaveTransactionEditor(); break;
                case EditorKind.Goal: SaveGoalEditor(); break;
                case EditorKind.Debt: SaveDebtEditor(); break;
                case EditorKind.Account: SaveAccountEditor(); break;
                case EditorKind.Recurring: SaveRecurringEditor(); break;
                case EditorKind.Budget: SaveBudgetEditor(); break;
                case EditorKind.Statement: SaveStatementEditor(); break;
                default: return;
            }
            Editor.Close();
            Refresh();
        }
        catch (InvalidOperationException ex) { Editor.Error = ex.Message; }
    }

    private void SaveTransactionEditor()
    {
        var amount = RequireMoney(Editor.Amount, "Wpisz prawidłową kwotę większą od zera.");
        var date = Editor.Date is { } dateValue ? DateOnly.FromDateTime(dateValue.LocalDateTime) : throw new InvalidOperationException("Wybierz datę.");
        var type = Editor.SelectedType switch
        {
            "Wpływ" => TransactionType.Income,
            "Wpłata na cel" => TransactionType.GoalContribution,
            "Wypłata z celu" => TransactionType.GoalWithdrawal,
            "Spłata długu" => TransactionType.DebtPayment,
            "Przelew między kontami" => TransactionType.Transfer,
            _ => TransactionType.Expense
        };
        var accountId = Editor.SelectedAccount?.Key ?? throw new InvalidOperationException("Wybierz źródło pieniędzy.");
        var targetId = TransactionNeedsTarget ? Editor.SelectedTarget?.Key ?? throw new InvalidOperationException("Wybierz cel lub dług.") : "";
        var toAccountId = TransactionIsTransfer ? Editor.SelectedToAccount?.Key ?? throw new InvalidOperationException("Wybierz konto docelowe.") : "";
        if (TransactionIsTransfer && accountId == toAccountId) throw new InvalidOperationException("Konto źródłowe i docelowe muszą być różne.");
        if (type == TransactionType.GoalWithdrawal)
        {
            var goal = _state.Goals.First(item => item.Id == targetId);
            if (amount > _calculator.GoalSaved(_state, goal)) throw new InvalidOperationException("Nie możesz wypłacić więcej, niż odłożono na ten cel.");
        }
        var item = _state.Transactions.FirstOrDefault(transaction => transaction.Id == Editor.EntityId) ?? new Transaction();
        var isNew = !_state.Transactions.Contains(item);
        item.Date = date;
        item.Type = type;
        item.Category = type == TransactionType.Expense ? Editor.SelectedCategory : "";
        item.TargetId = targetId;
        item.AccountId = accountId;
        item.ToAccountId = toAccountId;
        item.Description = Editor.Description.Trim();
        item.Amount = amount;
        item.Note = Editor.Note.Trim();
        if (isNew) _state.Transactions.Add(item);
        MarkDirty(isNew ? "Dodano operację" : "Zmieniono operację");
    }

    private void SaveGoalEditor()
    {
        if (string.IsNullOrWhiteSpace(Editor.Name)) throw new InvalidOperationException("Wpisz nazwę celu.");
        var target = RequireMoney(Editor.Amount, "Wpisz kwotę celu większą od zera.");
        var start = Editor.StartDate is { } startValue ? DateOnly.FromDateTime(startValue.LocalDateTime) : DateOnly.FromDateTime(DateTime.Today);
        var deadline = Editor.Deadline is { } deadlineValue ? DateOnly.FromDateTime(deadlineValue.LocalDateTime) : (DateOnly?)null;
        if (deadline is { } due && due < start) throw new InvalidOperationException("Termin nie może być wcześniejszy niż data rozpoczęcia.");
        var goal = _state.Goals.FirstOrDefault(item => item.Id == Editor.EntityId) ?? new Goal();
        var isNew = !_state.Goals.Contains(goal);
        goal.Name = Editor.Name.Trim();
        goal.Target = target;
        goal.StartDate = start;
        goal.Deadline = deadline;
        goal.Cadence = Editor.SelectedCadence switch { "Co tydzień" => ContributionCadence.Weekly, "Przy wypłacie" => ContributionCadence.Payday, _ => ContributionCadence.Monthly };
        goal.PaymentDay = Math.Clamp(Editor.Day, 1, goal.Cadence == ContributionCadence.Weekly ? 7 : 31);
        goal.MaxContribution = TryMoney(Editor.MaxContribution, out var maximum) && maximum > 0 ? maximum : null;
        goal.AlertsEnabled = Editor.AlertsEnabled;
        if (isNew) _state.Goals.Add(goal);
        MarkDirty(isNew ? "Dodano cel" : "Zmieniono cel");
    }

    private void SaveDebtEditor()
    {
        if (string.IsNullOrWhiteSpace(Editor.Name)) throw new InvalidOperationException("Wpisz nazwę długu.");
        var total = RequireMoney(Editor.Amount, "Wpisz kwotę długu większą od zera.");
        var debt = _state.Debts.FirstOrDefault(item => item.Id == Editor.EntityId) ?? new Debt();
        var isNew = !_state.Debts.Contains(debt);
        debt.Name = Editor.Name.Trim();
        debt.Total = total;
        debt.Deadline = Editor.Deadline is { } deadline ? DateOnly.FromDateTime(deadline.LocalDateTime) : null;
        debt.InterestEnabled = Editor.InterestEnabled;
        debt.Apr = debt.InterestEnabled && TryMoney(Editor.Apr, out var apr) ? Math.Max(0, apr) : 0;
        debt.MinimumPayment = TryMoney(Editor.SecondaryAmount, out var minimum) ? Math.Max(0, minimum) : 0;
        debt.PaymentDay = Math.Clamp(Editor.Day, 1, 31);
        debt.AlertsEnabled = Editor.AlertsEnabled;
        if (isNew) _state.Debts.Add(debt);
        MarkDirty(isNew ? "Dodano dług" : "Zmieniono dług");
    }

    private void SaveAccountEditor()
    {
        if (string.IsNullOrWhiteSpace(Editor.Name)) throw new InvalidOperationException("Wpisz nazwę konta lub portfela.");
        var account = _state.Accounts.FirstOrDefault(item => item.Id == Editor.EntityId) ?? new Account();
        var isNew = !_state.Accounts.Contains(account);
        account.Name = Editor.Name.Trim();
        account.Type = Editor.SelectedType == "Konto bankowe" ? AccountType.Bank : AccountType.Cash;
        account.OpeningBalance = TryMoney(Editor.Amount, out var balance) ? balance : 0;
        if (!Editor.Toggle && _state.Accounts.Count(item => item.IsActive && item.Id != account.Id) == 0)
            throw new InvalidOperationException("Musi pozostać co najmniej jedno aktywne źródło pieniędzy.");
        account.IsActive = Editor.Toggle;
        if (string.IsNullOrWhiteSpace(account.Color)) account.Color = Palette[_state.Accounts.Count % Palette.Length];
        if (isNew) _state.Accounts.Add(account);
        MarkDirty(isNew ? "Dodano konto" : "Zmieniono konto");
    }

    private void SaveRecurringEditor()
    {
        if (string.IsNullOrWhiteSpace(Editor.Name)) throw new InvalidOperationException("Wpisz nazwę cyklicznej operacji.");
        var amount = RequireMoney(Editor.Amount, "Wpisz kwotę większą od zera.");
        var entry = _state.Recurring.FirstOrDefault(item => item.Id == Editor.EntityId) ?? new RecurringEntry();
        var isNew = !_state.Recurring.Contains(entry);
        entry.Name = Editor.Name.Trim();
        entry.Type = Editor.SelectedType == "Wpływ" ? RecurringType.Income : RecurringType.Expense;
        entry.Amount = amount;
        entry.Category = Editor.SelectedCategory;
        entry.AccountId = Editor.SelectedAccount?.Key ?? AccountChoices.First().Key;
        entry.Cadence = Editor.SelectedCadence == "Co tydzień" ? RecurringCadence.Weekly : RecurringCadence.Monthly;
        entry.Day = Math.Clamp(Editor.Day, 1, entry.Cadence == RecurringCadence.Weekly ? 7 : 31);
        entry.StartDate = Editor.StartDate is { } start ? DateOnly.FromDateTime(start.LocalDateTime) : DateOnly.FromDateTime(DateTime.Today);
        entry.EndDate = Editor.EndDate is { } end ? DateOnly.FromDateTime(end.LocalDateTime) : null;
        if (entry.EndDate is { } endDate && endDate < entry.StartDate) throw new InvalidOperationException("Data zakończenia nie może być wcześniejsza niż rozpoczęcie.");
        entry.IsActive = Editor.Toggle;
        if (isNew) _state.Recurring.Add(entry);
        MarkDirty(isNew ? "Dodano wpis cykliczny" : "Zmieniono wpis cykliczny");
    }

    private void SaveBudgetEditor()
    {
        var limit = RequireMoney(Editor.Amount, "Wpisz limit większy od zera.");
        var duplicate = _state.Budgets.FirstOrDefault(item => item.Category == Editor.SelectedCategory && item.Id != Editor.EntityId);
        if (duplicate is not null) throw new InvalidOperationException("Ta kategoria ma już ustawiony limit.");
        var budget = _state.Budgets.FirstOrDefault(item => item.Id == Editor.EntityId) ?? new CategoryBudget();
        var isNew = !_state.Budgets.Contains(budget);
        budget.Category = Editor.SelectedCategory;
        budget.Limit = limit;
        if (isNew) _state.Budgets.Add(budget);
        MarkDirty(isNew ? "Dodano limit" : "Zmieniono limit");
    }

    private void SaveStatementEditor()
    {
        var accountId = StatementAccount?.Key ?? throw new InvalidOperationException("Wybierz konto dla importu.");
        var selected = StatementRows.Where(row => row.IsSelected).ToList();
        if (selected.Count == 0) throw new InvalidOperationException("Zaznacz co najmniej jedną operację.");
        foreach (var row in selected)
        {
            _state.Transactions.Add(new Transaction
            {
                Date = row.Date,
                Type = row.IsIncome ? TransactionType.Income : TransactionType.Expense,
                Category = row.IsIncome ? "" : row.Category,
                AccountId = accountId,
                Description = row.Description,
                Amount = row.Amount,
                ImportFingerprint = row.Fingerprint
            });
        }
        StatementRows = [];
        MarkDirty($"Zaimportowano {selected.Count} operacji");
    }

    private async Task ImportStatementAsync()
    {
        if (!_state.Settings.StatementImportEnabled) { ShowToast("Włącz import wyciągów w Ustawieniach."); return; }
        if (StatementAccount is null) { ShowToast("Dodaj konto bankowe i wybierz je na liście."); return; }
        var path = await _platform.PickOpenFileAsync("Wybierz wyciąg CSV", ["*.csv", "*.txt"]);
        if (path is null) return;
        try
        {
            var existing = _state.Transactions.Where(item => !string.IsNullOrWhiteSpace(item.ImportFingerprint))
                .Select(item => item.ImportFingerprint).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var parsed = await _csv.ParseAsync(path);
            StatementRows = parsed.Where(row => !existing.Contains(row.Fingerprint))
                .Select(row => new StatementPreviewRow(row.Date, row.Description, row.SignedAmount, row.Fingerprint,
                    Categories.FirstOrDefault() ?? "Inne")).ToList();
            if (StatementRows.Count == 0) { ShowToast("Nie znaleziono nowych operacji — duplikaty zostały pominięte."); return; }
            foreach (var row in StatementRows) row.PropertyChanged += (_, _) => OnPropertyChanged(nameof(SelectedStatementCount));
            Editor.Reset(EditorKind.Statement, "Podgląd importu");
            OnPropertyChanged(nameof(SelectedStatementCount));
        }
        catch (Exception ex) { ShowToast($"Nie udało się odczytać wyciągu: {ex.Message}"); }
    }

    private async Task ExportAsync()
    {
        var path = await _platform.PickSaveFileAsync("Eksport kopii danych", $"portfel-{DateTime.Now:yyyyMMdd}", "json");
        if (path is null) return;
        try { await _store.ExportJsonAsync(_state, path); ShowToast("Wyeksportowano pełną kopię danych."); }
        catch (Exception ex) { ShowToast($"Eksport nie powiódł się: {ex.Message}"); }
    }

    private async Task ImportAsync()
    {
        var path = await _platform.PickOpenFileAsync("Import kopii programu Portfel", ["*.json"]);
        if (path is null) return;
        try
        {
            _pendingImport = await _store.ImportJsonAsync(path);
            Confirm("Import zastąpi aktualne dane w programie. Przed zmianą możesz kliknąć Anuluj i wykonać eksport. Kontynuować?", ApplyPendingImport);
        }
        catch (Exception ex) { ShowToast($"Import nie powiódł się: {ex.Message}"); }
    }

    private void RestoreBackup(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        _ = RestoreBackupCoreAsync(path);
    }

    private async Task RestoreBackupCoreAsync(string path)
    {
        try
        {
            _pendingImport = await _store.RestoreBackupAsync(path);
            Confirm("Przywrócić tę kopię? Aktualne niezapisane zmiany zostaną zastąpione.", ApplyPendingImport);
        }
        catch (Exception ex) { ShowToast($"Nie udało się odczytać kopii: {ex.Message}"); }
    }

    private void ApplyPendingImport()
    {
        if (_pendingImport is null) return;
        _state = _pendingImport;
        _pendingImport = null;
        _selectedYear = _state.Settings.CurrentYear;
        _selectedMonth = _selectedYear == DateTime.Today.Year ? DateTime.Today.Month : 1;
        ThemeChanged?.Invoke(_state.Settings.Theme);
        MarkDirty("Wczytano dane — kliknij Zapisz, aby zatwierdzić");
        OnPropertiesChanged(nameof(SelectedYear), nameof(SelectedMonth), nameof(CategoriesText));
        Refresh();
    }

    private TransactionRow TransactionDisplay(Transaction item)
    {
        var account = _state.Accounts.FirstOrDefault(account => account.Id == item.AccountId)?.Name ?? "Nieznane źródło";
        var target = item.Type is TransactionType.GoalContribution or TransactionType.GoalWithdrawal
            ? _state.Goals.FirstOrDefault(goal => goal.Id == item.TargetId)?.Name
            : item.Type == TransactionType.DebtPayment
                ? _state.Debts.FirstOrDefault(debt => debt.Id == item.TargetId)?.Name
                : null;
        var title = string.IsNullOrWhiteSpace(item.Description) ? target ?? TransactionTypeLabel(item.Type) : item.Description;
        var subtitle = target is not null ? $"{target} • {account}" : item.Type == TransactionType.Transfer
            ? $"{account} → {_state.Accounts.FirstOrDefault(value => value.Id == item.ToAccountId)?.Name ?? "konto"}"
            : $"{(string.IsNullOrWhiteSpace(item.Category) ? TransactionTypeLabel(item.Type) : item.Category)} • {account}";
        var positive = item.Type is TransactionType.Income or TransactionType.GoalWithdrawal or TransactionType.ReserveOut;
        var neutral = item.Type == TransactionType.Transfer;
        var sign = neutral ? "" : positive ? "+" : "−";
        return new TransactionRow(item.Id, item.Date.ToString("dd.MM.yyyy"), title, subtitle,
            $"{sign}{Money(item.Amount)}", neutral ? "neutral" : positive ? "positive" : "negative",
            TransactionTypeLabel(item.Type), account, positive, !positive && !neutral);
    }

    private void Confirm(string message, Action action)
    {
        _confirmAction = action;
        Editor.Reset(EditorKind.Confirm, "Potwierdź zmianę");
        Editor.ConfirmMessage = message;
    }

    private void MarkDirty(string message)
    {
        IsDirty = true;
        ShowToast($"{message}. Kliknij „Zapisz”.");
    }

    private void ShowToast(string message)
    {
        Toast = message;
        OnPropertyChanged(nameof(HasToast));
    }

    private void Refresh()
    {
        OnPropertiesChanged(nameof(AvailableBalance), nameof(MonthIncome), nameof(MonthExpenses),
            nameof(MonthTargets), nameof(MonthNet), nameof(MonthNetClass), nameof(IsMonthNetPositive),
            nameof(IsMonthNetNegative), nameof(CurrentMonthLabel), nameof(SelectedMonthChoice),
            nameof(GoalsSaved), nameof(GoalsTarget), nameof(GoalsRemaining), nameof(GoalsRecommended),
            nameof(CompletedGoals), nameof(DebtsRemaining), nameof(DebtsPaid), nameof(DebtsTotal),
            nameof(DebtsRecommended), nameof(CompletedDebts),
            nameof(ActiveGoals), nameof(ActiveDebts), nameof(Allowance), nameof(DailyAllowance),
            nameof(WeeklyAllowance), nameof(AllowanceDetail), nameof(Transactions), nameof(HasTransactions),
            nameof(RecentTransactions), nameof(HasRecentTransactions), nameof(GoalCards), nameof(HasGoals),
            nameof(DebtCards), nameof(HasDebts), nameof(AccountCards), nameof(AccountChoices),
            nameof(RecurringCards), nameof(HasRecurring), nameof(BudgetCards), nameof(HasBudgets),
            nameof(Alerts), nameof(HasAlerts), nameof(AnnualBars), nameof(AnnualIncome), nameof(AnnualOutflow),
            nameof(AnnualNet), nameof(CategorySlices), nameof(HasCategorySlices), nameof(Categories), nameof(GoalChoices), nameof(DebtChoices),
            nameof(TransactionTargetChoices), nameof(HasBankAccount), nameof(BankAccountsEnabled),
            nameof(StatementImportEnabled), nameof(AlertsEnabled), nameof(InterestEnabled),
            nameof(SpendingLimitsEnabled), nameof(RecurringEnabled), nameof(EnvelopesEnabled),
            nameof(ForecastEnabled), nameof(ShowCents), nameof(PaydayDay), nameof(Backups), nameof(HasBackups));
    }

    private string Money(decimal amount) => _state.Settings.ShowCents
        ? string.Format(Polish, "{0:N2} zł", amount)
        : string.Format(Polish, "{0:N0} zł", amount);
    private static string InputMoney(decimal amount) => amount.ToString("0.##", Polish);
    private static decimal RequireMoney(string value, string error) => TryMoney(value, out var amount) && amount > 0 ? amount : throw new InvalidOperationException(error);
    private static bool TryMoney(string? value, out decimal amount) => decimal.TryParse(value, NumberStyles.Number, Polish, out amount)
        || decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out amount);
    private static ChoiceItem? FindChoice(IEnumerable<ChoiceItem> choices, string id) => choices.FirstOrDefault(item => item.Key == id);
    private static string DeadlineLabel(DateOnly? value) => value is null ? "Bez terminu" : $"Termin {value:dd.MM.yyyy}";
    private static string StatusClass(bool overdue, bool complete) => complete ? "good" : overdue ? "danger" : "normal";
    private static string GoalStatus(GoalProgress info) => info.Remaining == 0 ? "Cel osiągnięty" : info.IsOverdue ? "Po terminie" : info.IsCapped ? "Plan wymaga korekty" : "W trakcie";
    private static string DebtStatus(DebtProgress info) => info.Remaining == 0 ? "Spłacony" : info.IsOverdue ? "Po terminie" : "W trakcie";
    private static string TransactionTypeLabel(TransactionType type) => type switch
    {
        TransactionType.Income => "Wpływ",
        TransactionType.Expense => "Wydatek",
        TransactionType.GoalContribution => "Wpłata na cel",
        TransactionType.GoalWithdrawal => "Wypłata z celu",
        TransactionType.DebtPayment => "Spłata długu",
        TransactionType.Transfer => "Przelew między kontami",
        TransactionType.ReserveIn => "Wpłata do rezerwy",
        TransactionType.ReserveOut => "Wypłata z rezerwy",
        _ => "Operacja"
    };
}

internal static class TextExtensions
{
    public static string Capitalize(this string value) => string.IsNullOrEmpty(value) ? value : char.ToUpper(value[0], PolishCulture) + value[1..];
    private static readonly CultureInfo PolishCulture = CultureInfo.GetCultureInfo("pl-PL");
}
