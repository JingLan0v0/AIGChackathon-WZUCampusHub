# 只截 WorkBuddy 窗口（后台也能截，用 PrintWindow）
# 输出：roadshow\shots\ui\workbuddy-<n>.png
$ErrorActionPreference = 'Continue'
$out = 'C:\Users\forey\WorkBuddy\2026-09-22-09-42-38\roadshow\shots\ui'
New-Item -ItemType Directory -Force -Path $out | Out-Null

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Drawing;
using System.Runtime.InteropServices;
public class Cap {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  public static IntPtr Find(string needle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      StringBuilder sb = new StringBuilder(300);
      GetWindowText(h, sb, 300);
      string t = sb.ToString();
      if (t.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) {
        RECT r; GetWindowRect(h, out r);
        if ((r.R - r.L) > 600 && (r.B - r.T) > 400) { found = h; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static string Grab(IntPtr h, string path) {
    RECT r; GetWindowRect(h, out r);
    int w = r.R - r.L, ht = r.B - r.T;
    Bitmap bmp = new Bitmap(w, ht);
    Graphics g = Graphics.FromImage(bmp);
    IntPtr dc = g.GetHdc();
    // flags=2 → PW_RENDERFULLCONTENT，Electron/硬件加速窗口要用这个，否则截出来是黑的
    bool okRender = PrintWindow(h, dc, 2);
    g.ReleaseHdc(dc);
    if (!okRender) {
      g.CopyFromScreen(r.L, r.T, 0, 0, new Size(w, ht));
    }
    bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    g.Dispose(); bmp.Dispose();
    return w + "x" + ht + " render=" + okRender;
  }
}
"@ -ReferencedAssemblies System.Drawing, System.Windows.Forms

$h = [Cap]::Find('WorkBuddy')
$log = Join-Path $out 'capture-log.txt'
$res = @('句柄: ' + $h)
if ($h -ne [IntPtr]::Zero) {
  $file = Join-Path $out 'workbuddy-ui.png'
  $res += '结果: ' + [Cap]::Grab($h, $file)
  $res += '文件: ' + $file + ' 存在=' + (Test-Path $file)
} else {
  $res += '没找到 WorkBuddy 窗口'
}
Set-Content -Encoding UTF8 $log $res
