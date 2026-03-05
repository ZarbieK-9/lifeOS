# Run this script in PowerShell AS ADMINISTRATOR to install JDK 17 and fix Chocolatey lock errors.
# Right-click PowerShell -> "Run as administrator", then:
#   cd D:\projects\LifeOS\frontend\scripts
#   .\install-jdk17-choco.ps1

# Remove stale Chocolatey lock / failed Temurin17 install
$chocoLib = "C:\ProgramData\chocolatey\lib"
$lockPath = Join-Path $chocoLib "b15f6a0b4887f5441348471dad20e30534334204"
$temurinPath = Join-Path $chocoLib "Temurin17"

if (Test-Path $lockPath) {
    Remove-Item -Recurse -Force $lockPath
    Write-Host "Removed lock folder: $lockPath" -ForegroundColor Green
}
if (Test-Path $temurinPath) {
    Remove-Item -Recurse -Force $temurinPath
    Write-Host "Removed partial Temurin17 folder: $temurinPath" -ForegroundColor Green
}

# Uninstall so we can reinstall (fixes "already installed" when JDK wasn't actually installed)
Write-Host "Uninstalling Temurin17 (so we can reinstall)..." -ForegroundColor Cyan
choco uninstall temurin17 -y 2>$null

# Install JDK 17
Write-Host "Installing Temurin 17..." -ForegroundColor Cyan
choco install temurin17 -y

if ($LASTEXITCODE -eq 0) {
    Write-Host "JDK 17 installed. You can now run: npm run android:jdk17" -ForegroundColor Green
} else {
    Write-Host "Install failed. Try manual download: https://adoptium.net/temurin/releases/?version=17&os=windows&arch=x64" -ForegroundColor Yellow
}
