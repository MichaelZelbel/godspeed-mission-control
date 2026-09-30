"""Tests for tools/world-pull.py: paging and the claim file format.

Run: python3 tools/test_world_pull.py (or tools/test-world-pull.sh).
Fixtures are invented.
"""
import importlib.util
import pathlib
import tempfile
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
        # A short page is not taken as the end: the server may hand back fewer rows
        # than were asked for, so only an empty page ends the read.
        self.assertEqual(client.calls, [(1000, 0), (1000, 1000), (1000, 2000), (1000, 2500)])

    def test_a_server_that_caps_pages_below_the_limit_is_read_to_the_end(self):
        class Capped(FakeClient):
            def fetch_page(self, updated_since, limit, offset):
                return super().fetch_page(updated_since, min(limit, 300), offset)
        client = Capped([{"id": str(i)} for i in range(1000)])
        self.assertEqual(len(client.fetch(limit=1000)["claims"]), 1000)

    def test_an_answer_missing_a_kind_is_refused_not_read_as_empty(self):
        class Broken(FakeClient):
            def fetch_page(self, updated_since, limit, offset):
                return {"entities": [], "events": []}
        with self.assertRaises(world_pull.IncompleteAnswer):
            Broken([]).fetch(limit=1000)

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


class OneRecordOneFileTest(unittest.TestCase):
    """Two machines can each name a new record's file after what they already hold, and
    git then merges both copies into one folder. The pull keeps one and drops the other."""

    def make_repo(self, files):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        for folder in ("entities", "events", "claims"):
            (root / "world" / folder).mkdir(parents=True)
        for rel, text in files.items():
            (root / rel).write_text(text, encoding="utf-8")
        return root

    def tearDown(self):
        self.tmp.cleanup()

    def test_an_entity_mirrored_beside_the_owners_file_collapses_into_it(self):
        root = self.make_repo({
            "world/entities/dana-reyes.md":
                "---\nslug: dana-reyes\nname: Dana Reyes\ntype: real_person\nmenerio_id: e1\n---\n",
            "world/entities/dana-reyes-2.md":
                "---\nslug: dana-reyes\nname: Dana Reyes\ntype: person\norigin: menerio\nmenerio_id: e1\n---\n",
        })
        world = {"entities": [{"id": "e1", "slug": "dana-reyes", "name": "Dana Reyes"}],
                 "events": [], "claims": []}
        plan = world_pull.plan_pull(world, root, self_slug="me")
        self.assertEqual(plan["duplicates"], [("world/entities/dana-reyes-2.md",
                                               "world/entities/dana-reyes.md")])
        self.assertEqual(plan["remove"], [])
        world_pull.run_pull(world, root, "test", True, self_slug="me")
        self.assertFalse((root / "world/entities/dana-reyes-2.md").exists())
        self.assertTrue((root / "world/entities/dana-reyes.md").exists())

    def test_two_different_records_with_one_name_stay_two_files(self):
        root = self.make_repo({})
        world = {"entities": [{"id": "e1", "slug": "sam-kim", "name": "Sam Kim"},
                              {"id": "e2", "slug": "sam-kim", "name": "Sam Kim"}],
                 "events": [], "claims": []}
        world_pull.run_pull(world, root, "test", True, self_slug="me")
        self.assertEqual(sorted(p.name for p in (root / "world/entities").iterdir()),
                         ["sam-kim-2.md", "sam-kim.md"])


if __name__ == "__main__":
    unittest.main()
