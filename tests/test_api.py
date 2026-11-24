import json
import math
import os
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import MagicMock, patch

from api.aero_environmental_solver import handler, solve


AUDIT_SYNC_PAYLOAD = {
    "action": "audit_sync",
    "payload": {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "storeName": "hvac_balometer_logs",
        "createdAt": "2026-11-24T06:00:00.000Z",
        "record": {"id": "123e4567-e89b-12d3-a456-426614174000", "createdAt": "2026-11-24T06:00:00.000Z", "cfm": 145, "source": "simulator:supply", "audio": "discard-this-raw-media-field"},
    },
}

SAMPLE_PAYLOAD = {
    "aerosol": {"diameter_um": 1.2, "pm25_ug_m3": 18, "wavelength_nm": 630},
    "hvac": {"peak_hz": 27.6, "vane_spacing_mm": 18, "width_in": 12, "height_in": 6, "room_ft3": 1200},
    "cadr": {"volume_ft3": 12000, "cadr_cfm": 300, "filter_efficiency": 0.92, "initial_ug": 100},
    "thermal": {"air_c": 24, "radiant_c": 24, "velocity_ms": 0.1, "rh": 50, "met": 1.1, "clo": 0.7, "surface_c": 17},
    "cohb": {"co_ppm": 35, "duration_min": 60, "start_percent": 0.8},
}


class AeroApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}/api/aero_environmental_solver"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, method, payload=None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(self.base_url, data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def test_five_domain_solver_returns_finite_screening_results(self):
        response = solve(SAMPLE_PAYLOAD)
        self.assertTrue(response["ok"])
        result = response["result"]
        self.assertEqual(set(result), {"aerosol", "hvac", "cadr", "thermal", "cohb"})
        self.assertGreater(result["aerosol"]["mie_phase"]["terms"], 0)
        self.assertGreater(result["aerosol"]["brownian_diffusivity_m2_s"], 0)
        self.assertTrue(math.isfinite(result["hvac"]["ach"]))
        self.assertTrue(math.isfinite(result["cadr"]["t90_min"]))
        self.assertTrue(math.isfinite(result["thermal"]["pmv"]))
        self.assertTrue(math.isfinite(result["thermal"]["wet_bulb_c"]))
        self.assertLess(result["thermal"]["wet_bulb_c"], 24)
        self.assertGreaterEqual(result["thermal"]["surface_water_activity"], 0)
        self.assertGreater(result["cohb"][-1]["cohb_percent"], 0.8)

    def test_vercel_handler_health_and_post_routes(self):
        with patch.dict(os.environ, {}, clear=True):
            status, health = self.request("GET")
            self.assertEqual(status, 200)
            self.assertTrue(health["ok"])
            self.assertEqual(health["model"], "aero-spectra-python")
            self.assertFalse(health["syncConfigured"])

            status, response = self.request("POST", SAMPLE_PAYLOAD)
            self.assertEqual(status, 200)
            self.assertTrue(response["ok"])
            self.assertEqual(len(response["result"]), 5)

    def test_audit_sync_upserts_only_to_configured_private_supabase_table(self):
        response_context = MagicMock()
        response_context.__enter__.return_value.status = 201
        with patch.dict(os.environ, {"SUPABASE_URL": "https://project.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "server-only-test-key"}):
            with patch("api.aero_environmental_solver.urlopen", return_value=response_context) as remote_request:
                result = solve(AUDIT_SYNC_PAYLOAD)
        request = remote_request.call_args.args[0]
        self.assertTrue(result["accepted"])
        self.assertTrue(result["persisted"])
        self.assertEqual(request.full_url, "https://project.supabase.co/rest/v1/aero_audit_events?on_conflict=id")
        self.assertEqual(request.get_header("Apikey"), "server-only-test-key")
        body = json.loads(request.data)
        self.assertEqual(body["store_name"], "hvac_balometer_logs")
        self.assertEqual(body["record"]["cfm"], 145)
        self.assertNotIn("audio", body["record"])
        self.assertNotIn("id", body["record"])

    def test_audit_sync_stays_queued_without_database_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            status, response = self.request("POST", AUDIT_SYNC_PAYLOAD)
        self.assertEqual(status, 503)
        self.assertFalse(response["ok"])
        self.assertIn("local vault", response["error"])

    def test_malformed_json_is_a_client_error(self):
        request = Request(self.base_url, data=b"not-json", method="POST", headers={"Content-Type": "application/json"})
        with self.assertRaises(HTTPError) as raised:
            urlopen(request, timeout=3)
        self.assertEqual(raised.exception.code, 400)
        self.assertFalse(json.loads(raised.exception.read())["ok"])

    def test_non_object_payload_is_a_client_error(self):
        status, response = self.request("POST", [])
        self.assertEqual(status, 400)
        self.assertFalse(response["ok"])


if __name__ == "__main__":
    unittest.main()
