import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
import os
import tempfile
import subprocess
import sys
import json
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("addon_model", Path(__file__).parents[1] / "assistant-files" / "addon-model.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HostModelTests(unittest.TestCase):
    def test_package_manager_dependencies_are_loaded_through_its_own_bootstrap(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, generation = root / "hermes-source", root / "selected-dependencies"
            source.mkdir()
            generation.mkdir()
            (generation / "store_only_dependency.py").write_text("loaded = True\n", encoding="utf-8")
            (source / "hermes_bootstrap.py").write_text("import sys\nsys.path.insert(0, " + repr(str(generation)) + ")\n", encoding="utf-8")
            modules = {
                "hermes_cli/__init__.py": "",
                "hermes_cli/config.py": "import store_only_dependency\ndef load_config_readonly():\n    return {'model': {'provider': 'owner-provider', 'default': 'owner-model'}}\n",
                "hermes_cli/runtime_provider.py": "resolve_runtime_provider = _get_named_custom_provider = expand_direct_api_alias = None\n",
                "agent/__init__.py": "",
                "agent/auxiliary_client.py": "resolve_provider_client = _normalize_aux_provider = None\n",
            }
            for relative, content in modules.items():
                file = source / relative
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(content, encoding="utf-8")
            helper = Path(__file__).parents[1] / "assistant-files" / "addon-model.py"
            env = {**os.environ, "PYTHONPATH": str(source), "HERMES_HOME": str(root / "owner-home")}
            done = subprocess.run([sys.executable, str(helper)], input='{"describe":true}', text=True, capture_output=True, env=env)
            self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
            self.assertEqual(json.loads(done.stdout), {"configured": True, "provider": "owner-provider", "model": "owner-model"})

    @unittest.skipUnless(importlib.util.find_spec("dotenv"), "python-dotenv is supplied by the Hermes runtime")
    def test_current_host_credentials_override_stale_caller_environment(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, ".env").write_text("OPENAI_API_KEY=current-host-test-key\nOPENAI_BASE_URL=https://current.example\n", encoding="utf-8")
            with patch.dict(os.environ, {"HERMES_HOME": folder, "OPENAI_API_KEY": "stale-caller-test-key", "OPENAI_BASE_URL": "https://stale.example", "HOST_ENV_ONLY_TEST": "kept"}):
                module.load_host_environment()
                self.assertEqual(os.environ["OPENAI_API_KEY"], "current-host-test-key")
                self.assertEqual(os.environ["OPENAI_BASE_URL"], "https://current.example")
                self.assertEqual(os.environ["HOST_ENV_ONLY_TEST"], "kept")

    def test_selected_connection_is_used_without_tools_agent_or_fallback(self):
        calls = []
        class Completions:
            def create(self, **kwargs):
                calls.append(kwargs)
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="answer", tool_calls=[]))])
        def resolve(**kwargs):
            self.assertEqual(kwargs, {"requested": "owner-provider", "target_model": "owner-model"})
            return {"provider": "owner-provider", "api_key": "host-key", "base_url": "https://owner.example", "api_mode": "responses"}
        def client(provider, **kwargs):
            self.assertEqual(provider, "owner-provider")
            self.assertEqual(kwargs["model"], "owner-model")
            return SimpleNamespace(chat=SimpleNamespace(completions=Completions())), "owner-model"
        result = module.request({"system": "contract", "prompt": "fictional profile", "timeout_ms": 3000, "max_tokens": 128}, load_config=lambda: {"model": {"provider": "owner-provider", "default": "owner-model"}}, resolve_runtime=resolve, resolve_client=client)
        self.assertEqual(result, {"text": "answer", "provider": "owner-provider", "model": "owner-model"})
        self.assertNotIn("tools", calls[0])
        self.assertEqual(calls[0]["messages"], [{"role": "system", "content": "contract"}, {"role": "user", "content": "fictional profile"}])

    def test_check_does_not_resolve_or_refresh_credentials(self):
        def never(**kwargs):
            self.fail("check must not resolve credentials or infer")
        config = {"model": {"provider": "local", "default": "current"}}
        result = module.request({"describe": True}, load_config=lambda: config, resolve_runtime=never, resolve_client=never)
        self.assertEqual(result, {"configured": True, "provider": "local", "model": "current"})
        config["model"]["default"] = "changed-by-owner"
        self.assertEqual(module.request({"describe": True}, load_config=lambda: config, resolve_runtime=never, resolve_client=never)["model"], "changed-by-owner")

    def test_no_configuration_or_auto_provider_is_an_error(self):
        for config in [{}, {"model": {"provider": "auto", "default": "x"}}, {"model": {"provider": "specific"}}]:
            with self.assertRaises(ValueError):
                module.selected(config)

    def test_unexpected_provider_and_custom_endpoint_are_refused_before_request(self):
        def never(*args, **kwargs):
            self.fail("an unexpected route must not obtain a client or send text")
        payload = {"system": "x", "prompt": "y", "timeout_ms": 1000, "max_tokens": 128}
        config = {"model": {"provider": "owner", "default": "chosen"}}
        with self.assertRaises(ValueError):
            module.request(payload, load_config=lambda: config, resolve_runtime=lambda **kwargs: {"provider": "other"}, resolve_client=never)
        with self.assertRaises(ValueError):
            module.request(payload, load_config=lambda: config, resolve_runtime=lambda **kwargs: {"provider": "custom", "base_url": "https://other.example"}, resolve_client=never, expected_route=lambda *args: ("custom", "https://owner.example"))


