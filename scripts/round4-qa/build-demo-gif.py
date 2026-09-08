from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps


FRAME_NAMES = (
    "dashboard",
    "editor",
    "linter",
    "assets",
    "preview-dark",
    "approval",
    "mock-draft-plan",
    "mock-upload",
    "mock-receipt",
    "reconciliation",
)


def build_gif(screenshot_dir: Path, output: Path) -> None:
    frames: list[Image.Image] = []
    target = (960, 640)
    for name in FRAME_NAMES:
        with Image.open(screenshot_dir / f"{name}.png") as image:
            frame = ImageOps.contain(image.convert("RGB"), target, Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", target, "#111827")
            offset = ((target[0] - frame.width) // 2, (target[1] - frame.height) // 2)
            canvas.paste(frame, offset)
            frames.append(canvas.quantize(colors=192, method=Image.Quantize.MEDIANCUT))

    output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        output,
        save_all=True,
        append_images=frames[1:],
        duration=[1250] * len(frames),
        loop=0,
        disposal=2,
        optimize=False,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the public MPForge Demo GIF.")
    parser.add_argument("screenshot_dir", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    build_gif(arguments.screenshot_dir.resolve(), arguments.output.resolve())


if __name__ == "__main__":
    main()
