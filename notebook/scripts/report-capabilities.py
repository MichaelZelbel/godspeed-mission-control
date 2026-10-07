"""Compatibility entry point. Inclusion is never inferred from a name."""
import pathlib,subprocess,sys
script=pathlib.Path(__file__).with_name('acceptance-matrix.mjs')
sys.exit(subprocess.call(['node',str(script),*sys.argv[1:]]))
