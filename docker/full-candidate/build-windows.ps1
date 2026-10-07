param([string]$Distribution='Ubuntu')
$ErrorActionPreference='Stop'
$checkout=(& git rev-parse --show-toplevel).Trim()
if(& git status --porcelain --untracked-files=no){throw 'Commit source before packaging.'}
$revision=(& git rev-parse HEAD).Trim()
$staging=Join-Path $checkout 'notebook/dist'
New-Item -ItemType Directory -Force -Path $staging|Out-Null
$archive=Join-Path $staging ('source-'+$revision+'.tar.gz')
& git archive --format=tar.gz ("--output="+$archive) $revision
if($LASTEXITCODE -ne 0){throw 'Source archive failed'}
$unixArchive=(& wsl -d $Distribution -- wslpath -a $archive.Replace('\','/')).Trim()
$unixCheckout=(& wsl -d $Distribution -- wslpath -a $checkout.Replace('\','/')).Trim()
$script='set -e; candidate=/tmp/godspeed-build-'+$revision+'; mkdir -p "$candidate"; tar -xzf "'+$unixArchive+'" -C "$candidate"; cd "$candidate"; GODSPEED_BUILD_ROOT="$candidate" GODSPEED_BUILD_REVISION='+$revision+' GODSPEED_SOURCE_ARCHIVE="'+$unixArchive+'" bash docker/full-candidate/build.sh; cp notebook/dist/Godspeed-VPS-Full-Alpha-'+$revision+'.tar.gz "'+$unixCheckout+'/notebook/dist/"'
$launcher=Join-Path $staging ('build-'+$revision+'.sh')
[IO.File]::WriteAllText($launcher,$script.Replace("`r`n","`n"),[Text.UTF8Encoding]::new($false))
$unixLauncher=(& wsl -d $Distribution -- wslpath -a $launcher.Replace('\','/')).Trim()
& wsl -d $Distribution -- bash $unixLauncher
if($LASTEXITCODE -ne 0){throw 'Candidate image build failed'}
