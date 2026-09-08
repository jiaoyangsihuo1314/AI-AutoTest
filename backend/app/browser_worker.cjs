const readline = require('readline');
const { chromium } = require('playwright');
const {
  candidateSummary: summarizeCandidates,
  delay,
  locatorForHint: readinessLocatorForHint,
  pageStateSnapshot,
  stateSignature,
  visibleMatches,
  waitForPageStable: waitForStablePage
} = require('./page_readiness.cjs');

const [sessionId, targetUrl, viewportJson] = process.argv.slice(2);
const viewport = JSON.parse(viewportJson || '{"width":1440,"height":900}');

let browser;
let context;
let page;
let client;
let paused = false;
let closed = false;
let commandQueue = Promise.resolve();
let stdoutReady = true;
let suppressFrames = false;
let shutdownPromise;
let lastFrameAt = 0;
let scenarioRecoveryAttempts = 0;
const FRAME_INTERVAL_MS = 125;
const PAGE_READY_TIMEOUT_MS = 8000;
const TARGET_RESOLVE_TIMEOUT_MS = 6000;
const POLL_INTERVAL_MS = 150;

const explorationError = (code, message, details = {}, retryable = false) => {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  error.retryable = retryable;
  return error;
};

const emit = (payload) => {
  if (payload.type === 'frame') {
    if (!payload.critical && (suppressFrames || !stdoutReady)) return;
    const ready = process.stdout.write(`${JSON.stringify(payload)}\n`);
    if (!payload.critical) stdoutReady = ready;
    return;
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

process.stdout.on('drain', () => {
  stdoutReady = true;
});

const withTimeout = async (promise, ms, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const selectorCandidates = (selector) => {
  const source = String(selector || '').trim();
  if (!source) return [];
  const parts = source.split(',').map((item) => item.trim()).filter(Boolean);
  return parts.length ? parts : [source];
};

const locatorForCandidate = (candidate) => {
  if (candidate.startsWith('text=')) {
    const text = candidate.slice(5).trim();
    return page.getByText(text, { exact: true });
  }
  return page.locator(candidate);
};

const visibleSelector = async (selector) => {
  const errors = [];
  const ambiguous = [];
  for (const candidate of selectorCandidates(selector)) {
    try {
      const locator = locatorForCandidate(candidate);
      await locator.first().waitFor({ state: 'visible', timeout: 2500 });
      const matches = await visibleMatches(locator);
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) ambiguous.push(`${candidate}: ${matches.length}`);
    } catch (error) {
      errors.push(`${candidate}: ${error?.message || String(error)}`);
    }
  }
  if (ambiguous.length) {
    throw explorationError(
      'target_ambiguous',
      `Selector matched multiple visible targets: ${selector}`,
      { ambiguous, attempts: selectorCandidates(selector) }
    );
  }
  throw new Error(`No visible selector matched: ${selector}\n${errors.join('\n')}`);
};

const candidateSummary = async () => summarizeCandidates(page, 40);

const semanticMatchState = async (locator, descriptor, selectionPolicy = '') => {
  const matches = await visibleMatches(locator);
  if (matches.length === 1) return { locator: matches[0], count: 1 };
  if (selectionPolicy === 'first-safe' && matches.length > 0) {
    for (const match of matches) {
      const enabled = await match.isEnabled().catch(() => false);
      if (enabled) return { locator: match, count: 1, candidateCount: matches.length, selectionPolicy };
    }
  }
  return { locator: null, count: matches.length, descriptor };
};

const locatorConfidence = (locatorType, stable, actionable, matchCount) => {
  const base = {
    testid: 98,
    label: 92,
    role: 90,
    placeholder: 86,
    css: 80,
    selector: 72,
    text: 50
  }[String(locatorType || '').toLowerCase()] || 60;
  return Math.max(0, Math.min(100, base - (stable ? 0 : 25) - (actionable ? 0 : 20) - (matchCount === 1 ? 0 : 35)));
};

const inspectResolvedTarget = async (locator, fallback, matchCount = 1, strategy = '') => {
  const attributes = await locator.evaluate((el) => {
    const tag = el.tagName.toLowerCase();
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || '';
    const id = el.getAttribute('id') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const ariaLabel = el.getAttribute('aria-label') || '';
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : '');
    const href = tag === 'a' ? String(el.href || el.getAttribute('href') || '') : '';
    let label = '';
    if (id) label = document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText?.trim() || '';
    if (!label && el.closest('label')) label = el.closest('label')?.innerText?.trim() || '';
    const text = (ariaLabel || placeholder || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const rect = el.getBoundingClientRect();
    return {
      testId, id, placeholder, role, label, text, tag, href,
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)]
    };
  });
  await delay(250);
  const secondObservation = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)]
    };
  }).catch(() => ({ visible: false, disabled: true, rect: [] }));
  const fallbacks = [];
  const addFallback = (locatorType, locatorValue, locatorRole = '') => {
    if (!locatorType || !locatorValue) return;
    if (fallbacks.some((item) => item.locatorType === locatorType && item.locatorValue === locatorValue && item.locatorRole === locatorRole)) return;
    fallbacks.push({ locatorType, locatorValue, locatorRole });
  };
  addFallback(fallback.locatorType, fallback.locatorValue, fallback.role || fallback.locatorRole || '');
  addFallback('label', attributes.label);
  addFallback('role', attributes.text, attributes.role);
  addFallback('placeholder', attributes.placeholder);
  addFallback('css', attributes.id ? `#${attributes.id}` : '');
  let primary = { ...fallback, locatorRole: fallback.role || fallback.locatorRole || '' };
  if (attributes.testId) {
    primary = { locatorType: 'testid', locatorValue: attributes.testId, locatorRole: '', name: fallback.name || attributes.text, source: '真实 DOM 稳定 test id' };
  }
  const stable = secondObservation.visible
    && JSON.stringify(attributes.rect) === JSON.stringify(secondObservation.rect);
  const actionable = secondObservation.visible && !secondObservation.disabled;
  const confidence = locatorConfidence(primary.locatorType, stable, actionable, matchCount);
  return {
    ...primary,
    name: primary.name || fallback.name || attributes.text,
    fallbacks: fallbacks.filter((item) => !(item.locatorType === primary.locatorType && item.locatorValue === primary.locatorValue && item.locatorRole === (primary.locatorRole || ''))).slice(0, 5),
    confidence,
    matchCount,
    strategy,
    stableObservations: stable ? 2 : 1,
    visible: secondObservation.visible,
    enabled: !secondObservation.disabled,
    actionable,
    href: attributes.href,
    tagName: attributes.tag,
    autoConfirmEligible: confidence >= 80 && primary.locatorType !== 'text' && primary.locatorType !== 'selector' && matchCount === 1,
    observedStates: [{ url: page.url(), rect: attributes.rect }, { url: page.url(), rect: secondObservation.rect }]
  };
};

