# JeanCode - driver de control del equipo para Windows.
# Proceso persistente: lee una orden JSON por linea en stdin y responde una linea JSON en stdout.
#   {"id":1,"cmd":"screenshot","args":{"maxWidth":1366}}  ->  {"id":1,"ok":true,"result":{...}}
# Entrada real del sistema operativo: SendInput / SetCursorPos (user32) y UI Automation.
# No guarda nada en disco y no abre conexiones de red.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing, System.Windows.Forms, UIAutomationClient, UIAutomationTypes
# Proveedores de cliente para controles Win32/WinForms clásicos: sin ellos un botón se ve como "Pane"
try {
  $prov = (Add-Type -AssemblyName UIAutomationClientsideProviders -PassThru | Select-Object -First 1).Assembly
  [System.Windows.Automation.ClientSettings]::RegisterClientSideProviderAssembly($prov.GetName())
} catch { }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class JcNative {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static string ClassOf(IntPtr h) { StringBuilder s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  // Ventana raíz que hay realmente bajo un punto de la pantalla
  public static IntPtr RootAt(int x, int y) {
    POINT p; p.X = x; p.Y = y;
    IntPtr h = WindowFromPoint(p);
    if (h == IntPtr.Zero) return IntPtr.Zero;
    IntPtr root = GetAncestor(h, 2);
    return root == IntPtr.Zero ? h : root;
  }
  // Texto de un control Win32 clásico (Edit, Static...) cuando UI Automation no lo expone
  public static string ControlText(IntPtr h) { StringBuilder s = new StringBuilder(4096); SendMessage(h, 0x000D, (IntPtr)4096, s); return s.ToString(); }
  public static bool IsPasswordEdit(IntPtr h) { return (GetWindowLong(h, -16) & 0x20) != 0; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")] public static extern IntPtr SendText(IntPtr h, uint msg, IntPtr w, string l);
  public static void SetControlText(IntPtr h, string text) { SendText(h, 0x000C, IntPtr.Zero, text); }

  static INPUT Mouse(uint flags, uint data) {
    INPUT i = new INPUT(); i.type = 0; i.U.mi.dwFlags = flags; i.U.mi.mouseData = data; return i;
  }
  static INPUT Key(ushort vk, ushort scan, uint flags) {
    INPUT i = new INPUT(); i.type = 1; i.U.ki.wVk = vk; i.U.ki.wScan = scan; i.U.ki.dwFlags = flags; return i;
  }
  static void Send(params INPUT[] a) {
    uint n = SendInput((uint)a.Length, a, Marshal.SizeOf(typeof(INPUT)));
    if (n != a.Length) throw new Exception("SendInput bloqueado (" + Marshal.GetLastWin32Error() + "): la ventana activa puede tener mas privilegios que JeanCode");
  }
  public static void MouseButton(string button, bool down) {
    uint f = button == "right" ? (down ? 0x0008u : 0x0010u) : button == "middle" ? (down ? 0x0020u : 0x0040u) : (down ? 0x0002u : 0x0004u);
    Send(Mouse(f, 0));
  }
  public static void Wheel(int clicks, bool horizontal) {
    Send(Mouse(horizontal ? 0x01000u : 0x0800u, unchecked((uint)(clicks * 120))));
  }
  public static void VKey(ushort vk, bool down) {
    uint ext = (vk == 0x25 || vk == 0x26 || vk == 0x27 || vk == 0x28 || vk == 0x2D || vk == 0x2E || vk == 0x24 || vk == 0x23 || vk == 0x21 || vk == 0x22 || vk == 0x5B) ? 0x1u : 0u;
    Send(Key(vk, 0, ext | (down ? 0u : 0x2u)));
  }
  public static void UnicodeChar(char c) {
    Send(Key(0, c, 0x4), Key(0, c, 0x4 | 0x2));
  }
  public static string Title(IntPtr h) { StringBuilder s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
}
"@

[void][JcNative]::SetProcessDPIAware()   # coordenadas en pixeles fisicos

$VK = @{
  'enter'=0x0D; 'return'=0x0D; 'tab'=0x09; 'esc'=0x1B; 'escape'=0x1B; 'space'=0x20; 'backspace'=0x08; 'delete'=0x2E; 'del'=0x2E;
  'insert'=0x2D; 'home'=0x24; 'end'=0x23; 'pageup'=0x21; 'pagedown'=0x22; 'left'=0x25; 'up'=0x26; 'right'=0x27; 'down'=0x28;
  'ctrl'=0x11; 'control'=0x11; 'alt'=0x12; 'shift'=0x10; 'win'=0x5B; 'meta'=0x5B; 'cmd'=0x5B; 'capslock'=0x14; 'printscreen'=0x2C;
  'f1'=0x70; 'f2'=0x71; 'f3'=0x72; 'f4'=0x73; 'f5'=0x74; 'f6'=0x75; 'f7'=0x76; 'f8'=0x77; 'f9'=0x78; 'f10'=0x79; 'f11'=0x7A; 'f12'=0x7B;
}
function Get-VK([string]$name) {
  $k = $name.Trim().ToLower()
  if ($VK.ContainsKey($k)) { return [uint16]$VK[$k] }
  if ($k.Length -eq 1) {
    $c = [char]::ToUpper($k[0])
    if (($c -ge 'A' -and $c -le 'Z') -or ($c -ge '0' -and $c -le '9')) { return [uint16][int]$c }
  }
  throw "tecla desconocida: $name"
}

function Screen-Info {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  return @{ x = $b.X; y = $b.Y; width = $b.Width; height = $b.Height }
}

function Foreground {
  $h = [JcNative]::GetForegroundWindow()
  $procId = 0
  [void][JcNative]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = ''
  try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }
  return @{ title = [JcNative]::Title($h); process = $name; pid = [int]$procId; class = [JcNative]::ClassOf($h) }
}

function Do-Screenshot($a) {
  $s = Screen-Info
  $maxW = 1366; if ($a.maxWidth) { $maxW = [int]$a.maxWidth }
  $scale = [Math]::Min(1.0, $maxW / $s.width)
  $bmp = New-Object System.Drawing.Bitmap($s.width, $s.height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($s.x, $s.y, 0, 0, $bmp.Size)
  $g.Dispose()
  $w = [int][Math]::Round($s.width * $scale); $hgt = [int][Math]::Round($s.height * $scale)
  $out = New-Object System.Drawing.Bitmap($w, $hgt)
  $g2 = [System.Drawing.Graphics]::FromImage($out)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $w, $hgt)
  $g2.Dispose(); $bmp.Dispose()
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]70)
  $ms = New-Object System.IO.MemoryStream
  $out.Save($ms, $codec, $ep); $out.Dispose()
  $b64 = [Convert]::ToBase64String($ms.ToArray()); $ms.Dispose()
  return @{ jpeg = $b64; width = $w; height = $hgt; screen = $s; scale = $scale; foreground = (Foreground) }
}

