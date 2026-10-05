Unicode true

####
## Please note: Template replacements don't work in this file. They are provided with default defines like
## mentioned underneath.
## If the keyword is not defined, "wails_tools.nsh" will populate them with the values from ProjectInfo.
## If they are defined here, "wails_tools.nsh" will not touch them. This allows to use this project.nsi manually
## from outside of Wails for debugging and development of the installer.
##
## For development first make a wails nsis build to populate the "wails_tools.nsh":
## > wails build --target windows/amd64 --nsis
## Then you can call makensis on this file with specifying the path to your binary:
## For a AMD64 only installer:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app.exe
## For a ARM64 only installer:
## > makensis -DARG_WAILS_ARM64_BINARY=..\..\bin\app.exe
## For a installer with both architectures:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app-amd64.exe -DARG_WAILS_ARM64_BINARY=..\..\bin\app-arm64.exe
####
## The following information is taken from the ProjectInfo file, but they can be overwritten here.
####
## !define INFO_PROJECTNAME    "MyProject" # Default "{{.Name}}"
## !define INFO_COMPANYNAME    "MyCompany" # Default "{{.Info.CompanyName}}"
## !define INFO_PRODUCTNAME    "MyProduct" # Default "{{.Info.ProductName}}"
## !define INFO_PRODUCTVERSION "1.0.0"     # Default "{{.Info.ProductVersion}}"
## !define INFO_COPYRIGHT      "Copyright" # Default "{{.Info.Copyright}}"
###
## !define PRODUCT_EXECUTABLE  "Application.exe"      # Default "${INFO_PROJECTNAME}.exe"
## !define UNINST_KEY_NAME     "UninstKeyInRegistry"  # Default "${INFO_COMPANYNAME}${INFO_PRODUCTNAME}"
####
## !define REQUEST_EXECUTION_LEVEL "admin"            # Default "admin"  see also https://nsis.sourceforge.io/Docs/Chapter4.html
####
## Include the wails tools
####
!include "wails_tools.nsh"

# Every installer that supports AMD64 must carry the complete checked engine.
# ARM64 installation remains a base edition and never receives the x64 runtime.
!ifdef SUPPORTS_AMD64
    !ifndef ARG_XAI_DLSS5_BUNDLE
        !define ARG_XAI_DLSS5_BUNDLE "$%XAI_DLSS5_BUNDLE%"
    !endif
    !if "${ARG_XAI_DLSS5_BUNDLE}" == ""
        !error "AMD64 installer requires ARG_XAI_DLSS5_BUNDLE or XAI_DLSS5_BUNDLE."
    !endif
    !system 'python "..\..\..\scripts\dlss5\bundle.py" verify "${ARG_XAI_DLSS5_BUNDLE}"' = 0
!endif

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
# !define MUI_WELCOMEFINISHPAGE_BITMAP "resources\leftimage.bmp" #Include this to add a bitmap on the left side of the Welcome Page. Must be a size of 164x314
!define MUI_FINISHPAGE_NOAUTOCLOSE # Wait on the INSTFILES page so the user can take a look into the details of the installation steps
!define MUI_ABORTWARNING # This will warn the user if they exit from the installer.

!insertmacro MUI_PAGE_WELCOME # Welcome to the installer page.
# !insertmacro MUI_PAGE_LICENSE "resources\eula.txt" # Adds a EULA page to the installer
!insertmacro MUI_PAGE_DIRECTORY # In which folder install page.
!insertmacro MUI_PAGE_INSTFILES # Installing page.
!insertmacro MUI_PAGE_FINISH # Finished installation page.

!insertmacro MUI_UNPAGE_INSTFILES # Uinstalling page

!insertmacro MUI_LANGUAGE "English" # Set the Language of the installer

## The following two statements can be used to sign the installer and the uninstaller. The path to the binaries are provided in %1
#!uninstfinalize 'signtool --file "%1"'
#!finalize 'signtool --file "%1"'

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe" # Name of the installer's file.
InstallDir "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}" # Default installing folder ($PROGRAMFILES is Program Files folder).
ShowInstDetails show # This will always show the installation details.

Function .onInit
   !insertmacro wails.checkArchitecture
FunctionEnd

!ifdef SUPPORTS_AMD64
Var XaiInstallStage
Var XaiOldAppMoved
Var XaiOldEngineMoved
Var XaiNewEngineMoved
Var XaiRollbackFailed
Var XaiInstallFailure
Var XaiAppGuard
Var XaiWorkerGuard
Var XaiHostGuard
Var XaiModelGuard
Var XaiFFmpegGuard
Var XaiFFprobeGuard
Var XaiGuidanceGuard

