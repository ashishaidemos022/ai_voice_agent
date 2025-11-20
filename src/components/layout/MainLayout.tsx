import { ReactNode } from 'react';

interface MainLayoutProps {
  sidebar: ReactNode;
  topBar: ReactNode;
  children: ReactNode;
}

export function MainLayout({ sidebar, topBar, children }: MainLayoutProps) {
  return (
    <div className="h-screen flex overflow-hidden bg-background">
      {sidebar}
      <div className="flex-1 flex flex-col overflow-hidden">
        {topBar}
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
