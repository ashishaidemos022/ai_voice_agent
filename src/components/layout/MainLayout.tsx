import { ReactNode } from 'react';

interface MainLayoutProps {
  sidebar: ReactNode;
  topBar: ReactNode;
  children: ReactNode;
}

export function MainLayout({ sidebar, topBar, children }: MainLayoutProps) {
  return (
    <div className="h-screen flex overflow-hidden bg-[#05070f] text-slate-100 relative">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.08),_transparent_45%),radial-gradient(circle_at_20%_80%,_rgba(59,130,246,0.12),_transparent_55%)]" />
      <div className="relative z-10 flex w-full overflow-hidden">
        {sidebar}
        <div className="flex-1 flex flex-col overflow-hidden">
          {topBar}
          <main className="flex-1 overflow-hidden">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
