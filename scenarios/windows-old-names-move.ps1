# PROVING SCENARIO OF 2.0.0-beta.15: an old Windows install moves to the new folder names.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.15-nightly-proof-six-repairs/plan.md,
# "What it does" 3, product issue #6): an install made by 2.0.0-beta.10, the last version whose new
# installs used the names "Godspeed Mission Control Full Alpha" and "... Full Alpha State", is moved
# to "Godspeed Mission Control" and "Godspeed Mission Control State" by the next update, with
# everything in them, and nothing that a person sees still names "Full Alpha".
#
#   pwsh -NoProfile -File scenarios/windows-old-names-move.ps1 <stage ref>        the plain run
#   pwsh -NoProfile -File scenarios/windows-old-names-move.ps1 <stage ref> held   a file in the old
#       state folder is held open during the update: the old install must still start and the setup
#       must say it will try again; released, the next update must move it
#   pwsh -NoProfile -File scenarios/windows-old-names-move.ps1 --check <folder>   only the checking part
#
# The stage ref is a branch or tag holding stage.json (candidate/2.0.0-beta.15, main). Like every
# scenario, it ends with exactly one line on its output, PASS or FAIL windows-old-names-move: ...,
# also appended to GITHUB_STEP_SUMMARY; everything else goes to the error stream.
#
# The acting part needs a fresh Windows machine (it installs, updates and reads the PC's Start menu,
# tasks and Apps list). The checking part reads only files, so it runs anywhere pwsh does, and
# scenarios/test-scenarios.sh holds it to prepared folders.
#
# The evidence folder (GODSPEED_SCENARIO_WORK or RUNNER_TEMP, then windows-old-names-move) holds:
#   mode.txt                      moves | held
#   localappdata-before.txt       the folders in %LOCALAPPDATA% after the old install, one per line
#   files-before.txt              every file in the old state folder, relative, one per line
#   localappdata-<p>.txt          the same after the update; p is held (held run only, update with the
#   files-<p>.txt                 folder held; the files are the old state folder's) and after
#   names-<p>.txt                 what a person sees: lines "startmenu: ...", "startup: ...",
#                                 "task: ...", "uninstall: ..." with what each runs or points at
#   health-<p>.txt                "ok" when the notebook answered /health, else why not
#   notes-<p>.txt                 ids and titles of the notebook's notes
#   reminders-<p>.txt             what `due list` answered
#   setup-log-<p>.txt             the setup's update log (%LOCALAPPDATA%\Godspeed\setup-log.txt) and
#                                 the move's note, when there is one
#   update-exit-<p>.txt           the exit code of the reader's update (update-godspeed.ps1); after must be 0
#   updater-<p>.log               what that update said; setup-from.log is beta.10's own setup /LOG
# The job uploads the folder as an artifact.
$ErrorActionPreference = 'Stop'
$Scenario = 'windows-old-names-move'

# The version that installs the old names, and the notebook items the scenario puts in.
$From = if ($env:GODSPEED_SCENARIO_FROM) { $env:GODSPEED_SCENARIO_FROM } else { 'candidate/2.0.0-beta.10' }
$Repo = 'MichaelZelbel/godspeed-mission-control'
$NoteId = 'written-before-the-move'
$NoteTitle = 'Written before the move'
$ReminderTitle = 'Reminder written before the move'
$HeldName = 'held-open-by-the-scenario.txt'
# The setup's own words, from kit-bootstrap's windows/move-to-new-folders.ps1 (#5): Say after the
# move ("... now lives in <program> and keeps its notebook's data in <state>.") and Set-Postponed
# ("... The next update tries the move again."). The release step lines them up with the merged text.
$SaidMoved = 'now lives in'
$SaidTryAgain = 'tries the move again'
# Files the setup itself rewrites or the machine makes while running, which a move may drop or
# re-make without losing anything of the person's: logs, locks, process records, caches, temp files.
$Churn = @('\.log$', '\.lock$', '\.tmp$', '(^|[\\/])process\.json$', '(^|[\\/])logs?[\\/]', '__pycache__', '\.pyc$', '(^|[\\/])folder-move[\\/]')

