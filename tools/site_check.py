#!/usr/bin/env python3
"""Pre-deploy site check for bukowiecki.co (no dependencies, stdlib only).

Runs in CI before every one.com deploy and on every PR. Exit code 1 blocks the
deploy. Run locally from the repo root:  python3 tools/site_check.py

Checks
  1. Every internal href/src in the deployed HTML resolves to a file.
  2. The homepage has complete share-preview tags (title, description,
     Open Graph, Twitter) and the share image exists.
  3. The homepage has no copy that goes stale (year counts, "currently").
  4. JSON-LD blocks parse.
  5. sitemap.xml parses and every bukowiecki.co URL in it maps to a file.
"""
import glob
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from urllib.parse import unquote, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

# Folders served from their own web root ("/" means that folder).
SITE_ROOTS = {"lab": "lab", "lukasz": "lukasz"}
# Deployed folders whose HTML is checked.
CHECK_GLOBS = ["index.html", "vfxtools/**/*.html", "lab/**/*.html", "lukasz/**/*.html"]
# Known-optional references (local-only config, intentional text).
ALLOW = {
    ("lukasz/index.html", "./mission-config.local.js"),
}
STALE = [
    r"\bseventeen\b", r"\b\d{2}\+?\s+years\b", r"\bcurrently leading\b",
    r"\bAI-native\b", r"\bcurrently\s+(?:cutting|working on|leading)\b",
]
REQUIRED_META = [
    ("title", r"<title>\s*[^<]{10,}</title>"),
    ("description", r'<meta name="description" content="[^"]{50,200}"'),
    ("og:title", r'<meta property="og:title" content="[^"]+"'),
    ("og:description", r'<meta property="og:description" content="[^"]{50,200}"'),
    ("og:url", r'<meta property="og:url" content="https://bukowiecki\.co/"'),
    ("og:image", r'<meta property="og:image" content="https://bukowiecki\.co/[^"]+"'),
    ("twitter:card", r'<meta name="twitter:card" content="summary_large_image"'),
    ("twitter:title", r'<meta name="twitter:title" content="[^"]+"'),
    ("twitter:description", r'<meta name="twitter:description" content="[^"]+"'),
    ("canonical", r'<link rel="canonical" href="https://bukowiecki\.co/"'),
]

errors = []


def fail(msg):
    errors.append(msg)


def site_root_for(path):
    top = path.split("/", 1)[0]
    return SITE_ROOTS.get(top, ".")


def check_links():
    files = sorted({f for g in CHECK_GLOBS for f in glob.glob(g, recursive=True)
                    if "node_modules" not in f})
    pat = re.compile(r"""(?:href|src|data-glb)\s*=\s*["']([^"'#?]+)""")
    for f in files:
        html = open(f, encoding="utf-8", errors="ignore").read()
        # ignore code inside <script> blocks; only markup references count
        html = re.sub(r"<script\b(?![^>]*\bsrc=)[^>]*>.*?</script>", "", html, flags=re.S | re.I)
        for m in pat.finditer(html):
            u = m.group(1).strip()
            if (not u or "${" in u or "{{" in u
                    or re.match(r"^(https?:|mailto:|tel:|data:|javascript:|//|file:)", u)):
                continue
            if (f, u) in ALLOW:
                continue
            if u.startswith("/"):
                p = os.path.join(site_root_for(f), unquote(u).lstrip("/"))
            else:
                p = os.path.join(os.path.dirname(f), unquote(u))
            if os.path.isdir(p):
                p = os.path.join(p, "index.html")
            if not os.path.exists(p):
                fail(f"broken link: {f} -> {u}")
    return len(files)


def check_homepage():
    html = open("index.html", encoding="utf-8").read()
    head = html.split("</head>", 1)[0]
    for name, rx in REQUIRED_META:
        if not re.search(rx, head):
            fail(f"index.html: missing or malformed {name}")
    m = re.search(r'<meta property="og:image" content="https://bukowiecki\.co/([^"]+)"', head)
    if m and not os.path.exists(m.group(1)):
        fail(f"index.html: og:image file not in repo: {m.group(1)}")
    text = re.sub(r"<!--.*?-->", "", html, flags=re.S)        # comments don't ship as copy
    text = re.sub(r"<script\b.*?</script>", "", text, flags=re.S | re.I)
    for rx in STALE:
        for hit in re.finditer(rx, text, flags=re.I):
            line = text.count("\n", 0, hit.start()) + 1
            fail(f"index.html: stale copy '{hit.group(0)}' (~line {line})")
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, flags=re.S):
        try:
            json.loads(block)
        except ValueError as e:
            fail(f"index.html: JSON-LD does not parse: {e}")


def check_sitemap():
    for sm, base in (("sitemap.xml", "."), ("lab/sitemap.xml", "lab")):
        if not os.path.exists(sm):
            continue
        try:
            tree = ET.parse(sm)
        except ET.ParseError as e:
            fail(f"{sm}: XML does not parse: {e}")
            continue
        for loc in tree.iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc"):
            u = urlparse(loc.text.strip())
            if u.netloc not in ("bukowiecki.co", "lab.bukowiecki.co"):
                continue
            root = "lab" if u.netloc.startswith("lab.") else "."
            p = os.path.join(root, unquote(u.path).lstrip("/"))
            if p.endswith("/") or os.path.isdir(p):
                p = os.path.join(p, "index.html")
            if not os.path.exists(p):
                fail(f"{sm}: URL has no file: {loc.text.strip()}")


n = check_links()
check_homepage()
check_sitemap()

if errors:
    print(f"site check FAILED ({len(errors)} problem(s)):")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"site check passed — {n} HTML files, homepage meta, stale copy, JSON-LD, sitemaps.")
