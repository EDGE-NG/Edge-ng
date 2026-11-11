# End-to-end test of the Visual Library (PRD 4.3):
# rule -> screenshot -> explanation -> AI interpretation -> trader confirm/correct
# -> replace (version history) -> delete -> review integration.
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
    -Body (@{ email = "e2e-visual@edge.local" } | ConvertTo-Json) -Headers $headers -WebSession $sess -TimeoutSec 30
  Check "Request login code" ($rc.ok -eq $true) "err=$($rc.error)"
  $vr = Invoke-WebRequest -UseBasicParsing -Uri "$base/api/auth/verify" -Method Post `
    -Body (@{ email = "e2e-visual@edge.local"; code = $rc.dev_code } | ConvertTo-Json) `
    -ContentType "application/json" -TimeoutSec 30 -SessionVariable sv
  $ck = $sv.Cookies.GetCookies($base) | Where-Object { $_.Name -eq "edge_session" } | Select-Object -First 1
  Check "Verify login code" ($null -ne $ck) "no session cookie"
  $cookieVal = $ck.Value
  # PS 5.1 drops Cookie when passed via -Headers; authenticate with -WebSession.
  $sess = $sv
} catch {
  Check "Login" $false $_.Exception.Message
  exit 1
}

# --- generate two test chart PNGs ---
Add-Type -AssemblyName System.Drawing
function New-TestChart([string]$path, [int]$seed) {
  $bmp = New-Object System.Drawing.Bitmap 320, 200
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(10, 12, 16))
  $rnd = New-Object System.Random $seed
  for ($i = 0; $i -lt 12; $i++) {
    $x = 15 + $i * 24
    $h = $rnd.Next(20, 90)
    $y = 100 + $rnd.Next(-30, 30) - [int]($h / 2)
    $color = if ($rnd.Next(2) -eq 0) { [System.Drawing.Color]::LimeGreen } else { [System.Drawing.Color]::Tomato }
    $pen = New-Object System.Drawing.Pen $color, 2
    $g.DrawLine($pen, $x + 6, $y - 8, $x + 6, $y + $h + 8)
    $brush = New-Object System.Drawing.SolidBrush $color
    $g.FillRectangle($brush, $x, $y, 12, $h)
    $pen.Dispose(); $brush.Dispose()
  }
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$img1 = Join-Path $env:TEMP "edge-vis-test1.png"
$img2 = Join-Path $env:TEMP "edge-vis-test2.png"
New-TestChart $img1 7
New-TestChart $img2 42

function New-Multipart([hashtable]$fields, [string]$fileField, [string]$filePath) {
  # Build as raw BYTES: PS 5.1 re-encodes string bodies, which corrupts PNG data.
  $boundary = [Guid]::NewGuid().ToString()
  $enc = [Text.Encoding]::GetEncoding("iso-8859-1")
  $sb = New-Object System.Text.StringBuilder
  foreach ($k in $fields.Keys) {
    [void]$sb.Append("--$boundary`r`n")
    [void]$sb.Append("Content-Disposition: form-data; name=`"$k`"`r`n`r`n")
    [void]$sb.Append([string]$fields[$k])
    [void]$sb.Append("`r`n")
  }
  $ms = New-Object System.IO.MemoryStream
  $pre = $enc.GetBytes($sb.ToString())
  $ms.Write($pre, 0, $pre.Length)
  if ($filePath) {
    $fileBytes = [IO.File]::ReadAllBytes($filePath)
    $hdr = $enc.GetBytes("--$boundary`r`nContent-Disposition: form-data; name=`"$fileField`"; filename=`"chart.png`"`r`nContent-Type: image/png`r`n`r`n")
    $ms.Write($hdr, 0, $hdr.Length)
    $ms.Write($fileBytes, 0, $fileBytes.Length)
    $ms.WriteByte(13); $ms.WriteByte(10)
  }
  $tail = $enc.GetBytes("--$boundary--`r`n")
  $ms.Write($tail, 0, $tail.Length)
  return @{ Body = $ms.ToArray(); ContentType = "multipart/form-data; boundary=$boundary" }
}