const locatorForHint = (hint) => readinessLocatorForHint(page, hint);
const pageReadinessSnapshot = async (hints = []) => pageStateSnapshot(page, hints);
const capturePageState = async (hints = []) => {
  const snapshot = await pageReadinessSnapshot(hints);
  return { ...snapshot, signature: stateSignature(snapshot) };
};
const waitForPageStable = async (options = {}) => {
  try {
    return await waitForStablePage(page, options);
  } catch (error) {
    if (error?.code) throw error;
    throw explorationError('page_not_ready', error?.message || String(error), error?.details || {}, Boolean(error?.retryable));
  }
};

const resolveSemanticTargetOnce = async (step) => {
  const target = step.targetMeta || step.target_meta || {};
  const kind = String(target.kind || '').trim().toLowerCase();
  const selectionPolicy = String(target.selectionPolicy || '').trim().toLowerCase();
  const names = [target.name, ...(Array.isArray(target.aliases) ? target.aliases : [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const exact = target.exact !== false;
  const attempts = [];
  const ambiguous = [];
  const strategies = [];

  const addStrategy = (locator, descriptor, resolvedTarget) => {
    if (!locator || attempts.includes(descriptor) || strategies.some((item) => item.descriptor === descriptor)) return;
    strategies.push({ locator, descriptor, resolvedTarget });
  };

  if (kind === 'selector') {
    const locator = await visibleSelector(String(target.name || step.target || ''));
    const fallback = { locatorType: 'selector', locatorValue: String(target.name || step.target || ''), name: String(target.name || step.target || ''), source: '测试用例显式 selector' };
    return { result: { locator, resolvedTarget: await inspectResolvedTarget(locator, fallback, 1, 'explicit selector') }, attempts: ['explicit selector'], ambiguous };
  }

  for (const hint of Array.isArray(target.locatorHints) ? target.locatorHints : []) {
    const locator = locatorForHint(hint);
    const locatorType = String(hint?.locatorType || '').trim().toLowerCase();
    const locatorValue = String(hint?.locatorValue || '').trim();
    const locatorRole = String(hint?.locatorRole || '').trim().toLowerCase();
    addStrategy(locator, `hint ${locatorType}${locatorRole ? `(${locatorRole})` : ''}=${locatorValue}`, {
      locatorType,
      locatorValue,
      locatorRole,
      name: target.name || locatorValue,
      source: '页面预探索 locator hint'
    });
  }

  for (const name of names) {
    if (kind === 'password') {
      addStrategy(page.getByLabel(name, { exact }), `label=${name}`, { locatorType: 'label', locatorValue: name, name, source: '语义定位 label' });
      addStrategy(page.getByPlaceholder(name, { exact }), `placeholder=${name}`, { locatorType: 'placeholder', locatorValue: name, name, source: '语义定位 placeholder' });
      addStrategy(page.locator('input[type="password"]'), 'input[type=password]', { locatorType: 'css', locatorValue: 'input[type="password"]', name, source: '语义定位 password type' });
    } else if (kind === 'textbox') {
      addStrategy(page.getByLabel(name, { exact }), `label=${name}`, { locatorType: 'label', locatorValue: name, name, source: '语义定位 label' });
      addStrategy(page.getByPlaceholder(name, { exact }), `placeholder=${name}`, { locatorType: 'placeholder', locatorValue: name, name, source: '语义定位 placeholder' });
      addStrategy(page.getByRole('textbox', { name, exact }), `role=textbox name=${name}`, { locatorType: 'role', locatorValue: name, role: 'textbox', name, source: '语义定位 role' });
    } else if (kind === 'button' || kind === 'link') {
      addStrategy(page.getByRole(kind, { name, exact: true }), `role=${kind} exact name=${name}`, { locatorType: 'role', locatorValue: name, role: kind, name, source: '语义定位 role exact' });
      if (!exact) addStrategy(page.getByRole(kind, { name, exact: false }), `role=${kind} contains=${name}`, { locatorType: 'role', locatorValue: name, role: kind, name, source: '语义定位 role contains' });
      addStrategy(page.getByText(name, { exact: true }), `exact text=${name}`, { locatorType: 'text', locatorValue: name, name, source: '语义定位 exact text' });
      if (!exact) addStrategy(page.getByText(name, { exact: false }), `text contains=${name}`, { locatorType: 'text', locatorValue: name, name, source: '语义定位 text contains' });
    } else if (['checkbox', 'radio', 'combobox', 'option', 'switch', 'tab', 'menuitem'].includes(kind)) {
      addStrategy(page.getByRole(kind, { name, exact }), `role=${kind} name=${name}`, { locatorType: 'role', locatorValue: name, role: kind, name, source: '语义定位交互 role' });
    }
  }

  for (const strategy of strategies) {
    attempts.push(strategy.descriptor);
    const match = await semanticMatchState(strategy.locator, strategy.descriptor, selectionPolicy);
    if (match.locator) {
      const resolvedTarget = await inspectResolvedTarget(match.locator, strategy.resolvedTarget, match.count, strategy.descriptor);
      if (
        String(target.evidenceSource || '').toLowerCase() === 'manual-repair'
        && String(strategy.resolvedTarget?.locatorType || '').toLowerCase() === 'selector'
        && String(target.selectionPolicy || '').toLowerCase() === 'nth-safe'
        && resolvedTarget.stableObservations >= 2
        && resolvedTarget.actionable
      ) {
        resolvedTarget.confidence = 88;
        resolvedTarget.autoConfirmEligible = true;
        resolvedTarget.source = '人工确认区域序号 selector';
      }
      return {
        result: {
          locator: match.locator,
          resolvedTarget
        },
        attempts,
        ambiguous
      };
    }
    if (match.count > 1) ambiguous.push(`${strategy.descriptor}: ${match.count}`);
  }
  return { result: null, attempts, ambiguous };
};

const resolveSemanticTarget = async (step) => {
  const startedAt = Date.now();
  let resolutionAttempts = 0;
  let lastAttempts = [];
  let lastAmbiguous = [];
  while (Date.now() - startedAt <= TARGET_RESOLVE_TIMEOUT_MS) {
    resolutionAttempts += 1;
    const resolved = await resolveSemanticTargetOnce(step);
    lastAttempts = resolved.attempts;
    lastAmbiguous = resolved.ambiguous;
    if (resolved.result) {
      resolved.result.resolvedTarget = {
        ...resolved.result.resolvedTarget,
        diagnostics: {
          resolutionAttempts,
          resolutionMs: Date.now() - startedAt
        }
      };
      return resolved.result;
    }
    await delay(POLL_INTERVAL_MS);
  }
  const available = await candidateSummary();
  const code = lastAmbiguous.length ? 'target_ambiguous' : 'target_not_found';
  throw explorationError(
    code,
    `No semantic target matched: ${JSON.stringify(step.targetMeta || step.target_meta || {})}; url=${page.url()}; attempts=${lastAttempts.join(' | ')}; candidates=${JSON.stringify(available)}`,
    {
      attempts: lastAttempts,
      ambiguous: lastAmbiguous,
      candidates: available,
      candidateCount: available.length,
      resolutionAttempts,
      resolutionMs: Date.now() - startedAt,
      url: page.url()
    },
    code === 'target_not_found' && available.length === 0
  );
};

const resolveOrdinalTarget = async (step, originalError) => {
  const target = step.targetMeta || step.target_meta || {};
  const selectionPolicy = String(target.selectionPolicy || '').trim().toLowerCase();
  const selectionIndex = Math.max(0, Number(target.selectionIndex || 0));
  const regionNames = [target.regionName, ...(Array.isArray(target.regionAliases) ? target.regionAliases : [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (selectionPolicy !== 'nth-safe' || selectionIndex < 1 || !regionNames.length) return null;

  const match = await page.evaluate(({ regionNames: rawRegionNames, selectionIndex: requestedIndex }) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const normalize = (value) => String(value || '').toLowerCase().replace(/[\s\-—_·:：/\\()（）\[\]【】'"“”]+/g, '');
    const semanticRegionName = (region) => {
      const ariaLabel = region.getAttribute('aria-label') || '';
      if (ariaLabel.trim()) return ariaLabel.trim();
      const labelledBy = region.getAttribute('aria-labelledby') || '';
      if (labelledBy) {
        const label = document.getElementById(labelledBy);
        if (label?.innerText?.trim()) return label.innerText.trim();
      }
      const heading = region.querySelector('h1,h2,h3,[role="heading"]');
      return String(heading?.innerText || '').trim().replace(/\s+/g, ' ');
    };
    const names = rawRegionNames.map(normalize).filter(Boolean);
    const regions = Array.from(document.querySelectorAll('section,article,[role="region"],main'))
      .filter(visible)
      .map((element) => ({ element, name: semanticRegionName(element) }))
      .filter(({ name }) => {
        const normalized = normalize(name);
        return normalized && names.some((expected) => normalized === expected || normalized.includes(expected) || expected.includes(normalized));
      });
    if (regions.length !== 1) {
      return { ok: false, reason: regions.length ? 'region-ambiguous' : 'region-not-found', regionCount: regions.length };
    }

    const region = regions[0].element;
    const excluded = /查看全部|完整排行榜|更多|上一页|下一页|more|previous|next/i;
    const records = Array.from(region.querySelectorAll('tr[role="link"],li[role="link"],a,button,[role="link"],[role="button"]'))
      .filter(visible)
      .filter((element) => {
        const text = String(element.getAttribute('aria-label') || element.innerText || '').trim().replace(/\s+/g, ' ');
        if (!text || excluded.test(text)) return false;
        const tag = element.tagName.toLowerCase();
        return ['tr', 'li'].includes(tag) || /^\s*\d{1,3}(?:\s|[.、．)])/.test(text) || /查看(?:技能|详情)|打开(?:技能|详情)/i.test(text);
      });
    const ranked = records.find((element) => {
      const text = String(element.getAttribute('aria-label') || element.innerText || '').trim();
      const rank = text.match(/^\s*(\d{1,3})(?:\s|[.、．)])/);
      return rank && Number(rank[1]) === requestedIndex;
    });
    const selected = ranked || records[requestedIndex - 1];
    if (!selected) {
      return { ok: false, reason: 'ordinal-out-of-range', regionCount: 1, recordCount: records.length };
    }

    const tag = selected.tagName.toLowerCase();
    const role = selected.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : '');
    const testId = selected.getAttribute('data-testid') || selected.getAttribute('data-test') || '';
    const id = selected.getAttribute('id') || '';
    let itemSelector = testId
      ? `[data-testid="${CSS.escape(testId)}"],[data-test="${CSS.escape(testId)}"]`
      : id
        ? `#${CSS.escape(id)}`
        : `${tag}${role ? `[role="${CSS.escape(role)}"]` : ''}`;
    let regionSelector = '';
    const regionTestId = region.getAttribute('data-testid') || region.getAttribute('data-test') || '';
    const regionId = region.getAttribute('id') || '';
    const regionAria = region.getAttribute('aria-label') || '';
    if (regionTestId) regionSelector = `[data-testid="${CSS.escape(regionTestId)}"],[data-test="${CSS.escape(regionTestId)}"]`;
    else if (regionId) regionSelector = `#${CSS.escape(regionId)}`;
    else if (regionAria) regionSelector = `[aria-label="${CSS.escape(regionAria)}"]`;
    else {
      const escapedName = String(regions[0].name || rawRegionNames[0]).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      regionSelector = `${region.tagName.toLowerCase()}:has(:is(h1,h2,h3,[role="heading"]):text-is("${escapedName}"))`;
    }
    const peers = Array.from(region.querySelectorAll(itemSelector)).filter(visible);
    const peerIndex = peers.indexOf(selected);
    if (peerIndex < 0) return { ok: false, reason: 'selector-not-reproducible', regionCount: 1, recordCount: records.length };

    const marker = `ordinal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    selected.setAttribute('data-qa-exploration-ordinal', marker);
    const text = String(selected.getAttribute('aria-label') || selected.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    return {
      ok: true,
      marker,
      name: text,
      role,
      regionName: regions[0].name || rawRegionNames[0],
      selector: `${regionSelector} ${itemSelector} >> nth=${peerIndex}`,
      recordCount: records.length,
      selectedIndex: records.indexOf(selected) + 1
    };
  }, { regionNames, selectionIndex });

  if (!match?.ok) {
    throw explorationError(
      'target_not_found',
      `未找到${regionNames[0]}第 ${selectionIndex} 条记录，建议为目标记录补充稳定 data-testid 后重试`,
      {
        originalCode: originalError?.code || 'target_not_found',
        repairStrategy: 'ordinal-region-fallback',
        regionName: regionNames[0],
        selectionIndex,
        reason: match?.reason || 'unknown',
        regionCount: Number(match?.regionCount || 0),
        recordCount: Number(match?.recordCount || 0)
      }
    );
  }

  const locator = page.locator(`[data-qa-exploration-ordinal="${match.marker}"]`);
  const resolvedTarget = await inspectResolvedTarget(locator, {
    locatorType: 'selector',
    locatorValue: match.selector,
    locatorRole: match.role || '',
    name: match.name,
    source: '区域序号自动修复'
  }, 1, 'ordinal-region-fallback');
  resolvedTarget.confidence = resolvedTarget.stableObservations >= 2 && resolvedTarget.actionable ? 88 : 72;
  resolvedTarget.autoConfirmEligible = resolvedTarget.confidence >= 80 && resolvedTarget.locatorType !== 'selector';
  return {
    locator,
    resolvedTarget,
    runtimeRepair: {
      type: 'ordinal-region-fallback',
      from: originalError?.code || 'target_not_found',
      strategy: 'region-and-ordinal',
      regionName: match.regionName,
      selectionIndex,
      recordCount: match.recordCount,
      selector: match.selector
    }
  };
};

const resolveSemanticTargetWithRepair = async (step) => {
  try {
    return await resolveSemanticTarget(step);
  } catch (originalError) {
    const repaired = await resolveOrdinalTarget(step, originalError);
    if (repaired) return repaired;
    throw originalError;
  }
};

const LOGIN_ENTRY_PATTERN = /^(?:登录|用户登录|登录系统|立即登录|去登录|sign\s*in|log\s*in)$/i;

const resolveWithControlledRecovery = async (step) => {
  try {
    return await resolveSemanticTarget(step);
  } catch (originalError) {
    const policy = step.recoveryPolicy || step.recovery_policy || {};
    const entry = policy.entry || {};
    const role = String(entry.locatorRole || entry.role || '').trim().toLowerCase();
    const name = String(entry.locatorValue || entry.name || '').trim();
    const maxAttempts = Math.min(1, Math.max(0, Number(policy.maxAttempts || 0)));
    if (policy.type !== 'unique_login_entry' || !maxAttempts || scenarioRecoveryAttempts >= maxAttempts) throw originalError;
    if (!['link', 'button'].includes(role) || !LOGIN_ENTRY_PATTERN.test(name)) throw originalError;

    const matches = await visibleMatches(page.getByRole(role, { name, exact: true }));
    if (matches.length !== 1) {
      throw explorationError(
        'recovery_failed',
        `Controlled recovery requires one visible ${role} named ${name}; matches=${matches.length}; original=${originalError?.message || String(originalError)}`,
        { matches: matches.length, entry: { role, name }, originalCode: originalError?.code || 'target_not_found' }
      );
    }
    scenarioRecoveryAttempts += 1;
    const beforeUrl = page.url();
    const recovery = {
      type: 'unique_login_entry',
      attempt: scenarioRecoveryAttempts,
      entry: { locatorType: 'role', locatorRole: role, locatorValue: name, name },
      beforeUrl,
      afterUrl: beforeUrl,
      status: 'running'
    };
    emit({ type: 'recovery-start', stepIndex: step.index, recovery });
    try {
      await withTimeout(matches[0].click({ timeout: 5000 }), 5000, 'controlled recovery click');
      await waitForPageStable({
        hints: (step.targetMeta || step.target_meta || {}).locatorHints || [],
        minInteractive: 1,
        timeoutMs: Number(step.readiness?.timeoutMs || PAGE_READY_TIMEOUT_MS)
      });
      recovery.afterUrl = page.url();
      const resolved = await resolveSemanticTarget(step);
      recovery.status = 'passed';
      emit({ type: 'recovery-result', stepIndex: step.index, recovery });
      return { ...resolved, recovery };
    } catch (recoveryError) {
      recovery.afterUrl = page.url();
      recovery.status = 'failed';
      recovery.error = recoveryError?.message || String(recoveryError);
      emit({ type: 'recovery-result', stepIndex: step.index, recovery });
      throw explorationError(
        'recovery_failed',
        `Controlled login-entry recovery failed: ${recovery.error}; original=${originalError?.message || String(originalError)}`,
        { recovery, originalCode: originalError?.code || 'target_not_found' }
      );
    }
  }
};

const navigateTo = async (url, label = 'navigate') => {
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 20000 });
  } catch (error) {
    emit({ type: 'log', level: 'warning', message: `${label} failed: ${error?.message || String(error)}` });
    throw error;
  }
};

const navigateAndStabilize = async (step, destination) => {
  const readiness = step.readiness || {};
  const preflightCandidateCount = Math.max(0, Number(readiness.preflightCandidateCount || 0));
  const maxAttempts = 2;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await navigateTo(destination, `step ${step.index + 1} navigate${attempt ? ' retry' : ''}`);
    try {
      const ready = await waitForPageStable({
        hints: step.readinessHints || [],
        minInteractive: Number(readiness.minInteractive || 0),
        timeoutMs: Number(readiness.timeoutMs || PAGE_READY_TIMEOUT_MS)
      });
      return { ...ready, retryCount: attempt };
    } catch (error) {
      lastError = error;
      const candidateCount = Number(error?.details?.candidateCount || 0);
      const canRetry = error?.code === 'page_not_ready' && candidateCount === 0 && attempt + 1 < maxAttempts;
      if (!canRetry) throw error;
      emit({
        type: 'log',
        level: 'warning',
        message: `页面首次导航未渲染交互 DOM，执行一次安全重导航；url=${page.url()}`,
        errorCode: 'page_not_ready',
        retryCount: attempt + 1
      });
    }
  }
  throw lastError || explorationError('page_not_ready', 'Page navigation did not become stable');
};

const ensureActionable = async (locator, resolvedTarget) => {
  const actionable = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const centerX = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    const centerY = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
    const top = document.elementFromPoint(centerX, centerY);
    return {
      visible: rect.width > 0 && rect.height > 0,
      enabled: !(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      receivesEvents: Boolean(top && (top === el || el.contains(top) || top.contains(el)))
    };
  }).catch(() => ({ visible: false, enabled: false, receivesEvents: false }));
  if (!actionable.visible || !actionable.enabled || !actionable.receivesEvents) {
    throw explorationError(
      actionable.enabled ? 'target_obscured' : 'target_disabled',
      `Resolved target is not actionable: ${JSON.stringify(resolvedTarget)}`,
      { actionable, resolvedTarget },
      actionable.visible && actionable.enabled
    );
  }
  return actionable;
};

const enforceStepSafety = (step, resolvedTarget) => {
  const target = step.targetMeta || step.target_meta || {};
  const safety = target.safety && typeof target.safety === 'object' ? target.safety : {};
  const safetyClass = String(safety.class || '').trim().toLowerCase();
  if (safetyClass === 'irreversible') {
    throw explorationError('dangerous_action', `Blocked irreversible exploration action: ${JSON.stringify({ target: target.name || step.target, safety })}`);
  }
  if (safetyClass !== 'same-origin-navigation') return;
  const actualHref = String(resolvedTarget?.href || '').trim();
  const plannedHref = String(safety.href || target.href || '').trim();
  const currentOrigin = new URL(page.url() || targetUrl, targetUrl).origin;
  if (actualHref) {
    const resolvedUrl = new URL(actualHref, page.url() || targetUrl);
    if (resolvedUrl.origin !== currentOrigin) {
      throw explorationError('external_navigation_blocked', `Blocked cross-origin exploration navigation: ${resolvedUrl.href}`);
    }
    if (plannedHref) {
      const expectedUrl = new URL(plannedHref, targetUrl);
      if (expectedUrl.origin !== resolvedUrl.origin || expectedUrl.pathname !== resolvedUrl.pathname || expectedUrl.hash !== resolvedUrl.hash) {
        throw explorationError(
          'navigation_target_changed',
          `Resolved navigation target differs from preflight evidence: expected=${expectedUrl.href} actual=${resolvedUrl.href}`
        );
      }
    }
  }
};

const expectedStateReached = async (step, beforeState, resolvedLocator = null) => {
  const expected = step.expected || {};
  const checks = [];
  const expectedUrl = String(expected.urlContains || step.expectedUrl || step.expected_url || '').trim();
  const unexpectedUrl = String(expected.urlNotContains || '').trim();
  const expectedTexts = Array.isArray(expected.textAny) && expected.textAny.length
    ? expected.textAny.map((value) => String(value || '').trim()).filter(Boolean)
    : [String(step.expectedText || step.expected_text || '').trim()].filter(Boolean);
  const absentTexts = Array.isArray(expected.textAbsent)
    ? expected.textAbsent.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (expectedUrl) {
    await page.waitForFunction(
      (fragment) => window.location.href.includes(fragment),
      expectedUrl,
      { timeout: 5000 }
    );
    checks.push({ type: 'urlContains', expected: expectedUrl, passed: true });
  }
  if (unexpectedUrl) {
    await page.waitForFunction(
      (fragment) => !window.location.href.includes(fragment),
      unexpectedUrl,
      { timeout: 5000 }
    );
    checks.push({ type: 'urlNotContains', expected: unexpectedUrl, passed: true });
  }
  if (expectedTexts.length) {
    await Promise.any(
      expectedTexts.map((text) => page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 }))
    );
    checks.push({ type: 'textAny', expected: expectedTexts, passed: true });
  }
  for (const text of absentTexts) {
    await page.getByText(text, { exact: false }).first().waitFor({ state: 'hidden', timeout: 5000 });
    checks.push({ type: 'textAbsent', expected: text, passed: true });
  }
  const targetVisible = Array.isArray(expected.targetVisible) ? expected.targetVisible : [];
  for (const hint of targetVisible) {
    const locator = locatorForHint(hint);
    const matches = locator ? await visibleMatches(locator, 3).catch(() => []) : [];
    if (matches.length !== 1) {
      throw explorationError(
        matches.length > 1 ? 'target_ambiguous' : 'state_verification_failed',
        `Expected one visible follow-up target, matched ${matches.length}: ${JSON.stringify(hint)}`,
        { hint, matchCount: matches.length }
      );
    }
    checks.push({ type: 'targetVisible', expected: hint, matchCount: 1, passed: true });
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'valueEquals')) {
    if (!resolvedLocator) {
      throw explorationError('state_verification_failed', 'Expected value verification has no resolved target');
    }
    const actualValue = await resolvedLocator.inputValue().catch(() => null);
    if (actualValue !== String(expected.valueEquals ?? '')) {
      throw explorationError(
        'state_verification_failed',
        `Filled value mismatch; expected=${JSON.stringify(expected.valueEquals)} actual=${JSON.stringify(actualValue)}`,
        { expectedValue: expected.valueEquals, actualValue }
      );
    }
    checks.push({ type: 'valueEquals', expected: String(expected.valueEquals ?? ''), actual: actualValue, passed: true });
  }
  if (expected.stateChanged) {
    const afterState = await capturePageState(expected.targetVisible || []);
    if (!beforeState || beforeState.signature === afterState.signature) {
      throw explorationError(
        'state_verification_failed',
        'Expected page state to change, but the stable state signature did not change',
        { beforeState, afterState }
      );
    }
    checks.push({ type: 'stateChanged', passed: true, beforeSignature: beforeState.signature, afterSignature: afterState.signature });
  }
  const requiresPostcondition = ['click', 'select'].includes(step.action);
  if (requiresPostcondition && checks.length === 0) {
    throw explorationError('missing_state_expectation', `State-changing step has no postcondition: ${step.description}`);
  }
  return checks;
};

const normalizedOptionText = (value) => String(value || '').trim().toLowerCase().replace(/[\s\-_—·:：]+/g, '');

const resolveAdaptiveSelectTarget = async (step) => {
  const target = step.targetMeta || step.target_meta || {};
  const desired = target.desiredOption && typeof target.desiredOption === 'object' ? target.desiredOption : {};
  const desiredValues = [desired.value, desired.label, step.value]
    .map(normalizedOptionText)
    .filter(Boolean);
  if (!desiredValues.length) return null;
  const selects = page.locator('select');
  const count = await selects.count();
  const matches = [];
  for (let index = 0; index < count; index += 1) {
    const locator = selects.nth(index);
    const options = await locator.locator('option').evaluateAll((items) => items.map((option) => ({
      label: String(option.label || option.textContent || '').trim(),
      value: String(option.value || '')
    }))).catch(() => []);
    const matchedOption = options.find((option) => {
      const values = [option.value, option.label].map((value) => String(value || '').trim().toLowerCase().replace(/[\s\-_—·:：]+/g, ''));
      return desiredValues.some((desiredValue) => values.includes(desiredValue));
    });
    if (matchedOption) matches.push({ locator, matchedOption });
  }
  if (matches.length !== 1) return null;
  const match = matches[0];
  return {
    locator: match.locator,
    desiredOption: match.matchedOption,
    resolvedTarget: await inspectResolvedTarget(match.locator, {
      locatorType: 'css',
      locatorValue: await match.locator.evaluate((el) => el.id ? `#${CSS.escape(el.id)}` : 'select'),
      locatorRole: 'combobox',
      name: target.name || '排序方式',
      source: '运行期唯一 select option 自适应'
    }, 1, 'adaptive select option')
  };
};

const selectDesiredOption = async (locator, step, adaptiveOption = null) => {
  const target = step.targetMeta || step.target_meta || {};
  const desired = target.desiredOption && typeof target.desiredOption === 'object' ? target.desiredOption : {};
  const candidates = [
    adaptiveOption?.value,
    desired.value,
    step.value,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  for (const value of [...new Set(candidates)]) {
    try {
      const selected = await locator.selectOption(value, { timeout: 3000 });
      if (selected.length) return { value: selected[0], strategy: 'value' };
    } catch {}
  }
  const labels = [adaptiveOption?.label, desired.label, step.value]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  for (const label of [...new Set(labels)]) {
    try {
      const selected = await locator.selectOption({ label }, { timeout: 3000 });
      if (selected.length) return { value: selected[0], label, strategy: 'label' };
    } catch {}
  }
  const options = await locator.locator('option').evaluateAll((items) => items.map((option) => ({
    label: String(option.label || option.textContent || '').trim(),
    value: String(option.value || '')
  })));
  const normalizedLabels = labels.map(normalizedOptionText);
  const matched = options.filter((option) => normalizedLabels.includes(normalizedOptionText(option.label)));
  if (matched.length === 1) {
    const selected = await locator.selectOption(matched[0].value, { timeout: 3000 });
    return { value: selected[0], label: matched[0].label, strategy: 'normalized-label' };
  }
  throw explorationError('target_not_found', `No select option matched: ${JSON.stringify({ desired, value: step.value, options })}`);
};

const verifyPostcondition = async (step, beforeState, resolvedLocator = null) => {
  try {
    return { status: 'passed', checks: await expectedStateReached(step, beforeState, resolvedLocator), finding: null };
  } catch (error) {
    if (String(step.expected?.behaviorPolicy || '').toLowerCase() !== 'record') throw error;
    const target = step.targetMeta || step.target_meta || {};
    const expectation = step.expected?.urlContains
      ? `期望 URL 包含 ${step.expected.urlContains}，实际为 ${page.url()}`
      : error?.message || String(error);
    return {
      status: 'mismatch',
      checks: [],
      finding: {
        code: 'behavior_mismatch',
        message: expectation,
        expected: step.expected || {},
        actualUrl: page.url(),
        title: await page.title().catch(() => ''),
        accessGate: target.destinationAccessGate || {},
        expectedDestination: target.destinationFinalUrl || target.href || ''
      }
    };
  }
};

const collectEvidence = async (screenshotPath) => {
  let screenshotReady = false;
  await withTimeout(page.screenshot({ path: screenshotPath, fullPage: false, timeout: 5000 }), 6000, 'screenshot')
    .then(() => {
      screenshotReady = true;
    })
    .catch((error) => {
      emit({ type: 'log', level: 'warning', message: `screenshot skipped: ${error?.message || String(error)}` });
    });
  const fallbackTitle = await page.title().catch(() => '');
  const fallbackUrl = page.url();
  const payload = await withTimeout(page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const labelFor = (el) => {
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label?.innerText?.trim()) return label.innerText.trim();
      }
      return el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.value || '';
    };
    const candidates = Array.from(document.querySelectorAll('button,a,input,textarea,select,[data-testid],[data-test],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="combobox"],[role="switch"],[role="tab"],[role="menuitem"]'))
      .filter(visible)
      .slice(0, 40)
      .map((el) => {
        const tag = el.tagName.toLowerCase();
        const text = labelFor(el).trim().replace(/\s+/g, ' ').slice(0, 90);
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
        const placeholder = el.getAttribute('placeholder');
        const aria = el.getAttribute('aria-label');
        const className = typeof el.className === 'string' ? el.className : '';
        let locatorType = 'text';
        let locatorValue = text;
        if (testId) {
          locatorType = 'testid';
          locatorValue = testId;
        } else if (placeholder) {
          locatorType = 'placeholder';
          locatorValue = placeholder;
        } else if (aria) {
          locatorType = 'role';
          locatorValue = aria;
        } else if ((tag === 'button' || tag === 'a') && text) {
          locatorType = 'role';
          locatorValue = text;
        }
        return {
          area: document.title || location.pathname,
          name: text || tag,
          locatorType,
          locatorValue: locatorValue || text || tag,
          locatorRole: locatorType === 'role' ? (el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : '')) : '',
          source: `步骤探索 ${tag}${testId ? ' data-test' : placeholder ? ' placeholder' : aria ? ' aria-label' : tag === 'button' || tag === 'a' ? ' accessible role' : ' text'}`,
          confirmed: false,
          confidence: testId ? 98 : aria ? 90 : placeholder ? 86 : 50,
          matchCount: 0,
          strategy: testId ? 'testid' : aria ? 'role' : placeholder ? 'placeholder' : 'text',
          observedStates: [{ url: location.href }],
          autoConfirmEligible: false
        };
      });
    const textCandidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,a,button,p,td,th'))
      .filter(visible)
      .map((el) => {
        const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
        return { el, text };
      })
      .filter(({ text }) => text && text.length <= 90)
      .slice(0, 24)
      .map(({ el, text }) => ({
        area: document.title || location.pathname,
        name: text,
        locatorType: 'text',
        locatorValue: text,
        source: `步骤探索 ${el.tagName.toLowerCase()} 可见文本`,
        confirmed: false,
        confidence: 50,
        matchCount: 0,
        strategy: 'text',
        observedStates: [{ url: location.href }],
        autoConfirmEligible: false
      }));
    const structure = {
      title: document.title,
      url: location.href,
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).filter(visible).slice(0, 8).map((el) => el.innerText.trim()),
      texts: textCandidates.slice(0, 12).map((item) => item.locatorValue),
      forms: Array.from(document.querySelectorAll('form')).length,
      links: Array.from(document.querySelectorAll('a')).filter(visible).length,
      buttons: Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"]')).filter(visible).length,
      inputs: Array.from(document.querySelectorAll('input,textarea,select')).filter(visible).length
    };
    return { structure, candidates };
  }), 5000, 'dom evidence').catch((error) => ({
    structure: { title: fallbackTitle, url: fallbackUrl, headings: [], forms: 0, links: 0, buttons: 0, inputs: 0 },
    candidates: [],
    error: error?.message || String(error)
  }));
  return {
    ...payload,
    screenshotPath: screenshotReady ? screenshotPath : '',
    url: fallbackUrl,
    title: fallbackTitle
  };
};

