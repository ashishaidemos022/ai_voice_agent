export function LoadingScreen({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white space-y-4">
      <div className="w-12 h-12 border-4 border-slate-800 border-t-blue-500 rounded-full animate-spin" />
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}
