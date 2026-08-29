@echo off
REM One-click build of the signed release APK.
REM Steps: build web -> cap sync -> gradlew assembleRelease
cd /d "%~dp0"

echo [1/3] npm run build ...
call npm run build
if errorlevel 1 goto :fail

echo [2/3] npx cap sync android ...
call npx cap sync android
if errorlevel 1 goto :fail

echo [3/3] gradlew assembleRelease ...
cd android
call gradlew.bat assembleRelease --no-daemon
cd ..
if errorlevel 1 goto :fail

echo.
echo DONE. Signed APK: android\app\build\outputs\apk\release\app-release.apk
pause
exit /b 0

:fail
echo BUILD FAILED.
pause
exit /b 1
