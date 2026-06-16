#!/usr/bin/env python3
"""
extract_level.py — Deeplight image -> graph level extractor.

Turns a hand-drawn top-down level PNG into a navigable graph JSON
(validated against deeplight.level.schema.json) and a debug overlay PNG.

Pipeline (see README "Extraction stages"):
  1. mask UI corners (title / design-notes / legend) for icon search
  2. teal tunnel mask -> morphology -> skeletonize (1px centerline)
  3. sknw -> nodes (junctions/endpoints) + edge polylines; merge & simplify
  4. start/exit from endpoint positions; other endpoints -> dead ends
  5. legend swatches auto-cropped (grid self-calibrated from saturated icons)
  6. masked multi-scale template match for placed icons, constrained near tunnels
  7. snap each icon to nearest edge (edgeId + t) or node
  8. emit levelNN.json + levelNN.debug.png

Local authoring tool only. The shipped game loads the JSON, never the image.

Usage:
  python extract_level.py levels/source/level01.png --out levels --debug
  python extract_level.py levels/source/*.png       --out levels --debug
"""

import argparse, glob, json, os, sys
import numpy as np
from PIL import Image
import cv2
from skimage.morphology import skeletonize
import sknw

EXTRACTOR_VERSION = "1.0"

# ---- shared thresholds (same for all 10 maps; no per-map hand-tuning) --------
TEAL_G_MIN      = 80      # tunnel: green channel bright
TEAL_G_OVER_R   = 12      # tunnel: greener than red
TEAL_B_MIN      = 35      # tunnel: some blue (teal, not pure green)
MORPH_CLOSE     = 7       # px: bridge small gaps in tunnel mask
MORPH_OPEN      = 3       # px: drop speckle
MIN_TUNNEL_AREA = 2000    # px: drop blobs smaller than this from tunnel mask
HOLE_MAX_AREA   = 5000    # px: seal holes smaller than this (icons); keep route-loop islands
NODE_MERGE_PX   = 24      # merge graph nodes closer than this
MIN_SPUR_PX     = 40      # drop dangling edges shorter than this (skeleton artifacts)
SIMPLIFY_EPS    = 2.5     # px: Douglas-Peucker tolerance for polylines

# UI corner boxes (fractional x0,y0,x1,y1) — blanked for ICON search only.
UI_BOXES = {
    "title":  (0.00, 0.00, 0.42, 0.06),
    "notes":  (0.00, 0.73, 0.34, 1.00),
    "legend": (0.60, 0.64, 1.00, 1.00),
}

# canonical legend order, top -> bottom. mult3x only present on some maps.
LEGEND_ORDER_7 = ["start_exit", "debris", "hostile", "shipwreck", "star", "mult2x", "deadend"]
LEGEND_ORDER_8 = ["start_exit", "debris", "hostile", "shipwreck", "star", "mult2x", "mult3x", "deadend"]

# placed-icon types we template-match on the map (start/exit & deadend come from graph)
MATCH_TYPES = ["debris", "hostile", "shipwreck", "star", "mult2x", "mult3x"]
MATCH_DS     = 0.5       # downscale factor for template matching (speed; ~16x)
MATCH_SCALES = np.linspace(0.7, 1.5, 7)
MATCH_THRESH = {  # per-type min normalized-corr; tuned against overlays
    "star": 0.45, "mult2x": 0.50, "mult3x": 0.50,
    "hostile": 0.42, "debris": 0.40, "shipwreck": 0.40,
}
SNAP_MAX_N = 0.06   # max normalized dist from an icon to a tunnel to keep it
NODE_SNAP_N = 0.022 # attach to node instead of edge if within this


# =============================================================================
# helpers
# =============================================================================
def log(msg): print(f"  {msg}", flush=True)

def box_px(box, W, H):
    x0, y0, x1, y1 = box
    return int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)


