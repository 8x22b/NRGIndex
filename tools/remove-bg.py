# -*- coding: utf-8 -*-
"""
Remove background from drink can photos.

Engines:
  rembg (default) — isnet-general-use neural net + end-protect: restores the
      can's top/bottom ends that the net tends to eat on cropped packshots
      (metallic rims read as background). Accurate edges everywhere else.
  flood (fallback) — border-connected near-white flood fill, no models/weights.
      For weak machines (VPS, bots): zero downloads, only PIL+numpy+scipy.
      May nibble anti-aliased edges and bright rims touching the image border.

Usage:
  python tools/remove-bg.py                      # process all assets
  python tools/remove-bg.py assets/foo.png ...   # specific files
  python tools/remove-bg.py --watch              # watch assets/ for new images
Options:
  --engine {rembg,flood}  cutout engine (default rembg)
  --tol N        flood tolerance to background sample (default 40)
  --no-backup    skip writing backups
  --watch        keep running, process new/changed files in assets/
"""

import sys
import time
import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
BACKUP = ROOT / "assets_original_backup"

# "near white" definition: bright enough and neutral enough
BRIGHT_MIN = 120        # min channel of a background-ish pixel (catches gray shadows)
NEUTRAL_MAX = 34        # max(channel) - min(channel) for neutral pixel
GRAD_MAX = 28.0         # Sobel magnitude: edge ramps are NOT background (anti-leak)
DILATE_PX = 2           # eat leftover white fringe around the can
FEATHER_SIGMA = 1.0     # edge softness
SPECKLE_PX = 64         # remove bg speckles smaller than this

# rembg end-protect: white level sample + margin for "definitely can" pixels
END_WHITE_MIN = 200   # pool of bright pixels used to sample the true white
END_BG_PCTL = 99      # percentile of the pool = white level of the photo
END_MARGIN = 12       # pixel darker than (white - margin) counts as can

_rembg_session = None


def rembg_session():
    """Lazy isnet session (downloads ~170MB weights on first use)."""
    global _rembg_session
    if _rembg_session is None:
        from rembg import new_session
        _rembg_session = new_session("isnet-general-use")
    return _rembg_session


def protect_ends(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Restore can top/bottom the net ate: per column, extend the alpha
    silhouette out to the original non-white extent. Only touches strips
    beyond the net's own edges, so net edges elsewhere are untouched."""
    mn = rgb.min(-1)
    h, w = mn.shape
    fg = alpha > 25
    pool = mn[mn > END_WHITE_MIN]
    if pool.size == 0:
        return alpha
    white = float(np.percentile(pool, END_BG_PCTL))
    isobj = mn < (white - END_MARGIN)
    out = alpha.copy()
    for x in range(w):
        cf = np.where(fg[:, x])[0]
        co = np.where(isobj[:, x])[0]
        if len(cf) == 0 or len(co) == 0:
            continue
        t0, b0 = int(cf[0]), int(cf[-1])
        t1, b1 = int(co[0]), int(co[-1])
        if t1 < t0:
            sel = np.arange(t1, t0)
            sel = sel[isobj[sel, x]]
            out[sel, x] = 255
        if b1 > b0:
            sel = np.arange(b0 + 1, b1 + 1)
            sel = sel[isobj[sel, x]]
            out[sel, x] = 255
    # band fill: inside the top/bottom bands the net often leaves the lid and
    # rim semi-cut. Restore every definitely-can pixel there, but only within
    # the can's own columns (taken from solid middle rows) so side margins
    # with soft shadow never get restored.
    mid = fg[h // 3:2 * h // 3, :]
    can_cols = np.where(mid.any(axis=0))[0]
    if len(can_cols):
        x0, x1 = max(can_cols.min() - 3, 0), min(can_cols.max() + 4, w)
        band = np.zeros((h, w), bool)
        bh = max(int(h * 0.12), 8)
        band[:bh, x0:x1] = True
        band[h - bh:, x0:x1] = True
        out[band & isobj] = 255
    return out


def rect_fallback(rgb8, alpha):
    """Net sometimes deletes a whole dark body (black can on white) and keeps
    only the print. Detect (kept < half of dark pixels) and rebuild the
    foreground as the can's own column span per row (straight packshots)."""
    from scipy.ndimage import median_filter, binary_dilation
    i = np.asarray(rgb8).astype(int)
    mn = i.min(-1)
    pool = mn[mn > 200]
    white = float(np.percentile(pool, END_BG_PCTL)) if pool.size else 255.0
    isobj = mn < (white - END_MARGIN)
    fg = np.asarray(alpha) > 25
    if fg.sum() > 0.85 * isobj.sum():
        return alpha
    h, w = fg.shape
    L = np.full(h, w - 1)
    R = np.full(h, 0)
    for y in range(h):
        xs = np.where(isobj[y])[0]
        if len(xs):
            L[y], R[y] = int(xs[0]), int(xs[-1])
    L = median_filter(L, 15).astype(int)
    R = median_filter(R, 15).astype(int)
    rect = np.zeros((h, w), bool)
    for y in range(h):
        if R[y] > L[y]:
            rect[y, max(L[y], 0):min(R[y] + 1, w)] = True
    rect = binary_dilation(rect, iterations=1)
    out = np.asarray(alpha).copy()
    out[rect] = 255
    return out


def cutout_rembg(flat: np.ndarray) -> Image.Image:
    """Neural cutout + end-protect + crop to content."""
    from rembg import remove
    rgb8 = np.clip(flat[..., :3], 0, 255).astype(np.uint8)
    arr = np.asarray(remove(Image.fromarray(rgb8), session=rembg_session())).astype(int)
    alpha = protect_ends(rgb8.astype(int), arr[..., 3])
    alpha = rect_fallback(rgb8, alpha)
    # snap: the net returns semi alpha over large dark areas (ghost cans).
    # Keep soft alpha only in a 2px band around the mask boundary, snap the
    # interior to 255 and the exterior to 0.
    from scipy.ndimage import binary_erosion, binary_dilation
    fg = alpha > 25
    core = binary_erosion(fg, iterations=2)
    halo = binary_dilation(fg, iterations=2)
    alpha = np.where(core, 255, np.where(halo, alpha, 0))
    out = np.dstack([rgb8, np.clip(alpha, 0, 255).astype(np.uint8)])
    h, w = alpha.shape
    ys, xs = np.where(out[..., 3] > 8)
    if len(xs):
        pad = 12
        y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad, h - 1)
        x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad, w - 1)
        out = out[y0:y1 + 1, x0:x1 + 1]
    return Image.fromarray(out)


