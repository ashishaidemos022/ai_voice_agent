import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../ui/Card';

const BODY_FONT = "'Sora', 'Space Grotesk', sans-serif";
const DISPLAY_FONT = "'Orbitron', 'Sora', sans-serif";

type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';

export function AuthScreen() {
  const {
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
    sendPasswordReset,
    updatePassword
  } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const resetRedirectTo = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    return `${window.location.origin}/?recovery=1`;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    if (hash.includes('type=recovery') || search.includes('type=recovery') || search.includes('recovery=1')) {
      setMode('reset');
    }
  }, []);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setInfoMessage(null);
    if (nextMode !== 'reset') {
      setPassword('');
      setConfirmPassword('');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setInfoMessage(null);

    try {
      if (mode === 'signin') {
        await signInWithPassword(email, password);
      } else if (mode === 'signup') {
        await signUpWithPassword(email, password);
        setInfoMessage(`Verification email sent to ${email}. Please check your inbox to activate your account.`);
        setMode('signin');
      } else if (mode === 'forgot') {
        if (!resetRedirectTo) {
          throw new Error('Unable to generate password reset link.');
        }
        await sendPasswordReset(email, resetRedirectTo);
        setInfoMessage(`Password reset link sent to ${email}.`);
      } else if (mode === 'reset') {
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters.');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }
        await updatePassword(password);
        setInfoMessage('Password updated. You can now sign in with your new password.');
        setMode('signin');
        setPassword('');
        setConfirmPassword('');
        if (typeof window !== 'undefined') {
          window.history.replaceState({}, document.title, window.location.pathname);
          window.dispatchEvent(new PopStateEvent('popstate'));
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setIsSubmitting(true);
    setError(null);
    setInfoMessage(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed');
      setIsSubmitting(false);
    }
  };

  const showTabs = mode === 'signin' || mode === 'signup';
  const showOAuth = mode === 'signin' || mode === 'signup';

  return (
    <div
      className="min-h-screen bg-[#05070f] text-slate-100 relative overflow-hidden"
      style={{ fontFamily: BODY_FONT }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.12),_transparent_45%),radial-gradient(circle_at_20%_80%,_rgba(59,130,246,0.18),_transparent_50%)]" />
      <div className="absolute -top-40 left-1/2 h-72 w-[32rem] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] h-72 w-72 rounded-full bg-blue-500/10 blur-[120px]" />

      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="flex items-center justify-between px-6 lg:px-12 py-6 text-xs uppercase tracking-[0.3em] text-slate-400">
          <span className="text-slate-200 font-semibold">Viaana AI</span>
          <a
            href="mailto:contact@viaana.ai"
            className="text-slate-300 hover:text-cyan-200 transition-colors"
          >
            Contact Us
          </a>
        </header>

        <main className="flex-1 grid lg:grid-cols-[1.1fr_0.9fr] items-center gap-12 px-6 lg:px-12 pb-16">
          <section className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Agentic voice and chat builder</p>
            <h1
              className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-semibold text-cyan-200 drop-shadow-[0_0_30px_rgba(34,211,238,0.35)]"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              Intelligence in flow.<br />
              Outcomes in motion.
            </h1>
            <p className="mt-6 text-lg text-slate-300 leading-relaxed">
              Securely launch voice and chat agents, connect automation, and orchestrate real-time conversations with precision.
            </p>
            <div className="mt-10 flex items-center gap-4 text-sm text-slate-400">
              <span className="h-[2px] w-12 bg-cyan-400 shadow-[0_0_18px_rgba(34,211,238,0.65)]" />
              <span>Secure access portal</span>
            </div>
          </section>

          <section className="w-full max-w-md justify-self-center">
            <Card className="bg-slate-950/70 border border-slate-800/80 backdrop-blur-xl shadow-[0_20px_60px_rgba(8,12,24,0.75)] p-8">
              <div className="mb-6 text-center">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Secure voice agent portal</p>
                <h2 className="mt-3 text-lg text-slate-200" style={{ fontFamily: DISPLAY_FONT }}>
                  {mode === 'forgot'
                    ? 'Reset your password'
                    : mode === 'reset'
                      ? 'Create a new password'
                      : 'Access your workspace'}
                </h2>
              </div>

              {showTabs && (
                <div className="flex gap-2 bg-slate-900/80 rounded-full p-1 mb-6">
                  <button
                    className={`flex-1 py-2 rounded-full text-sm font-medium transition-all ${
                      mode === 'signin'
                        ? 'bg-slate-700 text-white shadow-[0_0_18px_rgba(59,130,246,0.35)]'
                        : 'text-slate-400'
                    }`}
                    onClick={() => switchMode('signin')}
                    disabled={isSubmitting}
                    type="button"
                  >
                    Sign In
                  </button>
                  <button
                    className={`flex-1 py-2 rounded-full text-sm font-medium transition-all ${
                      mode === 'signup'
                        ? 'bg-slate-700 text-white shadow-[0_0_18px_rgba(59,130,246,0.35)]'
                        : 'text-slate-400'
                    }`}
                    onClick={() => switchMode('signup')}
                    disabled={isSubmitting}
                    type="button"
                  >
                    Create Account
                  </button>
                </div>
              )}

              <form className="space-y-4" onSubmit={handleSubmit}>
                {mode !== 'reset' && (
                  <div>
                    <label className="text-sm text-slate-400">Email</label>
                    <input
                      type="email"
                      className="mt-1 w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      disabled={isSubmitting}
                    />
                  </div>
                )}

                {(mode === 'signin' || mode === 'signup' || mode === 'reset') && (
                  <div>
                    <label className="text-sm text-slate-400">Password</label>
                    <input
                      type="password"
                      className="mt-1 w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      disabled={isSubmitting}
                    />
                  </div>
                )}

                {mode === 'reset' && (
                  <div>
                    <label className="text-sm text-slate-400">Confirm password</label>
                    <input
                      type="password"
                      className="mt-1 w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      disabled={isSubmitting}
                    />
                  </div>
                )}

                {mode === 'signin' && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-xs text-cyan-300 hover:text-cyan-200"
                      disabled={isSubmitting}
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                {infoMessage && (
                  <p className="text-sm text-emerald-200 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                    {infoMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 rounded-lg bg-[#90E5E6] text-slate-950 font-semibold shadow-[0_12px_30px_rgba(144,229,230,0.35)] hover:brightness-105 disabled:opacity-60"
                >
                  {isSubmitting
                    ? 'Please wait...'
                    : mode === 'signin'
                      ? 'Sign In'
                      : mode === 'signup'
                        ? 'Create Account'
                        : mode === 'forgot'
                          ? 'Send reset link'
                          : 'Update password'}
                </button>
              </form>

              {mode === 'forgot' && (
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    className="text-xs text-slate-400 hover:text-slate-200"
                    onClick={() => switchMode('signin')}
                    disabled={isSubmitting}
                  >
                    Back to sign in
                  </button>
                </div>
              )}

              {showOAuth && (
                <div className="mt-6">
                  <button
                    onClick={handleGoogle}
                    disabled={isSubmitting}
                    className="w-full py-2.5 rounded-lg border border-slate-700 text-white hover:border-cyan-300/60 hover:text-cyan-100 disabled:opacity-60"
                  >
                    Continue with Google
                  </button>
                  <p className="mt-3 text-xs text-center text-slate-500">
                    By continuing you agree to the Terms and Privacy Policy.
                  </p>
                </div>
              )}
            </Card>
          </section>
        </main>
      </div>
    </div>
  );
}