def fill_small_holes(binary, max_area):
    """Fill enclosed holes smaller than max_area px. Keeps large holes (the rock
    islands that form real route loops, and the shipwreck void) OPEN so loop
    topology survives; seals icon-sized holes (icons are drawn on the tunnels and
    aren't teal, so they punch false holes that would create skeleton branches)."""
    inv = (binary == 0).astype(np.uint8)
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(inv, 8)
    out = binary.copy()
    border = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    for i in range(1, n):
        if i in border:           # touches image edge -> real background, keep
            continue
        if stats[i, cv2.CC_STAT_AREA] < max_area:
            out[lbl == i] = 1     # seal small interior hole (icon)
    return out


def tunnel_mask(rgb, ui_boxes=None):
    """Boolean mask of the bright teal tunnel paths."""
    H, W, _ = rgb.shape
    r = rgb[..., 0].astype(int); g = rgb[..., 1].astype(int); b = rgb[..., 2].astype(int)
    m = (g > TEAL_G_MIN) & (g > r + TEAL_G_OVER_R) & (b > TEAL_B_MIN) & (b < g + 60)
    m = m.astype(np.uint8)
    if ui_boxes:  # drop title/legend/notes teal (text + icons), not real tunnels
        for box in ui_boxes.values():
            x0, y0, x1, y1 = box_px(box, W, H)
            m[y0:y1, x0:x1] = 0
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((MORPH_CLOSE, MORPH_CLOSE), np.uint8))
    # keep only large connected components (drop speckle)
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_TUNNEL_AREA:
            keep[lbl == i] = 1
    keep = fill_small_holes(keep, HOLE_MAX_AREA)   # seal icon-holes, keep route loops
    keep = cv2.morphologyEx(keep, cv2.MORPH_OPEN, np.ones((MORPH_OPEN, MORPH_OPEN), np.uint8))
    return keep > 0


def build_graph(skel):
    """sknw -> dict graph: nodes {id:(x,y,deg)}, edges [(a,b,[(x,y)...])]. pixel coords."""
    g = sknw.build_sknw(skel.astype(np.uint16), multi=False)
    nodes = {}
    for nid in g.nodes():
        y, x = g.nodes[nid]["o"]
        nodes[nid] = [float(x), float(y), g.degree(nid)]
    edges = []
    for a, b in g.edges():
        pts = g[a][b]["pts"]  # (row,col) = (y,x)
        poly = [(float(p[1]), float(p[0])) for p in pts]
        # order endpoints to match node a -> b
        ax, ay, _ = nodes[a];
        if poly and (abs(poly[0][0] - ax) + abs(poly[0][1] - ay)) > (abs(poly[-1][0] - ax) + abs(poly[-1][1] - ay)):
            poly = poly[::-1]
        # ensure the node coords are the true endpoints
        poly = [(ax, ay)] + poly + [(nodes[b][0], nodes[b][1])]
        edges.append([a, b, poly])
    return nodes, edges


def merge_nodes(nodes, edges, radius):
    """Merge nodes within `radius` px (junction clusters). Returns remapped graph."""
    ids = list(nodes.keys())
    parent = {i: i for i in ids}
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            if (nodes[a][0]-nodes[b][0])**2 + (nodes[a][1]-nodes[b][1])**2 <= radius*radius:
                parent[find(a)] = find(b)
    # new node = centroid of cluster, degree summed later
    groups = {}
    for i in ids: groups.setdefault(find(i), []).append(i)
    newnodes, remap = {}, {}
    for root, members in groups.items():
        xs = np.mean([nodes[m][0] for m in members]); ys = np.mean([nodes[m][1] for m in members])
        newnodes[root] = [xs, ys, 0]
        for m in members: remap[m] = root
    newedges = []
    for a, b, poly in edges:
        ra, rb = remap[a], remap[b]
        if ra == rb:  # collapsed self-loop, drop
            continue
        poly = [(newnodes[ra][0], newnodes[ra][1])] + poly[1:-1] + [(newnodes[rb][0], newnodes[rb][1])]
        newedges.append([ra, rb, poly])
    # recompute degree
    for n in newnodes: newnodes[n][2] = 0
    for a, b, _ in newedges:
        newnodes[a][2] += 1; newnodes[b][2] += 1
    return newnodes, newedges


