# 2. Your first captions

## Ask for them

Take a clip you already cut, with you talking in it. Tell your assistant where it is:

> Caption ~/Videos/2026-09-20-talk.mp4.

It runs `mc-video captions` on the clip and reports three things: the file it made
(`2026-09-20-talk.captioned.mp4`, next to the original), that the length matches the original,
and whether the captions stayed inside the safe zone, the part of a phone screen that the app's
buttons and the caption of the post do not cover. The original clip is never changed.

For a phone-shaped version:

> Make a vertical version of ~/Videos/2026-09-20-talk.mp4 for Reels, with captions.

That makes `2026-09-20-talk.vertical.mp4` from the middle of your picture, 1080 by 1920, and
captions it. Anything at the far left or right of a wide shot is cut off, so watch the first
seconds before you post.

## When a word is wrong

The speech model mishears names, brands and rare words. The words it heard are saved next to
the clip in `2026-09-20-talk.words.json`, one entry per word:

```
{
 "w": " Hermes",
 "s": 12.34,
 "e": 12.71
}
```

Correct the word after `"w":`, keep the space in front of it, leave the numbers alone, save,
and ask again. The second run reuses the file and does not listen again. You can also tell
your assistant "the caption says Hermits, it should be Hermes" and it edits the file for you.

## Your one look

Every video gets the same captions: heavy white capitals with a thick black outline, and the
word being spoken lifts slightly and turns yellow. That look is one file in your mission control:
`video/caption-style.json`.

Change it by asking, or by editing the file:

- `active` is the colour of the spoken word, as `#RRGGBB`. `fill` is the other words.
- `size` and `y` sit in two blocks, `vertical` for a 1080x1920 picture and `horizontal` for
  1920x1080. `y` is the height of the caption's middle; 1530 is over the chest in a vertical
  talking-head shot.
- `uppercase` true or false.
- `font` and `font_file` together: the font's name and the path to its `.ttf` file. Both must
  belong to the same font.

Keep `outline` at 9 or more. Thinner outlines disappear over skin and bright screens.

The point of one file is that you never choose a style again. Change it once and every later
video follows.
