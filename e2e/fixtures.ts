import { type Page, expect } from '@playwright/test';

/**
 * Dismiss any first-time modals/overlays that may appear on fresh load.
 * The app may show a demo welcome modal or CaddyAI onboarding overlay.
 */
export async function dismissInitialOverlays(page: Page) {
  // Wait for the app to finish loading
  await page.waitForSelector('[data-tour="header"]', { timeout: 15_000 });

  // Dismiss demo welcome modal if present (e.g. if ?demo=1 query param leaked)
  const demoModal = page.getByRole('button', { name: /close|dismiss|got it/i });
  if (await demoModal.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await demoModal.click();
  }
}

/**
 * Navigate to the app and wait for it to be ready.
 * Clears IndexedDB before the app's JS loads to ensure a clean state.
 * Since ThreatCaddy is a local-first SPA with no auth required for local use,
 * we simply navigate to the base URL.
 */
export async function goToApp(page: Page) {
  await page.goto('/');
  await dismissInitialOverlays(page);
}

/**
 * Create a new investigation (folder) via the sidebar.
 * Returns the name used.
 */
export async function createInvestigation(page: Page, name: string) {
  // Ensure sidebar is expanded (look for the "Investigations" header text)
  const sidebar = page.locator('aside[role="navigation"]');
  await expect(sidebar).toBeVisible();

  // Click the "New" button in the sidebar to open the investigation name input
  const newButton = sidebar.getByRole('button', { name: /^New$/ });
  await newButton.click();

  // Type the investigation name into the input
  const nameInput = sidebar.getByPlaceholder('Investigation name');
  await nameInput.fill(name);
  await nameInput.press('Enter');

  // Wait for the investigation to appear in the sidebar
  await expect(sidebar.getByText(name)).toBeVisible({ timeout: 5_000 });
}

/**
 * Select an investigation by clicking it in the sidebar.
 */
export async function selectInvestigation(page: Page, name: string) {
  const sidebar = page.locator('aside[role="navigation"]');
  await sidebar.getByText(name).click();
}

/**
 * Create a new note via the header "New" dropdown.
 * Uses "Quick Note" which creates a note immediately.
 */
export async function createQuickNote(page: Page) {
  // Click the "New" dropdown button in the header
  const header = page.locator('header[data-tour="header"]');
  const newDropdown = header.getByRole('button', { name: 'Create new' });
  await newDropdown.click();

  // Click "Quick Note" in the dropdown
  await page.getByText('Quick Note').click();
}

/**
 * Create a new task via the header "New" dropdown.
 */
export async function openNewTaskForm(page: Page) {
  const header = page.locator('header[data-tour="header"]');
  const newDropdown = header.getByRole('button', { name: 'Create new' });
  await newDropdown.click();
  await page.getByText('Task', { exact: true }).click();
}

/**
 * Navigate to a specific view tab via the sidebar.
 */
export async function navigateToView(
  page: Page,
  view: 'Dashboard' | 'Notes' | 'Tasks' | 'Timeline' | 'Whiteboards' | 'IOCs' | 'Graph' | 'Activity' | 'CaddyShack' | 'CaddyAI',
) {
  const sidebar = page.locator('aside[role="navigation"] nav[aria-label="Views"]');
  await sidebar.getByText(view, { exact: true }).click();
}

/**
 * Open the search overlay via the header search bar.
 */
export async function openSearch(page: Page) {
  const searchButton = page.locator('header[data-tour="header"] button[data-tour="search"]');
  await searchButton.click();
  // Wait for the search overlay to appear
  await page.waitForSelector('input[type="text"]', { timeout: 3_000 });
}