# ---------------------------------------------------------------- UI Automation
$global:Elements = @{}

function Rect-Of($el) {
  $r = $el.Current.BoundingRectangle
  if ($r.IsEmpty -or $r.Width -le 0 -or $r.Height -le 0) { return $null }
  return @{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
}

function Do-Inspect($a) {
  $max = 160; if ($a.max) { $max = [int]$a.max }
  $h = [JcNative]::GetForegroundWindow()
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $global:Elements = @{}
  $list = New-Object System.Collections.ArrayList
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue(@($root, 0))
  $n = 0
  while ($queue.Count -gt 0 -and $n -lt $max) {
    $pair = $queue.Dequeue(); $el = $pair[0]; $depth = $pair[1]
    try {
      $cur = $el.Current
      $rect = Rect-Of $el
      if ($rect -and -not $cur.IsOffscreen) {
        $type = $cur.ControlType.ProgrammaticName -replace '^ControlType\.', ''
        $value = ''
        $isPassword = [bool]$cur.IsPassword
        # Controles Win32/WinForms clásicos: UI Automation administrada los ve como "Pane";
        # el tipo real sale de la clase de ventana y el texto de WM_GETTEXT
        if ($type -eq 'Pane' -and $cur.NativeWindowHandle -ne 0) {
          $cls = [string]$cur.ClassName
          $hw = [IntPtr]$cur.NativeWindowHandle
          if ($cls -match '(?i)(^|\.)EDIT(\.|$)|RichEdit') {
            $type = 'Edit'
            $isPassword = [JcNative]::IsPasswordEdit($hw)
            if (-not $isPassword) { $value = [JcNative]::ControlText($hw); if ($value.Length -gt 120) { $value = $value.Substring(0, 120) + '...' } }
          }
          elseif ($cls -match '(?i)(^|\.)BUTTON(\.|$)') { $type = 'Button' }
          elseif ($cls -match '(?i)(^|\.)STATIC(\.|$)') { $type = 'Text' }
          elseif ($cls -match '(?i)COMBOBOX') { $type = 'ComboBox' }
          elseif ($cls -match '(?i)LISTBOX') { $type = 'List' }
        }
        if (-not $isPassword -and -not $value) {
          try {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $value = [string]$vp.Current.Value
            if ($value.Length -gt 120) { $value = $value.Substring(0, 120) + '...' }
          } catch { }
        }
        if ($cur.Name -or $value -or $cur.AutomationId -or $type -match 'Button|Edit|Document|MenuItem|ListItem|TabItem|CheckBox|ComboBox|Hyperlink|TreeItem') {
          $n++
          $global:Elements["$n"] = $el
          [void]$list.Add(@{ id = $n; type = $type; name = [string]$cur.Name; automationId = [string]$cur.AutomationId; value = $value;
            enabled = [bool]$cur.IsEnabled; password = $isPassword; focused = [bool]$cur.HasKeyboardFocus; rect = $rect; depth = $depth })
        }
      }
      if ($depth -lt 14) {
        $child = $walker.GetFirstChild($el)
        while ($child -ne $null) { $queue.Enqueue(@($child, ($depth + 1))); $child = $walker.GetNextSibling($child) }
      }
    } catch { }
  }
  return @{ window = (Foreground); elements = $list; truncated = ($queue.Count -gt 0) }
}

function Element-Of($id) {
  $el = $global:Elements["$id"]
  if (-not $el) { throw "el elemento $id ya no existe: vuelve a inspeccionar la ventana" }
  return $el
}

function Do-ClickElement($a) {
  $el = Element-Of $a.id
  $cur = $el.Current
  if (-not $cur.IsEnabled) { throw "el elemento $($a.id) ('$($cur.Name)') esta deshabilitado" }
  $button = 'left'; if ($a.button) { $button = [string]$a.button }
  if ($button -eq 'left' -and -not $a.double) {
    try {
      $ip = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $ip.Invoke()
      return @{ method = 'invoke'; name = $cur.Name }
    } catch { }
  }
  $r = Rect-Of $el
  if (-not $r) { throw "el elemento no tiene posicion visible" }
  $cx = [int]($r.x + $r.w / 2); $cy = [int]($r.y + $r.h / 2)
  [void](Do-Click @{ x = $cx; y = $cy; button = $button; double = $a.double })
  return @{ method = 'mouse'; name = $cur.Name; x = $cx; y = $cy }
}

function Do-SetText($a) {
  $el = Element-Of $a.id
  $hw = [IntPtr]$el.Current.NativeWindowHandle
  if ($el.Current.IsPassword -or ($hw -ne [IntPtr]::Zero -and [JcNative]::IsPasswordEdit($hw) -and $el.Current.ClassName -match '(?i)EDIT')) { throw "es un campo de contrasena: JeanCode no escribe contrasenas" }
  $vp = $null
  try { $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch { }
  if ($vp) {
    if ($vp.Current.IsReadOnly) { throw "el campo '$($el.Current.Name)' es de solo lectura" }
    $vp.SetValue([string]$a.text)
    return @{ method = 'value'; name = $el.Current.Name }
  }
  # Edit Win32 clásico: WM_SETTEXT (dispara los eventos de cambio del control)
  if ($hw -ne [IntPtr]::Zero -and $el.Current.ClassName -match '(?i)(^|\.)EDIT(\.|$)|RichEdit') {
    [JcNative]::SetControlText($hw, [string]$a.text)
    return @{ method = 'settext'; name = $el.Current.Name }
  }
  # sin ValuePattern: clic real en el control y teclado real
  $r = Rect-Of $el
  if (-not $r) { throw "el elemento no tiene posicion visible" }
  [void](Do-Click @{ x = [int]($r.x + $r.w / 2); y = [int]($r.y + $r.h / 2) })
  Start-Sleep -Milliseconds 80
  [void](Do-Type @{ text = [string]$a.text })
  return @{ method = 'typed'; name = $el.Current.Name }
}

# ---------------------------------------------------------------- raton y teclado
function Do-Move($a) {
  if (-not [JcNative]::SetCursorPos([int]$a.x, [int]$a.y)) { throw "no se pudo mover el raton" }
  $p = New-Object JcNative+POINT
  [void][JcNative]::GetCursorPos([ref]$p)
  return @{ x = $p.X; y = $p.Y }
}

function Do-Click($a) {
  [void](Do-Move $a)
  Start-Sleep -Milliseconds 40
  $button = 'left'; if ($a.button) { $button = [string]$a.button }
  $times = 1; if ($a.double) { $times = 2 }
  for ($i = 0; $i -lt $times; $i++) {
    [JcNative]::MouseButton($button, $true); Start-Sleep -Milliseconds 30; [JcNative]::MouseButton($button, $false)
    if ($times -gt 1) { Start-Sleep -Milliseconds 60 }
  }
  return @{ x = [int]$a.x; y = [int]$a.y; button = $button }
}

function Do-Drag($a) {
  [void](Do-Move @{ x = $a.x; y = $a.y })
  [JcNative]::MouseButton('left', $true)
  $steps = 12
  for ($i = 1; $i -le $steps; $i++) {
    $x = [int]($a.x + ($a.toX - $a.x) * $i / $steps); $y = [int]($a.y + ($a.toY - $a.y) * $i / $steps)
    [void][JcNative]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 15
  }
  [JcNative]::MouseButton('left', $false)
  return @{ from = @($a.x, $a.y); to = @($a.toX, $a.toY) }
}

function Do-Scroll($a) {
  if ($a.x -ne $null -and $a.y -ne $null) { [void](Do-Move $a) }
  [JcNative]::Wheel([int]$a.clicks, [bool]$a.horizontal)
  return @{ clicks = [int]$a.clicks }
}

function Assert-NotPassword {
  try {
    $f = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($f -and $f.Current.IsPassword) { throw "PASSWORD" }
    if ($f -and $f.Current.NativeWindowHandle -ne 0 -and $f.Current.ClassName -match '(?i)EDIT' -and [JcNative]::IsPasswordEdit([IntPtr]$f.Current.NativeWindowHandle)) { throw "PASSWORD" }
  } catch {
    if ($_.Exception.Message -eq 'PASSWORD') { throw "el campo activo es una contrasena: JeanCode no escribe contrasenas" }
  }
}

function Do-Type($a) {
  Assert-NotPassword
  $text = [string]$a.text
  foreach ($c in $text.ToCharArray()) {
    if ($c -eq "`n") { [JcNative]::VKey(0x0D, $true); [JcNative]::VKey(0x0D, $false) }
    elseif ($c -eq "`r") { }
    elseif ($c -eq "`t") { [JcNative]::VKey(0x09, $true); [JcNative]::VKey(0x09, $false) }
    else { [JcNative]::UnicodeChar($c) }
    Start-Sleep -Milliseconds 4
  }
  return @{ chars = $text.Length }
}

function Do-Keys($a) {
  $keys = @($a.keys | ForEach-Object { Get-VK ([string]$_) })
  foreach ($k in $keys) { [JcNative]::VKey($k, $true); Start-Sleep -Milliseconds 20 }
  for ($i = $keys.Count - 1; $i -ge 0; $i--) { [JcNative]::VKey($keys[$i], $false); Start-Sleep -Milliseconds 20 }
  return @{ keys = $a.keys }
}

# ---------------------------------------------------------------- ventanas y aplicaciones
function Do-Windows {
  return @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object -First 40 | ForEach-Object {
    @{ title = $_.MainWindowTitle; process = $_.ProcessName; pid = $_.Id } })
}

function Focus-Handle($h) {
  if ([JcNative]::IsIconic($h)) { [void][JcNative]::ShowWindow($h, 9) }
  # Windows solo deja cambiar el primer plano tras una entrada de teclado: ALT pulsado y soltado
  [JcNative]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [JcNative]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [void][JcNative]::SetForegroundWindow($h)
  Start-Sleep -Milliseconds 250
}

function Do-Focus($a) {
  $q = [string]$a.title
  $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -like "*$q*" -or $_.ProcessName -like "*$q*") } | Select-Object -First 1
  if (-not $p) { throw "no hay ninguna ventana que coincida con '$q'" }
  Focus-Handle $p.MainWindowHandle
  return Foreground
}

