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
 * Each Playwright test gets a fresh browser context, so no need to clear storage.
 */
export async function goToApp(page: Page) {
  await page.goto('/');
  await dismissInitialOverlays(page);
}

/**
 * Create a new investigation via the Investigations hub.
 * Navigates to Investigations view, clicks "New Investigation", fills in the modal.
 */
export async function createInvestigation(page: Page, name: string) {
  // Navigate to Investigations view
  await navigateToView(page, 'Investigations');

  // Click "New Investigation" button in the hub
  const newButton = page.getByRole('button', { name: /New Investigation/i });
  await newButton.click();

  // Fill in the investigation name in the modal
  const nameInput = page.getByPlaceholder('e.g. Operation Midnight Storm');
  await expect(nameInput).toBeVisible({ timeout: 5_000 });
  await nameInput.fill(name);

  // Click "Create Investigation" in the modal (scoped to the dialog to avoid strict mode violation)
  const modal = page.getByLabel('New Investigation');
  const createButton = modal.getByRole('button', { name: /Create Investigation/i });
  await createButton.click();

  // Wait for the investigation to load (the app navigates into it)
  await page.waitForTimeout(1_000);
}

/**
 * Select an investigation by navigating to the Investigations hub and clicking it.
 */
export async function selectInvestigation(page: Page, name: string) {
  await navigateToView(page, 'Investigations');
  await page.getByText(name).first().click();
}

/**
 * Create a new note via the header "New" dropdown.
 * Uses "Quick Note" which creates a note immediately.
 */
export async function createQuickNote(page: Page) {
  // Click the "New" dropdown button in the header (aria-label is "Create new...")
  const header = page.locator('header[data-tour="header"]');
  const newDropdown = header.getByRole('button', { name: /Create new/i });
  await newDropdown.click();

  // Click "Quick Note" in the dropdown menu
  await page.getByRole('menuitem', { name: /Quick Note/i }).click();
}

/**
 * Create a new task via the header "New" dropdown.
 */
export async function openNewTaskForm(page: Page) {
  const header = page.locator('header[data-tour="header"]');
  const newDropdown = header.getByRole('button', { name: /Create new/i });
  await newDropdown.click();
  await page.getByRole('menuitem', { name: /Task/i }).click();
}

/**
 * Navigate to a specific view tab via the sidebar.
 * The sidebar nav items use role="button" with text labels.
 */
export async function navigateToView(
  page: Page,
  view: 'Dashboard' | 'Investigations' | 'Notes' | 'Tasks' | 'Timeline' | 'Whiteboards' | 'IOCs' | 'Graph' | 'Activity' | 'Team Feed' | 'CaddyAI' | 'AgentCaddy',
) {
  const viewsNav = page.locator('nav[aria-label="Views"]');
  await viewsNav.getByRole('button', { name: view }).click();
}

/**
 * Open the search overlay via the header search bar.
 */
export async function openSearch(page: Page) {
  const searchButton = page.locator('[data-tour="search"]');
  await searchButton.click();
  // Wait for the search overlay to appear
  await page.waitForSelector('input[type="text"]', { timeout: 3_000 });
}

/**
 * Get a locator for the sidebar navigation.
 */
export function getSidebar(page: Page) {
  return page.locator('nav[aria-label="Main navigation"]');
}
