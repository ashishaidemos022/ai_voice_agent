import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../ui/Card';

export function AuthScreen() {
  const { signInWithPassword, signUpWithPassword, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      if (mode === 'signin') {
        await signInWithPassword(email, password);
      } else {
        await signUpWithPassword(email, password);
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
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <Card className="w-full max-w-md p-8 bg-slate-900 border border-slate-800">
        <div className="mb-6 text-center">
          <p className="text-sm text-slate-400">Secure Voice Agent Portal</p>
        </div>

        <div className="flex gap-2 bg-slate-800 rounded-lg p-1 mb-6">
          <button
            className={`flex-1 py-2 rounded-md text-sm font-medium ${
              mode === 'signin' ? 'bg-slate-700 text-white' : 'text-slate-400'
            }`}
            onClick={() => setMode('signin')}
            disabled={isSubmitting}
          >
            Sign In
          </button>
          <button
            className={`flex-1 py-2 rounded-md text-sm font-medium ${
              mode === 'signup' ? 'bg-slate-700 text-white' : 'text-slate-400'
            }`}
            onClick={() => setMode('signup')}
            disabled={isSubmitting}
          >
            Create Account
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="text-sm text-slate-400">Email</label>
            <input
              type="email"
              className="mt-1 w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-white"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="text-sm text-slate-400">Password</label>
            <input
              type="password"
              className="mt-1 w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-white"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-60"
          >
            {isSubmitting ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="mt-6">
          <button
            onClick={handleGoogle}
            disabled={isSubmitting}
            className="w-full py-2 rounded-md border border-slate-700 text-white hover:border-slate-500 disabled:opacity-60"
          >
            Continue with Google
          </button>
          <p className="mt-3 text-xs text-center text-slate-500">
            By continuing you agree to the Terms and Privacy Policy.
          </p>
        </div>
      </Card>
    </div>
  );
}
