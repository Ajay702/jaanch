// Reads the current page: visible interactive elements (tagged with data-jaanch-id so we
// can act on them) plus page-level checks such as broken images and unlabeled inputs.

export async function snapshot(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const labelOf = (el) => {
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) return l.innerText.trim();
      }
      const wrap = el.closest('label');
      return wrap ? wrap.innerText.trim() : '';
    };
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 80);

    document.querySelectorAll('[data-jaanch-id]').forEach((el) => el.removeAttribute('data-jaanch-id'));
    const selector = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [onclick]';
    const elements = [];
    let n = 0;
    for (const el of document.querySelectorAll(selector)) {
      if (!visible(el) || el.disabled) continue;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const id = `e${n++}`;
      el.setAttribute('data-jaanch-id', id);
      const label = labelOf(el);
      elements.push({
        id,
        tag,
        type,
        role: el.getAttribute('role') || '',
        text: clean(tag === 'input' ? el.value && ['submit', 'button'].includes(type) ? el.value : '' : el.innerText),
        label: clean(label),
        name: el.getAttribute('name') || '',
        domId: el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
        href: tag === 'a' ? el.href : undefined,
        target: el.getAttribute('target') || '',
        formKey: el.form ? el.form.id || el.form.getAttribute('action') || `form${[...document.forms].indexOf(el.form)}` : '',
        value: ['input', 'textarea'].includes(tag) && !['submit', 'button', 'checkbox', 'radio'].includes(type) ? el.value : undefined,
        required: !!el.required,
      });
      if (elements.length >= 80) break;
    }

    const findings = [];
    for (const img of document.images) {
      const src = img.currentSrc || img.src;
      if (!img.getAttribute('alt') && img.getAttribute('alt') !== '') {
        findings.push({ kind: 'a11y', message: `Image has no alt text: ${src.split('/').pop()}` });
      }
    }
    for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select')) {
      if (!visible(el)) continue;
      if (!labelOf(el) && !el.getAttribute('title')) {
        const what = el.getAttribute('name') || el.getAttribute('placeholder') || el.getAttribute('type') || el.tagName.toLowerCase();
        findings.push({ kind: 'a11y', message: `Form field "${what}" has no label (screen readers can't announce it)` });
      }
    }
    for (const b of document.querySelectorAll('button, [role=button]')) {
      if (visible(b) && !clean(b.innerText) && !b.getAttribute('aria-label') && !b.getAttribute('title')) {
        findings.push({ kind: 'a11y', message: 'Button has no text or aria-label' });
      }
    }
    if (!document.title.trim()) findings.push({ kind: 'a11y', message: 'Page has no <title>' });

    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || '').replace(document.getElementById('__jaanch_hud')?.innerText || '\u0000', '').replace(/\s+/g, ' ').trim().slice(0, 1200),
      elements,
      findings,
    };
  });
}

/** Short human description of an element, used in logs, prompts and reports. */
export function describe(el) {
  const name = el.text || el.label || el.placeholder || el.name || el.domId || el.href || el.tag;
  if (el.tag === 'a') return `link "${name}"`;
  if (el.tag === 'button' || ['submit', 'button'].includes(el.type) || el.role === 'button') return `button "${name}"`;
  if (el.tag === 'select') return `dropdown "${name}"`;
  return `${el.type || el.tag} field "${name}"`;
}

/** A stable Playwright locator expression for generated tests (not the per-run data-jaanch-id). */
export function locatorFor(el) {
  const q = (s) => JSON.stringify(s);
  if (el.domId && /^[A-Za-z][\w-]*$/.test(el.domId)) return `page.locator(${q('#' + el.domId)})`;
  if (el.name && ['input', 'textarea', 'select'].includes(el.tag) && !['submit', 'button'].includes(el.type)) {
    return `page.locator(${q(`${el.tag}[name="${el.name}"]`)})`;
  }
  if (el.tag === 'a' && el.text) return `page.getByRole('link', { name: ${q(el.text)} }).first()`;
  if ((el.tag === 'button' || ['submit', 'button'].includes(el.type) || el.role === 'button') && (el.text || el.label)) {
    return `page.getByRole('button', { name: ${q(el.text || el.label)} }).first()`;
  }
  if (el.label) return `page.getByLabel(${q(el.label)}).first()`;
  if (el.placeholder) return `page.getByPlaceholder(${q(el.placeholder)}).first()`;
  if (el.tag === 'a' && el.href) return `page.locator(${q(`a[href="${new URL(el.href).pathname}"]`)}).first()`;
  return null;
}
