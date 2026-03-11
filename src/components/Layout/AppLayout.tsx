import type { ReactNode } from 'react';
import { BgImageLayer } from './BgImageLayer';

interface AppLayoutProps {
  header: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
  bgImageEnabled?: boolean;
  bgImageOpacity?: number;
  theme?: 'dark' | 'light';
}

export function AppLayout({ header, sidebar, children, bgImageEnabled, bgImageOpacity, theme }: AppLayoutProps) {
  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      <BgImageLayer
        enabled={bgImageEnabled ?? false}
        opacity={bgImageOpacity ?? 85}
        theme={theme ?? 'dark'}
      />
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
