# -*- coding: utf-8 -*-
"""Burned-in captions for short-form video, as one fixed style.

The look is defined once in STYLE and reused on every video forever. There is no
style picker. Change a number here and every future video changes with it.

Two rules the layout depends on, both learned the hard way:
  * a line is ONE string, so libass does the word spacing. Positioning words
    yourself with PIL metrics spreads them apart, because those advance widths
    do not match what libass renders.
  * emphasis uses colour and \fscy (vertical scale only). Neither changes
    horizontal advance, so highlighting a word cannot reflow the line.
"""
import os
from PIL import ImageFont

# ============ THE STYLE. The only thing anyone ever chooses. ============
STYLE = dict(
    font="Arial Black", font_file="C:/Windows/Fonts/ariblk.ttf",
    size=80,
    fill=r"&H00FFFFFF&",          # white   (ASS colour order is &HBBGGRR)
    active=r"&H0026E7FF&",        # amber, marks the word being spoken
    outline_col=r"&H00000000&",
    outline=9, shadow=4,          # must survive being over skin or a bright screen
    y=1530, line_h=1.18,          # over the chest, below the chin
    max_w=900,                    # inside the button rail, and leaves room for the outline
    lift=106,                     # 6%, vertical only
    ramp=190, accel=0.65,         # eased in. linear reads as jabbing.
    uppercase=True,
    play_w=1080, play_h=1920,
)
# ========================================================================

MAX_WORDS_PER_PHRASE = 7
PHRASE_GAP = 0.35          # a pause longer than this starts a new phrase


def ts(t):
    return f"{int(t//3600)}:{int(t%3600//60):02d}:{t%60:05.2f}"


def _font(st):
    return ImageFont.truetype(st["font_file"], st["size"])


def width_of(txt, st):
    """Advance width plus letter spacing plus the outline, which spills past the glyphs."""
    return _font(st).getlength(txt) + 2 * len(txt) + 2 * st["outline"]


def phrases_from_words(words, st=STYLE):
    """Group whisper word dicts [{w,s,e}] into caption phrases.

    Breaks on sentence punctuation, on pauses, and on length.
    """
    out, cur = [], []
    for i, w in enumerate(words):
        text = w["w"].strip()
        if not text:
            continue
        cur.append((text.upper() if st["uppercase"] else text, w["s"], w["e"]))
        ends_sentence = text.rstrip()[-1:] in ".!?"
        gap_next = (words[i + 1]["s"] - w["e"]) if i + 1 < len(words) else 99
        if ends_sentence or gap_next > PHRASE_GAP or len(cur) >= MAX_WORDS_PER_PHRASE:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    cleaned = [[(w.strip(".,!?;:"), s, e) for w, s, e in p] for p in out]
    fitted = []
    for p in cleaned:
        fitted.extend(split_to_fit(p, st))
    return fitted


def wrap(phrase, st=STYLE):
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


def fits(phrase, st=STYLE):
    """True when this phrase lays out in <= 2 lines that each fit max_w."""
    return all(width_of(" ".join(w for w, _, _ in ln), st) <= st["max_w"]
               for ln in wrap(phrase, st))


def split_to_fit(phrase, st=STYLE):
    """Break a phrase until every piece fits two lines. Keeps the font size constant."""
    if len(phrase) <= 1 or fits(phrase, st):
        return [phrase]
    for k in range(len(phrase) - 1, 0, -1):
        if fits(phrase[:k], st):
            return [phrase[:k]] + split_to_fit(phrase[k:], st)
    return [phrase[:1]] + split_to_fit(phrase[1:], st)


def header(st):
    return (
"[Script Info]\nScriptType: v4.00+\n"
f"PlayResX: {st['play_w']}\nPlayResY: {st['play_h']}\n"
"WrapStyle: 2\nScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\n\n[V4+ Styles]\n"
"Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,"
"Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,"
"Alignment,MarginL,MarginR,MarginV,Encoding\n"
f"Style: Pop,{st['font']},{st['size']},{st['fill']},{st['fill']},{st['outline_col']},"
f"&H64000000&,0,0,0,0,100,100,2,0,1,{st['outline']},{st['shadow']},5,60,60,60,1\n\n"
"[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n")


def build(phrases, st=STYLE, ys=None):
    """ys: optional per-phrase vertical centre, for cuts whose layout moves the chin around
    (fullscreen face vs. split); None keeps the single STYLE["y"] for every phrase."""
    out = [header(st)]
    for pi, phrase in enumerate(phrases):
        if not phrase:
            continue
        lines = wrap(phrase, st)
        nl = len(lines)
        flat = [w for ln in lines for w in ln]
        card_end = flat[-1][2] + 0.20
        # The 0.2s hold must never run into the next phrase: at a zero-gap boundary
        # (a 7-word cut, or whisper words that touch) both phrases drew at once.
        nxt = next((q[0][1] for q in phrases[pi + 1:] if q), None)
        if nxt is not None:
            card_end = min(card_end, nxt)
        for li, line in enumerate(lines):
            cy = (ys[pi] if ys else st["y"]) + (li - (nl - 1) / 2) * st["size"] * st["line_h"]
            for i, (_, s, _e) in enumerate(flat):
                end = flat[i + 1][1] if i + 1 < len(flat) else card_end
                parts = []
                for (w2, s2, _) in line:
                    if s2 == s:
                        parts.append(
                            rf"{{\t(0,{st['ramp']},{st['accel']},"
                            rf"\c{st['active']}\fscy{st['lift']})}}{w2}{{\r}}")
                    else:
                        parts.append(w2)
                fade = (r"\fad(80,0)" if i == 0
                        else r"\fad(0,90)" if i == len(flat) - 1 else "")
                out.append(f"Dialogue: 0,{ts(s)},{ts(end)},Pop,,0,0,0,,"
                           rf"{{\an5\pos({st['play_w']//2},{cy:.0f}){fade}}}"
                           + " ".join(parts))
    return "\n".join(out) + "\n"


def write_ass(words, path, st=STYLE):
    ass = build(phrases_from_words(words, st), st)
    with open(path, "w", encoding="utf-8") as f:
        f.write(ass)
    return path
