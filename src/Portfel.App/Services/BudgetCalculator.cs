using Portfel.Models;

namespace Portfel.Services;

public sealed class BudgetCalculator
{
    public MonthSummary Month(BudgetState state, int year, int month)
    {
        var entries = state.Transactions.Where(item => item.Date.Year == year && item.Date.Month == month);
        decimal income = 0, expenses = 0, goals = 0, withdrawals = 0, debts = 0;
        foreach (var item in entries)
        {
            switch (item.Type)
            {
                case TransactionType.Income: income += item.Amount; break;
                case TransactionType.Expense: expenses += item.Amount; break;
                case TransactionType.GoalContribution: goals += item.Amount; break;
                case TransactionType.GoalWithdrawal: withdrawals += item.Amount; break;
                case TransactionType.DebtPayment: debts += item.Amount; break;
            }
        }
        return new MonthSummary(income, expenses, goals, withdrawals, debts,
            income - expenses - goals + withdrawals - debts);
    }

    public decimal AccountBalance(BudgetState state, Account account)
    {
        var balance = account.OpeningBalance;
        foreach (var item in state.Transactions)
        {
            if (item.Type == TransactionType.Transfer)
            {
                if (item.AccountId == account.Id) balance -= item.Amount;
                if (item.ToAccountId == account.Id) balance += item.Amount;
                continue;
            }
            if (item.AccountId != account.Id) continue;
            balance += item.Type switch
            {
                TransactionType.Income or TransactionType.GoalWithdrawal or TransactionType.ReserveOut => item.Amount,
                TransactionType.Expense or TransactionType.GoalContribution or TransactionType.DebtPayment or TransactionType.ReserveIn => -item.Amount,
                _ => 0m
            };
        }
        return balance;
    }

    public decimal TotalAvailable(BudgetState state) => state.Accounts
        .Where(account => account.IsActive)
        .Sum(account => AccountBalance(state, account));

    public decimal GoalSaved(BudgetState state, Goal goal) => state.Transactions
        .Where(item => item.TargetId == goal.Id)
        .Sum(item => item.Type switch
        {
            TransactionType.GoalContribution => item.Amount,
            TransactionType.GoalWithdrawal => -item.Amount,
            _ => 0m
        });

    public GoalProgress Goal(BudgetState state, Goal goal, DateOnly? asOf = null)
    {
        var today = asOf ?? DateOnly.FromDateTime(DateTime.Today);
        var saved = Math.Max(0m, GoalSaved(state, goal));
        var remaining = Math.Max(0m, goal.Target - saved);
        var periods = CountGoalPeriods(goal, today);
        var recommended = remaining <= 0 ? 0 : periods > 0 ? RoundUp(remaining / periods) : remaining;
        var capped = goal.MaxContribution is > 0 && recommended > goal.MaxContribution.Value;
        var overdue = remaining > 0 && goal.Deadline is { } deadline && deadline < today;
        var progress = goal.Target <= 0 ? 0 : Math.Clamp(saved / goal.Target * 100m, 0m, 100m);
        return new GoalProgress(saved, remaining, periods, recommended, progress, overdue, capped);
    }

    public decimal DebtPaid(BudgetState state, Debt debt) => state.Transactions
        .Where(item => item.Type == TransactionType.DebtPayment && item.TargetId == debt.Id)
        .Sum(item => item.Amount);

    public DebtProgress Debt(BudgetState state, Debt debt, DateOnly? asOf = null)
    {
        var today = asOf ?? DateOnly.FromDateTime(DateTime.Today);
        var paid = Math.Min(debt.Total, DebtPaid(state, debt));
        var principal = Math.Max(0m, debt.Total - paid);
        var months = debt.Deadline is { } due && due >= today ? MonthsInclusive(today, due, debt.PaymentDay) : 0;
        var monthlyRate = state.Settings.InterestEnabled && debt.InterestEnabled && debt.Apr > 0 ? debt.Apr / 100m / 12m : 0m;
        var estimatedInterest = monthlyRate == 0 || months == 0
            ? 0m
            : principal * monthlyRate * months;
        var projected = principal + estimatedInterest;
        var recommended = months > 0 ? RoundUp(projected / months) : principal;
        recommended = Math.Max(recommended, Math.Min(debt.MinimumPayment, projected));
        var overdue = principal > 0 && debt.Deadline is { } deadline && deadline < today;
        var progress = debt.Total <= 0 ? 0 : Math.Clamp(paid / debt.Total * 100m, 0m, 100m);
        return new DebtProgress(paid, principal, estimatedInterest, recommended, progress, overdue, months);
    }

