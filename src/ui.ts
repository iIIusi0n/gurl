import * as vscode from 'vscode';
import { HandlerFunction, RouteRegistration } from './goScanner';
import { generateCurl, readOptions } from './curlGenerator';

export function showCurlQuickPick(handler: HandlerFunction, routes: RouteRegistration[]) {
	const items = (routes.length ? routes : [undefined]).map((r) => {
		const label = r ? `${r.method} ${r.path}` : `Unknown route for ${handler.name}`;
		return {
			label,
			route: r,
			detail: handler.filePath,
		};
	});
	return vscode.window.showQuickPick(items, {
		placeHolder: 'Select route to generate cURL',
		canPickMany: false,
	});
}

export async function showCurl(handler: HandlerFunction, route: RouteRegistration | undefined) {
	const opts = readOptions();
	const curl = generateCurl(handler, route, opts);
	const doc = await vscode.workspace.openTextDocument({ language: 'shellscript', content: curl });
	await vscode.window.showTextDocument(doc, { preview: true });
	return curl;
}

export async function copyCurlToClipboard(handler: HandlerFunction, route: RouteRegistration | undefined) {
	const opts = readOptions();
	const curl = generateCurl(handler, route, opts);
	await vscode.env.clipboard.writeText(curl);
	vscode.window.showInformationMessage('cURL copied to clipboard');
}

export class HandlerCodeLensProvider implements vscode.CodeLensProvider {
	private onDidChangeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.onDidChangeEmitter.event;

	provideCodeLenses(document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
		const text = document.getText();
		if (!text.includes('github.com/gin-gonic/gin')) { return []; }
		// Lightweight heuristic: find function names preceded by 'func' for lenses; our command will re-scan accurately
		const codeLenses: vscode.CodeLens[] = [];
		const regex = /func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
		let m: RegExpExecArray | null;
		while ((m = regex.exec(text))) {
			const start = document.positionAt(m.index);
			const range = new vscode.Range(start, start);
			codeLenses.push(new vscode.CodeLens(range, {
				title: 'gURL: Generate cURL',
				command: 'gurl.generateForSymbolAt',
				arguments: [document.uri, m[1], m.index],
			}));
		}
		return codeLenses;
	}

	refresh() { this.onDidChangeEmitter.fire(); }
}


