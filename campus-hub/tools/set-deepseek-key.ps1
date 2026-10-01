$ErrorActionPreference = 'Stop'
$keyDirectory = Join-Path $env:LOCALAPPDATA 'CampusHub'
New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
$secureKey = Read-Host 'DeepSeek API key' -AsSecureString
$secureKey | ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $keyDirectory 'deepseek.dpapi') -Encoding ASCII
Write-Output '密钥已使用 Windows 当前用户加密，保存于仓库外。'
