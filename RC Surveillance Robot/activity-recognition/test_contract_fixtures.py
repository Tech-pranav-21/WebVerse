"""
Guards the contract between this service and the dashboard.

frontend/tests/fixtures/*.json are real responses of this service (see export_contract_fixtures.py). The
frontend tests parse them with the same code that parses live responses. If the service's response format
changes without the fixtures (and therefore the TypeScript types) being updated, this test fails.
"""

import unittest

import export_contract_fixtures
from activity_types import ACTIVITY_FIELDS, ACTIVITY_LABELS


class ContractFixtureTests(unittest.TestCase):
    def test_stored_fixtures_match_what_the_service_produces_today(self):
        self.assertEqual(
            export_contract_fixtures.main(["--check"]), 0,
            "frontend/tests/fixtures are out of date: run python activity-recognition/export_contract_fixtures.py",
        )

    def test_the_typescript_contract_constants_match_the_backend(self):
        """The frontend keeps copies of the label and field lists; read them from the source and compare."""
        import os
        import re

        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "src", "types", "pose.ts")
        with open(path, encoding="utf-8") as fh:
            ts = fh.read()

        def const_list(name: str):
            m = re.search(rf"export const {name} = \[(.*?)\] as const;", ts, re.S)
            self.assertIsNotNone(m, f"{name} not found in pose.ts")
            return re.findall(r"'([^']+)'", m.group(1))

        self.assertEqual(const_list("ACTIVITY_LABELS"), list(ACTIVITY_LABELS))
        self.assertEqual(const_list("ACTIVITY_FIELDS"), list(ACTIVITY_FIELDS))


if __name__ == "__main__":
    unittest.main()
