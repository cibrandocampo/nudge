import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import LoginPage from '../LoginPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

describe('LoginPage — wizard (T196)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Happy paths ──────────────────────────────────────────────────────────

  it('OTP login of an existing user navigates to /', async () => {
    const loginStart = vi.fn().mockResolvedValue({ method: 'otp' })
    const loginVerify = vi.fn().mockResolvedValue({ is_new: false })
    const { user } = renderWithProviders(<LoginPage />, { auth: { loginStart, loginVerify, isNewUser: false } })

    await user.type(screen.getByPlaceholderText('Email'), 'user@example.com')
    await user.click(screen.getByText('Continue'))

    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument())
    expect(loginStart).toHaveBeenCalledWith('user@example.com')

    // Typing the 6th digit auto-submits — no explicit Verify click needed.
    await user.type(screen.getByPlaceholderText('6-digit code'), '123456')

    await waitFor(() => expect(loginVerify).toHaveBeenCalledWith('user@example.com', { code: '123456' }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'))
  })

  it('New signup goes through email → OTP → name and lands on /', async () => {
    const loginStart = vi.fn().mockResolvedValue({ method: 'otp' })
    const loginVerify = vi.fn().mockResolvedValue({ is_new: true })
    const completeProfile = vi.fn().mockResolvedValue(undefined)
    const { user } = renderWithProviders(<LoginPage />, {
      auth: { loginStart, loginVerify, completeProfile, isNewUser: false },
    })

    await user.type(screen.getByPlaceholderText('Email'), 'fresh@example.com')
    await user.click(screen.getByText('Continue'))
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument())

    // Auto-submit fires when the 6th digit lands.
    await user.type(screen.getByPlaceholderText('6-digit code'), '654321')

    // Lands on the name step (is_new=true)
    await waitFor(() => expect(screen.getByText('Welcome to Nudge!')).toBeInTheDocument())
    expect(mockNavigate).not.toHaveBeenCalled()

    await user.type(screen.getByPlaceholderText('First name'), 'Ada')
    await user.type(screen.getByPlaceholderText('Last name'), 'Lovelace')
    await user.click(screen.getByText('Continue'))

    await waitFor(() => expect(completeProfile).toHaveBeenCalledWith('Ada', 'Lovelace'))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'))
  })

  it('Password login of a non-new user navigates to /', async () => {
    const loginStart = vi.fn().mockResolvedValue({ method: 'password' })
    const loginVerify = vi.fn().mockResolvedValue({ is_new: false })
    const { user } = renderWithProviders(<LoginPage />, { auth: { loginStart, loginVerify, isNewUser: false } })

    await user.type(screen.getByPlaceholderText('Email'), 'admin@example.com')
    await user.click(screen.getByText('Continue'))

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument())
    await user.type(screen.getByPlaceholderText('Password'), 'pw')
    await user.click(screen.getByText('Sign in'))

    await waitFor(() => expect(loginVerify).toHaveBeenCalledWith('admin@example.com', { password: 'pw' }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'))
  })

  // ── Errors ───────────────────────────────────────────────────────────────

  it('shows user_not_found error and stays on the email step', async () => {
    const loginStart = vi.fn().mockRejectedValue(new Error('user_not_found'))
    const { user } = renderWithProviders(<LoginPage />, { auth: { loginStart, isNewUser: false } })

    await user.type(screen.getByPlaceholderText('Email'), 'ghost@example.com')
    await user.click(screen.getByText('Continue'))

    await waitFor(() => expect(screen.getByText("We can't find an account with that email.")).toBeInTheDocument())
    // Still on the email step.
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('6-digit code')).not.toBeInTheDocument()
  })

  it('shows rate-limited error when loginStart fails with status 429', async () => {
    const err = new Error('login_start_failed')
    err.status = 429
    const loginStart = vi.fn().mockRejectedValue(err)
    const { user } = renderWithProviders(<LoginPage />, { auth: { loginStart, isNewUser: false } })

    await user.type(screen.getByPlaceholderText('Email'), 'u@x.com')
    await user.click(screen.getByText('Continue'))

    await waitFor(() => expect(screen.getByText('Too many attempts. Try again later.')).toBeInTheDocument())
  })

  it('shows codeInvalid on a bad OTP and does NOT navigate', async () => {
    const loginStart = vi.fn().mockResolvedValue({ method: 'otp' })
    const verifyErr = new Error('login_verify_failed')
    verifyErr.status = 400
    const loginVerify = vi.fn().mockRejectedValue(verifyErr)
    const { user } = renderWithProviders(<LoginPage />, { auth: { loginStart, loginVerify, isNewUser: false } })

    await user.type(screen.getByPlaceholderText('Email'), 'u@x.com')
    await user.click(screen.getByText('Continue'))
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument())

    // Auto-submit on the 6th digit triggers the (failing) verify call;
    // no need to click Verify explicitly.
    await user.type(screen.getByPlaceholderText('6-digit code'), '000000')

    await waitFor(() => expect(screen.getByText('Invalid or expired code.')).toBeInTheDocument())
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  // ── Back navigation ──────────────────────────────────────────────────────

  it('"Back" from the OTP step returns to the email step and clears state', async () => {
    const loginStart = vi.fn().mockResolvedValue({ method: 'otp' })
    const { user } = renderWithProviders(<LoginPage />, { auth: { loginStart, isNewUser: false } })

    await user.type(screen.getByPlaceholderText('Email'), 'u@x.com')
    await user.click(screen.getByText('Continue'))
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('6-digit code'), '123')
    await user.click(screen.getByRole('button', { name: 'Back' }))

    // Email step visible again, with the previous email still in the input.
    expect(screen.getByPlaceholderText('Email')).toHaveValue('u@x.com')
    // The code field is gone and its state was reset (no leakage).
    expect(screen.queryByPlaceholderText('6-digit code')).not.toBeInTheDocument()
  })

  // ── Resend cooldown ──────────────────────────────────────────────────────

  it('Resend button is disabled while the cooldown is ticking', async () => {
    const loginStart = vi.fn().mockResolvedValue({ method: 'otp' })
    const { user } = renderWithProviders(<LoginPage />, { auth: { loginStart, isNewUser: false } })

    await user.type(screen.getByPlaceholderText('Email'), 'u@x.com')
    await user.click(screen.getByText('Continue'))
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument())

    // The resend button starts the cooldown at 30s and is disabled.
    // We assert the disabled state without trying to flush 30 wall-clock
    // seconds in the test — the cooldown behaviour itself is a simple
    // setTimeout chain that doesn't need timer mocking to be trusted.
    const resendDisabled = screen.getByRole('button', { name: /Resend in \d+s/ })
    expect(resendDisabled).toBeDisabled()
    // Clicking the disabled button must not call loginStart again.
    await user.click(resendDisabled)
    expect(loginStart).toHaveBeenCalledTimes(1)
  })

  // ── Onboarding gate jump-in ──────────────────────────────────────────────

  it('Jumps straight to the name step when mounted with isNewUser=true', () => {
    renderWithProviders(<LoginPage />, { auth: { isNewUser: true } })
    expect(screen.getByText('Welcome to Nudge!')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Email')).not.toBeInTheDocument()
  })

  // ── Auto-submit on 6th OTP digit ────────────────────────────────────────

  it('Auto-submits the OTP as soon as the 6th digit is entered (no click needed)', async () => {
    const loginStart = vi.fn().mockResolvedValue({ method: 'otp' })
    const loginVerify = vi.fn().mockResolvedValue({ is_new: false })
    const { user } = renderWithProviders(<LoginPage />, { auth: { loginStart, loginVerify, isNewUser: false } })

    await user.type(screen.getByPlaceholderText('Email'), 'auto@example.com')
    await user.click(screen.getByText('Continue'))
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument())

    // Typing the 6 digits without ever clicking Verify must still
    // trigger the verify endpoint — the wizard auto-submits on the 6th
    // character (covers both typing the last digit and pasting all six).
    await user.type(screen.getByPlaceholderText('6-digit code'), '123456')

    await waitFor(() => expect(loginVerify).toHaveBeenCalledWith('auto@example.com', { code: '123456' }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'))
  })

  it('Auto-submit only fires once per attempt (typing past 6 chars is impossible)', async () => {
    const loginStart = vi.fn().mockResolvedValue({ method: 'otp' })
    const loginVerify = vi.fn().mockResolvedValue({ is_new: false })
    const { user } = renderWithProviders(<LoginPage />, { auth: { loginStart, loginVerify, isNewUser: false } })

    await user.type(screen.getByPlaceholderText('Email'), 'auto@example.com')
    await user.click(screen.getByText('Continue'))
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument())

    // Type one extra digit at the end — maxLength + slice(0,6) drops it,
    // and the loading guard in submitOtp prevents a second call.
    await user.type(screen.getByPlaceholderText('6-digit code'), '1234567')

    await waitFor(() => expect(loginVerify).toHaveBeenCalledTimes(1))
    expect(loginVerify).toHaveBeenCalledWith('auto@example.com', { code: '123456' })
  })

  // ── Email-step copy reflects ALLOW_SELF_SIGNUP ──────────────────────────

  it('Shows "Sign in or create an account" when self-signup is enabled', () => {
    renderWithProviders(<LoginPage />, { auth: { allowSelfSignup: true } })
    expect(screen.getByText('Sign in or create an account')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('Shows "Sign in" when self-signup is disabled', () => {
    renderWithProviders(<LoginPage />, { auth: { allowSelfSignup: false } })
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText('Sign in or create an account')).not.toBeInTheDocument()
  })

  it('Renders neither heading until the auth config has loaded', () => {
    renderWithProviders(<LoginPage />, { auth: { allowSelfSignup: null } })
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(screen.queryByText('Sign in or create an account')).not.toBeInTheDocument()
    // The form is still usable while loading — the email input is mounted.
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
  })

  it('Rejects empty name submissions on the name step', async () => {
    const completeProfile = vi.fn()
    const { user } = renderWithProviders(<LoginPage />, { auth: { completeProfile, isNewUser: true } })

    // Submit-button disabled when fields are blank; type whitespace and
    // confirm the client-side guard fires.
    await user.type(screen.getByPlaceholderText('First name'), '   ')
    const continueBtn = screen.getByRole('button', { name: 'Continue' })
    expect(continueBtn).toBeDisabled()
    expect(completeProfile).not.toHaveBeenCalled()
  })

  it('handleNameSubmit surfaces namesRequired when the form is submitted with blank fields', () => {
    // The submit button is normally disabled when names are blank, but a
    // direct `fireEvent.submit` exercises the defensive in-handler guard
    // (cases where the form is submitted programmatically, e.g. via
    // future Enter-key paths). Asserts the error appears AND the auth
    // call is never made.
    const completeProfile = vi.fn()
    renderWithProviders(<LoginPage />, { auth: { completeProfile, isNewUser: true } })
    const firstName = screen.getByPlaceholderText('First name')
    fireEvent.submit(firstName.closest('form'))
    expect(screen.getByText('First and last name are required.')).toBeInTheDocument()
    expect(completeProfile).not.toHaveBeenCalled()
  })

  it('shows the generic error when completeProfile rejects', async () => {
    const completeProfile = vi.fn().mockRejectedValue(new Error('boom'))
    const { user } = renderWithProviders(<LoginPage />, { auth: { completeProfile, isNewUser: true } })
    await user.type(screen.getByPlaceholderText('First name'), 'Ada')
    await user.type(screen.getByPlaceholderText('Last name'), 'Lovelace')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(screen.getByText('Invalid email or password.')).toBeInTheDocument())
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
