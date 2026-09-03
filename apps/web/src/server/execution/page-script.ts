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
  /*
   * The cap exists so a page cannot flood the observation, and 60 was too low
   * for a real application: one date picker renders a grid of day buttons, and
   * a form's submit control sits after them in document order, so the page was
   * truncated before the button that matters. Form controls are also kept
   * ahead of links when trimming, because a journey is driven by the former
   * and only navigates with the latter.
   */
  const MAX_ELEMENTS = 160;
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

  /*
   * Old tags are cleared before new ones are handed out.
   *
   * Refs are assigned in document order on every observation, so the same
   * name means different elements on different reads - and an element that
   * has since been hidden keeps whatever tag it was given last. Leaving those
   * behind means a ref can resolve to an element from a previous observation
   * that happens to sit earlier in the document: after a date popover closes,
   * "e12" was still on one of its hidden day cells, and the click meant for a
   * checkbox went there instead, silently.
   */
  for (const tagged of document.querySelectorAll('[data-forge-ref]')) {
    tagged.removeAttribute('data-forge-ref');
  }

  let counter = 0;
  const collected = [];
  /*
   * Buttons and inputs are not the whole vocabulary of a form.
   *
   * A popover listbox renders its choices as [role=option], a consent control
   * is often [role=checkbox] on a button, and a date grid renders day cells as
   * buttons inside [role=gridcell]. Collecting only the tag-based controls is
   * how an open date picker looks, to the agent, like a page with nothing on
   * it - and how a journey concludes there was no way to complete the form.
   */
  const selector = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="option"]', '[role="menuitem"]',
    '[role="menuitemradio"]', '[role="menuitemcheckbox"]', '[role="checkbox"]',
    '[role="switch"]', '[role="radio"]', '[role="tab"]'
  ].join(', ');

  for (const el of document.querySelectorAll(selector)) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden') continue;
    if (!visible(el)) continue;

    const ref = 'e' + (++counter);
    el.setAttribute('data-forge-ref', ref);

    const tag = el.tagName.toLowerCase();
    const aria = (el.getAttribute('role') || '').toLowerCase();
    const ticks = type === 'checkbox' || type === 'radio' ||
      aria === 'checkbox' || aria === 'switch' || aria === 'radio' ||
      aria === 'menuitemradio' || aria === 'menuitemcheckbox';

    let role = 'button';
    if (tag === 'a' || aria === 'link') role = 'link';
    else if (tag === 'select') role = 'select';
    else if (tag === 'textarea') role = 'textarea';
    else if (ticks) role = 'checkbox';
    else if (aria === 'option' || aria === 'menuitem') role = 'option';
    else if (tag === 'input' && type !== 'submit' && type !== 'button') role = 'input';

    const entry = {
      ref: ref,
      role: role,
      name: (label(el) || role).slice(0, 120),
      href: tag === 'a' ? (el.href || undefined) : undefined,
      inputType: type || undefined,
      required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true' || undefined,
      /*
       * Reported rather than dropped. A submit button that stays disabled
       * until the form validates used to vanish from the page model entirely,
       * so a run could fill a form and conclude the application offered no way
       * to submit it - when what it offered was a button it would not enable.
       */
      disabled: (el.disabled || el.getAttribute('aria-disabled') === 'true') || undefined,
      /*
       * aria-current marks today on a calendar. A journey that has to choose a
       * date usually wants one that has not happened yet, and this is the only
       * thing on the grid that says which cell that is.
       */
      current: (el.hasAttribute('aria-current') && el.getAttribute('aria-current') !== 'false') || undefined,
    };

    if (ticks) {
      entry.checked = el.checked === true || el.getAttribute('aria-checked') === 'true';
    } else if (role === 'input' || role === 'textarea' || role === 'select') {
      /*
       * The current value, so a fill can be checked rather than assumed. A
       * date input given something it cannot parse keeps an empty value and
       * reports no error at all, which is exactly the case that used to pass
       * silently.
       *
       * A password is reported as full or empty and never as itself. The
       * authenticator types a real credential into one of these, and an
       * observation is written to evidence; redaction downstream is a backstop
       * for what leaks, not a licence to collect it here.
       */
      const raw = typeof el.value === 'string' ? el.value : '';
      entry.value = type === 'password' ? (raw ? '\u2022\u2022\u2022' : '') : raw.slice(0, 120);
    }

    if (tag === 'select') {
      entry.options = Array.from(el.options || [])
        .slice(0, 40)
        .map((o) => (o.label || o.textContent || o.value || '').trim())
        .filter(Boolean);
    }

    collected.push(entry);
  }

  const controls = collected.filter((e) => e.role !== 'link');
  const links = collected.filter((e) => e.role === 'link');
  const elements = controls.concat(links).slice(0, MAX_ELEMENTS);

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