class HermesDidNotLoadTests(unittest.TestCase):
    """26 October 2026: the Python an add-on ran on could not load Hermes (a module Hermes needs was
    missing), and the answer said "Check its connection and usage allowance". A Hermes that does not
    load is now its own answer, "runtime", given before anything is asked."""

    def run_helper(self, modules, payload='{"describe":true}'):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "hermes-source"
            parts = {
                "hermes_cli/__init__.py": "",
                "hermes_cli/config.py": "def load_config_readonly():\n    return {'model': {'provider': 'owner-provider', 'default': 'owner-model'}}\n",
                "hermes_cli/runtime_provider.py": "resolve_runtime_provider = _get_named_custom_provider = expand_direct_api_alias = None\n",
                "agent/__init__.py": "",
                "agent/auxiliary_client.py": "resolve_provider_client = _normalize_aux_provider = None\n",
                **modules,
            }
            for relative, content in parts.items():
                file = source / relative
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(content, encoding="utf-8")
            helper = Path(__file__).parents[1] / "assistant-files" / "addon-model.py"
            env = {**os.environ, "PYTHONPATH": str(source), "HERMES_HOME": str(Path(folder) / "owner-home")}
            done = subprocess.run([sys.executable, str(helper)], input=payload, text=True, capture_output=True, env=env)
            return done.returncode, json.loads(done.stdout)

    def test_a_missing_module_is_named_and_is_no_usage_limit(self):
        code, answer = self.run_helper({"hermes_cli/config.py": "import godspeed_test_missing_dependency\n"})
        self.assertEqual(code, 1)
        self.assertEqual(answer, {"error": "Godspeed could not load its AI program (Hermes) on this computer.",
                                  "reason": "runtime", "missing": "godspeed_test_missing_dependency"})

    def test_a_bootstrap_that_refuses_and_stops_is_hermes_not_loading(self):
        code, answer = self.run_helper({"hermes_bootstrap.py": "import sys\nsys.exit('refusing to update: owned by another account')\n"})
        self.assertEqual(code, 1)
        self.assertEqual(answer, {"error": "Godspeed could not load its AI program (Hermes) on this computer.", "reason": "runtime"})

    def test_after_hermes_loaded_a_failure_is_never_runtime(self):
        # Loaded, but no model chosen in the home: the caller must not try another Python.
        code, answer = self.run_helper({"hermes_cli/config.py": "def load_config_readonly():\n    return {}\n"})
        self.assertEqual(code, 1)
        self.assertIsNone(answer["reason"])
        self.assertNotIn("missing", answer)

    def test_only_a_plain_module_name_leaves(self):
        try:
            try:
                raise ModuleNotFoundError("No module named 'ruamel'", name="ruamel")
            except ImportError as cause:
                raise RuntimeError("bootstrap failed") from cause
        except RuntimeError as error:
            self.assertEqual(module.missing_module(error), "ruamel")
        self.assertIsNone(module.missing_module(ModuleNotFoundError("x", name="sk-test key")))
        self.assertIsNone(module.missing_module(ValueError("no module here")))
        self.assertEqual(module.reason(module.HermesNotLoaded("ruamel")), "runtime")


