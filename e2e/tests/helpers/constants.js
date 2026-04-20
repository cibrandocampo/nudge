// Canonical names of every fixture row (T073). Never hardcode them in specs.

export const SEED = {
  admin: {
    username: process.env.E2E_USERNAME ?? 'admin',
    password: process.env.E2E_PASSWORD ?? '',
  },
  user1: { username: 'user1', password: process.env.E2E_USER1_PASSWORD ?? 'e2e-pass-1' },
  user2: { username: 'user2', password: process.env.E2E_USER2_PASSWORD ?? 'e2e-pass-2' },
  user3: { username: 'user3', password: process.env.E2E_USER3_PASSWORD ?? 'e2e-pass-3' },
  routines: {
    takeVitamins: 'Take vitamins',
    morningStretch: 'Morning stretch',
    weeklyCleaning: 'Weekly cleaning',
    waterFilter: 'Water filter',
    vitaminDSupplement: 'Vitamin D supplement',
    medication: 'Medication',
    painRelief: 'Pain relief',
  },
  stocks: {
    vitaminD: 'Vitamin D',
    filterCartridge: 'Filter cartridge',
    pills: 'Pills',
    ibuprofen: 'Ibuprofen',
    personal: 'Personal stock',
  },
  lots: {
    VITAMIN_D_NEAR_EXPIRY: 'VIT-A',
    VITAMIN_D_FAR: 'VIT-B',
    VITAMIN_D_NO_SN_EXPIRY_DAYS: 60,
    PILLS: ['PILL-1', 'PILL-2', 'PILL-3'],
    IBU_DEPLETED: 'IBU-1',
  },
  expectedStates: {
    neverStarted: ['morningStretch', 'waterFilter', 'painRelief'],
    upcoming: ['weeklyCleaning', 'vitaminDSupplement'],
    overdue: ['takeVitamins', 'medication'],
    blocked: ['painRelief'],
  },
}

// Backward compatibility with specs written before the SEED refactor.
export const CREDS = SEED.admin
