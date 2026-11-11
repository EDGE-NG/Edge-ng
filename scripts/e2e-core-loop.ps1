# End-to-end test of the V1 core loop: Edge Builder → approve → review → override → journal
$base = "http://localhost:3000"
$headers = @{ "Content-Type" = "application/json" }
$failures = 0

function Check($name, $cond, $detail = "") {
  if ($cond) { Write-Host "PASS  $name" }
  else { Write-Host "FAIL  $name  $detail"; $script:failures++ }
}

# --- login: email-code flow (dev mode returns the code in the response) ---
try {
  $rc = Invoke-RestMethod -Uri "$base/api/auth/request-code" -Method Post `
    -Body (@{ email = "e2e@edge.local" } | ConvertTo-Json) -Headers $headers -WebSession $sess -TimeoutSec 30
  Check "Request login code" ($rc.ok -eq $true) "err=$($rc.error)"
  $vr = Invoke-WebRequest -UseBasicParsing -Uri "$base/api/auth/verify" -Method Post `
    -Body (@{ email = "e2e@edge.local"; code = $rc.dev_code } | ConvertTo-Json) `
    -ContentType "application/json" -TimeoutSec 30 -SessionVariable sv
  $ck = $sv.Cookies.GetCookies($base) | Where-Object { $_.Name -eq "edge_session" } | Select-Object -First 1
  Check "Verify login code" ($null -ne $ck) "no session cookie"
  $cookieVal = $ck.Value
  # PS 5.1 drops Cookie when passed via -Headers; authenticate with -WebSession.
  $sess = $sv
  # A copy of the session for the dead-session check after logout.
  $stale = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $stale.Cookies.Add([Uri]$base, (New-Object System.Net.Cookie("edge_session", $cookieVal, "/", "localhost")))
} catch {
  Check "Login" $false $_.Exception.Message
  exit 1
}

# 1. Edge Builder: describe edge → AI drafts checklist
$desc = @"
I trade 15m pullbacks on EUR/USD during the London session. The 1H trend must be up, price must pull back to the 20 EMA without closing below it, and I want a bullish engulfing candle as confirmation. I risk a maximum of 1% per trade and never enter within 10 minutes of high-impact news. I invalidate the setup if price closes below the last swing low.
"@
$body = @{ description = $desc } | ConvertTo-Json
try {
  $r = Invoke-RestMethod -Uri "$base/api/edges" -Method Post -Body $body -Headers $headers -WebSession $sess -TimeoutSec 120
  Check "Edge Builder creates draft" ($r.items.Count -ge 3) "items=$($r.items.Count) err=$($r.error)"
  $edgeId = $r.edgeId; $versionId = $r.versionId
  Write-Host "  -> edge=$edgeId items=$($r.items.Count) questions=$($r.clarifying_questions.Count)"
  $r.items | ForEach-Object { Write-Host "     [$($_.category)] $($_.text)$(if ($_.hard_gate) {' [HARD]'})" }
} catch {
  Check "Edge Builder creates draft" $false $_.Exception.Message
  exit 1
}

# 2. Edit a rule, then approve
$items = $r.items | ForEach-Object {
  @{ category = $_.category; text = $_.text; hard_gate = [bool]$_.hard_gate; notes = $_.notes }
}
$patch = @{ versionId = $versionId; items = $items } | ConvertTo-Json -Depth 5
try {
  $resp = Invoke-WebRequest -UseBasicParsing -Uri "$base/api/edges/$edgeId" -Method Patch -Body $patch -Headers $headers -WebSession $sess -TimeoutSec 90
  Check "Edit draft items" ($resp.StatusCode -eq 200)
} catch { Check "Edit draft items" $false $_.Exception.Message }

try {
  $r2 = Invoke-RestMethod -Uri "$base/api/edges/$edgeId/approve" -Method Post -Body (@{ versionId = $versionId } | ConvertTo-Json) -Headers $headers -WebSession $sess -TimeoutSec 30
  Check "Approve checklist" $r2.ok "err=$($r2.error)"
} catch { Check "Approve checklist" $false $_.Exception.Message }

# 3. Start a review
try {
  $rev = Invoke-RestMethod -Uri "$base/api/reviews" -Method Post -Body (@{
    edgeId = $edgeId; instrument = "EUR/USD"; direction = "long"
    context = @{ higherTimeframe = "1H"; setupTimeframe = "15m"; executionTimeframe = "1m" }
  } | ConvertTo-Json -Depth 4) -Headers $headers -WebSession $sess -TimeoutSec 30
  Check "Start review" ($null -ne $rev.reviewId) "err=$($rev.error)"
  $reviewId = $rev.reviewId
} catch { Check "Start review" $false $_.Exception.Message; exit 1 }

# 4. Add evidence (text note — the capture fallback path)
# PS 5.1 has no -Form; build multipart manually
$boundary = [Guid]::NewGuid().ToString()
$lines = @()
foreach ($kv in @(
  @("kind", "note"), @("timeframe", "15m"),
  @("text", "1H trend is up: series of higher highs and lows since Tuesday. On the 15m, price pulled back to the 20 EMA and printed a bullish engulfing candle closing at 1.0842. Swing low sits at 1.0811. No red-folder news in the next hour.")
)) {
  $lines += "--$boundary"
  $lines += "Content-Disposition: form-data; name=`"$($kv[0])`""
  $lines += ""
  $lines += $kv[1]
}
$lines += "--$boundary--"
$bodyText = $lines -join "`r`n"
try {
  $resp = Invoke-RestMethod -Uri "$base/api/reviews/$reviewId/evidence" -Method Post `
    -Body $bodyText -ContentType "multipart/form-data; boundary=$boundary" `
    -WebSession $sess -TimeoutSec 60
  Check "Add evidence" ($resp.evidenceCount -ge 1) "err=$($resp.error)"
} catch { Check "Add evidence" $false $_.Exception.Message }

