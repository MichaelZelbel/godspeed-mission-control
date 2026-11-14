#!/usr/bin/env python3
"""Judge for the media label holdout (H-10).

Usage: python3 -I media_label_judge.py run.json

run.json, measured in a browser on the computer that has the file, once per viewport:
{
  "views": [
    {
      "viewport": [1280, 800],
      "card": [x, y, w, h],                         # the media card's box
      "label": {"text": "...", "box": [x, y, w, h],
                "topmost": true,                    # elementFromPoint at the label's centre is the label or inside it
                "color": [r, g, b], "background": [r, g, b]},
      "other_labels": [[x, y, w, h], ...]           # every other badge, chip or label drawn on the same card
    }
  ]
}
Prints PASS, FAIL or INCONCLUSIVE on the first line, then one reason per line.
"""
import json
import sys


def overlap(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    w = min(ax + aw, bx + bw) - max(ax, bx)
    h = min(ay + ah, by + bh) - max(ay, by)
    return w > 0.5 and h > 0.5


def lum(c):
    def ch(v):
        v = v / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def main():
    run = json.load(open(sys.argv[1], encoding="utf-8"))
    views = run.get("views") or []
    if not views:
        print("INCONCLUSIVE\nno view was measured")
        return
    fails = []
    for v in views:
        tag = "x".join(str(n) for n in v.get("viewport", ["?"]))
        label = v.get("label")
        if not label or not (label.get("text") or "").strip():
            fails.append(f"{tag}: the card has no label saying the file is kept only here")
            continue
        box, card = label["box"], v["card"]
        if box[2] <= 0 or box[3] <= 0:
            fails.append(f"{tag}: the label has no size")
        if not (box[0] >= card[0] - 0.5 and box[1] >= card[1] - 0.5
                and box[0] + box[2] <= card[0] + card[2] + 0.5
                and box[1] + box[3] <= card[1] + card[3] + 0.5):
            fails.append(f"{tag}: the label sticks out of or is cut by its card")
        if not label.get("topmost"):
            fails.append(f"{tag}: something is drawn over the label")
        for other in v.get("other_labels") or []:
            if overlap(box, other):
                fails.append(f"{tag}: the label overlaps another label on the card at {other}")
        if label.get("color") and label.get("background"):
            l1, l2 = sorted((lum(label["color"]), lum(label["background"])), reverse=True)
            ratio = (l1 + 0.05) / (l2 + 0.05)
            if ratio < 4.5:
                fails.append(f"{tag}: the label's contrast is {ratio:.2f}:1, below 4.5:1")
    print("FAIL\n" + "\n".join(fails) if fails else "PASS")


if __name__ == "__main__":
    main()