    public SpendingAllowance Spending(BudgetState state, DateOnly? asOf = null)
    {
        var today = asOf ?? DateOnly.FromDateTime(DateTime.Today);
        var nextPayday = NextPayday(today, state.Settings.PaydayDay);
        var days = Math.Max(1, nextPayday.DayNumber - today.DayNumber);
        var committed = state.Settings.RecurringEnabled && state.Settings.ForecastEnabled
            ? state.Recurring.Where(item => item.IsActive && item.Type == RecurringType.Expense)
                .Sum(item => Occurrences(item, today, nextPayday).Count * item.Amount)
            : 0m;
        var available = Math.Max(0m, TotalAvailable(state) - committed);
        return new SpendingAllowance(available, committed, days, available / days, available / days * 7m, nextPayday);
    }

    public IReadOnlyList<DateOnly> Occurrences(RecurringEntry entry, DateOnly start, DateOnly end)
    {
        var results = new List<DateOnly>();
        if (!entry.IsActive || end < entry.StartDate) return results;
        var from = start > entry.StartDate ? start : entry.StartDate;
        var until = entry.EndDate is { } finish && finish < end ? finish : end;
        if (until < from) return results;

        if (entry.Cadence == RecurringCadence.Weekly)
        {
            var wanted = Math.Clamp(entry.Day, 1, 7);
            var cursor = from;
            while ((int)cursor.DayOfWeek != wanted % 7) cursor = cursor.AddDays(1);
            for (; cursor <= until; cursor = cursor.AddDays(7)) results.Add(cursor);
            return results;
        }

        var current = new DateOnly(from.Year, from.Month, Math.Min(entry.Day, DateTime.DaysInMonth(from.Year, from.Month)));
        if (current < from) current = MonthDate(current.AddMonths(1), entry.Day);
        for (; current <= until; current = MonthDate(current.AddMonths(1), entry.Day)) results.Add(current);
        return results;
    }

    private static int CountGoalPeriods(Goal goal, DateOnly today)
    {
        if (goal.Deadline is not { } deadline || deadline < today) return 0;
        if (goal.Cadence == ContributionCadence.Weekly)
            return Math.Max(1, (deadline.DayNumber - today.DayNumber) / 7 + 1);
        return MonthsInclusive(today, deadline, goal.PaymentDay);
    }

    private static int MonthsInclusive(DateOnly start, DateOnly end, int day)
    {
        var count = 0;
        var cursor = MonthDate(start, day);
        if (cursor < start) cursor = MonthDate(cursor.AddMonths(1), day);
        while (cursor <= end)
        {
            count++;
            cursor = MonthDate(cursor.AddMonths(1), day);
        }
        return count;
    }

    private static DateOnly MonthDate(DateOnly month, int day) =>
        new(month.Year, month.Month, Math.Min(Math.Clamp(day, 1, 31), DateTime.DaysInMonth(month.Year, month.Month)));

    private static DateOnly NextPayday(DateOnly today, int requestedDay)
    {
        var payday = MonthDate(today, requestedDay);
        return payday > today ? payday : MonthDate(today.AddMonths(1), requestedDay);
    }

    private static decimal RoundUp(decimal value) => Math.Ceiling(value * 100m) / 100m;
}

public sealed record MonthSummary(decimal Income, decimal Expenses, decimal GoalContributions,
    decimal GoalWithdrawals, decimal DebtPayments, decimal Net);

public sealed record GoalProgress(decimal Saved, decimal Remaining, int Periods, decimal Recommended,
    decimal Percent, bool IsOverdue, bool IsCapped);

public sealed record DebtProgress(decimal Paid, decimal Remaining, decimal EstimatedInterest,
    decimal Recommended, decimal Percent, bool IsOverdue, int Months);

public sealed record SpendingAllowance(decimal AvailableAfterCommitments, decimal Commitments,
    int Days, decimal Daily, decimal Weekly, DateOnly NextPayday);
