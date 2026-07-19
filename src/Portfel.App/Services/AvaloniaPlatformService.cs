using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Platform.Storage;

namespace Portfel.Services;

public sealed class AvaloniaPlatformService(Func<TopLevel?> topLevel) : IPlatformService
{
    public async Task<string?> PickOpenFileAsync(string title, IReadOnlyList<string> patterns)
    {
        var owner = topLevel();
        if (owner?.StorageProvider is null) return null;
        var files = await owner.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = title,
            AllowMultiple = false,
            FileTypeFilter =
            [
                new FilePickerFileType(title) { Patterns = patterns }
            ]
        });
        return files.Count == 0 ? null : files[0].TryGetLocalPath();
    }

    public async Task<string?> PickSaveFileAsync(string title, string suggestedName, string extension)
    {
        var owner = topLevel();
        if (owner?.StorageProvider is null) return null;
        var file = await owner.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = title,
            SuggestedFileName = suggestedName,
            DefaultExtension = extension,
            FileTypeChoices =
            [
                new FilePickerFileType($"Plik {extension.ToUpperInvariant()}") { Patterns = [$"*.{extension}"] }
            ]
        });
        return file?.TryGetLocalPath();
    }

    public void OpenFolder(string path)
    {
        Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
    }
}