const quickEvidence = async () => {
  const url = page.url();
  return {
    structure: { title: '', url, headings: [], forms: 0, links: 0, buttons: 0, inputs: 0 },
    candidates: [],
    screenshotPath: '',
    url,
    title: ''
  };
};

const dispatchMouse = async ({ type, action, x, y, deltaX = 0, deltaY = 0 }) => {
  const eventType = action || type;
  if (eventType === 'move') await page.mouse.move(x, y);
  if (eventType === 'click') await page.mouse.click(x, y);
  if (eventType === 'wheel') await page.mouse.wheel(deltaX, deltaY);
};

const dispatchKeyboard = async ({ type, action, text, key }) => {
  const eventType = action || type;
  if (eventType === 'type' && text) await page.keyboard.type(text);
  if (eventType === 'press' && key) await page.keyboard.press(key);
};

const executeStep = async (step) => {
  while (paused && !closed) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (closed) return { status: 'skipped', error: 'session closed' };
  const before = page.url();
  const beforeState = await capturePageState(step.readinessHints || []).catch(() => ({ signature: '', url: before }));
  emit({ type: 'step-start', stepIndex: step.index, message: `执行步骤 ${step.index + 1}: ${step.description}` });
  suppressFrames = true;
  let evidence;
  let resolvedTarget = null;
  let recovery = null;
  let collectFullEvidence = true;
  let diagnostics = {};
  let expectedChecks = [];
  let resolutionStatus = ['fill', 'select', 'click', 'locate'].includes(step.action) ? 'pending' : 'not-required';
  let actionStatus = ['navigate', 'fill', 'select', 'click'].includes(step.action) ? 'pending' : 'not-required';
  let postconditionStatus = ['fill', 'select', 'click'].includes(step.action) ? 'pending' : 'not-required';
  let behaviorFinding = null;
  let runtimeRepair = null;
  try {
    if (step.action === 'navigate') {
      const destination = step.target || targetUrl;
      if (destination && page.url().replace(/\/$/, '') !== destination.replace(/\/$/, '')) {
        diagnostics.readiness = await navigateAndStabilize(step, destination);
      }
      actionStatus = 'passed';
    } else if (step.action === 'fill') {
      const resolved = await resolveWithControlledRecovery(step);
      const locator = resolved.locator;
      resolvedTarget = resolved.resolvedTarget;
      resolutionStatus = 'passed';
      recovery = resolved.recovery || null;
      if (!(await locator.isEnabled().catch(() => false))) throw explorationError('target_disabled', `Resolved fill target is not enabled: ${JSON.stringify(resolvedTarget)}`);
      diagnostics.actionability = await ensureActionable(locator, resolvedTarget);
      await withTimeout(locator.fill(step.value || '', { timeout: 5000 }), 6000, 'fill');
      actionStatus = 'passed';
      if (step.expected?.stateChanged || step.expected?.urlContains || step.expected?.textAny?.length || step.expected?.targetVisible?.length) {
        diagnostics.readiness = await waitForPageStable({
          hints: step.readinessHints || step.expected?.targetVisible || [],
          minInteractive: Number(step.readiness?.minInteractive || 0),
          timeoutMs: Number(step.readiness?.timeoutMs || PAGE_READY_TIMEOUT_MS)
        });
      }
      const postcondition = await verifyPostcondition(step, beforeState, locator);
      expectedChecks = postcondition.checks;
      postconditionStatus = postcondition.status;
      behaviorFinding = postcondition.finding;
      collectFullEvidence = true;
    } else if (step.action === 'select') {
      let resolved;
      let adaptive = null;
      try {
        resolved = await resolveWithControlledRecovery(step);
      } catch (error) {
        adaptive = await resolveAdaptiveSelectTarget(step);
        if (!adaptive) throw error;
        resolved = { locator: adaptive.locator, resolvedTarget: adaptive.resolvedTarget, recovery: null };
        runtimeRepair = { type: 'control-type-adaptation', from: (step.targetMeta || {}).kind || 'unknown', to: 'combobox', strategy: 'unique-option-match' };
      }
      const locator = resolved.locator;
      resolvedTarget = resolved.resolvedTarget;
      resolutionStatus = 'passed';
      recovery = resolved.recovery || null;
      if (!(await locator.isEnabled().catch(() => false))) throw explorationError('target_disabled', `Resolved select target is not enabled: ${JSON.stringify(resolvedTarget)}`);
      diagnostics.actionability = await ensureActionable(locator, resolvedTarget);
      diagnostics.selection = await withTimeout(selectDesiredOption(locator, step, adaptive?.desiredOption), 10000, 'select');
      actionStatus = 'passed';
      diagnostics.readiness = await waitForPageStable({
        hints: step.readinessHints || [],
        minInteractive: Number(step.readiness?.minInteractive || 0),
        timeoutMs: Number(step.readiness?.timeoutMs || PAGE_READY_TIMEOUT_MS)
      });
      const postcondition = await verifyPostcondition(step, beforeState, locator);
      expectedChecks = postcondition.checks;
      postconditionStatus = postcondition.status;
      behaviorFinding = postcondition.finding;
      collectFullEvidence = true;
    } else if (step.action === 'click') {
      const resolved = await resolveSemanticTargetWithRepair(step);
      const locator = resolved.locator;
      resolvedTarget = resolved.resolvedTarget;
      runtimeRepair = resolved.runtimeRepair || null;
      resolutionStatus = 'passed';
      enforceStepSafety(step, resolvedTarget);
      if (!(await locator.isEnabled().catch(() => true))) throw explorationError('target_disabled', `Resolved click target is not enabled: ${JSON.stringify(resolvedTarget)}`);
      diagnostics.actionability = await ensureActionable(locator, resolvedTarget);
      await withTimeout(
        locator.click({ timeout: 5000 }),
        5000,
        'click'
      );
      actionStatus = 'passed';
      diagnostics.readiness = await waitForPageStable({
        hints: step.readinessHints || [],
        minInteractive: Number(step.readiness?.minInteractive || 0),
        timeoutMs: Number(step.readiness?.timeoutMs || PAGE_READY_TIMEOUT_MS)
      });
      const postcondition = await verifyPostcondition(step, beforeState);
      expectedChecks = postcondition.checks;
      postconditionStatus = postcondition.status;
      behaviorFinding = postcondition.finding;
    } else if (step.action === 'locate') {
      let resolved;
      try {
        resolved = await resolveWithControlledRecovery(step);
      } catch (originalError) {
        resolved = await resolveOrdinalTarget(step, originalError);
        if (!resolved) throw originalError;
      }
      const locator = resolved.locator;
      resolvedTarget = resolved.resolvedTarget;
      runtimeRepair = resolved.runtimeRepair || null;
      resolutionStatus = 'passed';
      recovery = resolved.recovery || null;
      if (!(await locator.isVisible())) throw explorationError('target_not_found', `Resolved target is not visible: ${JSON.stringify(resolvedTarget)}`);
      if (!(await locator.isEnabled().catch(() => true))) throw explorationError('target_disabled', `Resolved target is not enabled: ${JSON.stringify(resolvedTarget)}`);
      collectFullEvidence = false;
    } else if (step.action === 'snapshot') {
      await page.waitForTimeout(300);
      collectFullEvidence = true;
    }
    evidence = collectFullEvidence ? await collectEvidence(step.screenshotPath) : await quickEvidence();
  } catch (error) {
    const failureEvidence = await collectEvidence(step.screenshotPath);
    error.details = {
      ...(error.details || {}),
      evidence: failureEvidence,
      finalUrl: page.url(),
      resolvedTarget,
      resolutionStatus,
      actionStatus: actionStatus === 'pending' ? 'failed' : actionStatus,
      postconditionStatus: postconditionStatus === 'pending' ? 'not-reached' : postconditionStatus,
      runtimeRepair,
      behaviorFinding
    };
    throw error;
  } finally {
    suppressFrames = false;
  }
  emit({
    type: 'step-result', stepIndex: step.index, before, after: page.url(), evidence, resolvedTarget, recovery,
    diagnostics, expectedChecks, resolutionStatus, actionStatus, postconditionStatus, runtimeRepair, behaviorFinding
  });
  return { status: 'passed', evidence };
};

