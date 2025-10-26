$envFile = Get-Content "$PSScriptRoot/../.env.local"
$svcKey = ($envFile | Where-Object { $_ -like 'SUPABASE_SERVICE_ROLE_KEY=*' }) -replace 'SUPABASE_SERVICE_ROLE_KEY=', ''
$url = ($envFile | Where-Object { $_ -like 'SUPABASE_URL=*' }) -replace 'SUPABASE_URL=', ''

if (-not $svcKey -or -not $url) {
  Write-Error "Missing SUPABASE credentials in .env.local"
  exit 1
}

$sql = Get-Content "$PSScriptRoot/../db/schema.sql" -Raw
$body = @{ query = $sql } | ConvertTo-Json -Compress

$response = Invoke-RestMethod -Method Post -Uri ($url.TrimEnd('/') + '/sql/v1') -Headers @{
  apikey = $svcKey
  Authorization = "Bearer $svcKey"
  'Content-Type' = 'application/json'
} -Body $body

$response | ConvertTo-Json -Depth 5