def load_flat(path: Path) -> tuple[Image.Image, np.ndarray]:
    """Load image as RGBA; composite existing (possibly broken) alpha over
    white so partially-cut images can be re-cut from scratch."""
    im = Image.open(path).convert("RGBA")
    rgb = np.asarray(im, dtype=np.float64)
    alpha = rgb[..., 3] / 255.0
    flat = rgb[..., :3] * alpha[..., None] + 255.0 * (1 - alpha[..., None])
    return im, flat


def background_mask(flat: np.ndarray, tol: float) -> np.ndarray:
    """Flood-fill near-white region connected to the image border."""
    h, w = flat.shape[:2]
    border = np.zeros((h, w), bool)
    border[0, :] = border[-1, :] = True
    border[:, 0] = border[:, -1] = True

    border_px = flat[border]
    # median border color = background sample (guards against off-white bg)
    bg = np.median(border_px, axis=0)

    # denoise for stable candidates/gradients (edges survive a 3x3 median)
    ref = ndimage.median_filter(flat, size=(3, 3, 1))
    lum = ref.mean(-1)
    grad = np.hypot(ndimage.sobel(lum, 0), ndimage.sobel(lum, 1))
    low_grad = grad < GRAD_MAX

    dist_bg = np.linalg.norm(ref - bg, axis=-1)
    near_sample = dist_bg < tol

    neutral = (ref.max(-1) - ref.min(-1)) < NEUTRAL_MAX
    bright = ref.min(-1) > BRIGHT_MIN
    near_white = neutral & bright

    # gradient gate: a bright anti-aliased edge ramp must not let the
    # flood fill leak from the background into light print on the can
    candidates = (near_sample | near_white) & low_grad

    # seed: candidate pixels sitting on the border
    seed = candidates & border
    if not seed.any():
        return np.zeros((h, w), bool)

    # flood fill: propagate seed through candidates (4-connectivity)
    structure = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)
    bg_mask = ndimage.binary_propagation(seed, mask=candidates, structure=structure)

    # drop tiny detached bg islands (noise inside bg region)
    bg_mask = ndimage.binary_opening(bg_mask, structure=structure, iterations=1)
    labeled, n = ndimage.label(bg_mask, structure=structure)
    if n > 1:
        sizes = ndimage.sum(bg_mask, labeled, range(1, n + 1))
        for i in np.where(sizes < SPECKLE_PX)[0]:
            bg_mask[labeled == i + 1] = False
    return bg_mask


