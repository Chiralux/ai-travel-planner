param(
  [string]$Email = "testuser@example.com",
  [string]$Password = "TestPassword123!",
  [string]$Method = "GET"
)

$baseUrl = 'http://localhost:3000'
$envFile = Get-Content "$PSScriptRoot/../.env.local"
$anonKey = ($envFile | Where-Object { $_ -like 'SUPABASE_ANON_KEY=*' }) -replace 'SUPABASE_ANON_KEY=', ''
$url = ($envFile | Where-Object { $_ -like 'SUPABASE_URL=*' }) -replace 'SUPABASE_URL=', ''

if (-not $anonKey -or -not $url) {
  Write-Error "Missing Supabase credentials"
  exit 1
}

# Sign in to get access token
$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
$loginResponse = Invoke-RestMethod -Method Post -Uri ($url.TrimEnd('/') + '/auth/v1/token?grant_type=password') -Headers @{
  apikey = $anonKey
  Authorization = "Bearer $anonKey"
  'Content-Type' = 'application/json'
} -Body $loginBody

$token = $loginResponse.access_token
if (-not $token) {
  Write-Error "Failed to obtain access token"
  exit 1
}

$headers = @{ Authorization = "Bearer $token" }

if ($Method -eq 'GET') {
  $response = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/trips?page=1&pageSize=5" -Headers $headers -ErrorAction Stop
  $response | ConvertTo-Json -Depth 6
} elseif ($Method -eq 'POST') {
  $payload = @{ title = 'Test Trip'; destination = 'Tokyo'; startDate = '2025-03-01'; endDate = '2025-03-05'; partySize = 2; preferences = @('food'); budget = 10000; currency = 'JPY' } | ConvertTo-Json -Depth 4
  $response = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/trips" -Headers ($headers + @{ 'Content-Type' = 'application/json' }) -Body $payload -ErrorAction Stop
  $response | ConvertTo-Json -Depth 6
} else {
  Write-Error "Unsupported method: $Method"
  exit 1
}
