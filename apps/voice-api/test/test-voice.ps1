# Live smoke test of the voice API with a real WhatsApp voice note (.ogg).
# Usage:  .\test-voice.ps1 -Audio 'C:\path\to\note.ogg' [-CaseId samantha-lewis] [-Url http://127.0.0.1:8790]
# The secret is asked for and never stored. Use the VOICE_API_SECRET the service runs with.
param(
    [Parameter(Mandatory = $true)][string]$Audio,
    [string]$CaseId = 'samantha-lewis',
    [string]$Url = 'http://127.0.0.1:8790',
    [string]$Output = (Join-Path (Split-Path $Audio) 'Sherpas-Reply.ogg')
)

$secret = [System.Net.NetworkCredential]::new(
    '', (Read-Host 'Voice API secret' -AsSecureString)
).Password

$json = curl.exe -sS "$Url/api/voice" `
    -H "Authorization: Bearer $secret" `
    -F "caseId=$CaseId" `
    -F "audio=@$Audio;type=audio/ogg"

if ($LASTEXITCODE -ne 0) {
    throw "Request failed. Check that the API is running at $Url."
}

$reply = $json | ConvertFrom-Json
if ($reply.error) {
    throw "$($reply.error) - $($reply.message)"
}

if ($reply.success) {
    [System.IO.File]::WriteAllBytes($Output, [Convert]::FromBase64String($reply.audioBase64))
    Write-Host "Saved $Output"
} else {
    Write-Host "Transcript: $($reply.text)"
}