class BackupTests(unittest.TestCase):
    """A backup AI the person connected (discussion #20): Hermes' first fallback entry, tried only
    when the selected model failed, only for that request, and named in the answer."""
    payload = {"system": "contract", "prompt": "fictional profile", "timeout_ms": 3000, "max_tokens": 128}
    config = {"model": {"provider": "openai-codex", "default": "plan-model"},
              "fallback_providers": [{"provider": "openrouter", "model": "backup/model",
                                      "base_url": "https://openrouter.ai/api/v1", "api_key": "backup-test-key"}]}

    def route(self, main_works):
        resolved, sent = [], []

        class Completions:
            def __init__(self, model):
                self.model = model

            def create(self, **kwargs):
                sent.append(kwargs["model"])
                if kwargs["model"] == "plan-model" and not main_works:
                    raise RuntimeError("HTTP 429: usage limit reached")
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="from " + kwargs["model"], tool_calls=[]))])

        def resolve(**kwargs):
            resolved.append(kwargs)
            if kwargs["requested"] == "openrouter":
                return {"provider": "openrouter", "api_key": kwargs.get("explicit_api_key"), "base_url": kwargs.get("explicit_base_url")}
            return {"provider": kwargs["requested"], "api_key": "plan-token", "base_url": "https://chatgpt.example"}

        def client(provider, **kwargs):
            return SimpleNamespace(chat=SimpleNamespace(completions=Completions(kwargs["model"]))), kwargs["model"]
        return resolved, sent, resolve, client

    def test_main_answers_first_and_the_backup_is_not_touched(self):
        resolved, sent, resolve, client = self.route(main_works=True)
        result = module.request(self.payload, load_config=lambda: self.config, resolve_runtime=resolve, resolve_client=client)
        self.assertEqual(result, {"text": "from plan-model", "provider": "openai-codex", "model": "plan-model"})
        self.assertEqual(sent, ["plan-model"])
        self.assertEqual(resolved, [{"requested": "openai-codex", "target_model": "plan-model"}])

    def test_backup_answers_only_when_the_main_one_failed_and_says_so(self):
        resolved, sent, resolve, client = self.route(main_works=False)
        result = module.request(self.payload, load_config=lambda: self.config, resolve_runtime=resolve, resolve_client=client)
        self.assertEqual(result, {"text": "from backup/model", "provider": "openrouter", "model": "backup/model", "backup": True})
        self.assertEqual(sent, ["plan-model", "backup/model"])
        self.assertEqual(resolved[1], {"requested": "openrouter", "target_model": "backup/model",
                                       "explicit_api_key": "backup-test-key", "explicit_base_url": "https://openrouter.ai/api/v1"})

    def test_without_a_backup_the_failure_is_todays(self):
        _, sent, resolve, client = self.route(main_works=False)
        config = {"model": self.config["model"]}
        with self.assertRaises(RuntimeError):
            module.request(self.payload, load_config=lambda: config, resolve_runtime=resolve, resolve_client=client)
        self.assertEqual(sent, ["plan-model"])

    def test_the_settings_check_asks_each_one_by_name(self):
        _, sent, resolve, client = self.route(main_works=False)
        with self.assertRaises(RuntimeError):
            module.request({**self.payload, "route": "main"}, load_config=lambda: self.config, resolve_runtime=resolve, resolve_client=client)
        self.assertEqual(sent, ["plan-model"], "the main check never falls back")
        result = module.request({**self.payload, "route": "backup"}, load_config=lambda: self.config, resolve_runtime=resolve, resolve_client=client)
        self.assertEqual((result["model"], result["backup"]), ("backup/model", True))
        self.assertEqual(sent, ["plan-model", "backup/model"])
        with self.assertRaises(ValueError):
            module.request({**self.payload, "route": "backup"}, load_config=lambda: {"model": self.config["model"]}, resolve_runtime=resolve, resolve_client=client)

    def test_a_backup_is_tried_before_it_is_saved(self):
        resolved, sent, resolve, client = self.route(main_works=True)
        trial = {"provider": "openrouter", "model": "trial/model", "api_key": "trial-test-key"}
        result = module.request({**self.payload, "route": "backup", "entry": trial}, load_config=lambda: {"model": self.config["model"]},
                                resolve_runtime=resolve, resolve_client=client)
        self.assertEqual((result["model"], result["backup"]), ("trial/model", True))
        self.assertEqual(resolved[0]["explicit_api_key"], "trial-test-key")
        self.assertEqual(sent, ["trial/model"], "the main one is not asked")
        with self.assertRaises(ValueError):
            module.request({**self.payload, "route": "backup", "entry": {"provider": "x"}}, load_config=lambda: self.config,
                           resolve_runtime=resolve, resolve_client=client)
        # Only the backup check can name an entry; a normal request ignores it.
        result = module.request({**self.payload, "entry": trial}, load_config=lambda: self.config, resolve_runtime=resolve, resolve_client=client)
        self.assertEqual(result["model"], "plan-model")

    def test_the_plan_sign_in_finds_the_first_model_that_answers_before_anything_is_saved(self):
        tried = []

        class Completions:
            def create(self, **kwargs):
                tried.append(kwargs["model"])
                if kwargs["model"] != "plan-two":
                    raise RuntimeError("HTTP 400: The model is not supported when using Codex with a ChatGPT account")
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ready", tool_calls=[]))])

        def resolve(**kwargs):
            self.assertEqual(kwargs["requested"], "openai-codex")
            return {"provider": "openai-codex", "api_key": "plan-token", "base_url": "https://chatgpt.example"}

        def client(provider, **kwargs):
            return SimpleNamespace(chat=SimpleNamespace(completions=Completions())), kwargs["model"]
        # A new installation has no main AI yet: the plan is still tried.
        result = module.request({**self.payload, "route": "plan"}, load_config=lambda: {}, resolve_runtime=resolve,
                                resolve_client=client, models_of_plan=lambda: ["plan-one", "plan-two", "plan-three"])
        self.assertEqual((result["provider"], result["model"]), ("openai-codex", "plan-two"))
        self.assertEqual(tried, ["plan-one", "plan-two"])
        with self.assertRaises(RuntimeError):
            module.request({**self.payload, "route": "plan"}, load_config=lambda: {}, resolve_runtime=resolve,
                           resolve_client=client, models_of_plan=lambda: ["plan-one"])

    def test_backup_entry_is_read_as_hermes_reads_it(self):
        self.assertIsNone(module.backup_entry({}))
        self.assertIsNone(module.backup_entry({"fallback_providers": [{"provider": "x"}, {"model": "y"}, "z"]}))
        self.assertEqual(module.backup_entry({"fallback_model": {"provider": "anthropic", "model": "old"}})["model"], "old")
        self.assertEqual(module.backup_entry({"fallback_providers": [{"provider": "a", "model": "first"}], "fallback_model": {"provider": "b", "model": "second"}})["model"], "first")
        with patch.dict(os.environ, {"FICTIONAL_BACKUP_KEY": "from-env"}):
            self.assertEqual(module.entry_key({"key_env": "FICTIONAL_BACKUP_KEY"}), "from-env")
        self.assertIsNone(module.entry_key({"provider": "openai-codex"}))

    def test_check_names_the_backup_without_asking_it(self):
        def never(**kwargs):
            self.fail("check must not resolve credentials or infer")
        result = module.request({"describe": True}, load_config=lambda: self.config, resolve_runtime=never, resolve_client=never)
        self.assertEqual(result, {"configured": True, "provider": "openai-codex", "model": "plan-model",
                                  "backup": {"provider": "openrouter", "model": "backup/model"}})


if __name__ == "__main__":
    unittest.main()
