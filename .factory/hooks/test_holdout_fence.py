"""Self-tests for the holdout fence (holdout_fence.py), run as Claude Code runs it: one tool call as
JSON on standard input, exit 2 means refused.

    python3 .factory/hooks/test_holdout_fence.py

Nothing here writes to the fence: the fence only reads each call and answers. The cases cover what
issues #417 and #425 asked for (the starter's own settings file is writable, reading the fence is
fine) and the refusals that must stay (every way of writing the fence itself).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent / "holdout_fence.py"
ROOT = HOOK.parents[2]
HOME = Path.home()


def run(tool: str, tool_input: dict, cwd: Path = ROOT, agent: str | None = None,
        project: Path | None = ROOT) -> subprocess.CompletedProcess:
    event = {"tool_name": tool, "tool_input": tool_input, "cwd": str(cwd)}
    if agent:
        event["agent_type"] = agent
    env = {key: value for key, value in os.environ.items() if key not in ("CLAUDE_PROJECT_DIR", "CLAUDE_CONFIG_DIR")}
    if project is not None:
        env["CLAUDE_PROJECT_DIR"] = str(project)
    return subprocess.run([sys.executable, str(HOOK), "pre"], input=json.dumps(event), text=True,
                          capture_output=True, env=env, timeout=60)


class FenceCase(unittest.TestCase):
    def allowed(self, tool: str, tool_input: dict, **kwargs) -> None:
        result = run(tool, tool_input, **kwargs)
        self.assertEqual(result.returncode, 0, f"refused but should pass: {tool_input}\n{result.stderr}")

    def refused(self, tool: str, tool_input: dict, **kwargs) -> None:
        result = run(tool, tool_input, **kwargs)
        self.assertEqual(result.returncode, 2, f"passed but should be refused: {tool_input}\n{result.stderr}")

    def bash_allowed(self, command: str, **kwargs) -> None:
        self.allowed("Bash", {"command": command}, **kwargs)

    def bash_refused(self, command: str, **kwargs) -> None:
        self.refused("Bash", {"command": command}, **kwargs)


class WriteAndEdit(FenceCase):
    def test_starter_settings_are_a_product_file(self):
        for tool in ("Write", "Edit", "MultiEdit"):
            self.allowed(tool, {"file_path": str(ROOT / "starter-godspeed/.claude/settings.json")})
            self.allowed(tool, {"file_path": "starter-godspeed/.claude/settings.json"})
        self.allowed("Write", {"file_path": str(ROOT / "starter-godspeed/.claude/settings.local.json")})
        self.allowed("Write", {"file_path": str(ROOT / "starter-godspeed/.ignore")})
        self.allowed("Edit", {"file_path": str(ROOT / "starter-godspeed/.claude/hooks/some-hook.js")})

    def test_an_ordinary_file(self):
        self.allowed("Write", {"file_path": str(ROOT / "README.md")})
        self.allowed("Edit", {"file_path": str(ROOT / "factory/consumer.py")})

    def test_root_settings_are_fenced(self):
        for tool in ("Write", "Edit", "MultiEdit"):
            self.refused(tool, {"file_path": str(ROOT / ".claude/settings.json")})
        self.refused("Write", {"file_path": ".claude/settings.json"})
        self.refused("Write", {"file_path": "./.claude/settings.json"})
        self.refused("Write", {"file_path": ".claude\\settings.json"})
        self.refused("Write", {"file_path": str(ROOT / ".claude/settings.local.json")})
        self.refused("Write", {"file_path": "../.claude/settings.json"}, cwd=ROOT / "starter-godspeed")
        self.refused("Write", {"file_path": str(ROOT / "starter-godspeed/../.claude/settings.json")})
        self.refused("Write", {"file_path": str(ROOT / ".claude/settings.json").replace("/", "\\")})

    def test_ignore_and_hook_folder_are_fenced(self):
        self.refused("Write", {"file_path": str(ROOT / ".ignore")})
        self.refused("Edit", {"file_path": "./.ignore"})
        self.refused("Edit", {"file_path": str(ROOT / ".factory/hooks/holdout_fence.py")})
        self.refused("Write", {"file_path": str(ROOT / ".factory/hooks/another.py")})
        self.refused("NotebookEdit", {"notebook_path": str(ROOT / ".factory/hooks/x.ipynb")})

    def test_session_started_in_the_starter(self):
        starter = ROOT / "starter-godspeed"
        self.allowed("Write", {"file_path": str(starter / ".claude/settings.json")}, cwd=starter, project=starter)
        self.refused("Write", {"file_path": str(ROOT / ".claude/settings.json")}, cwd=starter, project=starter)

    def test_root_found_without_project_dir(self):
        self.refused("Write", {"file_path": str(ROOT / ".claude/settings.json")}, project=None)
        self.allowed("Write", {"file_path": str(ROOT / "starter-godspeed/.claude/settings.json")}, project=None)

    def test_account_settings_are_fenced(self):
        self.refused("Write", {"file_path": str(HOME / ".claude/settings.json")})
        self.refused("Write", {"file_path": "~/.claude/settings.json"})

    def test_a_second_worktree_of_this_repository(self):
        folder = Path(tempfile.mkdtemp())
        tree = folder / "second"
        made = subprocess.run(["git", "-C", str(ROOT), "worktree", "add", "--detach", str(tree)],
                              capture_output=True, text=True)
        if made.returncode != 0:
            shutil.rmtree(folder, ignore_errors=True)
            self.skipTest(f"git worktree add failed: {made.stderr.strip()}")
        try:
            self.refused("Write", {"file_path": str(tree / ".claude/settings.json")})
            self.refused("Edit", {"file_path": str(tree / ".factory/hooks/holdout_fence.py")})
            self.refused("Bash", {"command": f"rm '{tree.as_posix()}/.ignore'"})
            self.allowed("Write", {"file_path": str(tree / "starter-godspeed/.claude/settings.json")})
        finally:
            subprocess.run(["git", "-C", str(ROOT), "worktree", "remove", "--force", str(tree)], capture_output=True)
            shutil.rmtree(folder, ignore_errors=True)

    def test_another_repository_is_not_fenced(self):
        tree = Path(tempfile.mkdtemp())
        try:
            subprocess.run(["git", "init", "-q", str(tree)], check=True)
            self.allowed("Write", {"file_path": str(tree / ".claude/settings.json")})
        finally:
            shutil.rmtree(tree, ignore_errors=True)

    def test_a_link_into_the_fence(self):
        folder = Path(tempfile.mkdtemp())
        try:
            link = folder / "settings-link.json"
            try:
                link.symlink_to(ROOT / ".claude/settings.json")
            except (OSError, NotImplementedError):
                self.skipTest("this machine cannot make symbolic links")
            self.refused("Write", {"file_path": str(link)})
        finally:
            shutil.rmtree(folder, ignore_errors=True)


class ShellReads(FenceCase):
    """Naming or reading a fenced file is fine (#425)."""

    def test_reading_commands(self):
        for command in [
            "grep FENCE .factory/hooks/holdout_fence.py",
            "cat .claude/settings.json",
            "cat ./.claude/settings.json | head -5",
            "jq . .claude/settings.json",
            "cat .claude/settings.json > /tmp/settings-copy.json",
            "git show HEAD:.claude/settings.json > copy.json",
            "git diff -- .claude/settings.json",
            "git log --oneline -- .factory/hooks/holdout_fence.py",
            "git add starter-godspeed/.claude/settings.json && git status",
            "git reset -- .claude/settings.json",
            "git rm --cached -r .",
            "git checkout -b fix/fence",
            "git checkout -- .",
            "python3 .factory/hooks/test_holdout_fence.py",
            "sed -n 1,20p .factory/hooks/holdout_fence.py",
            "sed -e s/a/b/ .claude/settings.json",
            "cp .claude/settings.json /tmp/backup.json",
            "diff .claude/settings.json starter-godspeed/.claude/settings.json 2>/dev/null",
            "find . -name '*.pyc' -delete",
            "find .factory -name '*.py' -exec grep -l FENCE {} +",
            "rm -f *.log build/*.tmp",
            "echo done > \"$TMPDIR/out.txt\"",
            "cd starter-godspeed && cat .claude/settings.json > ../copy.json",
            "git restore .",
            "git reset --hard HEAD",
            "ln -s .factory/hooks /tmp/hooks-link",
            "ln -s ../.claude/settings.json /tmp/settings-link",
            "rsync -rtv src/ build/",
            "python3 -c \"open('starter-godspeed/.claude/settings.json', 'w').write('{}')\"",
            "tar -czf /tmp/backup.tgz .claude/settings.json",
            "tar -xzf node.tgz -C /tmp",
            "mv /tmp/readme.txt .",
            "mv /tmp/notes.txt .claude",
            "mv /tmp/notes.txt starter-godspeed/",
            "cp --parents src/a.txt build/",
            "git checkout -- . ':!.claude'",
            "cd starter-godspeed && git checkout -- ':/starter-godspeed/x.txt'",
        ]:
            with self.subTest(command=command):
                self.bash_allowed(command)

    def test_text_that_mentions_the_fence(self):
        self.bash_allowed('git commit -m "Mention .claude/settings.json; git checkout -- it > nowhere"')
        self.bash_allowed("git commit -m \"$(cat <<'EOF'\nThe fence in .factory/hooks/holdout_fence.py refuses\n"
                          "echo x > .claude/settings.json and git checkout -- .ignore\nEOF\n)\"")
        self.bash_allowed("gh pr create --title t --body \"$(cat <<'EOF'\n## Summary\nrm -rf .factory\n"
                          "`cp x .claude/settings.json` (#417)\nEOF\n)\"")
        self.bash_allowed("cat > /tmp/report.md <<'EOF'\nThe hook .factory/hooks/holdout_fence.py was refused;\n"
                          "sed -i was used on .ignore\nEOF")
        self.bash_allowed("echo 'rm .ignore' >> notes.txt")
        self.bash_allowed("cat <<EOF > /tmp/report.md\nThe file `.claude/settings.json` and \"$HOME\" (it's fine)\nEOF")

    def test_writing_the_starter_settings(self):
        self.bash_allowed("echo '{}' > starter-godspeed/.claude/settings.json")
        self.bash_allowed("cp /tmp/x.json starter-godspeed/.claude/settings.json")
        self.bash_allowed("sed -i 's/a/b/' starter-godspeed/.claude/settings.json")
        self.bash_allowed("jq . x.json | tee starter-godspeed/.claude/settings.json")
        self.bash_allowed("cd starter-godspeed && echo '{}' > .claude/settings.json")
        self.bash_allowed("git checkout -- starter-godspeed/.claude/settings.json")


class ShellWrites(FenceCase):
    """Every way of writing the fence itself stays refused."""

    def test_writing_commands(self):
        root = str(ROOT).replace("\\", "/")
        for command in [
            "echo '{}' > .claude/settings.json",
            "echo '{}' >| .claude/settings.json",
            "echo x >> ./.ignore",
            "echo x 2> .ignore",
            "echo x &> .claude/settings.local.json",
            f"echo x > {root}/.claude/settings.json",
            "printf x | tee .claude/settings.local.json",
            "printf x | tee -a .ignore",
            "sed -i 's/pre/post/' .factory/hooks/holdout_fence.py",
            "sed -i.bak 's/a/b/' .claude/settings.json",
            "perl -pi -e 's/a/b/' .ignore",
            "mv .claude/settings.json /tmp/x",
            "mv /tmp/x .claude/settings.json",
            "cp /tmp/x .claude/settings.json",
            "cp -r /tmp/hooks .factory/",
            "cp /tmp/x.py .factory/hooks",
            "cp --target-directory=.factory/hooks /tmp/new.py",
            "cp --target-directory .factory/hooks /tmp/new.py",
            "cp -t .factory/hooks /tmp/new.py",
            "cp -t.factory/hooks /tmp/new.py",
            "cp -at .factory/hooks /tmp/new.py",
            "install --target-directory=.factory/hooks /tmp/new.py",
            "mv -t.factory/hooks /tmp/new.py",
            "mv /tmp/hooks .factory",
            "cd starter-godspeed && cp --parents .claude/settings.json ..",
            f"cd /tmp && cp --parents ./.claude/settings.json {root}",
            "rsync -R starter-godspeed/./.claude/settings.json .",
            "cd .factory/hooks && echo \"$(rm holdout_fence.py)\"",
            "cd .factory/hooks && bash <<'EOF'\nrm holdout_fence.py\nEOF",
            "git checkout main -- ':(literal).factory/hooks/holdout_fence.py'",
            "git restore --source=HEAD~1 -- ':(top).ignore'",
            "cd starter-godspeed && git checkout main -- :/.ignore",
            "cd starter-godspeed && git rm ':(top,icase).IGNORE'",
            "ln -s /tmp/evil.json .claude/settings.json",
            "ln -s -t .factory/hooks /tmp/evil.py",
            "rsync -rtv /tmp/hooks/ .factory/hooks/",
            "git restore -- .claude",
            "git checkout main -- .",
            "git restore --source HEAD~3 .",
            "tar -xf a.tar .claude/settings.json",
            "python3 -c \"open('.claude/settings.json').read()\"",
            "python3 -c \"import os; open(os.environ['ROOT'] + '/.claude/settings.json', 'w')\"",
            "install -m 644 /tmp/x .ignore",
            "rm .ignore",
            "rm -rf .factory",
            "rm -rf .claude",
            "rm -f .factory/hooks/*.py",
            "rm .claude/*.json",
            "rm .claude/settings{,.local}.json",
            "chmod 000 .factory/hooks/holdout_fence.py",
            "chmod -R 000 .factory",
            "truncate -s 0 .ignore",
            "touch .claude/settings.local.json",
            "dd if=/dev/null of=.ignore",
            "ln -sf /tmp/x .claude/settings.json",
            "curl -o .claude/settings.json https://example.com/x",
            "git checkout -- .claude/settings.json",
            "git checkout main -- .factory/hooks/holdout_fence.py",
            "git restore .factory/hooks/holdout_fence.py",
            "git restore --source HEAD~1 .ignore",
            "git rm .ignore",
            "git rm -r .factory",
            "git mv .claude/settings.json x.json",
            f"git -C {root} checkout -- .ignore",
            "cd .claude && echo x > settings.json",
            "cd starter-godspeed && echo x > ../.claude/settings.json",
            "bash -c 'echo x > .ignore'",
            "sh -c \"rm -rf .factory\"",
            "eval 'rm .ignore'",
            "echo $(rm .ignore)",
            "echo `rm .ignore`",
            "python3 -c \"open('.claude/settings.json', 'w').write('{}')\"",
            "node -e \"require('fs').writeFileSync('.ignore', '')\"",
            "cat <<'EOF' > .claude/settings.json\n{}\nEOF",
            "tee .ignore <<EOF\nx\nEOF",
            "bash <<'EOF'\nrm .ignore\nEOF",
            "python3 - <<'EOF'\nopen('.claude/settings.json', 'w')\nEOF",
            "cat <<'EOF' | sh\nrm -rf .factory\nEOF",
            "cat <<EOF > /tmp/x\n$(rm .ignore)\nEOF",
            "echo .ignore | xargs rm",
            "find . -name settings.json -delete",
            "find . -name '*.json' -delete",
            "find .factory -delete",
            "find . -path './.factory/*' -exec rm {} +",
            "echo x > \"$HOME/.claude/settings.json\"",
            "echo x > ~/.claude/settings.json",
            "echo x > \"$SOMEWHERE/.claude/settings.json\"",
            "sudo rm .ignore",
            "env A=1 rm .ignore",
            "timeout 10 rm .ignore",
        ]:
            with self.subTest(command=command):
                self.bash_refused(command)

    def test_relative_to_a_subfolder(self):
        self.bash_refused("rm ../.ignore", cwd=ROOT / "starter-godspeed")
        self.bash_refused("echo x > ../.claude/settings.json", cwd=ROOT / "starter-godspeed")


class PowerShell(FenceCase):
    def test_reading_is_fine(self):
        for command in [
            "Get-Content .claude/settings.json",
            "Get-Content .claude\\settings.json | Out-File copy.json",
            "Select-String FENCE .factory\\hooks\\holdout_fence.py",
            "Copy-Item .claude\\settings.json C:\\temp\\backup.json",
            "Set-Content -Path starter-godspeed\\.claude\\settings.json -Value '{}'",
            "Move-Item -LiteralPath notes.txt -Destination starter-godspeed\\notes.txt",
            "Copy-Item -LiteralPath x.json -Destination starter-godspeed\\.claude\\settings.json",
        ]:
            with self.subTest(command=command):
                self.allowed("PowerShell", {"command": command})

    def test_writing_is_refused(self):
        for command in [
            "Set-Content -Path .claude\\settings.json -Value '{}'",
            "Add-Content .ignore 'x'",
            "'{}' | Out-File -FilePath .claude/settings.json",
            "Remove-Item -Recurse -Force .factory",
            "Move-Item .claude\\settings.json x.json",
            "Copy-Item C:\\temp\\x.json -Destination .claude\\settings.json",
            "Move-Item -LiteralPath C:\\temp\\x.json -Destination .claude\\settings.json",
            "Clear-Content .ignore",
            "echo x > .ignore",
        ]:
            with self.subTest(command=command):
                self.refused("PowerShell", {"command": command})


class Holdout(FenceCase):
    """The holdout folder stays hidden from everyone but the holdout subagents (unchanged)."""

    def test_holdout_folder(self):
        scenarios = str(ROOT / ".factory/holdout/HOLDOUT.md")
        self.refused("Read", {"file_path": scenarios})
        self.allowed("Read", {"file_path": scenarios}, agent="holdout-verifier")
        self.refused("Bash", {"command": "cat .factory/holdout/HOLDOUT.md"})
        self.refused("Bash", {"command": "grep -r scenario ."})
        self.allowed("Read", {"file_path": str(ROOT / ".factory/hooks/holdout_fence.py")})

    def test_fence_refused_even_for_holdout_agents(self):
        self.refused("Write", {"file_path": str(ROOT / ".claude/settings.json")}, agent="holdout-writer")
        self.refused("Bash", {"command": "rm .ignore"}, agent="holdout-verifier")

    def test_an_unreadable_call_is_refused(self):
        event = "not json"
        result = subprocess.run([sys.executable, str(HOOK), "pre"], input=event, text=True, capture_output=True)
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main(verbosity=1)
