const readline = require('readline');
const { chromium } = require('playwright');

const [sessionId, targetUrl, viewportJson] = process.argv.slice(2);
const viewport = JSON.parse(viewportJson || '{"width":1440,"height":900}');

let browser;
let page;
let client;
let paused = false;
let closed = false;
let commandQueue = Promise.resolve();
let stdoutReady = true;
let suppressFrames = false;

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

const visibleSelector = async (selector) => {
  const errors = [];
  for (const candidate of selectorCandidates(selector)) {
    try {
      const locator = page.locator(candidate).first();
      await locator.waitFor({ state: 'visible', timeout: 2500 });
      return locator;
    } catch (error) {
      errors.push(`${candidate}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(`No visible selector matched: ${selector}\n${errors.join('\n')}`);
};

const navigateTo = async (url, label = 'navigate') => {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      return;
    } catch (error) {
      lastError = error;
      emit({ type: 'log', level: 'warning', message: `${label} attempt ${attempt} failed: ${error?.message || String(error)}` });
      await page.waitForTimeout(700 * attempt).catch(() => {});
    }
  }
  throw lastError;
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
    const candidates = Array.from(document.querySelectorAll('button,a,input,textarea,select,[data-testid],[data-test]'))
      .filter(visible)
      .slice(0, 40)
      .map((el) => {
        const tag = el.tagName.toLowerCase();
        const text = labelFor(el).trim().replace(/\s+/g, ' ').slice(0, 90);
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
        const placeholder = el.getAttribute('placeholder');
        const aria = el.getAttribute('aria-label');
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
        }
        return {
          area: document.title || location.pathname,
          name: text || tag,
          locatorType,
          locatorValue: locatorValue || text || tag,
          source: `步骤探索 ${tag}${testId ? ' data-test' : placeholder ? ' placeholder' : aria ? ' aria-label' : ' text'}`,
          confirmed: false
        };
      });
    const textCandidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,a,button,span,div,p,td,th'))
      .filter(visible)
      .map((el) => {
        const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
        return { el, text };
      })
      .filter(({ text }) => text && text.length <= 90)
      .filter(({ text }) => /欢迎您|首页|基本情况|电能质量|工单中心|线损管理|供电可靠性|Products|Cart|Checkout/i.test(text))
      .slice(0, 24)
      .map(({ el, text }) => ({
        area: document.title || location.pathname,
        name: text,
        locatorType: 'text',
        locatorValue: text,
        source: `步骤探索 ${el.tagName.toLowerCase()} 登录后可见文本`,
        confirmed: false
      }));
    for (const candidate of textCandidates) {
      if (!candidates.some((item) => item.locatorType === candidate.locatorType && item.locatorValue === candidate.locatorValue)) {
        candidates.push(candidate);
      }
    }
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
  emit({ type: 'step-start', stepIndex: step.index, message: `执行步骤 ${step.index + 1}: ${step.description}` });
  suppressFrames = true;
  let evidence;
  let collectFullEvidence = true;
  try {
    if (step.action === 'navigate') {
      const destination = step.target || targetUrl;
      if (destination && page.url().replace(/\/$/, '') !== destination.replace(/\/$/, '')) {
        await navigateTo(destination, `step ${step.index + 1} navigate`);
      }
    } else if (step.action === 'fill') {
      const locator = await visibleSelector(step.target);
      await withTimeout(locator.fill(step.value || '', { timeout: 5000 }), 6000, 'fill');
      collectFullEvidence = false;
    } else if (step.action === 'click') {
      const locator = await visibleSelector(step.target);
      await withTimeout(
        locator.evaluate((el) => {
          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.click();
        }),
        5000,
        'click'
      );
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
    } else if (step.action === 'assert') {
      const locator = await visibleSelector(step.target);
      await locator.isVisible({ timeout: 2500 });
      collectFullEvidence = false;
    } else if (step.action === 'snapshot') {
      await page.waitForTimeout(300);
      collectFullEvidence = true;
    }
    evidence = collectFullEvidence ? await collectEvidence(step.screenshotPath) : await quickEvidence();
  } finally {
    suppressFrames = false;
  }
  emit({ type: 'step-result', stepIndex: step.index, before, after: page.url(), evidence });
  return { status: 'passed', evidence };
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
    emit({ type: 'ack', commandId: command.commandId || null, status: 'ok' });
  } catch (error) {
    emit({ type: 'ack', commandId: command.commandId || null, status: 'error', error: error?.stack || String(error) });
  }
};

const enqueueCommand = (command) => {
  commandQueue = commandQueue
    .catch(() => {})
    .then(() => handleCommand(command));
};

const shutdown = async () => {
  if (closed && !browser) return;
  closed = true;
  try {
    if (client) await client.send('Page.stopScreencast').catch(() => {});
    if (browser) await browser.close();
  } finally {
    browser = null;
    emit({ type: 'closed', sessionId });
  }
};

(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport });
  client = await page.context().newCDPSession(page);
  client.on('Page.screencastFrame', async (frame) => {
    emit({
      type: 'frame',
      sessionId,
      data: frame.data,
      format: frame.metadata?.format || 'jpeg',
      width: frame.metadata?.deviceWidth || viewport.width,
      height: frame.metadata?.deviceHeight || viewport.height
    });
    await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 65, everyNthFrame: 1 });
  emit({ type: 'ready', sessionId, viewport, url: page.url() });
  if (targetUrl) {
    await navigateTo(targetUrl, 'initial target').catch((error) => {
      emit({ type: 'log', level: 'error', message: error?.stack || String(error) });
    });
  }

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    enqueueCommand(JSON.parse(line));
  });
})();

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
