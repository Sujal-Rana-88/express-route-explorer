import * as vscode from 'vscode';
import { RouteTreeProvider, RouteTreeItem } from './providers/routeTreeProvider';
import { RouteNode } from './routes/types';
import { getTesterHtml } from './view/testerHtml';

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const routeProvider = new RouteTreeProvider(workspaceFolder);

  const treeView = vscode.window.createTreeView('expressRouteExplorer', {
    treeDataProvider: routeProvider
  });

  context.subscriptions.push(treeView);

  const refreshCommand = vscode.commands.registerCommand('expressRouteExplorer.refresh', () => {
    routeProvider.refresh();
  });

  const openRouteCommand = vscode.commands.registerCommand(
    'expressRouteExplorer.openRoute',
    (item?: RouteTreeItem | RouteNode) => {
      const route = getRouteFromArgOrSelection(item, treeView);
      if (!route) {
        vscode.window.showInformationMessage('Select a route in the Express Routes view first.');
        return;
      }
      openRouteInEditor(route);
    }
  );

  const tryRouteCommand = vscode.commands.registerCommand(
    'expressRouteExplorer.tryRoute',
    (item?: RouteTreeItem | RouteNode) => {
      const route = getRouteFromArgOrSelection(item, treeView);
      if (!route) {
        vscode.window.showInformationMessage('Select a route in the Express Routes view first.');
        return;
      }
      openRouteTester(route, routeProvider, context);
    }
  );

  context.subscriptions.push(refreshCommand, openRouteCommand, tryRouteCommand);

  if (workspaceFolder) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolder, '**/*.{js,ts,jsx,tsx}')
    );

    const onFsEvent = (uri: vscode.Uri) => {
      if (uri.fsPath.includes('node_modules')) return;
      routeProvider.refresh();
    };

    watcher.onDidChange(onFsEvent, null, context.subscriptions);
    watcher.onDidCreate(onFsEvent, null, context.subscriptions);
    watcher.onDidDelete(onFsEvent, null, context.subscriptions);

    context.subscriptions.push(watcher);
  }

  routeProvider.refresh();
}

export function deactivate() {}

function getRouteFromArgOrSelection(
  item: RouteTreeItem | RouteNode | undefined,
  treeView: vscode.TreeView<RouteTreeItem>
): RouteNode | undefined {
  if (item instanceof RouteTreeItem) {
    return item.route;
  }

  if (item && (item as RouteNode).fileUri) {
    return item as RouteNode;
  }

  const selected = treeView.selection[0];
  if (selected) {
    return selected.route;
  }

  return undefined;
}

async function openRouteInEditor(route: RouteNode) {
  const doc = await vscode.workspace.openTextDocument(route.fileUri);
  const editor = await vscode.window.showTextDocument(doc);

  const position = new vscode.Position(route.line, route.column);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

function openRouteTester(
  route: RouteNode,
  provider: RouteTreeProvider,
  context: vscode.ExtensionContext
) {
  const panel = vscode.window.createWebviewPanel(
    'expressRouteTester',
    `Test ${route.method.toUpperCase()} ${route.fullPath || route.path}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  const base = (provider.getBaseUrl() || 'http://localhost:3000').replace(/\/+$/, '');
  const path = route.fullPath || route.path || '/';
  const url = base + (path.startsWith('/') ? path : `/${path}`);

  panel.webview.html = getTesterHtml(route.method.toUpperCase(), url);

  panel.webview.onDidReceiveMessage(
    async (message) => {
      if (message.type === 'sendRequest') {
        const { method, url, headersText, body } = message;
        try {
          let headers: Record<string, string> = {};
          if (headersText.trim()) {
            headers = JSON.parse(headersText);
          }

          const res = await fetch(url, {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : body || undefined
          });

          const text = await res.text();
          const headerObj: Record<string, string> = {};
          res.headers.forEach((value, key) => {
            headerObj[key] = value;
          });

          panel.webview.postMessage({
            type: 'response',
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            headers: headerObj,
            body: text
          });
        } catch (err: any) {
          panel.webview.postMessage({
            type: 'error',
            message: err?.message || String(err)
          });
        }
      }
    },
    undefined,
    context.subscriptions
  );
}
