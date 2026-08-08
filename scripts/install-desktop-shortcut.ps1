#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Launcher = Join-Path $PSScriptRoot 'start-app.cmd'
$IconSourcePng = Join-Path $AppRoot 'public\desktop-icon.png'
$IconDir = Join-Path $PSScriptRoot '.generated'
$IconPath = Join-Path $IconDir 'app-icon.ico'
$ShortcutName = 'Web Cost App.lnk'

if (-not (Test-Path $Launcher)) {
    Write-Error "Launcher not found: $Launcher"
}

if (-not (Test-Path $IconSourcePng)) {
    Write-Error "Icon not found: $IconSourcePng"
}

function Get-DesktopPaths {
    $paths = @([Environment]::GetFolderPath('Desktop'))

    foreach ($candidate in @(
        (Join-Path $env:USERPROFILE 'Desktop')
        (Join-Path $env:USERPROFILE 'OneDrive\Desktop')
        (Join-Path $env:USERPROFILE 'OneDrive - Personal\Desktop')
    )) {
        if ($candidate -and (Test-Path $candidate)) {
            $paths += $candidate
        }
    }

    try {
        $regDesktop = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction Stop).Desktop
        if ($regDesktop) {
            $paths += $regDesktop
        }
    } catch {
        # ignore registry read issues
    }

    $paths | ForEach-Object { $_.TrimEnd('\') } | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
}

function Convert-PngToIco {
    param(
        [string]$PngPath,
        [string]$IcoPath
    )

    Add-Type -AssemblyName System.Drawing

    $source = [System.Drawing.Bitmap]::FromFile($PngPath)
    $bitmap = New-Object System.Drawing.Bitmap 256, 256
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($source, 0, 0, 256, 256)
    $graphics.Dispose()
    $source.Dispose()

    if (-not (Test-Path $IconDir)) {
        New-Item -ItemType Directory -Path $IconDir -Force | Out-Null
    }

    $handle = $bitmap.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($handle)
    $fileStream = [System.IO.File]::Create($IcoPath)
    $icon.Save($fileStream)
    $fileStream.Close()
    $icon.Dispose()
    $bitmap.Dispose()
}

function New-DesktopShortcut {
    param(
        [string]$ShortcutPath,
        [string]$IconLocation
    )

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $Launcher
    $shortcut.WorkingDirectory = $AppRoot
    $shortcut.WindowStyle = 1
    $shortcut.Description = 'نظام إدارة تكاليف الإنشاءات — local dev (Vite + SQLite API)'
    $shortcut.IconLocation = $IconLocation
    $shortcut.Save()
}

Convert-PngToIco -PngPath $IconSourcePng -IcoPath $IconPath

$created = @()
foreach ($desktop in Get-DesktopPaths) {
    $shortcutPath = Join-Path $desktop $ShortcutName
    try {
        New-DesktopShortcut -ShortcutPath $shortcutPath -IconLocation "$IconPath,0"
        $created += $shortcutPath
    } catch {
        Write-Warning "Skipped $shortcutPath - $($_.Exception.Message)"
    }
}

if ($created.Count -eq 0) {
    Write-Error 'No writable Desktop folder was found.'
}

Write-Host ''
Write-Host 'Desktop shortcut(s) created:'
foreach ($path in $created) {
    Write-Host "  $path"
}
Write-Host ''
Write-Host 'Double-click "Web Cost App" on your desktop to start the app.'

$primaryShortcut = $created[0]
if (Test-Path $primaryShortcut) {
    $explorerArg = '/select,"{0}"' -f $primaryShortcut
    Start-Process explorer.exe -ArgumentList $explorerArg
}
