# 1. What you need before the one line

The setup does almost everything itself. This page is what it cannot do, and what it will
ask you before it does something.

## Already there if you built the mission control from the book

- **Your mission control**, on the computer where your videos are. The setup finds it the way the kit's
  installer recorded it. If it cannot, run the line from inside your mission control folder, or add
  `--godspeed` and the folder: `npx --yes github:MichaelZelbel/mc-video setup --godspeed ~/godspeed`.
- **Node.js 22 or newer.** Type `node -v`. If the number starts below 22, install the current
  version from https://nodejs.org and open a new terminal.

This add-on is for your laptop or desktop, not the server from Chapter 32. Video work is heavy,
your footage is on your computer, and you want to watch the result where you made it.

## What the setup offers to install, and asks first

- **ffmpeg**, the program that reads and writes video files. The setup uses one that can write
  H.264 video and draw captions, and says so if the one it finds cannot.
  - Windows: it offers `winget install --id Gyan.FFmpeg -e`. The `ffmpeg` that Windows sometimes
    has already is an empty placeholder from the Microsoft Store; the setup skips it.
  - macOS: it offers `brew install ffmpeg` if you have Homebrew (https://brew.sh). Without
    Homebrew it says so, and you install Homebrew first.
  - Linux: it offers `sudo apt-get install -y ffmpeg unzip`, which asks for your password.
    `unzip` is there because HyperFrames unpacks its browser with it and a fresh Ubuntu has none.
- **uv**, a small program that installs a private Python for the speech model, so the Python
  you may already have is left alone.

Say no to either and the setup prints the line to run yourself, then carries on with the rest
and tells you at the end what is still missing. Run the setup again when you have done it.

## Disk and time

About 1.5 GB in total, measured in September 2026:

- the speech model's code in a private Python, in `~/.mc-video/venv` (420 MB on Ubuntu, 260 MB
  on Windows, where uv reused a Python that was already installed);
- the speech model itself (460 MB), downloaded the first time anything is captioned;
- HyperFrames, in `~/.mc-video/hyperframes` (370 MB);
- the browser HyperFrames draws with (a 114 MB download, 260 MB unpacked), the first time
  anything is rendered.

The first setup took 1 minute 42 seconds on the author's Windows desktop, downloads included.
A second run took 34 seconds, most of it the proof.

## If the title card does not render

The setup prints the last lines HyperFrames wrote. `mc-video hyperframes doctor` then lists
what this computer has and lacks, one line each, with a hint for each missing piece. On Linux,
headless Chrome needs a handful of system libraries; the Ubuntu the add-on was tested on had all
of them already.

## A graphics card is optional

Captions are heard on the graphics card when an NVIDIA card and its libraries are there, and
on the processor otherwise; the setup's proof says which one it used. The processor is slower
but gets there.