const stopScreencast = async () => {
  if (client) await client.send('Page.stopScreencast').catch(() => {});
  client = null;
};

const startScreencast = async () => {
  client = await context.newCDPSession(page);
  client.on('Page.screencastFrame', async (frame) => {
    const now = Date.now();
    if (now - lastFrameAt >= FRAME_INTERVAL_MS) {
      lastFrameAt = now;
      emit({
        type: 'frame',
        sessionId,
        data: frame.data,
        format: frame.metadata?.format || 'jpeg',
        width: frame.metadata?.deviceWidth || viewport.width,
        height: frame.metadata?.deviceHeight || viewport.height
      });
    }
    await client?.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 65, everyNthFrame: 1 });
};

const createScenarioPage = async (scenario = {}) => {
  suppressFrames = true;
  try {
    await stopScreencast();
    if (page) await page.close({ runBeforeUnload: false }).catch(() => {});
    if (context) await context.close().catch(() => {});
    context = await browser.newContext({ viewport });
    page = await context.newPage();
    scenarioRecoveryAttempts = 0;
    await startScreencast();
    emit({ type: 'scenario-ready', scenarioIndex: scenario.scenarioIndex || 0, caseId: scenario.caseId || '', url: page.url() });
  } finally {
    suppressFrames = false;
  }
};