function Say([string]$Text) { [Console]::Error.WriteLine($Text) }
function Finish([string]$Line, [int]$Code) {
  [Console]::Out.WriteLine($Line)
  if ($env:GITHUB_STEP_SUMMARY) { Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $Line }
  exit $Code
}
function Show-Usage([int]$Code) {
  Say "usage: pwsh -NoProfile -File scenarios/$Scenario.ps1 <stage ref> [held]   the whole scenario, on a throwaway Windows machine"
  Say "       pwsh -NoProfile -File scenarios/$Scenario.ps1 --check <folder>     only the checking part, against a folder"
  Say 'The stage ref is a branch or tag holding stage.json: main, candidate/2.0.0-beta.15.'
  exit $Code
}

# ------------------------------------------------------------------ the checking part
function Read-Lines([string]$Folder, [string]$File) {
  $path = Join-Path $Folder $File
  if (-not (Test-Path -LiteralPath $path)) { throw "the evidence has no $File" }
  , @(Get-Content -LiteralPath $path | Where-Object { $_ -ne $null -and $_.Trim() -ne "" })
}

# Says what is wrong after the update (p = after), or $null.
function Test-Moved([string]$Folder, [string[]]$Before, [string]$P) {
  $dirs = Read-Lines $Folder "localappdata-$P.txt"
  foreach ($old in 'Godspeed Mission Control Full Alpha', 'Godspeed Mission Control Full Alpha State') {
    if ($dirs -contains $old) { return "the old folder $old is still there after the update" }
  }
  foreach ($new in 'Godspeed Mission Control', 'Godspeed Mission Control State') {
    if ($dirs -notcontains $new) { return "the folder $new is not there after the update" }
  }
  $files = Read-Lines $Folder "files-$P.txt"
  $kept = @{}
  foreach ($f in $files) { $kept[$f.ToLowerInvariant()] = $true }
  $lost = @($Before | Where-Object {
      $f = $_
      -not $kept.ContainsKey($f.ToLowerInvariant()) -and -not @($Churn | Where-Object { $f -match $_ })
    })
  if ($lost.Count) { return "$($lost.Count) files of the old state folder are not in the new one, the first: $($lost[0])" }
  $names = Read-Lines $Folder "names-$P.txt"
  $alpha = @($names | Where-Object { $_ -match 'full.?alpha' })
  if ($alpha.Count) { return "after the update a Start menu entry, scheduled task or uninstall entry still names Full Alpha: $($alpha[0])" }
  foreach ($kind in 'startmenu', 'task', 'uninstall') {
    if (-not @($names | Where-Object { $_ -like "${kind}:*Godspeed Mission Control*" -or ($kind -eq 'task' -and $_ -like 'task:*Godspeed*') }).Count) {
      return "after the update the listing of what a person sees holds no $kind entry for Godspeed, so nothing proves it was repointed"
    }
  }
  $exit = (Read-Lines $Folder "update-exit-$P.txt")[0]
  if ($exit -ne '0') { return "the update ended with exit $exit, not 0, so it did not finish" }
  $health = (Read-Lines $Folder "health-$P.txt")[0]
  if ($health -ne 'ok') { return "the notebook does not answer after the update: $health" }
  $notes = (Read-Lines $Folder "notes-$P.txt") -join "`n"
  if (-not $notes.Contains($NoteId) -or -not $notes.Contains($NoteTitle)) { return "the note written before the update is not in the notebook after it" }
  $reminders = (Read-Lines $Folder "reminders-$P.txt") -join "`n"
  if (-not $reminders.Contains($ReminderTitle)) { return "the reminder written before the update is not in the notebook after it" }
  $log = (Read-Lines $Folder "setup-log-$P.txt") -join "`n"
  if (-not $log.Contains($SaidMoved)) { return "the setup's own words never say the move happened (no '$SaidMoved')" }
  return $null
}

