from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


FRAME_NAMES = ("dashboard", "editor", "review", "assets", "publish", "settings")


def build_gif(screenshot_dir: Path, output: Path) -> None:
    frames: list[Image.Image] = []
    for name in FRAME_NAMES:
        source = screenshot_dir / f"mpforge-{name}.png"
        with Image.open(source) as image:
            frame = image.convert("RGB").resize((720, 480), Image.Resampling.LANCZOS)
            frames.append(frame.quantize(colors=192, method=Image.Quantize.MEDIANCUT))

    output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        output,
        save_all=True,
        append_images=frames[1:],
        duration=[1400] * len(frames),
        loop=0,
        disposal=2,
        optimize=False,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the MPForge UI demo GIF.")
    parser.add_argument("screenshot_dir", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    build_gif(arguments.screenshot_dir.resolve(), arguments.output.resolve())


if __name__ == "__main__":
    main()
