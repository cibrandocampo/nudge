"""Tests for the regulatory app: clients, models, services and tasks.

No test reaches the network: CIMA answers come from the recorded payloads in
``test_data/aemps/`` and the HTTP layer is patched at ``aemps._get_json`` (or,
for the transport itself, at the module's ``requests`` session), or the whole
``aemps.fetch`` is patched where only the stored result matters.
"""

import copy
import dataclasses
import io
import json
import tempfile
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

import requests
from celery.schedules import crontab
from django.conf import settings as dj_settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from apps.regulatory import services, tasks
from apps.regulatory.clients import aemps
from apps.regulatory.clients.types import (
    NOT_FOUND,
    SEVERITY_DANGER,
    SEVERITY_WARNING,
    FetchDisabled,
    NotFound,
    SafetyNoticeData,
    UpstreamPayloadError,
    UpstreamUnavailable,
)
from apps.regulatory.models import (
    EventDelivery,
    Medicine,
    MedicineLeaflet,
    Presentation,
    RegulatoryEvent,
    SafetyNotice,
    SupplyProblem,
)
from apps.regulatory.sanitize import sanitize_leaflet_html
from apps.routines.models import Stock

User = get_user_model()

FIXTURES = Path(__file__).parent / "test_data" / "aemps"

FIASP_CN = "728514"
HIDROFEROL_CN = "934554"
SUSPENDED_CN = "656538"
REVOKED_CN = "708201"


# A safety net under every test of this module: a request that escapes the
# patches below fails loudly instead of quietly reaching the agency.
_network_guard = mock.patch.object(aemps._session, "get", side_effect=AssertionError("A test reached the network"))


def setUpModule():
    _network_guard.start()


def tearDownModule():
    _network_guard.stop()


def load(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def fiasp():
    return load("medicamento_728514.json"), load("psuministro_728514.json")


FIASP_NREGISTRO = "1161160012"
HIDROFEROL_NREGISTRO = "55315"


def fiasp_leaflet():
    return aemps.parse_recorded_leaflet(FIASP_NREGISTRO, FIXTURES)


# ── Codes ─────────────────────────────────────────────────────────────────────


class CodeFromGtinTests(SimpleTestCase):
    def test_ntin_yields_the_embedded_cn(self):
        self.assertEqual(aemps.code_from_gtin("08470007285144"), FIASP_CN)

    def test_another_real_ntin(self):
        # Ibuprofeno Cinfa 600 mg, 40 comprimidos: CN 661426.6.
        self.assertEqual(aemps.code_from_gtin("08470006614266"), "661426")

    def test_manufacturer_gtin_yields_none(self):
        # GTIN-coded packs carry the CN in AI 712, not inside the GTIN.
        self.assertIsNone(aemps.code_from_gtin("05705244020856"))
        self.assertIsNone(aemps.code_from_gtin("09506000134376"))

    def test_wrong_length_or_non_digits_yield_none(self):
        for value in ("", "0847000728514", "084700072851444", "0847000728514X", None, 8470007285144):
            with self.subTest(value=value):
                self.assertIsNone(aemps.code_from_gtin(value))


class NormalizeCodeTests(SimpleTestCase):
    def test_six_digits(self):
        self.assertEqual(aemps.normalize_code("728514"), FIASP_CN)

    def test_seven_digits_with_valid_check_digit(self):
        self.assertEqual(aemps.normalize_code("7285144"), FIASP_CN)

    def test_printed_form_with_dot(self):
        self.assertEqual(aemps.normalize_code("728514.4"), FIASP_CN)

    def test_real_cns_with_their_printed_check_digit(self):
        # CNs as published by BotPlus (Consejo General de Colegios
        # Farmacéuticos), all present in CIMA. Six real codes agreeing with the
        # GS1 rule is what settles the algorithm (research.md §1).
        for printed in ("6614266", "6057216", "6310519", "6501405", "7548461", "7285144"):
            with self.subTest(printed=printed):
                self.assertEqual(aemps.normalize_code(printed), printed[:6])

    def test_aemps_faq_example_is_not_a_real_cn(self):
        # The FAQ pairs NTIN 08470008722513 with CN 872251.3, but that NTIN is
        # not a valid GS1 code: the example is illustrative, not real data.
        self.assertIsNone(aemps.normalize_code("872251.3"))
        self.assertEqual(aemps._gs1_check_digit("0847000872251"), 8)

    def test_whitespace_is_ignored(self):
        self.assertEqual(aemps.normalize_code("  728 514.4 "), FIASP_CN)

    def test_wrong_check_digit_is_rejected(self):
        self.assertIsNone(aemps.normalize_code("728514.5"))
        self.assertIsNone(aemps.normalize_code("7285140"))

    def test_not_a_cn(self):
        for value in ("", "72851", "72851444", "abcdef", "728514.", "728514.44", "7285-14", None, 728514):
            with self.subTest(value=value):
                self.assertIsNone(aemps.normalize_code(value))

    def test_check_digit_matches_gs1_check_of_the_ntin(self):
        # The CN check digit is the NTIN's: every NTIN built from a CN and its
        # check digit must therefore be a valid GS1 code.
        for cn in ("728514", "661426", "934554", "656538", "708201", "000000", "999999"):
            with self.subTest(cn=cn):
                ntin13 = aemps.NTIN_PREFIX + cn
                check = aemps._cn_check_digit(cn)
                self.assertEqual(aemps._gs1_check_digit(ntin13), check)
                self.assertEqual(aemps.normalize_code(f"{cn}.{check}"), cn)


# ── Parsing ───────────────────────────────────────────────────────────────────


class ParsePresentationTests(SimpleTestCase):
    def test_fiasp_active_supply_problem(self):
        medicamento, psuministro = fiasp()
        data = aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)

        self.assertEqual(data.code, FIASP_CN)
        self.assertEqual(
            data.name, "FIASP 100 UNIDADES/ML PUMPCART SOLUCION INYECTABLE EN CARTUCHO, 5 cartuchos de 1,6 ml"
        )
        self.assertIs(data.marketed, True)
        supply = data.supply
        self.assertEqual(supply.native_type, "1")
        self.assertEqual(supply.severity, SEVERITY_DANGER)
        self.assertTrue(supply.note.startswith("Consultar Nota Informativa: https://www.aemps.gob.es/"))
        # Madrid dates: read as UTC these would be 2025-04-09 and 2027-02-27.
        self.assertEqual(supply.started_on, date(2025, 4, 10))
        self.assertEqual(supply.expected_end_on, date(2027, 2, 28))

    def test_fiasp_medicine(self):
        medicamento, psuministro = fiasp()
        medicine = aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro).medicine

        self.assertEqual(medicine.code, "1161160012")
        self.assertEqual(medicine.name, "FIASP 100 UNIDADES/ML PUMPCART SOLUCION INYECTABLE EN CARTUCHO")
        self.assertEqual(medicine.authorized_on, date(2020, 6, 25))
        self.assertIsNone(medicine.suspended_on)
        self.assertIsNone(medicine.revoked_on)
        self.assertEqual(medicine.agency_url, "https://cima.aemps.es/cima/publico/detalle.html?nregistro=1161160012")
        self.assertEqual(medicine.leaflet_url, "https://cima.aemps.es/cima/dochtml/p/1161160012/P_1161160012.html")
        self.assertEqual(medicine.safety_notices, ())

    def test_raw_payloads_travel_along(self):
        medicamento, psuministro = fiasp()
        data = aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)
        self.assertIs(data.medicine.raw, medicamento)
        self.assertIs(data.raw, medicamento["presentaciones"][0])

    def test_hidroferol_safety_notices_and_no_problem(self):
        data = aemps.parse_presentation(HIDROFEROL_CN, load("medicamento_934554.json"), notas=load("notas_55315.json"))

        self.assertIsNone(data.supply)
        self.assertEqual(len(data.medicine.safety_notices), 2)
        notice = data.medicine.safety_notices[0]
        self.assertEqual(notice.reference, "MUH (FV), 03/2026")
        self.assertEqual(notice.native_kind, "1")
        self.assertEqual(
            notice.title,
            "La AEMPS recuerda cómo evitar errores de medicación por sobredosificación con vitamina D",
        )
        self.assertTrue(notice.url.startswith("https://www.aemps.gob.es/"))
        self.assertEqual(notice.published_on, date(2026, 9, 16))

    def test_suspended_medicine(self):
        data = aemps.parse_presentation(SUSPENDED_CN, load("medicamento_656538.json"), notas=load("notas_62258.json"))
        self.assertIsNotNone(data.medicine.suspended_on)
        self.assertIsNone(data.medicine.revoked_on)
        self.assertIs(data.marketed, False)

    def test_revoked_medicine(self):
        data = aemps.parse_presentation(REVOKED_CN, load("medicamento_708201.json"), notas=load("notas_80298.json"))
        self.assertIsNotNone(data.medicine.revoked_on)
        self.assertIsNone(data.medicine.suspended_on)

    def test_medicine_without_leaflet(self):
        medicamento, psuministro = fiasp()
        medicamento["docs"] = [doc for doc in medicamento["docs"] if doc["tipo"] != 2]
        data = aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)
        self.assertEqual(data.medicine.leaflet_url, "")

    def test_leaflet_falls_back_to_pdf_without_html(self):
        medicamento, psuministro = fiasp()
        leaflet = next(doc for doc in medicamento["docs"] if doc["tipo"] == 2)
        del leaflet["urlHtml"]
        data = aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)
        self.assertEqual(data.medicine.leaflet_url, leaflet["url"])

    def test_cn_absent_from_presentations_is_not_found(self):
        medicamento, psuministro = fiasp()
        self.assertIs(aemps.parse_presentation("111111", medicamento, psuministro=psuministro), NOT_FOUND)

    def test_unknown_supply_type_is_danger(self):
        medicamento, psuministro = fiasp()
        psuministro["resultados"][0]["tipoProblemaSuministro"] = 99
        supply = aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro).supply
        self.assertEqual(supply.native_type, "99")
        self.assertEqual(supply.severity, SEVERITY_DANGER)

    def test_every_known_type_has_its_severity(self):
        medicamento, psuministro = fiasp()
        warning_types = {"2", "5", "6", "9", "10", "11", "12"}
        for native_type in map(str, range(1, 13)):
            with self.subTest(native_type=native_type):
                payload = copy.deepcopy(psuministro)
                payload["resultados"][0]["tipoProblemaSuministro"] = int(native_type)
                supply = aemps.parse_presentation(FIASP_CN, medicamento, psuministro=payload).supply
                expected = SEVERITY_WARNING if native_type in warning_types else SEVERITY_DANGER
                self.assertEqual(supply.severity, expected)

    def test_psum_without_active_detail_is_no_problem(self):
        medicamento, psuministro = fiasp()
        medicamento["presentaciones"][0]["detalleProblemaSuministro"]["activo"] = False
        self.assertIsNone(aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro).supply)

    def test_active_detail_without_psum_is_no_problem(self):
        medicamento, _ = fiasp()
        medicamento["presentaciones"][0]["psum"] = False
        self.assertIsNone(aemps.parse_presentation(FIASP_CN, medicamento).supply)

    def test_active_problem_without_psuministro_payload_is_rejected(self):
        medicamento, _ = fiasp()
        with self.assertRaises(UpstreamPayloadError):
            aemps.parse_presentation(FIASP_CN, medicamento)

    def test_active_problem_with_typeless_psuministro_is_rejected(self):
        medicamento, psuministro = fiasp()
        del psuministro["resultados"][0]["tipoProblemaSuministro"]
        with self.assertRaises(UpstreamPayloadError):
            aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)

    def test_missing_nregistro_is_rejected(self):
        medicamento, psuministro = fiasp()
        del medicamento["nregistro"]
        with self.assertRaises(UpstreamPayloadError):
            aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)

    def test_blank_name_is_rejected(self):
        medicamento, psuministro = fiasp()
        medicamento["nombre"] = "  "
        with self.assertRaises(UpstreamPayloadError):
            aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)

    def test_missing_presentations_is_rejected(self):
        medicamento, psuministro = fiasp()
        del medicamento["presentaciones"]
        with self.assertRaises(UpstreamPayloadError):
            aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)

    def test_non_dict_payload_is_rejected(self):
        with self.assertRaises(UpstreamPayloadError):
            aemps.parse_presentation(FIASP_CN, ["not", "a", "medicine"])

    def test_non_list_notices_are_rejected(self):
        medicamento, psuministro = fiasp()
        with self.assertRaises(UpstreamPayloadError):
            aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro, notas={"x": 1})

    def test_notice_without_reference_is_rejected(self):
        notas = load("notas_55315.json")
        del notas[0]["referencia"]
        with self.assertRaises(UpstreamPayloadError):
            aemps.parse_presentation(HIDROFEROL_CN, load("medicamento_934554.json"), notas=notas)

    def test_non_dict_notice_is_rejected(self):
        with self.assertRaises(UpstreamPayloadError):
            aemps.parse_presentation(HIDROFEROL_CN, load("medicamento_934554.json"), notas=["oops"])

    def test_malformed_timestamp_is_rejected(self):
        medicamento, psuministro = fiasp()
        medicamento["estado"]["aut"] = "2020-06-25"
        with self.assertRaises(UpstreamPayloadError):
            aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)

    def test_boolean_timestamp_is_rejected(self):
        medicamento, psuministro = fiasp()
        medicamento["estado"]["aut"] = True
        with self.assertRaises(UpstreamPayloadError):
            aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)

    def test_malformed_state_is_rejected(self):
        medicamento, psuministro = fiasp()
        medicamento["estado"] = "autorizado"
        with self.assertRaises(UpstreamPayloadError):
            aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)

    def test_missing_state_means_no_dates(self):
        medicamento, psuministro = fiasp()
        del medicamento["estado"]
        medicine = aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro).medicine
        self.assertIsNone(medicine.authorized_on)

    def test_non_boolean_marketed_is_unknown(self):
        medicamento, psuministro = fiasp()
        medicamento["presentaciones"][0]["comerc"] = "yes"
        self.assertIsNone(aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro).marketed)

    def test_numeric_nregistro_is_text(self):
        medicamento = load("medicamento_934554.json")
        medicamento["nregistro"] = 55315
        data = aemps.parse_presentation(HIDROFEROL_CN, medicamento, notas=[])
        self.assertEqual(data.medicine.code, "55315")


