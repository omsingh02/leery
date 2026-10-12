#!/usr/bin/env python3
"""Shrinks the generated brand images (needs Pillow).

  optimize.py webp IN.png OUT.webp [--quality 88]   lossy WebP, for the README screenshots
  optimize.py png  IN.png OUT.png  [--max-kb 300]   optimised PNG; falls back to an adaptive palette
                                                    (libimagequant, dithered) when true colour would be too big
  optimize.py anim MANIFEST.json OUT.webp [--fps 15] [--width 300] [--seconds 4.2] [--hold 0.8] [--skip 0] [--quality 62]
                                                    animated lossy WebP from a screencast; MANIFEST is a list of
                                                    {"t": seconds, "file": "frame.jpg"}. Leading blank frames (and --skip
                                                    seconds more) are dropped, the rest is resampled at --fps; the last
                                                    frame is held for --hold seconds before the loop restarts.
"""
import argparse
import bisect
import io
import json
import sys

from PIL import Image, ImageStat, features


def png_bytes(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def anim(manifest: str, dst: str, fps: int, width: int, seconds: float, hold: float, skip: float, quality: int) -> int:
    frames = sorted(json.load(open(manifest)), key=lambda f: f["t"])
    if len(frames) < 2:
        print(f"{manifest}: need at least two frames", file=sys.stderr)
        return 1

    def thumb(i: int) -> Image.Image:
        return Image.open(frames[i]["file"]).convert("L").resize((48, 104))

    # The recording can start before the page has painted anything: begin at the first frame with something in it.
    start = next((i for i in range(len(frames)) if ImageStat.Stat(thumb(i)).stddev[0] > 8), 0)
    t0 = frames[start]["t"] + skip
    times = [f["t"] for f in frames]

    count = max(2, round(seconds * fps))
    out = []
    for k in range(count):
        i = max(start, bisect.bisect_right(times, t0 + k / fps) - 1)
        im = Image.open(frames[i]["file"]).convert("RGB")
        out.append(im.resize((width, round(im.height * width / im.width)), Image.LANCZOS))
    # A screencast only emits frames when the picture changes, so a still ending just holds its last frame —
    # but a recording that stops well short of the asked-for length was cut off.
    if times[-1] - t0 < seconds - 1.0:
        print(f"{dst}: the recording only covers {times[-1] - t0:.1f}s of the {seconds}s asked for", file=sys.stderr)
        return 1

    frame_ms = round(1000 / fps)
    durations = [frame_ms] * len(out)
    durations[-1] += round(hold * 1000)
    out[0].save(dst, "WEBP", save_all=True, append_images=out[1:], duration=durations, loop=0, quality=quality, method=6)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kind", choices=["webp", "png", "anim"])
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--quality", type=int, default=88)
    ap.add_argument("--max-kb", type=int, default=0)
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--width", type=int, default=300)
    ap.add_argument("--seconds", type=float, default=4.2)
    ap.add_argument("--hold", type=float, default=0.8)
    ap.add_argument("--skip", type=float, default=0.0)
    args = ap.parse_args()

    if args.kind == "anim":
        return anim(args.src, args.dst, args.fps, args.width, args.seconds, args.hold, args.skip, args.quality)

    im = Image.open(args.src)
    transparent = im.mode in ("RGBA", "LA") and im.getchannel("A").getextrema()[0] < 255
    im = im.convert("RGBA" if transparent else "RGB")

    if args.kind == "webp":
        im.save(args.dst, "WEBP", quality=args.quality, method=6)
        return 0

    data = png_bytes(im)
    colors = 256
    if args.max_kb and not transparent and len(data) > args.max_kb * 1024:
        if features.check("libimagequant"):
            method = Image.Quantize.LIBIMAGEQUANT
        else:
            print("warning: this Pillow has no libimagequant; gradients will look posterised", file=sys.stderr)
            method = Image.Quantize.MEDIANCUT
        while len(data) > args.max_kb * 1024 and colors >= 32:
            data = png_bytes(im.quantize(colors=colors, method=method, dither=Image.Dither.FLOYDSTEINBERG))
            colors //= 2
    if args.max_kb and len(data) > args.max_kb * 1024:
        print(f"{args.dst}: still {len(data) // 1024} KB (limit {args.max_kb} KB)", file=sys.stderr)
        return 1
    with open(args.dst, "wb") as f:
        f.write(data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
