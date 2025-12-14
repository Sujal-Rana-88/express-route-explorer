import { normalizePath } from './pathUtils';

export function unwrapParens(expr: string): string {
  let trimmed = expr.trim();
  while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) break;
    trimmed = inner;
  }
  return trimmed;
}

export function fallbackPathFromExpression(expr: string): string {
  const trimmed = unwrapParens(expr);

  const quoted = /^(['"`])([^]*?)\1$/.exec(trimmed);
  if (quoted) {
    return normalizePath(quoted[2]);
  }

  if (trimmed.startsWith('/')) {
    return normalizePath(trimmed);
  }

  return trimmed || '/';
}

export function splitRoutePathExpressions(expr: string): string[] {
  const trimmed = expr.trim();
  if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return [trimmed];
  }

  const inner = trimmed.slice(1, -1);
  const parts: string[] = [];
  let current = '';
  let inString: string | null = null;
  let escaped = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }

    if (inString) {
      current += ch;
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      current += ch;
      inString = ch;
      continue;
    }

    if (ch === ',') {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.length ? parts : [trimmed];
}

/**
 * Best-effort resolver for expressions:
 * - "/api/v1"
 * - API_PREFIX
 * - API_PREFIX + "/audio"
 * - `${API_PREFIX}/audio`
 * - path.join("/api", "v1")
 * - PREFIX || "/fallback"
 */
export function resolvePathExpression(
  expr: string,
  constValues: Record<string, string>
): string | undefined {
  expr = unwrapParens(expr.trim());

  const anyQuoteMatch = /^(['"`])([^]*?)\1$/.exec(expr);
  if (anyQuoteMatch) {
    const inner = anyQuoteMatch[2];

    const replaced = inner.replace(/\$\{([^}]+)\}/g, (_, varNameRaw: string) => {
      const varName = varNameRaw.trim();
      return constValues[varName] ?? '';
    });

    return normalizePath(replaced);
  }

  const templateMatch = /^`([^`]+)`$/.exec(expr);
  if (templateMatch) {
    let inner = templateMatch[1];

    inner = inner.replace(/\$\{([^}]+)\}/g, (_, varNameRaw: string) => {
      const varName = varNameRaw.trim();
      return constValues[varName] ?? '';
    });

    return normalizePath(inner);
  }

  if (expr.includes('||') || expr.includes('??')) {
    const parts = expr.split(/(?:\|\||\?\?)/).map((p) => p.trim());
    for (const part of parts) {
      const resolved = resolvePathExpression(part, constValues);
      if (resolved) return resolved;
    }
  }

  const pathJoinMatch = /^path\.join\s*\(([^)]+)\)$/i.exec(expr);
  if (pathJoinMatch) {
    const args = pathJoinMatch[1]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    if (args.length) {
      let built = '';
      for (const arg of args) {
        const resolvedArg = resolvePathExpression(arg, constValues);
        if (!resolvedArg) {
          built = '';
          break;
        }
        built = built ? `${built}/${resolvedArg.replace(/^\/+/, '')}` : normalizePath(resolvedArg);
      }
      if (built) {
        return normalizePath(built);
      }
    }
  }

  if (expr.includes('+')) {
    const parts = expr.split('+').map((p) => p.trim());
    let result = '';

    for (const part of parts) {
      const quoted = /^(['"`])([^]*?)\1$/.exec(part);
      if (quoted) {
        let inner = quoted[2];

        inner = inner.replace(/\$\{([^}]+)\}/g, (_, varNameRaw: string) => {
          const varName = varNameRaw.trim();
          return constValues[varName] ?? '';
        });

        result += inner;
      } else if (/^\w+$/.test(part) && Object.prototype.hasOwnProperty.call(constValues, part)) {
        result += constValues[part];
      } else {
        return undefined;
      }
    }

    return normalizePath(result);
  }

  if (/^\w+$/.test(expr) && Object.prototype.hasOwnProperty.call(constValues, expr)) {
    return normalizePath(constValues[expr]);
  }

  return undefined;
}
