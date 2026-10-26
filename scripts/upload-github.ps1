#Requires -Version 5.1
<#
.SYNOPSIS
    一键把当前项目上传到 GitHub。

.DESCRIPTION
    面向「不想记 git 命令」的场景：双击运行，按提示输入 GitHub 用户名和 Token，
    脚本自动完成初始化、忽略规则、敏感信息扫描、建仓库、提交、推送。

    设计取舍：
      1. 只走 HTTPS + Personal Access Token。本机没装 gh CLI、也没有 SSH 密钥，
         这是唯一开箱可用的路径。
      2. Token 用 Windows DPAPI 加密存到用户目录，只有当前 Windows 账号能解密，
         不会明文写在磁盘上，也不会写进 .git/config。
      3. 公开仓库最容易出事的不是代码写错，是把密钥推上去了。所以推送前强制扫描
         敏感文件和密钥特征，命中就中止。
      4. 幂等：重复运行不会重复 init、不会重复建仓库，只增量提交。

.PARAMETER Repo
    GitHub 仓库名。默认用当前目录名。

.PARAMETER Visibility
    public 或 private，默认 public。

.PARAMETER User
    GitHub 用户名。不传则交互询问，并从上次保存的配置里取默认值。

.PARAMETER DryRun
    只做检查和预演，不提交、不联网、不推送。

.EXAMPLE
    .\upload-github.ps1 -DryRun
    预演一遍，看看会传哪些文件、有没有敏感内容。

.EXAMPLE
    .\upload-github.ps1 -Repo baixiaoxiao -Visibility public
    直接上传（Token 已保存过的话全程无交互）。
#>
[CmdletBinding()]
param(
    [string]$Repo = '',
    [ValidateSet('public', 'private')]
    [string]$Visibility = 'public',
    [string]$User = '',
    [string]$TokenValue = '',
    [string]$Branch = 'main',
    [switch]$DryRun,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
# 只设输出编码，不改 [Console]::OutputEncoding —— 后者会让某些宿主把换行解析出多余字符
$OutputEncoding = [System.Text.Encoding]::UTF8

# ------------------------------------------------------------------ 终端输出
function Write-Step($n, $text) {
    Write-Host ''
    Write-Host ("[{0}] {1}" -f $n, $text) -ForegroundColor Cyan
}
function Write-Ok($text)   { Write-Host ("    OK   " + $text) -ForegroundColor Green }
function Write-Warn2($text){ Write-Host ("    注意 " + $text) -ForegroundColor Yellow }
function Write-Err2($text) { Write-Host ("    错误 " + $text) -ForegroundColor Red }
function Write-Info($text) { Write-Host ("         " + $text) -ForegroundColor DarkGray }

function Stop-WithError($msg, $hint) {
    Write-Host ''
    Write-Err2 $msg
    if ($hint) { Write-Info $hint }
    Write-Host ''
    # 不在这里暂停：交给外层 .bat 的 pause 统一处理，避免双击时按两次回车
    exit 1
}

# git 把进度写到 stderr。在 $ErrorActionPreference='Stop' 下，`2>&1` 会把 stderr 变成
# ErrorRecord 直接抛异常，脚本随之中断（实测：push 刚开始就挂，远程一个字节没收到）。
# 所有需要读输出的 git 调用都走这里，临时把偏好降成 Continue。
function Invoke-GitCapture {
    param([string[]]$GitArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $log = (& git @GitArgs 2>&1 | Out-String)
        return @{ Ok = ($LASTEXITCODE -eq 0); Log = $log }
    } finally {
        $ErrorActionPreference = $prev
    }
}

# ------------------------------------------------------------------ 0. 定位项目根
$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = Split-Path -Parent $scriptDir
if (-not (Test-Path (Join-Path $root '.git')) -and -not (Test-Path (Join-Path $root 'scripts'))) {
    Stop-WithError "定位不到项目根目录" "脚本应放在项目的 scripts/ 子目录里"
}

Write-Host ''
Write-Host '==========================================' -ForegroundColor White
Write-Host '   一键上传到 GitHub' -ForegroundColor White
Write-Host '==========================================' -ForegroundColor White
Write-Info "项目目录  $root"
Write-Info "仓库可见性  $Visibility"
if ($DryRun) { Write-Host ''; Write-Host '  [预演模式] 不会提交、不会联网、不会推送' -ForegroundColor Yellow }

# ------------------------------------------------------------------ 1. 检查 git
Write-Step 1 '检查 git'

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    Stop-WithError '找不到 git' '先装 Git for Windows：https://git-scm.com/download/win'
}
$gitVersion = (& git --version) -join ''
Write-Ok $gitVersion