# Hold write-capable handles until commit/rollback. Active image mappings deny
# GENERIC_WRITE; denying read/write sharing also prevents a new process launch.
# FILE_SHARE_DELETE permits our same-volume Rename while the guards stay open.
!macro xai.guardExistingFile PATH HANDLE
    ${If} ${FileExists} "${PATH}"
        System::Call 'kernel32::CreateFileW(w "${PATH}", i 0xC0000000, i 4, p 0, i 3, i 0x80, p 0) p .s'
        Pop ${HANDLE}
        ${If} ${HANDLE} == -1
            StrCpy $XaiInstallFailure "Cannot reserve ${PATH}. Close Image Studio and its DLSS5 workers, and check installation permissions before retrying."
            Goto xai_prepare_failed
        ${EndIf}
    ${EndIf}
!macroend

!macro xai.closeGuard HANDLE
    ${If} ${HANDLE} != -1
        System::Call 'kernel32::CloseHandle(p ${HANDLE})'
        StrCpy ${HANDLE} -1
    ${EndIf}
!macroend

Function xai.closeUpgradeGuards
    !insertmacro xai.closeGuard $XaiAppGuard
    !insertmacro xai.closeGuard $XaiWorkerGuard
    !insertmacro xai.closeGuard $XaiHostGuard
    !insertmacro xai.closeGuard $XaiModelGuard
    !insertmacro xai.closeGuard $XaiFFmpegGuard
    !insertmacro xai.closeGuard $XaiFFprobeGuard
    !insertmacro xai.closeGuard $XaiGuidanceGuard
FunctionEnd

