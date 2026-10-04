$taskEvidence = Join-Path (Get-Location) '.superpowers/sdd/2026-10-03-godspeed-v2-completeness/caption-evidence'
$taskVoice = New-Object -ComObject SAPI.SpVoice
$taskStream = New-Object -ComObject SAPI.SpFileStream
$taskStream.Open((Join-Path $taskEvidence 'fictional-speech.wav'),3)
$taskVoice.AudioOutputStream = $taskStream
$taskVoice.Speak('This is a fictional caption test. A little red rocket flies above the moon. We keep the original audio and check every word.') | Out-Null
$taskStream.Close()
ffmpeg -y -f lavfi -i 'color=c=0x446688:s=1080x1920:r=24' -i "$taskEvidence/fictional-speech.wav" -shortest -c:v libx264 -preset ultrafast -c:a aac "$taskEvidence/fictional.mp4" *> "$taskEvidence/fixture.log"
& "$taskEvidence/venv/Scripts/python.exe" notebook/recipes/video-captions/scripts/burn.py "$taskEvidence/fictional.mp4" --model tiny --device cpu --font-file third-party/addons/mc-video/fonts/ArchivoBlack-Regular.ttf -o "$taskEvidence/fictional.cpu.captioned.mp4" *> "$taskEvidence/burn-cpu.log"
ffprobe -v error -show_entries stream=codec_type,duration -of json "$taskEvidence/fictional.cpu.captioned.mp4" > "$taskEvidence/stream-probe.json"
ffmpeg -y -ss 3.5 -i "$taskEvidence/fictional.cpu.captioned.mp4" -frames:v 1 "$taskEvidence/visible-3.5.png" *> "$taskEvidence/frame.log"