# 中文文件名不转义成 \346\226\207，否则 git status 里看不懂
& git config --global core.quotepath false 2>$null

# ------------------------------------------------------------------ 2. 忽略规则
Write-Step 2 '准备忽略规则'

$gitignorePath = Join-Path $root '.gitignore'
$requiredRules = @(
    '# 依赖与构建产物',
    'node_modules/',
    'dist/',
    'unpackage/',
    '.tmp/',
    '',
    '# 工具与流水线产物（属于本机数据，不进仓库）',
    '.workbuddy/',
    'output/',
    '.request_id',
    '',
    '# 密钥与本地配置',
    '.env',
    '.env.*',
    '*.pem',
    '*.key',
    '*.p12',
    '*.pfx',
    '',
    '# 系统文件',
    'Thumbs.db',
    '.DS_Store',
    'desktop.ini'
)

if (Test-Path $gitignorePath) {
    $existing = Get-Content $gitignorePath -Raw -Encoding UTF8
    $missing = @()
    foreach ($rule in $requiredRules) {
        $r = $rule.Trim()
        if ($r -eq '' -or $r.StartsWith('#')) { continue }
        if ($existing -notmatch [regex]::Escape($r)) { $missing += $r }
    }
    if ($missing.Count -gt 0) {
        Add-Content -Path $gitignorePath -Value "`r`n# 由一键上传脚本补充" -Encoding UTF8
        foreach ($m in $missing) { Add-Content -Path $gitignorePath -Value $m -Encoding UTF8 }
        Write-Ok ("补充了 {0} 条缺失规则" -f $missing.Count)
    } else {
        Write-Ok '已有 .gitignore，规则齐全'
    }
} else {
    Set-Content -Path $gitignorePath -Value ($requiredRules -join "`r`n") -Encoding UTF8
    Write-Ok '已生成 .gitignore（排除 node_modules / dist / .workbuddy / output）'
}

# ------------------------------------------------------------------ 3. 初始化仓库
Write-Step 3 '初始化 git 仓库'

