# -*- coding: utf-8 -*-
"""Burned-in captions as one fixed style.

The look is defined once, in your mission control's video/caption-style.json, and reused on every
video. There is no style picker. Change a number there and every future video changes
with it.

Two rules the layout depends on, both learned by rendering it wrong first:
  * a line is ONE string, so libass does the word spacing. Positioning words yourself
    from font metrics spreads them apart, because those widths do not match what libass
    draws.
  * emphasis uses colour and \\fscy (vertical scale only). Neither changes the
    horizontal advance, so highlighting a word cannot shove the rest of the line sideways.
"""
import json
import os

from PIL import ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_STYLE_FILE = os.path.join(HERE, "caption-style.json")
DEFAULT_FONT_FILE = os.path.normpath(os.path.join(HERE, "..", "fonts", "ArchivoBlack-Regular.ttf"))

MAX_WORDS_PER_PHRASE = 7
PHRASE_GAP = 0.35          # a pause longer than this starts a new phrase


def load_style(path=None, width=1080, height=1920):
    """The shared look plus the block for this frame's shape, sized to this frame.

    The file holds one `vertical` block for 1080x1920 and one `horizontal` block for
    1920x1080. A frame of another size gets the block of its shape scaled to it, so
    captions keep the same share of the picture.
    """
    with open(path or DEFAULT_STYLE_FILE, encoding="utf-8") as f:
        raw = json.load(f)
    shape = "vertical" if height >= width else "horizontal"
    base_w, base_h = (1080, 1920) if shape == "vertical" else (1920, 1080)
    st = {k: v for k, v in raw.items() if k not in ("vertical", "horizontal", "_about")}
    st.update(raw[shape])
    k = min(width / base_w, height / base_h)
    for key in ("size", "outline", "shadow", "max_w", "y"):
        st[key] = st[key] * k
    st["size"] = round(st["size"])
    st["play_w"], st["play_h"] = width, height
    st["shape"] = shape
    font_file = st.get("font_file") or DEFAULT_FONT_FILE
    if not os.path.isabs(font_file):
        font_file = os.path.join(os.path.dirname(os.path.abspath(path or DEFAULT_STYLE_FILE)), font_file)
    if not os.path.exists(font_file):
        font_file = DEFAULT_FONT_FILE
    st["font_file"] = font_file
    return st


def ass_colour(hex_rgb):
    """#RRGGBB -> &H00BBGGRR&, the byte order ASS wants."""
    h = hex_rgb.lstrip("#")
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}&".upper()


def ts(t):
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


_FONTS = {}


def _font(st):
    key = (st["font_file"], st["size"])
    if key not in _FONTS:
        _FONTS[key] = ImageFont.truetype(st["font_file"], st["size"])
    return _FONTS[key]


def width_of(txt, st):
    """Advance width plus letter spacing plus the outline, which spills past the glyphs."""
    return _font(st).getlength(txt) + 2 * len(txt) + 2 * st["outline"]


def join_pieces(words):
    """The speech model hears "add-on" as " add" and "-on". A piece with no leading space
    belongs to the word before it."""
    out = []
    for w in words:
        if out and w["w"] and not w["w"][0].isspace() and out[-1]["w"].strip():
            out[-1] = {"w": out[-1]["w"] + w["w"], "s": out[-1]["s"], "e": w["e"]}
        else:
            out.append(dict(w))
    return out


def phrases_from_words(words, st):
    """Group word dicts [{w, s, e}] into caption phrases.

    Breaks on sentence punctuation, on pauses, and on length.
    """
    words = join_pieces(words)
    out, cur = [], []
    for i, w in enumerate(words):
        text = w["w"].strip()
        if not text:
            continue
        cur.append((text.upper() if st["uppercase"] else text, w["s"], w["e"]))
        ends_sentence = text.rstrip()[-1:] in ".!?"
        gap_next = (words[i + 1]["s"] - w["e"]) if i + 1 < len(words) else 99
        # A phrase at its word limit still takes the next word when that word ends the
        # sentence, so "...the video add-on." never leaves "ADD-ON" alone on screen.
        last_word_next = (i + 1 < len(words) and words[i + 1]["w"].strip()[-1:] in ".!?"
                          and gap_next <= PHRASE_GAP and len(cur) < MAX_WORDS_PER_PHRASE + 1)
        full = len(cur) >= MAX_WORDS_PER_PHRASE and not last_word_next
        if ends_sentence or gap_next > PHRASE_GAP or full:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    cleaned = [[(w.strip(".,!?;:"), s, e) for w, s, e in p] for p in out]
    cleaned = [[x for x in p if x[0]] for p in cleaned]
    fitted = []
    for p in cleaned:
        if p:
            fitted.extend(split_to_fit(p, st))
    return fitted


