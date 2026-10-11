// Shared extension-page presentation only. No storage, permissions or requests.
globalThis.TC_UI = (() => {
  function t(key, substitutions = []) {
    return chrome.i18n.getMessage(key, substitutions.map(String)) || key;
  }

  function localize() {
    const language = (chrome.i18n.getUILanguage?.() || 'en').replaceAll('_', '-');
    document.documentElement.lang = language;
    const direction = chrome.i18n.getMessage('@@bidi_dir');
    document.documentElement.dir = direction === 'rtl' || /^(ar|fa|he|ur)(-|$)/i.test(language) ? 'rtl' : 'ltr';
    for (const [attribute, destination] of [
      ['data-i18n', null], ['data-i18n-placeholder', 'placeholder'],
      ['data-i18n-title', 'title'], ['data-i18n-label', 'aria-label'],
    ]) {
      document.querySelectorAll(`[${attribute}]`).forEach(element => {
        const message = chrome.i18n.getMessage(element.getAttribute(attribute));
        if (!message) return;
        if (destination) element.setAttribute(destination, message);
        else element.textContent = message;
      });
    }
  }

  function confirmation({ overlay, title, message, cancel, confirm, fallback }) {
    let pending = null;
    let opener = null;
    let background = [];
    let previousOverflow = '';
    const dialog = overlay.querySelector('[role="dialog"]');

    function close(result) {
      if (!pending) return;
      const resolve = pending;
      pending = null;
      overlay.classList.add('hidden');
      for (const [element, inert, ariaHidden] of background) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      }
      background = [];
      document.body.style.overflow = previousOverflow;
      const destination = opener?.isConnected && !opener.disabled ? opener : fallback;
      destination?.focus();
      resolve(result);
    }

    cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(false); });
    document.addEventListener('keydown', event => {
      if (!pending) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(false); }
      if (event.key === 'Tab') {
        const controls = [cancel, confirm].filter(element => !element.disabled);
        const current = controls.indexOf(document.activeElement);
        event.preventDefault();
        controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }
    });
    document.addEventListener('focusin', event => {
      if (pending && !dialog.contains(event.target)) cancel.focus();
    });

    return function show(nextTitle, nextMessage, confirmLabel, danger = false) {
      // A second action cannot replace the first confirmation's captured scope.
      if (pending) return Promise.resolve(false);
      title.textContent = nextTitle;
      message.textContent = nextMessage;
      confirm.textContent = confirmLabel || t('confirm');
      confirm.className = danger ? 'btn btn-danger' : 'btn btn-primary';
      opener = document.activeElement;
      background = [...document.body.children].filter(element => element !== overlay && element.tagName !== 'SCRIPT')
        .map(element => [element, element.inert === true, element.getAttribute('aria-hidden')]);
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      overlay.classList.remove('hidden');
      const result = new Promise(resolve => { pending = resolve; });
      // Move focus before hiding the opener's ancestor from assistive technology.
      (danger ? cancel : confirm).focus();
      for (const [element] of background) { element.inert = true; element.setAttribute('aria-hidden', 'true'); }
      return result;
    };
  }
  return { t, localize, confirmation };
})();
