namespace Portfel.ViewModels;

public enum EditorKind { None, Transaction, Goal, Debt, Account, Recurring, Budget, Statement, Confirm }

public sealed class EditorViewModel : ViewModelBase
{
    private EditorKind _kind;
    private string _entityId = "";
    private string _title = "";
    private string _name = "";
    private string _amount = "";
    private string _secondaryAmount = "";
    private string _apr = "";
    private string _maxContribution = "";
    private string _description = "";
    private string _note = "";
    private string _selectedType = "expense";
    private string _selectedCategory = "Inne";
    private ChoiceItem? _selectedAccount;
    private ChoiceItem? _selectedToAccount;
    private ChoiceItem? _selectedTarget;
    private string _selectedCadence = "monthly";
    private DateTimeOffset? _date = DateTimeOffset.Now;
    private DateTimeOffset? _startDate = DateTimeOffset.Now;
    private DateTimeOffset? _deadline;
    private DateTimeOffset? _endDate;
    private int _day = 1;
    private bool _toggle = true;
    private bool _interestEnabled;
    private bool _alertsEnabled = true;
    private string _error = "";
    private string _confirmMessage = "";

    public EditorKind Kind { get => _kind; set { if (SetProperty(ref _kind, value)) RaiseKinds(); } }
    public bool IsOpen => Kind != EditorKind.None;
    public bool IsTransaction => Kind == EditorKind.Transaction;
    public bool IsGoal => Kind == EditorKind.Goal;
    public bool IsDebt => Kind == EditorKind.Debt;
    public bool IsAccount => Kind == EditorKind.Account;
    public bool IsRecurring => Kind == EditorKind.Recurring;
    public bool IsBudget => Kind == EditorKind.Budget;
    public bool IsStatement => Kind == EditorKind.Statement;
    public bool IsConfirm => Kind == EditorKind.Confirm;
    public string EntityId { get => _entityId; set => SetProperty(ref _entityId, value); }
    public string Title { get => _title; set => SetProperty(ref _title, value); }
    public string Name { get => _name; set => SetProperty(ref _name, value); }
    public string Amount { get => _amount; set => SetProperty(ref _amount, value); }
    public string SecondaryAmount { get => _secondaryAmount; set => SetProperty(ref _secondaryAmount, value); }
    public string Apr { get => _apr; set => SetProperty(ref _apr, value); }
    public string MaxContribution { get => _maxContribution; set => SetProperty(ref _maxContribution, value); }
    public string Description { get => _description; set => SetProperty(ref _description, value); }
    public string Note { get => _note; set => SetProperty(ref _note, value); }
    public string SelectedType { get => _selectedType; set => SetProperty(ref _selectedType, value); }
    public string SelectedCategory { get => _selectedCategory; set => SetProperty(ref _selectedCategory, value); }
    public ChoiceItem? SelectedAccount { get => _selectedAccount; set => SetProperty(ref _selectedAccount, value); }
    public ChoiceItem? SelectedToAccount { get => _selectedToAccount; set => SetProperty(ref _selectedToAccount, value); }
    public ChoiceItem? SelectedTarget { get => _selectedTarget; set => SetProperty(ref _selectedTarget, value); }
    public string SelectedCadence { get => _selectedCadence; set => SetProperty(ref _selectedCadence, value); }
    public DateTimeOffset? Date { get => _date; set => SetProperty(ref _date, value); }
    public DateTimeOffset? StartDate { get => _startDate; set => SetProperty(ref _startDate, value); }
    public DateTimeOffset? Deadline { get => _deadline; set => SetProperty(ref _deadline, value); }
    public DateTimeOffset? EndDate { get => _endDate; set => SetProperty(ref _endDate, value); }
    public int Day { get => _day; set => SetProperty(ref _day, value); }
    public bool Toggle { get => _toggle; set => SetProperty(ref _toggle, value); }
    public bool InterestEnabled { get => _interestEnabled; set => SetProperty(ref _interestEnabled, value); }
    public bool AlertsEnabled { get => _alertsEnabled; set => SetProperty(ref _alertsEnabled, value); }
    public string Error { get => _error; set => SetProperty(ref _error, value); }
    public string ConfirmMessage { get => _confirmMessage; set => SetProperty(ref _confirmMessage, value); }

    public void Close()
    {
        Error = "";
        Kind = EditorKind.None;
    }

    public void Reset(EditorKind kind, string title)
    {
        _entityId = "";
        _name = "";
        _amount = "";
        _secondaryAmount = "";
        _apr = "";
        _maxContribution = "";
        _description = "";
        _note = "";
        _selectedType = "expense";
        _selectedCategory = "Inne";
        _selectedAccount = null;
        _selectedToAccount = null;
        _selectedTarget = null;
        _selectedCadence = "monthly";
        _date = DateTimeOffset.Now;
        _startDate = DateTimeOffset.Now;
        _deadline = null;
        _endDate = null;
        _day = 1;
        _toggle = true;
        _interestEnabled = false;
        _alertsEnabled = true;
        _error = "";
        _confirmMessage = "";
        _title = title;
        Kind = kind;
        OnPropertiesChanged(nameof(EntityId), nameof(Name), nameof(Amount), nameof(SecondaryAmount),
            nameof(Apr), nameof(MaxContribution), nameof(Description), nameof(Note), nameof(SelectedType),
            nameof(SelectedCategory), nameof(SelectedAccount), nameof(SelectedToAccount),
            nameof(SelectedTarget), nameof(SelectedCadence), nameof(Date), nameof(StartDate),
            nameof(Deadline), nameof(EndDate), nameof(Day), nameof(Toggle), nameof(InterestEnabled),
            nameof(AlertsEnabled), nameof(Error), nameof(ConfirmMessage), nameof(Title));
    }

    private void RaiseKinds() => OnPropertiesChanged(nameof(IsOpen), nameof(IsTransaction), nameof(IsGoal),
        nameof(IsDebt), nameof(IsAccount), nameof(IsRecurring), nameof(IsBudget), nameof(IsStatement),
        nameof(IsConfirm));
}
