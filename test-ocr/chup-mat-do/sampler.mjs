// Lấy mẫu bộ nhớ cả cây tiến trình trình duyệt (chép từ web-ocr/run-browser.mjs startSampler, cùng cách đo vòng 1),
// dùng chung cho do-trinh-duyet.mjs (cách 2) và do-cach3.mjs (cách 3). Working set (WS) đo bằng PowerShell mỗi 250 ms.
import { spawn } from "node:child_process";

export function startSampler(rootPid, onSample) {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$root = ${Number(rootPid)}
$ids = @($root); $lastTree = [DateTime]::MinValue
while ($true) {
  if (((Get-Date) - $lastTree).TotalMilliseconds -ge 2000) {
    $all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId
    $kids = @{}
    foreach ($p in $all) { $pp = [int]$p.ParentProcessId; if (-not $kids.ContainsKey($pp)) { $kids[$pp] = New-Object System.Collections.ArrayList }; [void]$kids[$pp].Add([int]$p.ProcessId) }
    $ids = New-Object System.Collections.ArrayList; $queue = New-Object System.Collections.Queue; $queue.Enqueue($root)
    while ($queue.Count -gt 0) { $id = $queue.Dequeue(); if ($ids.Contains($id)) { continue }; [void]$ids.Add($id); if ($kids.ContainsKey($id)) { foreach ($c in $kids[$id]) { $queue.Enqueue($c) } } }
    $lastTree = Get-Date
  }
  $total = 0; $n = 0
  foreach ($id in $ids) { try { $p = [System.Diagnostics.Process]::GetProcessById($id); $total += $p.WorkingSet64; $n++ } catch {} }
  if ($n -eq 0) { break }
  [Console]::Out.WriteLine("$total")
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 250
}`;
  const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  ps.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onSample(Number(line));
    }
  });
  return ps;
}
