import * as vscode from 'vscode';
import { RouteTreeProvider, RouteNode } from './routeTree';

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  const routeProvider = new RouteTreeProvider(workspaceFolder);

  const treeView = vscode.window.createTreeView('expressRouteExplorer', {
    treeDataProvider: routeProvider
  });

  context.subscriptions.push(treeView);

  const refreshCommand = vscode.commands.registerCommand(
    'expressRouteExplorer.refresh',
    () => {
      routeProvider.refresh();
    }
  );

  const openRouteCommand = vscode.commands.registerCommand(
    'expressRouteExplorer.openRoute',
    (route: RouteNode) => openRouteInEditor(route)
  );

  context.subscriptions.push(refreshCommand, openRouteCommand);

  // Initial scan
  routeProvider.refresh();
}

export function deactivate() {}

async function openRouteInEditor(route: RouteNode) {
  const doc = await vscode.workspace.openTextDocument(route.fileUri);
  const editor = await vscode.window.showTextDocument(doc);

  const position = new vscode.Position(route.line, route.column);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenter
  );
}
