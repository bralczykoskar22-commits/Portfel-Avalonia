(function () {
  "use strict";

  var desktop = window.portfelDesktop || null;
  var API_URL = "/api/data";
  var BACKUPS_URL = "/api/backups";
  var RESTORE_URL = "/api/restore";
  var MONTHS = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];
  var MONTHS_SHORT = ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze", "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru"];
  var DEFAULT_CATEGORIES = [
    "Wypłata", "Dodatkowy wpływ", "Mieszkanie", "Rachunki", "Żywność",
    "Transport", "Zdrowie", "Ubezpieczenia", "Spłata długów", "Dom",
    "Odzież", "Dzieci", "Zwierzęta", "Rozrywka", "Rozwój",
    "Prezenty", "Podróże", "Inne"
  ];
  var TYPE_LABELS = {
    income: "Wpływ",
    expense: "Wydatek",
    goal: "Wpłata na cel",
    goal_withdraw: "Wypłata z celu",
    debt: "Wpłata na dług",
    reserve_in: "Do rezerwy",
    reserve_out: "Z rezerwy",
    transfer: "Transfer"
  };
  var PAGE_META = {
    dashboard: ["Podsumowanie", "Roczny widok"],
    months: ["Miesiące", "Rejestr gotówki"],
    goals: ["Cele", "Oszczędzanie"],
    debts: ["Długi", "Spłacanie"],
    plan: ["Plan", "Kalendarz i automatyzacja"],
    analytics: ["Analizy", "Prognoza i raporty"],
    accounts: ["Konta", "Gotówka i bank"],
    settings: ["Ustawienia", "Lokalne dane"]
  };
  var DEFAULT_MODULES = {
    bankAccounts: false,
    statementImport: false,
    alerts: true,
    dailyLimit: true,
    weeklyLimit: true,
    interest: true,
    recurring: true,
    categoryBudgets: true
  };
  var CADENCE_LABELS = {
    monthly: "co miesiąc",
    weekly: "co tydzień",
    payday: "przy wypłacie"
  };
  var moneyFormatter = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });
  var dateFormatter = new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
  var dateTimeFormatter = new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  var toastTimer = null;
  var backups = [];
  var data = null;
  var dirty = false;
  var saving = false;
  var appInfo = null;
  var updateStatus = null;
  var state = {
    page: "dashboard",
    month: 0,
    planMonth: 0,
    editingTransaction: null,
    editingGoal: null,
    editingDebt: null,
    editingRecurring: null,
    editingBudget: null,
    editingAccount: null,
    transactionPreset: null,
    statementPreview: null
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function $$(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function money(value) {
    return moneyFormatter.format(number(value));
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return prefix + "-" + window.crypto.randomUUID();
    }
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function dateFromISO(value) {
    if (!value) return null;
    var date = new Date(value + "T00:00:00");
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isoDate(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function formattedDate(value) {
    var date = dateFromISO(value);
    return date ? dateFormatter.format(date) : "Bez terminu";
  }

  function formattedDateTime(value) {
    if (!value) return "Jeszcze nie zapisano";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Jeszcze nie zapisano";
    return dateTimeFormatter.format(date);
  }

  function startOfToday() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function startOfMonth(year, month) {
    return new Date(year, month, 1);
  }

  function endOfMonth(year, month) {
    return new Date(year, month + 1, 0);
  }

  function clampDate(year, month, day) {
    return new Date(year, month, Math.min(Math.max(1, day), endOfMonth(year, month).getDate()));
  }

  function addDays(date, count) {
    var copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    copy.setDate(copy.getDate() + count);
    return copy;
  }

  function addMonths(date, count) {
    return clampDate(date.getFullYear(), date.getMonth() + count, date.getDate());
  }

  function inRange(date, start, end) {
    return date && date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
  }

  function scheduleDates(cadence, day, scheduleStart, scheduleEnd, rangeStart, rangeEnd) {
    var first = dateFromISO(scheduleStart) || rangeStart;
    var last = dateFromISO(scheduleEnd) || rangeEnd;
    var start = first.getTime() > rangeStart.getTime() ? first : rangeStart;
    var end = last.getTime() < rangeEnd.getTime() ? last : rangeEnd;
    if (start.getTime() > end.getTime()) return [];
    var dates = [];
    if (cadence === "weekly") {
      var wantedDay = Math.min(7, Math.max(1, Math.round(number(day) || 1)));
      var current = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      var currentDay = ((current.getDay() + 6) % 7) + 1;
      current = addDays(current, (wantedDay - currentDay + 7) % 7);
      while (current.getTime() <= end.getTime()) {
        dates.push(new Date(current.getTime()));
        current = addDays(current, 7);
      }
      return dates;
    }
    var cursor = startOfMonth(start.getFullYear(), start.getMonth());
    while (cursor.getTime() <= end.getTime()) {
      var monthlyDate = clampDate(cursor.getFullYear(), cursor.getMonth(), Math.round(number(day) || 1));
      if (inRange(monthlyDate, start, end)) dates.push(monthlyDate);
      cursor = startOfMonth(cursor.getFullYear(), cursor.getMonth() + 1);
    }
    return dates;
  }

  function recurringOccurrences(recurring, rangeStart, rangeEnd) {
    if (!recurring.active) return [];
    return scheduleDates(
      recurring.cadence,
      recurring.day,
      recurring.startDate,
      recurring.endDate,
      rangeStart,
      rangeEnd
    );
  }

  function goalScheduleDates(goal, rangeStart, rangeEnd) {
    var deadline = dateFromISO(goal.deadline);
    if (!deadline || rangeStart.getTime() > deadline.getTime()) return [];
    var limitedEnd = rangeEnd.getTime() < deadline.getTime() ? rangeEnd : deadline;
    if (goal.cadence === "payday") {
      var keys = {};
      data.recurring.filter(function (item) {
        return item.active && item.type === "income" && (!goal.paydayRecurringId || item.id === goal.paydayRecurringId);
      }).forEach(function (item) {
        recurringOccurrences(item, rangeStart, limitedEnd).forEach(function (date) {
          keys[isoDate(date)] = date;
        });
      });
      return Object.keys(keys).sort().map(function (key) { return keys[key]; });
    }
    return scheduleDates(goal.cadence, goal.paymentDay, goal.startDate, goal.deadline, rangeStart, limitedEnd);
  }

  function debtScheduleDates(debt, rangeStart, rangeEnd) {
    return scheduleDates("monthly", debt.paymentDay, String(debt.createdAt || "").slice(0, 10), debt.deadline, rangeStart, rangeEnd);
  }

  function uniqueLines(value) {
    var seen = {};
    return String(value || "")
      .split(/\r?\n/)
      .map(function (item) { return item.trim(); })
      .filter(function (item) {
        var key = item.toLocaleLowerCase("pl");
        if (!item || seen[key]) return false;
        seen[key] = true;
        return true;
      });
  }

  function freshData() {
    var year = new Date().getFullYear();
    var balances = {};
    balances[String(year)] = { available: 0, reserve: 0 };
    return {
      version: 4,
      meta: { savedAt: null, createdAt: new Date().toISOString() },
      settings: {
        currentYear: year,
        theme: "light",
        currency: "PLN",
        balances: balances,
        categories: DEFAULT_CATEGORIES.slice(),
        modules: Object.assign({}, DEFAULT_MODULES),
        payday: { day: 10, nextDate: "" }
      },
      accounts: [{
        id: "cash-main",
        name: "Gotówka",
        type: "cash",
        currency: "PLN",
        openingBalances: (function () { var values = {}; values[String(year)] = 0; return values; }()),
        active: true,
        includeInSpendingLimit: true,
        createdAt: new Date().toISOString()
      }],
      goals: [],
      debts: [],
      recurring: [],
      budgets: [],
      transactions: []
    };
  }

  function normalizeData(raw) {
    var base = freshData();
    if (!raw || typeof raw !== "object") return base;
    var settings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
    var year = Math.min(2100, Math.max(2020, Math.round(number(settings.currentYear) || base.settings.currentYear)));
    var balances = settings.balances && typeof settings.balances === "object" ? settings.balances : {};
    if (!balances[String(year)]) balances[String(year)] = { available: 0, reserve: 0 };
    Object.keys(balances).forEach(function (key) {
      var balance = balances[key] && typeof balances[key] === "object" ? balances[key] : {};
      balances[key] = {
        available: Math.max(0, number(balance.available)),
        reserve: Math.max(0, number(balance.reserve))
      };
    });
    var categories = Array.isArray(settings.categories) ? settings.categories.map(String).filter(Boolean) : [];
    var modules = Object.assign({}, DEFAULT_MODULES, settings.modules && typeof settings.modules === "object" ? settings.modules : {});
    if (!modules.bankAccounts) modules.statementImport = false;
    var paydayRaw = settings.payday && typeof settings.payday === "object" ? settings.payday : {};
    var payday = {
      day: Math.min(31, Math.max(1, Math.round(number(paydayRaw.day) || 10))),
      nextDate: String(paydayRaw.nextDate || "")
    };
    var today = isoDate(new Date());
    var goals = Array.isArray(raw.goals) ? raw.goals.filter(Boolean).map(function (item) {
      var createdDate = String(item.createdAt || "").slice(0, 10);
      return {
        id: String(item.id || uid("goal")),
        name: String(item.name || "Cel"),
        target: Math.max(0, number(item.target)),
        deadline: String(item.deadline || ""),
        startDate: String(item.startDate || createdDate || today),
        cadence: item.cadence === "weekly" || item.cadence === "payday" ? item.cadence : "monthly",
        paymentDay: Math.min(31, Math.max(1, Math.round(number(item.paymentDay) || 1))),
        paydayRecurringId: String(item.paydayRecurringId || ""),
        maxContribution: Math.max(0, number(item.maxContribution)),
        createdAt: String(item.createdAt || new Date().toISOString())
      };
    }) : [];
    var debts = Array.isArray(raw.debts) ? raw.debts.filter(Boolean).map(function (item) {
      return {
        id: String(item.id || uid("debt")),
        name: String(item.name || "Dług"),
        total: Math.max(0, number(item.total)),
        deadline: String(item.deadline || ""),
        apr: Math.max(0, number(item.apr)),
        interestEnabled: item.interestEnabled !== false && number(item.apr) > 0,
        minimumPayment: Math.max(0, number(item.minimumPayment)),
        paymentDay: Math.min(31, Math.max(1, Math.round(number(item.paymentDay) || 1))),
        createdAt: String(item.createdAt || new Date().toISOString())
      };
    }) : [];
    var rawAccounts = Array.isArray(raw.accounts) ? raw.accounts.filter(Boolean) : [];
    if (!rawAccounts.length) {
      rawAccounts = [{
        id: "cash-main",
        name: "Gotówka",
        type: "cash",
        currency: "PLN",
        openingBalances: (function () { var values = {}; values[String(year)] = number(balances[String(year)].available); return values; }()),
        active: true,
        includeInSpendingLimit: true,
        createdAt: new Date().toISOString()
      }];
    }
    var accounts = rawAccounts.map(function (item, index) {
      var type = item.type === "bank" || item.type === "savings" ? item.type : "cash";
      var openings = item.openingBalances && typeof item.openingBalances === "object" ? item.openingBalances : {};
      if (openings[String(year)] == null) openings[String(year)] = index === 0 ? number(balances[String(year)].available) : 0;
      Object.keys(openings).forEach(function (key) { openings[key] = number(openings[key]); });
      return {
        id: String(item.id || (index === 0 ? "cash-main" : uid("account"))),
        name: String(item.name || (type === "cash" ? "Gotówka" : "Konto bankowe")),
        type: type,
        currency: "PLN",
        openingBalances: openings,
        active: item.active !== false,
        includeInSpendingLimit: item.includeInSpendingLimit !== false,
        createdAt: String(item.createdAt || new Date().toISOString())
      };
    });
    var defaultAccountId = (accounts.find(function (item) { return item.type === "cash"; }) || accounts[0]).id;
    var recurring = Array.isArray(raw.recurring) ? raw.recurring.filter(Boolean).map(function (item) {
      return {
        id: String(item.id || uid("rec")),
        name: String(item.name || "Cykliczny wpis"),
        type: item.type === "income" ? "income" : "expense",
        amount: Math.max(0, number(item.amount)),
        category: String(item.category || base.settings.categories[0]),
        accountId: String(item.accountId || defaultAccountId),
        cadence: item.cadence === "weekly" ? "weekly" : "monthly",
        day: Math.min(item.cadence === "weekly" ? 7 : 31, Math.max(1, Math.round(number(item.day) || 1))),
        startDate: String(item.startDate || today),
        endDate: String(item.endDate || ""),
        active: item.active !== false,
        createdAt: String(item.createdAt || new Date().toISOString())
      };
    }) : [];
    var budgets = Array.isArray(raw.budgets) ? raw.budgets.filter(Boolean).map(function (item) {
      return {
        id: String(item.id || uid("budget")),
        category: String(item.category || "Inne"),
        limit: Math.max(0, number(item.limit)),
        createdAt: String(item.createdAt || new Date().toISOString())
      };
    }) : [];
    var transactions = Array.isArray(raw.transactions) ? raw.transactions.filter(Boolean).map(function (item) {
      return {
        id: String(item.id || uid("tx")),
        date: String(item.date || today),
        type: String(item.type || "expense"),
        category: String(item.category || ""),
        targetId: String(item.targetId || ""),
        recurringId: String(item.recurringId || ""),
        scheduledDate: String(item.scheduledDate || ""),
        description: String(item.description || ""),
        amount: Math.max(0, number(item.amount)),
        note: String(item.note || ""),
        accountId: String(item.accountId || defaultAccountId),
        toAccountId: String(item.toAccountId || ""),
        importFingerprint: String(item.importFingerprint || ""),
        source: String(item.source || "manual"),
        createdAt: String(item.createdAt || new Date().toISOString())
      };
    }) : [];
    return {
      version: 4,
      meta: raw.meta && typeof raw.meta === "object" ? raw.meta : { savedAt: null },
      settings: {
        currentYear: year,
        theme: settings.theme === "dark" ? "dark" : "light",
        currency: "PLN",
        balances: balances,
        categories: categories.length ? categories : base.settings.categories,
        modules: modules,
        payday: payday
      },
      accounts: accounts,
      goals: goals,
      debts: debts,
      recurring: recurring,
      budgets: budgets,
      transactions: transactions
    };
  }

  function currentYear() {
    return Number(data.settings.currentYear);
  }

  function yearBalance() {
    var key = String(currentYear());
    if (!data.settings.balances[key]) {
      data.settings.balances[key] = { available: 0, reserve: 0 };
    }
    return data.settings.balances[key];
  }

  function modules() {
    return data.settings.modules || DEFAULT_MODULES;
  }

  function activeAccounts(includeHidden) {
    return data.accounts.filter(function (account) {
      if (!includeHidden && account.active === false) return false;
      return modules().bankAccounts || account.type === "cash";
    });
  }

  function accountById(id) {
    return data.accounts.find(function (account) { return account.id === id; }) || null;
  }

  function mainCashAccount() {
    return data.accounts.find(function (account) { return account.type === "cash"; }) || data.accounts[0];
  }

  function accountName(id) {
    var account = accountById(id);
    return account ? account.name : "Nieznane konto";
  }

  function accountOpening(account) {
    return account && account.openingBalances ? number(account.openingBalances[String(currentYear())]) : 0;
  }

  function totalOpeningAvailable() {
    return data.accounts.reduce(function (sum, account) { return sum + accountOpening(account); }, 0);
  }

  function accountImpact(transaction, accountId) {
    var amount = number(transaction.amount);
    if (transaction.type === "transfer") {
      if (transaction.accountId === accountId) return -amount;
      if (transaction.toAccountId === accountId) return amount;
      return 0;
    }
    if (transaction.accountId !== accountId) return 0;
    if (transaction.type === "income" || transaction.type === "goal_withdraw" || transaction.type === "reserve_out") return amount;
    if (transaction.type === "expense" || transaction.type === "goal" || transaction.type === "debt" || transaction.type === "reserve_in") return -amount;
    return 0;
  }

  function accountBalance(account, throughDate) {
    var balance = accountOpening(account);
    yearTransactions().forEach(function (transaction) {
      if (!throughDate || String(transaction.date || "") <= throughDate) {
        balance += accountImpact(transaction, account.id);
      }
    });
    return balance;
  }

  function impact(transaction) {
    var amount = number(transaction.amount);
    if (transaction.type === "income") return { available: amount, reserve: 0 };
    if (transaction.type === "expense" || transaction.type === "goal" || transaction.type === "debt") {
      return { available: -amount, reserve: 0 };
    }
    if (transaction.type === "goal_withdraw") return { available: amount, reserve: 0 };
    if (transaction.type === "reserve_in") return { available: -amount, reserve: amount };
    if (transaction.type === "reserve_out") return { available: amount, reserve: -amount };
    if (transaction.type === "transfer") return { available: 0, reserve: 0 };
    return { available: 0, reserve: 0 };
  }

  function yearTransactions() {
    var prefix = String(currentYear()) + "-";
    return data.transactions.filter(function (transaction) {
      return String(transaction.date || "").indexOf(prefix) === 0;
    });
  }

  function sortedTransactions(list) {
    return list.slice().sort(function (a, b) {
      var byDate = String(a.date || "").localeCompare(String(b.date || ""));
      if (byDate) return byDate;
      return String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id));
    });
  }

  function monthTransactions(month) {
    var prefix = currentYear() + "-" + String(month + 1).padStart(2, "0") + "-";
    return sortedTransactions(data.transactions.filter(function (transaction) {
      return String(transaction.date || "").indexOf(prefix) === 0;
    }));
  }

  function balancesBeforeMonth(month) {
    var opening = yearBalance();
    var available = totalOpeningAvailable();
    var reserve = number(opening.reserve);
    yearTransactions().forEach(function (transaction) {
      var date = dateFromISO(transaction.date);
      if (date && date.getMonth() < month) {
        var delta = impact(transaction);
        available += delta.available;
        reserve += delta.reserve;
      }
    });
    return { available: available, reserve: reserve };
  }

  function balancesAtYearEnd() {
    var opening = yearBalance();
    var available = totalOpeningAvailable();
    var reserve = number(opening.reserve);
    yearTransactions().forEach(function (transaction) {
      var delta = impact(transaction);
      available += delta.available;
      reserve += delta.reserve;
    });
    return { available: available, reserve: reserve };
  }

  function targetPaid(type, id, excludingId) {
    return data.transactions.reduce(function (sum, transaction) {
      if (transaction.id === excludingId) return sum;
      if (transaction.type === type && transaction.targetId === id) return sum + number(transaction.amount);
      return sum;
    }, 0);
  }

  function goalSaved(goal, excludingId) {
    return Math.max(data.transactions.reduce(function (sum, transaction) {
      if (transaction.id === excludingId || transaction.targetId !== goal.id) return sum;
      if (transaction.type === "goal") return sum + number(transaction.amount);
      if (transaction.type === "goal_withdraw") return sum - number(transaction.amount);
      return sum;
    }, 0), 0);
  }

  function goalDeposited(goal) {
    return targetPaid("goal", goal.id);
  }

  function goalWithdrawn(goal) {
    return targetPaid("goal_withdraw", goal.id);
  }

  function debtPaid(debt, excludingId) {
    return targetPaid("debt", debt.id, excludingId);
  }

  function goalRemaining(goal, excludingId) {
    return Math.max(number(goal.target) - goalSaved(goal, excludingId), 0);
  }

  function debtLedger(debt, excludingId) {
    var balance = Math.max(0, number(debt.total));
    var interest = 0;
    var rate = modules().interest && debt.interestEnabled ? Math.max(0, number(debt.apr)) / 1200 : 0;
    var created = dateFromISO(String(debt.createdAt || "").slice(0, 10)) || startOfToday();
    var cursor = created;
    var payments = sortedTransactions(data.transactions.filter(function (transaction) {
      return transaction.id !== excludingId && transaction.type === "debt" && transaction.targetId === debt.id;
    }));
    payments.forEach(function (payment) {
      var date = dateFromISO(payment.date) || cursor;
      var periods = Math.max(0, (date.getFullYear() - cursor.getFullYear()) * 12 + date.getMonth() - cursor.getMonth());
      if (rate > 0 && periods > 0 && balance > 0) {
        var before = balance;
        balance *= Math.pow(1 + rate, periods);
        interest += balance - before;
      }
      balance = Math.max(0, balance - number(payment.amount));
      if (date.getTime() > cursor.getTime()) cursor = date;
    });
    var today = startOfToday();
    var finalPeriods = Math.max(0, (today.getFullYear() - cursor.getFullYear()) * 12 + today.getMonth() - cursor.getMonth());
    if (rate > 0 && finalPeriods > 0 && balance > 0) {
      var current = balance;
      balance *= Math.pow(1 + rate, finalPeriods);
      interest += balance - current;
    }
    return { balance: Math.max(balance, 0), accruedInterest: Math.max(interest, 0) };
  }

  function debtRemaining(debt, excludingId) {
    return debtLedger(debt, excludingId).balance;
  }

  function monthDistance(start, end) {
    return Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1);
  }

  function goalPlan(goal, referenceDate) {
    var today = referenceDate || startOfToday();
    var deadline = dateFromISO(goal.deadline);
    var start = dateFromISO(goal.startDate) || today;
    var saved = goalSaved(goal);
    var remaining = goalRemaining(goal);
    var dates = deadline ? goalScheduleDates(goal, today, deadline).filter(function (date) {
      var key = isoDate(date);
      return !data.transactions.some(function (transaction) {
        return transaction.type === "goal" && transaction.targetId === goal.id && transaction.scheduledDate === key;
      });
    }) : [];
    var recommended = dates.length ? remaining / dates.length : remaining;
    var expected = 0;
    if (deadline && deadline.getTime() > start.getTime()) {
      var elapsed = Math.max(0, Math.min(today.getTime() - start.getTime(), deadline.getTime() - start.getTime()));
      expected = number(goal.target) * elapsed / (deadline.getTime() - start.getTime());
    } else if (deadline && today.getTime() >= deadline.getTime()) {
      expected = number(goal.target);
    }
    var difference = saved - expected;
    var tolerance = Math.max(number(goal.target) * .03, 50);
    var paceText = "Zgodnie z planem";
    var paceClass = "is-on-track";
    if (difference > tolerance) {
      paceText = "Przed planem o " + money(difference);
      paceClass = "is-ahead";
    } else if (difference < -tolerance) {
      paceText = "Za planem o " + money(Math.abs(difference));
      paceClass = "is-behind";
    }

    var projected = null;
    if (remaining <= 0) {
      projected = today;
    } else if (saved > 0) {
      var elapsedPeriods = goal.cadence === "weekly"
        ? Math.max(1, Math.ceil((today.getTime() - start.getTime()) / 604800000))
        : monthDistance(start, today);
      var average = saved / elapsedPeriods;
      if (average > 0) {
        var periodsNeeded = Math.ceil(remaining / average);
        projected = goal.cadence === "weekly" ? addDays(today, periodsNeeded * 7) : addMonths(today, periodsNeeded);
      }
    } else if (dates.length && deadline) {
      projected = deadline;
    }
    var cap = number(goal.maxContribution);
    var impossible = remaining > 0 && (!deadline || !dates.length || (cap > 0 && recommended > cap + .0001));
    return {
      saved: saved,
      deposited: goalDeposited(goal),
      withdrawn: goalWithdrawn(goal),
      remaining: remaining,
      dates: dates,
      recommended: recommended,
      nextDate: dates[0] || null,
      expected: expected,
      difference: difference,
      paceText: paceText,
      paceClass: paceClass,
      projected: projected,
      impossible: impossible,
      capExceeded: cap > 0 && recommended > cap + .0001
    };
  }

  function debtPlan(debt, referenceDate) {
    var today = referenceDate || startOfToday();
    var deadline = dateFromISO(debt.deadline);
    var ledger = debtLedger(debt);
    var remaining = ledger.balance;
    var dates = deadline ? debtScheduleDates(debt, today, deadline).filter(function (date) {
      var key = isoDate(date);
      return !data.transactions.some(function (transaction) {
        return transaction.type === "debt" && transaction.targetId === debt.id && transaction.scheduledDate === key;
      });
    }) : [];
    var periods = dates.length;
    var monthlyRate = modules().interest && debt.interestEnabled ? Math.max(0, number(debt.apr)) / 1200 : 0;
    var required = remaining;
    if (periods > 0) {
      required = monthlyRate > 0
        ? remaining * monthlyRate / (1 - Math.pow(1 + monthlyRate, -periods))
        : remaining / periods;
    }
    var recommended = Math.max(required, number(debt.minimumPayment));
    if (remaining <= 0) recommended = 0;

    var simulatedBalance = remaining;
    var interest = 0;
    var projected = null;
    var cursor = dates[0] || clampDate(today.getFullYear(), today.getMonth() + 1, debt.paymentDay);
    if (recommended > 0) {
      for (var index = 0; index < 600 && simulatedBalance > .005; index += 1) {
        var addedInterest = simulatedBalance * monthlyRate;
        interest += addedInterest;
        simulatedBalance += addedInterest;
        simulatedBalance -= Math.min(recommended, simulatedBalance);
        projected = cursor;
        cursor = clampDate(cursor.getFullYear(), cursor.getMonth() + 1, debt.paymentDay);
      }
    }
    return {
      remaining: remaining,
      paid: debtPaid(debt),
      dates: dates,
      payments: periods,
      recommended: recommended,
      nextDate: dates[0] || null,
      projected: projected,
      estimatedInterest: interest,
      accruedInterest: ledger.accruedInterest,
      impossible: remaining > 0 && (!deadline || !periods),
      apr: monthlyRate > 0 ? Math.max(0, number(debt.apr)) : 0
    };
  }

  function deadlineInfo(deadline, complete) {
    if (complete) return { text: "Zakończony", className: "is-done", priority: 0, days: 0 };
    if (!deadline) return { text: "Bez terminu", className: "", priority: 0, days: null };
    var due = dateFromISO(deadline);
    if (!due) return { text: "Bez terminu", className: "", priority: 0, days: null };
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
    if (days < 0) return { text: "Po terminie o " + Math.abs(days) + " dni", className: "is-overdue", priority: 2, days: days };
    if (days === 0) return { text: "Termin dzisiaj", className: "is-overdue", priority: 2, days: 0 };
    if (days <= 30) return { text: "Termin za " + days + " dni", className: "is-soon", priority: 1, days: days };
    return { text: "W trakcie", className: "", priority: 0, days: days };
  }

  function targetName(transaction) {
    if (transaction.type === "goal" || transaction.type === "goal_withdraw") {
      var goal = data.goals.find(function (item) { return item.id === transaction.targetId; });
      return goal ? goal.name : "Usunięty cel";
    }
    if (transaction.type === "debt") {
      var debt = data.debts.find(function (item) { return item.id === transaction.targetId; });
      return debt ? debt.name : "Usunięty dług";
    }
    if (transaction.type === "transfer") {
      return accountName(transaction.accountId) + " → " + accountName(transaction.toAccountId);
    }
    if (transaction.type === "reserve_in" || transaction.type === "reserve_out") return "Rezerwa";
    return transaction.category || "Bez kategorii";
  }

  function monthStats(month) {
    var stats = { income: 0, expense: 0, goal: 0, goalWithdraw: 0, debt: 0, reserveIn: 0, reserveOut: 0 };
    monthTransactions(month).forEach(function (transaction) {
      if (transaction.type === "income") stats.income += number(transaction.amount);
      if (transaction.type === "expense") stats.expense += number(transaction.amount);
      if (transaction.type === "goal") stats.goal += number(transaction.amount);
      if (transaction.type === "goal_withdraw") stats.goalWithdraw += number(transaction.amount);
      if (transaction.type === "debt") stats.debt += number(transaction.amount);
      if (transaction.type === "reserve_in") stats.reserveIn += number(transaction.amount);
      if (transaction.type === "reserve_out") stats.reserveOut += number(transaction.amount);
    });
    stats.targets = stats.goal + stats.debt - stats.goalWithdraw;
    stats.outflow = stats.expense + stats.goal + stats.debt;
    return stats;
  }

  function markDirty(message) {
    dirty = true;
    updateSaveState();
    if (message) showToast(message + " Kliknij „Zapisz”.");
  }

  function updateSaveState() {
    var label = $("#save-label");
    var time = $("#save-time");
    var button = $("#save-button");
    var indicator = $("#dirty-indicator");
    if (saving) {
      label.textContent = "Zapisywanie…";
      time.textContent = desktop ? "Lokalna baza SQLite" : "data/budget.json";
    } else if (dirty) {
      label.textContent = "Niezapisane zmiany";
      time.textContent = "Kliknij Zapisz";
    } else {
      label.textContent = "Wszystko zapisane";
      time.textContent = formattedDateTime(data && data.meta && data.meta.savedAt);
    }
    button.classList.toggle("is-dirty", dirty && !saving);
    button.classList.toggle("is-saving", saving);
    indicator.hidden = !dirty || saving;
  }

  async function saveToFile() {
    if (saving || !data) return;
    saving = true;
    updateSaveState();
    try {
      var result;
      if (desktop) {
        result = await desktop.data.save(data);
      } else {
        var response = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
        result = await response.json();
        if (!response.ok) throw new Error(result.error || "Nieznany błąd zapisu");
      }
      if (!result || !result.ok) throw new Error(result && result.error || "Nieznany błąd zapisu");
      data.meta.savedAt = result.savedAt;
      dirty = false;
      showToast(desktop ? "Zapisano bezpiecznie w lokalnej bazie." : "Zapisano do pliku data/budget.json.");
      loadBackups(true);
    } catch (error) {
      dirty = true;
      showToast("Nie udało się zapisać: " + error.message);
    } finally {
      saving = false;
      updateSaveState();
    }
  }

  async function loadFromFile() {
    try {
      var raw;
      if (desktop) {
        raw = await desktop.data.load();
        appInfo = await desktop.app.getInfo();
        updateStatus = await desktop.updater.getStatus();
      } else {
        var response = await fetch(API_URL, { cache: "no-store" });
        if (!response.ok) throw new Error("Serwer nie odpowiada");
        raw = await response.json();
      }
      data = normalizeData(raw);
      state.month = currentYear() === new Date().getFullYear() ? new Date().getMonth() : 0;
      state.planMonth = state.month;
      dirty = number(raw.version) > 0 && number(raw.version) < 4;
      applyTheme();
      renderAll();
      $("#app").hidden = false;
      $("#connection-error").hidden = true;
      window.setTimeout(function () {
        $("#loading-screen").classList.add("is-hidden");
        window.setTimeout(function () { $("#loading-screen").hidden = true; }, 380);
      }, 180);
      loadBackups(true);
    } catch (error) {
      $("#loading-screen").hidden = true;
      $("#app").hidden = true;
      $("#connection-error").hidden = false;
    }
  }

  async function loadBackups(silent) {
    try {
      var result;
      if (desktop) {
        result = await desktop.data.listBackups();
      } else {
        var response = await fetch(BACKUPS_URL, { cache: "no-store" });
        result = await response.json();
        if (!response.ok) throw new Error(result.error || "Błąd listy kopii");
      }
      if (!result || !result.ok) throw new Error(result && result.error || "Błąd listy kopii");
      backups = Array.isArray(result.backups) ? result.backups : [];
      if (data && $("#backups-list")) renderBackups();
    } catch (error) {
      backups = [];
      if (data && $("#backups-list")) renderBackups("Nie udało się odczytać kopii zapasowych.");
      if (!silent) showToast("Nie udało się odświeżyć kopii zapasowych.");
    }
  }

  async function restoreBackup(name) {
    var question = dirty
      ? "Masz niezapisane zmiany — zostaną utracone. Przywrócić wybraną kopię?"
      : "Przywrócić tę kopię? Obecny plik zostanie wcześniej zabezpieczony.";
    if (!window.confirm(question)) return;
    try {
      var result;
      if (desktop) {
        result = await desktop.data.restoreBackup(name);
      } else {
        var response = await fetch(RESTORE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name })
        });
        result = await response.json();
        if (!response.ok) throw new Error(result.error || "Błąd przywracania");
      }
      if (!result || !result.ok) throw new Error(result && result.error || "Błąd przywracania");
      await loadFromFile();
      showToast("Przywrócono wybraną kopię danych.");
    } catch (error) {
      showToast("Nie udało się przywrócić kopii: " + error.message);
    }
  }

  function showToast(message) {
    var toast = $("#toast");
    toast.textContent = message;
    toast.hidden = false;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.hidden = true; }, 3200);
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", data.settings.theme === "dark" ? "dark" : "light");
  }

  function toggleTheme() {
    data.settings.theme = data.settings.theme === "dark" ? "light" : "dark";
    applyTheme();
    markDirty();
  }

  function setPage(page) {
    if (!PAGE_META[page]) return;
    if (page === "accounts" && !modules().bankAccounts) page = "dashboard";
    state.page = page;
    $$("[data-page]").forEach(function (panel) {
      var visible = panel.getAttribute("data-page") === page;
      panel.hidden = !visible;
      panel.classList.toggle("is-visible", visible);
    });
    $$(".nav-button[data-view]").forEach(function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-view") === page);
    });
    $("#page-title").textContent = PAGE_META[page][0];
    $("#page-eyebrow").textContent = PAGE_META[page][1];
    $("#sidebar").classList.remove("is-open");
    $("#mobile-backdrop").hidden = true;
    if (page === "dashboard") renderDashboard();
    if (page === "months") renderMonths();
    if (page === "goals") renderGoals();
    if (page === "debts") renderDebts();
    if (page === "plan") renderPlan();
    if (page === "analytics") renderAnalytics();
    if (page === "accounts") renderAccounts();
    if (page === "settings") renderSettings();
  }

  function renderNavCounts() {
    $("#goals-nav-count").textContent = data.goals.filter(function (goal) { return goalRemaining(goal) > 0; }).length;
    $("#debts-nav-count").textContent = data.debts.filter(function (debt) { return debtRemaining(debt) > 0; }).length;
    $("#accounts-nav-count").textContent = data.accounts.filter(function (account) { return account.active !== false; }).length;
    $("#accounts-nav").hidden = !modules().bankAccounts;
  }

  function renderAlerts() {
    if (!modules().alerts) {
      $("#deadline-alerts").innerHTML = "";
      return;
    }
    var alerts = [];
    data.goals.forEach(function (goal) {
      var plan = goalPlan(goal);
      var info = deadlineInfo(goal.deadline, plan.remaining <= 0);
      if (plan.impossible) {
        alerts.push({ kind: "Cel", name: goal.name, priority: 3, message: plan.capExceeded ? "Wymagana wpłata przekracza ustawione maksimum." : "Brak kolejnych terminów wpłat przed końcem celu.", page: "goals" });
      } else if (info.priority) {
        alerts.push({ kind: "Cel", name: goal.name, priority: info.priority, message: info.text + " • pozostało " + money(plan.remaining), page: "goals" });
      } else if (plan.paceClass === "is-behind") {
        alerts.push({ kind: "Cel", name: goal.name, priority: 1, message: plan.paceText + " • zalecana wpłata " + money(plan.recommended), page: "goals" });
      }
    });
    data.debts.forEach(function (debt) {
      var plan = debtPlan(debt);
      var info = deadlineInfo(debt.deadline, plan.remaining <= 0);
      if (plan.impossible) {
        alerts.push({ kind: "Dług", name: debt.name, priority: 3, message: "Termin minął lub nie ma kolejnej raty w harmonogramie.", page: "debts" });
      } else if (info.priority) {
        alerts.push({ kind: "Dług", name: debt.name, priority: info.priority, message: info.text + " • zostało " + money(plan.remaining), page: "debts" });
      }
    });
    (modules().categoryBudgets ? data.budgets : []).forEach(function (budget) {
      var spent = categorySpent(budget.category, state.month);
      if (spent > number(budget.limit) + .0001) {
        alerts.push({ kind: "Koperta", name: budget.category, priority: 2, message: "Limit przekroczony o " + money(spent - number(budget.limit)), page: "plan" });
      }
    });
    var today = startOfToday();
    if (currentYear() === today.getFullYear()) {
      plannedItemsForMonth(today.getMonth()).forEach(function (item) {
        if (!item.complete && item.date.getTime() < today.getTime()) {
          alerts.push({ kind: "Plan", name: item.title, priority: 2, message: "Termin minął • do zaksięgowania " + money(item.remaining), page: "months" });
        }
      });
    }
    alerts.sort(function (a, b) { return b.priority - a.priority; });
    var node = $("#deadline-alerts");
    node.innerHTML = alerts.map(function (alert) {
      return "<div class=\"alert " + (alert.priority >= 2 ? "is-overdue" : "") + "\">" +
        "<div class=\"alert-main\"><div class=\"alert-icon\">!</div><div><strong>" + escapeHTML(alert.kind + ": " + alert.name) + "</strong>" +
        "<span>" + escapeHTML(alert.message) + "</span></div></div>" +
        "<button class=\"text-button\" type=\"button\" data-go=\"" + alert.page + "\">Sprawdź</button></div>";
    }).join("");
  }

  function nextPaydayDate() {
    var today = startOfToday();
    var exact = dateFromISO(data.settings.payday && data.settings.payday.nextDate);
    if (exact && exact.getTime() >= today.getTime()) return exact;
    var day = Math.min(31, Math.max(1, Math.round(number(data.settings.payday && data.settings.payday.day) || 10)));
    var candidate = clampDate(today.getFullYear(), today.getMonth(), day);
    if (candidate.getTime() <= today.getTime()) candidate = clampDate(today.getFullYear(), today.getMonth() + 1, day);
    return candidate;
  }

  function renderSpendingLimits() {
    var node = $("#spending-limits");
    if (!modules().dailyLimit && !modules().weeklyLimit) {
      node.hidden = true;
      node.innerHTML = "";
      return;
    }
    var today = startOfToday();
    if (today.getFullYear() !== currentYear()) {
      node.hidden = true;
      return;
    }
    var available = activeAccounts().filter(function (account) { return account.includeInSpendingLimit !== false; }).reduce(function (sum, account) {
      return sum + accountBalance(account, isoDate(today));
    }, 0);
    var payday = nextPaydayDate();
    var days = Math.max(1, Math.ceil((payday.getTime() - today.getTime()) / 86400000));
    var months = {};
    var cursor = startOfMonth(today.getFullYear(), today.getMonth());
    var paydayMonth = startOfMonth(payday.getFullYear(), payday.getMonth());
    while (cursor.getTime() <= paydayMonth.getTime()) {
      if (cursor.getFullYear() === currentYear()) months[cursor.getMonth()] = true;
      cursor = startOfMonth(cursor.getFullYear(), cursor.getMonth() + 1);
    }
    var obligations = Object.keys(months).reduce(function (sum, month) {
      return sum + plannedItemsForMonth(Number(month)).reduce(function (monthSum, item) {
        if (item.complete || item.remaining <= 0 || item.date.getTime() < today.getTime() || item.date.getTime() >= payday.getTime()) return monthSum;
        if (item.kind === "recurring" && item.direction === "income") return monthSum;
        return monthSum + item.remaining;
      }, 0);
    }, 0);
    var spendable = Math.max(0, available - obligations);
    var daily = spendable / days;
    var cards = [];
    if (modules().dailyLimit) cards.push("<article class=\"limit-card\"><div class=\"limit-icon\">D</div><div><span>Bezpiecznie dzisiaj</span><strong>" + escapeHTML(money(daily)) + "</strong><small>przez " + days + " dni do wypłaty</small></div></article>");
    if (modules().weeklyLimit) cards.push("<article class=\"limit-card\"><div class=\"limit-icon\">7</div><div><span>Limit na 7 dni</span><strong>" + escapeHTML(money(daily * Math.min(7, days))) + "</strong><small>po odjęciu zaplanowanych płatności</small></div></article>");
    cards.push("<article class=\"limit-card\"><div class=\"limit-icon\">→</div><div><span>Następna wypłata</span><strong>" + escapeHTML(formattedDate(isoDate(payday))) + "</strong><small>Do wydania " + escapeHTML(money(spendable)) + " • plan " + escapeHTML(money(obligations)) + "</small></div></article>");
    node.innerHTML = cards.join("");
    node.hidden = false;
  }

  function renderDashboard() {
    $("#hero-year").textContent = currentYear();
    var ending = balancesAtYearEnd();
    var goalsSaved = data.goals.reduce(function (sum, goal) { return sum + goalSaved(goal); }, 0);
    var goalsTarget = data.goals.reduce(function (sum, goal) { return sum + number(goal.target); }, 0);
    var debtsPaid = data.debts.reduce(function (sum, debt) { return sum + debtPaid(debt); }, 0);
    var debtsRemaining = data.debts.reduce(function (sum, debt) { return sum + debtRemaining(debt); }, 0);
    $("#metric-available").textContent = money(ending.available);
    $("#metric-available-label").textContent = modules().bankAccounts ? "Środki dostępne" : "Gotówka dostępna";
    $("#metric-available").classList.toggle("negative", ending.available < 0);
    $("#metric-reserve").textContent = money(ending.reserve);
    $("#metric-reserve").classList.toggle("negative", ending.reserve < 0);
    $("#metric-goals").textContent = money(goalsSaved);
    $("#metric-goals-note").textContent = data.goals.length ? "Z " + money(goalsTarget) + " celu" : "Brak celów";
    $("#metric-debts").textContent = money(debtsRemaining);
    $("#metric-debts-note").textContent = data.debts.length ? "Spłacono " + money(debtsPaid) : "Brak długów";
    renderAlerts();
    renderSpendingLimits();
    renderAnnualChart();
    renderRecentTransactions();
  }

  function compactMoney(value) {
    var absolute = Math.abs(value);
    if (absolute >= 1000000) return (value / 1000000).toLocaleString("pl-PL", { maximumFractionDigits: 1 }) + " mln";
    if (absolute >= 1000) return (value / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1 }) + " tys.";
    return Math.round(value).toLocaleString("pl-PL");
  }

  function renderAnnualChart() {
    var values = MONTHS.map(function (_, month) {
      var stats = monthStats(month);
      return { income: stats.income, outflow: stats.outflow };
    });
    var maxValue = Math.max.apply(null, values.reduce(function (list, item) {
      return list.concat([item.income, item.outflow]);
    }, [0]));
    var node = $("#annual-chart");
    if (maxValue <= 0) {
      node.innerHTML = "<div class=\"chart-empty\">Wykres pojawi się po dodaniu pierwszej operacji.</div>";
      return;
    }
    var width = 820;
    var height = 285;
    var left = 52;
    var right = 12;
    var top = 16;
    var bottom = 39;
    var plotWidth = width - left - right;
    var plotHeight = height - top - bottom;
    var groupWidth = plotWidth / 12;
    var barWidth = Math.max(7, groupWidth * .28);
    var svg = [];
    svg.push("<svg viewBox=\"0 0 " + width + " " + height + "\" role=\"img\" aria-label=\"Wpływy i wydatki w każdym miesiącu\">");
    for (var grid = 0; grid <= 4; grid += 1) {
      var ratio = grid / 4;
      var y = top + plotHeight - ratio * plotHeight;
      svg.push("<line x1=\"" + left + "\" y1=\"" + y + "\" x2=\"" + (width - right) + "\" y2=\"" + y + "\" stroke=\"var(--border)\" stroke-width=\"1\"></line>");
      svg.push("<text x=\"" + (left - 7) + "\" y=\"" + (y + 4) + "\" text-anchor=\"end\" fill=\"var(--muted)\" font-size=\"10\">" + escapeHTML(compactMoney(maxValue * ratio)) + "</text>");
    }
    values.forEach(function (item, index) {
      var center = left + groupWidth * index + groupWidth / 2;
      var incomeHeight = item.income / maxValue * plotHeight;
      var outflowHeight = item.outflow / maxValue * plotHeight;
      svg.push("<rect class=\"chart-bar\" style=\"animation-delay:" + (index * .035) + "s\" x=\"" + (center - barWidth - 2) + "\" y=\"" + (top + plotHeight - incomeHeight) + "\" width=\"" + barWidth + "\" height=\"" + incomeHeight + "\" rx=\"4\" fill=\"var(--primary)\"><title>" + MONTHS[index] + " wpływy: " + escapeHTML(money(item.income)) + "</title></rect>");
      svg.push("<rect class=\"chart-bar\" style=\"animation-delay:" + (index * .035 + .08) + "s\" x=\"" + (center + 2) + "\" y=\"" + (top + plotHeight - outflowHeight) + "\" width=\"" + barWidth + "\" height=\"" + outflowHeight + "\" rx=\"4\" fill=\"var(--purple)\"><title>" + MONTHS[index] + " wydatki: " + escapeHTML(money(item.outflow)) + "</title></rect>");
      svg.push("<text x=\"" + center + "\" y=\"" + (height - 13) + "\" text-anchor=\"middle\" fill=\"var(--muted)\" font-size=\"10\">" + MONTHS_SHORT[index] + "</text>");
    });
    svg.push("</svg>");
    node.innerHTML = svg.join("");
  }

  function renderRecentTransactions() {
    var recent = sortedTransactions(yearTransactions()).reverse().slice(0, 6);
    var node = $("#recent-transactions");
    if (!recent.length) {
      node.innerHTML = "<div class=\"empty-state\">Brak operacji w tym roku.</div>";
      return;
    }
    node.innerHTML = recent.map(function (transaction, index) {
      var delta = impact(transaction).available;
      var out = delta < 0;
      var transfer = transaction.type === "transfer";
      return "<div class=\"recent-item\" style=\"animation-delay:" + (index * .045) + "s\">" +
        "<div class=\"recent-icon " + (out ? "is-out" : "") + "\">" + (transfer ? "↔" : out ? "↓" : "↑") + "</div>" +
        "<div class=\"recent-main\"><strong>" + escapeHTML(transaction.description || TYPE_LABELS[transaction.type]) + "</strong><span>" + escapeHTML(targetName(transaction)) + " • " + escapeHTML(formattedDate(transaction.date)) + "</span></div>" +
        "<div class=\"recent-amount " + (out ? "is-out" : "") + "\"><strong>" + (transfer ? "" : out ? "−" : "+") + escapeHTML(money(transaction.amount)) + "</strong><small>" + escapeHTML(TYPE_LABELS[transaction.type]) + "</small></div></div>";
    }).join("");
  }

  function categorySpent(category, month) {
    return monthTransactions(month).reduce(function (sum, transaction) {
      return transaction.type === "expense" && transaction.category === category ? sum + number(transaction.amount) : sum;
    }, 0);
  }

  function postedOccurrence(recurringId, scheduledDate) {
    return data.transactions.find(function (transaction) {
      return transaction.recurringId === recurringId && (transaction.scheduledDate === scheduledDate || (!transaction.scheduledDate && transaction.date === scheduledDate));
    });
  }

  function targetMonthNet(type, targetId, month) {
    return monthTransactions(month).reduce(function (sum, transaction) {
      if (transaction.targetId !== targetId) return sum;
      if (type === "goal" && transaction.type === "goal") return sum + number(transaction.amount);
      if (type === "goal" && transaction.type === "goal_withdraw") return sum - number(transaction.amount);
      if (type === "debt" && transaction.type === "debt") return sum + number(transaction.amount);
      return sum;
    }, 0);
  }

  function plannedItemsForMonth(month) {
    var start = startOfMonth(currentYear(), month);
    var end = endOfMonth(currentYear(), month);
    var items = [];
    (modules().recurring ? data.recurring : []).filter(function (recurring) { return recurring.active; }).forEach(function (recurring) {
      recurringOccurrences(recurring, start, end).forEach(function (date) {
        var key = isoDate(date);
        var posted = postedOccurrence(recurring.id, key);
        items.push({
          kind: "recurring",
          direction: recurring.type,
          title: recurring.name,
          subtitle: recurring.type === "income" ? "Cykliczny wpływ" : "Cykliczny wydatek",
          date: date,
          planned: number(recurring.amount),
          actual: posted ? number(posted.amount) : 0,
          remaining: posted ? 0 : number(recurring.amount),
          recurringId: recurring.id,
          scheduledDate: key,
          complete: !!posted
        });
      });
    });
    data.goals.forEach(function (goal) {
      var plan = goalPlan(goal);
      if (plan.remaining <= 0) return;
      var dates = goalScheduleDates(goal, start, end);
      if (!dates.length) return;
      var planned = Math.min(plan.recommended * dates.length, plan.remaining);
      var actual = Math.max(0, targetMonthNet("goal", goal.id, month));
      items.push({
        kind: "goal",
        title: goal.name,
        subtitle: "Wpłata na cel • " + CADENCE_LABELS[goal.cadence],
        date: dates[dates.length - 1],
        planned: planned,
        actual: actual,
        remaining: Math.max(planned - actual, 0),
        targetId: goal.id,
        complete: actual + .0001 >= planned
      });
    });
    data.debts.forEach(function (debt) {
      var plan = debtPlan(debt);
      if (plan.remaining <= 0) return;
      var dates = debtScheduleDates(debt, start, end);
      if (!dates.length) return;
      var planned = Math.min(plan.recommended * dates.length, plan.remaining + plan.estimatedInterest);
      var actual = targetMonthNet("debt", debt.id, month);
      items.push({
        kind: "debt",
        title: debt.name,
        subtitle: "Planowana rata • " + (plan.apr > 0 ? "oprocentowanie " + number(plan.apr).toLocaleString("pl-PL") + "%" : "bez odsetek"),
        date: dates[dates.length - 1],
        planned: planned,
        actual: actual,
        remaining: Math.max(planned - actual, 0),
        targetId: debt.id,
        complete: actual + .0001 >= planned
      });
    });
    return items.sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });
  }

  function renderMonthPlan() {
    var items = plannedItemsForMonth(state.month);
    var complete = items.filter(function (item) { return item.complete; }).length;
    $("#month-plan-status").textContent = items.length ? complete + " z " + items.length + " wykonane" : "0 zadań";
    var node = $("#month-plan");
    if (!items.length) {
      node.innerHTML = "<div class=\"empty-plan\">Brak zaplanowanych wpłat, rat i cyklicznych operacji w tym miesiącu.</div>";
      return;
    }
    node.innerHTML = items.map(function (item) {
      var percent = item.planned > 0 ? Math.min(item.actual / item.planned * 100, 100) : 100;
      var action = "";
      if (!item.complete && item.kind === "recurring") {
        action = "<button class=\"button button-soft compact-button\" type=\"button\" data-post-recurring=\"" + escapeHTML(item.recurringId) + "\" data-scheduled-date=\"" + escapeHTML(item.scheduledDate) + "\">Zaksięguj</button>";
      }
      if (!item.complete && item.kind === "goal") {
        action = "<button class=\"button button-soft compact-button\" type=\"button\" data-plan-goal=\"" + escapeHTML(item.targetId) + "\" data-plan-amount=\"" + item.remaining + "\" data-plan-date=\"" + isoDate(item.date) + "\">Wpłać " + escapeHTML(money(item.remaining)) + "</button>";
      }
      if (!item.complete && item.kind === "debt") {
        action = "<button class=\"button button-soft compact-button\" type=\"button\" data-plan-debt=\"" + escapeHTML(item.targetId) + "\" data-plan-amount=\"" + item.remaining + "\" data-plan-date=\"" + isoDate(item.date) + "\">Zapłać " + escapeHTML(money(item.remaining)) + "</button>";
      }
      return "<div class=\"month-plan-item is-" + escapeHTML(item.kind) + (item.complete ? " is-complete" : "") + "\">" +
        "<div class=\"plan-check\">" + (item.complete ? "✓" : formattedDate(isoDate(item.date)).slice(0, 5)) + "</div>" +
        "<div class=\"plan-main\"><strong>" + escapeHTML(item.title) + "</strong><span>" + escapeHTML(item.subtitle) + "</span>" +
        "<div class=\"plan-progress\"><i style=\"width:" + percent + "%\"></i></div></div>" +
        "<div class=\"plan-values\"><span>Plan " + escapeHTML(money(item.planned)) + "</span><strong>" + (item.complete ? "Wykonane" : "Brakuje " + escapeHTML(money(item.remaining))) + "</strong></div>" + action + "</div>";
    }).join("");
  }

  function renderMonthTabs() {
    $("#month-tabs").innerHTML = MONTHS.map(function (month, index) {
      return "<button class=\"month-tab " + (state.month === index ? "is-active" : "") + "\" type=\"button\" data-month=\"" + index + "\" aria-pressed=\"" + (state.month === index ? "true" : "false") + "\">" + MONTHS_SHORT[index] + "</button>";
    }).join("");
  }

  function renderMonths() {
    renderMonthTabs();
    var list = monthTransactions(state.month);
    var stats = monthStats(state.month);
    var balances = balancesBeforeMonth(state.month);
    var available = balances.available;
    var reserve = balances.reserve;
    $("#selected-month-title").textContent = MONTHS[state.month] + " " + currentYear();
    $("#month-entry-count").textContent = list.length + (list.length === 1 ? " wpis" : " wpisów");
    $("#month-income").textContent = money(stats.income);
    $("#month-expenses").textContent = money(stats.expense);
    $("#month-targets").textContent = money(stats.targets);
    var rows = [];
    list.forEach(function (transaction) {
      var delta = impact(transaction);
      available += delta.available;
      reserve += delta.reserve;
      var out = delta.available < 0;
      rows.push("<tr>" +
        "<td data-label=\"Data\">" + escapeHTML(formattedDate(transaction.date)) + "</td>" +
        "<td data-label=\"Rodzaj\">" + escapeHTML(TYPE_LABELS[transaction.type] || transaction.type) + "</td>" +
        "<td data-label=\"Konto\">" + escapeHTML(transaction.type === "transfer" ? accountName(transaction.accountId) + " → " + accountName(transaction.toAccountId) : accountName(transaction.accountId)) + "</td>" +
        "<td data-label=\"Powiązanie\">" + escapeHTML(targetName(transaction)) + "</td>" +
        "<td data-label=\"Opis\">" + escapeHTML(transaction.description || "—") + "</td>" +
        "<td data-label=\"Kwota\" class=\"amount " + (out ? "is-out" : "") + "\">" + (transaction.type === "transfer" ? "" : out ? "−" : "+") + escapeHTML(money(transaction.amount)) + "</td>" +
        "<td data-label=\"Saldo dostępne\" class=\"balance " + (available < 0 ? "negative" : "") + "\">" + escapeHTML(money(available)) + "</td>" +
        "<td data-label=\"Działania\"><div class=\"row-actions\">" +
        "<button class=\"tiny-button\" type=\"button\" data-edit-transaction=\"" + escapeHTML(transaction.id) + "\" aria-label=\"Edytuj\"><svg viewBox=\"0 0 24 24\"><path d=\"m4 20 4-1 11-11-3-3L5 16l-1 4Z\"></path></svg></button>" +
        "<button class=\"tiny-button is-delete\" type=\"button\" data-delete-transaction=\"" + escapeHTML(transaction.id) + "\" aria-label=\"Usuń\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13\"></path></svg></button>" +
        "</div></td></tr>");
    });
    $("#transactions-table").innerHTML = rows.length ? rows.join("") : "<tr><td class=\"empty-table-cell\" colspan=\"8\"><div class=\"empty-state\">Brak operacji w tym miesiącu. Kliknij „Dodaj operację”.</div></td></tr>";
    $("#month-ending").textContent = money(available);
    $("#month-ending").classList.toggle("negative", available < 0);
    $("#month-reserve-ending").textContent = "Rezerwa: " + money(reserve);
    renderMonthPlan();
  }

  function targetStatusHTML(info) {
    return "<span class=\"status-badge " + info.className + "\">" + escapeHTML(info.text) + "</span>";
  }

  function renderGoals() {
    var savedTotal = data.goals.reduce(function (sum, goal) { return sum + goalSaved(goal); }, 0);
    var targetTotal = data.goals.reduce(function (sum, goal) { return sum + number(goal.target); }, 0);
    var complete = data.goals.filter(function (goal) { return goalRemaining(goal) <= 0; }).length;
    var recommendedTotal = data.goals.reduce(function (sum, goal) {
      var plan = goalPlan(goal);
      return sum + (plan.remaining > 0 && !plan.impossible ? plan.recommended : 0);
    }, 0);
    $("#goals-summary").innerHTML =
      "<div class=\"summary-item\"><span>Kwota docelowa</span><strong>" + escapeHTML(money(targetTotal)) + "</strong></div>" +
      "<div class=\"summary-item\"><span>Odłożono automatycznie</span><strong>" + escapeHTML(money(savedTotal)) + "</strong></div>" +
      "<div class=\"summary-item\"><span>Zalecane najbliższe wpłaty</span><strong>" + escapeHTML(money(recommendedTotal)) + "</strong></div>" +
      "<div class=\"summary-item\"><span>Osiągnięte cele</span><strong>" + complete + " z " + data.goals.length + "</strong></div>";
    var node = $("#goals-grid");
    if (!data.goals.length) {
      node.innerHTML = "<div class=\"empty-targets\"><div><strong>Nie masz jeszcze celów</strong><span>Dodaj kwotę, termin i częstotliwość. Aplikacja sama wyliczy plan wpłat.</span></div></div>";
      return;
    }
    node.innerHTML = data.goals.map(function (goal, index) {
      var plan = goalPlan(goal);
      var percent = number(goal.target) > 0 ? Math.min(plan.saved / number(goal.target) * 100, 100) : 0;
      var info = deadlineInfo(goal.deadline, plan.remaining <= 0);
      var status = plan.impossible ? "<span class=\"status-badge is-overdue\">Plan wymaga zmiany</span>" : targetStatusHTML(info);
      var next = plan.nextDate ? formattedDate(isoDate(plan.nextDate)) : "Brak terminu";
      var projected = plan.projected ? formattedDate(isoDate(plan.projected)) : "Brak danych";
      var warning = plan.impossible ? "<div class=\"plan-warning\">" + (plan.capExceeded ? "Zalecana wpłata jest wyższa niż ustawione maksimum." : "Brakuje terminów wpłat przed końcem celu.") + "</div>" : "";
      return "<article class=\"target-card target-card-wide\" style=\"animation-delay:" + (index * .05) + "s\">" +
        "<div class=\"target-head\"><div><h3>" + escapeHTML(goal.name) + "</h3><p>Cel: " + escapeHTML(money(goal.target)) + "</p></div>" +
        "<div class=\"target-menu\"><button class=\"tiny-button\" type=\"button\" data-edit-goal=\"" + escapeHTML(goal.id) + "\" aria-label=\"Edytuj cel\"><svg viewBox=\"0 0 24 24\"><path d=\"m4 20 4-1 11-11-3-3L5 16l-1 4Z\"></path></svg></button>" +
        "<button class=\"tiny-button is-delete\" type=\"button\" data-delete-goal=\"" + escapeHTML(goal.id) + "\" aria-label=\"Usuń cel\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13\"></path></svg></button></div></div>" +
        "<div class=\"target-progress-row\"><div class=\"progress-ring\" style=\"--progress:" + (percent * 3.6) + "deg\"><div><strong>" + Math.round(percent) + "%</strong><span>postępu</span></div></div>" +
        "<div class=\"recommended-box\"><span>Zalecana wpłata</span><strong>" + escapeHTML(money(plan.recommended)) + "</strong><small>" + escapeHTML(CADENCE_LABELS[goal.cadence]) + " • najbliższa " + escapeHTML(next) + "</small></div></div>" +
        warning +
        "<div class=\"target-numbers target-numbers-three\"><div class=\"target-number\"><span>Odłożono</span><strong>" + escapeHTML(money(plan.saved)) + "</strong></div><div class=\"target-number\"><span>Wypłacono</span><strong>" + escapeHTML(money(plan.withdrawn)) + "</strong></div><div class=\"target-number\"><span>Zostało</span><strong>" + escapeHTML(money(plan.remaining)) + "</strong></div></div>" +
        "<div class=\"schedule-details\"><div><span>Tempo</span><strong class=\"" + plan.paceClass + "\">" + escapeHTML(plan.paceText) + "</strong></div><div><span>Prognozowany finał</span><strong>" + escapeHTML(projected) + "</strong></div></div>" +
        "<div class=\"target-footer\">" + status + "<span class=\"target-tag\">do " + escapeHTML(formattedDate(goal.deadline)) + "</span></div>" +
        "<div class=\"target-actions\"><button class=\"button button-primary compact-button\" type=\"button\" data-pay-goal=\"" + escapeHTML(goal.id) + "\">Wpłać</button>" +
        "<button class=\"button button-soft compact-button\" type=\"button\" data-withdraw-goal=\"" + escapeHTML(goal.id) + "\" " + (plan.saved <= 0 ? "disabled" : "") + ">Wypłać z celu</button>" +
        "<button class=\"text-button\" type=\"button\" data-history-goal=\"" + escapeHTML(goal.id) + "\">Historia</button></div></article>";
    }).join("");
  }

  function renderDebts() {
    var paidTotal = data.debts.reduce(function (sum, debt) { return sum + debtPaid(debt); }, 0);
    var debtTotal = data.debts.reduce(function (sum, debt) { return sum + number(debt.total); }, 0);
    var complete = data.debts.filter(function (debt) { return debtRemaining(debt) <= 0; }).length;
    var interestTotal = data.debts.reduce(function (sum, debt) { return sum + debtPlan(debt).estimatedInterest; }, 0);
    $("#debts-summary").innerHTML =
      "<div class=\"summary-item\"><span>Kwota początkowa</span><strong>" + escapeHTML(money(debtTotal)) + "</strong></div>" +
      "<div class=\"summary-item\"><span>Spłacono automatycznie</span><strong>" + escapeHTML(money(paidTotal)) + "</strong></div>" +
      "<div class=\"summary-item\"><span>Szacowane przyszłe odsetki</span><strong>" + escapeHTML(money(interestTotal)) + "</strong></div>" +
      "<div class=\"summary-item\"><span>Spłacone długi</span><strong>" + complete + " z " + data.debts.length + "</strong></div>";
    var node = $("#debts-grid");
    if (!data.debts.length) {
      node.innerHTML = "<div class=\"empty-targets\"><div><strong>Nie masz jeszcze długów</strong><span>Dodaj dług, a każda miesięczna rata będzie automatycznie zmniejszać pozostałą kwotę.</span></div></div>";
      return;
    }
    node.innerHTML = data.debts.map(function (debt, index) {
      var plan = debtPlan(debt);
      var percent = number(debt.total) > 0 ? Math.min(plan.paid / number(debt.total) * 100, 100) : 0;
      var info = deadlineInfo(debt.deadline, plan.remaining <= 0);
      var status = plan.impossible ? "<span class=\"status-badge is-overdue\">Termin wymaga zmiany</span>" : targetStatusHTML(info);
      var next = plan.nextDate ? formattedDate(isoDate(plan.nextDate)) : "Brak terminu";
      var projected = plan.projected ? formattedDate(isoDate(plan.projected)) : "Brak danych";
      return "<article class=\"target-card is-debt target-card-wide\" style=\"animation-delay:" + (index * .05) + "s\">" +
        "<div class=\"target-head\"><div><h3>" + escapeHTML(debt.name) + "</h3><p>Dług: " + escapeHTML(money(debt.total)) + "</p></div>" +
        "<div class=\"target-menu\"><button class=\"tiny-button\" type=\"button\" data-edit-debt=\"" + escapeHTML(debt.id) + "\" aria-label=\"Edytuj dług\"><svg viewBox=\"0 0 24 24\"><path d=\"m4 20 4-1 11-11-3-3L5 16l-1 4Z\"></path></svg></button>" +
        "<button class=\"tiny-button is-delete\" type=\"button\" data-delete-debt=\"" + escapeHTML(debt.id) + "\" aria-label=\"Usuń dług\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13\"></path></svg></button></div></div>" +
        "<div class=\"target-progress-row\"><div class=\"progress-ring\" style=\"--progress:" + (percent * 3.6) + "deg\"><div><strong>" + Math.round(percent) + "%</strong><span>spłacono</span></div></div>" +
        "<div class=\"recommended-box is-debt\"><span>Zalecana rata</span><strong>" + escapeHTML(money(plan.recommended)) + "</strong><small>miesięcznie • najbliższa " + escapeHTML(next) + "</small></div></div>" +
        "<div class=\"target-numbers target-numbers-three\"><div class=\"target-number\"><span>Spłacono</span><strong>" + escapeHTML(money(plan.paid)) + "</strong></div><div class=\"target-number\"><span>Zostało</span><strong>" + escapeHTML(money(plan.remaining)) + "</strong></div><div class=\"target-number\"><span>Odsetki prognozowane</span><strong>" + escapeHTML(money(plan.estimatedInterest)) + "</strong></div></div>" +
        "<div class=\"schedule-details\"><div><span>Oprocentowanie</span><strong>" + (plan.apr > 0 ? escapeHTML(number(plan.apr).toLocaleString("pl-PL")) + "% rocznie • naliczone ok. " + escapeHTML(money(plan.accruedInterest)) : "Wyłączone") + "</strong></div><div><span>Prognozowana spłata</span><strong>" + escapeHTML(projected) + "</strong></div></div>" +
        "<div class=\"target-footer\">" + status + "<span class=\"target-tag\">do " + escapeHTML(formattedDate(debt.deadline)) + "</span></div>" +
        "<div class=\"target-actions\"><button class=\"button button-primary compact-button\" type=\"button\" data-pay-debt=\"" + escapeHTML(debt.id) + "\">Dodaj ratę</button>" +
        "<button class=\"text-button\" type=\"button\" data-history-debt=\"" + escapeHTML(debt.id) + "\">Historia</button></div></article>";
    }).join("");
  }

  function renderPlanMonthTabs() {
    $("#plan-month-tabs").innerHTML = MONTHS.map(function (_, index) {
      return "<button class=\"month-tab " + (state.planMonth === index ? "is-active" : "") + "\" type=\"button\" data-plan-month=\"" + index + "\" aria-pressed=\"" + (state.planMonth === index ? "true" : "false") + "\">" + MONTHS_SHORT[index] + "</button>";
    }).join("");
  }

  function renderRecurring() {
    var node = $("#recurring-list");
    if (!data.recurring.length) {
      node.innerHTML = "<div class=\"empty-plan\">Brak cyklicznych wpływów i wydatków. Dodaj np. wypłatę, czynsz albo abonament.</div>";
      return;
    }
    var today = startOfToday();
    var horizon = addMonths(today, 18);
    node.innerHTML = data.recurring.map(function (recurring) {
      var next = recurringOccurrences(recurring, today, horizon)[0];
      var schedule = recurring.cadence === "weekly"
        ? "co tydzień • dzień " + recurring.day
        : "co miesiąc • dzień " + recurring.day;
      var nextLabel = recurring.active ? (next ? formattedDate(isoDate(next)) : "Brak kolejnego terminu") : "Harmonogram wstrzymany";
      return "<div class=\"automation-item " + (recurring.active ? "" : "is-inactive") + "\">" +
        "<div class=\"automation-icon " + (recurring.type === "income" ? "is-income" : "is-expense") + "\">" + (recurring.type === "income" ? "↑" : "↓") + "</div>" +
        "<div class=\"automation-main\"><strong>" + escapeHTML(recurring.name) + "</strong><span>" + escapeHTML(recurring.category + " • " + accountName(recurring.accountId) + " • " + schedule + " • " + nextLabel) + "</span></div>" +
        "<strong class=\"automation-amount " + (recurring.type === "expense" ? "is-out" : "") + "\">" + (recurring.type === "income" ? "+" : "−") + escapeHTML(money(recurring.amount)) + "</strong>" +
        "<div class=\"row-actions\"><button class=\"tiny-button\" type=\"button\" data-edit-recurring=\"" + escapeHTML(recurring.id) + "\" aria-label=\"Edytuj cykliczny wpis\"><svg viewBox=\"0 0 24 24\"><path d=\"m4 20 4-1 11-11-3-3L5 16l-1 4Z\"></path></svg></button>" +
        "<button class=\"tiny-button is-delete\" type=\"button\" data-delete-recurring=\"" + escapeHTML(recurring.id) + "\" aria-label=\"Usuń cykliczny wpis\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13\"></path></svg></button></div></div>";
    }).join("");
  }

  function renderBudgets() {
    var node = $("#budgets-list");
    if (!data.budgets.length) {
      node.innerHTML = "<div class=\"empty-plan\">Brak kopert. Dodaj miesięczny limit np. na żywność lub rozrywkę.</div>";
      return;
    }
    node.innerHTML = data.budgets.map(function (budget) {
      var spent = categorySpent(budget.category, state.planMonth);
      var remaining = number(budget.limit) - spent;
      var percent = number(budget.limit) > 0 ? spent / number(budget.limit) * 100 : 0;
      var over = remaining < -.0001;
      return "<article class=\"envelope " + (over ? "is-over" : "") + "\">" +
        "<div class=\"envelope-head\"><div><span>Koperta</span><strong>" + escapeHTML(budget.category) + "</strong></div><div class=\"row-actions\"><button class=\"tiny-button\" type=\"button\" data-edit-budget=\"" + escapeHTML(budget.id) + "\" aria-label=\"Edytuj kopertę\"><svg viewBox=\"0 0 24 24\"><path d=\"m4 20 4-1 11-11-3-3L5 16l-1 4Z\"></path></svg></button><button class=\"tiny-button is-delete\" type=\"button\" data-delete-budget=\"" + escapeHTML(budget.id) + "\" aria-label=\"Usuń kopertę\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13\"></path></svg></button></div></div>" +
        "<div class=\"envelope-values\"><span>Wydano <strong>" + escapeHTML(money(spent)) + "</strong></span><span>Limit <strong>" + escapeHTML(money(budget.limit)) + "</strong></span></div>" +
        "<div class=\"envelope-progress\"><i style=\"width:" + Math.min(percent, 100) + "%\"></i></div>" +
        "<div class=\"envelope-status\">" + (over ? "Przekroczono o " + escapeHTML(money(Math.abs(remaining))) : "Zostało " + escapeHTML(money(remaining))) + "</div></article>";
    }).join("");
  }

  function calendarEvents(month) {
    var start = startOfMonth(currentYear(), month);
    var end = endOfMonth(currentYear(), month);
    var events = [];
    (modules().recurring ? data.recurring : []).filter(function (item) { return item.active; }).forEach(function (recurring) {
      recurringOccurrences(recurring, start, end).forEach(function (date) {
        events.push({ date: date, kind: "recurring", title: recurring.name, amount: recurring.amount, direction: recurring.type });
      });
    });
    data.goals.forEach(function (goal) {
      var plan = goalPlan(goal);
      if (plan.remaining <= 0) return;
      goalScheduleDates(goal, start, end).forEach(function (date) {
        events.push({ date: date, kind: "goal", title: goal.name, amount: Math.min(plan.recommended, plan.remaining) });
      });
    });
    data.debts.forEach(function (debt) {
      var plan = debtPlan(debt);
      if (plan.remaining <= 0) return;
      debtScheduleDates(debt, start, end).forEach(function (date) {
        events.push({ date: date, kind: "debt", title: debt.name, amount: Math.min(plan.recommended, plan.remaining + plan.estimatedInterest) });
      });
    });
    return events.sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });
  }

  function renderCalendar() {
    var year = currentYear();
    var month = state.planMonth;
    var events = calendarEvents(month);
    $("#calendar-title").textContent = MONTHS[month] + " " + year;
    var first = startOfMonth(year, month);
    var dayOffset = (first.getDay() + 6) % 7;
    var days = endOfMonth(year, month).getDate();
    var html = ["<div class=\"calendar-weekday\">Pon</div><div class=\"calendar-weekday\">Wt</div><div class=\"calendar-weekday\">Śr</div><div class=\"calendar-weekday\">Czw</div><div class=\"calendar-weekday\">Pt</div><div class=\"calendar-weekday\">Sob</div><div class=\"calendar-weekday\">Nie</div>"];
    for (var empty = 0; empty < dayOffset; empty += 1) html.push("<div class=\"calendar-day is-empty\"></div>");
    for (var day = 1; day <= days; day += 1) {
      var date = clampDate(year, month, day);
      var key = isoDate(date);
      var dayEvents = events.filter(function (event) { return isoDate(event.date) === key; });
      var todayClass = key === isoDate(startOfToday()) ? " is-today" : "";
      html.push("<div class=\"calendar-day" + todayClass + "\"><strong>" + day + "</strong><div class=\"calendar-day-events\">" + dayEvents.slice(0, 3).map(function (event) {
        return "<i class=\"calendar-dot is-" + event.kind + "\" aria-label=\"" + escapeHTML(event.title) + "\"></i>";
      }).join("") + (dayEvents.length > 3 ? "<small>+" + (dayEvents.length - 3) + "</small>" : "") + "</div></div>");
    }
    $("#calendar-grid").innerHTML = html.join("");
    $("#calendar-events").innerHTML = events.length ? events.map(function (event) {
      var sign = event.kind === "recurring" && event.direction === "income" ? "+" : "−";
      return "<div class=\"calendar-event is-" + event.kind + "\"><time>" + escapeHTML(formattedDate(isoDate(event.date)).slice(0, 5)) + "</time><div><strong>" + escapeHTML(event.title) + "</strong><span>" + (event.kind === "goal" ? "Wpłata na cel" : event.kind === "debt" ? "Rata długu" : "Cykliczny " + (event.direction === "income" ? "wpływ" : "wydatek")) + "</span></div><strong>" + sign + escapeHTML(money(event.amount)) + "</strong></div>";
    }).join("") : "<div class=\"empty-plan\">Brak zaplanowanych terminów w tym miesiącu.</div>";
  }

  function renderPlan() {
    renderPlanMonthTabs();
    $("#recurring-module-card").hidden = !modules().recurring;
    $("#budget-module-card").hidden = !modules().categoryBudgets;
    if (modules().recurring) renderRecurring();
    if (modules().categoryBudgets) renderBudgets();
    renderCalendar();
  }

  function forecastRows() {
    var balance = totalOpeningAvailable();
    var today = startOfToday();
    return MONTHS.map(function (_, month) {
      var actual = monthTransactions(month).reduce(function (sum, transaction) { return sum + impact(transaction).available; }, 0);
      var plannedIncome = 0;
      var plannedOutflow = 0;
      var monthDate = endOfMonth(currentYear(), month);
      var includePlan = monthDate.getTime() >= today.getTime();
      if (includePlan) {
        plannedItemsForMonth(month).forEach(function (item) {
          if (item.complete || item.remaining <= 0) return;
          if (item.kind === "recurring" && item.direction === "income") plannedIncome += item.remaining;
          else plannedOutflow += item.remaining;
        });
      }
      balance += actual + plannedIncome - plannedOutflow;
      return { month: month, actual: actual, plannedIncome: plannedIncome, plannedOutflow: plannedOutflow, balance: balance };
    });
  }

  function renderForecastChart(rows) {
    var width = 840;
    var height = 300;
    var left = 58;
    var right = 18;
    var top = 20;
    var bottom = 42;
    var plotWidth = width - left - right;
    var plotHeight = height - top - bottom;
    var values = rows.map(function (row) { return row.balance; });
    var min = Math.min.apply(null, values.concat([0]));
    var max = Math.max.apply(null, values.concat([0]));
    if (max === min) max = min + 1;
    function x(index) { return left + plotWidth * index / 11; }
    function y(value) { return top + (max - value) / (max - min) * plotHeight; }
    var line = rows.map(function (row, index) { return (index ? "L" : "M") + x(index) + " " + y(row.balance); }).join(" ");
    var area = line + " L" + x(11) + " " + (top + plotHeight) + " L" + x(0) + " " + (top + plotHeight) + " Z";
    var svg = ["<svg viewBox=\"0 0 " + width + " " + height + "\" role=\"img\" aria-label=\"Prognozowane saldo w kolejnych miesiącach\"><defs><linearGradient id=\"forecastArea\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop stop-color=\"var(--primary)\" stop-opacity=\".28\"></stop><stop offset=\"1\" stop-color=\"var(--primary)\" stop-opacity=\"0\"></stop></linearGradient></defs>"];
    for (var grid = 0; grid <= 4; grid += 1) {
      var value = min + (max - min) * grid / 4;
      var gridY = y(value);
      svg.push("<line x1=\"" + left + "\" y1=\"" + gridY + "\" x2=\"" + (width - right) + "\" y2=\"" + gridY + "\" stroke=\"var(--border)\"></line><text x=\"" + (left - 8) + "\" y=\"" + (gridY + 4) + "\" text-anchor=\"end\" fill=\"var(--muted)\" font-size=\"10\">" + escapeHTML(compactMoney(value)) + "</text>");
    }
    if (min < 0 && max > 0) svg.push("<line x1=\"" + left + "\" y1=\"" + y(0) + "\" x2=\"" + (width - right) + "\" y2=\"" + y(0) + "\" stroke=\"var(--danger)\" stroke-width=\"1.5\"></line>");
    svg.push("<path d=\"" + area + "\" fill=\"url(#forecastArea)\"></path><path class=\"forecast-line\" d=\"" + line + "\" fill=\"none\" stroke=\"var(--primary)\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"></path>");
    rows.forEach(function (row, index) {
      svg.push("<circle class=\"forecast-point\" cx=\"" + x(index) + "\" cy=\"" + y(row.balance) + "\" r=\"5\" fill=\"var(--surface)\" stroke=\"var(--primary)\" stroke-width=\"3\"><title>" + MONTHS[index] + ": " + escapeHTML(money(row.balance)) + "</title></circle><text x=\"" + x(index) + "\" y=\"" + (height - 14) + "\" text-anchor=\"middle\" fill=\"var(--muted)\" font-size=\"10\">" + MONTHS_SHORT[index] + "</text>");
    });
    svg.push("</svg>");
    $("#forecast-chart").innerHTML = svg.join("");
  }

  function renderAnalytics() {
    var rows = forecastRows();
    var lowest = rows.reduce(function (selected, row) { return row.balance < selected.balance ? row : selected; }, rows[0]);
    var outflows = rows.reduce(function (sum, row) { return sum + row.plannedOutflow; }, 0);
    $("#forecast-ending").textContent = money(rows[11].balance);
    $("#forecast-ending").classList.toggle("negative", rows[11].balance < 0);
    $("#forecast-lowest").textContent = money(lowest.balance);
    $("#forecast-lowest").classList.toggle("negative", lowest.balance < 0);
    $("#forecast-lowest-month").textContent = MONTHS[lowest.month] + " " + currentYear();
    $("#forecast-outflows").textContent = money(outflows);
    renderForecastChart(rows);
    $("#forecast-table").innerHTML = rows.map(function (row) {
      return "<tr><td data-label=\"Miesiąc\"><strong>" + MONTHS[row.month] + "</strong></td><td data-label=\"Rzeczywiste\" class=\"amount " + (row.actual < 0 ? "is-out" : "") + "\">" + escapeHTML(money(row.actual)) + "</td><td data-label=\"Planowane wpływy\">" + escapeHTML(money(row.plannedIncome)) + "</td><td data-label=\"Planowane wypływy\">" + escapeHTML(money(row.plannedOutflow)) + "</td><td data-label=\"Prognozowane saldo\" class=\"balance " + (row.balance < 0 ? "negative" : "") + "\">" + escapeHTML(money(row.balance)) + "</td></tr>";
    }).join("");
  }

  function renderBackups(errorMessage) {
    var node = $("#backups-list");
    if (!node) return;
    if (errorMessage) {
      node.innerHTML = "<div class=\"empty-backups\">" + escapeHTML(errorMessage) + "</div>";
      return;
    }
    if (!backups.length) {
      node.innerHTML = "<div class=\"empty-backups\">Pierwsza kopia powstanie przy najbliższym zapisie.</div>";
      return;
    }
    node.innerHTML = backups.map(function (backup, index) {
      return "<div class=\"backup-item\"><div><strong>" + (index === 0 ? "Najnowsza kopia" : "Kopia " + (index + 1)) + "</strong><span>" + escapeHTML(formattedDateTime(backup.createdAt)) + " • " + Math.max(1, Math.round(number(backup.size) / 1024)) + " KB</span></div><button class=\"text-button\" type=\"button\" data-restore-backup=\"" + escapeHTML(backup.name) + "\">Przywróć</button></div>";
    }).join("");
  }

  function buildMonthlyReport() {
    var stats = monthStats(state.month);
    var list = monthTransactions(state.month);
    var plan = plannedItemsForMonth(state.month);
    return "<div class=\"print-head\"><div><span>Lokalny budżet gotówkowy</span><h1>" + MONTHS[state.month] + " " + currentYear() + "</h1></div><strong>Raport miesięczny</strong></div>" +
      "<div class=\"print-metrics\"><div><span>Wpływy</span><strong>" + escapeHTML(money(stats.income)) + "</strong></div><div><span>Wydatki</span><strong>" + escapeHTML(money(stats.expense)) + "</strong></div><div><span>Cele i długi netto</span><strong>" + escapeHTML(money(stats.targets)) + "</strong></div></div>" +
      "<h2>Operacje</h2><table><thead><tr><th>Data</th><th>Rodzaj</th><th>Opis</th><th>Kwota</th></tr></thead><tbody>" + (list.length ? list.map(function (transaction) { return "<tr><td>" + escapeHTML(formattedDate(transaction.date)) + "</td><td>" + escapeHTML(TYPE_LABELS[transaction.type] || transaction.type) + "</td><td>" + escapeHTML(transaction.description || targetName(transaction)) + "</td><td>" + escapeHTML(money(transaction.amount)) + "</td></tr>"; }).join("") : "<tr><td colspan=\"4\">Brak operacji</td></tr>") + "</tbody></table>" +
      "<h2>Plan miesiąca</h2><table><thead><tr><th>Zadanie</th><th>Plan</th><th>Wykonano</th><th>Status</th></tr></thead><tbody>" + (plan.length ? plan.map(function (item) { return "<tr><td>" + escapeHTML(item.title) + "</td><td>" + escapeHTML(money(item.planned)) + "</td><td>" + escapeHTML(money(item.actual)) + "</td><td>" + (item.complete ? "Wykonane" : "Brakuje " + escapeHTML(money(item.remaining))) + "</td></tr>"; }).join("") : "<tr><td colspan=\"4\">Brak zaplanowanych zadań</td></tr>") + "</tbody></table>";
  }

  function buildAnnualReport() {
    var rows = forecastRows();
    return "<div class=\"print-head\"><div><span>Lokalny budżet gotówkowy</span><h1>Rok " + currentYear() + "</h1></div><strong>Raport roczny</strong></div>" +
      "<h2>Podsumowanie i prognoza</h2><table><thead><tr><th>Miesiąc</th><th>Wpływy</th><th>Wydatki</th><th>Cele i długi</th><th>Prognozowane saldo</th></tr></thead><tbody>" + rows.map(function (row) { var stats = monthStats(row.month); return "<tr><td>" + MONTHS[row.month] + "</td><td>" + escapeHTML(money(stats.income)) + "</td><td>" + escapeHTML(money(stats.expense)) + "</td><td>" + escapeHTML(money(stats.targets)) + "</td><td>" + escapeHTML(money(row.balance)) + "</td></tr>"; }).join("") + "</tbody></table>" +
      "<h2>Cele</h2><table><thead><tr><th>Nazwa</th><th>Cel</th><th>Odłożono</th><th>Zostało</th></tr></thead><tbody>" + (data.goals.length ? data.goals.map(function (goal) { return "<tr><td>" + escapeHTML(goal.name) + "</td><td>" + escapeHTML(money(goal.target)) + "</td><td>" + escapeHTML(money(goalSaved(goal))) + "</td><td>" + escapeHTML(money(goalRemaining(goal))) + "</td></tr>"; }).join("") : "<tr><td colspan=\"4\">Brak celów</td></tr>") + "</tbody></table>" +
      "<h2>Długi</h2><table><thead><tr><th>Nazwa</th><th>Kwota</th><th>Spłacono</th><th>Zostało</th></tr></thead><tbody>" + (data.debts.length ? data.debts.map(function (debt) { return "<tr><td>" + escapeHTML(debt.name) + "</td><td>" + escapeHTML(money(debt.total)) + "</td><td>" + escapeHTML(money(debtPaid(debt))) + "</td><td>" + escapeHTML(money(debtRemaining(debt))) + "</td></tr>"; }).join("") : "<tr><td colspan=\"4\">Brak długów</td></tr>") + "</tbody></table>";
  }

  function printReport(kind) {
    var node = $("#print-report");
    node.innerHTML = kind === "month" ? buildMonthlyReport() : buildAnnualReport();
    node.hidden = false;
    document.body.classList.add("is-printing");
    window.setTimeout(function () {
      if (typeof window.print === "function") window.print();
      window.setTimeout(function () {
        document.body.classList.remove("is-printing");
        node.hidden = true;
      }, 300);
    }, 30);
  }

  function accountTypeLabel(type) {
    if (type === "bank") return "Konto osobiste";
    if (type === "savings") return "Konto oszczędnościowe";
    return "Gotówka";
  }

  function accountVisual(type) {
    if (type === "bank") return { icon: "B", color: "#3b82f6" };
    if (type === "savings") return { icon: "S", color: "#8b5cf6" };
    return { icon: "G", color: "#14b8a6" };
  }

  function accountBalanceDate() {
    var today = startOfToday();
    if (today.getFullYear() === currentYear()) return isoDate(today);
    return currentYear() + "-12-31";
  }

  function renderAccounts() {
    var accounts = activeAccounts(true);
    var throughDate = accountBalanceDate();
    var total = accounts.reduce(function (sum, account) { return sum + accountBalance(account, throughDate); }, 0);
    var cash = accounts.filter(function (account) { return account.type === "cash"; }).reduce(function (sum, account) { return sum + accountBalance(account, throughDate); }, 0);
    var bank = accounts.filter(function (account) { return account.type !== "cash"; }).reduce(function (sum, account) { return sum + accountBalance(account, throughDate); }, 0);
    var imported = data.transactions.filter(function (transaction) { return transaction.source === "statement"; }).length;
    $("#accounts-summary").innerHTML =
      "<div class=\"summary-item\"><span>Wszystkie środki</span><strong>" + escapeHTML(money(total)) + "</strong></div>" +
      "<div class=\"summary-item\"><span>Gotówka</span><strong>" + escapeHTML(money(cash)) + "</strong></div>" +
      "<div class=\"summary-item\"><span>Konta bankowe</span><strong>" + escapeHTML(money(bank)) + "</strong></div>" +
      "<div class=\"summary-item\"><span>Zaimportowane operacje</span><strong>" + imported + "</strong></div>";
    $("#import-statement").hidden = !modules().statementImport;
    var node = $("#accounts-grid");
    if (!accounts.length) {
      node.innerHTML = "<div class=\"empty-targets\"><div><strong>Brak kont</strong><span>Dodaj gotówkę albo konto bankowe, aby przypisywać do niego operacje.</span></div></div>";
      return;
    }
    node.innerHTML = accounts.map(function (account, index) {
      var visual = accountVisual(account.type);
      var balance = accountBalance(account, throughDate);
      var movement = balance - accountOpening(account);
      var sourceCount = data.transactions.filter(function (transaction) { return transaction.accountId === account.id || transaction.toAccountId === account.id; }).length;
      return "<article class=\"account-card " + (account.active === false ? "is-inactive" : "") + "\" style=\"--account-color:" + visual.color + ";animation-delay:" + (index * .05) + "s\">" +
        "<div class=\"account-head\"><div><div class=\"account-icon\">" + visual.icon + "</div><div><h3>" + escapeHTML(account.name) + "</h3><p>" + escapeHTML(accountTypeLabel(account.type)) + (account.active === false ? " • nieaktywne" : "") + "</p></div></div>" +
        "<div class=\"row-actions\"><button class=\"tiny-button\" type=\"button\" data-edit-account=\"" + escapeHTML(account.id) + "\" aria-label=\"Edytuj konto\"><svg viewBox=\"0 0 24 24\"><path d=\"m4 20 4-1 11-11-3-3L5 16l-1 4Z\"></path></svg></button>" +
        "<button class=\"tiny-button is-delete\" type=\"button\" data-delete-account=\"" + escapeHTML(account.id) + "\" aria-label=\"Usuń konto\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13\"></path></svg></button></div></div>" +
        "<div class=\"account-balance-row\"><div><span>Aktualne saldo</span><strong class=\"" + (balance < 0 ? "negative" : "") + "\">" + escapeHTML(money(balance)) + "</strong></div><span>" + (movement >= 0 ? "+" : "") + escapeHTML(money(movement)) + " w roku</span></div>" +
        "<div class=\"account-footer\"><span>Saldo 1 stycznia: " + escapeHTML(money(accountOpening(account))) + "</span><span>" + sourceCount + (sourceCount === 1 ? " operacja" : " operacji") + "</span></div></article>";
    }).join("");
  }

  function renderUpdateStatus() {
    var status = updateStatus || { state: "disabled", message: "Kanał aktualizacji zostanie aktywowany przy publikacji programu." };
    var labels = {
      disabled: "Nieaktywne", idle: "Gotowe", checking: "Sprawdzanie…", available: "Pobieranie…",
      downloaded: "Gotowa", current: "Aktualna", error: "Błąd"
    };
    $("#desktop-app-version").textContent = appInfo && appInfo.version ? appInfo.version : "wersja lokalna";
    $("#update-status").textContent = labels[status.state] || "Status";
    $("#update-status").className = "status-badge " + (status.state === "error" ? "is-overdue" : status.state === "downloaded" || status.state === "current" ? "is-done" : "");
    $("#update-message").textContent = status.message || "";
    $("#install-update").hidden = status.state !== "downloaded";
    $("#check-updates").disabled = status.state === "disabled" || status.state === "checking" || status.state === "available";
  }

  function applyModuleVisibility() {
    var config = modules();
    $("#accounts-nav").hidden = !config.bankAccounts;
    $("#import-statement").hidden = !config.bankAccounts || !config.statementImport;
    $("#recurring-module-card").hidden = !config.recurring;
    $("#budget-module-card").hidden = !config.categoryBudgets;
    $("#debt-interest-enabled").closest("label").hidden = !config.interest;
    var transferOption = $("#transaction-type option[value=\"transfer\"]");
    if (transferOption) transferOption.hidden = !config.bankAccounts;
    if (state.page === "accounts" && !config.bankAccounts) setPage("dashboard");
  }

  function renderSettings() {
    var balance = yearBalance();
    var cashAccount = mainCashAccount();
    $("#settings-year").value = currentYear();
    $("#settings-available").value = cashAccount && cashAccount.openingBalances[String(currentYear())] != null ? number(cashAccount.openingBalances[String(currentYear())]) : number(balance.available);
    $("#settings-available-label").textContent = modules().bankAccounts ? "Gotówka główna 1 stycznia" : "Gotówka dostępna 1 stycznia";
    $("#settings-reserve").value = number(balance.reserve);
    $("#settings-categories").value = data.settings.categories.join("\n");
    $("#module-bank-accounts").checked = !!modules().bankAccounts;
    $("#module-statement-import").checked = !!modules().statementImport;
    $("#module-statement-import").disabled = !modules().bankAccounts;
    $("#module-alerts").checked = !!modules().alerts;
    $("#module-daily-limit").checked = !!modules().dailyLimit;
    $("#module-weekly-limit").checked = !!modules().weeklyLimit;
    $("#module-interest").checked = !!modules().interest;
    $("#module-recurring").checked = !!modules().recurring;
    $("#module-category-budgets").checked = !!modules().categoryBudgets;
    $("#settings-payday-day").value = number(data.settings.payday && data.settings.payday.day) || 10;
    $("#settings-next-payday").value = String(data.settings.payday && data.settings.payday.nextDate || "");
    if (appInfo) {
      $("#desktop-data-file").textContent = String(appInfo.dataPath || "portfel.sqlite").split(/[\\/]/).pop();
      $("#desktop-data-path").textContent = appInfo.dataPath || "Lokalna baza danych";
    }
    $("#settings-error").textContent = "";
    renderBackups();
    renderUpdateStatus();
  }

  function renderAll() {
    applyModuleVisibility();
    renderNavCounts();
    renderDashboard();
    if (state.page === "months") renderMonths();
    if (state.page === "goals") renderGoals();
    if (state.page === "debts") renderDebts();
    if (state.page === "plan") renderPlan();
    if (state.page === "analytics") renderAnalytics();
    if (state.page === "accounts") renderAccounts();
    if (state.page === "settings") renderSettings();
    updateSaveState();
  }

  function openDialog(id) {
    var dialog = $("#" + id);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog(id) {
    var dialog = $("#" + id);
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function defaultTransactionDate() {
    var now = new Date();
    if (now.getFullYear() === currentYear() && now.getMonth() === state.month) return isoDate(now);
    return currentYear() + "-" + String(state.month + 1).padStart(2, "0") + "-01";
  }

  function setTransactionDateLimits() {
    var lastDay = new Date(currentYear(), state.month + 1, 0).getDate();
    var prefix = currentYear() + "-" + String(state.month + 1).padStart(2, "0") + "-";
    $("#transaction-date").min = prefix + "01";
    $("#transaction-date").max = prefix + String(lastDay).padStart(2, "0");
  }

  function renderTransactionOptions() {
    var type = $("#transaction-type").value;
    var categoryField = $("#transaction-category-field");
    var targetField = $("#transaction-target-field");
    var target = $("#transaction-target");
    var goalType = type === "goal" || type === "goal_withdraw";
    var targetType = goalType || type === "debt";
    var transfer = type === "transfer";
    categoryField.hidden = targetType || transfer || type === "reserve_in" || type === "reserve_out";
    targetField.hidden = !targetType;
    $("#transaction-account-field").hidden = !modules().bankAccounts && !transfer;
    $("#transaction-to-account-field").hidden = !transfer;
    $("#transaction-category").required = type === "income" || type === "expense";
    target.required = targetType;
    $("#transaction-to-account").required = transfer;
    if (!targetType) return;
    var items = goalType ? data.goals : data.debts;
    $("#transaction-target-label").textContent = goalType ? "Cel" : "Dług";
    var existingValue = target.value;
    target.innerHTML = items.map(function (item) {
      var left = type === "goal" ? goalRemaining(item, state.editingTransaction) : type === "goal_withdraw" ? goalSaved(item, state.editingTransaction) : debtRemaining(item, state.editingTransaction);
      var suffix = type === "goal_withdraw" ? "dostępne " : "zostało ";
      return "<option value=\"" + escapeHTML(item.id) + "\">" + escapeHTML(item.name) + " — " + suffix + escapeHTML(money(left)) + "</option>";
    }).join("");
    if (!items.length) target.innerHTML = "<option value=\"\">Najpierw dodaj " + (goalType ? "cel" : "dług") + "</option>";
    if (items.some(function (item) { return item.id === existingValue; })) target.value = existingValue;
  }

  function fillCategoryOptions() {
    var current = $("#transaction-category").value;
    $("#transaction-category").innerHTML = data.settings.categories.map(function (category) {
      return "<option value=\"" + escapeHTML(category) + "\">" + escapeHTML(category) + "</option>";
    }).join("");
    if (data.settings.categories.indexOf(current) >= 0) $("#transaction-category").value = current;
  }

  function fillAccountOptions() {
    var transactionCurrent = $("#transaction-account").value;
    var destinationCurrent = $("#transaction-to-account").value;
    var recurringCurrent = $("#recurring-account").value;
    var accounts = activeAccounts();
    var options = accounts.map(function (account) {
      return "<option value=\"" + escapeHTML(account.id) + "\">" + escapeHTML(account.name + " • " + accountTypeLabel(account.type)) + "</option>";
    }).join("");
    if (!options) options = "<option value=\"\">Brak aktywnego konta</option>";
    $("#transaction-account").innerHTML = options;
    $("#transaction-to-account").innerHTML = options;
    $("#recurring-account").innerHTML = options;
    if (accounts.some(function (account) { return account.id === transactionCurrent; })) $("#transaction-account").value = transactionCurrent;
    if (accounts.some(function (account) { return account.id === destinationCurrent; })) $("#transaction-to-account").value = destinationCurrent;
    else if (accounts.length > 1) $("#transaction-to-account").value = accounts[1].id;
    if (accounts.some(function (account) { return account.id === recurringCurrent; })) $("#recurring-account").value = recurringCurrent;
  }

  function openTransactionDialog(editingId, presetType, presetTarget, presetAmount, presetDate, presetRecurringId) {
    state.editingTransaction = editingId || null;
    state.transactionPreset = null;
    $("#transaction-form").reset();
    $("#transaction-error").textContent = "";
    setTransactionDateLimits();
    fillCategoryOptions();
    fillAccountOptions();
    var transaction = editingId ? data.transactions.find(function (item) { return item.id === editingId; }) : null;
    if (transaction) {
      var date = dateFromISO(transaction.date);
      if (date) state.month = date.getMonth();
      setTransactionDateLimits();
      $("#transaction-date").value = transaction.date;
      $("#transaction-type").value = transaction.type;
      renderTransactionOptions();
      $("#transaction-category").value = transaction.category || data.settings.categories[0] || "";
      $("#transaction-target").value = transaction.targetId || "";
      $("#transaction-account").value = transaction.accountId || mainCashAccount().id;
      $("#transaction-to-account").value = transaction.toAccountId || "";
      $("#transaction-description").value = transaction.description || "";
      $("#transaction-amount").value = transaction.amount;
      $("#transaction-note").value = transaction.note || "";
      $("#transaction-dialog-title").textContent = "Edytuj operację";
    } else {
      $("#transaction-date").value = presetDate || defaultTransactionDate();
      $("#transaction-type").value = presetType || "expense";
      renderTransactionOptions();
      if (presetTarget) $("#transaction-target").value = presetTarget;
      if (number(presetAmount) > 0) $("#transaction-amount").value = number(presetAmount).toFixed(2);
      if (presetDate && (presetType === "goal" || presetType === "debt")) {
        state.transactionPreset = { recurringId: "", scheduledDate: presetDate };
      }
      if (presetRecurringId) {
        var recurring = data.recurring.find(function (item) { return item.id === presetRecurringId; });
        if (recurring) {
          $("#transaction-category").value = recurring.category;
          $("#transaction-account").value = recurring.accountId || mainCashAccount().id;
          $("#transaction-description").value = recurring.name;
          state.transactionPreset = { recurringId: recurring.id, scheduledDate: presetDate || "" };
        }
      }
      $("#transaction-dialog-title").textContent = "Dodaj operację";
    }
    renderTransactionOptions();
    openDialog("transaction-dialog");
  }

  function transactionDateValid(value) {
    var date = dateFromISO(value);
    return !!date && date.getFullYear() === currentYear() && date.getMonth() === state.month;
  }

  function submitTransaction(event) {
    event.preventDefault();
    var error = $("#transaction-error");
    error.textContent = "";
    var type = $("#transaction-type").value;
    var amount = number($("#transaction-amount").value);
    var date = $("#transaction-date").value;
    var targetId = $("#transaction-target").value;
    var accountId = $("#transaction-account").value || (mainCashAccount() && mainCashAccount().id);
    var toAccountId = $("#transaction-to-account").value;
    if (!transactionDateValid(date)) {
      error.textContent = "Data musi należeć do wybranego miesiąca.";
      return;
    }
    if (!(amount > 0)) {
      error.textContent = "Kwota musi być większa od zera.";
      return;
    }
    if (!data.accounts.some(function (account) { return account.id === accountId; })) {
      error.textContent = "Wybierz konto dla tej operacji.";
      return;
    }
    if (type === "transfer" && (!modules().bankAccounts || !data.accounts.some(function (account) { return account.id === toAccountId; }) || accountId === toAccountId)) {
      error.textContent = "Wybierz dwa różne konta dla transferu.";
      return;
    }
    if (type === "goal") {
      var goal = data.goals.find(function (item) { return item.id === targetId; });
      if (!goal) {
        error.textContent = "Najpierw dodaj cel.";
        return;
      }
      if (amount > goalRemaining(goal, state.editingTransaction) + .0001) {
        error.textContent = "Wpłata przekracza kwotę pozostałą do celu.";
        return;
      }
    }
    if (type === "goal_withdraw") {
      var withdrawalGoal = data.goals.find(function (item) { return item.id === targetId; });
      if (!withdrawalGoal) {
        error.textContent = "Najpierw dodaj cel.";
        return;
      }
      if (amount > goalSaved(withdrawalGoal, state.editingTransaction) + .0001) {
        error.textContent = "Nie możesz wypłacić więcej niż aktualnie odłożono na ten cel.";
        return;
      }
    }
    if (type === "debt") {
      var debt = data.debts.find(function (item) { return item.id === targetId; });
      if (!debt) {
        error.textContent = "Najpierw dodaj dług.";
        return;
      }
      var debtLeft = debtRemaining(debt, state.editingTransaction);
      var nextInterest = modules().interest && debt.interestEnabled ? debtLeft * Math.max(0, number(debt.apr)) / 1200 : 0;
      if (amount > debtLeft + nextInterest + .0001) {
        error.textContent = "Wpłata przekracza pozostałe saldo wraz z odsetkami za najbliższy okres.";
        return;
      }
    }
    var existing = data.transactions.find(function (item) { return item.id === state.editingTransaction; });
    var transaction = {
      id: existing ? existing.id : uid("tx"),
      date: date,
      type: type,
      category: type === "income" || type === "expense" ? $("#transaction-category").value : "",
      targetId: type === "goal" || type === "goal_withdraw" || type === "debt" ? targetId : "",
      recurringId: existing ? existing.recurringId || "" : state.transactionPreset ? state.transactionPreset.recurringId : "",
      scheduledDate: existing ? existing.scheduledDate || "" : state.transactionPreset ? state.transactionPreset.scheduledDate : "",
      description: $("#transaction-description").value.trim(),
      amount: amount,
      note: $("#transaction-note").value.trim(),
      accountId: accountId,
      toAccountId: type === "transfer" ? toAccountId : "",
      importFingerprint: existing ? existing.importFingerprint || "" : "",
      source: existing ? existing.source || "manual" : "manual",
      createdAt: existing ? existing.createdAt : new Date().toISOString()
    };
    if (existing) {
      data.transactions = data.transactions.map(function (item) {
        return item.id === existing.id ? transaction : item;
      });
    } else {
      data.transactions.push(transaction);
    }
    state.editingTransaction = null;
    state.transactionPreset = null;
    closeDialog("transaction-dialog");
    markDirty(existing ? "Zmieniono operację." : "Dodano operację.");
    renderAll();
    if (state.page === "months") renderMonths();
  }

  function deleteTransaction(id) {
    if (!window.confirm("Usunąć tę operację? Cel lub dług zostanie automatycznie przeliczony.")) return;
    data.transactions = data.transactions.filter(function (item) { return item.id !== id; });
    markDirty("Usunięto operację.");
    renderAll();
  }

  function openGoalDialog(id) {
    state.editingGoal = id || null;
    $("#goal-form").reset();
    $("#goal-error").textContent = "";
    fillGoalPaydayOptions();
    var goal = id ? data.goals.find(function (item) { return item.id === id; }) : null;
    if (goal) {
      $("#goal-name").value = goal.name;
      $("#goal-target").value = goal.target;
      $("#goal-deadline").value = goal.deadline || "";
      $("#goal-start").value = goal.startDate || String(goal.createdAt || "").slice(0, 10) || isoDate(startOfToday());
      $("#goal-cadence").value = goal.cadence || "monthly";
      $("#goal-payment-day").value = number(goal.paymentDay) || 1;
      $("#goal-payday-recurring").value = goal.paydayRecurringId || "";
      $("#goal-max-contribution").value = number(goal.maxContribution) || "";
      $("#goal-dialog-title").textContent = "Edytuj cel";
    } else {
      $("#goal-start").value = isoDate(startOfToday());
      $("#goal-cadence").value = "monthly";
      $("#goal-payment-day").value = 1;
      $("#goal-dialog-title").textContent = "Dodaj cel";
    }
    updateGoalCadenceFields();
    openDialog("goal-dialog");
  }

  function fillGoalPaydayOptions() {
    var current = $("#goal-payday-recurring").value;
    var incomes = data.recurring.filter(function (item) { return item.active && item.type === "income"; });
    $("#goal-payday-recurring").innerHTML = incomes.length ? incomes.map(function (item) {
      return "<option value=\"" + escapeHTML(item.id) + "\">" + escapeHTML(item.name + " • " + money(item.amount)) + "</option>";
    }).join("") : "<option value=\"\">Najpierw dodaj cykliczną wypłatę</option>";
    if (incomes.some(function (item) { return item.id === current; })) $("#goal-payday-recurring").value = current;
    else if (incomes.length) $("#goal-payday-recurring").value = incomes[0].id;
  }

  function updateGoalCadenceFields() {
    var cadence = $("#goal-cadence").value;
    var field = $("#goal-payment-day-field");
    field.hidden = cadence === "payday";
    $("#goal-payday-field").hidden = cadence !== "payday";
    $("#goal-payment-day").required = cadence !== "payday";
    $("#goal-payment-day").max = cadence === "weekly" ? "7" : "31";
    $("#goal-payment-day-label").textContent = cadence === "weekly" ? "Dzień tygodnia (1=pon., 7=niedz.)" : "Dzień miesiąca";
    if (cadence === "weekly" && number($("#goal-payment-day").value) > 7) $("#goal-payment-day").value = 1;
  }

  function submitGoal(event) {
    event.preventDefault();
    var name = $("#goal-name").value.trim();
    var target = number($("#goal-target").value);
    var startDate = $("#goal-start").value;
    var deadline = $("#goal-deadline").value;
    var cadence = $("#goal-cadence").value;
    var paymentDay = Math.round(number($("#goal-payment-day").value) || 1);
    var maxContribution = number($("#goal-max-contribution").value);
    var paydayRecurringId = cadence === "payday" ? $("#goal-payday-recurring").value : "";
    var error = $("#goal-error");
    error.textContent = "";
    if (!name || !(target > 0) || !startDate || !deadline) {
      error.textContent = "Podaj nazwę, kwotę, początek planu i termin.";
      return;
    }
    if (dateFromISO(deadline).getTime() < dateFromISO(startDate).getTime()) {
      error.textContent = "Termin celu nie może być wcześniejszy niż początek planu.";
      return;
    }
    if (cadence !== "payday" && (paymentDay < 1 || paymentDay > (cadence === "weekly" ? 7 : 31))) {
      error.textContent = "Sprawdź dzień planowanej wpłaty.";
      return;
    }
    var editingGoal = state.editingGoal ? data.goals.find(function (item) { return item.id === state.editingGoal; }) : null;
    var alreadySaved = editingGoal ? goalSaved(editingGoal) : 0;
    if (target + .0001 < alreadySaved) {
      error.textContent = "Kwota celu nie może być niższa niż już odłożona suma.";
      return;
    }
    var existing = data.goals.find(function (item) { return item.id === state.editingGoal; });
    var goal = {
      id: existing ? existing.id : uid("goal"),
      name: name,
      target: target,
      deadline: deadline,
      startDate: startDate,
      cadence: cadence,
      paymentDay: paymentDay,
      paydayRecurringId: paydayRecurringId,
      maxContribution: Math.max(0, maxContribution),
      createdAt: existing ? existing.createdAt : new Date().toISOString()
    };
    if (existing) data.goals = data.goals.map(function (item) { return item.id === existing.id ? goal : item; });
    else data.goals.push(goal);
    state.editingGoal = null;
    closeDialog("goal-dialog");
    markDirty(existing ? "Zmieniono cel." : "Dodano cel.");
    renderAll();
  }

  function deleteGoal(id) {
    if (data.transactions.some(function (transaction) { return (transaction.type === "goal" || transaction.type === "goal_withdraw") && transaction.targetId === id; })) {
      showToast("Ten cel ma powiązane wpłaty. Najpierw usuń lub edytuj te operacje.");
      return;
    }
    if (!window.confirm("Usunąć ten cel?")) return;
    data.goals = data.goals.filter(function (item) { return item.id !== id; });
    markDirty("Usunięto cel.");
    renderAll();
  }

  function openDebtDialog(id) {
    state.editingDebt = id || null;
    $("#debt-form").reset();
    $("#debt-error").textContent = "";
    var debt = id ? data.debts.find(function (item) { return item.id === id; }) : null;
    if (debt) {
      $("#debt-name").value = debt.name;
      $("#debt-total").value = debt.total;
      $("#debt-deadline").value = debt.deadline || "";
      $("#debt-apr").value = number(debt.apr);
      $("#debt-interest-enabled").checked = modules().interest && debt.interestEnabled !== false && number(debt.apr) > 0;
      $("#debt-minimum-payment").value = number(debt.minimumPayment);
      $("#debt-payment-day").value = number(debt.paymentDay) || 1;
      $("#debt-dialog-title").textContent = "Edytuj dług";
    } else {
      $("#debt-apr").value = 0;
      $("#debt-interest-enabled").checked = false;
      $("#debt-minimum-payment").value = 0;
      $("#debt-payment-day").value = 1;
      $("#debt-dialog-title").textContent = "Dodaj dług";
    }
    updateDebtInterestField();
    openDialog("debt-dialog");
  }

  function updateDebtInterestField() {
    var enabled = modules().interest && $("#debt-interest-enabled").checked;
    $("#debt-apr-field").hidden = !enabled;
    $("#debt-apr").required = enabled;
  }

  function submitDebt(event) {
    event.preventDefault();
    var name = $("#debt-name").value.trim();
    var total = number($("#debt-total").value);
    var deadline = $("#debt-deadline").value;
    var existing = data.debts.find(function (item) { return item.id === state.editingDebt; });
    var interestEnabled = modules().interest ? $("#debt-interest-enabled").checked : !!(existing && existing.interestEnabled);
    var apr = modules().interest ? (interestEnabled ? number($("#debt-apr").value) : 0) : number(existing && existing.apr);
    var minimumPayment = number($("#debt-minimum-payment").value);
    var paymentDay = Math.round(number($("#debt-payment-day").value));
    var error = $("#debt-error");
    error.textContent = "";
    if (!name || !(total > 0) || !deadline) {
      error.textContent = "Podaj nazwę, kwotę i termin spłaty.";
      return;
    }
    if (apr < 0 || minimumPayment < 0 || paymentDay < 1 || paymentDay > 31) {
      error.textContent = "Sprawdź oprocentowanie, minimalną ratę i dzień płatności.";
      return;
    }
    var principalPaid = existing ? Math.max(0, number(existing.total) - Math.min(number(existing.total), debtRemaining(existing))) : 0;
    if (total + .0001 < principalPaid) {
      error.textContent = "Kwota długu nie może być niższa niż spłacony kapitał.";
      return;
    }
    var debt = {
      id: existing ? existing.id : uid("debt"),
      name: name,
      total: total,
      deadline: deadline,
      apr: apr,
      interestEnabled: interestEnabled,
      minimumPayment: minimumPayment,
      paymentDay: paymentDay,
      createdAt: existing ? existing.createdAt : new Date().toISOString()
    };
    if (existing) data.debts = data.debts.map(function (item) { return item.id === existing.id ? debt : item; });
    else data.debts.push(debt);
    state.editingDebt = null;
    closeDialog("debt-dialog");
    markDirty(existing ? "Zmieniono dług." : "Dodano dług.");
    renderAll();
  }

  function deleteDebt(id) {
    if (data.transactions.some(function (transaction) { return transaction.type === "debt" && transaction.targetId === id; })) {
      showToast("Ten dług ma powiązane spłaty. Najpierw usuń lub edytuj te operacje.");
      return;
    }
    if (!window.confirm("Usunąć ten dług?")) return;
    data.debts = data.debts.filter(function (item) { return item.id !== id; });
    markDirty("Usunięto dług.");
    renderAll();
  }

  function fillPlanningCategoryOptions() {
    var recurringCurrent = $("#recurring-category").value;
    var budgetCurrent = $("#budget-category").value;
    var options = data.settings.categories.map(function (category) {
      return "<option value=\"" + escapeHTML(category) + "\">" + escapeHTML(category) + "</option>";
    }).join("");
    $("#recurring-category").innerHTML = options;
    $("#budget-category").innerHTML = options;
    if (data.settings.categories.indexOf(recurringCurrent) >= 0) $("#recurring-category").value = recurringCurrent;
    if (data.settings.categories.indexOf(budgetCurrent) >= 0) $("#budget-category").value = budgetCurrent;
  }

  function updateRecurringCadenceFields() {
    var weekly = $("#recurring-cadence").value === "weekly";
    $("#recurring-day").max = weekly ? "7" : "31";
    $("#recurring-day-label").textContent = weekly ? "Dzień tygodnia (1=pon., 7=niedz.)" : "Dzień miesiąca";
    if (weekly && number($("#recurring-day").value) > 7) $("#recurring-day").value = 1;
  }

  function openRecurringDialog(id) {
    state.editingRecurring = id || null;
    $("#recurring-form").reset();
    $("#recurring-error").textContent = "";
    fillPlanningCategoryOptions();
    fillAccountOptions();
    var recurring = id ? data.recurring.find(function (item) { return item.id === id; }) : null;
    if (recurring) {
      $("#recurring-name").value = recurring.name;
      $("#recurring-type").value = recurring.type;
      $("#recurring-amount").value = recurring.amount;
      $("#recurring-category").value = recurring.category;
      $("#recurring-account").value = recurring.accountId || mainCashAccount().id;
      $("#recurring-cadence").value = recurring.cadence;
      $("#recurring-day").value = recurring.day;
      $("#recurring-start").value = recurring.startDate;
      $("#recurring-end").value = recurring.endDate || "";
      $("#recurring-active").checked = recurring.active;
      $("#recurring-dialog-title").textContent = "Edytuj cykliczny wpis";
    } else {
      $("#recurring-cadence").value = "monthly";
      $("#recurring-day").value = 1;
      $("#recurring-start").value = isoDate(startOfToday());
      $("#recurring-active").checked = true;
      $("#recurring-dialog-title").textContent = "Dodaj cykliczny wpis";
    }
    updateRecurringCadenceFields();
    openDialog("recurring-dialog");
  }

  function submitRecurring(event) {
    event.preventDefault();
    var error = $("#recurring-error");
    error.textContent = "";
    var name = $("#recurring-name").value.trim();
    var amount = number($("#recurring-amount").value);
    var cadence = $("#recurring-cadence").value;
    var day = Math.round(number($("#recurring-day").value));
    var startDate = $("#recurring-start").value;
    var endDate = $("#recurring-end").value;
    if (!name || !(amount > 0) || !startDate) {
      error.textContent = "Podaj nazwę, kwotę i datę rozpoczęcia.";
      return;
    }
    if (day < 1 || day > (cadence === "weekly" ? 7 : 31)) {
      error.textContent = "Sprawdź dzień harmonogramu.";
      return;
    }
    if (endDate && dateFromISO(endDate).getTime() < dateFromISO(startDate).getTime()) {
      error.textContent = "Data końcowa nie może być wcześniejsza niż początek.";
      return;
    }
    var existing = data.recurring.find(function (item) { return item.id === state.editingRecurring; });
    var recurring = {
      id: existing ? existing.id : uid("rec"),
      name: name,
      type: $("#recurring-type").value === "income" ? "income" : "expense",
      amount: amount,
      category: $("#recurring-category").value,
      accountId: $("#recurring-account").value || mainCashAccount().id,
      cadence: cadence,
      day: day,
      startDate: startDate,
      endDate: endDate,
      active: $("#recurring-active").checked,
      createdAt: existing ? existing.createdAt : new Date().toISOString()
    };
    if (existing) data.recurring = data.recurring.map(function (item) { return item.id === existing.id ? recurring : item; });
    else data.recurring.push(recurring);
    state.editingRecurring = null;
    closeDialog("recurring-dialog");
    markDirty(existing ? "Zmieniono cykliczny wpis." : "Dodano cykliczny wpis.");
    renderAll();
  }

  function deleteRecurring(id) {
    if (!window.confirm("Usunąć ten harmonogram? Zaksięgowane wcześniej operacje pozostaną bez zmian.")) return;
    data.recurring = data.recurring.filter(function (item) { return item.id !== id; });
    markDirty("Usunięto cykliczny wpis.");
    renderAll();
  }

  function openBudgetDialog(id) {
    state.editingBudget = id || null;
    $("#budget-form").reset();
    $("#budget-error").textContent = "";
    fillPlanningCategoryOptions();
    var budget = id ? data.budgets.find(function (item) { return item.id === id; }) : null;
    if (budget) {
      $("#budget-category").value = budget.category;
      $("#budget-limit").value = budget.limit;
      $("#budget-dialog-title").textContent = "Edytuj limit kategorii";
    } else {
      $("#budget-dialog-title").textContent = "Dodaj limit kategorii";
    }
    openDialog("budget-dialog");
  }

  function submitBudget(event) {
    event.preventDefault();
    var category = $("#budget-category").value;
    var limit = number($("#budget-limit").value);
    var error = $("#budget-error");
    error.textContent = "";
    if (!category || !(limit > 0)) {
      error.textContent = "Wybierz kategorię i podaj limit większy od zera.";
      return;
    }
    var duplicate = data.budgets.find(function (item) { return item.category === category && item.id !== state.editingBudget; });
    if (duplicate) {
      error.textContent = "Ta kategoria ma już kopertę.";
      return;
    }
    var existing = data.budgets.find(function (item) { return item.id === state.editingBudget; });
    var budget = { id: existing ? existing.id : uid("budget"), category: category, limit: limit, createdAt: existing ? existing.createdAt : new Date().toISOString() };
    if (existing) data.budgets = data.budgets.map(function (item) { return item.id === existing.id ? budget : item; });
    else data.budgets.push(budget);
    state.editingBudget = null;
    closeDialog("budget-dialog");
    markDirty(existing ? "Zmieniono kopertę." : "Dodano kopertę.");
    renderAll();
  }

  function deleteBudget(id) {
    if (!window.confirm("Usunąć tę kopertę? Operacje w kategorii pozostaną bez zmian.")) return;
    data.budgets = data.budgets.filter(function (item) { return item.id !== id; });
    markDirty("Usunięto kopertę.");
    renderAll();
  }

  function openAccountDialog(id) {
    state.editingAccount = id || null;
    $("#account-form").reset();
    $("#account-error").textContent = "";
    var account = id ? data.accounts.find(function (item) { return item.id === id; }) : null;
    if (account) {
      $("#account-name").value = account.name;
      $("#account-type").value = account.type;
      $("#account-opening").value = accountOpening(account);
      $("#account-spending-limit").checked = account.includeInSpendingLimit !== false;
      $("#account-active").checked = account.active !== false;
      $("#account-dialog-title").textContent = "Edytuj konto";
    } else {
      $("#account-type").value = "bank";
      $("#account-opening").value = 0;
      $("#account-spending-limit").checked = true;
      $("#account-active").checked = true;
      $("#account-dialog-title").textContent = "Dodaj konto";
    }
    openDialog("account-dialog");
  }

  function submitAccount(event) {
    event.preventDefault();
    var name = $("#account-name").value.trim();
    var type = $("#account-type").value;
    var opening = number($("#account-opening").value);
    var error = $("#account-error");
    error.textContent = "";
    if (!name || ["cash", "bank", "savings"].indexOf(type) < 0) {
      error.textContent = "Podaj nazwę i prawidłowy rodzaj konta.";
      return;
    }
    var existing = data.accounts.find(function (item) { return item.id === state.editingAccount; });
    var otherCash = data.accounts.some(function (item) { return item.type === "cash" && (!existing || item.id !== existing.id); });
    if (existing && existing.type === "cash" && type !== "cash" && !otherCash) {
      error.textContent = "Zostaw przynajmniej jedno miejsce typu Gotówka.";
      return;
    }
    var openings = existing ? Object.assign({}, existing.openingBalances) : {};
    openings[String(currentYear())] = opening;
    var account = {
      id: existing ? existing.id : uid("account"),
      name: name,
      type: type,
      currency: "PLN",
      openingBalances: openings,
      active: $("#account-active").checked,
      includeInSpendingLimit: $("#account-spending-limit").checked,
      createdAt: existing ? existing.createdAt : new Date().toISOString()
    };
    if (existing) data.accounts = data.accounts.map(function (item) { return item.id === existing.id ? account : item; });
    else data.accounts.push(account);
    var cash = mainCashAccount();
    if (cash) data.settings.balances[String(currentYear())].available = accountOpening(cash);
    state.editingAccount = null;
    closeDialog("account-dialog");
    markDirty(existing ? "Zmieniono konto." : "Dodano konto.");
    renderAll();
  }

  function deleteAccount(id) {
    var account = data.accounts.find(function (item) { return item.id === id; });
    if (!account) return;
    if (data.transactions.some(function (transaction) { return transaction.accountId === id || transaction.toAccountId === id; }) || data.recurring.some(function (item) { return item.accountId === id; })) {
      showToast("Konto ma powiązane operacje lub harmonogram. Ustaw je jako nieaktywne zamiast usuwać.");
      return;
    }
    if (account.type === "cash" && !data.accounts.some(function (item) { return item.id !== id && item.type === "cash"; })) {
      showToast("Program potrzebuje przynajmniej jednego miejsca typu Gotówka.");
      return;
    }
    if (!window.confirm("Usunąć konto „" + account.name + "”?")) return;
    data.accounts = data.accounts.filter(function (item) { return item.id !== id; });
    markDirty("Usunięto konto.");
    renderAll();
  }

  function statementSuggestedType(row) {
    if (number(row.amount) < 0 && /(^|\s)(atm|bankomat)|wypłat.*gotówk/i.test(String(row.description || ""))) return "transfer";
    return number(row.amount) >= 0 ? "income" : "expense";
  }

  function openStatementImport(accountId) {
    if (!desktop || !modules().bankAccounts || !modules().statementImport) {
      showToast("Włącz konta bankowe i import wyciągów w ustawieniach.");
      return;
    }
    var banks = activeAccounts().filter(function (account) { return account.type !== "cash"; });
    if (!banks.length) {
      showToast("Najpierw dodaj aktywne konto bankowe.");
      return;
    }
    $("#statement-account").innerHTML = banks.map(function (account) {
      return "<option value=\"" + escapeHTML(account.id) + "\">" + escapeHTML(account.name) + "</option>";
    }).join("");
    $("#statement-account").disabled = false;
    if (banks.some(function (account) { return account.id === accountId; })) $("#statement-account").value = accountId;
    state.statementPreview = null;
    $("#statement-file-name").textContent = "—";
    $("#statement-summary").textContent = "Wybierz plik CSV wyeksportowany z banku";
    $("#statement-warnings").innerHTML = "";
    $("#statement-preview-body").innerHTML = "<tr><td colspan=\"6\" class=\"empty-table-cell\">Plik nie został jeszcze wybrany.</td></tr>";
    $("#confirm-statement-import").disabled = true;
    openDialog("statement-dialog");
  }

  async function chooseStatementFile() {
    if (!desktop) return;
    var accountId = $("#statement-account").value;
    var fingerprints = data.transactions.map(function (transaction) { return transaction.importFingerprint; }).filter(Boolean);
    $("#choose-statement-file").disabled = true;
    $("#statement-summary").textContent = "Odczytywanie pliku…";
    try {
      var result = await desktop.statements.preview(accountId, fingerprints);
      if (!result || result.canceled) {
        $("#statement-summary").textContent = "Nie wybrano pliku";
        return;
      }
      if (!result.ok) throw new Error(result.error || "Nie udało się odczytać wyciągu.");
      state.statementPreview = { accountId: accountId, result: result };
      renderStatementPreview();
    } catch (error) {
      state.statementPreview = null;
      $("#statement-summary").textContent = "Nie udało się odczytać pliku";
      $("#statement-preview-body").innerHTML = "<tr><td colspan=\"6\" class=\"empty-table-cell\">" + escapeHTML(error.message || String(error)) + "</td></tr>";
      $("#confirm-statement-import").disabled = true;
    } finally {
      $("#choose-statement-file").disabled = false;
    }
  }

  function renderStatementPreview() {
    var preview = state.statementPreview;
    if (!preview) return;
    var result = preview.result;
    $("#statement-account").disabled = true;
    var fresh = result.rows.filter(function (row) { return !row.duplicate; }).length;
    $("#statement-file-name").textContent = result.fileName;
    $("#statement-summary").textContent = fresh + " nowych • " + (result.rows.length - fresh) + " duplikatów • separator: " + result.delimiter;
    $("#statement-warnings").innerHTML = (result.warnings || []).map(function (warning) { return "<div>! " + escapeHTML(warning) + "</div>"; }).join("");
    $("#statement-preview-body").innerHTML = result.rows.map(function (row, index) {
      var suggested = statementSuggestedType(row);
      var typeOptions = [
        ["income", "Wpływ"], ["expense", "Wydatek"], ["transfer", "Transfer do gotówki"]
      ].map(function (option) {
        return "<option value=\"" + option[0] + "\" " + (suggested === option[0] ? "selected" : "") + ">" + option[1] + "</option>";
      }).join("");
      return "<tr class=\"" + (row.duplicate ? "is-muted" : "") + "\"><td><input class=\"statement-check\" data-statement-index=\"" + index + "\" type=\"checkbox\" " + (row.duplicate ? "disabled" : "checked") + "></td>" +
        "<td data-label=\"Data\">" + escapeHTML(formattedDate(row.date)) + "</td>" +
        "<td data-label=\"Rodzaj\"><select class=\"statement-type\" data-statement-type=\"" + index + "\" " + (row.duplicate ? "disabled" : "") + ">" + typeOptions + "</select></td>" +
        "<td data-label=\"Opis\">" + escapeHTML(row.description) + "</td>" +
        "<td data-label=\"Kwota\" class=\"amount " + (number(row.amount) < 0 ? "is-out" : "") + "\">" + escapeHTML(money(Math.abs(number(row.amount)))) + "</td>" +
        "<td data-label=\"Status\"><span class=\"status-badge " + (row.duplicate ? "" : "is-done") + "\">" + (row.duplicate ? "Duplikat" : "Nowa") + "</span></td></tr>";
    }).join("");
    result.rows.forEach(function (row, index) {
      var select = $("[data-statement-type=\"" + index + "\"]");
      if (select) select.value = statementSuggestedType(row);
    });
    $("#confirm-statement-import").disabled = fresh === 0;
  }

  function confirmStatementImport() {
    var preview = state.statementPreview;
    if (!preview) return;
    var cash = mainCashAccount();
    var existing = new Set(data.transactions.map(function (transaction) { return transaction.importFingerprint; }).filter(Boolean));
    var added = 0;
    $$(".statement-check:checked").forEach(function (checkbox) {
      var index = Number(checkbox.getAttribute("data-statement-index"));
      var row = preview.result.rows[index];
      if (!row || row.duplicate || existing.has(row.fingerprint)) return;
      var typeNode = $("[data-statement-type=\"" + index + "\"]");
      var type = typeNode ? typeNode.value : statementSuggestedType(row);
      if (type === "transfer" && (!cash || cash.id === preview.accountId)) type = "expense";
      var category = "";
      if (type === "income") category = data.settings.categories.indexOf(row.category) >= 0 ? row.category : (data.settings.categories.indexOf("Dodatkowy wpływ") >= 0 ? "Dodatkowy wpływ" : data.settings.categories[0]);
      if (type === "expense") category = data.settings.categories.indexOf(row.category) >= 0 ? row.category : (data.settings.categories.indexOf("Inne") >= 0 ? "Inne" : data.settings.categories[0]);
      data.transactions.push({
        id: uid("tx"), date: row.date, type: type, category: category, targetId: "", recurringId: "", scheduledDate: "",
        description: row.description, amount: Math.abs(number(row.amount)), note: "Import z wyciągu: " + preview.result.fileName,
        accountId: preview.accountId, toAccountId: type === "transfer" ? cash.id : "", importFingerprint: row.fingerprint,
        source: "statement", createdAt: new Date().toISOString()
      });
      existing.add(row.fingerprint);
      added += 1;
    });
    if (!added) {
      showToast("Nie zaznaczono nowych operacji.");
      return;
    }
    closeDialog("statement-dialog");
    state.statementPreview = null;
    markDirty("Dodano " + added + (added === 1 ? " operację z wyciągu." : " operacji z wyciągu."));
    renderAll();
  }

  function openTargetHistory(kind, id) {
    var target = kind === "goal" ? data.goals.find(function (item) { return item.id === id; }) : data.debts.find(function (item) { return item.id === id; });
    if (!target) return;
    var items = sortedTransactions(data.transactions.filter(function (transaction) {
      if (transaction.targetId !== id) return false;
      return kind === "goal" ? transaction.type === "goal" || transaction.type === "goal_withdraw" : transaction.type === "debt";
    })).reverse();
    $("#history-dialog-title").textContent = target.name;
    $("#history-list").innerHTML = items.length ? items.map(function (transaction) {
      var withdrawal = transaction.type === "goal_withdraw";
      return "<div class=\"history-item\"><div class=\"recent-icon " + (withdrawal || transaction.type === "debt" ? "is-out" : "") + "\">" + (withdrawal ? "↩" : "↓") + "</div><div><strong>" + escapeHTML(TYPE_LABELS[transaction.type]) + "</strong><span>" + escapeHTML(formattedDate(transaction.date) + (transaction.description ? " • " + transaction.description : "")) + "</span></div><strong class=\"" + (withdrawal ? "is-positive" : "") + "\">" + (withdrawal ? "+" : "−") + escapeHTML(money(transaction.amount)) + "</strong></div>";
    }).join("") : "<div class=\"empty-plan\">Brak powiązanych operacji.</div>";
    openDialog("history-dialog");
  }

  function submitSettings(event) {
    event.preventDefault();
    var year = Math.round(number($("#settings-year").value));
    var available = number($("#settings-available").value);
    var reserve = number($("#settings-reserve").value);
    var categories = uniqueLines($("#settings-categories").value);
    var error = $("#settings-error");
    error.textContent = "";
    if (year < 2020 || year > 2100 || available < 0 || reserve < 0) {
      error.textContent = "Sprawdź rok i salda początkowe.";
      return;
    }
    if (!categories.length) {
      error.textContent = "Zostaw przynajmniej jedną kategorię.";
      return;
    }
    data.settings.currentYear = year;
    data.settings.balances[String(year)] = { available: available, reserve: reserve };
    var cash = mainCashAccount();
    if (cash) cash.openingBalances[String(year)] = available;
    data.accounts.forEach(function (account) {
      if (account.openingBalances[String(year)] == null) account.openingBalances[String(year)] = 0;
    });
    data.settings.categories = categories;
    state.month = year === new Date().getFullYear() ? new Date().getMonth() : 0;
    state.planMonth = state.month;
    markDirty("Zastosowano ustawienia.");
    renderAll();
    setPage("settings");
  }

  function yearSettingChanged() {
    var year = Math.round(number($("#settings-year").value));
    var balance = data.settings.balances[String(year)] || { available: 0, reserve: 0 };
    var cash = mainCashAccount();
    $("#settings-available").value = cash && cash.openingBalances[String(year)] != null ? number(cash.openingBalances[String(year)]) : number(balance.available);
    $("#settings-reserve").value = number(balance.reserve);
  }

  function saveModuleSettings() {
    var day = Math.round(number($("#settings-payday-day").value));
    var nextDate = $("#settings-next-payday").value;
    if (day < 1 || day > 31) {
      showToast("Dzień wypłaty musi mieścić się od 1 do 31.");
      return;
    }
    var bankAccounts = $("#module-bank-accounts").checked;
    data.settings.modules = {
      bankAccounts: bankAccounts,
      statementImport: bankAccounts && $("#module-statement-import").checked,
      alerts: $("#module-alerts").checked,
      dailyLimit: $("#module-daily-limit").checked,
      weeklyLimit: $("#module-weekly-limit").checked,
      interest: $("#module-interest").checked,
      recurring: $("#module-recurring").checked,
      categoryBudgets: $("#module-category-budgets").checked
    };
    data.settings.payday = { day: day, nextDate: nextDate };
    markDirty("Zastosowano moduły programu.");
    renderAll();
    setPage("settings");
  }

  async function exportData() {
    if (desktop) {
      try {
        var result = await desktop.data.export(data);
        if (result && result.ok) showToast("Wyeksportowano kopię danych.");
      } catch (error) {
        showToast("Nie udało się wyeksportować kopii: " + (error.message || error));
      }
      return;
    }
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "budzet-kopia-" + currentYear() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast("Wyeksportowano kopię danych.");
  }

  async function importData(file) {
    try {
      var parsed;
      if (desktop) {
        var result = await desktop.data.import();
        if (!result || result.canceled) return;
        parsed = result.data;
      } else {
        if (!file) return;
        parsed = JSON.parse(await file.text());
      }
      if (!parsed || !parsed.settings || !Array.isArray(parsed.goals) || !Array.isArray(parsed.debts) || !Array.isArray(parsed.transactions)) {
        throw new Error("Nieprawidłowy format pliku");
      }
      data = normalizeData(parsed);
      state.month = currentYear() === new Date().getFullYear() ? new Date().getMonth() : 0;
      state.planMonth = state.month;
      applyTheme();
      markDirty("Wczytano kopię.");
      renderAll();
      setPage("dashboard");
    } catch (error) {
      showToast("Nie udało się wczytać tej kopii.");
    } finally {
      $("#import-file").value = "";
    }
  }

  async function checkForUpdates() {
    if (!desktop) return;
    try {
      updateStatus = await desktop.updater.check();
      renderUpdateStatus();
    } catch (error) {
      showToast("Nie udało się sprawdzić aktualizacji.");
    }
  }

  function resetData() {
    if (!window.confirm("Wyczyścić wszystkie operacje, cele, długi i ustawienia? Przed kontynuacją warto wyeksportować kopię.")) return;
    data = freshData();
    state.month = currentYear() === new Date().getFullYear() ? new Date().getMonth() : 0;
    state.planMonth = state.month;
    applyTheme();
    markDirty("Wyczyszczono dane.");
    renderAll();
    setPage("dashboard");
  }

  function handleDocumentClick(event) {
    var nav = event.target.closest("[data-view]");
    if (nav) {
      setPage(nav.getAttribute("data-view"));
      return;
    }
    var go = event.target.closest("[data-go]");
    if (go) {
      setPage(go.getAttribute("data-go"));
      return;
    }
    var month = event.target.closest("[data-month]");
    if (month) {
      state.month = Number(month.getAttribute("data-month"));
      renderMonths();
      return;
    }
    var planMonth = event.target.closest("[data-plan-month]");
    if (planMonth) {
      state.planMonth = Number(planMonth.getAttribute("data-plan-month"));
      renderPlan();
      return;
    }
    var close = event.target.closest("[data-close-dialog]");
    if (close) {
      closeDialog(close.getAttribute("data-close-dialog"));
      return;
    }
    var editTransactionButton = event.target.closest("[data-edit-transaction]");
    if (editTransactionButton) {
      openTransactionDialog(editTransactionButton.getAttribute("data-edit-transaction"));
      return;
    }
    var deleteTransactionButton = event.target.closest("[data-delete-transaction]");
    if (deleteTransactionButton) {
      deleteTransaction(deleteTransactionButton.getAttribute("data-delete-transaction"));
      return;
    }
    var editGoalButton = event.target.closest("[data-edit-goal]");
    if (editGoalButton) {
      openGoalDialog(editGoalButton.getAttribute("data-edit-goal"));
      return;
    }
    var deleteGoalButton = event.target.closest("[data-delete-goal]");
    if (deleteGoalButton) {
      deleteGoal(deleteGoalButton.getAttribute("data-delete-goal"));
      return;
    }
    var payGoalButton = event.target.closest("[data-pay-goal]");
    if (payGoalButton) {
      setPage("months");
      openTransactionDialog(null, "goal", payGoalButton.getAttribute("data-pay-goal"));
      return;
    }
    var withdrawGoalButton = event.target.closest("[data-withdraw-goal]");
    if (withdrawGoalButton) {
      setPage("months");
      openTransactionDialog(null, "goal_withdraw", withdrawGoalButton.getAttribute("data-withdraw-goal"));
      return;
    }
    var goalHistoryButton = event.target.closest("[data-history-goal]");
    if (goalHistoryButton) {
      openTargetHistory("goal", goalHistoryButton.getAttribute("data-history-goal"));
      return;
    }
    var editDebtButton = event.target.closest("[data-edit-debt]");
    if (editDebtButton) {
      openDebtDialog(editDebtButton.getAttribute("data-edit-debt"));
      return;
    }
    var deleteDebtButton = event.target.closest("[data-delete-debt]");
    if (deleteDebtButton) {
      deleteDebt(deleteDebtButton.getAttribute("data-delete-debt"));
      return;
    }
    var payDebtButton = event.target.closest("[data-pay-debt]");
    if (payDebtButton) {
      setPage("months");
      openTransactionDialog(null, "debt", payDebtButton.getAttribute("data-pay-debt"));
      return;
    }
    var debtHistoryButton = event.target.closest("[data-history-debt]");
    if (debtHistoryButton) {
      openTargetHistory("debt", debtHistoryButton.getAttribute("data-history-debt"));
      return;
    }
    var planGoalButton = event.target.closest("[data-plan-goal]");
    if (planGoalButton) {
      openTransactionDialog(null, "goal", planGoalButton.getAttribute("data-plan-goal"), planGoalButton.getAttribute("data-plan-amount"), planGoalButton.getAttribute("data-plan-date"));
      return;
    }
    var planDebtButton = event.target.closest("[data-plan-debt]");
    if (planDebtButton) {
      openTransactionDialog(null, "debt", planDebtButton.getAttribute("data-plan-debt"), planDebtButton.getAttribute("data-plan-amount"), planDebtButton.getAttribute("data-plan-date"));
      return;
    }
    var postRecurringButton = event.target.closest("[data-post-recurring]");
    if (postRecurringButton) {
      var recurringId = postRecurringButton.getAttribute("data-post-recurring");
      var scheduledDate = postRecurringButton.getAttribute("data-scheduled-date");
      var recurring = data.recurring.find(function (item) { return item.id === recurringId; });
      var scheduled = dateFromISO(scheduledDate);
      if (recurring && scheduled) {
        state.month = scheduled.getMonth();
        setPage("months");
        openTransactionDialog(null, recurring.type, "", recurring.amount, scheduledDate, recurring.id);
      }
      return;
    }
    var editRecurringButton = event.target.closest("[data-edit-recurring]");
    if (editRecurringButton) {
      openRecurringDialog(editRecurringButton.getAttribute("data-edit-recurring"));
      return;
    }
    var deleteRecurringButton = event.target.closest("[data-delete-recurring]");
    if (deleteRecurringButton) {
      deleteRecurring(deleteRecurringButton.getAttribute("data-delete-recurring"));
      return;
    }
    var editBudgetButton = event.target.closest("[data-edit-budget]");
    if (editBudgetButton) {
      openBudgetDialog(editBudgetButton.getAttribute("data-edit-budget"));
      return;
    }
    var deleteBudgetButton = event.target.closest("[data-delete-budget]");
    if (deleteBudgetButton) {
      deleteBudget(deleteBudgetButton.getAttribute("data-delete-budget"));
      return;
    }
    var editAccountButton = event.target.closest("[data-edit-account]");
    if (editAccountButton) {
      openAccountDialog(editAccountButton.getAttribute("data-edit-account"));
      return;
    }
    var deleteAccountButton = event.target.closest("[data-delete-account]");
    if (deleteAccountButton) {
      deleteAccount(deleteAccountButton.getAttribute("data-delete-account"));
      return;
    }
    var restoreButton = event.target.closest("[data-restore-backup]");
    if (restoreButton) {
      restoreBackup(restoreButton.getAttribute("data-restore-backup"));
    }
  }

  function bindEvents() {
    document.addEventListener("click", handleDocumentClick);
    $("#save-button").addEventListener("click", saveToFile);
    $("#theme-toggle").addEventListener("click", toggleTheme);
    $("#retry-connection").addEventListener("click", loadFromFile);
    $("#mobile-menu").addEventListener("click", function () {
      $("#sidebar").classList.add("is-open");
      $("#mobile-backdrop").hidden = false;
    });
    $("#mobile-backdrop").addEventListener("click", function () {
      $("#sidebar").classList.remove("is-open");
      $("#mobile-backdrop").hidden = true;
    });
    $("#add-transaction").addEventListener("click", function () { openTransactionDialog(); });
    $("#add-goal").addEventListener("click", function () { openGoalDialog(); });
    $("#add-debt").addEventListener("click", function () { openDebtDialog(); });
    $("#add-recurring").addEventListener("click", function () { openRecurringDialog(); });
    $("#add-budget").addEventListener("click", function () { openBudgetDialog(); });
    $("#add-account").addEventListener("click", function () { openAccountDialog(); });
    $("#import-statement").addEventListener("click", function () { openStatementImport(); });
    $("#choose-statement-file").addEventListener("click", chooseStatementFile);
    $("#confirm-statement-import").addEventListener("click", confirmStatementImport);
    $("#transaction-type").addEventListener("change", renderTransactionOptions);
    $("#goal-cadence").addEventListener("change", updateGoalCadenceFields);
    $("#recurring-cadence").addEventListener("change", updateRecurringCadenceFields);
    $("#debt-interest-enabled").addEventListener("change", updateDebtInterestField);
    $("#transaction-form").addEventListener("submit", submitTransaction);
    $("#goal-form").addEventListener("submit", submitGoal);
    $("#debt-form").addEventListener("submit", submitDebt);
    $("#recurring-form").addEventListener("submit", submitRecurring);
    $("#budget-form").addEventListener("submit", submitBudget);
    $("#account-form").addEventListener("submit", submitAccount);
    $("#settings-form").addEventListener("submit", submitSettings);
    $("#settings-year").addEventListener("change", yearSettingChanged);
    $("#export-data").addEventListener("click", exportData);
    $("#import-data").addEventListener("click", function () {
      if (desktop) importData();
      else $("#import-file").click();
    });
    $("#import-file").addEventListener("change", function (event) {
      importData(event.target.files && event.target.files[0]);
    });
    $("#reset-data").addEventListener("click", resetData);
    $("#refresh-backups").addEventListener("click", function () { loadBackups(false); });
    $("#save-module-settings").addEventListener("click", saveModuleSettings);
    $("#module-bank-accounts").addEventListener("change", function () {
      $("#module-statement-import").disabled = !this.checked;
      if (!this.checked) $("#module-statement-import").checked = false;
    });
    $("#open-data-folder").addEventListener("click", function () {
      if (desktop) desktop.app.openDataFolder().then(function (message) {
        if (message) showToast("Nie udało się otworzyć folderu: " + message);
      });
    });
    $("#check-updates").addEventListener("click", checkForUpdates);
    $("#install-update").addEventListener("click", function () { if (desktop) desktop.updater.install(); });
    $("#print-month").addEventListener("click", function () { printReport("month"); });
    $("#print-year").addEventListener("click", function () { printReport("year"); });
    document.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveToFile();
      }
      if (event.key === "Escape") {
        $("#sidebar").classList.remove("is-open");
        $("#mobile-backdrop").hidden = true;
      }
    });
    window.addEventListener("beforeunload", function (event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
    if (desktop) {
      desktop.updater.onStatus(function (status) {
        updateStatus = status;
        if (data) renderUpdateStatus();
      });
    }
  }

  bindEvents();
  loadFromFile();
}());