def wrap(phrase, st):
    """One or two balanced lines. Penalises leaving a single word alone."""
    words = [w for w, _, _ in phrase]
    if width_of(" ".join(words), st) <= st["max_w"]:
        return [phrase]
    best = None
    for k in range(1, len(phrase)):
        wa = width_of(" ".join(words[:k]), st)
        wb = width_of(" ".join(words[k:]), st)
        if wa <= st["max_w"] and wb <= st["max_w"]:
            score = abs(wa - wb)
            if k == 1 or len(phrase) - k == 1:
                score += 260
            if best is None or score < best[0]:
                best = (score, k)
    k = best[1] if best else max(1, len(phrase) // 2)
    return [phrase[:k], phrase[k:]]


def fits(phrase, st):
    """True when this phrase lays out in two lines or fewer that each fit max_w."""
    return all(width_of(" ".join(w for w, _, _ in ln), st) <= st["max_w"]
               for ln in wrap(phrase, st))


def split_to_fit(phrase, st):
    """Break a phrase until every piece fits two lines. The font size never shrinks.

    A two-piece split is scored first, so a seven-word phrase never leaves one word
    alone on screen when a more even split fits."""
    if len(phrase) <= 1 or fits(phrase, st):
        return [phrase]
    best = None
    for k in range(1, len(phrase)):
        if fits(phrase[:k], st) and fits(phrase[k:], st):
            score = abs(k - (len(phrase) - k)) + (10 if k == 1 or len(phrase) - k == 1 else 0)
            if best is None or score < best[0]:
                best = (score, k)
    if best:
        return [phrase[:best[1]], phrase[best[1]:]]
    for k in range(len(phrase) - 1, 0, -1):
        if fits(phrase[:k], st):
            return [phrase[:k]] + split_to_fit(phrase[k:], st)
    return [phrase[:1]] + split_to_fit(phrase[1:], st)


def header(st):
    fill = ass_colour(st["fill"])
    outline_col = ass_colour(st["outline_colour"])
    return (
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {st['play_w']}\nPlayResY: {st['play_h']}\n"
        "WrapStyle: 2\nScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\n\n[V4+ Styles]\n"
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,"
        "Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,"
        "Alignment,MarginL,MarginR,MarginV,Encoding\n"
        f"Style: Pop,{st['font']},{st['size']},{fill},{fill},{outline_col},"
        f"&H64000000&,0,0,0,0,100,100,2,0,1,{st['outline']:.0f},{st['shadow']:.0f},5,60,60,60,1\n\n"
        "[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n")


def build(phrases, st):
    active = ass_colour(st["active"])
    out = [header(st)]
    for pi, phrase in enumerate(phrases):
        if not phrase:
            continue
        lines = wrap(phrase, st)
        nl = len(lines)
        flat = [w for ln in lines for w in ln]
        card_end = flat[-1][2] + 0.20
        # The 0.2s hold must never run into the next phrase: where two phrases touch,
        # both would draw at once for a moment.
        nxt = next((q[0][1] for q in phrases[pi + 1:] if q), None)
        if nxt is not None:
            card_end = min(card_end, nxt)
        for li, line in enumerate(lines):
            cy = st["y"] + (li - (nl - 1) / 2) * st["size"] * st["line_h"]
            for i, (_, s, _e) in enumerate(flat):
                end = flat[i + 1][1] if i + 1 < len(flat) else card_end
                if end <= s:
                    continue
                parts = []
                for (w2, s2, _) in line:
                    if s2 == s:
                        parts.append(
                            rf"{{\t(0,{st['ramp']},{st['accel']},"
                            rf"\c{active}\fscy{st['lift']})}}{w2}{{\r}}")
                    else:
                        parts.append(w2)
                fade = (r"\fad(80,0)" if i == 0
                        else r"\fad(0,90)" if i == len(flat) - 1 else "")
                out.append(f"Dialogue: 0,{ts(s)},{ts(end)},Pop,,0,0,0,,"
                           rf"{{\an5\pos({st['play_w'] // 2},{cy:.0f}){fade}}}"
                           + " ".join(parts))
    return "\n".join(out) + "\n"


def write_ass(words, path, st):
    ass = build(phrases_from_words(words, st), st)
    with open(path, "w", encoding="utf-8") as f:
        f.write(ass)
    return path
