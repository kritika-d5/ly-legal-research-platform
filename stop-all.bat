@echo off
rem Stops whatever holds the three service ports (8000, 8080, 5173), including
rem copies started outside start-all.bat, plus the watcher (tsx / uvicorn
rem --reload) that launched each one, so it cannot start the server again.
powershell -NoProfile -Command ^
  "Get-NetTCPConnection -State Listen -LocalPort 8000,8080,5173 -ErrorAction SilentlyContinue |" ^
  "ForEach-Object {" ^
  "  $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess);" ^
  "  Write-Host ('Stopping port ' + $_.LocalPort + ' (PID ' + $_.OwningProcess + ')');" ^
  "  if ($p -and $p.ParentProcessId) { $parent = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p.ParentProcessId);" ^
  "    if ($parent -and $parent.Name -in 'node.exe','python.exe') { Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue } }" ^
  "  Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
rem The windows opened by start-all.bat.
taskkill /FI "WINDOWTITLE eq LY - *" /T /F >nul 2>&1
echo Done.
timeout /t 3 >nul
