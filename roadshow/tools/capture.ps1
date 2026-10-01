# 截取屏幕 + 枚举窗口位置，供路演/视频稿用
# 输出：C:\Users\forey\WorkBuddy\2026-09-22-09-42-38\roadshow\shots\ui\
$ErrorActionPreference = 'Continue'
$out = 'C:\Users\forey\WorkBuddy\2026-09-22-09-42-38\roadshow\shots\ui'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$log = Join-Path $out 'windows.txt'
$lines = @()

# ① 枚举可见窗口：标题 + 位置 + 大小
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
$list = New-Object System.Collections.ArrayList
$cb = [Win+EnumWindowsProc]{
  param($h, $l)
  if ([Win]::IsWindowVisible($h)) {
    $len = [Win]::GetWindowTextLength($h)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 2)
      [Win]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
      $r = New-Object Win+RECT
      [Win]::GetWindowRect($h, [ref]$r) | Out-Null
      $w = $r.R - $r.L; $ht = $r.B - $r.T
      if ($w -gt 200 -and $ht -gt 200) {
        $null = $list.Add(("{0}|{1}|{2},{3},{4},{5}" -f $sb.ToString(), $h, $r.L, $r.T, $w, $ht))
      }
    }
  }
  return $true
}
[Win]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$fg = [Win]::GetForegroundWindow()
$lines += '前台窗口句柄: ' + $fg
$lines += $list
Set-Content -Encoding UTF8 $log $lines

# ② 整屏截图
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$lines += ('屏幕: {0}x{1}' -f $b.Width, $b.Height)
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
$file = Join-Path $out 'screen.png'
$bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$lines += '截图: ' + $file + ' 存在=' + (Test-Path $file)
Set-Content -Encoding UTF8 $log $lines
