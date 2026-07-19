using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Portfel.ViewModels;

namespace Portfel.Views;

public partial class MainWindow : Window
{
    private bool _forceClose;

    public MainWindow() => InitializeComponent();

    private void InitializeComponent() => AvaloniaXamlLoader.Load(this);

    protected override void OnClosing(WindowClosingEventArgs e)
    {
        if (!_forceClose && DataContext is MainViewModel viewModel && !viewModel.CanCloseWithoutPrompt)
        {
            e.Cancel = true;
            viewModel.RequestClose(() =>
            {
                _forceClose = true;
                Close();
            });
        }
        base.OnClosing(e);
    }
}
