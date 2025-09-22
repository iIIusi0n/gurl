import * as vscode from 'vscode';

export type HandlerParams = {
	pathParams: string[];
	queryParams: string[];
	headers: string[];
	cookies: string[];
	bodyType: 'json' | 'form' | 'multipart' | 'none' | 'unknown';
	jsonStructName?: string;
	jsonFields?: Array<{ name: string; goType: string }>;
};

export type HandlerFunction = {
	name: string;
	filePath: string;
	nameRange?: vscode.Range;
	contextParamName?: string;
	ginAlias: string;
	params: HandlerParams;
};

export type RouteRegistration = {
	method: string; // GET, POST, ...
	path: string;
	handlerName: string;
	filePath: string;
	range?: vscode.Range;
};

export type ScanResult = {
	ginAlias: string;
	handlers: HandlerFunction[];
	routes: RouteRegistration[];
};

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];
const METHOD_ANY = 'ANY';

function detectGinAliasFromImports(text: string): string {
	// Try to find: import \"github.com/gin-gonic/gin\" or alias \"ginx\"
	// Handle both single-line and block imports
	const importBlockRegex = /import\s*\(([^]*?)\)/g;
	let match: RegExpExecArray | null;
	while ((match = importBlockRegex.exec(text))) {
		const block = match[1];
		const aliasLine = /\n\s*([a-zA-Z_][a-zA-Z0-9_]*)?\s*\"github.com\/gin-gonic\/gin\"/g;
		let aliasMatch: RegExpExecArray | null;
		while ((aliasMatch = aliasLine.exec(block))) {
			const alias = aliasMatch[1];
			return alias || 'gin';
		}
	}
	// Single import
	const singleImport = /import\s+([a-zA-Z_][a-zA-Z0-9_]*)?\s*\"github.com\/gin-gonic\/gin\"/;
	const m = singleImport.exec(text);
	if (m) {
		return m[1] || 'gin';
	}
	return 'gin';
}

function buildPositionResolver(doc: vscode.TextDocument) {
	return (index: number) => doc.positionAt(index);
}

function extractContextParamName(signatureParams: string, ginAlias: string): string | undefined {
	// e.g., c *gin.Context or ctx *alias.Context
	const re = new RegExp(`([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\*\\s*${ginAlias}\\.Context`);
	const m = re.exec(signatureParams);
	return m ? m[1] : undefined;
}

