"""Check registration, palette stability and nonblank frames for every center clip."""
from pathlib import Path
from PIL import Image, ImageSequence

root = Path(__file__).resolve().parents[1] / "public" / "assistant-gifs"
with Image.open(root / "center-cat-01-once.gif") as image:
    expected = image.convert("RGBA").getbbox()
    palette = image.getpalette()
starts = ["center-cat-01", "center-cat-02", "center-action-wave",
          "center-action-reach", "center-action-yarn",
          "center-action-lie", "center-action-lie-sleep"]
ends = ["center-cat-01", "center-cat-02", "center-action-wave",
        "center-action-reach", "center-action-wake", "center-action-rise"]
for name in set(starts + ends):
    with Image.open(root / f"{name}-once.gif") as image:
        for frame in ([0] if name not in ends else [0, image.n_frames - 1]):
            if frame == 0 and name not in starts:
                continue
            image.seek(frame)
            bounds = image.convert("RGBA").getbbox()
            assert all(abs(a - b) <= 1 for a, b in zip(bounds, expected)), (name, frame, bounds, expected)
for path in [*root.glob("center-cat-*-once.gif"), *root.glob("center-action-*-once.gif")]:
    with Image.open(path) as image:
        assert image.size == (384, 384), path.name
        assert image.getpalette() == palette, path.name
        for index, frame in enumerate(ImageSequence.Iterator(image)):
            bounds = frame.convert("RGBA").getbbox()
            assert bounds and bounds[0] > 0 and bounds[1] > 0 and bounds[2] < 384 and bounds[3] < 384, (path.name, index, bounds)
print("PASS: all standing joins within 1 asset pixel; common palette; no blank or clipped frames")