# 5. Run AI review
try {
  $run = Invoke-RestMethod -Uri "$base/api/reviews/$reviewId/run" -Method Post -WebSession $sess -TimeoutSec 180
  Check "Run AI review" ($run.results.Count -ge 3) "err=$($run.error) results=$($run.results.Count)"
  Write-Host "  -> overall=$($run.overall)"
  $run.results | ForEach-Object { Write-Host "     $($_.verdict): $($_.explanation)" }
} catch { Check "Run AI review" $false $_.Exception.Message; exit 1 }

# 6. Record an override
try {
  $ov = Invoke-RestMethod -Uri "$base/api/reviews/$reviewId/override" -Method Post -Body (@{ reason = "Higher-timeframe confluence not visible in the capture; taking it anyway with reduced size." } | ConvertTo-Json) -Headers $headers -WebSession $sess -TimeoutSec 30
  Check "Record override" $ov.recorded "err=$($ov.error)"
} catch { Check "Record override" $false $_.Exception.Message }

# 7. Record a trade linked to the review
try {
  $tr = Invoke-RestMethod -Uri "$base/api/trades" -Method Post -Body (@{
    reviewId = $reviewId; instrument = "EUR/USD"; direction = "long"
    entryPrice = 1.0842; exitPrice = 1.0855; pnl = 13; notes = "Closed at first resistance."
  } | ConvertTo-Json -Depth 4) -Headers $headers -WebSession $sess -TimeoutSec 30
  Check "Record trade" ($null -ne $tr.tradeId) "err=$($tr.error)"
  $tradeId = $tr.tradeId
} catch { Check "Record trade" $false $_.Exception.Message; exit 1 }

# 8. Generate AI journal
try {
  $jr = Invoke-RestMethod -Uri "$base/api/journal" -Method Post -Body (@{ tradeId = $tradeId } | ConvertTo-Json) -Headers $headers -WebSession $sess -TimeoutSec 180
  Check "Generate journal" ($null -ne $jr.entryId) "err=$($jr.error)"
  Write-Host "  -> compliance: $($jr.compliance | ConvertTo-Json -Compress)"
} catch { Check "Generate journal" $false $_.Exception.Message }

# 9. Dashboard aggregates
try {
  $d = Invoke-RestMethod -Uri "$base/api/dashboard" -WebSession $sess -TimeoutSec 30
  Check "Dashboard aggregates" ($d.completed -ge 1 -and $d.overrides -ge 1 -and $d.journalCount -ge 1) ($d | ConvertTo-Json -Compress)
} catch { Check "Dashboard aggregates" $false $_.Exception.Message }

Write-Host ""

# --- auth gate: logout kills the session ---
try {
  $lo = Invoke-RestMethod -Uri "$base/api/auth/logout" -Method Post -WebSession $sess -TimeoutSec 30
  Check "Logout" ($lo.ok -eq $true) "err=$($lo.error)"
  $gateStatus = 0
  try {
    Invoke-RestMethod -Uri "$base/api/dashboard" -WebSession $stale -TimeoutSec 30 | Out-Null
  } catch {
    try { $gateStatus = [int]$_.Exception.Response.StatusCode } catch { $gateStatus = -1 }
  }
  Check "API rejects dead session (401)" ($gateStatus -eq 401) "status=$gateStatus"
} catch { Check "Logout" $false $_.Exception.Message }

Write-Host ""
if ($failures -eq 0) { Write-Host "ALL CHECKS PASSED" } else { Write-Host "$failures CHECK(S) FAILED"; exit 1 }
