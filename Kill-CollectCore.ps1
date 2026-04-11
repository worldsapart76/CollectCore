# Clean up Dropbox-generated temp files
Get-ChildItem -Path $PSScriptRoot -Recurse -File |
    Where-Object { $_.Name -match '\.tmp(\.\d+)+$' } |
    Remove-Item -Force -ErrorAction SilentlyContinue

# Kill all uvicorn processes for CollectCore (reloaders AND spawned workers)
$allPython = Get-WmiObject Win32_Process -Filter "Name = 'python.exe'"

# Kill uvicorn reloader processes
$reloaders = $allPython | Where-Object { $_.CommandLine -like "*uvicorn*main:app*--port 8001*" }
foreach ($proc in $reloaders) {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

# Kill spawned worker processes whose parent was a uvicorn reloader
$reloaderPids = $reloaders | Select-Object -ExpandProperty ProcessId
$workers = $allPython | Where-Object {
    $_.CommandLine -like "*multiprocessing.spawn*" -and
    ($_.CommandLine -match "parent_pid=(\d+)" -and $reloaderPids -contains [int]$Matches[1])
}
foreach ($proc in $workers) {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

# Also kill frontend (port 5181)
$frontendPids = (Get-NetTCPConnection -LocalPort 5181 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique
foreach ($p in $frontendPids) {
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}
