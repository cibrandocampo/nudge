# Recorded CIMA responses

Real answers of the CIMA REST API (`https://cima.aemps.es/cima/rest/`), saved
with `curl … | jq .` and used by `apps/regulatory/tests.py` so no test ever
reaches the network. Recorded on **2026-11-10**. They are a snapshot: CIMA's
live data moves on, the tests do not.

| File | Request | Case |
|------|---------|------|
| `medicamento_728514.json` | `GET medicamento?cn=728514` | FIASP 100 U/ml PumpCart (`nregistro` 1161160012). Active supply problem (`psum: true`), no safety notices (`notas: false`), leaflet with sections |
| `psuministro_728514.json` | `GET psuministro/728514` | The same problem with its type: `tipoProblemaSuministro: 1` ("Consultar Nota Informativa") |
| `medicamento_934554.json` | `GET medicamento?cn=934554` | Hidroferol 0,1 mg/ml gotas, 10 ml (`nregistro` 55315). Marketed, no supply problem, `notas: true` |
| `notas_55315.json` | `GET notas/55315` | Its two safety notices about vitamin-D overdose |
| `medicamento_656538.json` | `GET medicamento?cn=656538` | Doctril Forte 400 mg (`nregistro` 62258). **Suspended** (`estado.susp`), not marketed |
| `notas_62258.json` | `GET notas/62258` | Its safety notice |
| `medicamento_708201.json` | `GET medicamento?cn=708201` | Grippostad con ibuprofeno (`nregistro` 80298). **Revoked** (`estado.rev`) |
| `notas_80298.json` | `GET notas/80298` | Its safety notice |

Cases with no real example at hand (a medicine without leaflet, an unknown
supply type, a malformed payload) are built in the tests by editing a copy of
one of these files.

Added in T111 for the seed:

| File | Request | Case |
|------|---------|------|
| `medicamento_661426.json` | `GET medicamento?cn=661426` | Ibuprofeno Cinfa 600 mg, 40 comprimidos (`nregistro` 70039). Marketed, no supply problem. NTIN `08470006614266`; CN check digit 6 (T109 research §1) |
| `notas_70039.json` | `GET notas/70039` | Its safety notice |
