!macro customInstall
  ; JARVIS LAN control server
  ; The installer runs elevated, so create the inbound rule without disabling Windows Firewall.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="JARVIS Personal Assistant - LAN"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="JARVIS Personal Assistant - LAN" dir=in action=allow protocol=TCP localport=47821 profile=private'
!macroend

!macro customUnInstall
  ; Keep this narrow: remove only the rule created by JARVIS.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="JARVIS Personal Assistant - LAN"'
!macroend