def poly_len(poly):
    return sum(np.hypot(poly[i+1][0]-poly[i][0], poly[i+1][1]-poly[i][1]) for i in range(len(poly)-1))


def drop_spurs(nodes, edges, min_len):
    """Remove tiny dangling edges (skeleton artifacts) that end in a degree-1 node."""
    changed = True
    while changed:
        changed = False
        deg = {n: 0 for n in nodes}
        for a, b, _ in edges: deg[a]+=1; deg[b]+=1
        keep = []
        for a, b, poly in edges:
            short = poly_len(poly) < min_len
            dangling = deg[a] == 1 or deg[b] == 1
            if short and dangling:
                changed = True; continue
            keep.append([a, b, poly])
        edges = keep
        used = set()
        for a, b, _ in edges: used.add(a); used.add(b)
        nodes = {n: v for n, v in nodes.items() if n in used}
    return nodes, edges


def simplify(poly, eps):
    if len(poly) <= 2: return poly
    arr = np.array(poly, dtype=np.float32).reshape(-1, 1, 2)
    out = cv2.approxPolyDP(arr, eps, False).reshape(-1, 2)
    return [(float(p[0]), float(p[1])) for p in out]


# =============================================================================
# legend swatch extraction (self-calibrating grid)
# =============================================================================
def hue_class(rgb_mean):
    r, g, b = rgb_mean
    mx = max(r, g, b); mn = min(r, g, b)
    if mx < 50: return "dark"
    if mx - mn < 25: return "grey"
    if r > 150 and g > 130 and b < 130: return "yellow"
    if r > 110 and r > g + 35 and r > b + 25: return "red"
    if b > 110 and b > r + 20 and b >= g - 30: return "blue"
    if g > 110 and g > r + 20 and g > b: return "green"
    return "brown"


def extract_legend(rgb, debug_draw=None):
    """Return dict type->{'tmpl':BGR crop,'mask':uint8,'cx','cy'} (pixel coords)."""
    H, W, _ = rgb.shape
    lx0, ly0, lx1, ly1 = box_px(UI_BOXES["legend"], W, H)
    crop = rgb[ly0:ly1, lx0:lx1]
    ch, cw, _ = crop.shape
    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
    S, V = hsv[..., 1], hsv[..., 2]
    # saturated, bright blobs = the colourful anchor icons (green/red/yellow/blue)
    fg = ((S > 90) & (V > 90)).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lbl, stats, cent = cv2.connectedComponentsWithStats(fg, 8)
    blobs = []
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        w, h = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
        if area < 120 or w < 8 or h < 8: continue
        cx, cy = cent[i]
        col = crop[lbl == i].mean(axis=0)
        blobs.append({"cx": cx, "cy": cy, "w": w, "h": h, "area": area, "hue": hue_class(col)})
    if not blobs:
        raise RuntimeError("legend: no anchor icons found")
    # icon column x = modal x of the colourful anchor blobs
    xs = np.array([b["cx"] for b in blobs])
    col_x = float(np.median(xs))
    anchors = [b for b in blobs if abs(b["cx"] - col_x) < cw * 0.12]
    # has_3x from the number of BLUE multiplier swatches (saturated -> reliable)
    blues = sorted([b for b in anchors if b["hue"] == "blue"], key=lambda b: b["cy"])
    has_3x = len(blues) >= 2
    order = LEGEND_ORDER_8 if has_3x else LEGEND_ORDER_7
    idx_of = {t: i for i, t in enumerate(order)}
    # Fit the evenly-spaced row grid from anchors at KNOWN canonical indices.
    # (START/EXIT swatch is a yellow sub, so the two yellow blobs are sub=row0 &
    #  star; assign them by vertical order to avoid the colour collision.)
    yellows = sorted([b for b in anchors if b["hue"] == "yellow"], key=lambda b: b["cy"])
    reds = sorted([b for b in anchors if b["hue"] == "red"], key=lambda b: b["cy"])
    pts = []
    if len(yellows) >= 2:
        pts += [(idx_of["start_exit"], yellows[0]["cy"]), (idx_of["star"], yellows[-1]["cy"])]
    elif len(yellows) == 1:
        pts.append((idx_of["star"], yellows[0]["cy"]))
    if reds:
        pts.append((idx_of["hostile"], reds[0]["cy"]))
    for k, b in enumerate(blues[:2]):
        pts.append((idx_of["mult2x" if k == 0 else "mult3x"], b["cy"]))
    if len(pts) < 2:
        raise RuntimeError("legend: not enough anchors to fit row grid")
    A = np.array([[1, i] for i, _ in pts], float); yv = np.array([y for _, y in pts], float)
    (y0, pitch), *_ = np.linalg.lstsq(A, yv, rcond=None)
    rows = [int(round(y0 + pitch * i)) for i in range(len(order))]
    sw = int(abs(pitch) * 0.95); swh = sw // 2
    out = {}
    for t in order:
        i = idx_of[t]
        cy = int(rows[i]); cx = int(round(col_x))
        x0 = max(0, cx - swh); x1 = min(cw, cx + swh)
        yy0 = max(0, cy - swh); yy1 = min(ch, cy + swh)
        sub = crop[yy0:yy1, x0:x1]
        if sub.size == 0: continue
        bgr = cv2.cvtColor(sub, cv2.COLOR_RGB2BGR)
        subhsv = cv2.cvtColor(sub, cv2.COLOR_RGB2HSV)
        mask = ((subhsv[..., 2] > 45)).astype(np.uint8) * 255  # icon over dark panel
        out[t] = {"tmpl": bgr, "mask": mask, "cx": lx0 + cx, "cy": ly0 + cy}
        if debug_draw is not None:
            cv2.rectangle(debug_draw, (lx0 + x0, ly0 + yy0), (lx0 + x1, ly0 + yy1), (0, 255, 255), 1)
    return out, has_3x


