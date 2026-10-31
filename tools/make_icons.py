"""生成扩展图标（纯标准库，不依赖 Pillow）。

思路：先在 512x512 上画图形，再用区域平均缩到目标尺寸 —— 缩小的过程
天然就是抗锯齿，比在小尺寸上直接画边缘要干净得多。
"""
import os
import struct
import zlib

S = 512
INDIGO = (79, 70, 229)

BARS = [
    (0.335, 1.00),
    (0.500, 0.78),
    (0.665, 0.56),
]
BAR_X0, BAR_X1 = 0.20 * S, 0.80 * S
BAR_H = 0.105 * S
RADIUS = 0.22 * S


def in_round_rect(px, py, x0, y0, x1, y1, r):
    if px < x0 or px > x1 or py < y0 or py > y1:
        return False
    cx = min(max(px, x0 + r), x1 - r)
    cy = min(max(py, y0 + r), y1 - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def render():
    canvas = [[(0, 0, 0, 0)] * S for _ in range(S)]
    for y in range(S):
        for x in range(S):
            px, py = x + 0.5, y + 0.5
            if not in_round_rect(px, py, 0, 0, S, S, RADIUS):
                continue
            col = INDIGO
            for cy_ratio, alpha in BARS:
                cy = cy_ratio * S
                if in_round_rect(px, py, BAR_X0, cy - BAR_H / 2, BAR_X1, cy + BAR_H / 2, BAR_H / 2):
                    col = tuple(round(c * (1 - alpha) + 255 * alpha) for c in col)
            canvas[y][x] = (col[0], col[1], col[2], 255)
    return canvas


def downsample(canvas, size):
    step = S // size
    out = []
    for y in range(size):
        row = []
        for x in range(size):
            r = g = b = a = 0
            for dy in range(step):
                for dx in range(step):
                    p = canvas[y * step + dy][x * step + dx]
                    r += p[0] * p[3]
                    g += p[1] * p[3]
                    b += p[2] * p[3]
                    a += p[3]
            n = step * step
            if a == 0:
                row.append((0, 0, 0, 0))
            else:
                row.append((round(r / a), round(g / a), round(b / a), round(a / n)))
        out.append(row)
    return out


def write_png(path, pixels):
    h = len(pixels)
    w = len(pixels[0])
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("4B", *px) for px in row) for row in pixels
    )

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    base = render()
    for size in (16, 48, 128):
        write_png(os.path.join(out_dir, f"icon{size}.png"), downsample(base, size))
        print("wrote", os.path.join(out_dir, f"icon{size}.png"))