def cutout(flat: np.ndarray, bg_mask: np.ndarray) -> Image.Image:
    """Apply soft alpha, decontaminate white fringe, return RGBA."""
    h, w = flat.shape[:2]
    # grow bg a bit to eat the white halo hugging the can
    bg_mask = ndimage.binary_dilation(
        bg_mask,
        structure=np.array([[1, 1, 1], [1, 1, 1], [1, 1, 1]], bool),
        iterations=DILATE_PX,
    )
    alpha = 255.0 - ndimage.gaussian_filter(bg_mask.astype(np.float64) * 255.0, FEATHER_SIGMA)

    rgb = flat.copy()
    a = np.clip(alpha / 255.0, 0.0, 1.0)
    # decontaminate semi-transparent pixels: C = (C - (1-a)*bg) / a
    semi = (a > 0.02) & (a < 0.98)
    bg = np.array([255.0, 255.0, 255.0])
    with np.errstate(invalid="ignore", divide="ignore"):
        unmixed = (rgb - (1.0 - a[..., None]) * bg) / np.maximum(a[..., None], 1e-6)
    rgb[semi] = np.clip(unmixed[semi], 0, 255)

    out = np.dstack([rgb, np.clip(alpha, 0, 255)]).astype(np.uint8)

    # crop to content + small padding
    ys, xs = np.where(out[..., 3] > 8)
    if len(xs):
        pad = 12
        y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad, h - 1)
        x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad, w - 1)
        out = out[y0:y1 + 1, x0:x1 + 1]
    return Image.fromarray(out)


def process(path: Path, tol: float, backup: bool, engine: str = "rembg") -> bool:
    im, flat = load_flat(path)

    if backup:
        BACKUP.mkdir(exist_ok=True)
        dst = BACKUP / path.name
        if not dst.exists():
            dst.write_bytes(path.read_bytes())

    if engine == "rembg":
        result = cutout_rembg(flat)
        detail = "net+ends"
    else:
        bg_mask = background_mask(flat, tol)
        share = bg_mask.mean()
        if share < 0.005:
            print(f"SKIP  {path.name}: no border-connected background ({share:.1%})", flush=True)
            return False
        result = cutout(flat, bg_mask)
        detail = f"bg {share:.1%}"
    result.save(path, lossless=True) if path.suffix == ".webp" else result.save(path)

    arr = np.asarray(result)
    corners = [arr[1, 1, 3], arr[1, -2, 3], arr[-2, 1, 3], arr[-2, -2, 3]]
    print(
        f"OK    {path.name}: {detail}, "
        f"{im.size[0]}x{im.size[1]} -> {result.size[0]}x{result.size[1]}, "
        f"corner alpha {[int(c) for c in corners]}",
        flush=True,
    )
    return True


def snapshot(path: Path) -> tuple:
    st = path.stat()
    return (st.st_mtime_ns, st.st_size)


def watch(tol: float, backup: bool, engine: str, interval: float = 1.0) -> None:
    """Watch assets/; process files that appear or change after start."""
    files = sorted(list(ASSETS.glob("*.png")) + list(ASSETS.glob("*.webp")))
    known = {f: snapshot(f) for f in files}
    print(f"watching {ASSETS} ({len(known)} files tracked), Ctrl+C to stop", flush=True)
    while True:
        time.sleep(interval)
        try:
            current = sorted(list(ASSETS.glob("*.png")) + list(ASSETS.glob("*.webp")))
        except OSError:
            continue
        for f in current:
            try:
                state = snapshot(f)
            except OSError:
                continue
            if known.get(f) != state:
                print(f"change detected: {f.name}", flush=True)
                ok = process(f, tol, backup, engine)
                # update snapshot even on skip so we don't loop on it
                if ok:
                    try:
                        known[f] = snapshot(f)
                    except OSError:
                        known.pop(f, None)
                else:
                    known[f] = state
        for f in [k for k in known if not k.exists()]:
            print(f"removed: {f.name}", flush=True)
            known.pop(f)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", help="image files (default: all in assets/)")
    ap.add_argument("--tol", type=float, default=40)
    ap.add_argument("--engine", choices=["rembg", "flood"], default="rembg")
    ap.add_argument("--no-backup", action="store_true")
    ap.add_argument("--watch", action="store_true")
    args = ap.parse_args()

    if args.watch:
        try:
            watch(args.tol, not args.no_backup, args.engine)
        except KeyboardInterrupt:
            print("stopped", flush=True)
        return

    files = [Path(f) for f in args.files] or sorted(
        list(ASSETS.glob("*.png")) + list(ASSETS.glob("*.webp"))
    )
    for f in files:
        if not f.exists():
            print(f"MISS  {f}")
            continue
        process(f, args.tol, not args.no_backup, args.engine)


if __name__ == "__main__":
    main()
