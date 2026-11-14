#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
server_root="$project_root/kael-server"
export KAEL_SERVER_ROOT="${KAEL_SERVER_ROOT:-$server_root}"
export CARGO_HOME="$server_root/target/cargo-home"
export CARGO_TARGET_DIR="$server_root/target"
export TMPDIR="$server_root/target/tmp"
mkdir -p "$TMPDIR"

command_name=${1:-serve}
if [ "$#" -gt 0 ]; then shift; fi

case "$command_name" in
  build)
    exec cargo build --manifest-path "$server_root/Cargo.toml" --release "$@"
    ;;
  check)
    exec cargo check --manifest-path "$server_root/Cargo.toml" "$@"
    ;;
  dev)
    exec cargo run --manifest-path "$server_root/Cargo.toml" -- serve "$@"
    ;;
  setup)
    exec cargo run --manifest-path "$server_root/Cargo.toml" -- setup "$@"
    ;;
  serve|web)
    if [ "$command_name" = web ]; then
      export KAEL_WEB_ROOT="${KAEL_WEB_ROOT-$project_root/kael-client/dist}"
    fi
    executable="$server_root/target/release/kael-server"
    if [ ! -x "$executable" ]; then
      printf '%s\n' 'Build backend terlebih dahulu dengan npm run build:server.' >&2
      exit 1
    fi
    exec "$executable" serve "$@"
    ;;
  *)
    printf '%s\n' 'Perintah tersedia: build, check, dev, setup, serve, web.' >&2
    exit 2
    ;;
esac