class ParseRecordedTests(SimpleTestCase):
    def test_matches_parsing_the_same_payloads(self):
        medicamento, psuministro = fiasp()
        expected = aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)
        self.assertEqual(aemps.parse_recorded(FIASP_CN, FIXTURES), expected)

    def test_reads_the_notices_by_registration_number(self):
        data = aemps.parse_recorded(HIDROFEROL_CN, FIXTURES)
        self.assertEqual(len(data.medicine.safety_notices), 2)
        self.assertIsNone(data.supply)

    def test_a_missing_recording_is_an_error(self):
        with self.assertRaises(FileNotFoundError):
            aemps.parse_recorded("111111", FIXTURES)

    def test_an_active_problem_without_its_recorded_type_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / f"medicamento_{FIASP_CN}.json").write_text(
                (FIXTURES / "medicamento_728514.json").read_text(encoding="utf-8"), encoding="utf-8"
            )
            with self.assertRaises(UpstreamPayloadError):
                aemps.parse_recorded(FIASP_CN, directory)


class NotFoundTests(SimpleTestCase):
    def test_is_a_singleton(self):
        self.assertIs(NotFound(), NOT_FOUND)

    def test_repr_names_the_sentinel(self):
        self.assertEqual(repr(NOT_FOUND), "NOT_FOUND")


# ── Network ───────────────────────────────────────────────────────────────────


@override_settings(REGULATORY_FETCH_ENABLED=True)
class FetchTests(SimpleTestCase):
    def test_disabled_switch_never_calls_the_network(self):
        with override_settings(REGULATORY_FETCH_ENABLED=False), mock.patch.object(aemps, "_get_json") as get:
            with self.assertRaises(FetchDisabled):
                aemps.fetch(FIASP_CN)
        get.assert_not_called()

    def test_204_is_not_found(self):
        with mock.patch.object(aemps, "_get_json", return_value=None) as get:
            self.assertIs(aemps.fetch("111111"), NOT_FOUND)
        get.assert_called_once_with("medicamento", {"cn": "111111"})

    def test_cn_absent_from_answer_is_not_found(self):
        medicamento, _ = fiasp()
        with mock.patch.object(aemps, "_get_json", return_value=medicamento) as get:
            self.assertIsInstance(aemps.fetch("111111"), NotFound)
        get.assert_called_once()

    def test_active_problem_asks_for_its_type_but_no_notices(self):
        medicamento, psuministro = fiasp()
        with mock.patch.object(aemps, "_get_json", side_effect=[medicamento, psuministro]) as get:
            data = aemps.fetch(FIASP_CN)
        self.assertEqual(
            get.call_args_list,
            [mock.call("medicamento", {"cn": FIASP_CN}), mock.call(f"psuministro/{FIASP_CN}")],
        )
        self.assertEqual(data.supply.native_type, "1")

    def test_notices_without_problem(self):
        medicamento, notas = load("medicamento_934554.json"), load("notas_55315.json")
        with mock.patch.object(aemps, "_get_json", side_effect=[medicamento, notas]) as get:
            data = aemps.fetch(HIDROFEROL_CN)
        self.assertEqual(
            get.call_args_list,
            [mock.call("medicamento", {"cn": HIDROFEROL_CN}), mock.call("notas/55315")],
        )
        self.assertEqual(len(data.medicine.safety_notices), 2)

    def test_notices_answering_204_are_none(self):
        with mock.patch.object(aemps, "_get_json", side_effect=[load("medicamento_934554.json"), None]):
            data = aemps.fetch(HIDROFEROL_CN)
        self.assertEqual(data.medicine.safety_notices, ())

    def test_non_dict_answer_is_rejected(self):
        with mock.patch.object(aemps, "_get_json", return_value=[1, 2]):
            with self.assertRaises(UpstreamPayloadError):
                aemps.fetch(FIASP_CN)

    def test_upstream_errors_propagate(self):
        with mock.patch.object(aemps, "_get_json", side_effect=UpstreamUnavailable("down")):
            with self.assertRaises(UpstreamUnavailable):
                aemps.fetch(FIASP_CN)


def response(status, payload=None, invalid_json=False):
    resp = mock.Mock(status_code=status)
    if invalid_json:
        resp.json.side_effect = ValueError("not json")
    else:
        resp.json.return_value = payload
    return resp


class GetJsonTests(SimpleTestCase):
    def setUp(self):
        # Keep the throttle out of these tests; it has its own below.
        patcher = mock.patch.object(aemps, "_throttle")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_success_uses_base_url_params_and_timeout(self):
        with mock.patch.object(aemps._session, "get", return_value=response(200, {"ok": 1})) as get:
            self.assertEqual(aemps._get_json("medicamento", {"cn": FIASP_CN}), {"ok": 1})
        get.assert_called_once_with(
            "https://cima.aemps.es/cima/rest/medicamento",
            params={"cn": FIASP_CN},
            headers={"Accept": "application/json"},
            timeout=aemps.TIMEOUT,
        )

    def test_session_identifies_the_app_without_personal_data(self):
        user_agent = aemps._session.headers["User-Agent"]
        self.assertEqual(user_agent, "Nudge (+https://github.com/cibrandocampo/nudge)")
        self.assertNotIn("@", user_agent)
        self.assertEqual(aemps._session.headers["Accept"], "application/json")

    def test_204_is_none(self):
        with mock.patch.object(aemps._session, "get", return_value=response(204)):
            self.assertIsNone(aemps._get_json("medicamento", {"cn": "111111"}))

    def test_timeout_is_unavailable(self):
        with mock.patch.object(aemps._session, "get", side_effect=requests.Timeout("slow")):
            with self.assertRaises(UpstreamUnavailable):
                aemps._get_json("medicamento")

    def test_connection_error_is_unavailable(self):
        with mock.patch.object(aemps._session, "get", side_effect=requests.ConnectionError("dns")):
            with self.assertRaises(UpstreamUnavailable):
                aemps._get_json("medicamento")

    def test_5xx_and_429_are_unavailable(self):
        for status in (500, 502, 503, 429):
            with self.subTest(status=status), mock.patch.object(aemps._session, "get", return_value=response(status)):
                with self.assertRaises(UpstreamUnavailable):
                    aemps._get_json("medicamento")

    def test_other_4xx_is_payload_error(self):
        with mock.patch.object(aemps._session, "get", return_value=response(400)):
            with self.assertRaises(UpstreamPayloadError):
                aemps._get_json("medicamento")

    def test_invalid_json_is_payload_error(self):
        with mock.patch.object(aemps._session, "get", return_value=response(200, invalid_json=True)):
            with self.assertRaises(UpstreamPayloadError):
                aemps._get_json("medicamento")


