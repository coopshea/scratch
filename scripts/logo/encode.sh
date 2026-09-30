#!/bin/sh
# Publish a rendered variant to public/ as mp4 + webm, plus a still of its first frame.
#   encode.sh roll-fixed loading "crop=512:300:0:106"
set -e
cd "$(dirname "$0")"
NAME=${1:?usage: encode.sh <variant> <output name> [ffmpeg filter]}
BASE=${2:?usage: encode.sh <variant> <output name> [ffmpeg filter]}
VF=${3:-null}
OUT=../../public
ffmpeg -y -loglevel error -framerate 30 -i "frames/$NAME/%04d.png" -vf "$VF" \
  -c:v libx264 -pix_fmt yuv420p -crf 20 -preset slow -movflags +faststart -an "$OUT/$BASE.mp4"
ffmpeg -y -loglevel error -framerate 30 -i "frames/$NAME/%04d.png" -vf "$VF" \
  -c:v libvpx-vp9 -pix_fmt yuv420p -b:v 0 -crf 34 -row-mt 1 -an "$OUT/$BASE.webm"
ffmpeg -y -loglevel error -i "frames/$NAME/0000.png" -vf "$VF" -frames:v 1 "$OUT/$BASE.png"
ls -lh "$OUT/$BASE".*