# Returns the verdict line for an evidence folder.
function Test-Evidence([string]$Folder) {
  if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { return "FAIL ${Scenario}: there is nothing at $Folder" }
  try {
    $mode = (Read-Lines $Folder 'mode.txt')[0]
    $before = Read-Lines $Folder 'files-before.txt'
    if (-not $before.Count) { return "FAIL ${Scenario}: the old state folder held no files before the update, so nothing was proved" }
    $dirsBefore = Read-Lines $Folder 'localappdata-before.txt'
    foreach ($old in 'Godspeed Mission Control Full Alpha', 'Godspeed Mission Control Full Alpha State') {
      if ($dirsBefore -notcontains $old) { return "FAIL ${Scenario}: the install before the update has no $old, so it was not an old install" }
    }
    if ($mode -eq 'held') {
      $dirs = Read-Lines $Folder 'localappdata-held.txt'
      foreach ($old in 'Godspeed Mission Control Full Alpha', 'Godspeed Mission Control Full Alpha State') {
        if ($dirs -notcontains $old) { return "FAIL ${Scenario}: with a folder held open the update still took $old away" }
      }
      if ($dirs -contains 'Godspeed Mission Control State') { return "FAIL ${Scenario}: with a folder held open a new state folder was made beside the old one (half a move)" }
      if ((Read-Lines $Folder 'files-held.txt') -notcontains 'installation.json') { return "FAIL ${Scenario}: the old state folder lost its installation.json while it was held" }
      $health = (Read-Lines $Folder 'health-held.txt')[0]
      if ($health -ne 'ok') { return "FAIL ${Scenario}: the old install does not start while the move waits: $health" }
      $notes = (Read-Lines $Folder 'notes-held.txt') -join "`n"
      if (-not $notes.Contains($NoteId)) { return "FAIL ${Scenario}: the old install answers without the note while the move waits" }
      $log = (Read-Lines $Folder 'setup-log-held.txt') -join "`n"
      if (-not $log.Contains($SaidTryAgain)) { return "FAIL ${Scenario}: the setup never said it will try again (no '$SaidTryAgain')" }
    } elseif ($mode -ne 'moves') {
      return "FAIL ${Scenario}: the evidence's mode is '$mode', not moves or held"
    }
    $why = Test-Moved $Folder $before 'after'
    if ($why) { return "FAIL ${Scenario}: $why" }
    if ($mode -eq 'held') {
      return "PASS ${Scenario}: with a file held open the old install kept working and the setup said it will try again; released, the next update moved both folders, $($before.Count) files kept, nothing names Full Alpha, the note and the reminder are in the notebook"
    }
    return "PASS ${Scenario}: both folders moved to the new names with $($before.Count) files kept, the old ones are gone, nothing names Full Alpha, the note and the reminder are in the notebook, the setup said so"
  } catch {
    return "FAIL ${Scenario}: the evidence could not be read: $($_.Exception.Message)"
  }
}

# ------------------------------------------------------------------ the command line
if ($args.Count -eq 0) { Show-Usage 2 }
if ($args[0] -in '-h', '--help') { Show-Usage 0 }
if ($args[0] -eq '--check') {
  if ($args.Count -ne 2 -or -not $args[1]) { Show-Usage 2 }
  $line = Test-Evidence $args[1]
  Finish $line $(if ($line.StartsWith('PASS')) { 0 } else { 1 })
}
if ($args[0].StartsWith('-') -or $args.Count -gt 2 -or ($args.Count -eq 2 -and $args[1] -ne 'held')) { Show-Usage 2 }
$StageRef = [string]$args[0]
$Held = ($args.Count -eq 2)

# ------------------------------------------------------------------ the acting part
function Stop-Scenario([string]$Why) { Finish "FAIL ${Scenario}: $Why" 1 }
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') { Stop-Scenario 'it installs on Windows and this is not Windows' }

