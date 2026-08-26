using Microsoft.Gaming.XboxGameBar;
using Windows.UI;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Navigation;

namespace NeoXiderAgentDeck.GameBar
{
    public sealed partial class WidgetPage : Page
    {
        private XboxGameBarWidget widget;

        public WidgetPage()
        {
            InitializeComponent();
        }

        protected override void OnNavigatedTo(NavigationEventArgs args)
        {
            widget = args.Parameter as XboxGameBarWidget;
            if (widget != null)
            {
                widget.PinningSupported = true;
                widget.RequestedThemeChanged += OnRequestedThemeChanged;
                widget.RequestedOpacityChanged += OnRequestedOpacityChanged;
                ApplyHostPreferences();
            }

            ApplyStatus(AgentStatus.Offline, "Agent Deck", "Bridge is not connected");
        }

        protected override void OnNavigatedFrom(NavigationEventArgs args)
        {
            if (widget != null)
            {
                widget.RequestedThemeChanged -= OnRequestedThemeChanged;
                widget.RequestedOpacityChanged -= OnRequestedOpacityChanged;
            }

            widget = null;
        }

        private void OnLoaded(object sender, RoutedEventArgs args)
        {
            WaitingPulse.Begin();
        }

        private void OnRequestedThemeChanged(XboxGameBarWidget sender, object args)
        {
            _ = Dispatcher.RunAsync(Windows.UI.Core.CoreDispatcherPriority.Normal, ApplyHostPreferences);
        }

        private void OnRequestedOpacityChanged(XboxGameBarWidget sender, object args)
        {
            _ = Dispatcher.RunAsync(Windows.UI.Core.CoreDispatcherPriority.Normal, ApplyHostPreferences);
        }

        private void ApplyHostPreferences()
        {
            if (widget == null)
            {
                return;
            }

            RequestedTheme = widget.RequestedTheme;
            Root.Opacity = widget.RequestedOpacity > 1 ? widget.RequestedOpacity / 100d : widget.RequestedOpacity;
        }

        internal void ApplyStatus(AgentStatus status, string sessionTitle, string detail)
        {
            SessionTitle.Text = string.IsNullOrWhiteSpace(sessionTitle) ? "Agent Deck" : sessionTitle;
            StatusDetail.Text = string.IsNullOrWhiteSpace(detail) ? "Ready" : detail;
            StatusLabel.Text = status.ToString().ToUpperInvariant();

            Color accent;
            switch (status)
            {
                case AgentStatus.Error:
                    accent = Color.FromArgb(255, 255, 91, 129);
                    break;
                case AgentStatus.Writing:
                case AgentStatus.Waiting:
                    accent = Color.FromArgb(255, 84, 191, 243);
                    break;
                case AgentStatus.Thinking:
                    accent = Color.FromArgb(255, 157, 108, 255);
                    break;
                case AgentStatus.Tool:
                    accent = Color.FromArgb(255, 255, 193, 94);
                    break;
                case AgentStatus.Offline:
                    accent = Color.FromArgb(255, 141, 153, 174);
                    break;
                default:
                    accent = Color.FromArgb(255, 73, 231, 192);
                    break;
            }

            StatusDot.Fill = new SolidColorBrush(accent);
            StatusPill.BorderBrush = new SolidColorBrush(Color.FromArgb(128, accent.R, accent.G, accent.B));
            StatusPill.Background = new SolidColorBrush(Color.FromArgb(42, accent.R, accent.G, accent.B));
        }
    }
}
