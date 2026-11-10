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
    UpstreamPayloadError,
    UpstreamUnavailable,
)
from apps.regulatory.models import Medicine, Presentation, SafetyNotice, SupplyProblem
from apps.routines.models import Stock

User = get_user_model()

FIXTURES = Path(__file__).parent / "test_data" / "aemps"

FIASP_CN = "728514"
HIDROFEROL_CN = "934554"
SUSPENDED_CN = "656538"
REVOKED_CN = "708201"


def load(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def fiasp():
    return load("medicamento_728514.json"), load("psuministro_728514.json")


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
            "https://cima.aemps.es/cima/rest/medicamento", params={"cn": FIASP_CN}, timeout=aemps.TIMEOUT
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
        with mock.patch.object(aemps, "fetch", side_effect=UpstreamPayloadError("bad")):
            self.assertIsNone(services.refresh_presentation(self.presentation.pk))
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

        def vanish(presentation_id):
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
        for model in ("medicine", "presentation", "supplyproblem", "safetynotice"):
            with self.subTest(model=model):
                response = self.client.get(reverse(f"admin:regulatory_{model}_changelist"))
                self.assertEqual(response.status_code, 200)

    def test_rows_cannot_be_added(self):
        for model in ("medicine", "presentation", "supplyproblem", "safetynotice"):
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
            mock.patch.object(tasks.fetch_presentation, "delay") as delay,
            self.captureOnCommitCallbacks(execute=True),
        ):
            call_command("seed", stdout=io.StringIO())
        self.fetch, self.delay = fetch, delay

    def test_never_reaches_the_agency(self):
        self.fetch.assert_not_called()
        self.delay.assert_not_called()

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
