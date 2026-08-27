[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$projectRoot = Join-Path $root 'NeoXiderAgentDeck.GameBar'
$failures = [System.Collections.Generic.List[string]]::new()

function Require-Text {
    param([string]$Path, [string]$Pattern, [string]$Message)
    $content = Get-Content -LiteralPath $Path -Raw
    if ($content -notmatch $Pattern) {
        $script:failures.Add($Message)
    }
}

function ConvertTo-InvariantDouble {
    param([string]$Value)
    return [double]::Parse($Value, [System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-ThicknessSpan {
    param([string]$Value, [ValidateSet('Horizontal', 'Vertical')][string]$Axis)
    $parts = @($Value.Split(',') | ForEach-Object { ConvertTo-InvariantDouble $_.Trim() })
    switch ($parts.Count) {
        1 { return $parts[0] * 2 }
        2 { return $(if ($Axis -eq 'Horizontal') { $parts[0] * 2 } else { $parts[1] * 2 }) }
        4 { return $(if ($Axis -eq 'Horizontal') { $parts[0] + $parts[2] } else { $parts[1] + $parts[3] }) }
        default { throw "Unsupported XAML thickness: $Value" }
    }
}

$manifestPath = Join-Path $projectRoot 'Package.appxmanifest'
$projectPath = Join-Path $projectRoot 'NeoXiderAgentDeck.GameBar.csproj'
$appPath = Join-Path $projectRoot 'App.xaml.cs'
$protocolPath = Join-Path $projectRoot 'BridgeProtocol.cs'
$clientPath = Join-Path $projectRoot 'BridgeClient.cs'
$widgetXamlPath = Join-Path $projectRoot 'WidgetPage.xaml'
$widgetCodePath = Join-Path $projectRoot 'WidgetPage.xaml.cs'
$bridgePath = Join-Path $root 'BRIDGE_PROTOCOL.md'
$desktopProtocolPath = Join-Path (Split-Path -Parent $root) 'src\gamebar-protocol.cjs'

[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
[xml]$project = Get-Content -LiteralPath $projectPath -Raw
[xml]$widgetXaml = Get-Content -LiteralPath $widgetXamlPath -Raw
$namespace = [System.Xml.XmlNamespaceManager]::new($manifest.NameTable)
$namespace.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
$namespace.AddNamespace('uap3', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/3')
$extension = $manifest.SelectSingleNode('//uap3:AppExtension[@Name="microsoft.gameBarUIExtension"]', $namespace)
if (-not $extension) { $failures.Add('Game Bar app extension is missing.') }
if ($extension -and $extension.Id -ne 'AgentDeckStatus') { $failures.Add('Unexpected Game Bar app extension id.') }

$xamlNamespace = [System.Xml.XmlNamespaceManager]::new($widgetXaml.NameTable)
$xamlNamespace.AddNamespace('p', 'http://schemas.microsoft.com/winfx/2006/xaml/presentation')
$xamlNamespace.AddNamespace('x', 'http://schemas.microsoft.com/winfx/2006/xaml')
$widthStates = @($widgetXaml.SelectNodes('//p:VisualStateGroup[@x:Name="WidthStates"]/p:VisualState', $xamlNamespace))
$wideState = $widthStates | Where-Object { $_.GetAttribute('Name', 'http://schemas.microsoft.com/winfx/2006/xaml') -eq 'Wide' }
$narrowState = $widthStates | Where-Object { $_.GetAttribute('Name', 'http://schemas.microsoft.com/winfx/2006/xaml') -eq 'Narrow' }
if (-not $wideState -or -not $narrowState) {
    $failures.Add('The Wide and Narrow visual states are required.')
} else {
    $wideIndex = [array]::IndexOf($widthStates, $wideState)
    $narrowIndex = [array]::IndexOf($widthStates, $narrowState)
    if ($wideIndex -ge $narrowIndex) {
        $failures.Add('Wide must precede the always-active Narrow fallback so its higher threshold wins.')
    }
    $wideVisibilitySetters = @($wideState.SelectNodes('./p:VisualState.Setters/p:Setter[@Value="Visible"]', $xamlNamespace) |
        ForEach-Object { $_.GetAttribute('Target') })
    foreach ($target in @('OpenButton.Visibility', 'AckButton.Visibility')) {
        if ($target -notin $wideVisibilitySetters) {
            $failures.Add("Wide does not make $target visible.")
        }
    }
}
$manifestMinWidthNode = $manifest.SelectSingleNode('//f:GameBarWidget/f:Window/f:Size/f:MinWidth', $namespace)
$manifestMinHeightNode = $manifest.SelectSingleNode('//f:GameBarWidget/f:Window/f:Size/f:MinHeight', $namespace)
$widgetFrame = $widgetXaml.SelectSingleNode('//*[@x:Name="WidgetFrame"]', $xamlNamespace)
$layoutGrid = $widgetXaml.SelectSingleNode('//*[@x:Name="LayoutGrid"]', $xamlNamespace)
if (-not $manifestMinWidthNode -or -not $manifestMinHeightNode -or -not $widgetFrame -or -not $layoutGrid) {
    $failures.Add('The measurable manifest/XAML layout contract is incomplete.')
} else {
    $manifestMinWidth = ConvertTo-InvariantDouble $manifestMinWidthNode.InnerText
    $manifestMinHeight = ConvertTo-InvariantDouble $manifestMinHeightNode.InnerText
    $rows = @($layoutGrid.SelectNodes('./p:Grid.RowDefinitions/p:RowDefinition', $xamlNamespace))
    $rowHeight = ($rows | Measure-Object -Property Height -Sum).Sum
    $rowSpacing = ConvertTo-InvariantDouble $layoutGrid.GetAttribute('RowSpacing')
    $requiredHeight = (Get-ThicknessSpan $widgetFrame.GetAttribute('Margin') Vertical) +
        (Get-ThicknessSpan $widgetFrame.GetAttribute('Padding') Vertical) +
        $rowHeight + ($rowSpacing * [math]::Max(0, $rows.Count - 1))
    if ($requiredHeight -gt $manifestMinHeight) {
        $failures.Add("The widget needs $requiredHeight epx vertically but the manifest minimum is $manifestMinHeight epx.")
    }

    $avatarColumn = $layoutGrid.SelectSingleNode('./p:Grid.ColumnDefinitions/p:ColumnDefinition[1]', $xamlNamespace)
    $actionPanel = $widgetXaml.SelectSingleNode('//*[@x:Name="ActionPanel"]', $xamlNamespace)
    $quickReply = $widgetXaml.SelectSingleNode('//*[@x:Name="QuickReplyInput"]', $xamlNamespace)
    $actionProgress = $widgetXaml.SelectSingleNode('//*[@x:Name="ActionProgress"]', $xamlNamespace)
    $compactStyle = $widgetXaml.SelectSingleNode('//p:Style[@x:Key="CompactActionButton"]', $xamlNamespace)
    $buttonMinWidth = $compactStyle.SelectSingleNode('./p:Setter[@Property="MinWidth"]', $xamlNamespace)
    $actionColumns = @($actionPanel.SelectNodes('./p:Grid.ColumnDefinitions/p:ColumnDefinition', $xamlNamespace))
    $availableNarrowActionWidth = $manifestMinWidth -
        (Get-ThicknessSpan $widgetFrame.GetAttribute('Margin') Horizontal) -
        (Get-ThicknessSpan $widgetFrame.GetAttribute('Padding') Horizontal) -
        (ConvertTo-InvariantDouble $avatarColumn.GetAttribute('Width')) -
        ((ConvertTo-InvariantDouble $layoutGrid.GetAttribute('ColumnSpacing')) * 2)
    $requiredNarrowActionWidth = (ConvertTo-InvariantDouble $quickReply.GetAttribute('MinWidth')) +
        (ConvertTo-InvariantDouble $buttonMinWidth.GetAttribute('Value')) +
        (ConvertTo-InvariantDouble $actionProgress.GetAttribute('Width')) +
        ((ConvertTo-InvariantDouble $actionPanel.GetAttribute('ColumnSpacing')) * [math]::Max(0, $actionColumns.Count - 1))
    if ($requiredNarrowActionWidth -gt $availableNarrowActionWidth) {
        $failures.Add("The narrow quick-reply path needs $requiredNarrowActionWidth epx but only $availableNarrowActionWidth epx is available.")
    }

    $widgetCode = Get-Content -LiteralPath $widgetCodePath -Raw
    if ($widgetCode -notmatch "ManifestMinimumWidth\s*=\s*$manifestMinWidth" -or
        $widgetCode -notmatch "ManifestMinimumHeight\s*=\s*$manifestMinHeight") {
        $failures.Add('Widget layout constants do not match the manifest minimum dimensions.')
    }
    $wideTrigger = $widgetXaml.SelectSingleNode('//p:VisualState[@x:Name="Wide"]/p:VisualState.StateTriggers/p:AdaptiveTrigger', $xamlNamespace)
    $wideWidth = ConvertTo-InvariantDouble $wideTrigger.GetAttribute('MinWindowWidth')
    if ($widgetCode -notmatch "WideActionsMinimumWidth\s*=\s*$wideWidth") {
        $failures.Add('Widget wide-layout constant does not match its adaptive trigger.')
    }
}

Require-Text $manifestPath '<PinningSupported>true</PinningSupported>' 'Pinning must be enabled.'
Require-Text $manifestPath '<MinWidth>240</MinWidth>' 'The official 240 epx desktop-mode minimum is not declared.'
Require-Text $projectPath 'Microsoft\.Gaming\.XboxGameBar' 'The official Game Bar SDK package reference is missing.'
Require-Text $projectPath '10\.0\.19041\.0' 'Windows SDK 19041 target is missing.'
Require-Text $appPath 'XboxGameBarWidgetActivatedEventArgs' 'Game Bar protocol activation handling is missing.'
Require-Text $appPath 'IsLaunchActivation' 'Launch activation handling is missing.'
Require-Text $bridgePath '\\\\.\\pipe\\LOCAL\\NeoXider\.AgentDeck\.GameBar\.v1' 'The session-local versioned named-pipe endpoint is missing from the bridge contract.'
Require-Text $bridgePath '65536' 'The bridge frame-size limit is missing.'
Require-Text $projectPath 'Compile Include="BridgeClient\.cs"' 'The Game Bar bridge client is not compiled.'
Require-Text $projectPath 'Compile Include="BridgeProtocol\.cs"' 'The Game Bar protocol parser is not compiled.'
Require-Text $clientPath 'new NamedPipeClientStream\(\s*PipeServer,\s*PipeName,\s*PipeDirection\.InOut,\s*PipeOptions\.Asynchronous\)' 'The UWP client must use one asynchronous duplex named pipe.'
Require-Text $clientPath 'PipeServer = "\."' 'The UWP client must connect only to the local machine.'
Require-Text $clientPath 'PipeName = @"LOCAL\\NeoXider\.AgentDeck\.GameBar\.v1"' 'The UWP client pipe name is not AppContainer session-local.'
Require-Text $clientPath 'UTF8Encoding\(false, true\)' 'The UWP client must reject invalid UTF-8.'
Require-Text $clientPath 'MaximumFrameBytes' 'The UWP client does not enforce the frame byte limit.'
Require-Text $clientPath 'MaximumPendingRequests' 'The UWP client does not bound pending commands.'
Require-Text $clientPath '!request\.Completion\.TrySetResult\(frame\)' 'Duplicate command responses are not rejected as replays.'
Require-Text $clientPath 'request\.Generation != currentConnectionGeneration' 'Pending responses are not scoped to their connection generation.'
Require-Text $clientPath '!request\.ExpectedTypes\.Contains\(frame\.Type\)' 'Pending responses do not enforce their expected response kinds.'
Require-Text $clientPath '(?s)frame\.Type == "hello\.ok".*MarkConnected\(currentGeneration, currentConnectionGeneration\).*RaiseConnectionChanged\(BridgeConnectionStatus\.Connected\).*TrySetResult\(frame\)' 'hello.ok must publish the connected state before completing its asynchronous waiter.'
Require-Text $clientPath 'FailPendingGeneration\(\s*stoppedGeneration' 'Stop can fail requests from a newer connection generation.'
Require-Text $clientPath 'connectionGeneration = \+\+nextConnectionGeneration' 'Reconnects do not receive distinct captured connection generations.'
Require-Text $clientPath '"hello\.ok"' 'The hello request does not require a hello.ok response.'
Require-Text $clientPath '"command\.ok",\s*"command\.error"' 'Commands do not constrain response kinds to command.ok/error.'
Require-Text $clientPath 'InitialReconnectDelayMilliseconds' 'The UWP client reconnect backoff is missing.'
Require-Text $clientPath 'CreateHello' 'The UWP client handshake is missing.'
Require-Text $clientPath 'request-snapshot' 'The UWP client does not request initial live state.'
Require-Text $clientPath 'cancellationToken\.Register\(\(\) => pipe\.Dispose\(\)\)' 'Pipe cancellation does not close the active connection.'
Require-Text $protocolPath 'MaximumFrameBytes = 65536' 'The UWP protocol byte limit is not 65536.'
Require-Text $protocolPath 'RequireKeys' 'The UWP protocol parser does not reject unknown fields.'
Require-Text $protocolPath 'JsonObject\.Parse' 'The UWP protocol parser is missing.'
Require-Text $protocolPath 'unknown-status' 'The UWP protocol parser does not reject unknown statuses.'
Require-Text $protocolPath 'capabilities\.Count != Capabilities\.Count' 'The UWP handshake does not require the complete v1 capability set.'
Require-Text $protocolPath '\^\(\?!0000\)\\\\d\{4\}-' 'The UWP timestamp parser must reject year 0000.'
Require-Text $desktopProtocolPath '\^\(\?!0000\)\\d\{4\}-' 'The desktop timestamp parser must reject year 0000.'
Require-Text $protocolPath "character <= '\\u001F'" 'The UWP validator does not reject C0 controls.'
Require-Text $protocolPath "character >= '\\u007F' && character <= '\\u009F'" 'The UWP validator does not reject DEL and C1 controls.'
Require-Text $protocolPath "character == '\\n'" 'The UWP validator does not preserve LF as the only allowed control.'
Require-Text $protocolPath "character != '\\uFEFF' && !char\.IsWhiteSpace\(character\)" 'The UWP quick-reply blank check does not cover Unicode whitespace and BOM.'
Require-Text $bridgePath 'complete four-item set exactly once' 'The bridge contract does not require exact v1 capabilities.'
Require-Text $widgetCodePath 'snapshot\.Revision <= lastSnapshotRevision' 'The widget does not ignore stale snapshot revisions.'
Require-Text $widgetCodePath 'Dispatcher\.RunAsync' 'Bridge callbacks are not marshalled to the UI dispatcher.'
Require-Text $widgetCodePath 'Application\.Current\.Suspending' 'The widget does not cancel its bridge on suspension.'
Require-Text $widgetCodePath 'Application\.Current\.Resuming' 'The widget does not reconnect after suspension.'
Require-Text $widgetCodePath 'bridgeClient\.Dispose\(\)' 'Navigation cleanup does not dispose the bridge client.'
Require-Text $widgetCodePath 'ApplyStatus\(AgentStatus\.Offline, "Agent Deck", "Waiting for live snapshot"\)' 'A connected pipe must not be presented as live before a validated snapshot.'
Require-Text $widgetXamlPath 'x:Name="OpenButton"' 'The compact session-open control is missing.'
Require-Text $widgetXamlPath 'x:Name="AckButton"' 'The compact acknowledgement control is missing.'
Require-Text $widgetXamlPath 'x:Name="QuickReplyInput"' 'The compact quick-reply input is missing.'
Require-Text $widgetXamlPath 'MaxLength="4000"' 'The quick-reply UI is not bounded to the protocol limit.'
Require-Text $widgetXamlPath 'x:Name="ActionProgress"' 'The compact busy state is missing.'
Require-Text $widgetXamlPath 'x:Name="ActionError"' 'The compact command error state is missing.'
Require-Text $widgetXamlPath '<AdaptiveTrigger MinWindowWidth="0"' 'The narrow layout does not reactivate below the wide breakpoint.'
Require-Text $widgetXamlPath '<AdaptiveTrigger MinWindowWidth="360"' 'The wide action layout trigger is missing.'
$openButton = $widgetXaml.SelectSingleNode('//*[@x:Name="OpenButton"]', $xamlNamespace)
$ackButton = $widgetXaml.SelectSingleNode('//*[@x:Name="AckButton"]', $xamlNamespace)
$sendButton = $widgetXaml.SelectSingleNode('//*[@x:Name="SendReplyButton"]', $xamlNamespace)
if ($openButton.GetAttribute('Visibility') -ne 'Collapsed' -or $ackButton.GetAttribute('Visibility') -ne 'Collapsed') {
    $failures.Add('Open and Ack must be collapsed in the 240 epx narrow layout.')
}
if ($sendButton.GetAttribute('Visibility') -eq 'Collapsed') {
    $failures.Add('Quick reply Send must remain interactive in the narrow layout.')
}
foreach ($handler in [regex]::Matches((Get-Content -LiteralPath $widgetXamlPath -Raw), '(?:Click|KeyDown|TextChanged|Loaded)="([A-Za-z_][A-Za-z0-9_]*)"')) {
    $name = [regex]::Escape($handler.Groups[1].Value)
    if ((Get-Content -LiteralPath $widgetCodePath -Raw) -notmatch "\b$name\s*\(") {
        $failures.Add("Missing widget code-behind handler: $($handler.Groups[1].Value)")
    }
}
if ((Get-Content -LiteralPath $clientPath -Raw) -match 'TcpClient|HttpClient|StreamSocket') {
    $failures.Add('The Game Bar client must not add a TCP transport.')
}

Add-Type -AssemblyName System.Drawing
$expectedAssets = @{
    'Assets\AgentAvatar.png' = @(256, 256)
    'Assets\Square150x150Logo.png' = @(150, 150)
    'Assets\Square44x44Logo.png' = @(44, 44)
    'Assets\StoreLogo.png' = @(50, 50)
}
foreach ($entry in $expectedAssets.GetEnumerator()) {
    $path = Join-Path $projectRoot $entry.Key
    if (-not (Test-Path -LiteralPath $path)) {
        $failures.Add("Missing asset: $($entry.Key)")
        continue
    }
    $image = [System.Drawing.Image]::FromFile($path)
    try {
        if ($image.Width -ne $entry.Value[0] -or $image.Height -ne $entry.Value[1]) {
            $failures.Add("Unexpected dimensions for $($entry.Key): $($image.Width)x$($image.Height)")
        }
    } finally {
        $image.Dispose()
    }
}

if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Error $failure }
    exit 1
}

Write-Host (
    "Game Bar companion contract: PASS (minimum ${manifestMinWidth}x${manifestMinHeight}; " +
    "measured height $requiredHeight; narrow actions $requiredNarrowActionWidth/$availableNarrowActionWidth epx)"
) -ForegroundColor Green
