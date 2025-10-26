param(
  [string]$Email = "testuser@example.com",
  [string]$Password = "TestPassword123!"
)

$envFile = Get-Content "$PSScriptRoot/../.env.local"
$anonKey = ($envFile | Where-Object { $_ -like 'SUPABASE_ANON_KEY=*' }) -replace 'SUPABASE_ANON_KEY=', ''
$url = ($envFile | Where-Object { $_ -like 'SUPABASE_URL=*' }) -replace 'SUPABASE_URL=', ''

if (-not $anonKey -or -not $url) {
  Write-Error "Missing SUPABASE credentials in .env.local"
  exit 1
}

$body = @{ email = $Email; password = $Password } | ConvertTo-Json

$response = Invoke-RestMethod -Method Post -Uri ($url.TrimEnd('/') + '/auth/v1/token?grant_type=password') -Headers @{
  apikey = $anonKey
  Authorization = "Bearer $anonKey"
  'Content-Type' = 'application/json'
} -Body $body

$response | ConvertTo-Json -Depth 5
