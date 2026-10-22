import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
import os
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("addon_model", Path(__file__).parents[1] / "assistant-files" / "addon-model.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HostModelTests(unittest.TestCase):
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