$work = if ($env:GODSPEED_SCENARIO_WORK) { $env:GODSPEED_SCENARIO_WORK } elseif ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$Evidence = Join-Path $work $Scenario
if (Test-Path -LiteralPath $Evidence) { Remove-Item -LiteralPath $Evidence -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null
$Downloads = Join-Path $work "$Scenario-downloads"
New-Item -ItemType Directory -Force -Path $Downloads | Out-Null
Set-Content -LiteralPath (Join-Path $Evidence 'mode.txt') -Value $(if ($Held) { 'held' } else { 'moves' })

$local = $env:LOCALAPPDATA
$oldProgram = Join-Path $local 'Godspeed Mission Control Full Alpha'
$oldState = Join-Path $local 'Godspeed Mission Control Full Alpha State'
$newState = Join-Path $local 'Godspeed Mission Control State'
$workspace = Join-Path $HOME 'godspeed-v2'
$setupLog = Join-Path $local 'Godspeed\setup-log.txt'
$moveNote = Join-Path $local 'Godspeed\folder-move-note.txt'
$Base = 'http://127.0.0.1:47831'

function Get-Setup([string]$Ref, [string]$Name) {
  $raw = "https://raw.githubusercontent.com/$Repo/$Ref/stage.json"
  Say "Reading $raw"
  try { $stage = Invoke-RestMethod -Uri $raw } catch { Stop-Scenario "the stage file of $Ref could not be read: $($_.Exception.Message)" }
  $ws = $stage.windowsSetup
  if (-not $ws -or -not $ws.file -or -not $ws.releaseTag -or -not $ws.sha256) { Stop-Scenario "the stage file of $Ref names no Windows setup" }
  $dir = Join-Path $Downloads $Name
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $exe = Join-Path $dir $ws.file
  # The updater a reader runs reads these three files from the release (update-godspeed.ps1 -ReleaseBase).
  foreach ($name in $ws.file, 'windows-manifest.json', 'SHA256SUMS') {
    $url = "https://github.com/$Repo/releases/download/$($ws.releaseTag)/$name"
    Say "Downloading $url"
    try { Invoke-WebRequest -Uri $url -OutFile (Join-Path $dir $name) } catch { Stop-Scenario "$url could not be downloaded: $($_.Exception.Message)" }
  }
  $got = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($got -ne ([string]$ws.sha256).ToLowerInvariant()) { Stop-Scenario "the setup downloaded for $Ref has sha256 $got, the stage names $($ws.sha256)" }
  $exe
}

function Invoke-Setup([string]$Exe, [string[]]$Flags, [string]$LogName) {
  $log = Join-Path $Evidence $LogName
  Say "Running $Exe $($Flags -join ' ')"
  $p = Start-Process -FilePath $Exe -ArgumentList ($Flags + "/LOG=`"$log`"") -PassThru
  if (-not $p.WaitForExit(40 * 60 * 1000)) { Stop-Process -Id $p.Id -Force; Stop-Scenario "$Exe did not end within 40 minutes" }
  Say "  exit $($p.ExitCode)"
  $p.ExitCode
}

function Wait-Health([int]$Seconds) {
  $end = (Get-Date).AddSeconds($Seconds)
  $last = 'no answer'
  while ((Get-Date) -lt $end) {
    try {
      $h = Invoke-RestMethod -Uri "$Base/health" -TimeoutSec 10
      if ($h.ok -eq $true) { return 'ok' }
      $last = "health answered $($h | ConvertTo-Json -Compress)"
    } catch { $last = $_.Exception.Message }
    Start-Sleep -Seconds 3
  }
  $last
}

function Get-Query([string]$Body) {
  Invoke-RestMethod -Uri "$Base/api/query" -Method Post -ContentType 'application/json' -Body $Body -TimeoutSec 60
}

# The reminder's own command (notebook/bin/personal-command.mjs), the line an owner's assistant runs.
function Invoke-Due([string[]]$Arguments) {
  $script = @(Get-ChildItem -Path $workspace, $newState, $oldState -Recurse -Filter personal-command.mjs -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match 'notebook[\\/]bin' } | Sort-Object LastWriteTime -Descending)
  if (-not $script.Count) { return 'personal-command.mjs was not found' }
  $node = (Get-Command node -ErrorAction SilentlyContinue)
  if (-not $node) { return 'node was not found' }
  $env:GODSPEED_WORKSPACE = $workspace
  $out = & $node.Source $script[0].FullName due @Arguments 2>&1
  ($out | ForEach-Object { [string]$_ }) -join "`n"
}

function Get-Seen {
  $shell = New-Object -ComObject WScript.Shell
  $lines = @()
  foreach ($kind in 'Programs', 'Startup') {
    $dir = [Environment]::GetFolderPath($kind)
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue)) {
      if ($f.PSIsContainer) { continue }
      $text = $f.FullName
      if ($f.Extension -eq '.lnk') { $l = $shell.CreateShortcut($f.FullName); $text = "$text -> $($l.TargetPath) $($l.Arguments) $($l.WorkingDirectory)" }
      if ($f.Extension -eq '.url') { $text = "$text -> $((Get-Content -LiteralPath $f.FullName) -join ' ')" }
      if ($text -match 'Godspeed') { $lines += "$(if ($kind -eq 'Programs') { 'startmenu' } else { 'startup' }): $text" }
    }
  }
  foreach ($t in @(Get-ScheduledTask -ErrorAction SilentlyContinue)) {
    $acts = ($t.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments) $($_.WorkingDirectory)" }) -join ' | '
    if ($t.TaskName -like 'Godspeed*' -or $acts -match 'Godspeed') { $lines += "task: $($t.TaskName) -> $acts" }
  }
  foreach ($k in @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue)) {
    $p = Get-ItemProperty -LiteralPath $k.PSPath
    $all = "$($k.PSChildName) $($p.DisplayName) $($p.InstallLocation) $($p.UninstallString) $($p.DisplayIcon)"
    if ($all -match 'Godspeed') { $lines += "uninstall: $all" }
  }
  $lines
}

