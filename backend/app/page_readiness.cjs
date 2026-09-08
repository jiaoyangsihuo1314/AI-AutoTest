const DEFAULT_STABILITY_WINDOW_MS = 900;
const DEFAULT_POLL_INTERVAL_MS = 150;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const visibleMatches = async (locator, limit = 8) => {
  const count = Math.min(await locator.count(), limit);
  const matches = [];
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) matches.push(item);
  }
  return matches;
};

const locatorForHint = (page, hint) => {
  const locatorType = String(hint?.locatorType || '').trim().toLowerCase();
  const locatorValue = String(hint?.locatorValue || '').trim();
  const locatorRole = String(hint?.locatorRole || '').trim().toLowerCase();
  if (!locatorType || !locatorValue) return null;
  if (locatorType === 'testid') {
    const escaped = locatorValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return page.locator(`[data-testid="${escaped}"], [data-test="${escaped}"]`);
  }
  if (locatorType === 'label') return page.getByLabel(locatorValue, { exact: true });
  if (locatorType === 'placeholder') return page.getByPlaceholder(locatorValue, { exact: true });
  if (locatorType === 'role' && locatorRole) return page.getByRole(locatorRole, { name: locatorValue, exact: true });
  if (locatorType === 'css' || locatorType === 'selector') return page.locator(locatorValue);
  if (locatorType === 'text') return page.getByText(locatorValue, { exact: true });
  return null;
};

const candidateSummary = async (page, limit = 40) => page.evaluate((candidateLimit) => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  return Array.from(document.querySelectorAll('button,a,input,textarea,select,[data-testid],[data-test],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="combobox"],[role="switch"],[role="tab"],[role="menuitem"]'))
    .filter(visible)
    .slice(0, candidateLimit)
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        role: el.getAttribute('role') || '',
        testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || '',
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        text: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)]
      };
    });
}, limit).catch(() => []);

const pageStateSnapshot = async (page, hints = []) => {
  const [documentState, candidates] = await Promise.all([
    page.evaluate(() => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const blockingSelectors = [
        '[aria-busy="true"]', '[data-loading="true"]', '.loading', '.loading-mask', '.spinner',
        '.skeleton', '.modal-backdrop', '.el-loading-mask', '.ant-spin-spinning'
      ];
      const blockingOverlays = Array.from(document.querySelectorAll(blockingSelectors.join(',')))
        .filter(visible)
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
          const coverage = (rect.width * rect.height) / viewportArea;
          return el.getAttribute('aria-busy') === 'true'
            || coverage >= 0.2
            || ['fixed', 'absolute'].includes(style.position) && Number.parseInt(style.zIndex || '0', 10) >= 10;
        });
      const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
        .filter(visible)
        .slice(0, 6)
        .map((el) => (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 100));
      const bodyText = (document.body?.innerText || '').trim().replace(/\s+/g, ' ');
      return {
        readyState: document.readyState,
        bodyTextLength: bodyText.length,
        bodySample: bodyText.slice(0, 600),
        title: document.title,
        headings,
        blockingOverlayCount: blockingOverlays.length,
        url: location.href
      };
    }).catch(() => ({
      readyState: 'unknown', bodyTextLength: 0, bodySample: '', title: '', headings: [],
      blockingOverlayCount: 0, url: page.url()
    })),
    candidateSummary(page)
  ]);
  let visibleHintCount = 0;
  const hintMatches = [];
  for (const hint of Array.isArray(hints) ? hints : []) {
    const locator = locatorForHint(page, hint);
    if (!locator) continue;
    const matches = await visibleMatches(locator, 3).catch(() => []);
    if (matches.length) visibleHintCount += 1;
    hintMatches.push({
      locatorType: hint.locatorType || '',
      locatorValue: hint.locatorValue || '',
      locatorRole: hint.locatorRole || '',
      matchCount: matches.length
    });
  }
  return {
    ...documentState,
    candidateCount: candidates.length,
    candidates,
    visibleHintCount,
    hintMatches
  };
};

const stateSignature = (snapshot) => JSON.stringify({
  url: snapshot.url,
  title: snapshot.title,
  headings: snapshot.headings,
  bodySample: snapshot.bodySample,
  blockingOverlayCount: snapshot.blockingOverlayCount,
  hints: snapshot.hintMatches,
  candidates: snapshot.candidates.map((candidate) => [
    candidate.tag,
    candidate.type,
    candidate.role,
    candidate.testId,
    candidate.text,
    candidate.disabled,
    candidate.rect
  ])
});

const waitForPageStable = async (page, options = {}) => {
  const startedAt = Date.now();
  const timeoutMs = Math.min(15000, Math.max(500, Number(options.timeoutMs || 8000)));
  const minInteractive = Math.max(0, Number(options.minInteractive || 0));
  const hints = Array.isArray(options.hints) ? options.hints : [];
  const stabilityWindowMs = Math.min(2000, Math.max(800, Number(options.stabilityWindowMs || DEFAULT_STABILITY_WINDOW_MS)));
  const pollIntervalMs = Math.min(300, Math.max(100, Number(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS)));
  await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeoutMs, 10000) }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 1200 }).catch(() => {});
  let stableSince = 0;
  let stableSignature = '';
  let lastSnapshot = await pageStateSnapshot(page, hints);
  while (Date.now() - startedAt <= timeoutMs) {
    lastSnapshot = await pageStateSnapshot(page, hints);
    const documentReady = ['interactive', 'complete'].includes(lastSnapshot.readyState);
    const hasExpectedContent = lastSnapshot.visibleHintCount > 0
      || lastSnapshot.candidateCount >= minInteractive
      || (minInteractive === 0 && lastSnapshot.bodyTextLength > 0);
    const overlayClear = lastSnapshot.blockingOverlayCount === 0;
    if (documentReady && hasExpectedContent && overlayClear) {
      const signature = stateSignature(lastSnapshot);
      if (signature !== stableSignature) {
        stableSignature = signature;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= stabilityWindowMs) {
        return {
          ...lastSnapshot,
          signature,
          readinessMs: Date.now() - startedAt,
          timeoutMs,
          stableForMs: Date.now() - stableSince,
          stabilityWindowMs
        };
      }
    } else {
      stableSince = 0;
      stableSignature = '';
    }
    await delay(pollIntervalMs);
  }
  const error = new Error(`Page did not become stable within ${timeoutMs}ms; url=${page.url()}; candidates=${lastSnapshot.candidateCount}; overlays=${lastSnapshot.blockingOverlayCount}`);
  error.code = 'page_not_ready';
  error.details = { ...lastSnapshot, readinessMs: Date.now() - startedAt, timeoutMs };
  error.retryable = lastSnapshot.candidateCount === 0 || lastSnapshot.blockingOverlayCount > 0;
  throw error;
};

module.exports = {
  candidateSummary,
  delay,
  locatorForHint,
  pageStateSnapshot,
  stateSignature,
  visibleMatches,
  waitForPageStable
};
