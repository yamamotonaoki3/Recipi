# 本番用バックエンドイメージの最小限の起動契約を検証する。
# CI とローカルの両方で、リポジトリルートから実行する:
#   pwsh -File backend/scripts/container_smoke_test.ps1
$ErrorActionPreference = "Stop"

$requiredIgnores = @(
    ".env",
    ".env.*",
    ".venv/",
    "__pycache__/",
    ".pytest_cache/",
    ".mypy_cache/",
    ".ruff_cache/",
    ".test-temp/",
    "tests/",
    "**/coverage/",
    ".coverage"
)

$dockerignore = Get-Content "backend/.dockerignore"
foreach ($pattern in $requiredIgnores) {
    if ($dockerignore -notcontains $pattern) {
        throw "backend/.dockerignore must exclude $pattern"
    }
}

$suffix = if ($env:GITHUB_RUN_ID) { $env:GITHUB_RUN_ID } else { "local" }
$image = "recipi-api-smoke:$suffix-$PID"
$container = "recipi-api-smoke-$PID"

try {
    & docker build --tag $image backend
    if ($LASTEXITCODE -ne 0) { throw "docker build failed" }

    $runtimeUser = (& docker image inspect --format '{{.Config.User}}' $image).Trim()
    if ($runtimeUser -ne "appuser") {
        throw "backend image must set appuser as its runtime user"
    }

    $uid = (& docker run --rm --entrypoint id $image -u).Trim()
    if ($uid -ne "1000") {
        throw "backend image must run as the non-root uid 1000"
    }

    $runArgs = @(
        "run", "--detach", "--name", $container, "--publish", "127.0.0.1::8000",
        "--env", "APP_ENV=production",
        "--env", "DATABASE_URL=postgresql+psycopg://smoke:smoke@127.0.0.1:5432/recipi",
        "--env", "JWT_SECRET_KEY=smoke-test-only-not-a-real-secret-1234567890",
        "--env", "LOG_HASH_SECRET=smoke-test-only-not-a-real-secret-1234567890",
        "--env", "AUTH_COOKIE_SECURE=true",
        "--env", "S3_ENDPOINT_URL=",
        "--env", "S3_REGION=ap-northeast-1",
        "--env", "S3_BUCKET=recipi-images",
        "--env", "S3_ACCESS_KEY_ID=",
        "--env", "S3_SECRET_ACCESS_KEY=",
        "--env", "S3_PUBLIC_URL_BASE=https://example.invalid/recipi-images",
        "--env", "TRUSTED_PROXY_CIDRS=10.0.0.0/24",
        "--env", "AI_PROVIDER=stub",
        $image
    )
    & docker @runArgs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker run failed" }

    $portLine = (& docker port $container "8000/tcp" | Select-Object -First 1).Trim()
    $match = [regex]::Match($portLine, ":(?<port>\d+)$")
    if (-not $match.Success) { throw "could not determine the published API port" }
    $port = $match.Groups["port"].Value

    foreach ($attempt in 1..30) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$port/healthz"
            if ($response.StatusCode -eq 200) { return }
        } catch {
            Start-Sleep -Seconds 1
        }
    }

    & docker logs $container 2>&1 | ForEach-Object { Write-Host $_ }
    throw "backend container did not return 200 from /healthz"
} finally {
    & docker rm -f $container 2>$null | Out-Null
    & docker image rm -f $image 2>$null | Out-Null
}
