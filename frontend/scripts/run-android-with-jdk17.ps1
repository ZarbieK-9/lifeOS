# Build Android app with JDK 17 (required for Gradle 8.x; Java 25 is not supported).
# Install JDK 17 first: https://adoptium.net/temurin/releases/?version=17&os=windows&arch=x64
# Or run in an elevated PowerShell: choco install temurin17 -y

$jdk17Paths = @(
    "C:\Program Files\Eclipse Adoptium\jdk-17*",
    "C:\Program Files\Microsoft\jdk-17*",
    "C:\Program Files\Java\jdk-17*",
    "C:\Program Files\BellSoft\LibericaJDK-17*"
)

$jdk17 = $null
foreach ($pattern in $jdk17Paths) {
    $found = Get-Item $pattern -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($found) {
        $jdk17 = $found.FullName
        break
    }
}

if (-not $jdk17) {
    Write-Host "JDK 17 not found. Install it first:" -ForegroundColor Yellow
    Write-Host "  1. Download: https://adoptium.net/temurin/releases/?version=17&os=windows&arch=x64" -ForegroundColor Cyan
    Write-Host "  2. Or run PowerShell as Administrator: choco install temurin17 -y" -ForegroundColor Cyan
    exit 1
}

$env:JAVA_HOME = $jdk17
Write-Host "Using JAVA_HOME=$env:JAVA_HOME" -ForegroundColor Green
& "$env:JAVA_HOME\bin\java.exe" -version

$frontendRoot = Split-Path $PSScriptRoot -Parent
Set-Location $frontendRoot
npx expo run:android
