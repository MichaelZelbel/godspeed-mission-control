#!/usr/bin/env python3
# For docker/test.sh only: the "your computer's browser" tools (computer use layer 2, D-285),
# called through the same door a model's tool call uses (model_tools), as the assistant's
# account, after Hermes discovered them from mcp_servers.computer. No AI model, no key.
#
#   probe-computer.py offered                 the Telegram chat is offered the computer tools
#   probe-computer.py call <tool> [json args] prints the tool's answer text
import json
import sys

sys.path.insert(0, "/opt/hermes")
import model_tools  # noqa: E402
from tools.mcp_tool_discovery import discover_mcp_tools  # noqa: E402

found = discover_mcp_tools()


def full_name(short):
    hit = [n for n in found if n.endswith(short)]
    return hit[0] if hit else None


if sys.argv[1] == "offered":
    # The toolsets a Telegram turn gets, resolved the way the gateway resolves them
    # (configured MCP servers join every platform by default).
    from hermes_cli.config import load_config
    from hermes_cli.tools_config import _get_platform_tools
    enabled = sorted(_get_platform_tools(load_config(), "telegram"))
    # Every tool the turn may use; Hermes may list MCP tools in its tool-search catalog instead of
    # sending each one, which the model reaches through tool_search / tool_call.
    offered = {d["function"]["name"] for d in model_tools.get_tool_definitions(
        enabled_toolsets=enabled, quiet_mode=True, skip_tool_search_assembly=True)}
    want = ["computer_browser_open", "computer_browser_read", "computer_when_back", "computer_connect_code"]
    missing = [w for w in want if not (full_name(w) and full_name(w) in offered)]
    print("OFFERED" if not missing else "MISSING " + ", ".join(missing))
    print("names: " + ", ".join(sorted(n for n in offered if "computer" in n)))
    sys.exit(0 if not missing else 1)

if sys.argv[1] == "call":
    name = full_name(sys.argv[2])
    if not name:
        print("NO SUCH TOOL " + sys.argv[2])
        sys.exit(1)
    args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
    raw = model_tools.handle_function_call(name, args, task_id="godspeed-computer-probe")
    try:
        out = json.loads(raw)
        if isinstance(out, dict):
            out = out.get("result", out.get("content", out))
    except (TypeError, ValueError):
        out = raw
    print(out if isinstance(out, str) else json.dumps(out))
