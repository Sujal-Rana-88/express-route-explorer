import * as vscode from 'vscode';
import {
  fallbackPathFromExpression,
  resolvePathExpression,
  splitRoutePathExpressions,
  unwrapParens
} from './expressionResolver';
import { escapeRegex, normalizePath } from './pathUtils';

export type Receiver = 'app' | 'router';

export interface LocalRoute {
  method: string;
  path: string;
  pathExpression: string;
  resolvedPath?: string;
  line: number;
  column: number;
  receiver: Receiver;
}

export interface RouterUse {
  prefixExpr: string;
  routerIdent: string;
}

export interface RequireEntry {
  varName: string;
  requiredPath: string;
}

export interface ImportEntry {
  varName: string;
  importPath: string;
}

export interface FileAnalysis {
  uri: vscode.Uri;
  constValues: Record<string, string>;
  appUsePrefixExprs: string[];
  routerUses: RouterUse[];
  nestedRouterUses: RouterUse[];
  requires: RequireEntry[];
  imports: ImportEntry[];
  routes: LocalRoute[];
}

interface ExpressIdentifiers {
  expressAliases: Set<string>;
  routerFactoryAliases: Set<string>;
}

interface KnownReceivers {
  appIdentifiers: Set<string>;
  routerIdentifiers: Set<string>;
}

export function analyzeDocument(doc: vscode.TextDocument): FileAnalysis {
  const text = doc.getText();

  const constValues = collectConstValues(text);
  const { imports, expressAliases, routerFactoryAliases } = collectImports(text);
  const { requires, requireExpressAliases, requireRouterFactories } = collectRequires(text);

  for (const alias of requireExpressAliases) {
    expressAliases.add(alias);
  }
  for (const alias of requireRouterFactories) {
    routerFactoryAliases.add(alias);
  }

  const receivers = collectReceivers(text, expressAliases, routerFactoryAliases);

  const appUsePrefixExprs = collectAppUses(text, receivers.appIdentifiers);
  const routerUses = collectRouterUses(text, receivers.appIdentifiers);
  const nestedRouterUses = collectNestedRouterUses(text, receivers.routerIdentifiers);

  const routes = collectRoutes(doc, text, constValues, receivers);

  return {
    uri: doc.uri,
    constValues,
    appUsePrefixExprs,
    routerUses,
    nestedRouterUses,
    requires,
    imports,
    routes
  };
}

function collectImports(text: string): {
  imports: ImportEntry[];
  expressAliases: Set<string>;
  routerFactoryAliases: Set<string>;
} {
  const imports: ImportEntry[] = [];
  const expressAliases = new Set<string>(['express']);
  const routerFactoryAliases = new Set<string>(['Router']);

  const importRegex = /import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(text)) !== null) {
    const clause = match[1].trim();
    const source = match[2].trim();

    const defaultAliasMatch = /^([\w$]+)/.exec(clause);
    const namespaceMatch = /^\*\s+as\s+([\w$]+)/.exec(clause);
    const namedPartMatch = /\{([^}]+)\}/.exec(clause);

    if (source === 'express') {
      if (defaultAliasMatch) {
        expressAliases.add(defaultAliasMatch[1]);
      }
      if (namespaceMatch) {
        expressAliases.add(namespaceMatch[1]);
      }
      if (namedPartMatch) {
        const parts = namedPartMatch[1]
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);

        for (const part of parts) {
          const aliasMatch = /Router(?:\s+as\s+([\w$]+))?/i.exec(part);
          if (aliasMatch) {
            routerFactoryAliases.add(aliasMatch[1] || 'Router');
          }
        }
      }
      continue;
    }

    const importPath = source;
    const alias = namespaceMatch?.[1] ?? defaultAliasMatch?.[1];

    if (alias) {
      imports.push({ varName: alias, importPath });
    } else if (namedPartMatch) {
      const firstSpecifier = namedPartMatch[1].split(',')[0]?.trim();
      if (firstSpecifier) {
        const aliasName = /as\s+([\w$]+)/i.exec(firstSpecifier)?.[1] ?? firstSpecifier;
        imports.push({ varName: aliasName, importPath });
      }
    }
  }

  return { imports, expressAliases, routerFactoryAliases };
}

