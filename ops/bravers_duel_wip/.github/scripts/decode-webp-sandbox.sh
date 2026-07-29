#!/usr/bin/env bash
set -euo pipefail

# publish-card-set.mjs から渡されるdwebp呼び出しだけを受け付ける。
# 画像decoderに脆弱性があっても、未公開WIP・資格情報・networkへ到達させない。
if [[ $# -ne 4 || "$1" != "-quiet" || "$3" != "-o" || "$4" != "/dev/null" ]]; then
  exit 1
fi
if [[ -z "${WIP_IMAGE_ROOT:-}" || -z "${VALIDATION_RUNTIME_IMAGE:-}" ]]; then
  exit 1
fi

image_root="$(realpath -e "$WIP_IMAGE_ROOT")"
image_path="$(realpath -e "$2")"
if [[ "$(dirname "$image_path")" != "$image_root" || "$image_path" != *.webp ]]; then
  exit 1
fi

container_name="bravers-webp-$$"
cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 1' INT TERM

# timeoutがdocker clientを止めても、EXIT trapでdaemon側containerも明示停止する。
timeout --kill-after=2s 10s docker run --name "$container_name" --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 64 \
  --memory 256m \
  --memory-swap 256m \
  --cpus 1 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
  --user "$(id -u):$(id -g)" \
  --volume "$image_path:/input.webp:ro" \
  "$VALIDATION_RUNTIME_IMAGE" \
  dwebp -quiet /input.webp -o /dev/null
