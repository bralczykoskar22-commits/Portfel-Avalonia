using Portfel.Models;
using Portfel.Services;

namespace Portfel.Tests;

public sealed class BudgetCalculatorTests
{
    private readonly BudgetCalculator _calculator = new();

    [Fact]
    public void Goal_plan_recalculates_after_contribution_and_withdrawal()
    {
        var state = BudgetState.CreateEmpty();
        var goal = new Goal
        {
            Name = "Poduszka",
            Target = 1200m,
            StartDate = new DateOnly(2026, 1, 1),
            Deadline = new DateOnly(2026, 3, 31),
            PaymentDay = 10
        };
        state.Goals.Add(goal);
        state.Transactions.Add(new Transaction { Type = TransactionType.GoalContribution, TargetId = goal.Id, Amount = 400m });
        state.Transactions.Add(new Transaction { Type = TransactionType.GoalWithdrawal, TargetId = goal.Id, Amount = 100m });

        var result = _calculator.Goal(state, goal, new DateOnly(2026, 1, 1));

        Assert.Equal(300m, result.Saved);
        Assert.Equal(900m, result.Remaining);
        Assert.Equal(3, result.Periods);
        Assert.Equal(300m, result.Recommended);
    }

    [Fact]
    public void Debt_payment_reduces_remaining_amount()
    {
        var state = BudgetState.CreateEmpty();
        var debt = new Debt { Name = "Pożyczka", Total = 5000m, InterestEnabled = false };
        state.Debts.Add(debt);
        state.Transactions.Add(new Transaction { Type = TransactionType.DebtPayment, TargetId = debt.Id, Amount = 1250m });

        var result = _calculator.Debt(state, debt, new DateOnly(2026, 1, 1));

        Assert.Equal(1250m, result.Paid);
        Assert.Equal(3750m, result.Remaining);
        Assert.Equal(0m, result.EstimatedInterest);
    }

    [Fact]
    public void Transfer_changes_accounts_but_not_total_balance()
    {
        var state = BudgetState.CreateEmpty();
        var cash = state.Accounts[0];
        cash.OpeningBalance = 1000m;
        var bank = new Account { Name = "Bank", Type = AccountType.Bank, OpeningBalance = 500m };
        state.Accounts.Add(bank);
        state.Transactions.Add(new Transaction
        {
            Type = TransactionType.Transfer,
            AccountId = cash.Id,
            ToAccountId = bank.Id,
            Amount = 300m
        });

        Assert.Equal(700m, _calculator.AccountBalance(state, cash));
        Assert.Equal(800m, _calculator.AccountBalance(state, bank));
        Assert.Equal(1500m, _calculator.TotalAvailable(state));
    }

    [Fact]
    public void Month_summary_does_not_treat_transfer_as_expense()
    {
        var state = BudgetState.CreateEmpty();
        state.Transactions.Add(new Transaction { Date = new DateOnly(2026, 5, 1), Type = TransactionType.Income, Amount = 5000m });
        state.Transactions.Add(new Transaction { Date = new DateOnly(2026, 5, 2), Type = TransactionType.Expense, Amount = 1200m });
        state.Transactions.Add(new Transaction { Date = new DateOnly(2026, 5, 3), Type = TransactionType.Transfer, Amount = 900m });

        var result = _calculator.Month(state, 2026, 5);

        Assert.Equal(5000m, result.Income);
        Assert.Equal(1200m, result.Expenses);
        Assert.Equal(3800m, result.Net);
    }
}