function collectRequires(text: string): {
  requires: RequireEntry[];
  requireExpressAliases: Set<string>;
  requireRouterFactories: Set<string>;
} {
  const requires: RequireEntry[] = [];
  const requireExpressAliases = new Set<string>();
  const requireRouterFactories = new Set<string>();

  const requireRegex =
    /const\s+(\w+)\s*=\s*require\(\s*(['"`])([^'"`]+)\2\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = requireRegex.exec(text)) !== null) {
    const varName = match[1];
    const requiredPath = match[3];
    requires.push({ varName, requiredPath });

    if (requiredPath === 'express') {
      requireExpressAliases.add(varName);
    }
  }

  const requireRouterRegex =
    /const\s*\{\s*Router(?:\s*:\s*(\w+))?\s*\}\s*=\s*require\(\s*['"]express['"]\s*\)/g;
  let mRouter: RegExpExecArray | null;
  while ((mRouter = requireRouterRegex.exec(text)) !== null) {
    const alias = mRouter[1] || 'Router';
    requireRouterFactories.add(alias);
  }

  return { requires, requireExpressAliases, requireRouterFactories };
}

function collectReceivers(
  text: string,
  expressAliases: Set<string>,
  routerFactoryAliases: Set<string>
): KnownReceivers {
  const appIdentifiers = new Set<string>(['app']);
  const routerIdentifiers = new Set<string>(['router']);

  for (const alias of expressAliases) {
    const appRegex = new RegExp(
      `\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*${escapeRegex(alias)}\\s*\\(`,
      'g'
    );
    const routerRegex = new RegExp(
      `\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*${escapeRegex(alias)}\\.Router\\s*\\(`,
      'g'
    );

    let m: RegExpExecArray | null;
    while ((m = appRegex.exec(text)) !== null) {
      appIdentifiers.add(m[1]);
    }
    while ((m = routerRegex.exec(text)) !== null) {
      routerIdentifiers.add(m[1]);
    }
  }

  for (const alias of routerFactoryAliases) {
    const regex = new RegExp(
      `\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*${escapeRegex(alias)}\\s*\\(`,
      'g'
    );
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      routerIdentifiers.add(m[1]);
    }
  }

  return { appIdentifiers, routerIdentifiers };
}

function collectAppUses(text: string, appIdentifiers: Set<string>): string[] {
  const prefixes: string[] = [];
  const appPattern = Array.from(appIdentifiers).map(escapeRegex).join('|');
  const appUseAnyRegex = new RegExp(`\\b(?:${appPattern})\\.use\\s*\\(\\s*([^,]+)\\s*,`, 'g');
  let m: RegExpExecArray | null;
  while ((m = appUseAnyRegex.exec(text)) !== null) {
    const expr = m[1].trim();
    prefixes.push(expr);
  }
  return prefixes;
}

function collectRouterUses(text: string, appIdentifiers: Set<string>): RouterUse[] {
  const uses: RouterUse[] = [];
  const appPattern = Array.from(appIdentifiers).map(escapeRegex).join('|');
  const appUseRouterRegex = new RegExp(
    `\\b(?:${appPattern})\\.use\\s*\\(\\s*([^,]+)\\s*,\\s*(\\w+)\\s*\\)`,
    'g'
  );
  let m: RegExpExecArray | null;
  while ((m = appUseRouterRegex.exec(text)) !== null) {
    const expr = m[1].trim();
    const routerIdent = m[2].trim();
    uses.push({ prefixExpr: expr, routerIdent });
  }
  return uses;
}

function collectNestedRouterUses(text: string, routerIdentifiers: Set<string>): RouterUse[] {
  const uses: RouterUse[] = [];
  const routerPattern = Array.from(routerIdentifiers).map(escapeRegex).join('|');
  const nestedRouterUseRegex = new RegExp(
    `\\b(?:${routerPattern})\\.use\\s*\\(\\s*([^,]+)\\s*,\\s*(\\w+)\\s*\\)`,
    'g'
  );
  let m: RegExpExecArray | null;
  while ((m = nestedRouterUseRegex.exec(text)) !== null) {
    const expr = m[1].trim();
    const routerIdent = m[2].trim();
    uses.push({ prefixExpr: expr, routerIdent });
  }
  return uses;
}

function collectRoutes(
  doc: vscode.TextDocument,
  text: string,
  constValues: Record<string, string>,
  receivers: KnownReceivers
): LocalRoute[] {
  const routes: LocalRoute[] = [];
  const receiverPattern = Array.from(
    new Set([...receivers.appIdentifiers, ...receivers.routerIdentifiers])
  )
    .map(escapeRegex)
    .join('|');
  const methodPattern = '(get|post|put|delete|patch|options|head|all)';

  const directRouteRegex = new RegExp(
    `\\b(${receiverPattern})\\s*(?:\\.\\s*${methodPattern}|\\[\\s*['"]?${methodPattern}['"]?\\s*\\])\\s*\\(`,
    'gi'
  );

  let mDirect: RegExpExecArray | null;
  while ((mDirect = directRouteRegex.exec(text)) !== null) {
    const receiverIdent = mDirect[1];
    const method = (mDirect[2] || mDirect[3] || '').toUpperCase();
    const openParenIndex = mDirect.index + mDirect[0].lastIndexOf('(');
    const argInfo = extractFirstArgument(text, openParenIndex + 1);

    if (!argInfo || !argInfo.expr) {
      continue;
    }

    directRouteRegex.lastIndex = Math.max(directRouteRegex.lastIndex, argInfo.endIndex + 1);

    const rawExpr = argInfo.expr.trim();
    const index = mDirect.index;
    const position = doc.positionAt(index);
    const pathExprs = splitRoutePathExpressions(rawExpr);

    for (const pathExpr of pathExprs) {
      const resolvedPath = resolvePathExpression(pathExpr, constValues);
      const bestPath = resolvedPath ?? fallbackPathFromExpression(pathExpr);

      routes.push({
        method,
        path: bestPath,
        pathExpression: pathExpr,
        resolvedPath,
        line: position.line,
        column: position.character,
        receiver: receivers.appIdentifiers.has(receiverIdent) ? 'app' : 'router'
      });
    }
  }

  const routeChainRegex = new RegExp(`\\b(${receiverPattern})\\.route\\s*\\(`, 'gi');
  let mChain: RegExpExecArray | null;

  while ((mChain = routeChainRegex.exec(text)) !== null) {
    const receiverIdent = mChain[1];
    const openParenIndex = mChain.index + mChain[0].lastIndexOf('(');
    const argInfo = extractFirstArgument(text, openParenIndex + 1);

    if (!argInfo || !argInfo.expr) continue;

    const callCloseIndex = findCallCloseIndex(text, openParenIndex);
    if (callCloseIndex === -1) continue;

    const chainText = text.slice(callCloseIndex, callCloseIndex + 400);
    const methodRegex = /\.\s*(get|post|put|delete|patch|options|head|all)\s*\(/gi;
    let mMethod: RegExpExecArray | null;

    const pathExprs = splitRoutePathExpressions(argInfo.expr.trim());

    while ((mMethod = methodRegex.exec(chainText)) !== null) {
      const method = mMethod[1].toUpperCase();
      const methodPosition = doc.positionAt(callCloseIndex + mMethod.index);

      for (const pathExpr of pathExprs) {
        const resolvedPath = resolvePathExpression(pathExpr, constValues);
        const bestPath = resolvedPath ?? fallbackPathFromExpression(pathExpr);

        routes.push({
          method,
          path: bestPath,
          pathExpression: pathExpr,
          resolvedPath,
          line: methodPosition.line,
          column: methodPosition.character,
          receiver: receivers.appIdentifiers.has(receiverIdent) ? 'app' : 'router'
        });
      }
    }
  }

  return routes;
}

function extractFirstArgument(
  text: string,
  startIndex: number
): { expr: string; endIndex: number } | undefined {
  let expr = '';
  let inString: string | null = null;
  let escaped = false;
  let depth = 0;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      expr += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      expr += ch;
      escaped = true;
      continue;
    }

    if (inString) {
      expr += ch;
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      expr += ch;
      inString = ch;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      expr += ch;
      continue;
    }

    if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) {
      depth--;
      expr += ch;
      continue;
    }

    if ((ch === ',' || ch === ')') && depth === 0) {
      return { expr: expr.trim(), endIndex: i };
    }

    expr += ch;
  }

  if (expr.trim()) {
    return { expr: expr.trim(), endIndex: text.length };
  }

  return undefined;
}

function findCallCloseIndex(text: string, openParenIndex: number): number {
  let depth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = openParenIndex; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (inString) {
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '(') {
      depth++;
      continue;
    }

    if (ch === ')') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }

  return -1;
}

function collectConstValues(text: string): Record<string, string> {
  const constValues: Record<string, string> = {};
  const assignments: { varName: string; expr: string }[] = [];

  const assignmentRegex = /\b(?:const|let|var)\s+(\w+)\s*=\s*([^\r\n;]+)/g;
  let match: RegExpExecArray | null;
  while ((match = assignmentRegex.exec(text)) !== null) {
    const varName = match[1];
    const expr = unwrapParens(match[2].trim());
    assignments.push({ varName, expr });
  }

  let remaining = assignments;
  let madeProgress = true;

  while (remaining.length && madeProgress) {
    madeProgress = false;
    const nextRemaining: { varName: string; expr: string }[] = [];

    for (const assignment of remaining) {
      const resolved = resolvePathExpression(assignment.expr, constValues);
      if (resolved) {
        constValues[assignment.varName] = normalizePath(resolved);
        madeProgress = true;
      } else {
        nextRemaining.push(assignment);
      }
    }

    remaining = nextRemaining;
  }

  return constValues;
}
