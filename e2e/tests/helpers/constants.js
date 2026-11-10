// Canonical names of every fixture row. Specs MUST go through `SEED.*`
// instead of hardcoding strings — that way, renaming a routine or lot
// in `backend/apps/core/management/commands/seed.py` only requires an
// edit here, not in every spec.

const SHARED_PASSWORD = process.env.DEMO_USERS_PASSWORD ?? 'change-me'

export const SEED = {
  admin: {
    username: process.env.E2E_USERNAME ?? 'admin',
    // Login is email-based (T193+). The bootstrap admin's email is ADMIN_EMAIL
    // (defaults to admin@example.com); override via E2E_ADMIN_EMAIL if needed.
    email: process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com',
    // The bootstrap admin has no name, so `loginAs` completes the one-time
    // onboarding with "Admin User" — its deterministic display name thereafter.
    name: 'Admin User',
    password: process.env.E2E_PASSWORD ?? '',
  },
  // `name` is the display name (first + last) that the UI renders post-T197
  // — share modals and contact rows show this, never the username.
  user1: { username: 'cibran', email: 'cibran@nudge.test', name: 'Cibrán Docampo', password: SHARED_PASSWORD },
  user2: { username: 'maria', email: 'maria@nudge.test', name: 'María García', password: SHARED_PASSWORD },
  user3: { username: 'laura', email: 'laura@nudge.test', name: 'Laura Vázquez', password: SHARED_PASSWORD },
  routines: {
    takeVitaminD: 'Take Vitamin D',
    changePumpCannula: 'Change pump cannula',
    replaceGlucoseSensor: 'Replace glucose sensor',
    takeAntihistamine: 'Take antihistamine',
    changeBritaFilter: 'Change Brita filter',
    fertilizeOrchid: 'Fertilize orchid',
    waterCactus: 'Water cactus',
    iplHairRemoval: 'IPL hair removal',
    descaleCoffeeMachine: 'Descale coffee machine',
    takeBirthControl: 'Take birth control pill',
  },
  stocks: {
    hidroferol: 'Hidroferol drops',
    pumpCannulas: 'Insulin pump cannulas',
    glucoseSensors: 'Glucose monitor sensors',
    ibuprofen: 'Ibuprofen 600mg',
    paracetamol: 'Paracetamol 1g',
    ebastine: 'Ebastine',
    biodramina: 'Biodramina',
    britaFilter: 'Brita filter cartridges',
    orchidFertilizer: 'Orchid fertilizer',
    descalerTablets: 'Descaler tablets',
    birthControlPills: 'Birth control pills',
    metformin: 'Metformin 850mg',
    fastInsulin: 'Fast-acting insulin',
  },
  // Regulatory data the seed applies from recorded AEMPS answers (T111).
  // `officialName` is the medicine name CIMA writes (the name offer proposes
  // it); `cn` is the 6-digit national code. Only fastInsulin has the offer
  // pending, so only a spec that answers it may open that stock.
  regulatory: {
    fastInsulin: {
      cn: '728514',
      officialName: 'FIASP 100 UNIDADES/ML PUMPCART SOLUCION INYECTABLE EN CARTUCHO',
      supplyProblem: true,
      nameOfferPending: true,
    },
    hidroferol: {
      cn: '934554',
      officialName: 'HIDROFEROL 0,1 mg/ml GOTAS ORALES EN SOLUCION',
      safetyNotices: 2,
    },
    ibuprofen: {
      cn: '661426',
      officialName: 'IBUPROFENO CINFA 600 mg COMPRIMIDOS RECUBIERTOS CON PELICULA EFG',
    },
  },
  // Stocks the seed pins for user1, so every run starts with the Destacados
  // section on screen. A pinned product renders twice (Destacados + its
  // group) — locate it with `.first()` or scope it to a section.
  pinnedForUser1: ['metformin', 'hidroferol', 'pumpCannulas'],
  // `STOCK_MAX_PINNED_ITEMS` default in backend/nudge/settings.py.
  maxPinnedItems: 4,
  lots: {
    // Hidroferol — multi-lot (2 with a lot number + 1 without). HID-A is the FEFO front.
    HIDROFEROL_NEAR: 'HID-A',
    HIDROFEROL_FAR: 'HID-B',
    HIDROFEROL_NO_SN_EXPIRY_DAYS: 60,
    // Ebastine — 3 lots, FEFO order.
    EBASTINE_LOTS: ['EBA-1', 'EBA-2', 'EBA-3'],
    // Single-lot stocks.
    GLUCOSE_SENSOR: 'SEN-OLD',
    PUMP_CANNULA: 'CAN-A',
    IBUPROFEN_NEAR: 'IBU-1',
    IBUPROFEN_FAR: 'IBU-2',
    PARACETAMOL: 'PCT-2028',
    BIRTH_CONTROL: 'BCP-2026',
  },
  expectedStates: {
    // Routines with zero history → `is_due()` short-circuits to True.
    neverStarted: ['iplHairRemoval'],
    // Routines whose last entry sits inside the cycle.
    upcoming: ['fertilizeOrchid', 'replaceGlucoseSensor', 'descaleCoffeeMachine'],
    // Routines whose last entry is past the interval.
    overdue: ['takeVitaminD'],
    // Routines whose linked stock is empty (Done button disabled).
    blocked: ['changePumpCannula'],
  },
}

// Backward compatibility with specs written before the SEED refactor.
export const CREDS = SEED.admin
