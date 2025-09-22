// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { linkHandlersToRoutes, scanDocument, scanWorkspace, scanRoutesAcrossWorkspace } from './goScanner';
import { HandlerCodeLensProvider, showCurl, showCurlQuickPick, copyCurlToClipboard } from './ui';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "gurl" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const codeLensProvider = new HandlerCodeLensProvider();
	context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'go', scheme: 'file' }, codeLensProvider));

	context.subscriptions.push(vscode.commands.registerCommand('gurl.generateForFile', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { return; }
		const doc = editor.document;
		if (doc.languageId !== 'go') { vscode.window.showWarningMessage('Open a Go file.'); return; }
		const { handlers } = await scanDocument(doc);
		const routes = await scanRoutesAcrossWorkspace(handlers.map(h => h.name));
		const linked = linkHandlersToRoutes(handlers, routes);
		if (!linked.length) { vscode.window.showInformationMessage('No Gin handlers found in this file'); return; }
		const pick = await vscode.window.showQuickPick(linked.map(h => ({ label: h.name, description: h.routes.map(r => `${r.method} ${r.path}`).join(', '), handler: h })), { placeHolder: 'Select handler' });
		if (!pick) { return; }
		const routePick = await showCurlQuickPick(pick.handler, pick.handler.routes);
		if (!routePick) { return; }
		await showCurl(pick.handler, routePick.route);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('gurl.generateForWorkspace', async () => {
		const { handlers, routes } = await scanWorkspace();
		const linked = linkHandlersToRoutes(handlers, routes);
		if (!linked.length) { vscode.window.showInformationMessage('No Gin handlers found in workspace'); return; }
		const pick = await vscode.window.showQuickPick(linked.map(h => ({ label: h.name, description: h.routes.map(r => `${r.method} ${r.path}`).join(', '), handler: h })), { placeHolder: 'Select handler' });
		if (!pick) { return; }
		const routePick = await showCurlQuickPick(pick.handler, pick.handler.routes);
		if (!routePick) { return; }
		await showCurl(pick.handler, routePick.route);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('gurl.copyForSymbolAt', async (uri: vscode.Uri, functionName: string) => {
		const doc = await vscode.workspace.openTextDocument(uri);
		const { handlers } = await scanDocument(doc);
		const routes = await scanRoutesAcrossWorkspace(handlers.map(h => h.name));
		const linked = linkHandlersToRoutes(handlers, routes);
		const handler = linked.find(h => h.name === functionName);
		if (!handler) { vscode.window.showWarningMessage('No Gin handler for this symbol'); return; }
		const routePick = await showCurlQuickPick(handler, handler.routes);
		if (!routePick) { return; }
		await copyCurlToClipboard(handler, routePick.route);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('gurl.generateForSymbolAt', async (uri: vscode.Uri, functionName: string) => {
		const doc = await vscode.workspace.openTextDocument(uri);
		const { handlers } = await scanDocument(doc);
		const routes = await scanRoutesAcrossWorkspace(handlers.map(h => h.name));
		const linked = linkHandlersToRoutes(handlers, routes);
		const handler = linked.find(h => h.name === functionName);
		if (!handler) { vscode.window.showWarningMessage('No Gin handler for this symbol'); return; }
		const routePick = await showCurlQuickPick(handler, handler.routes);
		if (!routePick) { return; }
		await showCurl(handler, routePick.route);
	}));
}

// This method is called when your extension is deactivated
export function deactivate() {}
