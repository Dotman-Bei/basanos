$want = @('# Basanos','## Demo','## What it does','## Quickstart','## Built at dreamDEX Perps Builder Bounty','## How it works','## Tech stack','## Run locally','## Contract addresses','## Who it is for','## X posts','## Roadmap','## License')
$stamp = '<!-- readme-schema: R1-web-app v1 + event-overlay -->'
$lines = Get-Content README.md -Encoding UTF8
$inFence = $false
$got = foreach ($l in $lines) {
  if ($l -match '^```') { $inFence = -not $inFence }
  elseif (-not $inFence -and $l -cmatch '^#{1,2} ') { $l } }
$ok = ($got.Count -eq $want.Count)
if ($ok) { for ($i = 0; $i -lt $want.Count; $i++) { if ($got[$i] -cne $want[$i]) { $ok = $false } } }
if ($ok -and ($lines[0] -ceq $stamp)) { 'PASS' } else { 'FAIL' }
