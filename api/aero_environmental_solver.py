"""Vercel-compatible JSON endpoint for Aero-Spectra scientific screening calculations."""
from __future__ import annotations
import json
import math
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid
from python_aerophysics.mie_stokes_aerosol_model import cunningham_slip, stokes_settling_mm_s, mie_size_response, mie_scattering_intensity, brownian_diffusivity_m2_s, epa_pm25_aqi
from python_aerophysics.fanger_cfk_kinetics_solver import fanger_pmv, integrate_cohb


AUDIT_FIELDS = {
    "mie_aerosol_scans": {"pm25", "pm10", "aqi", "source", "preset"},
    "hvac_balometer_logs": {"cfm", "ach", "peakHz", "roomType", "roomFt3", "roomDimensionsFt", "blowerRpm", "bladeCount", "shaftHz", "bpfHz", "restriction", "source"},
    "cadr_clearance_plans": {"volumeFt3", "cadrCfm", "eACH", "initialUg", "t90Min", "t99Min", "requiredCfm"},
    "fanger_psychrometric_audits": {"airC", "radiantC", "rh", "velocityMs", "met", "clo", "pmv", "ppd", "dewPointC", "surfaceAw"},
    "cohb_alarm_events": {"coPpm", "durationMin", "modeledCoHb", "alarmType", "source"},
}
AUDIT_STORES = set(AUDIT_FIELDS)
AUDIT_TEXT_FIELDS = {"source", "preset", "roomType", "alarmType"}
AUDIT_ARRAY_FIELDS = {"roomDimensionsFt"}


class SyncBackendUnavailable(Exception):
    pass


class SyncBackendError(Exception):
    pass


