"""Rebuild idle and action GIFs together on one canvas with one stable palette."""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageSequence

source, reference = map(Path, sys.argv[1:3])
root = Path(__file__).resolve().parents[1]
target = root / "public" / "assistant-gifs"
names = {
    "reach": "\u6293\u9ad8", "wave": "\u62db\u624b",
    "yarn": "\u73a9\u6bdb\u7ebf\u7403", "sleep": "\u7761\u89c9",
    "wake": "\u7761\u89c9_\u8d77\u8eab", "doze": "\u778c\u7761",
    "lie": "\u8db4\u4e0b", "lie-sleep": "\u8db4\u4e0b_\u7761\u89c9",
    "rise": "\u8db4\u4e0b_\u8d77\u8eab",
}

def transparent(frame):
    rgba = np.array(frame.convert("RGBA"))
    rgb = rgba[:, :, :3].astype(np.int16)
    green = (rgb[:, :, 1] > 65) & (rgb[:, :, 1] > rgb[:, :, 0] * 1.25) & (rgb[:, :, 1] > rgb[:, :, 2] * 1.25)
    rgba[green] = 0
    return Image.fromarray(rgba)

with Image.open(reference) as image:
    bounds = [transparent(frame).getbbox() for frame in ImageSequence.Iterator(image)]
crop = (min(b[0] for b in bounds), min(b[1] for b in bounds),
        max(b[2] for b in bounds), max(b[3] for b in bounds))
fit = Image.new("RGBA", (crop[2] - crop[0], crop[3] - crop[1]))
fit.thumbnail((192, 192), Image.Resampling.LANCZOS)
sx, sy = fit.width / (crop[2] - crop[0]), fit.height / (crop[3] - crop[1])
offset_x = 96 + (192 - fit.width) // 2
offset_y = 160 + 192 - fit.height
clips = {}
sources = {name: source / f"{filename}.gif" for name, filename in names.items()}
sources.update({f"idle-{index:02}": path for index, path in enumerate(sorted(reference.parent.glob("*.gif")), 1)})
for name, path in sources.items():
    canvases, times = [], []
    # Wave/reach were exported 128px lower than the shared idle artwork.
    shift = 128 if name in ("wave", "reach") else 0
    with Image.open(path) as image:
        for frame in ImageSequence.Iterator(image):
            canvas = transparent(frame).transform((384, 384), Image.Transform.AFFINE,
                (1 / sx, 0, crop[0] - offset_x / sx,
                 0, 1 / sy, crop[1] + shift - offset_y / sy),
                Image.Resampling.BICUBIC)
            canvases.append(canvas)
            times.append(frame.info.get("duration", 40))
    clips[name] = (canvases, times)

# A frame-specific palette/dither pattern adds avoidable color shimmer.
samples = [frame for frames, _ in clips.values() for frame in frames[::4]]
sheet = Image.new("RGB", (640, 64 * ((len(samples) + 9) // 10)))
for index, frame in enumerate(samples):
    sheet.paste(frame.convert("RGB").resize((64, 64)), ((index % 10) * 64, (index // 10) * 64))
palette = sheet.quantize(colors=255)
palette.putpalette(palette.getpalette()[:765] + [0, 0, 0])
black = min(range(255), key=lambda index: sum(palette.getpalette()[index * 3:index * 3 + 3]))
durations, idle_durations = {}, {}
for name, (canvases, times) in clips.items():
    frames = []
    for canvas in canvases:
        frame = canvas.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE)
        frame = frame.point(lambda index: black if index == 255 else index)
        frame.paste(255, mask=canvas.getchannel("A").point(lambda value: 255 if value < 128 else 0))
        frame.info["transparency"] = 255
        frames.append(frame)
    stem = f"center-cat-{name[-2:]}" if name.startswith("idle-") else f"center-action-{name}"
    for plays, variant in [(1, "once"), (2, "twice")]:
        # Omit the loop extension for one play; one repeat gives two plays.
        options = {} if plays == 1 else {"loop": 1}
        frames[0].save(target / f"{stem}-{variant}.gif", save_all=True,
            append_images=frames[1:], duration=times, disposal=2,
            transparency=255, optimize=False, **options)
    if name in ("sleep", "doze") or name.startswith("idle-"):
        suffix = "" if name.startswith("idle-") else "-loop"
        frames[0].save(target / f"{stem}{suffix}.gif", save_all=True,
            append_images=frames[1:], duration=times, disposal=2,
            transparency=255, optimize=False, loop=0)
    if name.startswith("idle-"):
        idle_durations[f"/assistant-gifs/{stem}.gif"] = sum(times)
        if name == "idle-01":
            frames[0].convert("RGBA").save(target / "center-cat-idle.png")
    else:
        durations[name] = sum(times)
    print(f"{name}: {len(frames)} frames, {sum(times)}ms")
with Image.open(target / "center-cat-idle.png") as image:
    idle_bounds = image.convert("RGBA").getbbox()
expected = idle_bounds
for name in ("center-action-wave", "center-action-reach", "center-action-lie", "center-action-lie-sleep", "center-action-yarn", "center-cat-01", "center-cat-02"):
    with Image.open(target / f"{name}-once.gif") as image:
        bounds = image.convert("RGBA").getbbox()
        assert all(abs(a - b) <= 1 for a, b in zip(bounds, expected)), (name, bounds, expected)
print("All standing entry frames match idle within one asset pixel")
(root / "src" / "assistant-center-actions.json").write_text(json.dumps(durations, indent=2) + "\n")
(root / "src" / "assistant-center-durations.json").write_text(json.dumps(idle_durations, indent=2) + "\n")