Function xai.installAmd64Transaction
    StrCpy $XaiInstallStage ""
    StrCpy $XaiOldAppMoved 0
    StrCpy $XaiOldEngineMoved 0
    StrCpy $XaiNewEngineMoved 0
    StrCpy $XaiRollbackFailed 0
    StrCpy $XaiAppGuard -1
    StrCpy $XaiWorkerGuard -1
    StrCpy $XaiHostGuard -1
    StrCpy $XaiModelGuard -1
    StrCpy $XaiFFmpegGuard -1
    StrCpy $XaiFFprobeGuard -1
    StrCpy $XaiGuidanceGuard -1
    StrCpy $XaiInstallFailure "Unable to prepare the complete new installation. The previous installation has not been replaced."

    # Stage and backup share the installation volume and stay outside the
    # manifest-checked dlss5 root. Nothing is written over the old app yet.
    ClearErrors
    CreateDirectory "$INSTDIR"
    IfErrors xai_prepare_failed
    GetTempFileName $XaiInstallStage "$INSTDIR"
    IfErrors xai_prepare_failed
    Delete "$XaiInstallStage"
    IfErrors xai_prepare_failed
    CreateDirectory "$XaiInstallStage\old"
    IfErrors xai_prepare_failed
    SetOutPath "$XaiInstallStage\new-app"
    IfErrors xai_prepare_failed
    File "/oname=${PRODUCT_EXECUTABLE}" "${ARG_WAILS_AMD64_BINARY}"
    IfErrors xai_prepare_failed
    SetOutPath "$XaiInstallStage\new-engine"
    IfErrors xai_prepare_failed
    File /r "${ARG_XAI_DLSS5_BUNDLE}\*"
    IfErrors xai_prepare_failed
    SetOutPath "$INSTDIR"
    IfFileExists "$XaiInstallStage\new-app\${PRODUCT_EXECUTABLE}" 0 xai_prepare_failed
    IfFileExists "$XaiInstallStage\new-engine\manifest.json" 0 xai_prepare_failed

    !insertmacro xai.guardExistingFile "$INSTDIR\${PRODUCT_EXECUTABLE}" $XaiAppGuard
    !insertmacro xai.guardExistingFile "$INSTDIR\runtimes\dlss5\worker\xai-video-engine.exe" $XaiWorkerGuard
    !insertmacro xai.guardExistingFile "$INSTDIR\runtimes\dlss5\runtime\dlssnr_host_v2.dll" $XaiHostGuard
    !insertmacro xai.guardExistingFile "$INSTDIR\runtimes\dlss5\runtime\nvngx_dlssnr.dll" $XaiModelGuard
    !insertmacro xai.guardExistingFile "$INSTDIR\runtimes\dlss5\runtime\ffmpeg.exe" $XaiFFmpegGuard
    !insertmacro xai.guardExistingFile "$INSTDIR\runtimes\dlss5\runtime\ffprobe.exe" $XaiFFprobeGuard
    !insertmacro xai.guardExistingFile "$INSTDIR\runtimes\dlss5\runtime\mods\enhancement\guidance_worker.exe" $XaiGuidanceGuard

    StrCpy $XaiInstallFailure "Unable to switch to the prepared installation."
    ClearErrors
    CreateDirectory "$INSTDIR\runtimes"
    IfErrors xai_prepare_failed
    IfFileExists "$INSTDIR\${PRODUCT_EXECUTABLE}" 0 xai_backup_engine
    ClearErrors
    Rename "$INSTDIR\${PRODUCT_EXECUTABLE}" "$XaiInstallStage\old\${PRODUCT_EXECUTABLE}"
    IfErrors xai_rollback
    StrCpy $XaiOldAppMoved 1

    xai_backup_engine:
    IfFileExists "$INSTDIR\runtimes\dlss5\*.*" 0 xai_activate_engine
    ClearErrors
    Rename "$INSTDIR\runtimes\dlss5" "$XaiInstallStage\old\dlss5"
    IfErrors xai_rollback
    StrCpy $XaiOldEngineMoved 1

    xai_activate_engine:
    ClearErrors
    Rename "$XaiInstallStage\new-engine" "$INSTDIR\runtimes\dlss5"
    IfErrors xai_rollback
    StrCpy $XaiNewEngineMoved 1
    ClearErrors
    Rename "$XaiInstallStage\new-app\${PRODUCT_EXECUTABLE}" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    IfErrors xai_rollback

    # Both switches succeeded. Cleanup targets only the unique backup/staging
    # directory; a cleanup failure never removes the new active installation.
    Call xai.closeUpgradeGuards
    ClearErrors
    RMDir /r "$XaiInstallStage"
    ${If} ${Errors}
        DetailPrint "Installation succeeded; previous-version files remain at $XaiInstallStage."
    ${EndIf}
    Return

    xai_rollback:
    ${If} $XaiNewEngineMoved == 1
        ClearErrors
        Rename "$INSTDIR\runtimes\dlss5" "$XaiInstallStage\new-engine"
        ${If} ${Errors}
            StrCpy $XaiRollbackFailed 1
        ${EndIf}
    ${EndIf}
    ${If} $XaiOldEngineMoved == 1
        ClearErrors
        Rename "$XaiInstallStage\old\dlss5" "$INSTDIR\runtimes\dlss5"
        ${If} ${Errors}
            StrCpy $XaiRollbackFailed 1
        ${EndIf}
    ${EndIf}
    # Restore the old entry point only after its runtime has been restored;
    # otherwise keep it in backup rather than expose a mixed-version pair.
    ${If} $XaiOldAppMoved == 1
    ${AndIf} $XaiRollbackFailed == 0
        ClearErrors
        Rename "$XaiInstallStage\old\${PRODUCT_EXECUTABLE}" "$INSTDIR\${PRODUCT_EXECUTABLE}"
        ${If} ${Errors}
            StrCpy $XaiRollbackFailed 1
        ${EndIf}
    ${EndIf}
    ${If} $XaiRollbackFailed == 1
        Call xai.closeUpgradeGuards
        DetailPrint "Rollback incomplete. Keep all recovery files at $XaiInstallStage."
        MessageBox MB_OK|MB_ICONSTOP "Upgrade could not be completed or fully restored. Keep $XaiInstallStage, including its old directory, for recovery. No backup files have been deleted." /SD IDOK
        SetErrorLevel 1
        Abort
    ${EndIf}
    StrCpy $XaiInstallFailure "Upgrade could not be completed. The previous installation has been restored. Close Image Studio and its workers before retrying."

    xai_prepare_failed:
    SetOutPath "$INSTDIR"
    Call xai.closeUpgradeGuards
    # No old files remain in staging after successful rollback. Never take
    # this cleanup path when restoration was incomplete.
    ${If} $XaiInstallStage != ""
        RMDir /r "$XaiInstallStage"
    ${EndIf}
    DetailPrint "$XaiInstallFailure"
    MessageBox MB_OK|MB_ICONSTOP "$XaiInstallFailure" /SD IDOK
    SetErrorLevel 1
    Abort
FunctionEnd
!endif

Section
    !insertmacro wails.setShellContext

    !insertmacro wails.webview2runtime

    !ifdef SUPPORTS_AMD64
        ${If} ${IsNativeAMD64}
            Call xai.installAmd64Transaction
        ${Else}
            SetOutPath $INSTDIR
            !insertmacro wails.files
        ${EndIf}
    !else
        SetOutPath $INSTDIR
        !insertmacro wails.files
    !endif

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro wails.associateFiles
    # Quote the exe path explicitly so protocol launch still works under Program Files.
    !insertmacro CUSTOM_PROTOCOL_ASSOCIATE "image-studio" "Image-Prompts import" "$INSTDIR\${PRODUCT_EXECUTABLE},0" "$\"$INSTDIR\${PRODUCT_EXECUTABLE}$\" $\"%1$\""

    !insertmacro wails.writeUninstaller
SectionEnd

Section "uninstall"
    !insertmacro wails.setShellContext

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # Remove the WebView2 DataPath

    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller
SectionEnd
