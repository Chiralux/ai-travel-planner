param(
  [string]$Email = "testuser@example.com",
  [string]$Password = "TestPassword123!"
)

$envFile = Get-Content "$PSScriptRoot/../.env.local"
$svcKey = ($envFile | Where-Object { $_ -like 'SUPABASE_SERVICE_ROLE_KEY=*' }) -replace 'SUPABASE_SERVICE_ROLE_KEY=', ''
$url = ($envFile | Where-Object { $_ -like 'SUPABASE_URL=*' }) -replace 'SUPABASE_URL=', ''

if (-not $svcKey -or -not $url) {
  Write-Error "Missing SUPABASE credentials in .env.local"
  exit 1
}

$body = @{ email = $Email; password = $Password; email_confirm = $true } | ConvertTo-Json

$response = Invoke-RestMethod -Method Post -Uri ($url.TrimEnd('/') + '/auth/v1/admin/users') -Headers @{
  apikey = $svcKey
  Authorization = "Bearer $svcKey"
  'Content-Type' = 'application/json'
} -Body $body

$response | ConvertTo-Json -Depth 5
