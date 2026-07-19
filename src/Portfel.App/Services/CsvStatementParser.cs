using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Portfel.Services;

public sealed class CsvStatementParser
{
    private static readonly string[] DateHeaders = ["data", "data operacji", "data transakcji", "date"];
    private static readonly string[] DescriptionHeaders = ["opis", "tytuł", "kontrahent", "description", "szczegóły"];
    private static readonly string[] AmountHeaders = ["kwota", "amount", "wartość"];
    private static readonly string[] IncomeHeaders = ["wpływ", "uznanie", "credit"];
    private static readonly string[] ExpenseHeaders = ["wydatek", "obciążenie", "debit"];

    public async Task<IReadOnlyList<StatementRow>> ParseAsync(string path, CancellationToken cancellationToken = default)
    {
        var lines = await File.ReadAllLinesAsync(path, cancellationToken);
        var meaningful = lines.Where(line => !string.IsNullOrWhiteSpace(line)).ToList();
        if (meaningful.Count < 2) throw new InvalidDataException("Plik nie zawiera operacji.");
        var delimiter = DetectDelimiter(meaningful[0]);
        var headers = Split(meaningful[0], delimiter).Select(Normalize).ToList();
        var dateIndex = Find(headers, DateHeaders);
        var descriptionIndex = Find(headers, DescriptionHeaders);
        var amountIndex = Find(headers, AmountHeaders);
        var incomeIndex = Find(headers, IncomeHeaders);
        var expenseIndex = Find(headers, ExpenseHeaders);
        if (dateIndex < 0 || descriptionIndex < 0 || (amountIndex < 0 && incomeIndex < 0 && expenseIndex < 0))
            throw new InvalidDataException("Nie rozpoznano kolumn. Wymagane: data, opis oraz kwota (lub wpływ/wydatek).");

        var rows = new List<StatementRow>();
        var fingerprintOccurrences = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in meaningful.Skip(1))
        {
            var cells = Split(line, delimiter);
            if (!TryCell(cells, dateIndex, out var dateText) || !TryDate(dateText, out var date)) continue;
            TryCell(cells, descriptionIndex, out var description);
            decimal amount;
            if (amountIndex >= 0 && TryCell(cells, amountIndex, out var amountText) && TryMoney(amountText, out amount))
            {
                // znak pozostaje zgodny z wyciągiem
            }
            else
            {
                amount = 0m;
                if (incomeIndex >= 0 && TryCell(cells, incomeIndex, out var income) && TryMoney(income, out var incoming)) amount += Math.Abs(incoming);
                if (expenseIndex >= 0 && TryCell(cells, expenseIndex, out var expense) && TryMoney(expense, out var outgoing)) amount -= Math.Abs(outgoing);
            }
            if (amount == 0m) continue;
            description = description.Trim();
            var baseFingerprint = Fingerprint(date, description, amount);
            fingerprintOccurrences.TryGetValue(baseFingerprint, out var occurrence);
            occurrence++;
            fingerprintOccurrences[baseFingerprint] = occurrence;
            rows.Add(new StatementRow(date, description, amount, $"{baseFingerprint}-{occurrence}"));
        }
        return rows;
    }

    private static char DetectDelimiter(string header)
    {
        var options = new[] { ';', ',', '\t' };
        return options.OrderByDescending(character => header.Count(value => value == character)).First();
    }

    private static List<string> Split(string line, char delimiter)
    {
        var result = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        for (var index = 0; index < line.Length; index++)
        {
            var current = line[index];
            if (current == '"')
            {
                if (quoted && index + 1 < line.Length && line[index + 1] == '"')
                {
                    cell.Append('"');
                    index++;
                }
                else quoted = !quoted;
            }
            else if (current == delimiter && !quoted)
            {
                result.Add(cell.ToString());
                cell.Clear();
            }
            else cell.Append(current);
        }
        result.Add(cell.ToString());
        return result;
    }

    private static int Find(IReadOnlyList<string> headers, IEnumerable<string> aliases)
    {
        var normalized = aliases.Select(Normalize).ToHashSet();
        for (var index = 0; index < headers.Count; index++)
            if (normalized.Contains(headers[index])) return index;
        return -1;
    }

    private static bool TryCell(IReadOnlyList<string> cells, int index, out string value)
    {
        value = index >= 0 && index < cells.Count ? cells[index] : "";
        return index >= 0 && index < cells.Count;
    }

    private static bool TryDate(string input, out DateOnly date)
    {
        var formats = new[] { "yyyy-MM-dd", "dd.MM.yyyy", "dd-MM-yyyy", "yyyy.MM.dd", "dd/MM/yyyy" };
        return DateOnly.TryParseExact(input.Trim(), formats, CultureInfo.InvariantCulture,
            DateTimeStyles.AllowWhiteSpaces, out date) || DateOnly.TryParse(input, CultureInfo.GetCultureInfo("pl-PL"),
            DateTimeStyles.AllowWhiteSpaces, out date);
    }

    private static bool TryMoney(string input, out decimal value)
    {
        var clean = input.Replace("PLN", "", StringComparison.OrdinalIgnoreCase)
            .Replace("zł", "", StringComparison.OrdinalIgnoreCase)
            .Replace(" ", "").Trim();
        return decimal.TryParse(clean, NumberStyles.Number | NumberStyles.AllowLeadingSign,
                   CultureInfo.GetCultureInfo("pl-PL"), out value)
               || decimal.TryParse(clean, NumberStyles.Number | NumberStyles.AllowLeadingSign,
                   CultureInfo.InvariantCulture, out value);
    }

    private static string Normalize(string value) => value.Trim().Trim('\ufeff').ToLowerInvariant();

    private static string Fingerprint(DateOnly date, string description, decimal amount)
    {
        var input = $"{date:yyyy-MM-dd}|{Normalize(description)}|{amount:0.00}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input))).ToLowerInvariant();
    }
}

public sealed record StatementRow(DateOnly Date, string Description, decimal SignedAmount, string Fingerprint)
{
    public bool IsIncome => SignedAmount > 0;
    public decimal Amount => Math.Abs(SignedAmount);
}
