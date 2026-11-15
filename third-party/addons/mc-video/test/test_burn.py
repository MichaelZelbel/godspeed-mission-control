# -*- coding: utf-8 -*-
"""burn.py hands faster-whisper the sound as samples, never as a file it would open with PyAV.

A setup made on 18 October 2026 got PyAV 19, whose open() no longer takes the metadata_errors
argument faster-whisper 1.2.1 passes, and every caption stopped there. Run:
python -m unittest discover -s test -p "test_*.py"."""
import os
import struct
import sys
import tempfile
import unittest
import wave

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))

try:
    import numpy  # noqa: F401  (comes with the speech model's code)
    import PIL  # noqa: F401  (captions.py, which burn.py loads, measures the font with it)
    HAVE = True
except ImportError:
    HAVE = False


def write_wav(path, samples, rate=16000, channels=1):
    with wave.open(path, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<%dh" % len(samples), *samples))


@unittest.skipUnless(HAVE, "needs numpy and Pillow, as the speech model's own Python has")
class ReadWav(unittest.TestCase):
    def test_the_sound_becomes_float_samples_between_minus_one_and_one(self):
        import burn
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, "audio.wav")
            write_wav(f, [0, 16384, -32768, 32767])
            got = burn.read_wav(f)
        self.assertEqual(str(got.dtype), "float32")
        self.assertEqual([round(float(x), 4) for x in got], [0.0, 0.5, -1.0, 1.0])

    def test_sound_in_another_shape_is_refused_rather_than_misheard(self):
        import burn
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, "audio.wav")
            write_wav(f, [0, 0, 0, 0], rate=44100)
            with self.assertRaises(SystemExit):
                burn.read_wav(f)

    def test_transcribe_passes_samples_not_the_file_name(self):
        import burn
        src = open(burn.__file__, encoding="utf-8").read()
        self.assertIn("audio = read_wav(wav)", src)
        self.assertIn("m.transcribe(audio,", src)


if __name__ == "__main__":
    unittest.main()