# --- 1. create + approve an edge (AI) ---
$desc = "I trade 15m pullbacks on EUR/USD in London. 1H trend up, pullback to the 20 EMA, bullish engulfing confirmation, 1% max risk, invalidate on close below the swing low."
try {
  $r = Invoke-RestMethod -Uri "$base/api/edges" -Method Post -Body (@{ description = $desc } | ConvertTo-Json) -Headers $headers -WebSession $sess -TimeoutSec 180
  Check "Create edge draft" ($null -ne $r.edgeId) "err=$($r.error)"
  $edgeId = $r.edgeId; $versionId = $r.versionId
} catch { Check "Create edge draft" $false $_.Exception.Message; exit 1 }

try {
  $r2 = Invoke-RestMethod -Uri "$base/api/edges/$edgeId/approve" -Method Post -Body (@{ versionId = $versionId } | ConvertTo-Json) -Headers $headers -WebSession $sess -TimeoutSec 60
  Check "Approve checklist" $r2.ok "err=$($r2.error)"
} catch { Check "Approve checklist" $false $_.Exception.Message; exit 1 }

# --- 2. find an item through the library index ---
try {
  $lib = Invoke-RestMethod -Uri "$base/api/visual" -WebSession $sess -TimeoutSec 60
  $edge = $lib.edges | Where-Object { $_.id -eq $edgeId }
  Check "Library lists approved edge" ($null -ne $edge) "edges=$($lib.edges.Count)"
  $item = $edge.items[0]
  $itemId = $item.id
  Write-Host "  -> item=$itemId [$($item.category)] $($item.text)"
} catch { Check "Library lists approved edge" $false $_.Exception.Message; exit 1 }

# --- 3. attach a positive example (vision AI interprets it) ---
try {
  $mp = New-Multipart @{ itemId = $itemId; polarity = "positive"; explanation = "Price pulled back to the 20 EMA on the 15m while the 1H trend was up, and a bullish engulfing candle closed above the EMA. Entered on the close with the swing low intact." } "file" $img1
  $ref = Invoke-RestMethod -Uri "$base/api/visual" -Method Post -Body $mp.Body -ContentType $mp.ContentType -WebSession $sess -TimeoutSec 180
  Check "Attach example (201)" ($null -ne $ref.ref.id) "err=$($ref.error)"
  Check "AI produced interpretation" ([bool]$ref.ref.ai_interpretation) "ai_error=$($ref.ai_error)"
  Write-Host "  -> AI: $($ref.ref.ai_interpretation)"
  $refId = $ref.ref.id
} catch { Check "Attach example (201)" $false $_.Exception.Message; exit 1 }

# --- 4. trader confirms the interpretation ---
try {
  $p = Invoke-RestMethod -Uri "$base/api/visual/$refId" -Method Patch -Body (@{ action = "confirm" } | ConvertTo-Json) -Headers $headers -WebSession $sess -TimeoutSec 60
  Check "Confirm interpretation" ($p.ref.approval_status -eq "approved") "status=$($p.ref.approval_status) err=$($p.error)"
} catch { Check "Confirm interpretation" $false $_.Exception.Message }

# --- 5. replace the image (history preserved) ---
try {
  $mp2 = New-Multipart @{ polarity = "positive" } "file" $img2
  $rep = Invoke-RestMethod -Uri "$base/api/visual/$refId/replace" -Method Post -Body $mp2.Body -ContentType $mp2.ContentType -WebSession $sess -TimeoutSec 180
  $newId = $rep.ref.id
  Check "Replace image" (($rep.replaced -eq $refId) -and ($newId -ne $refId)) "err=$($rep.error)"
  Check "Replacement has fresh AI interpretation" ([bool]$rep.ref.ai_interpretation) "ai_error=$($rep.ai_error)"
  Check "Replacement starts pending" ($rep.ref.approval_status -eq "pending") "status=$($rep.ref.approval_status)"
} catch { Check "Replace image" $false $_.Exception.Message; exit 1 }

