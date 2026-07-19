using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Styling;
using Portfel.Services;
using Portfel.ViewModels;
using Portfel.Views;

namespace Portfel;

public partial class App : Application
{
    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            var store = new SqliteBudgetStore();
            var state = store.LoadAsync().GetAwaiter().GetResult();
            var window = new MainWindow();
            var platform = new AvaloniaPlatformService(() => window);
            var viewModel = new MainViewModel(state, store, new BudgetCalculator(), new CsvStatementParser(), platform);
            viewModel.ThemeChanged += ApplyTheme;
            window.DataContext = viewModel;
            desktop.MainWindow = window;
            ApplyTheme(state.Settings.Theme);
        }
        base.OnFrameworkInitializationCompleted();
    }

    private void ApplyTheme(string theme) => RequestedThemeVariant =
        theme == "dark" ? ThemeVariant.Dark : ThemeVariant.Light;
}
