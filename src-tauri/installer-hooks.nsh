; WorkPlan custom uninstall prompt.
; The application database lives outside the install directory, so the NSIS
; uninstaller must ask before deleting it.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode = 1
    Goto workplan_keep_local_data
  ${EndIf}
  IfSilent workplan_keep_local_data
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时清除 WorkPlan 的本地数据？$\r$\n$\r$\n选择“是”将删除：$PROFILE\.workplan（任务、笔记、密码库、数据库备份）。$\r$\n选择“否”将保留数据，方便以后重新安装或回退旧版本。" IDNO workplan_keep_local_data
  RMDir /r "$PROFILE\.workplan"
  workplan_keep_local_data:
!macroend
