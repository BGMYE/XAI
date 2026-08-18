#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


ASSET_SIZES = {
    "StoreLogo.png": (50, 50),
    "Square44x44Logo.png": (44, 44),
    "Square71x71Logo.png": (71, 71),
    "Square150x150Logo.png": (150, 150),
    "Wide310x150Logo.png": (310, 150),
    "Square310x310Logo.png": (310, 310),
    "SplashScreen.png": (620, 300),
}


def resize_contain(src: Image.Image, size: tuple[int, int]) -> Image.Image:
    canvas = Image.new("RGBA", size, (255, 255, 255, 0))
    image = src.copy()
    image.thumbnail(size, Image.LANCZOS)
    x = (size[0] - image.width) // 2
    y = (size[1] - image.height) // 2
    canvas.paste(image, (x, y), image)
    return canvas


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: generate-msix-assets.py <source-png> <output-dir>", file=sys.stderr)
        return 1

    source = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    image = Image.open(source).convert("RGBA")
    for name, size in ASSET_SIZES.items():
        out = resize_contain(image, size)
        out.save(output_dir / name)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
