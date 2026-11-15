#!/bin/sh
# Paging and claim-format tests for tools/world-pull.py.
. "$(dirname "$0")/test-guard.bash"
exec python3 "$(dirname "$0")/test_world_pull.py" "$@"
