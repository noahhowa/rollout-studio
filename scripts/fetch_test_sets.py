#!/usr/bin/env python3
"""Download reference photos listed in test-sets/manifest.json.

Per-site extractors pick only the object's own gallery at full resolution:
  met                    public collection API (primaryImage + additionalImages)
  sothebys               gallery images, fetched from the original S3 file
  precolumbianart4sale   images tagged with the work number from the URL
  (anything else)        generic: og:image / JSON-LD / <img> scrape
Images are saved as JPEG, longest side capped at MAX_SIDE. Needs Pillow.
Sites that block automated downloads (Christie's) are marked "manual" in the
manifest: save the photos into <set>/photos/ by hand.
"""
import io, json, re, sys, html, urllib.request, urllib.parse
from pathlib import Path
from PIL import Image

MAX_SIDE = 3000

ROOT = Path(__file__).resolve().parent.parent / "test-sets"
IMG_EXT = re.compile(r"\.(jpe?g|png|webp)(\?|$)", re.I)


def get(url, tries=4):
    """Fetch with curl (some museum servers refuse Python's default client), with retries."""
    import subprocess, time
    for k in range(tries):  # museum APIs rate-limit and sometimes drop connections
        r = subprocess.run(["curl", "-sSfL", "--max-time", "120", url], capture_output=True)
        if r.returncode == 0 and r.stdout:
            return r.stdout
        if k == tries - 1:
            raise RuntimeError(f"curl failed ({r.returncode}): {r.stderr.decode()[:120]}")
        time.sleep(3 * (k + 1))


def met_images(api):
    d = json.loads(get(api))
    meta = {k: d.get(k) for k in ("title", "objectDate", "dimensions", "accessionNumber", "isPublicDomain")}
    return meta, [u for u in [d.get("primaryImage")] + d.get("additionalImages", []) if u]


def page_title(page):
    m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]*)"', page) or re.search(r"<title>([^<]*)", page)
    return html.unescape(m.group(1)).strip() if m else None


def sothebys_images(url):
    page = get(url).decode("utf-8", "replace")
    best = {}  # original S3 file -> largest displayed width
    for m in re.finditer(r'https://sothebys-md\.brightspotcdn\.com/[^"\s,]*?resize/(\d+)x\d+![^"\s,]*?\?url=([^"\s,&]+)', page):
        key = urllib.parse.unquote(html.unescape(m.group(2))).replace("http://", "https://")
        best[key] = max(best.get(key, 0), int(m.group(1)))
    # the lot's own gallery is shown at >=385px; related lots only as small thumbnails
    keys = [k for k, w in best.items() if w >= 385]
    # the lot's own photos share the first image's "<sale>-<lot>" filename prefix; the rest are related lots
    lot = re.match(r"[a-z0-9]+-[a-z0-9]+", keys[0].rsplit("/", 1)[-1]).group(0) if keys else ""
    return {"title": page_title(page)}, [k for k in keys if k.rsplit("/", 1)[-1].startswith(lot)]


def pca_images(url):
    page = get(url).decode("utf-8", "replace")
    work = re.search(r"exhibition_works/(\d+)", url).group(1)
    urls = []
    for tag in re.findall(r"<img[^>]+>", page, re.S):
        if f'data-work-number="{work}"' in tag:
            m = re.search(r'data-img-large="([^"]+)"', tag)
            if m and m.group(1) not in urls:
                urls.append(m.group(1))
    title = re.search(r'id="work-img-%s"[^>]*alt="([^"\n]*)' % work, page)
    dims = re.search(r"Dimensions:\s*([^\n<]*)", page[page.find('id="work-img-%s"' % work):])
    return {"title": html.unescape(title.group(1)) if title else page_title(page),
            "dimensions": html.unescape(dims.group(1)).strip() if dims else None}, [urllib.parse.urljoin(url, u) for u in urls]


def scrape_images(url):
    page = get(url).decode("utf-8", "replace")
    found = []
    for m in re.finditer(r'<meta[^>]+property="og:image(?::url)?"[^>]+content="([^"]+)"', page):
        found.append(m.group(1))
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', page, re.S):
        for m in re.finditer(r'"(https?:[^"]+)"', block):
            if IMG_EXT.search(m.group(1)):
                found.append(m.group(1))
    for m in re.finditer(r'(?:src|data-src|srcset|data-srcset)="([^"]+)"', page):
        # srcset: take the last (usually largest) candidate
        cand = html.unescape(m.group(1)).split(",")[-1].strip().split(" ")[0]
        if IMG_EXT.search(cand):
            found.append(cand)
    urls, seen = [], set()
    for u in found:
        u = urllib.parse.urljoin(url, html.unescape(u).replace("\\/", "/"))
        key = re.sub(r"[?#].*$", "", u)
        if key in seen or re.search(r"logo|icon|sprite|avatar|placeholder", key, re.I):
            continue
        seen.add(key)
        urls.append(u)
    return {"title": page_title(page)}, urls


EXTRACTORS = {"sothebys": sothebys_images, "precolumbianart4sale": pca_images}


def save_jpeg(data, out):
    im = Image.open(io.BytesIO(data))
    im = im.convert("RGB")
    im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    im.save(out, "JPEG", quality=92)
    return im.size


def fetch_set(s):
    if s.get("manual"):
        print(f"{s['id']}: manual (site blocks downloads) - add photos to test-sets/{s['id']}/photos/ by hand")
        return
    d = ROOT / s["id"]
    (d / "photos").mkdir(parents=True, exist_ok=True)
    (d / "rollout").mkdir(exist_ok=True)
    if s.get("images"):
        meta, urls = {"title": s.get("title")}, s["images"]
    elif s.get("api"):
        meta, urls = met_images(s["api"])
    else:
        meta, urls = EXTRACTORS.get(s["source"], scrape_images)(s["url"])
    for old in list((d / "photos").glob("*")) + list((d / "rollout").glob("*")):
        old.unlink()
    rollouts = set(s.get("rollout_images", []))
    saved = []
    for i, u in enumerate(urls, 1):
        try:
            data = get(u)
            iw, ih = Image.open(io.BytesIO(data)).size
            sub = "rollout" if i in rollouts or iw > 2 * ih else "photos"  # wide image = rollout photo
            out = d / sub / f"{i:02d}.jpg"
            w, h = save_jpeg(data, out)
            saved.append({"file": f"{sub}/{out.name}", "size": [w, h], "url": u})
        except Exception as e:  # keep going; report at the end
            print(f"  ! {u}: {e}")
    (d / "meta.json").write_text(json.dumps({"id": s["id"], "source_url": s["url"], **meta, "images": saved}, indent=2) + "\n")
    print(f"{s['id']}: {len(saved)}/{len(urls)} images")


def main():
    sets = json.loads((ROOT / "manifest.json").read_text())["sets"]
    want = set(sys.argv[1:])
    for s in sets:
        if want and s["id"] not in want:
            continue
        try:
            fetch_set(s)
        except Exception as e:
            print(f"{s['id']}: FAILED ({e})")


if __name__ == "__main__":
    main()
