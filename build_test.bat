@echo off
echo Building WPF Overlay...
cd DiscordCaptionOverlay
dotnet clean
dotnet build
if %ERRORLEVEL% == 0 (
    echo Build successful!
    echo Starting overlay...
    dotnet run
) else (
    echo Build failed with errors.
    pause
)
