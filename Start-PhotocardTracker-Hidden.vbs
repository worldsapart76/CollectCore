Set WshShell = CreateObject("WScript.Shell")

' Start backend (hidden)
WshShell.Run Chr(34) & "F:\Dropbox\Apps\CollectCore\Start-CollectCore-Hidden-Backend.bat" & Chr(34), 0, False

WScript.Sleep 1500

' Start frontend (hidden)
WshShell.Run Chr(34) & "F:\Dropbox\Apps\CollectCore\Start-CollectCore-Hidden-Frontend.bat" & Chr(34), 0, False

' Wait for Vite to come online
WScript.Sleep 5000

' Launch as app window (Chrome)
WshShell.Run """C:\Program Files\Google\Chrome\Application\chrome.exe"" --app=http://localhost:5173", 1, False