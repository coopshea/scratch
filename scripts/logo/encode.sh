#!/bin/sh
# Encode frames/*.png (from scene.html's exportFrames) into the looping logo videos.
set -e
cd "$(dirname "$0")"
OUT=../../public
ffmpeg -y -loglevel error -framerate 30 -i frames/%04d.png -vf scale=384:384:flags=lanczos \
  -c:v libx264 -pix_fmt yuv420p -crf 20 -preset slow -movflags +faststart -an "$OUT/logo-spill.mp4"
ffmpeg -y -loglevel error -framerate 30 -i frames/%04d.png -vf scale=384:384:flags=lanczos \
  -c:v libvpx-vp9 -pix_fmt yuv420p -b:v 0 -crf 34 -row-mt 1 -an "$OUT/logo-spill.webm"
ls -lh "$OUT"/logo-spill.*
