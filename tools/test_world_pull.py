"""Tests for tools/world-pull.py: paging and the claim file format.

Run: python3 tools/test_world_pull.py (or tools/test-world-pull.sh).
Fixtures are invented.
"""
import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("world_pull", HERE / "world-pull.py")
world_pull = importlib.util.module_from_spec(spec)
spec.loader.exec_module(world_pull)


class FakeClient(world_pull.WorldClient):
    def __init__(self, claims):
        super().__init__("https://example.invalid", "key")
        self.claims = claims
        self.calls = []

    def fetch_page(self, updated_since, limit, offset):
        self.calls.append((limit, offset))
        return {"entities": [], "events": [], "claims": self.claims[offset:offset + limit]}


class PagingTest(unittest.TestCase):
    def test_reads_past_the_first_page(self):
        claims = [{"id": str(i)} for i in range(2500)]
        client = FakeClient(claims)
        data = client.fetch(limit=1000)
        self.assertEqual(len(data["claims"]), 2500)
        self.assertEqual(client.calls, [(1000, 0), (1000, 1000), (1000, 2000)])

    def test_an_exact_multiple_ends_on_an_empty_page(self):
        client = FakeClient([{"id": str(i)} for i in range(2000)])
        self.assertEqual(len(client.fetch(limit=1000)["claims"]), 2000)
        self.assertEqual(len(client.calls), 3)


class ClaimFileTest(unittest.TestCase):
    def test_category_and_rank_are_written_when_sent(self):
        text = world_pull.render_claim(
            {"id": "c1", "attribute": "city", "value": "Testville", "category": "location",
             "rank": "preferred", "written_by": "human", "origin": "user_manual"}, "me")
        self.assertIn("category: location", text)
        self.assertIn("rank: preferred", text)

    def test_undated_claim_has_no_date_lines(self):
        text = world_pull.render_claim({"id": "c2", "attribute": "city", "value": "Testville"}, "me")
        self.assertNotIn("valid_from", text)
        self.assertNotIn("category:", text)


if __name__ == "__main__":
    unittest.main()