function inferParamsFromBody(body: string, ctxVar: string | undefined, ginAlias: string, fullText: string): HandlerParams {
	const params: HandlerParams = {
		pathParams: [],
		queryParams: [],
		headers: [],
		cookies: [],
		bodyType: 'unknown',
	};

	const c = ctxVar || '[a-zA-Z_][a-zA-Z0-9_]*';
	const cPattern = `${c}`;

	// Body detection
	const jsonBind = new RegExp(`${cPattern}\\.(ShouldBindJSON|BindJSON)\\s*\\(`);
	const formBind = new RegExp(`${cPattern}\\.(PostForm)\\s*\\(`);
	const multipart = new RegExp(`${cPattern}\\.(FormFile|MultipartForm)\\b`);
	const queryBind = new RegExp(`${cPattern}\\.(ShouldBindQuery|BindQuery)\\s*\\(`);
	const genericBind = new RegExp(`${cPattern}\\.(ShouldBind|Bind)\\s*\\(`);
	if (jsonBind.test(body)) {
		params.bodyType = 'json';
	} else if (multipart.test(body)) {
		params.bodyType = 'multipart';
	} else if (formBind.test(body)) {
		params.bodyType = 'form';
	} else if (queryBind.test(body)) {
		params.bodyType = 'none';
	} else if (genericBind.test(body)) {
		// Ambiguous without suffix; do not assume JSON. Prefer none.
		params.bodyType = 'none';
	} else {
		params.bodyType = 'none';
	}

	// If JSON body, try to infer struct type and its fields from bindings
	if (params.bodyType === 'json') {
		// Prefer explicit struct literal binding: c.BindJSON(&Type{...})
		let tm: RegExpExecArray | null;
		const structLit = new RegExp(`${cPattern}\\.(ShouldBindJSON|BindJSON|ShouldBind|Bind)\\s*\\(\\s*&\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\{`, 'g');
		if ((tm = structLit.exec(body))) {
			params.jsonStructName = tm[2];
			params.jsonFields = extractStructFieldsFromText(fullText, params.jsonStructName);
		} else {
			// Address of variable: c.BindJSON(&var)
			const addrVar = new RegExp(`${cPattern}\\.(ShouldBindJSON|BindJSON|ShouldBind|Bind)\\s*\\(\\s*&\\s*([a-zA-Z_][a-zA-Z0-9_]*)`, 'g');
			if ((tm = addrVar.exec(body))) {
				const varName = tm[2];
				const typeName = findVarTypeInText(fullText, varName);
				if (typeName) {
					params.jsonStructName = typeName;
					params.jsonFields = extractStructFieldsFromText(fullText, typeName);
				}
			}
		}
	}

	// Query params like c.Query("q") or c.DefaultQuery("q", "v")
	const qpRe = new RegExp(`${cPattern}\\.(Query|DefaultQuery|QueryArray|QueryMap)\\s*\\(\\s*\"([^"]+)\"`, 'g');
	let m: RegExpExecArray | null;
	while ((m = qpRe.exec(body))) {
		params.queryParams.push(m[2]);
	}

	// Path params like c.Param("id")
	const ppRe = new RegExp(`${cPattern}\\.Param\\s*\\(\\s*\"([^"]+)\"`, 'g');
	while ((m = ppRe.exec(body))) {
		params.pathParams.push(m[1]);
	}

	// Headers like c.GetHeader("Authorization") or c.Request.Header.Get("Authorization")
	const ghRe = new RegExp(`${cPattern}\\.GetHeader\\s*\\(\\s*\"([^"]+)\"`, 'g');
	while ((m = ghRe.exec(body))) {
		params.headers.push(m[1]);
	}
	const rhRe = new RegExp(`${cPattern}\\.Request\\.Header\\.Get\\s*\\(\\s*\"([^"]+)\"`, 'g');
	while ((m = rhRe.exec(body))) {
		params.headers.push(m[1]);
	}

	// Cookies: c.Cookie("session")
	const ckRe = new RegExp(`${cPattern}\\.Cookie\\s*\\(\\s*\"([^"]+)\"`, 'g');
	while ((m = ckRe.exec(body))) {
		params.cookies.push(m[1]);
	}

	// Deduplicate
	params.pathParams = Array.from(new Set(params.pathParams));
	params.queryParams = Array.from(new Set(params.queryParams));
	params.headers = Array.from(new Set(params.headers));
	params.cookies = Array.from(new Set(params.cookies));

	return params;
}

function findVarTypeInText(text: string, varName: string): string | undefined {
	// var varName Type
	let m = new RegExp(`\\bvar\\s+${varName}\\s+\\*?([A-Za-z_][A-Za-z0-9_]*)\\b`).exec(text);
	if (m) { return m[1]; }
	// varName := &Type{...} or varName := Type{...}
	m = new RegExp(`\\b${varName}\\s*[:=]\\s*&?\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\{`).exec(text);
	if (m) { return m[1]; }
	// varName = &Type{...}
	m = new RegExp(`\\b${varName}\\s*=\\s*&?\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\{`).exec(text);
	if (m) { return m[1]; }
	// varName := new(Type)
	m = new RegExp(`\\b${varName}\\s*:=\\s*new\\(\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\)`).exec(text);
	if (m) { return m[1]; }
	return undefined;
}

