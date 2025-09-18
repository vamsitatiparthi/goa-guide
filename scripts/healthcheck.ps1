param(
  [string]$Url = "http://localhost:8080/health"
)

try {
  Write-Host "Checking" $Url
  $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
  Write-Host "Status:" $resp.StatusCode
  Write-Host $resp.Content
} catch {
  Write-Error $_
  exit 1
}
