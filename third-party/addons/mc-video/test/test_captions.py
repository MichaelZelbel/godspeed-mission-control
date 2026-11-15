# -*- coding: utf-8 -*-
"""Network-free tests for the caption layout. Run: python -m unittest discover -s test -p "test_*.py"."""
import json
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import captions  # noqa: E402


def words(text, start=0.0, step=0.3):
    out, t = [], start
    for tok in text.split():
        out.append({"w": " " + tok, "s": round(t, 3), "e": round(t + step - 0.05, 3)})
        t += step
    return out


class Style(unittest.TestCase):
    def test_vertical_frame_gets_the_vertical_block(self):
        st = captions.load_style(None, 1080, 1920)
        self.assertEqual(st["shape"], "vertical")
        self.assertEqual((st["size"], st["y"], st["max_w"]), (80, 1530, 900))

    def test_horizontal_frame_gets_the_horizontal_block(self):
        st = captions.load_style(None, 1920, 1080)
        self.assertEqual(st["shape"], "horizontal")
        self.assertEqual((st["size"], st["y"]), (64, 930))

    def test_a_smaller_frame_scales_the_block(self):
        st = captions.load_style(None, 720, 1280)
        self.assertAlmostEqual(st["y"], 1530 * 720 / 1080)
        self.assertEqual(st["size"], round(80 * 720 / 1080))

    def test_a_missing_font_file_falls_back_to_the_shipped_font(self):
        with tempfile.TemporaryDirectory() as d:
            raw = json.load(open(captions.DEFAULT_STYLE_FILE, encoding="utf-8"))
            raw["font_file"] = "no-such-font.ttf"
            p = os.path.join(d, "style.json")
            json.dump(raw, open(p, "w", encoding="utf-8"))
            st = captions.load_style(p, 1080, 1920)
            self.assertEqual(st["font_file"], captions.DEFAULT_FONT_FILE)

    def test_colours_are_written_in_ass_byte_order(self):
        self.assertEqual(captions.ass_colour("#FFE726"), "&H0026E7FF&")
        self.assertEqual(captions.ass_colour("#000000"), "&H00000000&")


class Phrases(unittest.TestCase):
    def setUp(self):
        self.st = captions.load_style(None, 1080, 1920)

    def test_a_split_word_is_joined_again(self):
        w = [{"w": " the", "s": 0, "e": 0.2}, {"w": " add", "s": 0.2, "e": 0.4}, {"w": "-on.", "s": 0.4, "e": 0.6}]
        self.assertEqual([x["w"] for x in captions.join_pieces(w)], [" the", " add-on."])

    def test_a_sentence_end_after_seven_words_does_not_stand_alone(self):
        ph = captions.phrases_from_words(words("this clip came with the mission control video add-on."), self.st)
        self.assertTrue(all(len(p) > 1 for p in ph), [[x[0] for x in p] for p in ph])

    def test_a_pause_starts_a_new_phrase(self):
        w = words("one two") + words("three four", start=2.0)
        ph = captions.phrases_from_words(w, self.st)
        self.assertEqual([[x[0] for x in p] for p in ph], [["ONE", "TWO"], ["THREE", "FOUR"]])

    def test_every_line_of_two_or_more_words_fits_the_width(self):
        text = "responsibilities notwithstanding extraordinarily complicated circumstances everywhere " * 3
        for p in captions.phrases_from_words(words(text), self.st):
            for line in captions.wrap(p, self.st):
                if len(line) > 1:
                    self.assertLessEqual(captions.width_of(" ".join(x[0] for x in line), self.st), self.st["max_w"])

    def test_a_word_wider_than_the_frame_stands_alone_rather_than_shrinking(self):
        # The size never changes between captions; the safe-zone check after burning
        # reports such a word so a person looks at it.
        ph = captions.phrases_from_words(words("see internationalization now"), self.st)
        self.assertIn([("INTERNATIONALIZATION",)], [[(x[0],) for x in p] for p in ph])

    def test_punctuation_is_removed_and_text_is_uppercase(self):
        ph = captions.phrases_from_words(words("hello, world."), self.st)
        self.assertEqual([x[0] for x in ph[0]], ["HELLO", "WORLD"])


class Ass(unittest.TestCase):
    def setUp(self):
        self.st = captions.load_style(None, 1080, 1920)

    def test_the_header_matches_the_frame(self):
        st = captions.load_style(None, 1920, 1080)
        head = captions.header(st)
        self.assertIn("PlayResX: 1920", head)
        self.assertIn("PlayResY: 1080", head)
        self.assertIn("Style: Pop,Archivo Black,64,", head)

    def test_a_phrase_never_overlaps_the_next(self):
        w = [{"w": " a", "s": 0.0, "e": 0.3}, {"w": " b.", "s": 0.3, "e": 0.6}, {"w": " c", "s": 0.6, "e": 0.9}]
        ass = captions.build(captions.phrases_from_words(w, self.st), self.st)
        events = re.findall(r"Dialogue: 0,(\d+:\d\d:[\d.]+),(\d+:\d\d:[\d.]+),", ass)
        def sec(t):
            h, m, s = t.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
        first_phrase_end = max(sec(e) for s, e in events if sec(s) < 0.6)
        self.assertLessEqual(first_phrase_end, 0.6)

    def test_the_spoken_word_is_highlighted_with_colour_and_height_only(self):
        ass = captions.build(captions.phrases_from_words(words("one two"), self.st), self.st)
        self.assertIn(r"\c&H0026E7FF&\fscy106", ass)
        self.assertNotIn(r"\fscx", ass)


if __name__ == "__main__":
    unittest.main()
