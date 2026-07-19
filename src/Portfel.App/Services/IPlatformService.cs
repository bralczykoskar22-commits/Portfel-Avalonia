namespace Portfel.Services;

public interface IPlatformService
{
    Task<string?> PickOpenFileAsync(string title, IReadOnlyList<string> patterns);
    Task<string?> PickSaveFileAsync(string title, string suggestedName, string extension);
    void OpenFolder(string path);
}