const handleCommand = async (command) => {
  try {
    if (command.type === 'mouse') await dispatchMouse(command);
    if (command.type === 'keyboard') await dispatchKeyboard(command);
    if (command.type === 'control' && command.action === 'pause') paused = true;
    if (command.type === 'control' && command.action === 'resume') paused = false;
    if (command.type === 'control' && command.action === 'takeover') paused = true;
    if (command.type === 'control' && command.action === 'stop') {
      closed = true;
      await shutdown();
    }
    if (command.type === 'execute-step') {
      try {
        await executeStep(command.step);
      } catch (error) {
        throw error;
      }
    }
    if (command.type === 'start-scenario') await createScenarioPage(command.scenario || {});
    emit({ type: 'ack', commandId: command.commandId || null, status: 'ok' });
  } catch (error) {
    const diagnostics = error?.details || {};
    emit({
      type: 'ack',
      commandId: command.commandId || null,
      status: 'error',
      error: error?.message || String(error),
      stack: error?.stack || '',
      errorCode: error?.code || 'step_failed',
      retryable: Boolean(error?.retryable),
      diagnostics,
      evidence: diagnostics.evidence || null
    });
  }
};

const enqueueCommand = (command) => {
  commandQueue = commandQueue
    .catch(() => {})
    .then(() => handleCommand(command));
};

