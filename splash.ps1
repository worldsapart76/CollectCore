Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="CollectCore"
        WindowStartupLocation="CenterScreen"
        Width="360" Height="160"
        WindowStyle="None"
        ResizeMode="NoResize"
        Topmost="True"
        AllowsTransparency="True"
        Background="Transparent"
        ShowInTaskbar="False">
    <Border CornerRadius="8" Background="#1b2e1b">
        <StackPanel VerticalAlignment="Center" HorizontalAlignment="Center">
            <TextBlock Text="CollectCore"
                       Foreground="#e0e0e0"
                       FontSize="28"
                       FontWeight="SemiBold"
                       HorizontalAlignment="Center"
                       FontFamily="Segoe UI" />
            <TextBlock Foreground="#88aa88"
                       FontSize="14"
                       HorizontalAlignment="Center"
                       Margin="0,8,0,0"
                       FontFamily="Segoe UI"
                       Text="starting..." />
        </StackPanel>
    </Border>
</Window>
"@

$reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
$window = [System.Windows.Markup.XamlReader]::Load($reader)

# Auto-close after 11 seconds (covers the VBS startup sleep window)
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(11)
$timer.Add_Tick({
    $window.Close()
    $timer.Stop()
})
$timer.Start()

$window.ShowDialog() | Out-Null
