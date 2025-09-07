@echo off
echo 🧪 AI Discord Live Translator - Simple Integration Test
echo ======================================================
echo.

echo 1️⃣ Checking file structure...
if exist "index.js" (
    echo ✅ Backend main file found
) else (
    echo ❌ index.js not found
    goto :error
)

if exist "DiscordCaptionOverlay\MainWindow.xaml.cs" (
    echo ✅ Frontend main file found
) else (
    echo ❌ MainWindow.xaml.cs not found
    goto :error
)

if exist "package.json" (
    echo ✅ Package.json found
) else (
    echo ❌ package.json not found
    goto :error
)

echo.
echo 2️⃣ Testing backend syntax...
node -c index.js
if %errorlevel% equ 0 (
    echo ✅ Backend syntax is valid
) else (
    echo ❌ Backend has syntax errors
    goto :error
)

echo.
echo 3️⃣ Testing frontend compilation...
cd DiscordCaptionOverlay
dotnet build --verbosity quiet
if %errorlevel% equ 0 (
    echo ✅ Frontend compiles successfully
) else (
    echo ❌ Frontend compilation failed
    cd ..
    goto :error
)
cd ..

echo.
echo 4️⃣ Checking configuration...
if exist ".env" (
    echo ✅ .env file found
) else (
    echo ⚠️ .env file not found (will use defaults)
)

if exist "DiscordCaptionOverlay\config.json" (
    echo ✅ Frontend config.json found
) else (
    echo ⚠️ Frontend config.json not found (will use defaults)
)

echo.
echo ✅ ALL TESTS PASSED!
echo.
echo 🚀 Ready to start integration testing:
echo 1. Start backend: npm start
echo 2. Start frontend: cd DiscordCaptionOverlay ^&^& dotnet run
echo 3. Check connection indicator in overlay header
echo.
echo 📞 Expected WebSocket flow:
echo   Backend starts on port 7071
echo   Frontend connects automatically
echo   Green circle = connected, Red = disconnected
echo.
goto :end

:error
echo.
echo ❌ TESTS FAILED - Please check the errors above
echo.

:end
pause
