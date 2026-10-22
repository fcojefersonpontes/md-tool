# Captures the VS Code window whose title contains $Title, without bringing it to the front.
# Reads one output path per line from stdin and answers "ok" (or "error: ...") for each.
param(
  [Parameter(Mandatory)] [string] $Title,
  [int] $Width = 1280,
  [int] $Height = 750,
  [int] $TitleBar = 30
)

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
[void][Win]::SetProcessDPIAware()

function Find-Window {
  $process = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$Title*" } |
    Select-Object -First 1
  if ($process) { $process.MainWindowHandle } else { [IntPtr]::Zero }
}

$hwnd = [IntPtr]::Zero
while ($null -ne ($path = [Console]::In.ReadLine())) {
  try {
    if ($hwnd -eq [IntPtr]::Zero) {
      $hwnd = Find-Window
      if ($hwnd -eq [IntPtr]::Zero) { throw "no window titled *$Title*" }
      [void][Win]::ShowWindow($hwnd, 9) # SW_RESTORE
      # Size the visible frame (the window rect adds invisible resize borders).
      [void][Win]::MoveWindow($hwnd, 0, 0, $Width, $Height, $true)
      $outer = New-Object Win+RECT; $frame = New-Object Win+RECT
      [void][Win]::GetWindowRect($hwnd, [ref]$outer)
      [void][Win]::DwmGetWindowAttribute($hwnd, 9, [ref]$frame, 16)
      $extraW = ($outer.Right - $outer.Left) - ($frame.Right - $frame.Left)
      $extraH = ($outer.Bottom - $outer.Top) - ($frame.Bottom - $frame.Top)
      [void][Win]::MoveWindow($hwnd, 0, 0, $Width + $extraW, $Height + $extraH, $true)
      # Keep it on top: Chromium stops painting occluded windows (mermaid never renders).
      [void][Win]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x0013) # TOPMOST, NOSIZE|NOMOVE|NOACTIVATE
      Start-Sleep -Milliseconds 800
    }
    $outer = New-Object Win+RECT; $frame = New-Object Win+RECT
    [void][Win]::GetWindowRect($hwnd, [ref]$outer)
    [void][Win]::DwmGetWindowAttribute($hwnd, 9, [ref]$frame, 16)
    $w = $outer.Right - $outer.Left; $h = $outer.Bottom - $outer.Top
    $bitmap = New-Object System.Drawing.Bitmap $w, $h
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $hdc = $graphics.GetHdc()
    [void][Win]::PrintWindow($hwnd, $hdc, 2) # PW_RENDERFULLCONTENT
    $graphics.ReleaseHdc($hdc); $graphics.Dispose()
    # Drop the title bar ("[Extension Development Host]") from the picture.
    $top = ($frame.Top - $outer.Top) + $TitleBar
    $crop = New-Object System.Drawing.Rectangle ($frame.Left - $outer.Left), $top, ($frame.Right - $frame.Left), ($frame.Bottom - $frame.Top - $TitleBar)
    $cropped = $bitmap.Clone($crop, $bitmap.PixelFormat)
    $cropped.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $cropped.Dispose(); $bitmap.Dispose()
    [Console]::Out.WriteLine('ok')
  } catch {
    [Console]::Out.WriteLine("error: $($_.Exception.Message)")
  }
}
