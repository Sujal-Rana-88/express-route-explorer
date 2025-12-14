export function normalizePath(p: string): string {
  if (!p) return '/';
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/+/g, '/');
  return p;
}

export function normalizeMountPrefix(p: string): string {
  if (!p || p === '/') return '';
  return normalizePath(p);
}

export function joinPaths(prefix: string, route: string): string {
  if (!prefix && !route) return '/';
  if (!prefix) return normalizePath(route);
  if (!route) return normalizePath(prefix);

  const joined = `${prefix.replace(/\/+$/, '')}/${route.replace(/^\/+/, '')}`;
  return normalizePath(joined);
}

export function stripExtension(fsPath: string): string {
  return fsPath.replace(/\.(js|ts|jsx|tsx)$/i, '');
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
