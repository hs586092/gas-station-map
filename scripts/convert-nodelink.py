"""
표준노드링크 SHP -> JSON 변환 스크립트
주요 도로(ROAD_RANK 101~106)만 추출하여 WGS84 좌표로 변환

사용법:
  pip install pyshp pyproj
  python scripts/convert-nodelink.py /path/to/[2026-01-13]NODELINKDATA

출력: data/road_links.json
"""

import sys
import os
import json
import math

try:
    import shapefile
except ImportError:
    print("pyshp 필요: pip install pyshp")
    sys.exit(1)

try:
    from pyproj import Transformer
    transformer = Transformer.from_crs("EPSG:5186", "EPSG:4326", always_xy=True)
    USE_PYPROJ = True
except ImportError:
    print("[WARN] pyproj 없음 - 간이 변환 사용 (오차 ~10m)")
    USE_PYPROJ = False


def tm_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """EPSG:5186 (ITRF2000 중부원점) -> WGS84 변환"""
    if USE_PYPROJ:
        lon, lat = transformer.transform(x, y)
        return lon, lat

    # 간이 역변환
    lon0, lat0 = 127.0, 38.0
    fe, fn = 200000.0, 600000.0
    dx = x - fe
    dy = y - fn
    lat = lat0 + dy / 111000.0
    lon = lon0 + dx / (111000.0 * math.cos(math.radians(lat)))
    return lon, lat


# 주요 도로만 필터링 (107=시군구도 제외)
MAJOR_RANKS = {"101", "102", "103", "104", "105", "106"}

RANK_NAMES = {
    "101": "고속도로",
    "102": "도시고속도로",
    "103": "일반국도",
    "104": "특별광역시도",
    "105": "국가지원지방도",
    "106": "지방도",
}


def get_centroid(points: list[tuple[float, float]]) -> tuple[float, float]:
    """폴리라인의 중심점 계산"""
    if len(points) == 1:
        return points[0]
    # 길이 가중 중심 대신 단순 중간점 사용 (충분히 정확)
    mid_idx = len(points) // 2
    return points[mid_idx]


def main():
    if len(sys.argv) < 2:
        print(f"사용법: python {sys.argv[0]} <NODELINKDATA 디렉토리>")
        sys.exit(1)

    data_dir = sys.argv[1]
    link_path = os.path.join(data_dir, "MOCT_LINK")

    if not os.path.exists(link_path + ".shp"):
        print(f"파일 없음: {link_path}.shp")
        sys.exit(1)

    print(f"Reading {link_path}.shp ...")
    sf = shapefile.Reader(link_path, encoding="cp949")
    total = len(sf)
    print(f"Total links: {total:,}")

    results = []
    skipped = 0

    for i, sr in enumerate(sf.iterShapeRecords()):
        rec = sr.record
        rank = rec["ROAD_RANK"]

        if rank not in MAJOR_RANKS:
            skipped += 1
            continue

        pts = sr.shape.points
        # 중심점 좌표 변환
        cx, cy = get_centroid(pts)
        clon, clat = tm_to_wgs84(cx, cy)

        # 시종점 좌표 변환
        sx, sy = pts[0]
        ex, ey = pts[-1]
        slon, slat = tm_to_wgs84(sx, sy)
        elon, elat = tm_to_wgs84(ex, ey)

        results.append({
            "link_id": rec["LINK_ID"],
            "f_node": rec["F_NODE"],
            "t_node": rec["T_NODE"],
            "road_name": rec["ROAD_NAME"],
            "road_rank": rank,
            "road_no": rec["ROAD_NO"],
            "lanes": rec["LANES"],
            "max_spd": rec["MAX_SPD"],
            "length": round(rec["LENGTH"], 1),
            "center_lat": round(clat, 6),
            "center_lng": round(clon, 6),
            "start_lat": round(slat, 6),
            "start_lng": round(slon, 6),
            "end_lat": round(elat, 6),
            "end_lng": round(elon, 6),
        })

        if (i + 1) % 100000 == 0:
            print(f"  Processed {i+1:,}/{total:,} ({len(results):,} kept)")

    print(f"\nDone: {len(results):,} major road links (skipped {skipped:,} minor roads)")

    # 통계
    rank_counts = {}
    for r in results:
        rk = r["road_rank"]
        rank_counts[rk] = rank_counts.get(rk, 0) + 1

    print("\nRoad rank distribution:")
    for rk in sorted(rank_counts):
        print(f"  {rk} ({RANK_NAMES.get(rk, '?')}): {rank_counts[rk]:,}")

    # 출력
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "road_links.json")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False)

    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f"\nSaved: {out_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
