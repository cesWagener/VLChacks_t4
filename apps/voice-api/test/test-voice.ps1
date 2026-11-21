$assets = 'C:\Users\romme\Desktop\projects\sherpas-saturday\assets'
$audio = Join-Path $assets 'WhatsApp Ptt 2026-11-21 at 15.26.19.ogg'
$output = Join-Path $assets 'Sherpas-Reply.ogg'
$caseId = 'samantha-lewis'

$secret = [System.Net.NetworkCredential]::new(
    '', (Read-Host 'aOxvUml_r1xyUfEAj5eOLK6EQbCBhU7WDkRD-fSACBc' -AsSecureString)
).Password

$json = curl.exe -sS "http://127.0.0.1:8790/api/voice" `
    -H "Authorization: Bearer $secret" `
    -F "caseId=$caseId" `
    -F "audio=@$audio;type=audio/ogg"

if ($LASTEXITCODE -ne 0) {
    throw 'Request failed. Check that the API is running on port 8790.'
}

$reply = $json | ConvertFrom-Json
if ($reply.error) {
    throw "$($reply.error) - $($reply.message)"
}

if ($reply.success) {
    [System.IO.File]::WriteAllBytes($output, [Convert]::FromBase64String($reply.audioBase64))
    Write-Host "Saved $output"
} else {
    Write-Host "Transcript: $($reply.text)"
}