const shutdown = async (exitAfter = false) => {
  if (shutdownPromise) {
    await shutdownPromise;
    if (exitAfter) process.exit(0);
    return;
  }
  shutdownPromise = (async () => {
    if (closed && !browser) return;
    closed = true;
    try {
      await stopScreencast();
      if (page) await page.close({ runBeforeUnload: false }).catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close();
    } finally {
      client = null;
      page = null;
      context = null;
      browser = null;
      emit({ type: 'closed', sessionId });
    }
  })();
  await shutdownPromise;
  if (exitAfter) process.exit(0);
};

(async () => {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport });
  page = await context.newPage();
  await startScreencast();
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    enqueueCommand(JSON.parse(line));
  });
  emit({ type: 'ready', sessionId, viewport, url: page.url() });
})();

process.on('SIGTERM', () => {
  shutdown(true).catch(() => process.exit(1));
});
process.on('SIGINT', () => {
  shutdown(true).catch(() => process.exit(1));
});
process.on('uncaughtException', (error) => {
  emit({ type: 'log', level: 'error', message: error?.stack || String(error) });
  shutdown(true).catch(() => process.exit(1));
});
process.on('unhandledRejection', (error) => {
  emit({ type: 'log', level: 'error', message: error?.stack || String(error) });
  shutdown(true).catch(() => process.exit(1));
});