def _sync_audit(payload: dict) -> dict:
    config = payload.get("payload")
    if not isinstance(config, dict):
        raise ValueError("Audit sync payload must be a JSON object")
    store_name = config.get("storeName")
    record = config.get("record")
    if store_name not in AUDIT_STORES or not isinstance(record, dict):
        raise ValueError("Audit sync requires a supported store name and record object")
    try:
        record_id = str(uuid.UUID(str(record.get("id", ""))))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("Audit record must contain a valid UUID") from exc
    created_at = record.get("createdAt")
    if not isinstance(created_at, str) or len(created_at) > 64:
        raise ValueError("Audit record must contain a valid creation timestamp")
    if len(json.dumps(record, separators=(",", ":"), allow_nan=False)) > 64_000:
        raise ValueError("Audit record must not exceed 64 KB")
    safe_record = {}
    for field in AUDIT_FIELDS[store_name]:
        if field not in record:
            continue
        value = record[field]
        if field in AUDIT_TEXT_FIELDS:
            if not isinstance(value, str) or len(value) > 120:
                raise ValueError(f"Audit field '{field}' must be a short text value")
        elif field in AUDIT_ARRAY_FIELDS:
            if (not isinstance(value, list) or len(value) != 3
                    or any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) for item in value)):
                raise ValueError(f"Audit field '{field}' must contain three finite dimensions")
        elif isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"Audit field '{field}' must be a finite number")
        safe_record[field] = value
    if not safe_record:
        raise ValueError("Audit record has no supported summary fields")

    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not supabase_url or not service_key:
        raise SyncBackendUnavailable("Remote audit sync is not configured; this record remains in the local vault.")

    body = json.dumps({"id": record_id, "store_name": store_name,
                       "created_at": created_at, "record": safe_record}, separators=(",", ":"), allow_nan=False).encode("utf-8")
    request = Request(
        f"{supabase_url}/rest/v1/aero_audit_events?on_conflict=id",
        data=body,
        method="POST",
        headers={"apikey": service_key, "Authorization": f"Bearer {service_key}",
                 "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
    )
    try:
        with urlopen(request, timeout=8) as response:
            if response.status not in (200, 201, 204):
                raise SyncBackendError(f"Remote audit sync returned HTTP {response.status}.")
    except HTTPError as exc:
        raise SyncBackendError(f"Remote audit database returned HTTP {exc.code}.") from None
    except (URLError, TimeoutError, OSError) as exc:
        raise SyncBackendError(f"Remote audit database is unreachable: {exc.reason if isinstance(exc, URLError) else 'connection failed'}") from None
    return {"ok": True, "accepted": True, "persisted": True, "id": record_id}


def _mapping(payload: dict, key: str) -> dict:
    value = payload[key]
    if not isinstance(value, dict):
        raise ValueError(f"'{key}' must be a JSON object")
    return value


def solve(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")
    action = payload.get("action", "solve")
    if action == "audit_sync":
        return _sync_audit(payload)
    result = {}
    if "aerosol" in payload:
        data = _mapping(payload, "aerosol")
        diameter = float(data.get("diameter_um", 1.0))
        pm25 = float(data.get("pm25_ug_m3", 0.0))
        phase = mie_scattering_intensity(diameter, float(data.get("wavelength_nm", 630.0)),
                                         complex(data.get("refractive_index", 1.45)), float(data.get("theta_degrees", 90.0)))
        result["aerosol"] = {
            "size_parameter": mie_size_response(diameter)["size_parameter"],
            "mie_phase": phase,
            "slip_correction": cunningham_slip(diameter),
            "settling_velocity_mm_s": stokes_settling_mm_s(diameter),
            "brownian_diffusivity_m2_s": brownian_diffusivity_m2_s(diameter),
            "aqi": epa_pm25_aqi(pm25),
        }
    if "hvac" in payload:
        data = _mapping(payload, "hvac")
        frequency = max(0.0, float(data.get("peak_hz", 0.0)))
        vane_m = max(0.0005, float(data.get("vane_spacing_mm", 18.0)) / 1000.0)
        strouhal = max(0.05, float(data.get("strouhal", 0.21)))
        velocity_ms = frequency * vane_m / strouhal
        velocity_fpm = velocity_ms * 196.8504
        width_in = max(0.0, float(data.get("width_in", 12.0)))
        height_in = max(0.0, float(data.get("height_in", 6.0)))
        free_area = max(0.35, min(0.95, float(data.get("free_area", 0.76))))
        discharge = max(0.0, float(data.get("discharge_coefficient", 0.82)))
        area_ft2 = width_in * height_in / 144.0 * free_area
        cfm = discharge * area_ft2 * velocity_fpm
        room_ft3 = max(50.0, float(data.get("room_ft3", 1200.0)))
        result["hvac"] = {"velocity_ms": velocity_ms, "velocity_fpm": velocity_fpm, "free_area_ft2": area_ft2,
                          "cfm": cfm, "ach": cfm * 60.0 / room_ft3}
    if "cadr" in payload:
        data = _mapping(payload, "cadr")
        volume = max(100.0, float(data.get("volume_ft3", 12000.0)))
        q_clean = max(0.0, float(data.get("cadr_cfm", 300.0))) * max(0.0, min(1.0, float(data.get("filter_efficiency", 0.92))))
        infiltration = max(0.0, float(data.get("infiltration_ach", 0.35)))
        deposition = max(0.0, float(data.get("deposition_ach", 0.2)))
        cadr_ach = q_clean * 60.0 / volume
        lam = infiltration + deposition + cadr_ach
        outdoor = max(0.0, float(data.get("outdoor_ug", 12.0)))
        penetration = max(0.0, float(data.get("penetration", 0.7)))
        source = max(0.0, float(data.get("source_ug_h", 0.0)))
        steady = (penetration * infiltration * outdoor + source / volume) / lam if lam else 0.0
        initial = max(0.0, float(data.get("initial_ug", 100.0)))
        duration = max(1.0, float(data.get("duration_min", 360.0)))
        points = [{"minute": duration * i / 48.0, "ug_m3": steady + (initial - steady) * math.exp(-lam * duration * i / 48.0 / 60.0)} for i in range(49)]
        result["cadr"] = {"clean_cfm": q_clean, "cadr_ach": cadr_ach, "effective_decay_h": lam,
                          "steady_ug_m3": steady, "each": infiltration + cadr_ach,
                          "t90_min": math.log(10) * 60.0 / lam if lam else None,
                          "t99_min": math.log(100) * 60.0 / lam if lam else None, "points": points}
    if "thermal" in payload:
        result["thermal"] = fanger_pmv(**_mapping(payload, "thermal"))
    if "cohb" in payload:
        result["cohb"] = integrate_cohb(**_mapping(payload, "cohb"))
    return {"ok": True, "model": "aero-spectra-python", "result": result}


class handler(BaseHTTPRequestHandler):
    def _respond(self, status: int, body: dict) -> None:
        encoded = json.dumps(body, separators=(",", ":"), allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        origin = self.headers.get("Origin")
        allowed_origins = {item.strip() for item in os.environ.get("AERO_ALLOWED_ORIGINS", "").split(",") if item.strip()}
        if origin and origin in allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self):
        self._respond(200, {"ok": True})

    def do_GET(self):
        sync_configured = bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))
        self._respond(200, {"ok": True, "service": "Aero-Spectra environmental solver", "model": "aero-spectra-python", "methods": ["POST"], "syncConfigured": sync_configured})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 1_000_000:
                raise ValueError("Request body must not exceed 1 MB")
            payload = json.loads(self.rfile.read(length) or b"{}")
            self._respond(200, solve(payload))
        except SyncBackendUnavailable as exc:
            self._respond(503, {"ok": False, "error": str(exc)})
        except SyncBackendError as exc:
            self._respond(502, {"ok": False, "error": str(exc)})
        except (ValueError, TypeError, KeyError, OverflowError) as exc:
            self._respond(400, {"ok": False, "error": str(exc)})


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8765"))
    ThreadingHTTPServer((host, port), handler).serve_forever()
