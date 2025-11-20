import * as vscode from 'vscode';
import * as path from 'path';

export interface RouteNode {
  method: string;
  path: string;
  fileUri: vscode.Uri;
  line: number;
  column: number;
}

export class RouteTreeItem extends vscode.TreeItem {
  constructor(public readonly route: RouteNode) {
    super(`${route.method.toUpperCase()} ${route.path}`, vscode.TreeItemCollapsibleState.None);

    this.description = path.relative(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
      route.fileUri.fsPath
    );

    this.tooltip = `${route.method.toUpperCase()} ${route.path}\n${route.fileUri.fsPath}:${route.line + 1}`;

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

  constructor(private readonly workspace: vscode.WorkspaceFolder | undefined) {}

  refresh(): void {
    this.scanWorkspaceForRoutes()
      .then((routes) => {
        this.routes = routes;
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

  private async scanWorkspaceForRoutes(): Promise<RouteNode[]> {
    if (!this.workspace) {
      return [];
    }

    const pattern = new vscode.RelativePattern(this.workspace, '**/*.{js,ts}');
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');

    const routes: RouteNode[] = [];

    for (const file of files) {
      const doc = await vscode.workspace.openTextDocument(file);
      const text = doc.getText();

      const routeRegex =
        /\b(app|router)\.(get|post|put|delete|patch|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

      let match: RegExpExecArray | null;
      while ((match = routeRegex.exec(text)) !== null) {
        const method = match[2];
        const routePath = match[3];
        const index = match.index;

        const position = doc.positionAt(index);
        const line = position.line;
        const column = position.character;

        routes.push({
          method,
          path: routePath,
          fileUri: file,
          line,
          column
        });
      }
    }

    return routes.sort((a, b) => {
      if (a.path === b.path) return a.method.localeCompare(b.method);
      return a.path.localeCompare(b.path);
    });
  }
}
