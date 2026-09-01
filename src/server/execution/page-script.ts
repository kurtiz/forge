/**
 * Page-side observation script.
 *
 * Runs inside the target page through `Runtime.evaluate`. It tags interactive
 * elements with a stable `data-forge-ref` and returns the same compact shape
 * the fetch executor produces, so the agent sees one page model regardless of
 * which executor is running.
 *
 * Written as a string because it is evaluated in the page's realm, not the
 * Worker's. It is deliberately defensive: the page is untrusted, and anything
 * it does to the DOM must not be able to break the run.
 */
export const OBSERVE_SCRIPT = `(() => {
  const MAX_ELEMENTS = 60;
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const label = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      const target = document.getElementById(labelled);
      if (target && target.textContent) return target.textContent.trim();
    }
    if (el.id) {
      const forLabel = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (forLabel && forLabel.textContent) return forLabel.textContent.trim();
    }
    const text = (el.innerText || el.textContent || '').trim();
    if (text) return text;
    return (el.getAttribute('placeholder') || el.getAttribute('name') || el.value || '').trim();
  };

  let counter = 0;
  const elements = [];
  const selector = 'a[href], button, input, textarea, select, [role="button"], [role="link"]';

  for (const el of document.querySelectorAll(selector)) {
    if (elements.length >= MAX_ELEMENTS) break;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden') continue;
    if (el.disabled) continue;
    if (!visible(el)) continue;

    const ref = 'e' + (++counter);
    el.setAttribute('data-forge-ref', ref);

    const tag = el.tagName.toLowerCase();
    let role = 'button';
    if (tag === 'a' || el.getAttribute('role') === 'link') role = 'link';
    else if (tag === 'select') role = 'select';
    else if (tag === 'textarea') role = 'textarea';
    else if (tag === 'input' && type !== 'submit' && type !== 'button') role = 'input';

    elements.push({
      ref: ref,
      role: role,
      name: (label(el) || role).slice(0, 120),
      href: tag === 'a' ? (el.href || undefined) : undefined,
      inputType: type || undefined,
      required: el.hasAttribute('required') || undefined,
    });
  }

  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter(visible)
    .slice(0, 12)
    .map((h) => (h.innerText || h.textContent || '').trim())
    .filter(Boolean);

  const bodyText = (document.body ? document.body.innerText || '' : '')
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, 1400);

  return JSON.stringify({
    url: location.href,
    title: document.title || '',
    headings: headings,
    elements: elements,
    text: bodyText,
  });
})()`

/** Activates a previously tagged element. Returns a short outcome string. */
export function clickScript(ref: string): string {
  return `(() => {
    const el = document.querySelector('[data-forge-ref="${ref}"]');
    if (!el) return 'missing';
    el.scrollIntoView({ block: 'center' });
    el.click();
    return 'clicked';
  })()`
}

/** Fills an input and fires the events frameworks listen for. */
export function fillScript(ref: string, value: string): string {
  const encoded = JSON.stringify(value)
  return `(() => {
    const el = document.querySelector('[data-forge-ref="${ref}"]');
    if (!el) return 'missing';
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    );
    if (setter && setter.set) setter.set.call(el, ${encoded});
    else el.value = ${encoded};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'filled';
  })()`
}

/** Submits the form owning the element, or the first form on the page. */
export function submitScript(ref: string): string {
  return `(() => {
    const el = document.querySelector('[data-forge-ref="${ref}"]');
    const form = (el && el.closest('form')) || document.querySelector('form');
    if (!form) return 'missing';
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
    return 'submitted';
  })()`
}
