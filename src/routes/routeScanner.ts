import * as path from 'path';
import * as vscode from 'vscode';
import { FileAnalysis, analyzeDocument } from './documentAnalyzer';
import { resolvePathExpression, splitRoutePathExpressions } from './expressionResolver';
import { joinPaths, normalizeMountPrefix, normalizePath, stripExtension } from './pathUtils';
import { RouteNode, ScanResult } from './types';

export class RouteScanner {
  constructor(private readonly workspace: vscode.WorkspaceFolder | undefined) {}

  async scan(): Promise<ScanResult> {
    if (!this.workspace) {
      return { routes: [], baseUrl: undefined };
    }

    const baseUrl = await this.detectBaseUrl();

    const pattern = new vscode.RelativePattern(this.workspace, '**/*.{js,ts,jsx,tsx}');
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');

    const uriByNoExtAbs = new Map<string, vscode.Uri>();
    for (const file of files) {
      uriByNoExtAbs.set(stripExtension(file.fsPath), file);
    }

    const analyses: FileAnalysis[] = [];
    for (const file of files) {
      const doc = await vscode.workspace.openTextDocument(file);
      const analysis = analyzeDocument(doc);
      analyses.push(analysis);
    }

    const appPrefixByFile = new Map<string, string>();

    for (const fa of analyses) {
      const prefixes: string[] = [];
      for (const expr of fa.appUsePrefixExprs) {
        const pieces = splitRoutePathExpressions(expr);
        for (const piece of pieces) {
          const resolved = resolvePathExpression(piece, fa.constValues);
          if (resolved) prefixes.push(resolved);
        }
      }
      if (prefixes.length) {
        const longest = prefixes.reduce((acc, cur) => (cur.length > acc.length ? cur : acc));
        appPrefixByFile.set(fa.uri.fsPath, longest);
      }
    }

    const routerPrefixesByFile = new Map<string, Set<string>>();
    const mountEdges: { from: string; to: string; prefix: string }[] = [];

    for (const fa of analyses) {
      const dir = path.dirname(fa.uri.fsPath);
      const allRouterUses = [...fa.routerUses, ...fa.nestedRouterUses];

      for (const use of allRouterUses) {
        const prefixExprs = splitRoutePathExpressions(use.prefixExpr);
        for (const prefixExpr of prefixExprs) {
          const prefixResolved = resolvePathExpression(prefixExpr, fa.constValues);
          if (prefixResolved === undefined) continue;

          const routerUri = resolveRouterTarget(use.routerIdent, fa, uriByNoExtAbs, dir);
          if (!routerUri) continue;

          mountEdges.push({
            from: fa.uri.fsPath,
            to: routerUri.fsPath,
            prefix: prefixResolved
          });
        }
      }
    }

    const addPrefix = (file: string, prefix: string) => {
      const normalized = normalizeMountPrefix(prefix);
      const existing = routerPrefixesByFile.get(file) ?? new Set<string>();
      if (!existing.has(normalized)) {
        existing.add(normalized);
        routerPrefixesByFile.set(file, existing);
        return true;
      }
      return false;
    };

    for (const fa of analyses) {
      addPrefix(fa.uri.fsPath, '');
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of mountEdges) {
        const parents = routerPrefixesByFile.get(edge.from);
        if (!parents) continue;

        for (const parentPrefix of parents) {
          const combined =
            parentPrefix && edge.prefix
              ? joinPaths(parentPrefix, edge.prefix)
              : parentPrefix
                ? parentPrefix
                : normalizeMountPrefix(edge.prefix);

          if (addPrefix(edge.to, combined)) {
            changed = true;
          }
        }
      }
    }

    const allRoutes: RouteNode[] = [];