function extractStructFieldsFromText(text: string, typeName: string): Array<{ name: string; goType: string }> {
	const defRe = new RegExp(`type\\s+${typeName}\\s+struct\\s*\\{([\\s\\S]*?)\\}`, 'm');
	const m = defRe.exec(text);
	if (!m) { return []; }
	const body = m[1];
	const lines = body.split(/\n/);
	const fields: Array<{ name: string; goType: string }> = [];
	for (const line of lines) {
		const fr = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+([^` \t]+)(?:\s+`([^`]*)`)?/.exec(line);
		if (!fr) { continue; }
		const goField = fr[1];
		const goType = fr[2];
		const tag = fr[3] || '';
		const jm = /json:\"([^\"]+)\"/.exec(tag);
		if (jm) {
			const name = jm[1].split(',')[0];
			if (name && name !== '-') { fields.push({ name, goType }); continue; }
		}
		// Fallback: lowerCamel from Go field
		fields.push({ name: lowerCamel(goField), goType });
	}
	// Deduplicate by name
	const seen = new Set<string>();
	const unique: Array<{ name: string; goType: string }> = [];
	for (const f of fields) { if (!seen.has(f.name)) { unique.push(f); seen.add(f.name); } }
	return unique;
}

function lowerCamel(s: string): string {
	if (!s) { return s; }
	return s.charAt(0).toLowerCase() + s.slice(1);
}

function findHandlersInText(doc: vscode.TextDocument, ginAlias: string): HandlerFunction[] {
	const text = doc.getText();
	const pos = buildPositionResolver(doc);
	const handlers: HandlerFunction[] = [];

	// Pattern 1: func (recv) Name(ctx *gin.Context) { ... }
	const pattern1 = new RegExp(
		`func\\s*(?:\\([^)]*\\)\\s*)?([A-Za-z_][A-Za-z0-9_]*)\\s*\\(([^)]*${ginAlias}\\.Context[^)]*)\\)\\s*\\{`,
		'g'
	);
	let m: RegExpExecArray | null;
	while ((m = pattern1.exec(text))) {
		const name = m[1];
		const paramsSig = m[2];
		const startIndex = pattern1.lastIndex - 1; // at '{'
		const bodyStart = startIndex;
		const bodyEnd = findMatchingBrace(text, bodyStart);
		const contextParamName = extractContextParamName(paramsSig, ginAlias);
		const bodyText = bodyEnd > bodyStart ? text.slice(bodyStart, bodyEnd + 1) : '';
		const params = inferParamsFromBody(bodyText, contextParamName, ginAlias, text);
		handlers.push({
			name,
			filePath: doc.uri.fsPath,
			nameRange: new vscode.Range(pos(m.index), pos(m.index + name.length)),
			contextParamName,
			ginAlias,
			params,
		});
	}

	// Pattern 2: func Name() gin.HandlerFunc { return func(c *gin.Context) { ... } }
	// Allow optional parentheses around return type
	const pattern2 = new RegExp(
		`func\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*\\(\\s*\\)\\s*(?:\\(${ginAlias}\\.HandlerFunc\\)|${ginAlias}\\.HandlerFunc)\\s*\\{`,
		'g'
	);
	while ((m = pattern2.exec(text))) {
		const name = m[1];
		const startIndex = pattern2.lastIndex - 1;
		const bodyEnd = findMatchingBrace(text, startIndex);
		const inner = text.slice(startIndex, bodyEnd + 1);
		// Find context var in returned handler if present
		const innerCtxParam = new RegExp(`func\\s*\\(\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\*\\s*${ginAlias}\\.Context\\s*\\)`);
		const im = innerCtxParam.exec(inner);
		const ctxVar = im ? im[1] : undefined;
		const params = inferParamsFromBody(inner, ctxVar, ginAlias, text);
		handlers.push({
			name,
			filePath: doc.uri.fsPath,
			nameRange: new vscode.Range(pos(m.index), pos(m.index + name.length)),
			contextParamName: ctxVar,
			ginAlias,
			params,
		});
	}

	// Pattern 2b: method receiver returning gin.HandlerFunc
	// Example: func (h *X) Name() gin.HandlerFunc { return func(c *gin.Context) { ... } }
	const pattern2Method = new RegExp(
		`func\\s*\\([^)]*\\)\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\(\\s*\\)\\s*(?:\\(${ginAlias}\\.HandlerFunc\\)|${ginAlias}\\.HandlerFunc)\\s*\\{`,
		'g'
	);
	while ((m = pattern2Method.exec(text))) {
		const name = m[1];
		const startIndex = pattern2Method.lastIndex - 1;
		const bodyEnd = findMatchingBrace(text, startIndex);
		const inner = text.slice(startIndex, bodyEnd + 1);
		const innerCtxParam = new RegExp(`func\\s*\\(\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\*\\s*${ginAlias}\\.Context\\s*\\)`);
		const im = innerCtxParam.exec(inner);
		const ctxVar = im ? im[1] : undefined;
		const params = inferParamsFromBody(inner, ctxVar, ginAlias, text);
		handlers.push({
			name,
			filePath: doc.uri.fsPath,
			nameRange: new vscode.Range(pos(m.index), pos(m.index + name.length)),
			contextParamName: ctxVar,
			ginAlias,
			params,
		});
	}

	return handlers;
}

function findRoutesInText(doc: vscode.TextDocument, handlers: HandlerFunction[]): RouteRegistration[] {
	const text = doc.getText();
	const pos = buildPositionResolver(doc);
	const routes: RouteRegistration[] = [];
	const handlerNames = new Set(handlers.map(h => h.name));
	const ginAlias = detectGinAliasFromImports(text);
	const groupPrefixes = buildGroupPrefixMap(text, ginAlias);

	// router.GET("/path", Handler)
	const routeRegex = new RegExp(`\\b([a-zA-Z_][a-zA-Z0-9_]*)\\.(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\\s*\\(\\s*\"([^\"]*)\"\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\\s*\\(\\s*\\))?`, 'g');
	let m: RegExpExecArray | null;
	while ((m = routeRegex.exec(text))) {
		const recv = m[1];
		const method = m[2];
		const relPath = m[3];
		const handlerExpr = m[4];
		const handlerName = lastSegment(handlerExpr);
		if (!handlerNames.has(handlerName)) {
			continue;
		}
		const prefix = groupPrefixes.get(recv) || '';
		const path = joinPaths(prefix, relPath);
		routes.push({
			method,
			path,
			handlerName,
			filePath: doc.uri.fsPath,
			range: new vscode.Range(pos(m.index), pos(routeRegex.lastIndex)),
		});
	}

	// router.Handle("METHOD", "/path", Handler)
	const handleRegex = new RegExp(`\\b([a-zA-Z_][a-zA-Z0-9_]*)\\.Handle\\s*\\(\\s*\"([A-Z]+)\"\\s*,\\s*\"([^\"]*)\"\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\\s*\\(\\s*\\))?`, 'g');
	while ((m = handleRegex.exec(text))) {
		const recv = m[1];
		const method = m[2];
		const relPath = m[3];
		const handlerExpr = m[4];
		const handlerName = lastSegment(handlerExpr);
		if (!HTTP_METHODS.includes(method) || !handlerNames.has(handlerName)) {
			continue;
		}
		const prefix = groupPrefixes.get(recv) || '';
		const path = joinPaths(prefix, relPath);
		routes.push({
			method,
			path,
			handlerName,
			filePath: doc.uri.fsPath,
			range: new vscode.Range(pos(m.index), pos(handleRegex.lastIndex)),
		});
	}

	// Any: recv.Any("/path", Handler)
	const anyRegex = new RegExp(`\\b([a-zA-Z_][a-zA-Z0-9_]*)\\.Any\\s*\\(\\s*\"([^\"]*)\"\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\\s*\\(\\s*\\))?`, 'g');
	while ((m = anyRegex.exec(text))) {
		const recv = m[1];
		const relPath = m[2];
		const handlerExpr = m[3];
		const handlerName = lastSegment(handlerExpr);
		if (!handlerNames.has(handlerName)) { continue; }
		const prefix = groupPrefixes.get(recv) || '';
		const path = joinPaths(prefix, relPath);
		routes.push({ method: METHOD_ANY, path, handlerName, filePath: doc.uri.fsPath, range: new vscode.Range(pos(m.index), pos(anyRegex.lastIndex)) });
	}

	return routes;
}

function findRoutesInTextByNames(doc: vscode.TextDocument, handlerNames: Set<string>): RouteRegistration[] {
	const text = doc.getText();
	const pos = buildPositionResolver(doc);
	const routes: RouteRegistration[] = [];
	const ginAlias = detectGinAliasFromImports(text);
	const groupPrefixes = buildGroupPrefixMap(text, ginAlias);

	const routeRegex = new RegExp(`\\b([a-zA-Z_][a-zA-Z0-9_]*)\\.(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\\s*\\(\\s*\"([^\"]*)\"\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\\s*\\(\\s*\\))?`, 'g');
	let m: RegExpExecArray | null;
	while ((m = routeRegex.exec(text))) {
		const recv = m[1];
		const method = m[2];
		const relPath = m[3];
		const handlerExpr = m[4];
		const handlerName = lastSegment(handlerExpr);
		if (!handlerNames.has(handlerName)) { continue; }
		const prefix = groupPrefixes.get(recv) || '';
		const path = joinPaths(prefix, relPath);
		routes.push({ method, path, handlerName, filePath: doc.uri.fsPath, range: new vscode.Range(pos(m.index), pos(routeRegex.lastIndex)) });
	}

	const handleRegex = new RegExp(`\\b([a-zA-Z_][a-zA-Z0-9_]*)\\.Handle\\s*\\(\\s*\"([A-Z]+)\"\\s*,\\s*\"([^\"]*)\"\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\\s*\\(\\s*\\))?`, 'g');
	while ((m = handleRegex.exec(text))) {
		const recv = m[1];
		const method = m[2];
		const relPath = m[3];
		const handlerExpr = m[4];
		const handlerName = lastSegment(handlerExpr);
		if (!HTTP_METHODS.includes(method) || !handlerNames.has(handlerName)) { continue; }
		const prefix = groupPrefixes.get(recv) || '';
		const path = joinPaths(prefix, relPath);
		routes.push({ method, path, handlerName, filePath: doc.uri.fsPath, range: new vscode.Range(pos(m.index), pos(handleRegex.lastIndex)) });
	}

	const anyRegex = new RegExp(`\\b([a-zA-Z_][a-zA-Z0-9_]*)\\.Any\\s*\\(\\s*\"([^\"]*)\"\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\\s*\\(\\s*\\))?`, 'g');
	while ((m = anyRegex.exec(text))) {
		const recv = m[1];
		const relPath = m[2];
		const handlerExpr = m[3];
		const handlerName = lastSegment(handlerExpr);
		if (!handlerNames.has(handlerName)) { continue; }
		const prefix = groupPrefixes.get(recv) || '';
		const path = joinPaths(prefix, relPath);
		routes.push({ method: METHOD_ANY, path, handlerName, filePath: doc.uri.fsPath, range: new vscode.Range(pos(m.index), pos(anyRegex.lastIndex)) });
	}

	return routes;
}

function findMatchingBrace(text: string, openIndex: number): number {
	let depth = 0;
	for (let i = openIndex; i < text.length; i++) {
		const ch = text[i];
		if (ch === '{') { depth++; }
		else if (ch === '}') { depth--; if (depth === 0) { return i; } }
	}
	return -1;
}

export async function scanWorkspace(): Promise<{ handlers: HandlerFunction[]; routes: RouteRegistration[] }> {
	const goFiles = await vscode.workspace.findFiles('**/*.go', '**/{vendor,.git}/**');
	const handlers: HandlerFunction[] = [];
	const docs: vscode.TextDocument[] = [];

	for (const uri of goFiles) {
		const doc = await vscode.workspace.openTextDocument(uri);
		docs.push(doc);
		const ginAlias = detectGinAliasFromImports(doc.getText());
		const fileHandlers = findHandlersInText(doc, ginAlias);
		handlers.push(...fileHandlers);
	}

	const handlerNames = new Set(handlers.map(h => h.name));
	const routes: RouteRegistration[] = [];
	for (const doc of docs) {
		routes.push(...findRoutesInTextByNames(doc, handlerNames));
	}

	return { handlers, routes };
}

export async function scanRoutesAcrossWorkspace(handlerNames?: string[]): Promise<RouteRegistration[]> {
	const goFiles = await vscode.workspace.findFiles('**/*.go', '**/{vendor,.git}/**');
	const docs: vscode.TextDocument[] = [];
	for (const uri of goFiles) {
		docs.push(await vscode.workspace.openTextDocument(uri));
	}
	const namesSet = handlerNames ? new Set(handlerNames) : new Set<string>();
	const routes: RouteRegistration[] = [];
	for (const doc of docs) {
		const text = doc.getText();
		const ginAlias = detectGinAliasFromImports(text);
		const groupPrefixes = buildGroupPrefixMap(text, ginAlias);
		const pos = buildPositionResolver(doc);
		let m: RegExpExecArray | null;

		if (!handlerNames) {
			const routeRegex = new RegExp(`\\b([a-zA-Z_][a-zA-Z0-9_]*)\\.(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\\s*\\(\\s*\"([^\"]*)\"\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)`, 'g');
			while ((m = routeRegex.exec(text))) {
				const recv = m[1];
				const method = m[2];
				const relPath = m[3];
				const handlerExpr = m[4];
				const handlerName = lastSegment(handlerExpr);
				const prefix = groupPrefixes.get(recv) || '';
				const path = joinPaths(prefix, relPath);
				routes.push({ method, path, handlerName, filePath: doc.uri.fsPath, range: new vscode.Range(pos(m.index), pos(routeRegex.lastIndex)) });
			}
			const handleRegex = new RegExp(`\\b([a-zA-Z_][a-zA-Z0-9_]*)\\.Handle\\s*\\(\\s*\"([A-Z]+)\"\\s*,\\s*\"([^\"]*)\"\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)`, 'g');
			while ((m = handleRegex.exec(text))) {
				if (!HTTP_METHODS.includes(m[2])) { continue; }
				const recv = m[1];
				const method = m[2];
				const relPath = m[3];
				const handlerExpr = m[4];
				const handlerName = lastSegment(handlerExpr);
				const prefix = groupPrefixes.get(recv) || '';
				const path = joinPaths(prefix, relPath);
				routes.push({ method, path, handlerName, filePath: doc.uri.fsPath, range: new vscode.Range(pos(m.index), pos(handleRegex.lastIndex)) });
			}
			const anyRegex = new RegExp(`\\b([a-zA-Z_][a-zA-Z0-9_]*)\\.Any\\s*\\(\\s*\"([^\"]*)\"\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)`, 'g');
			while ((m = anyRegex.exec(text))) {
				const recv = m[1];
				const relPath = m[2];
				const handlerExpr = m[3];
				const handlerName = lastSegment(handlerExpr);
				const prefix = groupPrefixes.get(recv) || '';
				const path = joinPaths(prefix, relPath);
				routes.push({ method: METHOD_ANY, path, handlerName, filePath: doc.uri.fsPath, range: new vscode.Range(pos(m.index), pos(anyRegex.lastIndex)) });
			}
		} else {
			routes.push(...findRoutesInTextByNames(doc, namesSet));
		}
	}
	return routes;
}

function buildGroupPrefixMap(text: string, ginAlias: string): Map<string, string> {
	const map = new Map<string, string>();

	// Detect root router variables: parameter like (r *gin.Engine) or assignments r := gin.Default()/New()
	const rootParam = new RegExp(`\\(\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\*\\s*${ginAlias}\\.Engine`);
	const pm = rootParam.exec(text);
	if (pm) { map.set(pm[1], ''); }

	const rootAssign = new RegExp(`\\b([a-zA-Z_][a-zA-Z0-9_]*)\\s*:=\\s*${ginAlias}\\.(?:Default|New)\\s*\\(`, 'g');
	let m: RegExpExecArray | null;
	while ((m = rootAssign.exec(text))) {
		map.set(m[1], '');
	}

	// Iteratively resolve group prefixes
	let updated = true;
	while (updated) {
		updated = false;
		// varName := base.Group("/prefix", ...)
		const groupRegex = new RegExp(`\\b([a-zA-Z_][a-zA-Z0-9_]*)\\s*[:=]=\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\.Group\\s*\\(\\s*\"([^\"]*)\"`, 'g');
		let gm: RegExpExecArray | null;
		while ((gm = groupRegex.exec(text))) {
			const child = gm[1];
			const base = gm[2];
			const rel = gm[3];
			const basePrefix = map.has(base) ? map.get(base)! : '';
			const full = joinPaths(basePrefix, rel);
			if (map.get(child) !== full) {
				map.set(child, full);
				updated = true;
			}
		}
	}

	return map;
}

function joinPaths(a: string, b: string): string {
	const left = a.endsWith('/') ? a.slice(0, -1) : a;
	const right = b.startsWith('/') ? b : `/${b}`;
	return (left || '') + right;
}

function lastSegment(qualified: string): string {
	const parts = qualified.split('.');
	return parts[parts.length - 1];
}

export async function scanDocument(doc: vscode.TextDocument): Promise<{ handlers: HandlerFunction[]; routes: RouteRegistration[] }> {
	const ginAlias = detectGinAliasFromImports(doc.getText());
	const handlers = findHandlersInText(doc, ginAlias);
	const routes = findRoutesInText(doc, handlers);
	return { handlers, routes };
}

export function linkHandlersToRoutes(handlers: HandlerFunction[], routes: RouteRegistration[]): Array<HandlerFunction & { routes: RouteRegistration[] }> {
	const map = new Map<string, RouteRegistration[]>();
	for (const r of routes) {
		const arr = map.get(r.handlerName) || [];
		arr.push(r);
		map.set(r.handlerName, arr);
	}
	return handlers.map(h => ({ ...h, routes: map.get(h.name) || [] }));
}


export async function detectBaseUrlFromWorkspace(): Promise<string | undefined> {
	const goFiles = await vscode.workspace.findFiles('**/*.go', '**/{vendor,.git}/**');
	let inferred: { scheme: 'http' | 'https'; hostPort: string } | undefined;
	for (const uri of goFiles) {
		const doc = await vscode.workspace.openTextDocument(uri);
		const text = doc.getText();
		let m: RegExpExecArray | null;
		// gin Engine Run(addr)
		const runRe = /\.[Rr]un(?:TLS)?\s*\(\s*"([^"]*)"/g;
		while ((m = runRe.exec(text))) {
			const addr = m[1];
			const isTLS = /\.RunTLS\s*\(/.test(text.slice(m.index - 10, m.index + 10));
			const hp = normalizeAddr(addr);
			if (hp) { inferred = { scheme: isTLS ? 'https' : 'http', hostPort: hp }; break; }
		}
		if (inferred) { break; }
		// http.ListenAndServe("host:port", handler)
		const listenRe = /http\.ListenAndServe\s*\(\s*"([^"]*)"/g;
		while ((m = listenRe.exec(text))) {
			const hp = normalizeAddr(m[1]);
			if (hp) { inferred = { scheme: 'http', hostPort: hp }; break; }
		}
		if (inferred) { break; }
	}
	if (inferred) { return `${inferred.scheme}://${inferred.hostPort}`; }
	// Fallback: if any Run() without args found, default :8080
	for (const uri of goFiles) {
		const doc = await vscode.workspace.openTextDocument(uri);
		const text = doc.getText();
		if (/\.[Rr]un\s*\(\s*\)/.test(text)) { return 'http://localhost:8080'; }
	}
	return undefined;
}

function normalizeAddr(addr: string): string | undefined {
	const a = addr.trim();
	if (!a) { return undefined; }
	if (a.startsWith(':')) { return `localhost${a}`; }
	if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(a)) { return a; }
	if (/^[A-Za-z0-9_.-]+:\d+$/.test(a)) { return a; }
	return undefined;
}

