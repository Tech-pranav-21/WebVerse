"""
CORS policy of the HTTP service: pages served from this machine may call it from a browser, other
websites may not. (The dashboard itself normally uses its same-origin /api/pose proxy.)
"""

import re
import unittest

from fastapi.testclient import TestClient

import config
import service


def acao(response) -> str | None:
    return response.headers.get("access-control-allow-origin")


class CorsPolicyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(service.app)

    def get_from(self, origin: str):
        return self.client.get("/health", headers={"Origin": origin})

    def preflight_from(self, origin: str):
        return self.client.options(
            "/detect",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

    def test_dashboard_on_this_machine_is_allowed(self):
        for origin in ("http://localhost:3000", "http://127.0.0.1:5173", "http://[::1]:3000", "https://localhost:8443"):
            with self.subTest(origin=origin):
                self.assertEqual(acao(self.get_from(origin)), origin)
                preflight = self.preflight_from(origin)
                self.assertEqual(preflight.status_code, 200)
                self.assertEqual(acao(preflight), origin)

    def test_other_websites_are_not_allowed(self):
        for origin in (
            "https://evil.example",
            "http://localhost.evil.example",
            "http://127.0.0.1.evil.example:3000",
            "http://192.168.1.50:3000",
            "null",
        ):
            with self.subTest(origin=origin):
                self.assertIsNone(acao(self.get_from(origin)))
                preflight = self.preflight_from(origin)
                self.assertEqual(preflight.status_code, 400)
                self.assertIsNone(acao(preflight))

    def test_the_service_never_answers_with_a_wildcard_origin(self):
        self.assertIsNone(acao(self.get_from("https://evil.example")))
        self.assertNotEqual(acao(self.get_from("http://localhost:3000")), "*")

    def test_requests_without_an_origin_still_work(self):
        # curl, the Vite proxy (server to server) and the test scripts send no Origin header.
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(acao(response))

    def test_a_wildcard_is_never_taken_from_the_environment(self):
        self.assertNotIn("*", config.POSE_ALLOWED_ORIGINS)

    def test_the_loopback_pattern_is_anchored(self):
        pattern = re.compile(config.LOOPBACK_ORIGIN_REGEX)
        self.assertIsNotNone(pattern.fullmatch("http://localhost"))
        self.assertIsNotNone(pattern.fullmatch("http://127.0.0.1:8000"))
        self.assertIsNone(pattern.fullmatch("http://localhost:3000.evil.example"))
        self.assertIsNone(pattern.fullmatch("http://evil.example/http://localhost"))


if __name__ == "__main__":
    unittest.main()
