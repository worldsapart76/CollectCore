Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

backendBat = "F:\Dropbox\Apps\CollectCore\Start-CollectCore-Hidden-Backend.bat"
frontendBat = "F:\Dropbox\Apps\CollectCore\Start-CollectCore-Hidden-Frontend.bat"

WshShell.Run Chr(34) & backendBat & Chr(34), 0, False
WScript.Sleep 2500
WshShell.Run Chr(34) & frontendBat & Chr(34), 0, False
WScript.Sleep 7000

edgePath1 = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
edgePath2 = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
chromePath1 = "C:\Program Files\Google\Chrome\Application\chrome.exe"
chromePath2 = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

appUrl = "http://localhost:5181"

If FSO.FileExists(edgePath1) Then
    WshShell.Run Chr(34) & edgePath1 & Chr(34) & " --app=" & appUrl, 1, False
ElseIf FSO.FileExists(edgePath2) Then
    WshShell.Run Chr(34) & edgePath2 & Chr(34) & " --app=" & appUrl, 1, False
ElseIf FSO.FileExists(chromePath1) Then
    WshShell.Run Chr(34) & chromePath1 & Chr(34) & " --app=" & appUrl, 1, False
ElseIf FSO.FileExists(chromePath2) Then
    WshShell.Run Chr(34) & chromePath2 & Chr(34) & " --app=" & appUrl, 1, False
Else
    WshShell.Run appUrl, 1, False
End If