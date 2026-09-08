. (Join-Path $PSScriptRoot 'env.ps1')

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LocalCorepack = Join-Path $ProjectRoot 'third_party\toolchains\node-v24.19.0-win-x64\corepack.cmd'
$CachedPnpm = Join-Path $ProjectRoot '.cache\bin\pnpm.cmd'

if (Test-Path -LiteralPath $LocalCorepack) {
  & $LocalCorepack pnpm @args
  exit $LASTEXITCODE
}

if (Test-Path -LiteralPath $CachedPnpm) {
  & $CachedPnpm @args
  exit $LASTEXITCODE
}

$SystemPnpm = Get-Command pnpm -CommandType Application -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $SystemPnpm) {
  throw "pnpm 9 is required. Install the packageManager version declared in package.json, or place a project-local wrapper at .cache/bin/pnpm.cmd."
}

& $SystemPnpm.Source @args
exit $LASTEXITCODE