function Do-Open($a) {
  $target = [string]$a.target
  $argList = @(); if ($a.args) { $argList = @($a.args | ForEach-Object { [string]$_ }) }
  if ($argList.Count -gt 0) { $p = Start-Process -FilePath $target -ArgumentList $argList -PassThru }
  else { $p = Start-Process -FilePath $target -PassThru }
  $deadline = (Get-Date).AddSeconds(12)
  $h = [IntPtr]::Zero
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300
    try { $p.Refresh(); if ($p.HasExited) { break }; if ($p.MainWindowHandle -ne 0) { $h = $p.MainWindowHandle; break } } catch { break }
  }
  # Algunas apps (Bloc de notas en Windows 11) relanzan otro proceso: se espera a una ventana nueva en primer plano
  if ($h -ne [IntPtr]::Zero) { Focus-Handle $h }
  else { Start-Sleep -Milliseconds 800 }
  return @{ started = $target; foreground = (Foreground) }
}

# ---------------------------------------------------------------- bucle
$handlers = @{
  'ping' = { param($a) @{ pong = $true; screen = (Screen-Info) } }
  'screen' = { param($a) Screen-Info }
  'screenshot' = { param($a) Do-Screenshot $a }
  'foreground' = { param($a) Foreground }
  'owner_at' = { param($a)
    $h = [JcNative]::RootAt([int]$a.x, [int]$a.y)
    $procId = 0; [void][JcNative]::GetWindowThreadProcessId($h, [ref]$procId)
    $name = ''; try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }
    @{ pid = [int]$procId; class = [JcNative]::ClassOf($h); process = $name } }
  'cursor' = { param($a) $p = New-Object JcNative+POINT; [void][JcNative]::GetCursorPos([ref]$p); @{ x = $p.X; y = $p.Y } }
  'inspect' = { param($a) Do-Inspect $a }
  'click_element' = { param($a) Do-ClickElement $a }
  'set_text' = { param($a) Do-SetText $a }
  'move' = { param($a) Do-Move $a }
  'click' = { param($a) Do-Click $a }
  'drag' = { param($a) Do-Drag $a }
  'scroll' = { param($a) Do-Scroll $a }
  'type' = { param($a) Do-Type $a }
  'keys' = { param($a) Do-Keys $a }
  'windows' = { param($a) Do-Windows }
  'focus' = { param($a) Do-Focus $a }
  'open' = { param($a) Do-Open $a }
}

[Console]::Out.WriteLine((@{ id = 0; ok = $true; result = @{ ready = $true; screen = (Screen-Info) } } | ConvertTo-Json -Compress -Depth 4))
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if (-not $line.Trim()) { continue }
  $id = 0
  try {
    $msg = $line | ConvertFrom-Json
    $id = $msg.id
    $h = $handlers[[string]$msg.cmd]
    if (-not $h) { throw "orden desconocida: $($msg.cmd)" }
    $args0 = $msg.args; if (-not $args0) { $args0 = @{} }
    $res = & $h $args0
    $out = @{ id = $id; ok = $true; result = $res } | ConvertTo-Json -Compress -Depth 8
  } catch {
    $out = @{ id = $id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress -Depth 3
  }
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
}
