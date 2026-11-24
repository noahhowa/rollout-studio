#!/usr/bin/env bash
set -eu
testroot=$(cd "$(dirname "$0")/.." && pwd)
raw="$testroot/resume/adjust-expanded"
for id in lacma-168596 met-310364; do
  for arm in ${ARMS:-baseline adjusted lower-feather}; do
    folder="$raw/$id"
    [ ! -s "$folder/$arm.png" ] || continue
    inputs="$folder/$arm"
    [ "$arm" != lower-feather ] || inputs="$folder/lower-feather/adjusted"
    if [ "$id" = lacma-168596 ]; then
      python3 "$testroot/run-hf.py" "$inputs" "$folder/$arm.png"
      continue
    fi
    mkdir -p "$folder/$arm-batch1" "$folder/$arm-batch2"
    first=(0 8 3 7 4)
    last=(6 1 5 2)
    for ((i=0; i<5; i++)); do cp "$inputs/strip_${first[i]}.jpg" "$folder/$arm-batch1/strip_$i.jpg"; done
    for ((i=0; i<4; i++)); do cp "$inputs/strip_${last[i]}.jpg" "$folder/$arm-batch2/strip_$((i+1)).jpg"; done
    if [ ! -s "$folder/$arm-interim.png" ]; then
      python3 "$testroot/run-hf.py" "$folder/$arm-batch1" "$folder/$arm-interim.png"
    fi
    node "$testroot/encode-hf-intermediate.cjs" "$folder/$arm-interim.png" "$folder/$arm-batch2/strip_0.jpg"
    python3 "$testroot/run-hf.py" "$folder/$arm-batch2" "$folder/$arm.png"
  done
done
