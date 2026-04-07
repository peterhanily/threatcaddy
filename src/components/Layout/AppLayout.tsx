import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BgImageLayer } from './BgImageLayer';

interface AppLayoutProps {
  header: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
  bgImageEnabled?: boolean;
  bgImageOpacity?: number;
  bgImagePosX?: number;
  bgImagePosY?: number;
  bgImageZoom?: number;
  theme?: 'dark' | 'light';
}

export function AppLayout({ header, sidebar, children, bgImageEnabled, bgImageOpacity, bgImagePosX, bgImagePosY, bgImageZoom, theme }: AppLayoutProps) {
  const { t } = useTranslation('common');
  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded-lg focus:text-sm focus:font-medium"
      >
        {t('skipToMainContent')}
      </a>
      <BgImageLayer
        enabled={bgImageEnabled ?? false}
        opacity={bgImageOpacity ?? 85}
        posX={bgImagePosX ?? 50}
        posY={bgImagePosY ?? 50}
        zoom={bgImageZoom ?? 100}
        theme={theme ?? 'dark'}
      />
      {header}
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden md:block shrink-0">
          {sidebar}
        </div>
        <main id="main-content" className="flex flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