# =============================================================================
# icon detection by colour blobs (fast + robust; the maps use a discrete palette)
# =============================================================================
# HSV ranges (OpenCV: H 0-180). Tunnels are teal (H~80-95) and are excluded.
# Brown (debris/wreck) is detected separately in RGB (R>G>B), see detect_icons.
COLOR_RANGES = {
    "hostile": [((0, 90, 80), (12, 255, 255)), ((168, 90, 80), (180, 255, 255))],  # red
    "star":    [((18, 90, 120), (38, 255, 255))],                                   # yellow
    "blue":    [((100, 80, 90), (132, 255, 255))],                                  # mult 2x/3x
}
ICON_MIN_AREA   = 180     # px: ignore tiny colour specks
DEBRIS_MIN_AREA = 350     # px: min brown blob to count as debris
SHIPWRECK_AREA  = 6000    # px: consolidated brown blob this big = the shipwreck


def classify_mult(crop_bgr, legend):
    """Blue circle -> 'mult2x' or 'mult3x' by matching the two legend swatches."""
    if "mult2x" not in legend or "mult3x" not in legend:
        return "mult2x"
    g = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    best, bt = -1, "mult2x"
    for t in ("mult2x", "mult3x"):
        tm = cv2.cvtColor(legend[t]["tmpl"], cv2.COLOR_BGR2GRAY)
        tm = cv2.resize(tm, (g.shape[1], g.shape[0]))
        s = cv2.matchTemplate(g.astype(np.float32), tm.astype(np.float32), cv2.TM_CCOEFF_NORMED)[0, 0]
        if s > best: best, bt = s, t
    return bt


