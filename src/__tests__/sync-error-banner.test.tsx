import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SyncErrorBanner } from '../components/Common/SyncErrorBanner';
import { AppLayout } from '../components/Layout/AppLayout';

const ui = vi.hoisted(() => ({ screenshareMaxLevel: null as string | null, openSettings: vi.fn(), setForceAnalystMode: vi.fn(), setMobileSidebarOpen: vi.fn() }));
vi.mock('../contexts/UIModalContext', () => ({ useUIModals: () => ui }));
vi.mock('../components/Layout/BgImageLayer', () => ({ BgImageLayer: () => null }));
beforeEach(() => { vi.clearAllMocks(); ui.screenshareMaxLevel = null; });
afterEach(cleanup);

describe('sync recovery warning', () => {
  it('reserves layout space between the header and workspace instead of covering controls', () => {
    render(<AppLayout header={<header>Header</header>} sidebar={<button>Settings</button>}
      notice={<SyncErrorBanner error="Synthetic retained-history warning" />}><div>Workspace</div></AppLayout>);
    const banner = screen.getByRole('alert');
    expect(screen.getByRole('banner').nextElementSibling).toBe(banner);
    expect(banner.className).not.toContain('fixed');
    expect(banner.nextElementSibling).toContainElement(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Synthetic retained-history warning')).toHaveClass('overflow-y-auto');
  });

  it('opens General settings in analyst mode without replacing the current investigation', () => {
    render(<SyncErrorBanner error="Synthetic warning" />);
    fireEvent.click(screen.getByRole('button', { name: 'Review sync settings' }));
    expect(ui.openSettings).toHaveBeenCalledExactlyOnceWith('general');
    expect(ui.setForceAnalystMode).toHaveBeenCalledExactlyOnceWith(true);
    expect(ui.setMobileSidebarOpen).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('does not expose raw error details or a settings action during screensharing', () => {
    ui.screenshareMaxLevel = 'TLP:CLEAR';
    const { container } = render(<SyncErrorBanner error="Sensitive synthetic investigation label" />);
    expect(container.innerHTML).not.toContain('Sensitive synthetic investigation label');
    expect(screen.getByRole('alert')).toHaveTextContent('Turn off screensharing to review the details.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(ui.openSettings).not.toHaveBeenCalled();
  });
});
