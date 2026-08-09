const nextPattern = /\bnext(?:\s+page)?\b/i;
const nextSymbolPattern = /^(?:>|›|→)$/;

function labelFor(element) {
  return [element.ariaLabel, element.title, element.text].filter(Boolean).join(" ").trim();
}

export function isNextControl(element) {
  if (!element || element.visible === false || element.disabled || element.ariaDisabled === "true") return false;
  const label = labelFor(element);
  return nextPattern.test(label) || nextSymbolPattern.test(label);
}

export function chooseNextControl(elements = []) {
  return elements
    .filter(isNextControl)
    .sort((left, right) => {
      const leftLabel = left.ariaLabel || left.title || left.text || "";
      const rightLabel = right.ariaLabel || right.title || right.text || "";
      const leftScore = /^next(?:\s+page)?$/i.test(leftLabel) ? 3 : left.ariaLabel ? 2 : 1;
      const rightScore = /^next(?:\s+page)?$/i.test(rightLabel) ? 3 : right.ariaLabel ? 2 : 1;
      return rightScore - leftScore;
    })[0] || null;
}

export function shouldStopAfterResponse({ control, newRecords, page, maxPages, maxRecords, records, error }) {
  return Boolean(error) || !control || control.disabled || control.ariaDisabled === "true" || newRecords === 0 || page >= maxPages || records >= maxRecords;
}

export function stableDomIdentity({ profileUrl = "", name = "", company = "" } = {}) {
  return profileUrl || [name, company].filter(Boolean).join("|");
}

export class ResponseGate {
  constructor() {
    this.waiters = [];
  }

  waitForNext(sequence, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const waiter = { sequence, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter(item => item !== waiter);
        reject(new Error(`Timed out waiting ${timeoutMs}ms for Apollo's next search response.`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  push(response, sequence) {
    const eligible = this.waiters.filter(item => sequence > item.sequence);
    const waiter = eligible[0];
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.waiters = this.waiters.filter(item => item !== waiter);
    waiter.resolve(response);
  }

  cancel() {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ cancelled: true });
    }
    this.waiters = [];
  }
}
