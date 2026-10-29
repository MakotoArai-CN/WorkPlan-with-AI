; WorkPlan custom uninstall prompt.
; The application database lives outside the install directory, so the NSIS
; uninstaller must ask before deleting it.
!macro NSIS_HOOK_POSTUNINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时清除 WorkPlan 的本地数据？$\r$\n$\r$\n选择“是”将删除：$PROFILE\.workplan（任务、笔记、密码库、数据库备份）。$\r$\n选择“否”将保留数据，方便以后重新安装或回退旧版本。" IDNO +2
  RMDir /r "$PROFILE\.workplan"
!macroend