def detect_icons(rgb, legend, mask):
    """Return list of {type,cx,cy,score} (pixel coords) via colour-blob detection.
    Red/yellow/blue via HSV; brown debris/wreck via RGB (R>G>B) near the tunnels."""
    H, W, _ = rgb.shape
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    ui = np.zeros((H, W), np.uint8)
    for box in UI_BOXES.values():
        x0, y0, x1, y1 = box_px(box, W, H); ui[y0:y1, x0:x1] = 1
    hsv[ui > 0] = 0
    out = []
    # --- red / yellow / blue ---
    for key, ranges in COLOR_RANGES.items():
        m = np.zeros((H, W), np.uint8)
        for lo, hi in ranges:
            m |= cv2.inRange(hsv, np.array(lo), np.array(hi))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        n, lbl, stats, cent = cv2.connectedComponentsWithStats(m, 8)
        for i in range(1, n):
            area = stats[i, cv2.CC_STAT_AREA]
            if area < ICON_MIN_AREA: continue
            cx, cy = cent[i]
            if key == "blue":
                x0 = stats[i, cv2.CC_STAT_LEFT]; y0 = stats[i, cv2.CC_STAT_TOP]
                w = stats[i, cv2.CC_STAT_WIDTH]; h = stats[i, cv2.CC_STAT_HEIGHT]
                typ = classify_mult(bgr[y0:y0+h, x0:x0+w], legend)
            else:
                typ = key
            out.append({"type": typ, "cx": float(cx), "cy": float(cy),
                        "score": float(min(1.0, area / 3000.0)), "area": int(area)})
    # --- brown debris / shipwreck (R>G>B, modest R-G so red isn't caught) ---
    r = rgb[..., 0].astype(int); g = rgb[..., 1].astype(int); b = rgb[..., 2].astype(int)
    brown = ((r - g >= 5) & (r - g <= 50) & (g - b >= 0) & (r > 55) & (r < 205))
    near = cv2.dilate(mask.astype(np.uint8), np.ones((25, 25), np.uint8)) > 0
    bm0 = (brown & near & (ui == 0)).astype(np.uint8)
    # Pass 1 — SHIPWRECK: a large close consolidates the (sparse) central wreck
    # into one big region; the single largest blob over threshold is the wreck.
    big = cv2.morphologyEx(bm0, cv2.MORPH_CLOSE, np.ones((35, 35), np.uint8))
    n, lbl, stats, cent = cv2.connectedComponentsWithStats(big, 8)
    ship_bbox = None
    if n > 1:
        i = 1 + int(np.argmax([stats[k, cv2.CC_STAT_AREA] for k in range(1, n)]))
        if stats[i, cv2.CC_STAT_AREA] >= SHIPWRECK_AREA:
            cx, cy = cent[i]
            out.append({"type": "shipwreck", "cx": float(cx), "cy": float(cy),
                        "score": 1.0, "area": int(stats[i, cv2.CC_STAT_AREA])})
            x0 = stats[i, cv2.CC_STAT_LEFT]; y0 = stats[i, cv2.CC_STAT_TOP]
            ship_bbox = (x0, y0, x0 + stats[i, cv2.CC_STAT_WIDTH], y0 + stats[i, cv2.CC_STAT_HEIGHT])
    # Pass 2 — DEBRIS: moderate close; skip blobs inside the wreck footprint.
    deb = cv2.morphologyEx(bm0, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    deb = cv2.morphologyEx(deb, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lbl, stats, cent = cv2.connectedComponentsWithStats(deb, 8)
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < DEBRIS_MIN_AREA: continue
        cx, cy = cent[i]
        if ship_bbox and ship_bbox[0] <= cx <= ship_bbox[2] and ship_bbox[1] <= cy <= ship_bbox[3]:
            continue  # part of the shipwreck
        out.append({"type": "debris", "cx": float(cx), "cy": float(cy),
                    "score": float(min(1.0, area / 3000.0)), "area": int(area)})
    return out


# =============================================================================
# snapping icons to the graph
# =============================================================================
def pt_seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx-ax, by-ay
    L2 = dx*dx + dy*dy
    if L2 == 0: return np.hypot(px-ax, py-ay), 0.0
    t = max(0, min(1, ((px-ax)*dx + (py-ay)*dy)/L2))
    cx, cy = ax+t*dx, ay+t*dy
    return np.hypot(px-cx, py-cy), t


def snap_to_graph(p, nodesN, edgesN):
    """p normalized. Return (kind,id,t,dist)."""
    best = (None, None, 0.0, 1e9)
    # nearest node
    for nid, (x, y, _k) in nodesN.items():
        d = np.hypot(p[0]-x, p[1]-y)
        if d < best[3]: best = ("node", nid, 0.0, d)
    node_d = best[3]
    # nearest edge (with arc-length t)
    be = (None, 0.0, 1e9)
    for eid, (a, b, poly) in edgesN.items():
        seglens = [np.hypot(poly[i+1][0]-poly[i][0], poly[i+1][1]-poly[i][1]) for i in range(len(poly)-1)]
        total = sum(seglens) or 1e-9
        acc = 0.0
        for i in range(len(poly)-1):
            d, tt = pt_seg_dist(p, poly[i], poly[i+1])
            if d < be[2]:
                be = (eid, (acc + tt*seglens[i]) / total, d)
            acc += seglens[i]
    if node_d <= NODE_SNAP_N and node_d <= be[2]:
        return ("node", best[1], 0.0, node_d)
    return ("edge", be[0], be[1], be[2])


# =============================================================================
# main per-image
# =============================================================================
def extract(path, outdir, debug):
    name = os.path.splitext(os.path.basename(path))[0]
    print(f"[{name}] {path}")
    rgb = np.asarray(Image.open(path).convert("RGB"))
    H, W, _ = rgb.shape
    warnings = []

    # 1. tunnel mask + skeleton
    mask = tunnel_mask(rgb, UI_BOXES)
    log(f"tunnel pixels: {mask.mean()*100:.1f}%")
    for bn, box in UI_BOXES.items():
        x0, y0, x1, y1 = box_px(box, W, H)
        frac = mask[y0:y1, x0:x1].mean()
        if frac > 0.04:
            warnings.append(f"UI box '{bn}' overlaps tunnel ({frac*100:.0f}%) — graph may be affected")
            log("WARN " + warnings[-1])
    skel = skeletonize(mask)

    # 2. graph
    nodes, edges = build_graph(skel)
    nodes, edges = merge_nodes(nodes, edges, NODE_MERGE_PX)
    nodes, edges = drop_spurs(nodes, edges, MIN_SPUR_PX)
    for e in edges: e[2] = simplify(e[2], SIMPLIFY_EPS)
    log(f"graph: {len(nodes)} nodes, {len(edges)} edges")

    # 3. start/exit + dead ends (by endpoint position)
    deg = {n: 0 for n in nodes}
    for a, b, _ in edges: deg[a]+=1; deg[b]+=1
    endpoints = [n for n in nodes if deg[n] == 1]
    if len(endpoints) < 2:
        warnings.append("fewer than 2 endpoints; start/exit guessed from extremes")
        endpoints = sorted(nodes, key=lambda n: nodes[n][1])
    start = max(endpoints, key=lambda n: nodes[n][1])   # lowest on map
    exit_ = min(endpoints, key=lambda n: nodes[n][1])   # highest on map
    kind = {}
    for n in nodes:
        if n == start: kind[n] = "start"
        elif n == exit_: kind[n] = "exit"
        elif deg[n] == 1: kind[n] = "deadend"
        else: kind[n] = "junction"

    # 4. legend + icons
    dbg = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR).copy() if debug else None
    legend, has_3x = extract_legend(rgb, dbg)
    log(f"legend: {len(legend)} swatches (3x map: {has_3x})")
    icons = detect_icons(rgb, legend, mask)
    log(f"icon blobs detected: {len(icons)}")

    # normalized graph
    nodesN = {f"n{n}": [nodes[n][0]/W, nodes[n][1]/H, kind[n]] for n in nodes}
    idmap = {n: f"n{n}" for n in nodes}
    edgesN = {}
    for i, (a, b, poly) in enumerate(edges):
        eid = f"e{i}"
        edgesN[eid] = [idmap[a], idmap[b], [(x/W, y/H) for x, y in poly]]

    # 5. snap icons
    payloads = []
    for k, ic in enumerate(icons):
        p = (ic["cx"]/W, ic["cy"]/H)
        kindref, refid, t, dist = snap_to_graph(p, {k: v for k, v in nodesN.items()},
                                                edgesN)
        if dist > SNAP_MAX_N:
            continue  # icon not near any tunnel -> reject (likely false positive)
        if refid in (idmap[start], idmap[exit_]):
            continue  # the START sub (yellow) / EXIT marker -> not a payload
        payloads.append({"id": f"p{k}", "type": ic["type"], "edgeOrNodeId": refid,
                         "t": round(t, 4), "confidence": round(ic["score"], 3),
                         "_px": (ic["cx"], ic["cy"])})
    log(f"payloads snapped: {len(payloads)} (rejected {len(icons)-len(payloads)} off-tunnel)")

    # 6. assemble JSON
    level = {
        "id": name, "name": name.replace("level", "Level "),
        "difficulty": int(name.replace("level", "") or 1) if name.replace("level","").isdigit() else 1,
        "startNodeId": idmap[start], "exitNodeId": idmap[exit_],
        "nodes": [{"id": idmap[n], "x": round(nodes[n][0]/W, 5),
                   "y": round(nodes[n][1]/H, 5), "kind": kind[n]} for n in nodes],
        "edges": [{"id": eid, "from": e[0], "to": e[1],
                   "polyline": [[round(x, 5), round(y, 5)] for x, y in e[2]],
                   "lengthN": round(poly_len([(x*W, y*H) for x, y in e[2]]) / ((W+H)/2), 5)}
                  for eid, e in edgesN.items()],
        "payloads": [{k: v for k, v in p.items() if not k.startswith("_")} for p in payloads],
        "meta": {"sourceImage": os.path.basename(path), "sourcePixelSize": [W, H],
                 "extractorVersion": EXTRACTOR_VERSION, "warnings": warnings},
    }
    os.makedirs(outdir, exist_ok=True)
    outpath = os.path.join(outdir, f"{name}.json")
    with open(outpath, "w") as f: json.dump(level, f, indent=1)
    log(f"wrote {outpath}")

    # 7. debug overlay
    if debug:
        COL = {"start": (0,255,0), "exit": (255,255,0), "junction": (255,255,255), "deadend": (0,0,255)}
        ICN = {"hostile": (0,0,255), "debris": (60,140,200), "shipwreck": (40,90,160),
               "star": (0,220,255), "mult2x": (255,180,0), "mult3x": (255,90,0)}
        for eid, (a, b, poly) in edgesN.items():
            pp = np.array([[int(x*W), int(y*H)] for x, y in poly], np.int32)
            cv2.polylines(dbg, [pp], False, (0,255,180), 2)
        for n in nodes:
            c = (int(nodes[n][0]), int(nodes[n][1]))
            cv2.circle(dbg, c, 7, COL[kind[n]], -1); cv2.circle(dbg, c, 7, (0,0,0), 1)
        for p in payloads:
            cx, cy = int(p["_px"][0]), int(p["_px"][1])
            col = ICN.get(p["type"], (200,200,200))
            cv2.drawMarker(dbg, (cx, cy), col, cv2.MARKER_DIAMOND, 22, 2)
            cv2.putText(dbg, p["type"], (cx+10, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.5, col, 1, cv2.LINE_AA)
        dpath = os.path.join(outdir, f"{name}.debug.png")
        cv2.imwrite(dpath, dbg)
        log(f"wrote {dpath}")
    if warnings:
        log(f"{len(warnings)} warning(s) logged into meta.warnings")
    return level


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--out", default="levels")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()
    paths = []
    for p in args.inputs: paths.extend(sorted(glob.glob(p)))
    if not paths: sys.exit("no input images matched")
    for p in paths:
        try:
            extract(p, args.out, args.debug)
        except Exception as e:
            print(f"[ERROR] {p}: {e}", file=sys.stderr)
            import traceback; traceback.print_exc()


if __name__ == "__main__":
    main()