# --- 6. history via item detail ---
try {
  $detail = Invoke-RestMethod -Uri "$base/api/visual?itemId=$itemId" -WebSession $sess -TimeoutSec 60
  $hist = @($detail.history); $act = @($detail.refs)
  Check "History keeps replaced version" ($hist.Count -eq 1 -and $hist[0].id -eq $refId) "history=$($hist.Count)"
  Check "Active list has replacement" ($act.Count -eq 1 -and $act[0].id -eq $newId) "refs=$($act.Count)"
  Check "Old row points to successor" ($hist[0].superseded_by -eq $newId) "superseded_by=$($hist[0].superseded_by)"
} catch { Check "History keeps replaced version" $false $_.Exception.Message }

# --- 7. trader corrects the interpretation (their wording wins) ---
try {
  $p2 = Invoke-RestMethod -Uri "$base/api/visual/$newId" -Method Patch -Body (@{ action = "correct"; interpretation = "Engulfing candle must close above the 20 EMA itself, not just touch it." } | ConvertTo-Json) -Headers $headers -WebSession $sess -TimeoutSec 60
  Check "Correct interpretation" ($p2.ref.approval_status -eq "approved" -and $p2.ref.confirmed_interpretation -like "Engulfing candle must close*") "status=$($p2.ref.approval_status)"
} catch { Check "Correct interpretation" $false $_.Exception.Message }

# --- 8. negative example + delete ---
try {
  $mp3 = New-Multipart @{ itemId = $itemId; polarity = "negative"; explanation = "Price closed below the 20 EMA before the engulfing candle printed - this is a trap, not an entry." } "file" $img2
  $ref3 = Invoke-RestMethod -Uri "$base/api/visual" -Method Post -Body $mp3.Body -ContentType $mp3.ContentType -WebSession $sess -TimeoutSec 180
  $ref3Id = $ref3.ref.id
  Check "Attach negative example" ($ref3.ref.polarity -eq "negative") "err=$($ref3.error)"
  $d = Invoke-RestMethod -Uri "$base/api/visual/$ref3Id" -Method Delete -WebSession $sess -TimeoutSec 60
  Check "Delete example" $d.deleted "err=$($d.error)"
} catch { Check "Attach negative example" $false $_.Exception.Message }

# --- 9. review integration: confirmed visual context flows into the AI review ---
try {
  $rev = Invoke-RestMethod -Uri "$base/api/reviews" -Method Post -Body (@{
    edgeId = $edgeId; instrument = "EUR/USD"; direction = "long"
    context = @{ higherTimeframe = "1H"; setupTimeframe = "15m" }
  } | ConvertTo-Json -Depth 4) -Headers $headers -WebSession $sess -TimeoutSec 60
  Check "Start review" ($null -ne $rev.reviewId) "err=$($rev.error)"
  $reviewId = $rev.reviewId

  $boundary = [Guid]::NewGuid().ToString()
  $lines = @()
  foreach ($kv in @(
    @("kind", "note"), @("timeframe", "15m"),
    @("text", "1H trend up, pullback to 20 EMA on 15m, bullish engulfing closing at 1.0842, swing low 1.0811 intact, no news in the hour.")
  )) {
    $lines += "--$boundary"
    $lines += "Content-Disposition: form-data; name=`"$($kv[0])`""
    $lines += ""
    $lines += $kv[1]
  }
  $lines += "--$boundary--"
  $ev = Invoke-RestMethod -Uri "$base/api/reviews/$reviewId/evidence" -Method Post -Body ($lines -join "`r`n") -ContentType "multipart/form-data; boundary=$boundary" -WebSession $sess -TimeoutSec 60
  Check "Add evidence" ($ev.evidenceCount -ge 1) "err=$($ev.error)"

  $run = Invoke-RestMethod -Uri "$base/api/reviews/$reviewId/run" -Method Post -WebSession $sess -TimeoutSec 180
  Check "AI review runs with visual context" ($run.results.Count -ge 3) "err=$($run.error) results=$($run.results.Count)"
  Write-Host "  -> overall=$($run.overall)"
} catch { Check "Start review" $false $_.Exception.Message }

Write-Host ""
if ($failures -eq 0) { Write-Host "ALL CHECKS PASSED" } else { Write-Host "$failures CHECK(S) FAILED"; exit 1 }
