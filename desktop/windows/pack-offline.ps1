# 轻聊 · Windows 客户端 —— 断网打包脚本
#
# 有网络的机器请直接用任务书第 4.5 节的做法：
#     npm install && npm run dist
# 产物同样是 dist\qingliao-win.exe（单文件免安装）。
#
# 这个脚本是没网时的等价路径：拿本机已装的 Electron 运行时离线组装，
# 再用系统自带的 .NET Framework 4.x 编译器 (csc, Win10/11 自带) 编一个自解压启动器，
# 把运行时压成 ZIP 追加在启动器后面，得到同一个单文件 exe。
#
# 用法：
#     .\pack-offline.ps1
#     .\pack-offline.ps1 -ElectronDir "C:\path\to\electron" -Out "D:\dist\qingliao-win.exe"

param(
  # 本机 Electron 运行时目录（要含 resources.pak / icudtl.dat / locales / 一个 exe）
  [string]$ElectronDir = "",
  [string]$Out = (Join-Path $PSScriptRoot "dist\qingliao-win.exe"),
  [string]$Work = (Join-Path $env:TEMP "qingliao-win-pack")
)

$ErrorActionPreference = "Stop"
$src = $PSScriptRoot

function Find-Electron {
  foreach ($c in @(
    (Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness"),
    (Join-Path $env:LOCALAPPDATA "Programs\electron"),
    (Join-Path $env:LOCALAPPDATA "electron")
  )) {
    if (Test-Path (Join-Path $c "resources.pak")) { return $c }
  }
  return ""
}

if (-not $ElectronDir) { $ElectronDir = Find-Electron }
if (-not $ElectronDir -or -not (Test-Path (Join-Path $ElectronDir "resources.pak"))) {
  throw "找不到 Electron 运行时。请用 -ElectronDir 指定一个完整的 Electron 发行目录。"
}

"Electron 运行时：$ElectronDir"
if (Test-Path (Join-Path $ElectronDir "version")) {
  "运行时版本：$(Get-Content (Join-Path $ElectronDir 'version') -Raw)".Trim()
}

# ---------- 1. 组装免安装目录 ----------
$appDir = Join-Path $Work "app"
if (Test-Path $Work) { Remove-Item $Work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $appDir | Out-Null

# 运行时文件：排掉安装器、DSH 自己的 resources（换成我们的）、7-Zip 安装器许可证
$skip = @("Uninstall*", "resources", "elevate.exe", "7zip-*")
Get-ChildItem $ElectronDir -File -Force | Where-Object {
  $n = $_.Name
  -not ($skip | Where-Object { $n -like $_ })
} | ForEach-Object { Copy-Item $_.FullName (Join-Path $appDir $_.Name) }
Copy-Item (Join-Path $ElectronDir "locales") (Join-Path $appDir "locales") -Recurse

# 运行时自带的主程序改名成 轻聊.exe（原 exe 是体积最大的那个）
$runtimeExe = Get-ChildItem $appDir -Filter *.exe | Sort-Object Length -Descending | Select-Object -First 1
if (-not $runtimeExe) { throw "运行时目录里没有 exe" }
Move-Item $runtimeExe.FullName (Join-Path $appDir "轻聊.exe")

# ---------- 2. 应用本体：resources\app\ ----------
# 只有 main.js + icon；网页全部来自服务器，绝不打包前端
$inner = Join-Path $appDir "resources\app"
New-Item -ItemType Directory -Force -Path (Join-Path $inner "build") | Out-Null
Copy-Item (Join-Path $src "main.js") (Join-Path $inner "main.js")
Copy-Item (Join-Path $src "build\icon.ico") (Join-Path $inner "build\icon.ico")

# productName 决定 %APPDATA% 下的目录名（轻聊），config.json 就落在那里
$appPkg = [ordered]@{
  name        = "qingliao-win"
  productName = "轻聊"
  version     = "1.4.36"
  description = "轻聊 Windows 客户端"
  author      = "Keson"
  main        = "main.js"
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $inner "package.json"), ($appPkg | ConvertTo-Json -Depth 5), $utf8NoBom)

$sizeMB = [math]::Round(((Get-ChildItem $appDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
"运行时目录：$sizeMB MB"

# ---------- 3. 压成 payload.zip ----------
$payload = Join-Path $Work "payload.zip"
"压缩中（这一步最慢）…"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($appDir, $payload, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$payloadMB = [math]::Round((Get-Item $payload).Length / 1MB, 1)
"payload.zip：$payloadMB MB"

# ---------- 4. 编启动器 ----------
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { throw "找不到 csc.exe（需要 .NET Framework 4.x）" }

$stub = Join-Path $Work "stub.exe"
$iconPath = Join-Path $src "build\icon.ico"
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 "/win32icon:$iconPath" "/out:$stub" /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll (Join-Path $src "pack\launcher.cs") (Join-Path $src "pack\version.cs")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $stub)) { throw "启动器编译失败" }
"启动器：$([math]::Round((Get-Item $stub).Length / 1KB, 1)) KB"

# ---------- 5. 拼成单文件：stub + payload + 8 字节长度 ----------
$outDir = Split-Path $Out -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
if (Test-Path $Out) { Remove-Item $Out -Force }

$buf = New-Object byte[] (1048576)
$fs = [System.IO.File]::Create($Out)
try {
  foreach ($part in @($stub, $payload)) {
    $in = [System.IO.File]::OpenRead($part)
    try { while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) { $fs.Write($buf, 0, $n) } }
    finally { $in.Dispose() }
  }
  $fs.Write([BitConverter]::GetBytes([int64](Get-Item $payload).Length), 0, 8)
}
finally { $fs.Dispose() }

$finalMB = [math]::Round((Get-Item $Out).Length / 1MB, 1)
""
"完成：$Out（$finalMB MB）"
