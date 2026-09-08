const fs = require('fs');
const path = require('path');

const ts = require(path.resolve(__dirname, '../../frontend/node_modules/typescript/lib/typescript.js'));

function trimTrailingSlash(value) {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function rebaseUrl(value, sourceBaseUrl, targetBaseUrl) {
  let valueUrl;
  let sourceUrl;
  let targetUrl;
  try {
    valueUrl = new URL(value);
    sourceUrl = new URL(sourceBaseUrl);
    targetUrl = new URL(targetBaseUrl);
  } catch {
    return value;
  }
  if (!['http:', 'https:'].includes(valueUrl.protocol) || valueUrl.origin !== sourceUrl.origin) return value;
  const sourceRoot = trimTrailingSlash(sourceUrl.pathname || '/');
  const valuePath = valueUrl.pathname || '/';
  if (sourceRoot !== '/' && valuePath !== sourceRoot && !valuePath.startsWith(`${sourceRoot}/`)) return value;
  const suffix = sourceRoot === '/' ? valuePath : valuePath.slice(sourceRoot.length) || '/';
  const targetRoot = trimTrailingSlash(targetUrl.pathname || '/');
  const mappedPath = targetRoot === '/'
    ? (suffix.startsWith('/') ? suffix : `/${suffix}`)
    : `${targetRoot}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
  const mapped = new URL(targetUrl.href);
  mapped.pathname = mappedPath;
  mapped.search = targetUrl.search || valueUrl.search;
  mapped.hash = targetUrl.hash || valueUrl.hash;
  return mapped.href;
}

function applicationSuffix(value, sourceBaseUrl) {
  let valueUrl;
  let sourceUrl;
  try {
    valueUrl = new URL(value);
    sourceUrl = new URL(sourceBaseUrl);
  } catch {
    return null;
  }
  if (valueUrl.origin !== sourceUrl.origin) return null;
  if (valueUrl.href === sourceUrl.href) return '';
  const sourceRoot = trimTrailingSlash(sourceUrl.pathname || '/');
  const valuePath = valueUrl.pathname || '/';
  if (sourceRoot !== '/' && valuePath !== sourceRoot && !valuePath.startsWith(`${sourceRoot}/`)) return null;
  const pathSuffix = sourceRoot === '/' ? valuePath : valuePath.slice(sourceRoot.length) || '/';
  return `${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}${valueUrl.search}${valueUrl.hash}`;
}

function transformSource(source, sourceBaseUrl, targetBaseUrl, generated) {
  const sourceFile = ts.createSourceFile('runtime.spec.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const replacements = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const mapped = rebaseUrl(node.text, sourceBaseUrl, targetBaseUrl || sourceBaseUrl);
      const suffix = generated ? applicationSuffix(node.text, sourceBaseUrl) : null;
      let replacement = '';
      if (generated && suffix !== null) {
        replacement = `qaEnvironmentUrl(${JSON.stringify(node.text)})`;
      } else if (mapped !== node.text) {
        replacement = JSON.stringify(mapped);
      }
      if (replacement) replacements.push({ start: node.getStart(sourceFile), end: node.getEnd(), replacement });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (generated && replacements.length && !source.includes('function qaEnvironmentUrl(')) {
    const imports = sourceFile.statements.filter((statement) => ts.isImportDeclaration(statement));
    const insertAt = imports.length ? imports[imports.length - 1].getEnd() : 0;
    const helper = `

function qaEnvironmentUrl(value: string) {
  const selected = process.env.QA_TARGET_URL;
  if (!selected) return value;
  const valueUrl = new URL(value);
  const sourceUrl = new URL(${JSON.stringify(sourceBaseUrl)});
  const targetUrl = new URL(selected);
  if (valueUrl.origin !== sourceUrl.origin) return value;
  const sourceRoot = (sourceUrl.pathname || '/').replace(/\\/+$/, '') || '/';
  const valuePath = valueUrl.pathname || '/';
  if (sourceRoot !== '/' && valuePath !== sourceRoot && !valuePath.startsWith(sourceRoot + '/')) return value;
  const suffix = sourceRoot === '/' ? valuePath : valuePath.slice(sourceRoot.length) || '/';
  const targetRoot = (targetUrl.pathname || '/').replace(/\\/+$/, '') || '/';
  targetUrl.pathname = targetRoot === '/' ? (suffix.startsWith('/') ? suffix : '/' + suffix) : targetRoot + (suffix.startsWith('/') ? suffix : '/' + suffix);
  targetUrl.search = targetUrl.search || valueUrl.search;
  targetUrl.hash = targetUrl.hash || valueUrl.hash;
  return targetUrl.href;
}
`;
    replacements.push({ start: insertAt, end: insertAt, replacement: helper });
  }
  return replacements
    .sort((left, right) => right.start - left.start)
    .reduce((result, item) => `${result.slice(0, item.start)}${item.replacement}${result.slice(item.end)}`, source);
}

const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(transformSource(
  String(payload.source || ''),
  String(payload.sourceBaseUrl || ''),
  String(payload.targetBaseUrl || payload.sourceBaseUrl || ''),
  Boolean(payload.generated),
));
