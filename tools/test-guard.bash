# test-guard.bash - sourced by every shell test in tools/ before it does anything else:
# a test never reaches a real mission control.
#
# 9 October 2026: tools/test-launchers.sh, run on Michael's computer, replaced only HOME. It
# inherited the GODSPEED_DIR his shell sets, and one of its checks read his real deadlines (read
# only, by luck). So every variable that names a mission control, an assistant, a notebook or a
# device is dropped here, and the home folders, where ~/.godspeed/device.env names the mission
# control this computer was joined to, point at an empty throwaway folder (HOME everywhere,
# USERPROFILE, which is what Node and Python call home on Windows). A test that needs one of them
# sets its own, as before. Git keeps the person's own settings, read only, so a test commit still
# has an author.
#
# The throwaway home is $TEST_GUARD_HOME; a test that sets its own EXIT trap removes it there too.
# Plain sh as well as bash: tools/test-world-pull.sh is an sh script.
for _guard_v in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' | grep -E '^(GODSPEED_|HERMES_|MENERIO_|KB_|MC_)|^(CODEX_HOME|CLAUDE_CONFIG_DIR)$'); do
  unset "$_guard_v"
done
unset _guard_v
if [ -z "${GIT_CONFIG_GLOBAL:-}" ] && [ -n "${HOME:-}" ] && [ -f "$HOME/.gitconfig" ]; then
  export GIT_CONFIG_GLOBAL="$HOME/.gitconfig"
fi
TEST_GUARD_HOME="$(mktemp -d)"
export HOME="$TEST_GUARD_HOME"
if command -v cygpath >/dev/null 2>&1; then
  # Windows keeps an assistant's settings in %LOCALAPPDATA% (Hermes, the Godspeed installation)
  # and %APPDATA% (Claude Desktop), and mc-mail and menerio-connect look there.
  mkdir -p "$TEST_GUARD_HOME/AppData/Local" "$TEST_GUARD_HOME/AppData/Roaming"
  export USERPROFILE="$(cygpath -w "$TEST_GUARD_HOME")"
  export LOCALAPPDATA="$(cygpath -w "$TEST_GUARD_HOME/AppData/Local")"
  export APPDATA="$(cygpath -w "$TEST_GUARD_HOME/AppData/Roaming")"
else
  export USERPROFILE="$TEST_GUARD_HOME"
fi
trap 'rm -rf "$TEST_GUARD_HOME"' EXIT
