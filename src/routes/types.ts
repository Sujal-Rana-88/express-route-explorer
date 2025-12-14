import * as vscode from 'vscode';

export interface RouteNode {
  method: string;
  /** Original path as written in the handler, e.g. "/update" */
  path: string;
  /** Best-guess full path including prefixes, e.g. "/api/v1/audio/chunk" */
  fullPath: string;
  /** Raw path expression if available (e.g. variable name or template) */
  rawPath?: string;
  /** Resolved concrete path if expression evaluation succeeded */
  resolvedPath?: string;
  fileUri: vscode.Uri;
  line: number;
  column: number;
}

export interface ScanResult {
  routes: RouteNode[];
  baseUrl?: string;
}
