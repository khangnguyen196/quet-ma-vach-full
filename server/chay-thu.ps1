# Chạy thử máy chủ OCR trên máy tính: CHỈ 127.0.0.1:8765 (không mở ra mạng ngoài, không 0.0.0.0).
#   powershell -ExecutionPolicy Bypass -File server\chay-thu.ps1 [-Venv D:\tmp\may-chu-1\venv] [-Threads 8]
# Tắt: Ctrl+C trong cửa sổ này. File lưu UTF-8 có BOM để PowerShell 5.1 đọc đúng chữ Việt.
param(
  [string]$Venv = "D:\tmp\may-chu-1\venv",
  [int]$Threads = 8,
  [int]$Port = 8765
)
$ErrorActionPreference = "Stop"

# Mọi cache / file tạm ở ổ D (ổ C gần đầy)
$root = "D:\tmp\may-chu-1"
foreach ($d in @("$root\tmp", "$root\pip-cache", "$root\hf", "$root\ms")) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null }
}
$env:TEMP = "$root\tmp"
$env:TMP = "$root\tmp"
$env:PIP_CACHE_DIR = "$root\pip-cache"
$env:HF_HOME = "$root\hf"
$env:MODELSCOPE_CACHE = "$root\ms"
$env:PYTHONDONTWRITEBYTECODE = "1"
$env:PYTHONUTF8 = "1"

# Cấu hình máy chủ (mặc định ở server/.env.example); chạy thử thì cho thêm localhost vào CORS
$env:OCR_THREADS = "$Threads"
$env:CORS_ALLOW_LOCALHOST = "1"
if (-not $env:AUTH_MODE) { $env:AUTH_MODE = "off" }

$py = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path $py)) {
  Write-Error "Không thấy $py. Tạo venv trước (server/README.md, mục Cài)."
  exit 1
}
Set-Location $PSScriptRoot
Write-Host "Máy chủ OCR: http://127.0.0.1:$Port (OCR_THREADS=$Threads). Ctrl+C để tắt."
# --no-proxy-headers: uvicorn KHÔNG tự thay IP bằng X-Forwarded-For (mặc định nó tin 127.0.0.1) -> TRUST_PROXY của app là công tắc duy nhất
# --limit-concurrency 16: quá 16 kết nối / yêu cầu cùng lúc thì uvicorn tự trả 503 (dạng chữ, không CORS)
& $py -m uvicorn app:app --host 127.0.0.1 --port $Port --workers 1 --no-access-log --no-proxy-headers --limit-concurrency 16
exit $LASTEXITCODE