    for (const fa of analyses) {
      const appPrefix = appPrefixByFile.get(fa.uri.fsPath) || '';
      const routerPrefixes = Array.from(
        routerPrefixesByFile.get(fa.uri.fsPath) ?? new Set<string>()
      );

      for (const r of fa.routes) {
        const baseRoute = r.resolvedPath ?? r.path;
        const isConcreteRoute = !!r.resolvedPath || baseRoute.startsWith('/');
        const displayPath = isConcreteRoute ? normalizePath(baseRoute) : baseRoute || '/';

        if (r.receiver === 'router' && routerPrefixes.length > 0) {
          for (const prefix of routerPrefixes) {
            const normalizedPrefix = normalizePath(prefix);
            const fullPath = isConcreteRoute
              ? joinPaths(normalizedPrefix, baseRoute)
              : `${normalizedPrefix}${displayPath.startsWith('/') ? '' : '/'}${displayPath}`;

            allRoutes.push({
              method: r.method,
              path: displayPath,
              fullPath,
              rawPath: r.pathExpression,
              resolvedPath: r.resolvedPath,
              fileUri: fa.uri,
              line: r.line,
              column: r.column
            });
          }
        } else {
          const fullPath =
            r.receiver === 'app' && appPrefix
              ? isConcreteRoute
                ? joinPaths(appPrefix, baseRoute)
                : `${normalizePath(appPrefix)}${displayPath.startsWith('/') ? '' : '/'}${displayPath}`
              : displayPath.startsWith('/')
                ? normalizePath(displayPath)
                : normalizePath(`/${displayPath}`);

          allRoutes.push({
            method: r.method,
            path: displayPath,
            fullPath,
            rawPath: r.pathExpression,
            resolvedPath: r.resolvedPath,
            fileUri: fa.uri,
            line: r.line,
            column: r.column
          });
        }
      }
    }

    const uniqueMap = new Map<string, RouteNode>();
    for (const r of allRoutes) {
      const key = `${r.method}|${r.fullPath}|${r.fileUri.fsPath}|${r.line}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, r);
      }
    }

    const uniqueRoutes = Array.from(uniqueMap.values()).sort((a, b) => {
      const pathA = a.fullPath || a.path;
      const pathB = b.fullPath || b.path;
      if (pathA === pathB) return a.method.localeCompare(b.method);
      return pathA.localeCompare(pathB);
    });

    return { routes: uniqueRoutes, baseUrl };
  }

  private async detectBaseUrl(): Promise<string | undefined> {
    if (!this.workspace) return undefined;

    try {
      const envFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(this.workspace, '.env*'),
        undefined,
        3
      );

      for (const envFile of envFiles) {
        const doc = await vscode.workspace.openTextDocument(envFile);
        const text = doc.getText();

        const candidates = [
          'BASE_URL',
          'API_BASE_URL',
          'API_URL',
          'VITE_API_URL',
          'NEXT_PUBLIC_API_URL'
        ];

        for (const key of candidates) {
          const regex = new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm');
          const match = regex.exec(text);
          if (match && match[1]) {
            return match[1].trim();
          }
        }
      }
    } catch {
      // ignore
    }

    return undefined;
  }
}

function resolveRouterTarget(
  routerIdent: string,
  analysis: FileAnalysis,
  uriByNoExtAbs: Map<string, vscode.Uri>,
  dir: string
): vscode.Uri | undefined {
  const req = analysis.requires.find((r) => r.varName === routerIdent);
  if (req && req.requiredPath.startsWith('.')) {
    const absNoExt = stripExtension(path.resolve(dir, req.requiredPath));
    const routerUri = uriByNoExtAbs.get(absNoExt);
    if (routerUri) return routerUri;
  }

  const imp = analysis.imports.find((i) => i.varName === routerIdent);
  if (imp && imp.importPath.startsWith('.')) {
    const absNoExt = stripExtension(path.resolve(dir, imp.importPath));
    const routerUri = uriByNoExtAbs.get(absNoExt);
    if (routerUri) return routerUri;
  }

  return undefined;
}
