#!/bin/bash
#
# road_links.json -> Supabase 업로드 스크립트
# 사용법: ./scripts/upload-road-links.sh [BASE_URL] [CRON_SECRET]
#
# 예시:
#   ./scripts/upload-road-links.sh http://localhost:3000 your-cron-secret
#   ./scripts/upload-road-links.sh https://your-app.vercel.app your-cron-secret

set -e

BASE_URL="${1:-http://localhost:3000}"
CRON_SECRET="${2:-$CRON_SECRET}"
DATA_FILE="$(dirname "$0")/../data/road_links.json"
CHUNK_SIZE=5000

if [ ! -f "$DATA_FILE" ]; then
  echo "ERROR: $DATA_FILE 파일이 없습니다."
  echo "먼저 python scripts/convert-nodelink.py 를 실행하세요."
  exit 1
fi

TOTAL=$(python3 -c "import json; print(len(json.load(open('$DATA_FILE'))))")
echo "Total links: $TOTAL"
echo "Uploading in chunks of $CHUNK_SIZE to $BASE_URL ..."

OFFSET=0
CHUNK_NUM=0

while [ $OFFSET -lt $TOTAL ]; do
  CHUNK_NUM=$((CHUNK_NUM + 1))
  END=$((OFFSET + CHUNK_SIZE))
  if [ $END -gt $TOTAL ]; then END=$TOTAL; fi

  echo -n "  Chunk $CHUNK_NUM ($OFFSET ~ $END) ... "

  # Python으로 청크 추출 후 curl로 전송
  RESPONSE=$(python3 -c "
import json, sys
data = json.load(open('$DATA_FILE'))
chunk = data[$OFFSET:$END]
print(json.dumps({'links': chunk}))
" | curl -s -X POST "$BASE_URL/api/upload-road-links" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $CRON_SECRET" \
    -d @-)

  echo "$RESPONSE"
  OFFSET=$END
done

echo ""
echo "Done! Uploaded $TOTAL road links."
