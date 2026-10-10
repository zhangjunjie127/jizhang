"""Remove green backgrounds without changing frame timing or character proportions."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageSequence

source = Path(sys.argv[1])
prefix = sys.argv[2] if len(sys.argv) > 2 else "new-cat"
size = (192, 192) if prefix == "center-cat" else (288, 192)
target = Path(__file__).resolve().parents[1] / "public" / "assistant-gifs"
for index, path in enumerate(sorted(source.glob("*.gif")), 1):
    frames, durations = [], []
    with Image.open(path) as image:
        for frame in ImageSequence.Iterator(image):
            rgba = np.array(frame.convert("RGBA"))
            rgb = rgba[:, :, :3].astype(np.int16)
            green = (rgb[:, :, 1] > 65) & (rgb[:, :, 1] > rgb[:, :, 0] * 1.25) & (rgb[:, :, 1] > rgb[:, :, 2] * 1.25)
            rgba[green, 3] = 0
            frames.append(Image.fromarray(rgba))
            durations.append(frame.info.get("duration", 40))
    bounds = [frame.getbbox() for frame in frames]
    crop = (min(b[0] for b in bounds), min(b[1] for b in bounds),
            max(b[2] for b in bounds), max(b[3] for b in bounds))
    output = []
    for frame in frames:
        character = frame.crop(crop)
        character.thumbnail(size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", size)
        canvas.paste(character, ((size[0] - character.width) // 2, size[1] - character.height))
        alpha = canvas.getchannel("A")
        palette = canvas.convert("RGB").quantize(colors=255)
        palette.paste(255, mask=alpha.point(lambda value: 255 if value < 128 else 0))
        palette.info["transparency"] = 255
        output.append(palette)
    destination = target / f"{prefix}-{index:02}.gif"
    if prefix == "new-cat" and index == 6:
        output[0].convert("RGBA").save(target / "new-cat-idle.png")
    if prefix == "new-cat" and index == 7:
        # Frame 30 has fully closed eyes; stop before the source wakes again.
        output[30].convert("RGBA").save(target / "new-cat-asleep.png")
        output[0].save(target / "new-cat-sleep-entry.gif", save_all=True,
                       append_images=output[1:31], duration=durations[:31],
                       disposal=2, transparency=255, optimize=False)
    output[0].save(destination, save_all=True, append_images=output[1:],
                   duration=durations, loop=0, disposal=2, transparency=255, optimize=False)
    print(f"{path.name}: {len(output)} frames, {sum(durations)}ms -> {destination.name}")
