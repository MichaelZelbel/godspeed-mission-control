import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("addon_model", Path(__file__).parents[1] / "assistant-files" / "addon-model.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HostModelTests(unittest.TestCase):
    def test_selected_connection_is_used_without_tools_agent_or_fallback(self):
        calls = []
        class Completions:
            def create(self, **kwargs):
                calls.append(kwargs)
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="answer", tool_calls=[]))])
        def resolve(**kwargs):
            self.assertEqual(kwargs, {"requested": "owner-provider", "target_model": "owner-model"})
            return {"api_key": "host-key", "base_url": "https://owner.example", "api_mode": "responses"}
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


if __name__ == "__main__":
    unittest.main()
