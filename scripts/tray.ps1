# The JARVIS icon by the clock, started by scripts/desktop.mjs.
#
# JARVIS keeps running after his window is closed, so something on screen has
# to say so and offer the way out: click to open the window, right-click to
# quit. It leaves by itself when the brain is no longer running.

$ErrorActionPreference = 'Stop'

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\JarvisTray', [ref]$created)
if (-not $created) { exit }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function Run-Launcher([string[]]$extra) {
  $argv = @('"' + $env:JARVIS_LAUNCHER + '"') + $extra
  Start-Process -FilePath $env:JARVIS_NODE -ArgumentList $argv -WindowStyle Hidden
}

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = New-Object System.Drawing.Icon($env:JARVIS_ICON)
$icon.Text = 'J.A.R.V.I.S. - click to open'

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Open JARVIS')
$open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
[void]$menu.Items.Add('-')
$quit = $menu.Items.Add('Quit JARVIS')
$icon.ContextMenuStrip = $menu

$open.add_Click({ Run-Launcher @() })
$icon.add_MouseClick({
  param($sender, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Run-Launcher @() }
})
$quit.add_Click({
  $icon.Visible = $false
  Run-Launcher @('--stop')
  [System.Windows.Forms.Application]::Exit()
})

$icon.Visible = $true
if ($env:JARVIS_TRAY_HINT -eq '1') {
  $icon.ShowBalloonTip(6000, 'J.A.R.V.I.S.', 'Running in the background. Click this icon to open him; right-click to quit.', 'Info')
}

# Leave when the brain has stopped, however that happened.
$misses = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $up = $client.ConnectAsync('127.0.0.1', [int]$env:JARVIS_BRIDGE_PORT).Wait(1500)
  } catch {
    $up = $false
  } finally {
    $client.Dispose()
  }
  if ($up) { $script:misses = 0 } else { $script:misses++ }
  if ($script:misses -ge 3) {
    $icon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
  }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$icon.Dispose()
$mutex.ReleaseMutex()
