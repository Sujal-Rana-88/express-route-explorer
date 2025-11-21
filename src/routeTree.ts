import * as vscode from 'vscode';
import * as path from 'path';

export interface RouteNode {
  method: string;
  /** Original path as written in the handler, e.g. "/update" */
  path: string;
  /** Best-guess full path including prefixes, e.g. "/api/v1/audio/chunk" */
  fullPath: string;
  fileUri: vscode.Uri;
  line: number;
  column: number;
}

export class RouteTreeItem extends vscode.TreeItem {
  constructor(public readonly route: RouteNode) {
    super(
      `${route.method.toUpperCase()} ${route.fullPath || route.path}`,
      vscode.TreeItemCollapsibleState.None
    );

    this.description = path.relative(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
      route.fileUri.fsPath
    );

    this.tooltip =
      `${route.method.toUpperCase()} ${route.fullPath || route.path}\n` +
      `${route.fileUri.fsPath}:${route.line + 1}`;

    this.command = {
      command: 'expressRouteExplorer.openRoute',
      title: 'Open Route Handler',
      arguments: [route]
    };

    this.contextValue = 'expressRoute';
  }

  iconPath = new vscode.ThemeIcon('debug-stackframe');
}

export class RouteTreeProvider implements vscode.TreeDataProvider<RouteTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<RouteTreeItem | undefined | void> =
    new vscode.EventEmitter<RouteTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<RouteTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  private routes: RouteNode[] = [];
  private baseUrl: string | undefined;

  constructor(private readonly workspace: vscode.WorkspaceFolder | undefined) {}

  refresh(): void {
    this.scanWorkspaceForRoutes()
      .then(({ routes, baseUrl }) => {
        this.routes = routes;
        this.baseUrl = baseUrl;
        this._onDidChangeTreeData.fire();
      })
      .catch((err) => {
        vscode.window.showErrorMessage(`Express Route Explorer: ${err}`);
      });
  }

  getTreeItem(element: RouteTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: RouteTreeItem): Thenable<RouteTreeItem[]> {
    if (!this.workspace) {
      vscode.window.showInformationMessage('Open a folder to use Express Route Explorer.');
      return Promise.resolve([]);
    }

    if (element) {
      return Promise.resolve([]);
    }

    const items = this.routes.map((route) => new RouteTreeItem(route));
    return Promise.resolve(items);
  }

  /** Used by the "Try this API" webview to prefill base URL */
  getBaseUrl(): string | undefined {
    return this.baseUrl;
  }

  // -----------------------------
  // Route scanning & analysis
  // -----------------------------

  private async scanWorkspaceForRoutes(): Promise<{ routes: RouteNode[]; baseUrl?: string }> {
    if (!this.workspace) {
      return { routes: [], baseUrl: undefined };
    }

    const baseUrl = await this.detectBaseUrl();

    const pattern = new vscode.RelativePattern(this.workspace, '**/*.{js,ts,jsx,tsx}');
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');

    // Map from "absolute path without extension" -> uri
    const uriByNoExtAbs = new Map<string, vscode.Uri>();
    for (const file of files) {
      uriByNoExtAbs.set(stripExtension(file.fsPath), file);
    }

    // First pass: analyze each document separately
    const analyses: FileAnalysis[] = [];
    for (const file of files) {
      const doc = await vscode.workspace.openTextDocument(file);
      const analysis = analyzeDocument(doc);
      analyses.push(analysis);
    }

    // Second pass: compute prefixes

    // appPrefixByFile: prefix that applies to app.* routes in that file
    const appPrefixByFile = new Map<string, string>();

    for (const fa of analyses) {
      const prefixes: string[] = [];
      for (const expr of fa.appUsePrefixExprs) {
        const resolved = resolvePathExpression(expr, fa.constValues);
        if (resolved) prefixes.push(resolved);
      }
      if (prefixes.length) {
        const longest = prefixes.reduce((acc, cur) =>
          cur.length > acc.length ? cur : acc
        );
        appPrefixByFile.set(fa.uri.fsPath, longest);
      }
    }

    // routerPrefixesByFile: prefixes for router.* routes based on app.use(path, routerVar)
    const routerPrefixesByFile = new Map<string, string[]>();

    for (const fa of analyses) {
      const dir = path.dirname(fa.uri.fsPath);

      for (const use of fa.routerUses) {
        const prefix = resolvePathExpression(use.prefixExpr, fa.constValues);
        if (!prefix) continue;

        const req = fa.requires.find((r) => r.varName === use.routerIdent);
        if (!req) continue;

        // Only resolve relative paths like "./routes/..." or "../routes/..."
        if (!req.requiredPath.startsWith('.')) continue;

        const absNoExt = stripExtension(path.resolve(dir, req.requiredPath));
        const routerUri = uriByNoExtAbs.get(absNoExt);
        if (!routerUri) continue;

        const list = routerPrefixesByFile.get(routerUri.fsPath) ?? [];
        list.push(prefix);
        routerPrefixesByFile.set(routerUri.fsPath, list);
      }
    }

    // Third pass: build final RouteNodes with fullPath
    const allRoutes: RouteNode[] = [];

    for (const fa of analyses) {
      const appPrefix = appPrefixByFile.get(fa.uri.fsPath) || '';
      const routerPrefixes = routerPrefixesByFile.get(fa.uri.fsPath) || [];

      for (const r of fa.routes) {
        if (r.receiver === 'router' && routerPrefixes.length > 0) {
          // Mounted in server with one or more prefixes:
          //   app.use('/api/v1', audioStreamRoutes)
          //   app.use('/v2', audioStreamRoutes)
          for (const prefix of routerPrefixes) {
            allRoutes.push({
              method: r.method,
              path: r.path,
              fullPath: joinPaths(prefix, r.path),
              fileUri: fa.uri,
              line: r.line,
              column: r.column
            });
          }
        } else {
          // app.* routes or router.* without a known prefix
          const fullPath =
            r.receiver === 'app' && appPrefix
              ? joinPaths(appPrefix, r.path)
              : normalizePath(r.path);

          allRoutes.push({
            method: r.method,
            path: r.path,
            fullPath,
            fileUri: fa.uri,
            line: r.line,
            column: r.column
          });
        }
      }
    }

    // Dedup + sort
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

  /**
   * Very simple heuristic: looks for .env* in workspace root and tries to find
   * a line like BASE_URL=..., API_BASE_URL=..., VITE_API_URL=..., etc.
   */
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

// --------------------------------------
// Internal analysis helpers
// --------------------------------------

type Receiver = 'app' | 'router';

interface LocalRoute {
  method: string;
  path: string;
  line: number;
  column: number;
  receiver: Receiver;
}

interface RouterUse {
  prefixExpr: string;  // first arg of app.use(...)
  routerIdent: string; // second arg identifier (audioStreamRoutes)
}

interface RequireEntry {
  varName: string;     // audioStreamRoutes
  requiredPath: string; // '../routes/audioStreamRoutes'
}

interface FileAnalysis {
  uri: vscode.Uri;
  constValues: Record<string, string>;
  appUsePrefixExprs: string[];
  routerUses: RouterUse[];
  requires: RequireEntry[];
  routes: LocalRoute[];
}

function analyzeDocument(doc: vscode.TextDocument): FileAnalysis {
  const text = doc.getText();

  const constValues: Record<string, string> = {};
  const appUsePrefixExprs: string[] = [];
  const routerUses: RouterUse[] = [];
  const requires: RequireEntry[] = [];
  const routes: LocalRoute[] = [];

  // const API_PREFIX = "/api/v1";
  const constRegex = /const\s+(\w+)\s*=\s*(['"`])([^'"`]+)\2\s*;?/g;
  let mConst: RegExpExecArray | null;
  while ((mConst = constRegex.exec(text)) !== null) {
    const varName = mConst[1];
    const value = mConst[3];
    constValues[varName] = value;
  }

  // app.use("/api/v1", ...)
  const appUseAnyRegex = /\bapp\.use\s*\(\s*([^,]+)\s*,/g;
  let mUseAny: RegExpExecArray | null;
  while ((mUseAny = appUseAnyRegex.exec(text)) !== null) {
    const expr = mUseAny[1].trim();
    appUsePrefixExprs.push(expr);
  }

  // app.use("/api/v1", audioStreamRoutes)
  const appUseRouterRegex = /\bapp\.use\s*\(\s*([^,]+)\s*,\s*(\w+)\s*\)/g;
  let mUseRouter: RegExpExecArray | null;
  while ((mUseRouter = appUseRouterRegex.exec(text)) !== null) {
    const expr = mUseRouter[1].trim();
    const routerIdent = mUseRouter[2].trim();
    routerUses.push({ prefixExpr: expr, routerIdent });
  }

  // const audioStreamRoutes = require("../routes/audioStreamRoutes");
  const requireRegex =
    /const\s+(\w+)\s*=\s*require\(\s*(['"`])([^'"`]+)\2\s*\)/g;
  let mReq: RegExpExecArray | null;
  while ((mReq = requireRegex.exec(text)) !== null) {
    const varName = mReq[1];
    const requiredPath = mReq[3];
    requires.push({ varName, requiredPath });
  }

  // app.get("/path", ...), router.post("/path", ...)
  const routeRegex =
    /\b(app|router)\.(get|post|put|delete|patch|options|head)\s*\(\s*(['"`])([^'"`]+)\3/gi;

  let match: RegExpExecArray | null;
  while ((match = routeRegex.exec(text)) !== null) {
    const receiver = match[1] as Receiver;
    const method = match[2].toUpperCase();
    const routePath = match[4];
    const index = match.index;

    const position = doc.positionAt(index);
    const line = position.line;
    const column = position.character;

    routes.push({
      method,
      path: normalizePath(routePath),
      line,
      column,
      receiver
    });
  }

  return {
    uri: doc.uri,
    constValues,
    appUsePrefixExprs,
    routerUses,
    requires,
    routes
  };
}

/**
 * Best-effort resolver for expressions:
 * - "/api/v1"
 * - API_PREFIX
 * - API_PREFIX + "/audio"
 * - `${API_PREFIX}/audio`
 */
function resolvePathExpression(
  expr: string,
  constValues: Record<string, string>
): string | undefined {
  expr = expr.trim();

  // -----------------------------
  // 1) Quoted literal (', ", or `)
  //    and may contain ${VAR}
  // -----------------------------
  const anyQuoteMatch = /^(['"`])([^]*?)\1$/.exec(expr);
  if (anyQuoteMatch) {
    const inner = anyQuoteMatch[2];

    // Replace ${VAR} inside the literal using constValues
    const replaced = inner.replace(/\$\{([^}]+)\}/g, (_, varNameRaw: string) => {
      const varName = varNameRaw.trim();
      return constValues[varName] ?? '';
    });

    return normalizePath(replaced);
  }

  // -----------------------------
  // 2) Template literal WITHOUT outer quotes
  //    (rare, but keep old behavior)
  // -----------------------------
  const templateMatch = /^`([^`]+)`$/.exec(expr);
  if (templateMatch) {
    let inner = templateMatch[1];

    inner = inner.replace(/\$\{([^}]+)\}/g, (_, varNameRaw: string) => {
      const varName = varNameRaw.trim();
      return constValues[varName] ?? '';
    });

    return normalizePath(inner);
  }

  // -----------------------------
  // 3) Concatenation: API_PREFIX + "/legal/:id"
  // -----------------------------
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
      } else if (/^\w+$/.test(part) && constValues[part]) {
        result += constValues[part];
      } else {
        // unsupported piece, bail out
        return undefined;
      }
    }

    return normalizePath(result);
  }

  // -----------------------------
  // 4) Simple variable: API_PREFIX
  // -----------------------------
  if (/^\w+$/.test(expr) && constValues[expr]) {
    return normalizePath(constValues[expr]);
  }

  return undefined;
}


function normalizePath(p: string): string {
  if (!p) return '/';
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/+/g, '/');
  return p;
}

function joinPaths(prefix: string, route: string): string {
  if (!prefix && !route) return '/';
  if (!prefix) return normalizePath(route);
  if (!route) return normalizePath(prefix);

  const joined = `${prefix.replace(/\/+$/, '')}/${route.replace(/^\/+/, '')}`;
  return normalizePath(joined);
}

function stripExtension(fsPath: string): string {
  return fsPath.replace(/\.(js|ts|jsx|tsx)$/i, '');
}
