import * as vscode from 'vscode';
import { HandlerFunction, RouteRegistration, scanDocument, detectBaseUrlFromWorkspace } from './goScanner';
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
	const opts = await withInferredBaseUrl(readOptions());
	const curl = generateCurl(handler, route, opts);
	const doc = await vscode.workspace.openTextDocument({ language: 'shellscript', content: curl });
	await vscode.window.showTextDocument(doc, { preview: true });
	return curl;
}

let curlPanel: vscode.WebviewPanel | undefined;

export async function showCurlOverlay(handler: HandlerFunction, route: RouteRegistration | undefined) {
	const opts = await withInferredBaseUrl(readOptions());
	const curl = generateCurl(handler, route, opts);

	if (!curlPanel) {
		curlPanel = vscode.window.createWebviewPanel(
			'gurlCurlOverlay',
			'Generated cURL',
			vscode.ViewColumn.Beside,
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		curlPanel.onDidDispose(() => { curlPanel = undefined; });
		curlPanel.webview.onDidReceiveMessage(async (msg) => {
			if (msg?.type === 'copy' && typeof msg?.text === 'string') {
				await vscode.env.clipboard.writeText(msg.text);
				vscode.window.showInformationMessage('cURL copied to clipboard');
			}
		});
	}

	curlPanel.title = route ? `${route.method} ${route.path}` : `Generated cURL`;
	curlPanel.webview.html = getCurlHtml(curl, handler, route);
	curlPanel.reveal(curlPanel.viewColumn);
}

function getCurlHtml(curl: string, handler: HandlerFunction, route?: RouteRegistration): string {
	const escaped = curl.replace(/&/g, '&amp;').replace(/</g, '&lt;');
	const subtitle = route ? `${route.method} ${route.path}` : handler.name;
	return `<!DOCTYPE html>
	<html lang="en">
	<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<style>
		:root { color-scheme: light dark; }
		body {
			font-family: var(--vscode-font-family, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji");
			font-size: var(--vscode-font-size, 13px);
			color: var(--vscode-editor-foreground);
			background: var(--vscode-editor-background);
			margin: 0; padding: 16px;
		}
		h1 { font-size: 14px; margin: 0 0 8px 0; color: var(--vscode-foreground); }
		p { margin: 0 0 12px 0; opacity: 0.8; }
		pre {
			background: var(--vscode-editorWidget-background);
			border: 1px solid var(--vscode-editorWidget-border, transparent);
			padding: 12px; border-radius: 8px; overflow: auto; line-height: 1.4;
			color: var(--vscode-editor-foreground);
		}
		code {
			font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
			font-size: var(--vscode-editor-font-size, 12px);
		}
		.copy-link {
			margin-left: 8px;
			font-size: 12px;
			color: var(--vscode-textLink-foreground);
			cursor: pointer;
			text-decoration: underline;
			opacity: 0.9;
		}
		.copy-link:hover { opacity: 1; }
	</style>
	</head>
	<body>
		<h1>${subtitle} <span id="copy" class="copy-link">(copy)</span></h1>
		<pre><code>${escaped}</code></pre>
		<script>
			const vscode = acquireVsCodeApi();
			document.getElementById('copy').addEventListener('click', () => {
				vscode.postMessage({ type: 'copy', text: ${JSON.stringify(curl)} });
			});
		</script>
	</body>
	</html>`;
}

export async function copyCurlToClipboard(handler: HandlerFunction, route: RouteRegistration | undefined) {
	const opts = await withInferredBaseUrl(readOptions());
	const curl = generateCurl(handler, route, opts);
	await vscode.env.clipboard.writeText(curl);
	vscode.window.showInformationMessage('cURL copied to clipboard');
}

export class HandlerCodeLensProvider implements vscode.CodeLensProvider {
	private onDidChangeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.onDidChangeEmitter.event;

	async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
		const text = document.getText();
		if (!text.includes('github.com/gin-gonic/gin')) { return []; }
		// Use real handler detection so lenses only appear for Gin handlers
		const { handlers } = await scanDocument(document);
		const codeLenses: vscode.CodeLens[] = [];
		for (const handler of handlers) {
			const rangeStart = handler.nameRange ? handler.nameRange.start : new vscode.Position(0, 0);
			const range = new vscode.Range(rangeStart, rangeStart);
			codeLenses.push(new vscode.CodeLens(range, {
				title: 'gURL: Generate cURL',
				command: 'gurl.generateForSymbolAt',
				arguments: [document.uri, handler.name],
			}));
			codeLenses.push(new vscode.CodeLens(range, {
				title: 'copy',
				command: 'gurl.copyForSymbolAt',
				arguments: [document.uri, handler.name],
			}));
		}
		return codeLenses;
	}

	refresh() { this.onDidChangeEmitter.fire(); }
}

async function withInferredBaseUrl(opts: ReturnType<typeof readOptions>): Promise<ReturnType<typeof readOptions>> {
	// Only override if user hasn't changed default
	if (opts.baseUrl === 'http://localhost:8080') {
		const inferred = await detectBaseUrlFromWorkspace();
		if (inferred) { return { ...opts, baseUrl: inferred }; }
	}
	return opts;
}