function Save-State([string]$P, [string]$StateFolder) {
  Set-Content -LiteralPath (Join-Path $Evidence "localappdata-$P.txt") -Value @(Get-ChildItem -LiteralPath $local -Directory -Force | ForEach-Object { $_.Name })
  $rel = @()
  if (Test-Path -LiteralPath $StateFolder) {
    $root = (Resolve-Path -LiteralPath $StateFolder).Path.TrimEnd('\')
    $rel = @(Get-ChildItem -LiteralPath $StateFolder -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring($root.Length + 1) })
  }
  Set-Content -LiteralPath (Join-Path $Evidence "files-$P.txt") -Value $rel
  if ($P -eq 'before') { return }
  Set-Content -LiteralPath (Join-Path $Evidence "names-$P.txt") -Value @(Get-Seen)
  $health = Wait-Health $(if ($P -eq 'held') { 120 } else { 180 })
  Set-Content -LiteralPath (Join-Path $Evidence "health-$P.txt") -Value $health
  $notes = ''
  try { $notes = (Get-Query '{"table":"notes","operation":"select"}').data | ForEach-Object { "$($_.id)`t$($_.title)" } } catch { $notes = '' }
  Set-Content -LiteralPath (Join-Path $Evidence "notes-$P.txt") -Value $notes
  Set-Content -LiteralPath (Join-Path $Evidence "reminders-$P.txt") -Value (Invoke-Due @('list'))
  $log = @()
  foreach ($f in $setupLog, $moveNote) { if (Test-Path -LiteralPath $f) { $log += Get-Content -LiteralPath $f } }
  Set-Content -LiteralPath (Join-Path $Evidence "setup-log-$P.txt") -Value $log
}

