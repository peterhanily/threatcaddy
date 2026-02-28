import type { ReactNode } from 'react';

interface AppLayoutProps {
  header: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
}

export function AppLayout({ header, sidebar, children }: AppLayoutProps) {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {header}
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden md:block shrink-0">
          {sidebar}
        </div>
        {children}
      </div>
    </div>
  );
}
