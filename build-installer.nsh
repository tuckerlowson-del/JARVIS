!include MUI2.nsh
!define MUI_ICON "assets\\jarvis-icon.ico"
!define MUI_UNICON "assets\\jarvis-icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to JARVIS"
!define MUI_WELCOMEPAGE_TEXT "Install the lightweight JARVIS Personal AI System.\r\n\r\nOptional AI providers and router integrations remain under your control."
!define MUI_FINISHPAGE_RUN "$INSTDIR\\JARVIS.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch JARVIS"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"
Section
SectionEnd