/**
 * Activates a previously tagged element.
 *
 * `el.click()` alone was not enough. It dispatches a click and nothing else,
 * and a good deal of the component vocabulary this agent meets opens on the
 * pointer events before it: a Radix select or dropdown opens on `pointerdown`
 * and ignores the click entirely, so a trigger the agent pressed simply never
 * opened and the page looked, correctly, unchanged. The sequence below is the
 * one a real pointer produces, in the order it produces it, with the click
 * itself left to `el.click()` so the element's own activation behaviour - a
 * submit button submitting its form - still runs exactly once.
 */
const ACTIVATE_FN = `
  const activate = (el) => {
    el.scrollIntoView({ block: 'center' });
    const shared = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1 };
    const pointer = (type, extra) => {
      try {
        const Ctor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ctor(type, Object.assign({ pointerId: 1, isPrimary: true, pointerType: 'mouse' }, shared, extra)));
      } catch (error) {
        /* A page that replaces the event constructors must not stop the run. */
      }
    };
    pointer('pointerover');
    pointer('pointerdown');
    el.dispatchEvent(new MouseEvent('mousedown', shared));
    if (typeof el.focus === 'function') el.focus();
    pointer('pointerup', { buttons: 0 });
    el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, shared, { buttons: 0 })));
    el.click();
  };
`

export function clickScript(ref: string): string {
  return `(() => {
    const el = document.querySelector('[data-forge-ref="${ref}"]');
    if (!el) return 'missing';
    ${ACTIVATE_FN}
    activate(el);
    return 'clicked';
  })()`
}

/**
 * Fills an input and fires the events frameworks listen for.
 *
 * Returns the value the field actually holds afterwards. The caller compares:
 * a field that kept nothing did not accept what it was given, and saying so is
 * the difference between a journey that reports what it did and one that
 * reports what it meant to do.
 */
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
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    // Reported as full or empty for a password, for the reason the observation
    // script gives: the caller only needs to know the field kept something.
    const kept = typeof el.value === 'string' ? el.value : '';
    if ((el.type || '').toLowerCase() === 'password') return kept ? 'filled:set' : 'filled:';
    return 'filled:' + kept;
  })()`
}

/**
 * Chooses an option in a native `select`, by label or by value.
 *
 * Matching on the label matters more than it looks: the agent sees option
 * text, not option values, so "Blood test" has to find the option whose value
 * is `bt_04`. Returns the value the element settled on, for the same reason
 * `fillScript` does.
 */
export function selectScript(ref: string, value: string): string {
  const encoded = JSON.stringify(value)
  return `(() => {
    const el = document.querySelector('[data-forge-ref="${ref}"]');
    if (!el || !el.options) return 'missing';
    const wanted = ${encoded}.trim().toLowerCase();
    const options = Array.from(el.options);
    const match = options.find((o) => (o.label || o.textContent || '').trim().toLowerCase() === wanted)
      || options.find((o) => (o.value || '').trim().toLowerCase() === wanted)
      || options.find((o) => (o.label || o.textContent || '').trim().toLowerCase().includes(wanted));
    if (!match) return 'unmatched';
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(el, match.value);
    else el.value = match.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'filled:' + ((match.label || match.textContent || match.value || '').trim());
  })()`
}

/**
 * Turns a checkbox, radio or switch on.
 *
 * Native inputs are clicked rather than assigned, so the framework listening
 * for the change hears it. A control that is already on is left alone: this is
 * the one action in the set where doing it twice undoes it.
 */
export function checkScript(ref: string): string {
  return `(() => {
    const el = document.querySelector('[data-forge-ref="${ref}"]');
    if (!el) return 'missing';
    const on = el.checked === true || el.getAttribute('aria-checked') === 'true';
    if (on) return 'filled:already on';
    el.scrollIntoView({ block: 'center' });
    el.click();
    const now = el.checked === true || el.getAttribute('aria-checked') === 'true';
    return now ? 'filled:on' : 'unchanged';
  })()`
}

/**
 * Submits the form owning the element, or the first form on the page.
 *
 * `requestSubmit` rather than `submit`, because it runs the browser's own
 * constraint validation: a form the application would have refused is refused
 * here too, instead of being posted behind the application's back.
 *
 * A button that belongs to no form falls back to being pressed. A good number
 * of applications wire their submit to an onClick handler and never render a
 * form at all, and answering those with "there is nothing to submit" reported
 * a defect where there was only a different way of building a page. What it
 * must not do is reach for some other form on the page, which is how a journey
 * comes to submit the search box in the header.
 */
export function submitScript(ref: string): string {
  return `(() => {
    const el = document.querySelector('[data-forge-ref="${ref}"]');
    if (!el) return 'missing';
    // el.form first: it is how a control declares the form it belongs to when
    // it is rendered outside it.
    const form = el.form || el.closest('form');
    if (!form) {
      ${ACTIVATE_FN}
      activate(el);
      return 'submitted';
    }
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
    return 'submitted';
  })()`
}
