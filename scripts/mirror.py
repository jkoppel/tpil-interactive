"""Mirror the rendered Theorem Proving in Lean 4 site into a local directory.

Usage: python3 -I mirror.py OUT_DIR
"""
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = "https://lean-lang.org/theorem_proving_in_lean4/"
out = Path(sys.argv[1])

seen: set[str] = set()
queue: list[str] = [ROOT]


def local_path(url: str) -> Path:
    rel = url[len(ROOT):].split("#")[0].split("?")[0]
    if rel == "" or rel.endswith("/"):
        rel += "index.html"
    return out / rel


def enqueue(url: str) -> None:
    url = url.split("#")[0]
    if url.startswith(ROOT) and "/find/" not in url and url not in seen:
        seen.add(url)
        queue.append(url)


seen.add(ROOT)
while queue:
    url = queue.pop()
    try:
        with urllib.request.urlopen(url) as r:
            data = r.read()
    except Exception as e:  # noqa: BLE001
        print("FAIL", url, e)
        continue
    p = local_path(url)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    print("ok", url)
    if not re.search(r"\.(html|css|js)$", str(p)):
        continue
    text = data.decode("utf-8", "replace")
    base = url
    m = re.search(r'<base href="([^"]*)"', text)
    if m:
        base = urllib.parse.urljoin(url, m.group(1))
    refs = re.findall(r'(?:href|src)="([^"#][^"]*)"', text)
    refs += re.findall(r'url\(["\']?([^"\')]+)["\']?\)', text)
    refs += re.findall(r'(?:import|from)\s*\(?\s*["\'](\.{1,2}/[^"\']+)["\']', text)
    refs += re.findall(r'fetch\(["\']([^"\']+)["\']\)', text)
    for ref in refs:
        if ref.startswith(("data:", "mailto:", "javascript:")):
            continue
        b = base if p.suffix == ".html" else url
        enqueue(urllib.parse.urljoin(b, ref))
