$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$env:npm_config_cache = Join-Path $ProjectRoot '.cache\npm'
$env:PNPM_STORE_DIR = Join-Path $ProjectRoot '.cache\pnpm-store'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $ProjectRoot '.cache\playwright'
$ProjectChromium = Join-Path $env:PLAYWRIGHT_BROWSERS_PATH 'chromium-1234\chrome-win64\chrome.exe'
if (Test-Path -LiteralPath $ProjectChromium) {
  $env:MPFORGE_CHROMIUM_EXECUTABLE = $ProjectChromium
}
$env:ELECTRON_CACHE = Join-Path $ProjectRoot '.cache\electron'
$env:ELECTRON_BUILDER_CACHE = Join-Path $ProjectRoot '.cache\electron-builder'
$env:electron_config_cache = Join-Path $ProjectRoot '.cache\electron'
# Electron uses its official release host unless the caller explicitly sets ELECTRON_MIRROR.
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://cdn.npmmirror.com/binaries/electron-builder-binaries/'
$env:COREPACK_HOME = Join-Path $ProjectRoot '.cache\corepack'
$env:TEMP = Join-Path $ProjectRoot 'tmp'
$env:TMP = Join-Path $ProjectRoot 'tmp'

$LocalNode = Join-Path $ProjectRoot 'third_party\toolchains\node-v24.19.0-win-x64'
if (Test-Path -LiteralPath (Join-Path $LocalNode 'node.exe')) {
  $LocalBin = Join-Path $ProjectRoot 'scripts\bin'
  $env:PATH = "$LocalBin;$LocalNode;$env:PATH"
}

$RequiredDirectories = @(
  $env:npm_config_cache,
  $env:PNPM_STORE_DIR,
  $env:PLAYWRIGHT_BROWSERS_PATH,
  $env:ELECTRON_CACHE,
  $env:ELECTRON_BUILDER_CACHE,
  $env:COREPACK_HOME,
  $env:TEMP,
  (Join-Path $ProjectRoot 'downloads'),
  (Join-Path $ProjectRoot 'third_party\sources'),
  (Join-Path $ProjectRoot 'artifacts'),
  (Join-Path $ProjectRoot 'reports')
)

foreach ($Directory in $RequiredDirectories) {
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
}

Write-Output "MPForge project-local environment active at $ProjectRoot"
