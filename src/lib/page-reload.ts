/** Reloads the page. A module of its own so tests can observe when it happens. */
export function reloadPage(): void {
  window.location.reload();
}
