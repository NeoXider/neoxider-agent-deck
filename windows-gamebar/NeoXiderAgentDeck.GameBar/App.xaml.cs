using System;
using Microsoft.Gaming.XboxGameBar;
using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.UI.Core;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace NeoXiderAgentDeck.GameBar
{
    sealed partial class App : Application
    {
        private XboxGameBarWidget widget;

        public App()
        {
            InitializeComponent();
            Suspending += OnSuspending;
        }

        protected override void OnActivated(IActivatedEventArgs args)
        {
            if (args.Kind != ActivationKind.Protocol ||
                !(args is IProtocolActivatedEventArgs protocolArgs) ||
                !string.Equals(protocolArgs.Uri.Scheme, "ms-gamebarwidget", StringComparison.OrdinalIgnoreCase) ||
                !(args is XboxGameBarWidgetActivatedEventArgs widgetArgs) ||
                !widgetArgs.IsLaunchActivation)
            {
                return;
            }

            var rootFrame = new Frame();
            rootFrame.NavigationFailed += OnNavigationFailed;
            Window.Current.Content = rootFrame;

            widget = new XboxGameBarWidget(widgetArgs, Window.Current.CoreWindow, rootFrame);
            rootFrame.Navigate(typeof(WidgetPage), widget);
            Window.Current.Closed += OnWidgetClosed;
            Window.Current.Activate();
        }

        protected override void OnLaunched(LaunchActivatedEventArgs args)
        {
            var rootFrame = Window.Current.Content as Frame;
            if (rootFrame == null)
            {
                rootFrame = new Frame();
                rootFrame.NavigationFailed += OnNavigationFailed;
                Window.Current.Content = rootFrame;
            }

            if (!args.PrelaunchActivated)
            {
                if (rootFrame.Content == null)
                {
                    rootFrame.Navigate(typeof(MainPage));
                }

                Window.Current.Activate();
            }
        }

        private void OnWidgetClosed(object sender, CoreWindowEventArgs args)
        {
            widget = null;
            Window.Current.Closed -= OnWidgetClosed;
        }

        private static void OnNavigationFailed(object sender, NavigationFailedEventArgs args)
        {
            throw new InvalidOperationException($"Failed to load {args.SourcePageType.FullName}.");
        }

        private void OnSuspending(object sender, SuspendingEventArgs args)
        {
            var deferral = args.SuspendingOperation.GetDeferral();
            widget = null;
            deferral.Complete();
        }
    }
}
