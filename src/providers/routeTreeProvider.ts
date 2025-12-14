import * as path from 'path';
import * as vscode from 'vscode';
import { RouteScanner } from '../routes/routeScanner';
import { RouteNode } from '../routes/types';

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
  private readonly scanner: RouteScanner;

  constructor(private readonly workspace: vscode.WorkspaceFolder | undefined) {
    this.scanner = new RouteScanner(workspace);
  }

  refresh(): void {
    this.scanner
      .scan()
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

  getBaseUrl(): string | undefined {
    return this.baseUrl;
  }
}