Push-Location $root
try {
    $isRepo = $false
    try {
        $null = & git rev-parse --is-inside-work-tree 2>$null
        if ($LASTEXITCODE -eq 0) { $isRepo = $true }
    } catch { $isRepo = $false }

    if ($isRepo) {
        Write-Ok '已经是 git 仓库，跳过初始化'
    } else {
        & git init -q
        if ($LASTEXITCODE -ne 0) { Stop-WithError 'git init 失败' }
        & git symbolic-ref HEAD "refs/heads/$Branch" 2>$null
        Write-Ok "已初始化（默认分支 $Branch）"
    }

    # 必须在仓库内设置：Windows 版 git 默认 autocrlf=true，会把每个 LF 都警告一遍，
    # 一屏 warning 会把真正的结果淹掉。本仓库按原样存储（源码编辑器都支持 LF）。
    & git config core.autocrlf false 2>$null

    # 提交身份：没配就交互补上，否则首次 commit 直接失败
    $cfgName  = (& git config user.name) 2>$null
    $cfgEmail = (& git config user.email) 2>$null
    if (-not $cfgName -or -not $cfgEmail) {
        Write-Warn2 'git 还没有提交身份（user.name / user.email）'
        if ($DryRun) {
            Write-Info '预演模式跳过，实际运行时会询问'
        } else {
            if (-not $cfgName) {
                $inputName = Read-Host '    你的名字（会写进提交记录）'
                if (-not $inputName) { $inputName = 'developer' }
                & git config user.name $inputName
            }
            if (-not $cfgEmail) {
                $inputEmail = Read-Host '    你的邮箱（建议和 GitHub 一致）'
                if (-not $inputEmail) { $inputEmail = 'developer@example.com' }
                & git config user.email $inputEmail
            }
            Write-Ok '提交身份已配置（仅本仓库）'
        }
    } else {
        Write-Ok ("提交身份  {0} <{1}>" -f $cfgName, $cfgEmail)
    }

    # ------------------------------------------------------------------ 4. 暂存
    Write-Step 4 '暂存文件'

    & git add -A
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'git add 失败' }

    $staged = @(& git diff --cached --name-only)
    $staged = $staged | Where-Object { $_ -ne '' }
    $stagedCount = @($staged).Count

    if ($stagedCount -eq 0) {
        Write-Ok '没有新改动，工作区是干净的'
    } else {
        $totalBytes = 0
        foreach ($f in $staged) {
            $fp = Join-Path $root $f
            if (Test-Path -LiteralPath $fp) {
                $totalBytes += (Get-Item -LiteralPath $fp).Length
            }
        }
        $sizeText = if ($totalBytes -ge 1MB) { "{0:N1} MB" -f ($totalBytes / 1MB) } else { "{0:N0} KB" -f ($totalBytes / 1KB) }
        Write-Ok ("{0} 个文件，共 {1}" -f $stagedCount, $sizeText)

        # 列几个给人看，确认没传错东西
        $preview = @($staged | Select-Object -First 8)
        foreach ($p in $preview) { Write-Info $p }
        if ($stagedCount -gt 8) { Write-Info ("… 还有 {0} 个" -f ($stagedCount - 8)) }
    }

    # ------------------------------------------------------------------ 5. 敏感信息扫描
    Write-Step 5 '扫描敏感信息'

    # 公开仓库最大的风险不是代码写错，是把密钥推上去。这里按文件名和内容双重检查。
    $dangerNames = @(
        '^\.env$', '^\.env\.', '\.pem$', '\.key$', '^id_rsa', '^id_ed25519',
        '\.p12$', '\.pfx$', '^credentials\.json$', '^secrets?\.', '^\.npmrc$',
        '^\.git-credentials$', '^\.baixiaoxiao-gh(.*)\.dat$'
    )
    # 密钥特征：GitHub Token、AWS、私钥头、常见 key 赋值
    $dangerPatterns = @(
        'gh[pousr]_[A-Za-z0-9]{20,}',
        'github_pat_[A-Za-z0-9_]{20,}',
        'AKIA[0-9A-Z]{16}',
        '-----BEGIN [A-Z ]*PRIVATE KEY-----',
        'xox[baprs]-[A-Za-z0-9-]{10,}',
        'sk-[A-Za-z0-9]{32,}'
    )

    $hits = @()
    foreach ($f in @($staged)) {
        if (-not $f) { continue }
        $leaf = Split-Path -Leaf $f
        foreach ($dn in $dangerNames) {
            if ($leaf -match $dn) { $hits += [pscustomobject]@{ File = $f; Reason = '文件名像密钥/配置' } }
        }
    }

    # 内容扫描：只查文本类且小于 2MB 的，避免二进制误判和卡顿
    $textExt = @('.ts','.js','.vue','.json','.md','.txt','.html','.css','.yml','.yaml','.ps1','.bat','.sh','.py','.env','.cfg','.ini')
    foreach ($f in @($staged)) {
        if (-not $f) { continue }
        $fp = Join-Path $root $f
        if (-not (Test-Path -LiteralPath $fp)) { continue }
        $item = Get-Item -LiteralPath $fp
        if ($item.Length -gt 2MB) { continue }
        if ($textExt -notcontains $item.Extension.ToLower() -and $item.Extension -ne '') { continue }
        try {
            $content = Get-Content -LiteralPath $fp -Raw -Encoding UTF8 -ErrorAction Stop
        } catch { continue }
        if (-not $content) { continue }
        foreach ($pat in $dangerPatterns) {
            if ($content -match $pat) {
                $hits += [pscustomobject]@{ File = $f; Reason = "内容命中密钥特征 $pat" }
                break
            }
        }
    }

    if ($hits.Count -gt 0) {
        Write-Host ''
        Write-Err2 ("发现 {0} 处可能的敏感内容：" -f $hits.Count)
        foreach ($h in $hits) { Write-Host ("         {0}  —  {1}" -f $h.File, $h.Reason) -ForegroundColor Red }
        Write-Host ''
        Write-Info '这些内容一旦推到公开仓库就撤不回来了（会被爬虫和镜像站抓走）。'
        Write-Info '处理办法：把它们加进 .gitignore，或换成占位符后重跑。'
        Stop-WithError '已中止，没有任何内容被推送'
    }
    Write-Ok '未发现密钥、私钥或 .env 类文件'

    # ------------------------------------------------------------------ 6. 大文件检查
    Write-Step 6 '检查大文件'

    $bigFiles = @()
    foreach ($f in @($staged)) {
        if (-not $f) { continue }
        $fp = Join-Path $root $f
        if (-not (Test-Path -LiteralPath $fp)) { continue }
        $len = (Get-Item -LiteralPath $fp).Length
        if ($len -gt 50MB) { $bigFiles += [pscustomobject]@{ File = $f; MB = [math]::Round($len / 1MB, 1) } }
    }
    if ($bigFiles.Count -gt 0) {
        foreach ($b in $bigFiles) { Write-Warn2 ("{0}  {1} MB" -f $b.File, $b.MB) }
        $over = @($bigFiles | Where-Object { $_.MB -ge 95 })
        if ($over.Count -gt 0) {
            Stop-WithError '有文件超过 GitHub 的 100MB 单文件上限，无法推送' '把大文件移出仓库，或用 Git LFS'
        }
        Write-Warn2 'GitHub 对超过 50MB 的文件会警告，建议移出仓库'
    } else {
        Write-Ok '没有超过 50MB 的文件'
    }

    # ------------------------------------------------------------------ 7. 提交
    Write-Step 7 '提交'

    if ($stagedCount -eq 0) {
        Write-Ok '无需提交'
    } elseif ($DryRun) {
        Write-Info "预演模式：本应提交 $stagedCount 个文件"
    } else {
        $msg = "chore: 上传项目快照 ({0})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm')
        & git commit -q -m $msg
        if ($LASTEXITCODE -ne 0) {
            Write-Warn2 '没有产生新提交（可能内容与上次一致）'
        } else {
            Write-Ok "已提交：$msg"
        }
    }

    if ($DryRun) {
        Write-Host ''
        Write-Host '预演结束。去掉 -DryRun 或直接双击 .bat 即可真正上传。' -ForegroundColor Cyan
        Write-Host ''
        Pop-Location
        exit 0
    }

    # ------------------------------------------------------------------ 8. 账号与 Token
    Write-Step 8 'GitHub 账号'

    $cfgDir  = Join-Path $env:USERPROFILE '.baixiaoxiao'
    $cfgFile = Join-Path $cfgDir 'github.json'
    $tokFile = Join-Path $cfgDir 'github-token.dat'

    $saved = $null
    if (Test-Path $cfgFile) {
        try { $saved = Get-Content $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $saved = $null }
    }

    if (-not $User) {
        if ($saved -and $saved.user) { $User = $saved.user }
        if (-not $User) {
            do { $User = (Read-Host '    GitHub 用户名').Trim() } while (-not $User)
        } else {
            Write-Ok "用户名  $User"
        }
    } else {
        Write-Ok "用户名  $User"
    }

    if (-not $Repo) {
        $Repo = Split-Path -Leaf $root
        $inputRepo = Read-Host ("    仓库名（回车用默认 {0}）" -f $Repo)
        if ($inputRepo) { $Repo = $inputRepo.Trim() }
    }
    Write-Ok "仓库名  $Repo"

    # Token：优先用参数（自动化场景），否则读加密存档，最后才交互询问
    $token = ''
    if ($TokenValue) {
        $token = $TokenValue.Trim()
        Write-Ok 'Token  从参数传入（不落盘）'
    } elseif (Test-Path $tokFile) {
        try {
            Add-Type -AssemblyName System.Security -ErrorAction Stop
            $enc = [System.IO.File]::ReadAllBytes($tokFile)
            $dec = [System.Security.Cryptography.ProtectedData]::Unprotect(
                $enc, $null,
                [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
            $token = [System.Text.Encoding]::UTF8.GetString($dec)
        } catch { $token = '' }
    }

    if ($token) {
        if (-not $TokenValue) { Write-Ok 'Token  已保存（Windows 凭据加密）' }
    } else {
        Write-Host ''
        Write-Info '需要一个 Personal Access Token（不是登录密码）'
        Write-Info '获取：GitHub → Settings → Developer settings → Personal access tokens'
        Write-Info '        → Tokens (classic) → Generate new token → 勾选 repo 权限'
        Write-Info 'Token 只用于本次建仓库和推送，会加密存在本机，不会写进 .git/config'
        Write-Host ''
        $secure = Read-Host '    粘贴 Token（输入时不显示）' -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        $token = $token.Trim()
        if (-not $token) { Stop-WithError '没有输入 Token' }
    }

    # ------------------------------------------------------------------ 9. 建仓库
    Write-Step 9 '创建远程仓库'

    $headers = @{
        Authorization          = "token $token"
        'User-Agent'           = 'baixiaoxiao-uploader'
        Accept                 = 'application/vnd.github+json'
    }
    $apiBase = 'https://api.github.com'
    $privateFlag = ($Visibility -eq 'private')
    $repoExists = $false

    try {
        $null = Invoke-RestMethod -Uri "$apiBase/repos/$User/$Repo" -Headers $headers -Method Get -ErrorAction Stop
        $repoExists = $true
        Write-Ok "远程仓库已存在：$User/$Repo"
    } catch {
        $code = $null
        try { $code = $_.Exception.Response.StatusCode.value__ } catch { }
        if ($code -ne 404) {
            Stop-WithError "访问 GitHub API 失败（HTTP $code）" '检查网络，或 Token 是否有效/是否有 repo 权限'
        }
    }

    if (-not $repoExists) {
        $body = @{
            name        = $Repo
            private     = $privateFlag
            description = '百小鸮 · 校园课表与学习助手（微信小程序）'
            has_issues  = $true
            has_wiki    = $false
        } | ConvertTo-Json
        try {
            $created = Invoke-RestMethod -Uri "$apiBase/user/repos" -Headers $headers -Method Post -Body $body -ContentType 'application/json' -ErrorAction Stop
            Write-Ok "已创建仓库：$($created.full_name)（$Visibility）"
        } catch {
            $msg = $_.Exception.Message
            Stop-WithError "创建仓库失败：$msg" '同名仓库可能已存在，或 Token 缺少 repo 权限'
        }
    }

    # ------------------------------------------------------------------ 10. 设置 remote
    Write-Step 10 '配置远程地址'

    $remoteUrl = "https://github.com/$User/$Repo.git"
    $existingRemote = ''
    try { $existingRemote = (& git remote get-url origin 2>$null) -join '' } catch { }

    if ($existingRemote) {
        if ($existingRemote -ne $remoteUrl) {
            & git remote set-url origin $remoteUrl
            Write-Ok "已更新 origin → $remoteUrl"
        } else {
            Write-Ok "origin 已是 $remoteUrl"
        }
    } else {
        & git remote add origin $remoteUrl
        Write-Ok "已添加 origin → $remoteUrl"
    }

    # ------------------------------------------------------------------ 11. 推送
    Write-Step 11 '推送'

    # Token 通过临时 http header 传，不落到 .git/config，也不进 shell 历史
    $pair = "{0}:{1}" -f $User, $token
    $b64  = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($pair))
    $pushArgs = @('-c', 'credential.helper=', '-c', "http.extraHeader=AUTHORIZATION: basic $b64", 'push', '-u', 'origin', $Branch)

    function Invoke-Push {
        $r = Invoke-GitCapture -GitArgs $pushArgs
        foreach ($line in ($r.Log -split "`r?`n")) {
            if ($line.Trim()) { Write-Host ('        ' + $line.Trim()) -ForegroundColor DarkGray }
        }
        return $r
    }

    Write-Info "推送到 $remoteUrl ($Branch)"
    $result = Invoke-Push

    # 建仓库时如果勾了「Add a README file」，远程已有提交且与本地无共同祖先，
    # 首推会被拒（non-fast-forward）。合并一次再推，不用让用户去仓库页删重建。
    if (-not $result.Ok -and $result.Log -match 'non-fast-forward|fetch first|\[rejected\]') {
        Write-Warn2 '远程仓库已有内容（多半是建仓库时勾了 README）'
        Write-Info '先把远程内容合并进来，再推一次…'
        $pull = Invoke-GitCapture -GitArgs @('pull', '--no-rebase', '--allow-unrelated-histories', 'origin', $Branch)
        foreach ($line in ($pull.Log -split "`r?`n")) {
            if ($line.Trim()) { Write-Host ('        ' + $line.Trim()) -ForegroundColor DarkGray }
        }
        $result = Invoke-Push
    }

    $pushOk = $result.Ok

    if (-not $pushOk) {
        Write-Host ''
        Write-Err2 '推送失败'
        Write-Info '常见原因：'
        Write-Info '  · Token 没有 repo 权限，或已过期'
        Write-Info '  · 远程仓库已有内容且与本地历史冲突（可在仓库页先删掉重建）'
        Write-Info '  · 网络问题（需要代理才能访问 github.com）'
        Stop-WithError '未完成的推送，本地提交都还在，修好后重跑本脚本即可'
    }

    # ------------------------------------------------------------------ 12. 保存配置
    if ($TokenValue) {
        # 参数模式多为自动化调用，凭据不该留在盘上
        Write-Info 'Token 由参数传入，未写入本机存档'
    } else {
        if (-not (Test-Path $cfgDir)) { New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null }
        try {
            Add-Type -AssemblyName System.Security -ErrorAction Stop
            $encBytes = [System.Security.Cryptography.ProtectedData]::Protect(
                [System.Text.Encoding]::UTF8.GetBytes($token), $null,
                [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
            [System.IO.File]::WriteAllBytes($tokFile, $encBytes)
            @{ user = $User; repo = $Repo } | ConvertTo-Json | Set-Content -Path $cfgFile -Encoding UTF8
        } catch {
            Write-Warn2 '配置保存失败，下次运行需要重新输入 Token'
        }
    }

    # ------------------------------------------------------------------ 完成
    Write-Host ''
    Write-Host '==========================================' -ForegroundColor Green
    Write-Host '   上传完成' -ForegroundColor Green
    Write-Host '==========================================' -ForegroundColor Green
    Write-Host ''
    Write-Host ("    仓库地址  https://github.com/{0}/{1}" -f $User, $Repo) -ForegroundColor White
    $commitCount = (& git rev-list --count HEAD 2>$null) -join ''
    if ($commitCount) { Write-Info ("共 {0} 个提交" -f $commitCount) }
    Write-Info '以后改了代码，再双击一次这个脚本就会自动增量上传'
    Write-Host ''

} finally {
    Pop-Location
}

# 暂停交给外层 .bat 处理（单一入口，双击时不会出现"按两次回车"）