# 1. The old install.
$fromSetup = Get-Setup $From 'from'
$toSetup = Get-Setup $StageRef 'to'
$code = Invoke-Setup $fromSetup @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') 'setup-from.log'
if ($code -ne 0) { Stop-Scenario "the setup of $From ended with exit $code" }
if (-not (Test-Path -LiteralPath $oldProgram) -or -not (Test-Path -LiteralPath (Join-Path $oldState 'installation.json'))) {
  Stop-Scenario "$From did not make $oldProgram and $oldState, so the start is not an old install"
}
$h = Wait-Health 240
if ($h -ne 'ok') { Stop-Scenario "the notebook of $From does not answer: $h" }

# 2. A note and a reminder, through the notebook's own doors.
$body = @{ table = 'notes'; operation = 'insert'; values = @{ id = $NoteId; title = $NoteTitle; content = 'A note the owner wrote before the move.' }; selection = '*'; single = $true } | ConvertTo-Json -Depth 5 -Compress
try { Get-Query $body | Out-Null } catch { Stop-Scenario "the note could not be written: $($_.Exception.Message)" }
$added = Invoke-Due @('add', $ReminderTitle, '--date', (Get-Date).AddDays(30).ToString('yyyy-MM-dd'))
Say "due add: $added"
if ((Invoke-Due @('list')) -notmatch [regex]::Escape($ReminderTitle)) { Stop-Scenario "the reminder could not be written: $added" }

# 3. A file held open in the old state folder, on the second run.
$handle = $null
if ($Held) {
  $handle = [IO.File]::Open((Join-Path $oldState $HeldName), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::Write, [IO.FileShare]::None)
  Say "Holding $HeldName open for writing in $oldState"
}
Save-State 'before' $oldState

# 4. The update, the way a reader updates: the installed "Update my mission control" (the installed
# update-godspeed.ps1), which runs the newest release's setup. Its -ReleaseBase is the stage's release
# folder instead of releases/latest; nothing else of it is changed. Windows PowerShell 5.1 runs it, as the
# Start menu entry does.
function Invoke-Update([string]$P) {
  $updater = @(Get-ChildItem -LiteralPath $oldProgram, (Join-Path $local 'Godspeed Mission Control') -Filter 'update-godspeed*.ps1' -ErrorAction SilentlyContinue |
      Select-Object -First 1)
  if (-not $updater.Count) { Stop-Scenario "the install has no update-godspeed.ps1 to run as the reader's update" }
  $out = Join-Path $Evidence "updater-$P.log"
  Say "Running $($updater[0].FullName) -ReleaseBase $(Split-Path $toSetup)"
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $p = Start-Process -FilePath $ps -PassThru -RedirectStandardOutput $out -RedirectStandardError "$out.err" -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$($updater[0].FullName)`"", '-ReleaseBase', "`"$(Split-Path $toSetup)`"", '-NoPause')
  if (-not $p.WaitForExit(60 * 60 * 1000)) { Stop-Process -Id $p.Id -Force; Stop-Scenario 'the update did not end within an hour' }
  Say "  the update ended with exit $($p.ExitCode)"
  Set-Content -LiteralPath (Join-Path $Evidence "update-exit-$P.txt") -Value $p.ExitCode
}
if (Test-Path -LiteralPath $setupLog) { Remove-Item -LiteralPath $setupLog -Force -ErrorAction SilentlyContinue }
Invoke-Update $(if ($Held) { 'held' } else { 'after' })
if ($Held) {
  # With a folder held the update may end either way; what it must show is in the held checks.
  Save-State 'held' $oldState
  $handle.Dispose()
  Say 'Released. The next update:'
  if (Test-Path -LiteralPath $setupLog) { Remove-Item -LiteralPath $setupLog -Force -ErrorAction SilentlyContinue }
  Invoke-Update 'after'
}
Save-State 'after' $newState
$line = Test-Evidence $Evidence
Finish $line $(if ($line.StartsWith('PASS')) { 0 } else { 1 })
