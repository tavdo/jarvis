<#
  Gives JARVIS its own taskbar identity (Windows).

  The JARVIS window is a Chrome app window, so Windows would group it with
  Chrome and pin it as a bare Chrome command. Tagging the window and the
  shortcuts with one AppUserModelID makes them a single app: the window shows
  under the JARVIS icon, and pinning it relaunches through the JARVIS launcher.
  Windows lets only the user pin, so pinning itself is right-click > Pin to taskbar.

    -Mode window    tag the open JARVIS window (title "J.A.R.V.I.S.")
    -Mode shortcut  tag the shortcut at -Path

  Inputs: -Path, and $env:J_LAUNCH (the relaunch command), $env:J_ICON.
#>
param(
  [ValidateSet('window', 'shortcut')][string]$Mode = 'window',
  [string]$Path = ''
)
$ErrorActionPreference = 'Stop'
$AppId = 'Jarvis.Assistant'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class JarvisTaskbar {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PropertyKey {
    public Guid fmtid; public uint pid;
    public PropertyKey(Guid g, uint p) { fmtid = g; pid = p; }
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct PropVariant {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr p;
    [FieldOffset(16)] public IntPtr pad;
  }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    int GetCount(out uint c);
    int GetAt(uint i, out PropertyKey k);
    int GetValue(ref PropertyKey k, out PropVariant v);
    int SetValue(ref PropertyKey k, ref PropVariant v);
    int Commit();
  }

  [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPersistFile {
    void GetClassID(out Guid c);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string f, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string f, bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string f);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string f);
  }

  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  class ShellLink {}

  [DllImport("shell32.dll")]
  static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

  static readonly Guid AUMID = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");

  static void Set(IPropertyStore store, uint pid, string value) {
    var key = new PropertyKey(AUMID, pid);
    var v = new PropVariant { vt = 31, p = Marshal.StringToCoTaskMemUni(value) }; // VT_LPWSTR
    try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref v)); }
    finally { Marshal.FreeCoTaskMem(v.p); }
  }

  public static void TagWindow(IntPtr hwnd, string appId, string relaunch, string name, string icon) {
    var iid = typeof(IPropertyStore).GUID;
    IPropertyStore store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(hwnd, ref iid, out store));
    try {
      // Relaunch details first: the shell reads them when the ID is applied.
      Set(store, 2, relaunch);  // RelaunchCommand
      Set(store, 4, name);      // RelaunchDisplayNameResource
      Set(store, 3, icon);      // RelaunchIconResource
      Set(store, 5, appId);     // ID
      Marshal.ThrowExceptionForHR(store.Commit());
    } finally { Marshal.ReleaseComObject(store); }
  }

  public static void TagShortcut(string path, string appId) {
    var link = new ShellLink();
    try {
      ((IPersistFile)link).Load(path, 2);
      var store = (IPropertyStore)link;
      Set(store, 5, appId);
      Marshal.ThrowExceptionForHR(store.Commit());
      ((IPersistFile)link).Save(path, true);
    } finally { Marshal.ReleaseComObject(link); }
  }
}
'@

if ($Mode -eq 'window') {
  $deadline = (Get-Date).AddSeconds(30)
  $found = $null
  while (-not $found -and (Get-Date) -lt $deadline) {
    $found = Get-Process chrome, msedge -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowTitle -eq 'J.A.R.V.I.S.' } | Select-Object -First 1
    if (-not $found) { Start-Sleep -Milliseconds 500 }
  }
  if (-not $found) { 'NO WINDOW'; exit 1 }
  [JarvisTaskbar]::TagWindow($found.MainWindowHandle, $AppId, $env:J_LAUNCH, 'JARVIS', $env:J_ICON)
  'TAGGED'
  exit 0
}

[JarvisTaskbar]::TagShortcut($Path, $AppId)
'TAGGED'