class ThrottleTests(SimpleTestCase):
    def setUp(self):
        patcher = mock.patch.object(aemps, "_last_call", 0.0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_waits_for_the_minimum_interval(self):
        with (
            # Two readings per call: one to compute the wait, one to stamp it.
            mock.patch.object(aemps.time, "monotonic", side_effect=[100.0, 100.0, 100.05, 100.2]),
            mock.patch.object(aemps.time, "sleep") as sleep,
        ):
            aemps._throttle()  # first call: nothing to wait for
            aemps._throttle()  # 0.05 s later: waits the remaining 0.15 s
        sleep.assert_called_once()
        self.assertAlmostEqual(sleep.call_args.args[0], 0.15)

    def test_no_wait_when_enough_time_passed(self):
        with (
            mock.patch.object(aemps.time, "monotonic", side_effect=[100.0, 100.0, 105.0, 105.0]),
            mock.patch.object(aemps.time, "sleep") as sleep,
        ):
            aemps._throttle()
            aemps._throttle()
        sleep.assert_not_called()


# ── Models, services and tasks ────────────────────────────────────────────────


def make_user(username="owner"):
    return User.objects.create_user(username=username, password="pass", email=f"{username}@example.com")


def make_stock(user, name="Insulin", national_code="", source="aemps"):
    return Stock.objects.create(
        user=user,
        name=name,
        national_code=national_code,
        national_code_source=source if national_code else "",
    )


def make_presentation(code=FIASP_CN, **fields):
    return Presentation.objects.create(source="aemps", code=code, **fields)


def fiasp_data():
    medicamento, psuministro = fiasp()
    return aemps.parse_presentation(FIASP_CN, medicamento, psuministro=psuministro)


def hidroferol_data():
    return aemps.parse_presentation(HIDROFEROL_CN, load("medicamento_934554.json"), notas=load("notas_55315.json"))


def without_supply(data):
    return dataclasses.replace(data, supply=None)


class MedicineStatusTests(SimpleTestCase):
    def test_authorised(self):
        self.assertEqual(Medicine(authorized_on=date(2020, 1, 1)).status, Medicine.Status.AUTHORISED)

    def test_suspended(self):
        self.assertEqual(Medicine(suspended_on=date(2025, 4, 25)).status, Medicine.Status.SUSPENDED)

    def test_revoked(self):
        self.assertEqual(Medicine(revoked_on=date(2025, 10, 24)).status, Medicine.Status.REVOKED)

    def test_revocation_outranks_suspension(self):
        medicine = Medicine(suspended_on=date(2025, 1, 1), revoked_on=date(2025, 2, 1))
        self.assertEqual(medicine.status, Medicine.Status.REVOKED)

    def test_reinstated_is_authorised_again(self):
        # A lifted suspension disappears from the agency's state (T109 §4).
        self.assertEqual(Medicine(authorized_on=date(2020, 1, 1), suspended_on=None).status, "authorised")


class ModelConstraintTests(TestCase):
    def test_one_active_supply_problem_per_presentation(self):
        presentation = make_presentation()
        SupplyProblem.objects.create(presentation=presentation, native_type="1", severity="danger")
        with self.assertRaises(IntegrityError), transaction.atomic():
            SupplyProblem.objects.create(presentation=presentation, native_type="4", severity="danger")

    def test_resolved_problems_do_not_count(self):
        presentation = make_presentation()
        SupplyProblem.objects.create(
            presentation=presentation, native_type="1", severity="danger", resolved_at=timezone.now()
        )
        SupplyProblem.objects.create(presentation=presentation, native_type="4", severity="danger")
        self.assertEqual(presentation.supply_problems.count(), 2)

    def test_presentation_code_is_unique_per_source(self):
        make_presentation()
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_presentation()

    def test_same_code_in_another_source_is_allowed(self):
        make_presentation()
        Presentation.objects.create(source="other", code=FIASP_CN)
        self.assertEqual(Presentation.objects.count(), 2)

    def test_str_representations(self):
        presentation = make_presentation(name="FIASP")
        problem = SupplyProblem.objects.create(presentation=presentation, native_type="1", severity="danger")
        medicine = Medicine.objects.create(source="aemps", code="1161160012", name="FIASP", fetched_at=timezone.now())
        notice = SafetyNotice.objects.create(source="aemps", reference="MUH (FV), 03/2026")
        self.assertEqual(str(presentation), "FIASP (aemps:728514)")
        self.assertEqual(str(make_presentation(code="934554")), "934554 (aemps:934554)")
        self.assertEqual(str(problem), "FIASP (aemps:728514) — 1 (active)")
        problem.resolved_at = timezone.now()
        self.assertEqual(str(problem), "FIASP (aemps:728514) — 1 (resolved)")
        self.assertEqual(str(medicine), "FIASP (aemps:1161160012)")
        self.assertEqual(str(notice), "MUH (FV), 03/2026 (aemps)")


class DeriveNationalCodeTests(SimpleTestCase):
    def test_ntin_yields_its_cn(self):
        self.assertEqual(services.derive_national_code("08470007285144", ""), (FIASP_CN, "aemps"))

    def test_ntin_wins_over_a_different_typed_code(self):
        self.assertEqual(services.derive_national_code("08470007285144", "661426"), (FIASP_CN, "aemps"))

    def test_manufacturer_gtin_uses_the_typed_code(self):
        self.assertEqual(services.derive_national_code("05705244020856", "6614266"), ("661426", "aemps"))

    def test_typed_code_without_gtin_is_normalised(self):
        self.assertEqual(services.derive_national_code("", "728514.4"), (FIASP_CN, "aemps"))

    def test_invalid_typed_code_yields_none(self):
        self.assertIsNone(services.derive_national_code("", "728514.5"))

    def test_nothing_yields_none(self):
        self.assertIsNone(services.derive_national_code(None, None))


class LinkStockTests(TestCase):
    def setUp(self):
        self.user = make_user()

    def link(self, stock, **overrides):
        options = {"offer_name": True, "touch_updated_at": False, "enqueue": False, **overrides}
        return services.link_stock(stock, **options)

    def test_links_and_creates_the_presentation(self):
        stock = make_stock(self.user, national_code=FIASP_CN)
        presentation = self.link(stock)
        stock.refresh_from_db()
        self.assertEqual(stock.presentation, presentation)
        self.assertEqual((presentation.source, presentation.code), ("aemps", FIASP_CN))
        self.assertEqual(presentation.fetch_status, Presentation.FetchStatus.PENDING)
        self.assertTrue(stock.name_offer_pending)

    def test_reuses_an_existing_presentation(self):
        existing = make_presentation()
        stock = make_stock(self.user, national_code=FIASP_CN)
        self.assertEqual(self.link(stock), existing)
        self.assertEqual(Presentation.objects.count(), 1)

    def test_offer_name_false_does_not_raise_the_offer(self):
        stock = make_stock(self.user, national_code=FIASP_CN)
        self.link(stock, offer_name=False)
        stock.refresh_from_db()
        self.assertIsNotNone(stock.presentation)
        self.assertFalse(stock.name_offer_pending)

    def test_background_link_keeps_updated_at(self):
        stock = make_stock(self.user, national_code=FIASP_CN)
        before = Stock.objects.get(pk=stock.pk).updated_at
        self.link(stock, touch_updated_at=False)
        self.assertEqual(Stock.objects.get(pk=stock.pk).updated_at, before)

    def test_owner_link_bumps_updated_at(self):
        stock = make_stock(self.user, national_code=FIASP_CN)
        before = Stock.objects.get(pk=stock.pk).updated_at
        self.link(stock, touch_updated_at=True)
        self.assertGreater(Stock.objects.get(pk=stock.pk).updated_at, before)

    def test_clearing_the_code_unlinks(self):
        stock = make_stock(self.user, national_code=FIASP_CN)
        self.link(stock)
        stock.national_code = ""
        self.assertIsNone(self.link(stock))
        stock.refresh_from_db()
        self.assertIsNone(stock.presentation)

    def test_an_unchanged_link_writes_nothing(self):
        presentation = make_presentation()
        stock = make_stock(self.user, national_code=FIASP_CN)
        Stock.objects.filter(pk=stock.pk).update(presentation=presentation)
        stock.refresh_from_db()
        self.link(stock, offer_name=True)
        stock.refresh_from_db()
        self.assertFalse(stock.name_offer_pending)

    def test_enqueues_a_fetch_without_baseline(self):
        stock = make_stock(self.user, national_code=FIASP_CN)
        with mock.patch.object(tasks.fetch_presentation, "delay") as delay:
            with self.captureOnCommitCallbacks(execute=True):
                presentation = self.link(stock, enqueue=True)
        delay.assert_called_once_with(presentation.pk)

    def test_no_fetch_when_the_baseline_exists(self):
        make_presentation(fetched_at=timezone.now())
        stock = make_stock(self.user, national_code=FIASP_CN)
        with mock.patch.object(tasks.fetch_presentation, "delay") as delay:
            with self.captureOnCommitCallbacks(execute=True):
                self.link(stock, enqueue=True)
        delay.assert_not_called()

    def test_enqueue_false_never_schedules(self):
        stock = make_stock(self.user, national_code=FIASP_CN)
        with mock.patch.object(tasks.fetch_presentation, "delay") as delay:
            with self.captureOnCommitCallbacks(execute=True):
                self.link(stock, enqueue=False)
        delay.assert_not_called()


class ApplyPresentationTests(TestCase):
    def setUp(self):
        self.presentation = make_presentation()

    def apply(self, data):
        return services.apply_presentation(self.presentation.pk, data)

    def test_fiasp_stores_medicine_presentation_and_active_problem(self):
        presentation = self.apply(fiasp_data())

        medicine = presentation.medicine
        self.assertEqual((medicine.source, medicine.code), ("aemps", "1161160012"))
        self.assertEqual(medicine.name, "FIASP 100 UNIDADES/ML PUMPCART SOLUCION INYECTABLE EN CARTUCHO")
        self.assertEqual(medicine.status, Medicine.Status.AUTHORISED)
        self.assertEqual(medicine.raw["nregistro"], "1161160012")
        self.assertTrue(presentation.name.endswith("5 cartuchos de 1,6 ml"))
        self.assertIs(presentation.marketed, True)
        self.assertEqual(presentation.fetch_status, Presentation.FetchStatus.OK)
        self.assertIsNotNone(presentation.fetched_at)
        self.assertEqual(presentation.supply_severity, SEVERITY_DANGER)
        problem = presentation.supply_problems.get()
        self.assertEqual((problem.native_type, problem.severity), ("1", SEVERITY_DANGER))
        self.assertEqual((problem.started_on, problem.expected_end_on), (date(2025, 4, 10), date(2027, 2, 28)))
        self.assertIsNone(problem.resolved_at)

    def test_applying_twice_duplicates_nothing(self):
        self.apply(fiasp_data())
        self.apply(fiasp_data())
        self.assertEqual(Medicine.objects.count(), 1)
        self.assertEqual(SupplyProblem.objects.count(), 1)

    def test_type_change_updates_the_same_row(self):
        data = fiasp_data()
        self.apply(data)
        first = SupplyProblem.objects.get()
        changed = dataclasses.replace(
            data, supply=dataclasses.replace(data.supply, native_type="5", severity="warning")
        )
        presentation = self.apply(changed)
        problem = SupplyProblem.objects.get()
        self.assertEqual(problem.pk, first.pk)
        self.assertEqual((problem.native_type, problem.severity), ("5", SEVERITY_WARNING))
        self.assertEqual(presentation.supply_severity, SEVERITY_WARNING)

    def test_a_missing_problem_resolves_the_active_one(self):
        self.apply(fiasp_data())
        presentation = self.apply(without_supply(fiasp_data()))
        problem = SupplyProblem.objects.get()
        self.assertIsNotNone(problem.resolved_at)
        self.assertIsNone(presentation.supply_severity)

    def test_a_new_problem_after_a_resolved_one_is_a_new_row(self):
        self.apply(fiasp_data())
        self.apply(without_supply(fiasp_data()))
        self.apply(fiasp_data())
        self.assertEqual(SupplyProblem.objects.count(), 2)
        self.assertEqual(SupplyProblem.objects.filter(resolved_at__isnull=True).count(), 1)

    def test_no_problem_ever_creates_no_row(self):
        presentation = Presentation.objects.create(source="aemps", code=HIDROFEROL_CN)
        services.apply_presentation(presentation.pk, hidroferol_data())
        self.assertFalse(SupplyProblem.objects.exists())

    def test_safety_notices_are_stored_and_linked(self):
        presentation = Presentation.objects.create(source="aemps", code=HIDROFEROL_CN)
        services.apply_presentation(presentation.pk, hidroferol_data())
        medicine = Medicine.objects.get(code="55315")
        self.assertEqual(medicine.safety_notices.count(), 2)
        notice = SafetyNotice.objects.get(reference="MUH (FV), 03/2026")
        self.assertEqual(notice.published_on, date(2026, 9, 16))
        self.assertEqual(notice.native_kind, "1")

    def test_a_notice_no_longer_listed_is_unlinked(self):
        presentation = Presentation.objects.create(source="aemps", code=HIDROFEROL_CN)
        data = hidroferol_data()
        services.apply_presentation(presentation.pk, data)
        kept = data.medicine.safety_notices[0]
        fewer = dataclasses.replace(data, medicine=dataclasses.replace(data.medicine, safety_notices=(kept,)))
        services.apply_presentation(presentation.pk, fewer)
        medicine = Medicine.objects.get(code="55315")
        self.assertEqual(list(medicine.safety_notices.values_list("reference", flat=True)), [kept.reference])
        # The notice itself survives until the daily sync prunes orphans.
        self.assertEqual(SafetyNotice.objects.count(), 2)

    def test_not_found_is_a_baseline_and_clears_the_offer(self):
        user = make_user()
        stock = make_stock(user, national_code=FIASP_CN)
        Stock.objects.filter(pk=stock.pk).update(presentation=self.presentation, name_offer_pending=True)
        before = Stock.objects.get(pk=stock.pk).updated_at

        presentation = self.apply(NOT_FOUND)

        self.assertEqual(presentation.fetch_status, Presentation.FetchStatus.NOT_FOUND)
        self.assertIsNotNone(presentation.fetched_at)
        stock = Stock.objects.get(pk=stock.pk)
        self.assertFalse(stock.name_offer_pending)
        self.assertEqual(stock.updated_at, before)

    def test_not_found_closes_the_active_supply_problem(self):
        self.apply(fiasp_data())

        presentation = self.apply(NOT_FOUND)

        self.assertIsNone(presentation.supply_severity)
        # Closed, not deleted: it stays in the presentation's history.
        problem = SupplyProblem.objects.get()
        self.assertIsNotNone(problem.resolved_at)
        self.assertEqual(problem.native_type, "1")

    def test_success_clears_a_previous_error(self):
        services.record_fetch_error(self.presentation.pk, "boom")
        presentation = self.apply(fiasp_data())
        self.assertEqual((presentation.fetch_status, presentation.last_error), ("ok", ""))

    def test_record_fetch_error_keeps_the_last_good_state(self):
        fetched_at = self.apply(fiasp_data()).fetched_at
        services.record_fetch_error(self.presentation.pk, "x" * 2000)
        presentation = Presentation.objects.get(pk=self.presentation.pk)
        self.assertEqual(presentation.fetch_status, Presentation.FetchStatus.ERROR)
        self.assertEqual(len(presentation.last_error), services.MAX_ERROR_LENGTH)
        self.assertEqual(presentation.fetched_at, fetched_at)
        self.assertIsNotNone(presentation.medicine)


class RefreshPresentationTests(TestCase):
    def setUp(self):
        self.presentation = make_presentation()

    def test_fetches_by_code_applies_and_stamps_the_attempt(self):
        with mock.patch.object(aemps, "fetch", return_value=fiasp_data()) as fetch:
            services.refresh_presentation(self.presentation.pk)
        fetch.assert_called_once_with(FIASP_CN)
        presentation = Presentation.objects.get(pk=self.presentation.pk)
        self.assertEqual(presentation.fetch_status, Presentation.FetchStatus.OK)
        self.assertIsNotNone(presentation.last_attempt_at)

    def test_untrusted_payload_is_recorded_not_raised(self):
        with (
            mock.patch.object(aemps, "fetch", side_effect=UpstreamPayloadError("bad")),
            self.assertLogs("apps.regulatory.services", level="ERROR") as logs,
        ):
            self.assertIsNone(services.refresh_presentation(self.presentation.pk))
        self.assertEqual(logs.records[0].levelname, "ERROR")
        self.assertIn(f"presentation {self.presentation.pk}: bad", logs.output[0])
        presentation = Presentation.objects.get(pk=self.presentation.pk)
        self.assertEqual((presentation.fetch_status, presentation.last_error), ("error", "bad"))
        self.assertIsNone(presentation.fetched_at)

    def test_unavailable_propagates(self):
        with mock.patch.object(aemps, "fetch", side_effect=UpstreamUnavailable("down")):
            with self.assertRaises(UpstreamUnavailable):
                services.refresh_presentation(self.presentation.pk)


class FetchPresentationTaskTests(TestCase):
    def setUp(self):
        self.presentation = make_presentation()

    def reload(self):
        return Presentation.objects.get(pk=self.presentation.pk)

    def test_success(self):
        with mock.patch.object(aemps, "fetch", return_value=fiasp_data()):
            tasks.fetch_presentation.delay(self.presentation.pk)
        self.assertEqual(self.reload().fetch_status, Presentation.FetchStatus.OK)

    def test_unavailable_schedules_a_retry_with_backoff(self):
        # `retry` is patched: in eager mode Celery would run the retries inline
        # and re-raise `Retry`, which tests Celery rather than this task.
        class RetryScheduled(Exception):
            pass

        error = UpstreamUnavailable("down")
        with (
            mock.patch.object(aemps, "fetch", side_effect=error),
            mock.patch.object(tasks.fetch_presentation, "retry", side_effect=RetryScheduled) as retry,
        ):
            with self.assertRaises(RetryScheduled):
                tasks.fetch_presentation.apply(args=[self.presentation.pk], retries=2)
        retry.assert_called_once_with(exc=error, countdown=120)
        # Nothing is recorded while retries remain.
        self.assertEqual(self.reload().fetch_status, Presentation.FetchStatus.PENDING)

    def test_unavailable_after_the_last_retry_is_recorded(self):
        with (
            mock.patch.object(aemps, "fetch", side_effect=UpstreamUnavailable("down")) as fetch,
            mock.patch.object(tasks.fetch_presentation, "retry") as retry,
            self.assertLogs("apps.regulatory.tasks", level="ERROR"),
        ):
            result = tasks.fetch_presentation.apply(args=[self.presentation.pk], retries=tasks.MAX_RETRIES)
        self.assertTrue(result.successful())
        fetch.assert_called_once()
        retry.assert_not_called()
        presentation = self.reload()
        self.assertEqual((presentation.fetch_status, presentation.last_error), ("error", "down"))
        self.assertIsNone(presentation.fetched_at)

    def test_untrusted_payload_is_not_retried(self):
        with (
            mock.patch.object(aemps, "fetch", side_effect=UpstreamPayloadError("bad")) as fetch,
            self.assertLogs("apps.regulatory.services", level="ERROR"),
        ):
            tasks.fetch_presentation.apply(args=[self.presentation.pk])
        fetch.assert_called_once()
        self.assertEqual(self.reload().fetch_status, Presentation.FetchStatus.ERROR)

    def test_disabled_fetching_changes_nothing(self):
        # Test settings switch fetching off: the real client raises FetchDisabled.
        tasks.fetch_presentation.apply(args=[self.presentation.pk])
        presentation = self.reload()
        self.assertEqual(presentation.fetch_status, Presentation.FetchStatus.PENDING)
        self.assertIsNone(presentation.fetched_at)

    def test_a_deleted_presentation_is_ignored(self):
        result = tasks.fetch_presentation.apply(args=[self.presentation.pk + 1000])
        self.assertTrue(result.successful())

    def test_retry_countdown_backs_off_and_caps(self):
        self.assertEqual([tasks.retry_countdown(n) for n in range(6)], [30, 60, 120, 240, 480, 600])


@override_settings(REGULATORY_FETCH_ENABLED=True)
class SyncRegulatoryDataTests(TestCase):
    def setUp(self):
        self.user = make_user()
        # The leaflet step runs after every refresh; its own tests patch it per case.
        patcher = mock.patch.object(aemps, "fetch_leaflet", return_value=None)
        self.fetch_leaflet = patcher.start()
        self.addCleanup(patcher.stop)

    def linked(self, code, data=None):
        presentation = Presentation.objects.create(source="aemps", code=code)
        stock = make_stock(self.user, name=code, national_code=code)
        Stock.objects.filter(pk=stock.pk).update(presentation=presentation)
        if data is not None:
            services.apply_presentation(presentation.pk, data)
        return presentation

    def test_links_pending_stocks_without_offer_or_updated_at(self):
        stock = make_stock(self.user, national_code=FIASP_CN)
        before = Stock.objects.get(pk=stock.pk).updated_at
        with (
            mock.patch.object(aemps, "fetch", return_value=fiasp_data()),
            mock.patch.object(tasks.fetch_presentation, "delay") as delay,
            self.captureOnCommitCallbacks(execute=True),
        ):
            summary = tasks.sync_regulatory_data()
        stock = Stock.objects.get(pk=stock.pk)
        self.assertIsNotNone(stock.presentation)
        self.assertFalse(stock.name_offer_pending)
        self.assertEqual(stock.updated_at, before)
        delay.assert_not_called()  # the sync fetches it itself
        self.assertEqual(summary["linked"], 1)
        self.assertEqual(stock.presentation.fetch_status, Presentation.FetchStatus.OK)

    def test_refreshes_only_presentations_with_stocks(self):
        self.linked(FIASP_CN)
        make_presentation(code=HIDROFEROL_CN, last_attempt_at=timezone.now())
        with mock.patch.object(aemps, "fetch", return_value=fiasp_data()) as fetch:
            summary = tasks.sync_regulatory_data()
        fetch.assert_called_once_with(FIASP_CN)
        self.assertEqual(summary["refreshed"], 1)

    def test_one_unavailable_presentation_does_not_stop_the_run(self):
        self.linked(FIASP_CN)
        self.linked(HIDROFEROL_CN)

        def fetch(code):
            if code == FIASP_CN:
                raise UpstreamUnavailable("down")
            return hidroferol_data()

        # Logged at WARNING, which the test run silences (settings.py): only the
        # recorded outcome is asserted.
        with mock.patch.object(aemps, "fetch", side_effect=fetch):
            summary = tasks.sync_regulatory_data()
        self.assertEqual((summary["refreshed"], summary["errors"]), (1, 1))
        self.assertEqual(Presentation.objects.get(code=FIASP_CN).fetch_status, Presentation.FetchStatus.ERROR)
        self.assertEqual(Presentation.objects.get(code=HIDROFEROL_CN).fetch_status, Presentation.FetchStatus.OK)

    def test_a_presentation_deleted_mid_run_is_skipped(self):
        self.linked(FIASP_CN)

        def vanish(presentation_id, **kwargs):
            raise Presentation.DoesNotExist

        with mock.patch.object(services, "refresh_presentation", side_effect=vanish):
            summary = tasks.sync_regulatory_data()
        self.assertEqual((summary["refreshed"], summary["errors"]), (0, 0))

    def test_prunes_old_orphans_with_their_medicine_and_notices(self):
        orphan = make_presentation(code=HIDROFEROL_CN)
        services.apply_presentation(orphan.pk, hidroferol_data())
        Presentation.objects.filter(pk=orphan.pk).update(last_attempt_at=timezone.now() - timedelta(days=31))

        summary = tasks.sync_regulatory_data()

        self.assertFalse(Presentation.objects.filter(pk=orphan.pk).exists())
        self.assertFalse(Medicine.objects.filter(code="55315").exists())
        self.assertFalse(SafetyNotice.objects.exists())
        self.assertEqual(
            (summary["pruned_presentations"], summary["pruned_medicines"], summary["pruned_notices"]),
            (1, 1, 2),
        )

    def test_keeps_a_recent_orphan(self):
        orphan = make_presentation(last_attempt_at=timezone.now() - timedelta(days=29))
        tasks.sync_regulatory_data()
        self.assertTrue(Presentation.objects.filter(pk=orphan.pk).exists())

    def test_prunes_a_never_fetched_orphan(self):
        orphan = make_presentation()
        tasks.sync_regulatory_data()
        self.assertFalse(Presentation.objects.filter(pk=orphan.pk).exists())

    def test_keeps_a_medicine_still_used_by_another_presentation(self):
        linked = self.linked(FIASP_CN, data=fiasp_data())
        linked.refresh_from_db()  # `apply_presentation` set the medicine on its own copy
        other = make_presentation(code="111111", medicine=linked.medicine)
        Presentation.objects.filter(pk=other.pk).update(last_attempt_at=timezone.now() - timedelta(days=40))
        with mock.patch.object(aemps, "fetch", return_value=fiasp_data()):
            tasks.sync_regulatory_data()
        self.assertFalse(Presentation.objects.filter(pk=other.pk).exists())
        self.assertTrue(Medicine.objects.filter(pk=linked.medicine_id).exists())

    @override_settings(REGULATORY_FETCH_ENABLED=False)
    def test_disabled_fetching_still_links_and_prunes(self):
        stock = make_stock(self.user, national_code=FIASP_CN)
        orphan = make_presentation(code=HIDROFEROL_CN)
        with mock.patch.object(aemps, "fetch") as fetch:
            summary = tasks.sync_regulatory_data()
        fetch.assert_not_called()
        self.assertIsNotNone(Stock.objects.get(pk=stock.pk).presentation)
        self.assertFalse(Presentation.objects.filter(pk=orphan.pk).exists())
        self.assertEqual(summary["refreshed"], 0)


class BeatScheduleTests(SimpleTestCase):
    def test_daily_sync_runs_at_three_utc(self):
        entry = dj_settings.CELERY_BEAT_SCHEDULE["sync-regulatory-data"]
        self.assertEqual(entry["task"], "apps.regulatory.tasks.sync_regulatory_data")
        self.assertEqual(entry["schedule"], crontab(hour=3, minute=0))
        self.assertEqual(dj_settings.CELERY_TIMEZONE, "UTC")


class AdminTests(TestCase):
    def setUp(self):
        admin_user = User.objects.create_superuser(username="root", password="pass", email="root@example.com")
        self.client.force_login(admin_user)
        presentation = make_presentation()
        services.apply_presentation(presentation.pk, fiasp_data())
        self.presentation = Presentation.objects.get(pk=presentation.pk)

    def test_changelists_render(self):
        for model in ("medicine", "presentation", "supplyproblem", "safetynotice", "medicineleaflet"):
            with self.subTest(model=model):
                response = self.client.get(reverse(f"admin:regulatory_{model}_changelist"))
                self.assertEqual(response.status_code, 200)

    def test_rows_cannot_be_added(self):
        for model in ("medicine", "presentation", "supplyproblem", "safetynotice", "medicineleaflet"):
            with self.subTest(model=model):
                response = self.client.get(reverse(f"admin:regulatory_{model}_add"))
                self.assertEqual(response.status_code, 403)

    def test_presentation_is_view_only_with_its_problems_inline(self):
        response = self.client.get(reverse("admin:regulatory_presentation_change", args=[self.presentation.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Consultar Nota Informativa")
        self.assertNotContains(response, 'name="_save"')


class LinkRegulatoryStocksCommandTests(TestCase):
    """`manage.py link_regulatory_stocks`, the one-off backfill (T111)."""

    NTIN = "08470007285144"

    def setUp(self):
        self.user = make_user()

    def run_command(self, *args):
        out = io.StringIO()
        with (
            mock.patch.object(tasks.fetch_presentation, "delay") as delay,
            self.captureOnCommitCallbacks(execute=True),
        ):
            call_command("link_regulatory_stocks", *args, stdout=out)
        return out.getvalue(), delay

    def test_links_spanish_ntins_and_skips_the_rest(self):
        spanish = Stock.objects.create(user=self.user, name="FIASP", gtin=self.NTIN)
        foreign = Stock.objects.create(user=self.user, name="Foreign", gtin="05705244020856")
        no_gtin = Stock.objects.create(user=self.user, name="Plain")
        output, _ = self.run_command()

        spanish.refresh_from_db()
        self.assertEqual((spanish.national_code, spanish.national_code_source), (FIASP_CN, "aemps"))
        self.assertEqual(spanish.presentation.code, FIASP_CN)
        self.assertTrue(spanish.name_offer_pending)
        for stock in (foreign, no_gtin):
            stock.refresh_from_db()
            self.assertEqual(stock.national_code, "")
            self.assertIsNone(stock.presentation)
        self.assertIn("Linked 1 stock(s); skipped 1 without a Spanish NTIN; 1 fetch(es) scheduled.", output)

    def test_a_stock_that_already_has_a_code_is_left_alone(self):
        stock = Stock.objects.create(user=self.user, name="Typed", gtin=self.NTIN, national_code="661426")
        output, delay = self.run_command()
        stock.refresh_from_db()
        self.assertEqual(stock.national_code, "661426")
        delay.assert_not_called()
        self.assertIn("Linked 0 stock(s)", output)

    def test_dry_run_writes_nothing(self):
        stock = Stock.objects.create(user=self.user, name="FIASP", gtin=self.NTIN)
        output, delay = self.run_command("--dry-run")
        stock.refresh_from_db()
        self.assertEqual(stock.national_code, "")
        self.assertFalse(Presentation.objects.exists())
        delay.assert_not_called()
        self.assertIn(f"Would link stock {stock.pk} (FIASP) to aemps:{FIASP_CN}", output)
        self.assertIn("Would link 1 stock(s)", output)

    def test_does_not_touch_updated_at(self):
        stock = Stock.objects.create(user=self.user, name="FIASP", gtin=self.NTIN)
        before = Stock.objects.get(pk=stock.pk).updated_at
        self.run_command()
        self.assertEqual(Stock.objects.get(pk=stock.pk).updated_at, before)

    def test_a_shared_presentation_is_fetched_once(self):
        other = make_user("other")
        first = Stock.objects.create(user=self.user, name="Mine", gtin=self.NTIN)
        Stock.objects.create(user=other, name="Theirs", gtin=self.NTIN)
        output, delay = self.run_command()
        first.refresh_from_db()
        delay.assert_called_once_with(first.presentation_id)
        self.assertIn("Linked 2 stock(s); skipped 0 without a Spanish NTIN; 1 fetch(es) scheduled.", output)

    def test_an_already_fetched_presentation_is_not_fetched_again(self):
        make_presentation(fetched_at=timezone.now())
        Stock.objects.create(user=self.user, name="FIASP", gtin=self.NTIN)
        output, delay = self.run_command()
        delay.assert_not_called()
        self.assertIn("0 fetch(es) scheduled.", output)


@override_settings(DEBUG=True)
class SeedRegulatoryDataTests(TestCase):
    """The seed links three stocks to recorded AEMPS data — and stays offline."""

    def setUp(self):
        with (
            mock.patch.object(aemps, "fetch") as fetch,
            mock.patch.object(aemps, "fetch_leaflet") as fetch_leaflet,
            mock.patch.object(tasks.fetch_presentation, "delay") as delay,
            mock.patch.object(tasks.fetch_leaflet, "delay") as leaflet_delay,
            self.captureOnCommitCallbacks(execute=True),
        ):
            call_command("seed", stdout=io.StringIO())
        self.fetch, self.delay = fetch, delay
        self.fetch, self.delay = fetch, delay
        self.fetch_leaflet, self.leaflet_delay = fetch_leaflet, leaflet_delay

    def test_never_reaches_the_agency(self):
        self.fetch.assert_not_called()
        self.delay.assert_not_called()
        self.fetch_leaflet.assert_not_called()
        self.leaflet_delay.assert_not_called()

    def test_insulin_and_hidroferol_carry_their_recorded_leaflets(self):
        leaflets = MedicineLeaflet.objects.select_related("medicine")
        self.assertEqual(
            sorted((leaflet.medicine.code, len(leaflet.sections)) for leaflet in leaflets),
            [(FIASP_NREGISTRO, 7), (HIDROFEROL_NREGISTRO, 7)],
        )
        # Applied through the service: already sanitised.
        self.assertFalse(any("style=" in section["html"] for leaflet in leaflets for section in leaflet.sections))

    def test_ibuprofen_has_no_leaflet_until_refreshed(self):
        ibuprofen = Stock.objects.get(name="Ibuprofen 600mg")
        self.assertFalse(MedicineLeaflet.objects.filter(medicine=ibuprofen.presentation.medicine).exists())

    def test_links_the_three_regulatory_stocks_with_a_baseline(self):
        linked = Stock.objects.filter(presentation__isnull=False)
        self.assertEqual(
            sorted(linked.values_list("name", "presentation__code")),
            [("Fast-acting insulin", FIASP_CN), ("Hidroferol drops", HIDROFEROL_CN), ("Ibuprofen 600mg", "661426")],
        )
        self.assertFalse(Presentation.objects.filter(fetched_at__isnull=True).exists())
        self.assertEqual(set(Presentation.objects.values_list("fetch_status", flat=True)), {"ok"})

    def test_fast_insulin_has_the_active_problem_and_the_only_pending_offer(self):
        insulin = Stock.objects.get(name="Fast-acting insulin")
        self.assertEqual(insulin.presentation.supply_severity, SEVERITY_DANGER)
        self.assertEqual(insulin.presentation.supply_problems.get(resolved_at__isnull=True).native_type, "1")
        self.assertEqual(list(Stock.objects.filter(name_offer_pending=True)), [insulin])

    def test_hidroferol_carries_its_safety_notices(self):
        hidroferol = Stock.objects.get(name="Hidroferol drops")
        self.assertEqual(hidroferol.presentation.medicine.safety_notices.count(), 2)
        self.assertEqual(hidroferol.gtin, "")

    def test_ibuprofen_code_matches_its_ntin(self):
        ibuprofen = Stock.objects.get(name="Ibuprofen 600mg")
        self.assertEqual(aemps.code_from_gtin(ibuprofen.gtin), ibuprofen.national_code)
        self.assertEqual(
            ibuprofen.presentation.medicine.name, "IBUPROFENO CINFA 600 mg COMPRIMIDOS RECUBIERTOS CON PELICULA EFG"
        )

    def test_a_foreign_gtin_stays_unlinked(self):
        metformin = Stock.objects.get(name="Metformin 850mg")
        self.assertEqual((metformin.national_code, metformin.presentation), ("", None))

    def test_reseeding_replaces_the_catalogue(self):
        call_command("seed", stdout=io.StringIO())
        self.assertEqual(Presentation.objects.count(), 3)
        self.assertEqual(Medicine.objects.count(), 3)
        self.assertEqual(SafetyNotice.objects.count(), 3)
        self.assertEqual(MedicineLeaflet.objects.count(), 2)


# ── Leaflet: sanitising ───────────────────────────────────────────────────────


class SanitizeLeafletHtmlTests(SimpleTestCase):
    """One test per vector: what the sanitiser must remove, and what it must keep."""

    def test_script_is_removed_with_its_content(self):
        self.assertEqual(sanitize_leaflet_html("<p>a</p><script>alert(1)</script>"), "<p>a</p>")

    def test_an_image_with_an_event_handler_and_a_remote_source_is_removed(self):
        self.assertEqual(sanitize_leaflet_html("<img src=x onerror=alert(1)>text"), "text")

    def test_a_javascript_link_loses_its_href(self):
        cleaned = sanitize_leaflet_html('<a href="javascript:alert(1)">x</a>')
        self.assertNotIn("href", cleaned)
        self.assertNotIn("javascript", cleaned)

    def test_a_data_link_loses_its_href(self):
        cleaned = sanitize_leaflet_html('<a href="data:text/html,&lt;script&gt;">x</a>')
        self.assertNotIn("href", cleaned)
        self.assertNotIn("data:", cleaned)

    def test_embedding_and_foreign_content_is_removed_with_its_content(self):
        for markup in (
            '<iframe src="https://example.com">frame</iframe>',
            "<svg onload=alert(1)><circle/>vector</svg>",
            "<style>p { color: red }</style>",
            "<math><mi>x</mi></math>",
            '<object data="x">obj</object>',
            '<form action="https://example.com"><input name="q">form</form>',
        ):
            with self.subTest(markup=markup):
                self.assertEqual(sanitize_leaflet_html(f"{markup}<p>kept</p>"), "<p>kept</p>")

    def test_style_class_and_id_are_removed(self):
        self.assertEqual(sanitize_leaflet_html('<p style="color:red" class="x" id="y">a</p>'), "<p>a</p>")

    def test_style_only_spans_are_unwrapped(self):
        self.assertEqual(sanitize_leaflet_html('<p><span style="font-size:11pt">text</span></p>'), "<p>text</p>")

    def test_an_inline_raster_image_is_kept(self):
        markup = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="pack">'
        self.assertEqual(sanitize_leaflet_html(markup), markup)

    def test_a_jpg_data_image_is_kept(self):
        # CIMA writes `image/jpg`, not `image/jpeg`.
        self.assertIn('src="data:image/jpg;base64,', sanitize_leaflet_html('<img src="data:image/jpg;base64,/9j/">'))

    def test_a_remote_image_is_removed_entirely(self):
        self.assertEqual(sanitize_leaflet_html('<p>a<img src="https://example.com/x.png" alt="q"></p>'), "<p>a</p>")

    def test_an_svg_data_image_is_removed_entirely(self):
        self.assertEqual(sanitize_leaflet_html('<img src="data:image/svg+xml;base64,PHN2Zz4=">'), "")

    def test_an_image_alt_with_a_bracket_is_kept_intact(self):
        cleaned = sanitize_leaflet_html('<img src="data:image/gif;base64,R0lG" alt="a>b">')
        self.assertEqual(cleaned, '<img src="data:image/gif;base64,R0lG" alt="a&gt;b">')

    def test_web_links_open_in_a_new_tab_without_opener(self):
        cleaned = sanitize_leaflet_html('<a href="https://www.aemps.gob.es/">AEMPS</a>')
        self.assertIn('href="https://www.aemps.gob.es/"', cleaned)
        self.assertIn('rel="noopener noreferrer"', cleaned)
        self.assertIn('target="_blank"', cleaned)

    def test_tables_keep_their_spans(self):
        cleaned = sanitize_leaflet_html('<table><tr><td colspan="2" rowspan="3" style="x">c</td></tr></table>')
        self.assertEqual(cleaned, '<table><tbody><tr><td colspan="2" rowspan="3">c</td></tr></tbody></table>')

    def test_the_real_fiasp_leaflet_is_clean_and_readable(self):
        cleaned = "".join(sanitize_leaflet_html(section["html"]) for section in fiasp_leaflet())
        self.assertNotRegex(cleaned, r"style=")
        self.assertNotRegex(cleaned, r"\son\w+=")
        self.assertNotRegex(cleaned, r"(?i)javascript:")
        self.assertIn("Qué es Fiasp", cleaned)
        # Its pack image survives as a data URI.
        self.assertIn('<img src="data:image/jpg;base64,', cleaned)


# ── Leaflet: client ───────────────────────────────────────────────────────────


SECCIONES = [
    {"seccion": "1", "titulo": "Qué es", "orden": 2},
    {"seccion": "0", "titulo": " Introducción ", "orden": 1},
]


class ParseLeafletTests(SimpleTestCase):
    def test_sections_come_in_reading_order_with_keys_and_titles(self):
        sections = aemps.parse_leaflet(SECCIONES, {"0": "<p>intro</p>", "1": "<p>what</p>"})
        self.assertEqual(
            sections,
            [
                {"key": "0", "title": "Introducción", "html": "<p>intro</p>"},
                {"key": "1", "title": "Qué es", "html": "<p>what</p>"},
            ],
        )

    def test_html_is_returned_as_the_agency_wrote_it(self):
        raw = '<p style="margin:0"><script>x</script></p>'
        self.assertEqual(aemps.parse_leaflet(SECCIONES[:1], {"1": raw})[0]["html"], raw)

    def test_untrusted_shapes_raise(self):
        cases = {
            "not a list": ({"seccion": "0"}, {}),
            "entry not a dict": (["0"], {}),
            "entry without key": ([{"titulo": "x", "orden": 1}], {}),
            "order missing": ([{"seccion": "0", "titulo": "x"}], {"0": ""}),
            "order not a number": ([{"seccion": "0", "orden": True}], {"0": ""}),
            "content missing": ([{"seccion": "0", "orden": 1}], {}),
        }
        for label, (secciones, contenidos) in cases.items():
            with self.subTest(label), self.assertRaises(UpstreamPayloadError):
                aemps.parse_leaflet(secciones, contenidos)

    def test_recorded_fiasp_leaflet(self):
        sections = fiasp_leaflet()
        self.assertEqual([section["key"] for section in sections], [str(n) for n in range(7)])
        self.assertEqual(sections[1]["title"], "Qué es Fiasp y para qué se utiliza")

    def test_recorded_leaflet_missing_on_disk(self):
        with self.assertRaises(FileNotFoundError):
            aemps.parse_recorded_leaflet("999", FIXTURES)

    def test_recorded_answers_without_sections(self):
        for payload, expected in (
            ([], None),
            ({"error": "No existen secciones para el medicamento indicado"}, None),
        ):
            with self.subTest(payload=payload), tempfile.TemporaryDirectory() as directory:
                (Path(directory) / "secciones_1.json").write_text(json.dumps(payload), encoding="utf-8")
                self.assertEqual(aemps.parse_recorded_leaflet("1", directory), expected)

    def test_recorded_unknown_error_object_raises(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "secciones_1.json").write_text(json.dumps({"error": "busy"}), encoding="utf-8")
            with self.assertRaises(UpstreamPayloadError):
                aemps.parse_recorded_leaflet("1", directory)


def text_response(status, text=""):
    resp = mock.Mock(status_code=status)
    resp.text = text
    return resp


@override_settings(REGULATORY_FETCH_ENABLED=True)
class FetchLeafletTests(SimpleTestCase):
    def setUp(self):
        patcher = mock.patch.object(aemps, "_throttle")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_lists_the_sections_then_asks_each_one_as_html(self):
        answers = [response(200, SECCIONES), text_response(200, "<p>what</p>"), text_response(200, "<p>intro</p>")]
        with mock.patch.object(aemps._session, "get", side_effect=answers) as get:
            sections = aemps.fetch_leaflet(FIASP_NREGISTRO)
        base = "https://cima.aemps.es/cima/rest/docSegmentado/"
        self.assertEqual(
            get.call_args_list,
            [
                mock.call(
                    base + "secciones/2",
                    params={"nregistro": FIASP_NREGISTRO},
                    headers={"Accept": "application/json"},
                    timeout=aemps.TIMEOUT,
                ),
                mock.call(
                    base + "contenido/2",
                    params={"nregistro": FIASP_NREGISTRO, "seccion": "1"},
                    headers={"Accept": "text/html"},
                    timeout=aemps.TIMEOUT,
                ),
                mock.call(
                    base + "contenido/2",
                    params={"nregistro": FIASP_NREGISTRO, "seccion": "0"},
                    headers={"Accept": "text/html"},
                    timeout=aemps.TIMEOUT,
                ),
            ],
        )
        self.assertEqual([section["html"] for section in sections], ["<p>intro</p>", "<p>what</p>"])

    def test_no_sectioned_leaflet_is_none(self):
        for answer in (
            response(204),
            response(200, []),
            response(200, {"error": "No existen secciones para el medicamento indicado"}),
        ):
            with self.subTest(status=answer.status_code), mock.patch.object(aemps._session, "get", return_value=answer):
                self.assertIsNone(aemps.fetch_leaflet(FIASP_NREGISTRO))

    def test_another_error_object_is_untrusted(self):
        with mock.patch.object(aemps._session, "get", return_value=response(200, {"error": "busy"})):
            with self.assertRaises(UpstreamPayloadError):
                aemps.fetch_leaflet(FIASP_NREGISTRO)

    def test_an_empty_section_is_an_empty_string(self):
        answers = [response(200, SECCIONES[:1]), text_response(204)]
        with mock.patch.object(aemps._session, "get", side_effect=answers):
            self.assertEqual(aemps.fetch_leaflet(FIASP_NREGISTRO)[0]["html"], "")

    def test_an_unreachable_section_is_unavailable(self):
        answers = [response(200, SECCIONES[:1]), text_response(503)]
        with mock.patch.object(aemps._session, "get", side_effect=answers):
            with self.assertRaises(UpstreamUnavailable):
                aemps.fetch_leaflet(FIASP_NREGISTRO)

    @override_settings(REGULATORY_FETCH_ENABLED=False)
    def test_disabled_fetching_raises_before_any_call(self):
        with mock.patch.object(aemps._session, "get") as get, self.assertRaises(FetchDisabled):
            aemps.fetch_leaflet(FIASP_NREGISTRO)
        get.assert_not_called()


# ── Leaflet: storage, tasks and triggers ──────────────────────────────────────


def stored_fiasp_medicine():
    presentation = make_presentation()
    return services.apply_presentation(presentation.pk, fiasp_data(), enqueue_leaflet=False).medicine


class ApplyLeafletTests(TestCase):
    def setUp(self):
        self.medicine = stored_fiasp_medicine()

    def test_stores_the_sections_sanitised(self):
        leaflet = services.apply_leaflet(self.medicine.pk, fiasp_leaflet())
        leaflet.refresh_from_db()
        self.assertEqual(len(leaflet.sections), 7)
        self.assertEqual(leaflet.sections[1]["key"], "1")
        self.assertFalse(any("style=" in section["html"] for section in leaflet.sections))
        self.assertIsNotNone(leaflet.fetched_at)

    def test_the_source_url_is_the_medicine_leaflet_page(self):
        leaflet = services.apply_leaflet(self.medicine.pk, fiasp_leaflet())
        self.assertEqual(leaflet.source_url, "https://cima.aemps.es/cima/dochtml/p/1161160012/P_1161160012.html")

    def test_a_second_answer_updates_instead_of_duplicating(self):
        services.apply_leaflet(self.medicine.pk, fiasp_leaflet())
        services.apply_leaflet(self.medicine.pk, [{"key": "0", "title": "Only", "html": "<p>x</p>"}])
        self.assertEqual(MedicineLeaflet.objects.count(), 1)
        self.assertEqual(MedicineLeaflet.objects.get().sections, [{"key": "0", "title": "Only", "html": "<p>x</p>"}])

    def test_no_sectioned_leaflet_is_stored_as_no_sections(self):
        leaflet = services.apply_leaflet(self.medicine.pk, None)
        self.assertEqual(leaflet.sections, [])
        self.assertEqual(str(leaflet), f"Leaflet of {self.medicine}")


class LeafletTriggerTests(TestCase):
    """When a leaflet fetch is scheduled from a presentation's answer."""

    def apply(self, presentation, **kwargs):
        with (
            mock.patch.object(tasks.fetch_leaflet, "delay") as delay,
            self.captureOnCommitCallbacks(execute=True),
        ):
            services.apply_presentation(presentation.pk, fiasp_data(), **kwargs)
        return delay

    def test_a_new_medicine_enqueues_its_leaflet(self):
        delay = self.apply(make_presentation())
        delay.assert_called_once_with(Medicine.objects.get(code=FIASP_NREGISTRO).pk)

    def test_a_medicine_with_a_leaflet_does_not(self):
        medicine = stored_fiasp_medicine()
        services.apply_leaflet(medicine.pk, None)
        self.apply(Presentation.objects.get()).assert_not_called()

    def test_a_known_medicine_still_without_leaflet_does(self):
        stored_fiasp_medicine()
        self.apply(Presentation.objects.get()).assert_called_once()

    def test_the_caller_can_opt_out(self):
        self.apply(make_presentation(), enqueue_leaflet=False).assert_not_called()

    def test_the_medicine_keeps_its_leaflet_page(self):
        self.assertEqual(
            stored_fiasp_medicine().leaflet_url, "https://cima.aemps.es/cima/dochtml/p/1161160012/P_1161160012.html"
        )


class FetchLeafletTaskTests(TestCase):
    def setUp(self):
        self.medicine = stored_fiasp_medicine()

    def test_success_stores_the_leaflet(self):
        with mock.patch.object(aemps, "fetch_leaflet", return_value=fiasp_leaflet()) as fetch:
            tasks.fetch_leaflet.delay(self.medicine.pk)
        fetch.assert_called_once_with(FIASP_NREGISTRO)
        self.assertEqual(len(MedicineLeaflet.objects.get(medicine=self.medicine).sections), 7)

    def test_unavailable_schedules_a_retry_with_backoff(self):
        class RetryScheduled(Exception):
            pass

        error = UpstreamUnavailable("down")
        with (
            mock.patch.object(aemps, "fetch_leaflet", side_effect=error),
            mock.patch.object(tasks.fetch_leaflet, "retry", side_effect=RetryScheduled) as retry,
        ):
            with self.assertRaises(RetryScheduled):
                tasks.fetch_leaflet.apply(args=[self.medicine.pk], retries=1)
        retry.assert_called_once_with(exc=error, countdown=60)

    def test_giving_up_keeps_the_previous_leaflet(self):
        services.apply_leaflet(self.medicine.pk, fiasp_leaflet())
        with (
            mock.patch.object(aemps, "fetch_leaflet", side_effect=UpstreamUnavailable("down")),
            self.assertLogs("apps.regulatory.tasks", level="ERROR") as logs,
        ):
            result = tasks.fetch_leaflet.apply(args=[self.medicine.pk], retries=tasks.MAX_RETRIES)
        self.assertTrue(result.successful())
        self.assertIn("giving up on medicine", logs.output[0])
        self.assertEqual(len(MedicineLeaflet.objects.get(medicine=self.medicine).sections), 7)

    def test_an_untrusted_payload_is_logged_and_the_leaflet_kept(self):
        services.apply_leaflet(self.medicine.pk, fiasp_leaflet())
        with (
            mock.patch.object(aemps, "fetch_leaflet", side_effect=UpstreamPayloadError("bad")) as fetch,
            self.assertLogs("apps.regulatory.services", level="ERROR") as logs,
        ):
            tasks.fetch_leaflet.apply(args=[self.medicine.pk])
        fetch.assert_called_once()
        self.assertIn("Untrusted leaflet payload", logs.output[0])
        self.assertEqual(len(MedicineLeaflet.objects.get(medicine=self.medicine).sections), 7)

    def test_disabled_fetching_stores_nothing(self):
        # Test settings switch fetching off: the real client raises FetchDisabled.
        tasks.fetch_leaflet.apply(args=[self.medicine.pk])
        self.assertFalse(MedicineLeaflet.objects.exists())

    def test_a_deleted_medicine_is_ignored(self):
        self.assertTrue(tasks.fetch_leaflet.apply(args=[self.medicine.pk + 1000]).successful())


@override_settings(REGULATORY_FETCH_ENABLED=True)
class SyncLeafletTests(TestCase):
    def setUp(self):
        user = make_user()
        presentation = make_presentation()
        Stock.objects.filter(pk=make_stock(user, national_code=FIASP_CN).pk).update(presentation=presentation)
        self.medicine = services.apply_presentation(presentation.pk, fiasp_data(), enqueue_leaflet=False).medicine
        patcher = mock.patch.object(aemps, "fetch", return_value=fiasp_data())
        patcher.start()
        self.addCleanup(patcher.stop)

    def aged(self, days):
        services.apply_leaflet(self.medicine.pk, None)
        MedicineLeaflet.objects.update(fetched_at=timezone.now() - timedelta(days=days))

    def sync(self, **fetch_leaflet):
        with mock.patch.object(aemps, "fetch_leaflet", **fetch_leaflet) as fetch:
            summary = tasks.sync_regulatory_data()
        return summary, fetch

    def test_a_missing_leaflet_is_fetched(self):
        summary, fetch = self.sync(return_value=fiasp_leaflet())
        fetch.assert_called_once_with(FIASP_NREGISTRO)
        self.assertEqual(summary["leaflets"], 1)
        self.assertEqual(len(MedicineLeaflet.objects.get().sections), 7)

    def test_a_31_day_old_leaflet_is_refreshed(self):
        self.aged(31)
        _, fetch = self.sync(return_value=fiasp_leaflet())
        fetch.assert_called_once()
        self.assertEqual(len(MedicineLeaflet.objects.get().sections), 7)

    def test_a_29_day_old_leaflet_is_left(self):
        self.aged(29)
        summary, fetch = self.sync(return_value=fiasp_leaflet())
        fetch.assert_not_called()
        self.assertEqual(summary["leaflets"], 0)

    def test_a_medicine_no_stock_uses_is_skipped(self):
        Stock.objects.all().delete()
        _, fetch = self.sync(return_value=None)
        fetch.assert_not_called()

    def test_an_unavailable_leaflet_is_counted_and_the_old_one_kept(self):
        self.aged(31)
        summary, _ = self.sync(side_effect=UpstreamUnavailable("down"))
        self.assertEqual((summary["leaflets"], summary["leaflet_errors"]), (0, 1))
        self.assertTrue(MedicineLeaflet.objects.exists())

    def test_a_medicine_deleted_mid_run_is_skipped(self):
        def vanish(medicine_id):
            raise Medicine.DoesNotExist

        with mock.patch.object(services, "refresh_leaflet", side_effect=vanish):
            summary = tasks.sync_regulatory_data()
        self.assertEqual((summary["leaflets"], summary["leaflet_errors"]), (0, 0))

    def test_the_presentation_refresh_does_not_enqueue_leaflets(self):
        with (
            mock.patch.object(tasks.fetch_leaflet, "delay") as delay,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self.sync(return_value=None)
        delay.assert_not_called()


class LeafletAdminTests(TestCase):
    def setUp(self):
        admin_user = User.objects.create_superuser(username="root", password="pass", email="root@example.com")
        self.client.force_login(admin_user)
        self.medicine = stored_fiasp_medicine()

    def test_the_list_shows_counts_not_html(self):
        services.apply_leaflet(self.medicine.pk, fiasp_leaflet())
        response = self.client.get(reverse("admin:regulatory_medicineleaflet_changelist"))
        self.assertContains(response, '<td class="field-section_count">7</td>', html=False)
        self.assertNotContains(response, "Qué es Fiasp y para qué se utiliza")

    def test_the_detail_lists_section_titles_read_only(self):
        leaflet = services.apply_leaflet(self.medicine.pk, fiasp_leaflet())
        response = self.client.get(reverse("admin:regulatory_medicineleaflet_change", args=[leaflet.pk]))
        self.assertContains(response, "Qué es Fiasp y para qué se utiliza")
        self.assertNotContains(response, 'name="_save"')

    def test_an_empty_leaflet_shows_a_dash(self):
        leaflet = services.apply_leaflet(self.medicine.pk, None)
        response = self.client.get(reverse("admin:regulatory_medicineleaflet_change", args=[leaflet.pk]))
        self.assertContains(response, "—")


# ── Change detection ──────────────────────────────────────────────────────────

Kind = RegulatoryEvent.Kind
SUPPLY_1 = {"native_type": "1", "severity": "danger", "expected_end_on": "2027-02-28"}


def snap(supply=None, marketed=True, status="authorised", notices=()):
    return services.Snapshot(
        supply=supply,
        marketed=marketed,
        status=status,
        notices={ref: {"reference": ref, "title": f"T {ref}", "url": "", "published_on": None} for ref in notices},
    )


class DiffTests(SimpleTestCase):
    """`_diff`, one row of the detection table per test — no database."""

    def test_identical_snapshots_have_no_events(self):
        self.assertEqual(services._diff(snap(SUPPLY_1, notices=["a"]), snap(SUPPLY_1, notices=["a"])), [])

    def test_a_problem_appearing_is_supply_started(self):
        self.assertEqual(services._diff(snap(), snap(SUPPLY_1)), [(Kind.SUPPLY_STARTED, {"after": SUPPLY_1})])

    def test_a_new_type_is_supply_changed(self):
        after = {**SUPPLY_1, "native_type": "4", "severity": "danger"}
        self.assertEqual(
            services._diff(snap(SUPPLY_1), snap(after)), [(Kind.SUPPLY_CHANGED, {"before": SUPPLY_1, "after": after})]
        )

    def test_a_new_expected_end_is_supply_changed(self):
        after = {**SUPPLY_1, "expected_end_on": "2027-06-30"}
        self.assertEqual(services._diff(snap(SUPPLY_1), snap(after))[0][0], Kind.SUPPLY_CHANGED)

    def test_a_problem_going_away_is_supply_resolved(self):
        self.assertEqual(services._diff(snap(SUPPLY_1), snap()), [(Kind.SUPPLY_RESOLVED, {"before": SUPPLY_1})])

    def test_each_new_notice_is_one_event(self):
        changes = services._diff(snap(notices=["a"]), snap(notices=["a", "c", "b"]))
        self.assertEqual([kind for kind, _ in changes], [Kind.SAFETY_NOTICE_ADDED] * 2)
        self.assertEqual([payload["reference"] for _, payload in changes], ["b", "c"])
        self.assertEqual(set(changes[0][1]), {"reference", "title", "url", "published_on"})

    def test_a_notice_no_longer_listed_is_not_an_event(self):
        self.assertEqual(services._diff(snap(notices=["a"]), snap()), [])

    def test_marketing_stopped(self):
        self.assertEqual(services._diff(snap(marketed=True), snap(marketed=False)), [(Kind.MARKETING_STOPPED, {})])

    def test_marketing_resumed(self):
        self.assertEqual(services._diff(snap(marketed=False), snap(marketed=True)), [(Kind.MARKETING_RESUMED, {})])

    def test_marketed_to_or_from_unknown_is_not_an_event(self):
        for before, after in ((None, True), (None, False), (True, None), (False, None)):
            with self.subTest(before=before, after=after):
                self.assertEqual(services._diff(snap(marketed=before), snap(marketed=after)), [])

    def test_suspension(self):
        self.assertEqual(
            services._diff(snap(), snap(status="suspended")),
            [(Kind.AUTHORIZATION_SUSPENDED, {"before": "authorised"})],
        )

    def test_revocation(self):
        for before in ("authorised", "suspended"):
            with self.subTest(before=before):
                self.assertEqual(
                    services._diff(snap(status=before), snap(status="revoked")),
                    [(Kind.AUTHORIZATION_REVOKED, {"before": before})],
                )

    def test_reinstatement(self):
        for before in ("suspended", "revoked"):
            with self.subTest(before=before):
                self.assertEqual(
                    services._diff(snap(status=before), snap(status="authorised")),
                    [(Kind.AUTHORIZATION_REINSTATED, {"before": before})],
                )

    def test_no_previous_status_is_not_an_event(self):
        self.assertEqual(services._diff(snap(status=None), snap(status="suspended")), [])

    def test_several_changes_come_in_a_stable_order(self):
        changes = services._diff(
            snap(SUPPLY_1, marketed=True, status="authorised"),
            snap(None, marketed=False, status="suspended", notices=["n"]),
        )
        self.assertEqual(
            [kind for kind, _ in changes],
            [Kind.SUPPLY_RESOLVED, Kind.SAFETY_NOTICE_ADDED, Kind.MARKETING_STOPPED, Kind.AUTHORIZATION_SUSPENDED],
        )


class SnapshotTests(TestCase):
    def test_reads_the_stored_state_in_model_terms(self):
        presentation = make_presentation()
        services.apply_presentation(presentation.pk, fiasp_data(), enqueue_leaflet=False)
        snapshot = services._snapshot(Presentation.objects.get(pk=presentation.pk))
        self.assertEqual(snapshot.supply["native_type"], "1")
        self.assertEqual(snapshot.supply["severity"], SEVERITY_DANGER)
        self.assertIsInstance(snapshot.supply["expected_end_on"], str)
        self.assertEqual((snapshot.marketed, snapshot.status, snapshot.notices), (True, "authorised", {}))

    def test_an_unfetched_presentation_is_empty(self):
        self.assertEqual(services._snapshot(make_presentation()), snap(marketed=None, status=None))


def with_notice(data, reference="NEW/2026"):
    """`data` with one more safety notice on its medicine."""
    notice = SafetyNoticeData(
        reference=reference, native_kind="1", title="New notice", url="https://www.aemps.gob.es/n", published_on=None
    )
    medicine = dataclasses.replace(data.medicine, safety_notices=(*data.medicine.safety_notices, notice))
    return dataclasses.replace(data, medicine=medicine)


def with_medicine(data, **fields):
    return dataclasses.replace(data, medicine=dataclasses.replace(data.medicine, **fields))


class ApplyPresentationEventsTests(TestCase):
    def setUp(self):
        self.owner = make_user()
        self.guest = make_user(username="guest")
        self.presentation = make_presentation()
        self.stock = make_stock(self.owner, national_code=FIASP_CN)
        Stock.objects.filter(pk=self.stock.pk).update(presentation=self.presentation)
        self.stock.shared_with.add(self.guest)

    def apply(self, data, presentation=None):
        services.apply_presentation((presentation or self.presentation).pk, data, enqueue_leaflet=False)

    def kinds(self):
        return list(RegulatoryEvent.objects.order_by("pk").values_list("kind", flat=True))

    def test_the_first_application_is_a_silent_baseline(self):
        self.apply(fiasp_data())
        self.assertFalse(RegulatoryEvent.objects.exists())
        self.assertFalse(EventDelivery.objects.exists())

    def test_the_same_state_twice_changes_nothing(self):
        self.apply(fiasp_data())
        self.apply(fiasp_data())
        self.assertFalse(RegulatoryEvent.objects.exists())

    def test_a_resolved_problem_is_told_to_owner_and_guest(self):
        self.apply(fiasp_data())
        self.apply(without_supply(fiasp_data()))
        event = RegulatoryEvent.objects.get()
        self.assertEqual(event.kind, Kind.SUPPLY_RESOLVED)
        self.assertEqual(event.payload["before"]["native_type"], "1")
        self.assertEqual(
            sorted(event.deliveries.values_list("user__username", "stock_id")),
            [("guest", self.stock.pk), ("owner", self.stock.pk)],
        )
        self.assertTrue(all(delivery.delivered_at is None for delivery in event.deliveries.all()))

    def test_a_new_type_is_supply_changed(self):
        self.apply(fiasp_data())
        data = fiasp_data()
        self.apply(dataclasses.replace(data, supply=dataclasses.replace(data.supply, native_type="4")))
        event = RegulatoryEvent.objects.get()
        self.assertEqual(event.kind, Kind.SUPPLY_CHANGED)
        self.assertEqual((event.payload["before"]["native_type"], event.payload["after"]["native_type"]), ("1", "4"))

    def test_a_reworded_note_is_not_an_event(self):
        self.apply(fiasp_data())
        data = fiasp_data()
        self.apply(dataclasses.replace(data, supply=dataclasses.replace(data.supply, note="Otra redacción")))
        self.assertFalse(RegulatoryEvent.objects.exists())
        self.assertEqual(SupplyProblem.objects.get().note, "Otra redacción")

    def test_a_problem_appearing_is_supply_started(self):
        self.apply(without_supply(fiasp_data()))
        self.apply(fiasp_data())
        self.assertEqual(self.kinds(), [Kind.SUPPLY_STARTED])

    def test_marketing_stopped_and_resumed(self):
        self.apply(fiasp_data())
        self.apply(dataclasses.replace(fiasp_data(), marketed=False))
        self.apply(fiasp_data())
        self.assertEqual(self.kinds(), [Kind.MARKETING_STOPPED, Kind.MARKETING_RESUMED])

    def test_suspension_revocation_and_reinstatement(self):
        self.apply(fiasp_data())
        self.apply(with_medicine(fiasp_data(), suspended_on=date(2026, 11, 1)))
        self.apply(with_medicine(fiasp_data(), revoked_on=date(2026, 11, 5)))
        self.apply(fiasp_data())
        self.assertEqual(
            self.kinds(),
            [Kind.AUTHORIZATION_SUSPENDED, Kind.AUTHORIZATION_REVOKED, Kind.AUTHORIZATION_REINSTATED],
        )
        self.assertEqual(
            [event.payload for event in RegulatoryEvent.objects.order_by("pk")],
            [{"before": "authorised"}, {"before": "suspended"}, {"before": "revoked"}],
        )

    def test_not_found_after_ok_is_silent(self):
        self.apply(fiasp_data())
        self.apply(NOT_FOUND)
        self.assertFalse(RegulatoryEvent.objects.exists())

    def test_ok_after_not_found_is_a_fresh_baseline(self):
        # The NotFound closed the problem without the shortage ending: seeing
        # it again is not a new problem.
        self.apply(fiasp_data())
        self.apply(NOT_FOUND)
        self.apply(fiasp_data())
        self.assertFalse(RegulatoryEvent.objects.exists())
        self.apply(without_supply(fiasp_data()))
        self.assertEqual(self.kinds(), [Kind.SUPPLY_RESOLVED])

    def test_an_error_keeps_the_baseline(self):
        self.apply(fiasp_data())
        services.record_fetch_error(self.presentation.pk, "down")
        self.apply(without_supply(fiasp_data()))
        self.assertEqual(self.kinds(), [Kind.SUPPLY_RESOLVED])

    def test_payloads_use_model_names_only(self):
        self.apply(without_supply(fiasp_data()))
        self.apply(fiasp_data())
        self.assertEqual(
            set(RegulatoryEvent.objects.get().payload["after"]), {"native_type", "severity", "expected_end_on"}
        )


class SafetyNoticeEventTests(TestCase):
    """A notice belongs to the medicine: one event per followed presentation, once."""

    def setUp(self):
        self.owner = make_user()
        self.main = make_presentation(code=HIDROFEROL_CN)
        self.sibling = make_presentation(code="999999")
        for presentation in (self.main, self.sibling):
            stock = make_stock(self.owner, name=presentation.code, national_code=presentation.code)
            Stock.objects.filter(pk=stock.pk).update(presentation=presentation)
            services.apply_presentation(presentation.pk, hidroferol_data(), enqueue_leaflet=False)

    def test_a_new_notice_is_recorded_on_every_followed_presentation(self):
        services.apply_presentation(self.main.pk, with_notice(hidroferol_data()), enqueue_leaflet=False)
        events = RegulatoryEvent.objects.order_by("presentation_id")
        self.assertEqual(
            [(event.presentation_id, event.kind) for event in events],
            [
                (self.main.pk, Kind.SAFETY_NOTICE_ADDED),
                (self.sibling.pk, Kind.SAFETY_NOTICE_ADDED),
            ],
        )
        self.assertEqual(events[0].payload["reference"], "NEW/2026")

    def test_applying_the_sibling_next_does_not_repeat_it(self):
        services.apply_presentation(self.main.pk, with_notice(hidroferol_data()), enqueue_leaflet=False)
        services.apply_presentation(self.sibling.pk, with_notice(hidroferol_data()), enqueue_leaflet=False)
        self.assertEqual(RegulatoryEvent.objects.count(), 2)

    def test_a_sibling_without_baseline_or_stocks_gets_no_event(self):
        unfetched = make_presentation(code="888888")
        Presentation.objects.filter(pk=unfetched.pk).update(medicine=Medicine.objects.get())
        stock = make_stock(self.owner, name="unfetched", national_code="888888")
        Stock.objects.filter(pk=stock.pk).update(presentation=unfetched)
        unfollowed = make_presentation(code="777777", fetched_at=timezone.now())
        Presentation.objects.filter(pk=unfollowed.pk).update(medicine=Medicine.objects.get())

        services.apply_presentation(self.main.pk, with_notice(hidroferol_data()), enqueue_leaflet=False)
        self.assertEqual(
            sorted(RegulatoryEvent.objects.values_list("presentation_id", flat=True)), [self.main.pk, self.sibling.pk]
        )


class EventDeliveryTests(TestCase):
    def setUp(self):
        self.owner = make_user()
        self.presentation = make_presentation()

    def link(self, user, name):
        stock = make_stock(user, name=name, national_code=FIASP_CN)
        Stock.objects.filter(pk=stock.pk).update(presentation=self.presentation)
        return stock

    def resolve(self):
        services.apply_presentation(self.presentation.pk, fiasp_data(), enqueue_leaflet=False)
        services.apply_presentation(self.presentation.pk, without_supply(fiasp_data()), enqueue_leaflet=False)
        return RegulatoryEvent.objects.get()

    def test_two_stocks_of_one_user_make_one_delivery_through_the_first(self):
        first = self.link(self.owner, "Pens")
        self.link(self.owner, "Spare pens")
        event = self.resolve()
        self.assertEqual(list(event.deliveries.values_list("user_id", "stock_id")), [(self.owner.pk, first.pk)])

    def test_a_guest_of_two_stocks_is_told_once(self):
        guest = make_user(username="guest")
        first = self.link(self.owner, "Pens")
        second = self.link(self.owner, "Spare pens")
        second.shared_with.add(guest)
        first.shared_with.add(guest)
        event = self.resolve()
        self.assertEqual(event.deliveries.get(user=guest).stock_id, first.pk)

    def test_sharing_after_the_event_brings_no_delivery_for_it(self):
        stock = self.link(self.owner, "Pens")
        event = self.resolve()
        guest = make_user(username="late")
        stock.shared_with.add(guest)
        self.assertFalse(event.deliveries.filter(user=guest).exists())

    def test_deleting_the_stock_takes_its_deliveries(self):
        stock = self.link(self.owner, "Pens")
        self.resolve()
        stock.delete()
        self.assertFalse(EventDelivery.objects.exists())
        self.assertTrue(RegulatoryEvent.objects.exists())

    def test_one_delivery_per_event_and_user(self):
        self.link(self.owner, "Pens")
        event = self.resolve()
        stock = Stock.objects.get()
        with self.assertRaises(IntegrityError), transaction.atomic():
            EventDelivery.objects.create(event=event, user=self.owner, stock=stock)

    def test_str_names_event_and_user(self):
        self.link(self.owner, "Pens")
        delivery = self.resolve().deliveries.get()
        self.assertIn("Supply problem resolved", str(delivery))
        self.assertIn("owner", str(delivery))


@override_settings(REGULATORY_FETCH_ENABLED=False)
class ExpireDeliveriesTests(TestCase):
    def test_drops_only_unsent_deliveries_older_than_thirty_days(self):
        owner = make_user()
        presentation = make_presentation()
        stock = make_stock(owner, national_code=FIASP_CN)
        Stock.objects.filter(pk=stock.pk).update(presentation=presentation)
        event = RegulatoryEvent.objects.create(presentation=presentation, kind=Kind.SUPPLY_STARTED)
        now = timezone.now()
        users = {name: make_user(username=name) for name in ("old", "recent", "sent")}
        for name, (days, delivered) in {"old": (31, None), "recent": (29, None), "sent": (60, now)}.items():
            delivery = EventDelivery.objects.create(event=event, user=users[name], stock=stock, delivered_at=delivered)
            EventDelivery.objects.filter(pk=delivery.pk).update(created_at=now - timedelta(days=days))

        summary = tasks.sync_regulatory_data()

        self.assertEqual(summary["expired_deliveries"], 1)
        self.assertEqual(sorted(EventDelivery.objects.values_list("user__username", flat=True)), ["recent", "sent"])


class EventAdminTests(TestCase):
    def setUp(self):
        admin_user = User.objects.create_superuser(username="root", password="pass", email="root@example.com")
        self.client.force_login(admin_user)
        owner = make_user()
        presentation = make_presentation()
        stock = make_stock(owner, national_code=FIASP_CN)
        Stock.objects.filter(pk=stock.pk).update(presentation=presentation)
        services.apply_presentation(presentation.pk, fiasp_data(), enqueue_leaflet=False)
        services.apply_presentation(presentation.pk, without_supply(fiasp_data()), enqueue_leaflet=False)

    def test_changelists_render_read_only(self):
        for model in ("regulatoryevent", "eventdelivery"):
            with self.subTest(model=model):
                self.assertContains(
                    self.client.get(reverse(f"admin:regulatory_{model}_changelist")), "Supply problem resolved"
                )
                self.assertEqual(self.client.get(reverse(f"admin:regulatory_{model}_add")).status_code, 403)
