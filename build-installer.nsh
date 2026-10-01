!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="JARVIS Personal Assistant - LAN"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="JARVIS Personal Assistant - LAN" dir=in action=allow protocol=TCP localport=47821 profile=private'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="JARVIS Personal Assistant - LAN"'
!macroend
