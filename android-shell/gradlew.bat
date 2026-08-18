@ECHO OFF
SETLOCAL ENABLEDELAYEDEXPANSION

SET APP_HOME=%~dp0
SET WRAPPER_DIR=%APP_HOME%\.gradle-wrapper
SET GRADLE_VERSION=8.7
SET DIST_NAME=gradle-%GRADLE_VERSION%-bin.zip
SET DIST_URL=https://services.gradle.org/distributions/%DIST_NAME%
SET DIST_ZIP=%WRAPPER_DIR%\%DIST_NAME%
SET DIST_HOME=%WRAPPER_DIR%\gradle-%GRADLE_VERSION%
SET GRADLE_BIN=%DIST_HOME%\bin\gradle.bat

IF NOT EXIST "%WRAPPER_DIR%" MKDIR "%WRAPPER_DIR%"

IF NOT EXIST "%GRADLE_BIN%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%DIST_URL%' -OutFile '%DIST_ZIP%'"
  IF ERRORLEVEL 1 EXIT /B 1
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%DIST_ZIP%' -DestinationPath '%WRAPPER_DIR%' -Force"
  IF ERRORLEVEL 1 EXIT /B 1
)

CALL "%GRADLE_BIN%" -p "%APP_HOME%" %*
