using System;
using System.Threading.Tasks;
using Microsoft.Gaming.XboxGameBar;
using Windows.ApplicationModel;
using Windows.System;
using Windows.UI;
using Windows.UI.Core;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Navigation;

namespace NeoXiderAgentDeck.GameBar
{
    public sealed partial class WidgetPage : Page
    {
        internal const double ManifestMinimumWidth = 240;
        internal const double ManifestMinimumHeight = 96;
        internal const double WideActionsMinimumWidth = 360;

        private XboxGameBarWidget widget;
        private BridgeClient bridgeClient;
        private long lastSnapshotRevision = -1;
        private string currentSessionId = string.Empty;
        private bool bridgeConnected;
        private bool currentUnread;
        private bool actionBusy;

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

            Application.Current.Suspending += OnApplicationSuspending;
            Application.Current.Resuming += OnApplicationResuming;
            bridgeClient = new BridgeClient();
            bridgeClient.ConnectionChanged += OnBridgeConnectionChanged;
            bridgeClient.SnapshotReceived += OnSnapshotReceived;
            ApplyOffline("Connecting to desktop bridge");
            bridgeClient.Start();
        }

        protected override void OnNavigatedFrom(NavigationEventArgs args)
        {
            Application.Current.Suspending -= OnApplicationSuspending;
            Application.Current.Resuming -= OnApplicationResuming;
            if (bridgeClient != null)
            {
                bridgeClient.ConnectionChanged -= OnBridgeConnectionChanged;
                bridgeClient.SnapshotReceived -= OnSnapshotReceived;
                bridgeClient.Dispose();
                bridgeClient = null;
            }

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

        private void OnApplicationSuspending(object sender, SuspendingEventArgs args)
        {
            if (bridgeClient != null) bridgeClient.Stop();
        }

        private void OnApplicationResuming(object sender, object args)
        {
            if (bridgeClient != null) bridgeClient.Start();
        }

        private void OnBridgeConnectionChanged(object sender, BridgeConnectionChangedEventArgs args)
        {
            _ = Dispatcher.RunAsync(CoreDispatcherPriority.Normal, () =>
            {
                if (sender != bridgeClient) return;
                switch (args.Status)
                {
                    case BridgeConnectionStatus.Connected:
                        bridgeConnected = true;
                        lastSnapshotRevision = -1;
                        currentSessionId = string.Empty;
                        currentUnread = false;
                        ApplyStatus(AgentStatus.Offline, "Agent Deck", "Waiting for live snapshot");
                        break;
                    case BridgeConnectionStatus.Connecting:
                        bridgeConnected = false;
                        ApplyOffline("Connecting to desktop bridge");
                        break;
                    default:
                        bridgeConnected = false;
                        ApplyOffline("Bridge is not connected");
                        break;
                }
                RefreshActionState();
            });
        }

        private void OnSnapshotReceived(object sender, BridgeSnapshot snapshot)
        {
            _ = Dispatcher.RunAsync(CoreDispatcherPriority.Normal, () =>
            {
                if (sender != bridgeClient || !bridgeConnected || snapshot.Revision <= lastSnapshotRevision) return;
                lastSnapshotRevision = snapshot.Revision;
                currentSessionId = snapshot.SessionId ?? string.Empty;
                currentUnread = snapshot.Unread;
                string detail = snapshot.Detail;
                if (snapshot.ContextPercent > 0)
                {
                    string context = Math.Round(snapshot.ContextPercent).ToString("0") + "% context";
                    detail = string.IsNullOrWhiteSpace(detail) ? context : detail + " · " + context;
                }
                ApplyStatus(StatusFromProtocol(snapshot.Status), snapshot.SessionTitle, detail);
                UnreadDot.Visibility = currentUnread ? Visibility.Visible : Visibility.Collapsed;
                RefreshActionState();
            });
        }

        private void OnRequestedThemeChanged(XboxGameBarWidget sender, object args)
        {
            _ = Dispatcher.RunAsync(CoreDispatcherPriority.Normal, ApplyHostPreferences);
        }

        private void OnRequestedOpacityChanged(XboxGameBarWidget sender, object args)
        {
            _ = Dispatcher.RunAsync(CoreDispatcherPriority.Normal, ApplyHostPreferences);
        }

        private async void OnOpenClicked(object sender, RoutedEventArgs args)
        {
            string sessionId = currentSessionId;
            await RunActionAsync(
                () => bridgeClient.OpenSessionAsync(sessionId),
                "Could not open this session.",
                "Open request sent.");
        }

        private async void OnAckClicked(object sender, RoutedEventArgs args)
        {
            string sessionId = currentSessionId;
            await RunActionAsync(
                () => bridgeClient.AcknowledgeAsync(sessionId),
                "Could not acknowledge this update.",
                "Update acknowledged.");
        }

        private async void OnSendReplyClicked(object sender, RoutedEventArgs args)
        {
            await SendQuickReplyAsync();
        }

        private async void OnQuickReplyKeyDown(object sender, KeyRoutedEventArgs args)
        {
            if (args.Key != VirtualKey.Enter) return;
            args.Handled = true;
            await SendQuickReplyAsync();
        }

        private void OnQuickReplyTextChanged(object sender, TextChangedEventArgs args)
        {
            RefreshActionState();
        }

        private void OnDismissErrorClicked(object sender, RoutedEventArgs args)
        {
            HideActionError();
        }

        private async Task SendQuickReplyAsync()
        {
            string sessionId = currentSessionId;
            string text = QuickReplyInput.Text ?? string.Empty;
            if (string.IsNullOrEmpty(sessionId) || BridgeProtocol.IsBlankQuickReply(text)) return;
            bool succeeded = await RunActionAsync(
                () => bridgeClient.QuickReplyAsync(sessionId, text),
                "Could not send the quick reply.",
                "Reply queued.");
            if (succeeded) QuickReplyInput.Text = string.Empty;
        }

        private async Task<bool> RunActionAsync(
            Func<Task> action,
            string failureMessage,
            string successMessage)
        {
            if (actionBusy || !bridgeConnected || bridgeClient == null) return false;
            actionBusy = true;
            HideActionError();
            RefreshActionState();
            try
            {
                await action();
                StatusDetail.Text = successMessage;
                return true;
            }
            catch
            {
                ShowActionError(failureMessage);
                return false;
            }
            finally
            {
                actionBusy = false;
                RefreshActionState();
            }
        }

        private void RefreshActionState()
        {
            bool hasSession = bridgeConnected && !string.IsNullOrWhiteSpace(currentSessionId);
            OpenButton.IsEnabled = hasSession && !actionBusy;
            AckButton.IsEnabled = hasSession && currentUnread && !actionBusy;
            QuickReplyInput.IsEnabled = hasSession && !actionBusy;
            SendReplyButton.IsEnabled = hasSession && !actionBusy
                && !BridgeProtocol.IsBlankQuickReply(QuickReplyInput.Text);
            ActionProgress.IsActive = actionBusy;
            ActionProgress.Visibility = actionBusy ? Visibility.Visible : Visibility.Collapsed;
        }

        private void ShowActionError(string message)
        {
            ActionErrorText.Text = message;
            ActionError.Visibility = Visibility.Visible;
        }

        private void HideActionError()
        {
            ActionError.Visibility = Visibility.Collapsed;
        }

        private void ApplyOffline(string detail)
        {
            lastSnapshotRevision = -1;
            currentSessionId = string.Empty;
            currentUnread = false;
            UnreadDot.Visibility = Visibility.Collapsed;
            HideActionError();
            ApplyStatus(AgentStatus.Offline, "Agent Deck", detail);
        }

        private static AgentStatus StatusFromProtocol(string status)
        {
            switch (status)
            {
                case "idle": return AgentStatus.Idle;
                case "thinking": return AgentStatus.Thinking;
                case "writing": return AgentStatus.Writing;
                case "tool": return AgentStatus.Tool;
                case "waiting": return AgentStatus.Waiting;
                case "done": return AgentStatus.Done;
                case "error": return AgentStatus.Error;
                default: return AgentStatus.Offline;
            }
        }

        private void ApplyHostPreferences()
        {
            if (widget == null) return;
            RequestedTheme = widget.RequestedTheme;
            double opacity = widget.RequestedOpacity > 1 ? widget.RequestedOpacity / 100d : widget.RequestedOpacity;
            Root.Opacity = Math.Max(0, Math.Min(1, opacity));
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
