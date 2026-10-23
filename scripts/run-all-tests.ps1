# 全量回归（25 套：内核单测 + 部署自检 + 真浏览器验收 + 自建数据实跑）
# 用法： powershell -ExecutionPolicy Bypass -File scripts/run-all-tests.ps1
# 说明：UI 类脚本会用本机 Chrome 跑真实页面；跑之前会把 data/config.json 挪到 work/ 备份，跑完还原。
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

$suites = @(
  'prompt-tests','shell-tests','products-core-tests','eval-core-tests','workflow-core-tests','news-core-tests',
  'acceptance-tests','deploy-tests',
  'ui-smoke','ui-prompt-tests','ui-trial-tests','ui-save-tests','ui-styles-tests','ui-model-tests',
  'ui-products-tests','ui-product-edit-tests','ui-product-batch-tests','ui-sources-tests','ui-fetch-tests',
  'ui-eval-workbench-tests','ui-eval-page-tests','acceptance-ui','ui-deploy-tests','ui-efficiency-tests',
  'ui-realdata-tests'
)

# 只在项目目录内清理测试用配置，先做路径校验
$dataDir = Join-Path $root 'data'
$configPath = Join-Path $dataDir 'config.json'
$newsPath = Join-Path $dataDir 'news.json'
$backupDir = Join-Path $dataDir 'backups'
foreach ($p in @($configPath, $newsPath, $backupDir)) {
  if (-not $p.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝操作项目目录之外的路径：$p"
  }
}
$workDir = Join-Path $root 'work'
if (-not (Test-Path $workDir)) { New-Item -ItemType Directory -Path $workDir | Out-Null }
$keep = Join-Path $workDir 'config-backup-before-regression.json'
if (Test-Path $configPath) { Copy-Item -LiteralPath $configPath -Destination $keep -Force }

$totalPass = 0; $totalFail = 0; $rows = @()
foreach ($s in $suites) {
  if (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath -Force }
  if (Test-Path -LiteralPath $newsPath) { Remove-Item -LiteralPath $newsPath -Force }
  if (Test-Path -LiteralPath $backupDir) { Remove-Item -LiteralPath $backupDir -Recurse -Force }
  $out = & node "tests/$s.js" 2>&1
  $code = $LASTEXITCODE
  $line = ($out | Select-String '通过 \d+ 项 / 失败 \d+ 项' | Select-Object -Last 1)
  # UI 套件偶发在启动 Chrome 时失败（exit=2 且没有汇总行），重试一次
  if (($code -ne 0 -or -not $line) -and $s -like 'ui-*') {
    Write-Output ("  [重试] " + $s + " 第一次 exit=" + $code)
    Start-Sleep -Seconds 2
    if (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath -Force }
    if (Test-Path -LiteralPath $newsPath) { Remove-Item -LiteralPath $newsPath -Force }
    if (Test-Path -LiteralPath $backupDir) { Remove-Item -LiteralPath $backupDir -Recurse -Force }
    $out = & node "tests/$s.js" 2>&1
    $code = $LASTEXITCODE
    $line = ($out | Select-String '通过 \d+ 项 / 失败 \d+ 项' | Select-Object -Last 1)
  }
  if ($line) {
    $m = [regex]::Match($line.ToString(), '通过 (\d+) 项 / 失败 (\d+) 项')
    $totalPass += [int]$m.Groups[1].Value
    $totalFail += [int]$m.Groups[2].Value
  } else {
    $totalFail += 1
  }
  $rows += [pscustomobject]@{ 套件 = $s; exit = $code; 结果 = if ($line) { $line.ToString().Trim() } else { '（没有读到汇总行）' } }
}

if (Test-Path -LiteralPath $keep) { Copy-Item -LiteralPath $keep -Destination $configPath -Force }
$rows | Format-Table -AutoSize
Write-Output ("TOTAL 通过 {0} 项 / 失败 {1} 项，共 {2} 套" -f $totalPass, $totalFail, $suites.Count)
