#!/usr/bin/env bash
# Generates five short, distinct instrumental demo loops with ffmpeg's synthesizer.
# These are Vibii-owned test fixtures (not Suno output, not commercial recordings) and are labelled
# "Demo loop" everywhere they appear.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=fixtures/audio
mkdir -p "$OUT"
DUR=48

# name bpm root-chords(4 x freq triplets) brightness
make() {
  local n=$1 bpm=$2 c1=$3 c2=$4 c3=$5 c4=$6 bright=$7
  local beat; beat=$(python3 -c "print(60/$bpm)")
  local bar; bar=$(python3 -c "print(4*60/$bpm)")
  # chord(t): pick one of 4 root frequencies per bar; triad = root, major/minor third approximations, fifth
  local root="if(eq(mod(floor(t/$bar),4),0),$c1,if(eq(mod(floor(t/$bar),4),1),$c2,if(eq(mod(floor(t/$bar),4),2),$c3,$c4)))"
  local env="(0.55+0.45*exp(-mod(t,$beat)*3))"
  local pad="0.16*$env*(sin(2*PI*($root)*t)+0.7*sin(2*PI*($root)*1.26*t)+0.6*sin(2*PI*($root)*1.5*t)+$bright*0.3*sin(2*PI*($root)*2*t))"
  local bass="0.32*sin(2*PI*($root)/2*t)*exp(-mod(t,$beat/2)*4)"
  local kick="0.55*sin(2*PI*(48+90*exp(-mod(t,$beat)*30))*mod(t,$beat))*exp(-mod(t,$beat)*9)"
  local hat="0.05*$bright*(random(0)*2-1)*exp(-mod(t+$beat/2,$beat)*45)"
  local fade="min(1,t/1.5)*min(1,($DUR-t)/2)"
  ffmpeg -hide_banner -loglevel error -y -f lavfi \
    -i "aevalsrc=exprs='($pad+$bass+$kick+$hat)*$fade|($pad+$bass*0.9+$kick+$hat*1.2)*$fade':s=44100:d=$DUR" \
    -af "lowpass=f=$((5000 + 2000 * bright)),aecho=0.6:0.5:$(python3 -c "print(int(1000*60/$bpm*0.75))"):0.25,loudnorm=I=-16:TP=-1.5" \
    -metadata title="Vibii demo loop $n" -metadata artist="Vibii (locally generated demo)" \
    -metadata comment="Locally synthesised instrumental test fixture. Not a Suno song." \
    -codec:a libmp3lame -b:a 128k "$OUT/demo-loop-$n.mp3"
  echo "wrote $OUT/demo-loop-$n.mp3"
}

make 1 104 220.0 174.6 261.6 196.0 1   # warm pop opener
make 2 122 110.0 130.8 98.0 146.8 2    # night-drive synth
make 3 92 196.0 246.9 220.0 174.6 1    # mellow connection
make 4 84 130.8 146.8 164.8 146.8 0    # focus (soft, no hats)
make 5 72 174.6 220.0 196.0 164.8 0    # evening closer
