using Portfel.Models;

namespace Portfel.Services;

public interface IBudgetStore
{
    string DataDirectory { get; }
    string DatabasePath { get; }
    Task<BudgetState> LoadAsync(CancellationToken cancellationToken = default);
    Task SaveAsync(BudgetState state, CancellationToken cancellationToken = default);
    Task ExportJsonAsync(BudgetState state, string path, CancellationToken cancellationToken = default);
    Task<BudgetState> ImportJsonAsync(string path, CancellationToken cancellationToken = default);
    IReadOnlyList<BackupInfo> GetBackups();
    Task<BudgetState> RestoreBackupAsync(string path, CancellationToken cancellationToken = default);
}

public sealed record BackupInfo(string Path, DateTime ModifiedAt, long Size)
{
    public string FileName => System.IO.Path.GetFileName(Path);
}

