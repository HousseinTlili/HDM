; HDM NSIS installer hooks (included by Tauri's NSIS template).
; Registers the browser native messaging host and the magnet: link handler for the
; current user, and removes them again on uninstall.

!macro HDM_STOP_HOST
  DetailPrint "Stopping the browser helper..."
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM prism-native-host.exe'
  Sleep 300
  Delete "$INSTDIR\prism-native-host.old*.exe"
!macroend

!macro HDM_FREE_HOST_FILE
  ClearErrors
  Delete "$INSTDIR\prism-native-host.exe"
  ${If} ${Errors}
    StrCpy $R9 0
    ${Do}
      IntOp $R9 $R9 + 1
    ${LoopWhile} ${FileExists} "$INSTDIR\prism-native-host.old$R9.exe"
    DetailPrint "The browser helper is in use; moving it aside."
    Rename "$INSTDIR\prism-native-host.exe" "$INSTDIR\prism-native-host.old$R9.exe"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro HDM_STOP_HOST
  !insertmacro HDM_FREE_HOST_FILE
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering browser integration..."
  nsExec::ExecToLog '"$INSTDIR\prism-native-host.exe" register'
  WriteRegStr HKCU "Software\Classes\magnet" "" "URL:Magnet link"
  WriteRegStr HKCU "Software\Classes\magnet" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\magnet\DefaultIcon" "" "$INSTDIR\hdm.exe,0"
  WriteRegStr HKCU "Software\Classes\magnet\shell\open\command" "" '"$INSTDIR\hdm.exe" "%1"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing browser integration..."
  nsExec::ExecToLog '"$INSTDIR\prism-native-host.exe" unregister'
  !insertmacro HDM_STOP_HOST
  ; Only remove the magnet handler if it still points at this installation.
  ReadRegStr $0 HKCU "Software\Classes\magnet\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\hdm.exe" "%1"' 0 +2
    DeleteRegKey HKCU "Software\Classes\magnet"
!macroend
