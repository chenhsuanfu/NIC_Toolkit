/**
 * Unified Navigation Context Stack & Non-Blocking Two-Step Confirm Helpers
 * Shared across Shell (index.html) and all modular tools.
 */

export class NavHistory {
  constructor({ maxDepth = 30 } = {}) {
    this.maxDepth = Math.max(1, Number(maxDepth) || 30);
    this.stack = [];
  }

  _serializeState(state) {
    try {
      return JSON.stringify(state ?? null);
    } catch (_) {
      return '';
    }
  }

  push(entry) {
    if (!entry || !entry.toolId) return false;
    const normalized = {
      toolId: String(entry.toolId),
      label: String(entry.label || entry.toolId),
      viewState: entry.viewState ?? null,
      scrollY: Number.isFinite(Number(entry.scrollY)) ? Math.max(0, Math.round(Number(entry.scrollY))) : 0,
      ts: Date.now()
    };

    const top = this.peek();
    if (
      top &&
      top.toolId === normalized.toolId &&
      this._serializeState(top.viewState) === this._serializeState(normalized.viewState)
    ) {
      top.scrollY = normalized.scrollY;
      top.label = normalized.label;
      top.ts = normalized.ts;
      return false;
    }

    this.stack.push(normalized);
    if (this.stack.length > this.maxDepth) {
      this.stack.shift();
    }
    return true;
  }

  pop() {
    return this.stack.pop() || null;
  }

  peek() {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
  }

  canGoBack() {
    return this.stack.length > 0;
  }

  size() {
    return this.stack.length;
  }

  clear() {
    this.stack.length = 0;
  }
}

/**
 * Non-blocking inline two-step confirmation for destructive / disruptive actions.
 * First click turns the button into red confirmation state for `timeoutMs` (default 3000ms).
 * Second click within the window executes `onConfirm`.
 */
export function bindTwoStepConfirm(el, {
  confirmText = '再點一次確認',
  timeoutMs = 3000,
  onConfirm
} = {}) {
  if (!el || typeof onConfirm !== 'function') return;
  let armed = false;
  let timer = null;
  let originalHtml = '';

  const disarm = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!armed) return;
    armed = false;
    el.classList.remove('btn-danger-confirm');
    el.removeAttribute('data-confirm-armed');
    if (originalHtml) el.innerHTML = originalHtml;
  };

  el.addEventListener('click', (e) => {
    if (!armed) {
      e.preventDefault();
      e.stopPropagation();
      originalHtml = el.innerHTML;
      armed = true;
      el.classList.add('btn-danger-confirm');
      el.setAttribute('data-confirm-armed', '1');
      el.textContent = confirmText;
      timer = setTimeout(disarm, timeoutMs);
      return;
    }
    disarm();
    onConfirm(e);
  });
}
