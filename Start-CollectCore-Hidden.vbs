Set oShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Stop any running instances (kill full process tree to handle uvicorn --reload parent/child)
oShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr :8001 ^| findstr LISTENING') do taskkill /F /T /PID %a", 0, True
oShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr :5181 ^| findstr LISTENING') do taskkill /F /T /PID %a", 0, True
WScript.Sleep 2000

' Start backend and frontend hidden
oShell.Run "cmd /c cd /d F:\Dropbox\Apps\CollectCore\backend && .\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8001", 0, False
WScript.Sleep 1000
oShell.Run "cmd /c cd /d F:\Dropbox\Apps\CollectCore\frontend && npm run dev -- --port 5181", 0, False
WScript.Sleep 7000

' Open app in browser
appUrl = "http://localhost:5181"
edgePath1 = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
edgePath2 = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
chromePath1 = "C:\Program Files\Google\Chrome\Application\chrome.exe"
chromePath2 = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

If FSO.FileExists(edgePath1) Then
    oShell.Run Chr(34) & edgePath1 & Chr(34) & " --app=" & appUrl, 1, False
ElseIf FSO.FileExists(edgePath2) Then
    oShell.Run Chr(34) & edgePath2 & Chr(34) & " --app=" & appUrl, 1, False
ElseIf FSO.FileExists(chromePath1) Then
    oShell.Run Chr(34) & chromePath1 & Chr(34) & " --app=" & appUrl, 1, False
ElseIf FSO.FileExists(chromePath2) Then
    oShell.Run Chr(34) & chromePath2 & Chr(34) & " --app=" & appUrl, 1, False
Else
    oShell.Run appUrl, 1, False
End If
