const fs = require('fs');
const ts = require('typescript');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const sourceText = String(input.source || '');
const file = ts.createSourceFile('imported.spec.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let scopeSequence = 0;

function lineOf(position) {
  return file.getLineAndCharacterOfPosition(position).line + 1;
}

function propertyName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : '';
}

function callPath(expression) {
  const parts = [];
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (ts.isIdentifier(current)) parts.unshift(current.text);
  return parts.join('.');
}

function literalTitle(node) {
  if (!node) return '';
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return '';
}

function objectStringProperty(node, expectedName) {
  if (!node || !ts.isObjectLiteralExpression(node)) return '';
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || propertyName(property.name) !== expectedName) continue;
    return literalTitle(property.initializer);
  }
  return '';
}

function createScope(parent, node, title) {
  const scope = {
    id: `scope-${++scopeSequence}`,
    title: title || (parent ? 'describe' : 'spec'),
    titlePath: [...(parent ? parent.titlePath : []), ...(title ? [title] : [])],
    startLine: lineOf(node.getStart(file)),
    endLine: lineOf(node.getEnd()),
    hardReasons: [],
    reviewReasons: [],
    children: [],
  };
  if (parent) parent.children.push(scope);
  return scope;
}

const root = createScope(null, file, '');
root.startLine = 1;
root.endLine = file.getLineAndCharacterOfPosition(file.end).line + 1;

const moduleMutableNames = new Set();
for (const statement of file.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  const mutableDeclaration = (statement.declarationList.flags & ts.NodeFlags.Const) === 0;
  for (const declaration of statement.declarationList.declarations) {
    if (mutableDeclaration && ts.isIdentifier(declaration.name)) moduleMutableNames.add(declaration.name.text);
  }
}

function addReason(scope, kind, code, message, line) {
  const target = kind === 'hard' ? scope.hardReasons : scope.reviewReasons;
  if (!target.some((item) => item.code === code && item.line === line)) target.push({ code, message, line });
}

function callbackBody(call) {
  return call.arguments.find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
}

function mutatesModuleState(node) {
  let mutated = '';
  function visit(current) {
    if (mutated) return;
    if (ts.isBinaryExpression(current) && ts.isAssignmentOperator(current.operatorToken.kind)) {
      const target = current.left;
      const identifier = ts.isIdentifier(target) ? target : ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression) ? target.expression : null;
      if (identifier && moduleMutableNames.has(identifier.text)) mutated = identifier.text;
    } else if ((ts.isPrefixUnaryExpression(current) || ts.isPostfixUnaryExpression(current)) && ts.isIdentifier(current.operand) && moduleMutableNames.has(current.operand.text)) {
      mutated = current.operand.text;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return mutated;
}

function walk(node, scope) {
  if (ts.isCallExpression(node)) {
    const path = callPath(node.expression);
    if (path === 'test.describe' || path === 'test.describe.only' || path === 'test.describe.skip') {
      const callback = callbackBody(node);
      if (callback) {
        const child = createScope(scope, node, literalTitle(node.arguments[0]));
        walk(callback.body, child);
        return;
      }
    }
    if (path === 'test.describe.configure' && objectStringProperty(node.arguments[0], 'mode') === 'serial') {
      addReason(scope, 'hard', 'serial-suite', 'describe 使用 serial 模式，组内测试必须按顺序执行', lineOf(node.getStart(file)));
    }
    if (path === 'test.beforeAll' || path === 'test.afterAll') {
      addReason(scope, 'hard', path === 'test.beforeAll' ? 'before-all' : 'after-all', `${path} 在组内共享一次性状态`, lineOf(node.getStart(file)));
    }
    if (path === 'test.use') {
      const storageState = objectStringProperty(node.arguments[0], 'storageState');
      if (storageState) addReason(scope, 'review', 'external-storage-state', `使用外部 storageState：${storageState}`, lineOf(node.getStart(file)));
    }
    if (/^test(?:\.(?:only|skip|fixme|slow))?$/.test(path) || /^test\.(?:beforeAll|afterAll|beforeEach|afterEach)$/.test(path)) {
      const callback = callbackBody(node);
      const name = callback ? mutatesModuleState(callback.body) : '';
      if (name) addReason(root, 'review', 'module-mutable-state', `测试或 hook 修改模块级变量 ${name}`, lineOf(node.getStart(file)));
    }
  }
  ts.forEachChild(node, (child) => walk(child, scope));
}

walk(file, root);
process.stdout.write(JSON.stringify({ version: 1, scopes: root }, null, 2));
