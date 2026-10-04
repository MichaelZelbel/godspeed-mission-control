$ErrorActionPreference='Stop'
$here=Split-Path -Parent $MyInvocation.MyCommand.Path
if(-not $env:GODSPEED_WORKSPACE){throw 'Choose the installation workspace'}
$config=if($env:GODSPEED_BROWSER_POST_CONFIG){$env:GODSPEED_BROWSER_POST_CONFIG}else{Join-Path $env:GODSPEED_WORKSPACE '.godspeed/connectors/browser-post/poster.env'}
if(-not (Test-Path -LiteralPath $config)){throw 'Configure the device-private poster file first'}
$node=(Get-Command node -ErrorAction Stop).Source
$bytes=[Text.Encoding]::UTF8.GetBytes($here)
$sha=[Security.Cryptography.SHA256]::Create()
try{$id=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').Substring(0,12)}finally{$sha.Dispose()}
$taskName='GodspeedMissionControlBrowserPost-'+$id
$script=Join-Path $here 'wake.js'
$launcher=Join-Path (Split-Path -Parent $config) ('run-'+$id+'.ps1')
$arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$launcher+'"'
$existing=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($existing){if($existing.Actions.Count -ne 1 -or $existing.Actions[0].Arguments -ne $arguments -or $existing.Actions[0].WorkingDirectory -ne $here){throw 'The existing task belongs to a different helper'};throw 'This owned task already exists; review its current state before replacing it'}
if(Test-Path -LiteralPath $launcher){throw 'The retained launcher already exists; review before replacing it'}
$quote={param($value) "'"+$value.Replace("'","''")+"'"}
$text='$env:GODSPEED_WORKSPACE='+(& $quote $env:GODSPEED_WORKSPACE)+"`n"+'$env:GODSPEED_BROWSER_POST_CONFIG='+(& $quote $config)+"`n"+'& '+(& $quote $node)+' '+(& $quote $script)+"`n"+'exit $LASTEXITCODE'+"`n"
[IO.File]::WriteAllText($launcher,$text,(New-Object Text.UTF8Encoding($false)))
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $here
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings=New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -Hidden
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Godspeed Mission Control selected browser posting helper' | Out-Null
Write-Host 'The selected posting task is installed. Start it only after approving this recurring posting setup.'
