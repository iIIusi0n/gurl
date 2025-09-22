import * as vscode from 'vscode';
import { HandlerFunction, RouteRegistration } from './goScanner';

export type CurlGenerationOptions = {
	baseUrl: string;
	defaultHeaders: Record<string, string>;
	useHttpieStyle: boolean;
};

export function readOptions(): CurlGenerationOptions {
	const cfg = vscode.workspace.getConfiguration('gurl');
	const baseUrl = cfg.get<string>('baseUrl', 'http://localhost:8080');
	const defaultHeaders = cfg.get<Record<string, string>>('defaultHeaders', {});
	const useHttpieStyle = cfg.get<boolean>('useHttpieStyle', false);
	return { baseUrl, defaultHeaders, useHttpieStyle };
}

export function generateCurl(
	handler: HandlerFunction,
	route: RouteRegistration | undefined,
	opts: CurlGenerationOptions
): string {
	const method = (route?.method || 'GET').toUpperCase();
	const path = route?.path || `/${handler.name}`;

	// Build URL and path param placeholders
	let urlPath = path;
	for (const p of handler.params.pathParams) {
		// Gin typical syntax is :id. Replace :id with sample value <id>
		urlPath = urlPath.replace(new RegExp(`:${p}(?![A-Za-z0-9_])`, 'g'), `<${p}>`);
	}

	// Query string
	const queryPairs: string[] = [];
	for (const q of handler.params.queryParams) {
		queryPairs.push(`${encodeURIComponent(q)}=<${q}>`);
	}
	const queryString = queryPairs.length ? `?${queryPairs.join('&')}` : '';

	const headers: Record<string, string> = { ...opts.defaultHeaders };
	for (const h of handler.params.headers) {
		if (headers[h] !== undefined) { continue; }
		if (h.toLowerCase() === 'authorization') {
			headers[h] = 'Bearer <token>';
		} else {
			headers[h] = `<${normalizePlaceholder(h)}>`;
		}
	}

	// Cookies
	if (handler.params.cookies.length) {
		const cookieString = handler.params.cookies.map(n => `${n}=<${normalizePlaceholder(n)}>`).join('; ');
		headers['Cookie'] = cookieString;
	}

	// Body
	let dataFlag = '';
	let bodyPart = '';
	if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
		if (handler.params.bodyType === 'json') {
			headers['Content-Type'] = headers['Content-Type'] || 'application/json';
			dataFlag = '-d';
			if (handler.params.jsonFields && handler.params.jsonFields.length) {
				const obj: Record<string, unknown> = {};
				for (const f of handler.params.jsonFields) {
					obj[f.name] = sampleValueForGoType(f.goType, f.name);
				}
				bodyPart = shellQuote(JSON.stringify(obj, null, 2));
			} else {
				bodyPart = `'{}'`;
			}
		} else if (handler.params.bodyType === 'form') {
			headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
			dataFlag = '--data-urlencode';
			bodyPart = handler.params.queryParams.length ? `'${handler.params.queryParams[0]}=<${normalizePlaceholder(handler.params.queryParams[0])}>'` : `''`;
		} else if (handler.params.bodyType === 'multipart') {
			headers['Content-Type'] = headers['Content-Type'] || 'multipart/form-data';
			dataFlag = '-F';
			bodyPart = `'file=@<path_to_file>'`;
		} else {
			// default to no body
		}
	}

	const headerFlags = Object.entries(headers)
		.map(([k, v]) => `-H ${shellQuote(`${k}: ${v}`)}`)
		.join(' \\\n\t');

	const baseUrl = opts.baseUrl.replace(/\/$/, '');
	const url = `${baseUrl}${urlPath}${queryString}`;

	const parts: string[] = [];
	parts.push('curl');
	parts.push(`-X ${method}`);
	if (headerFlags) { parts.push(headerFlags); }
	if (dataFlag && bodyPart) { parts.push(`${dataFlag} ${bodyPart}`); }
	parts.push(shellQuote(url));

	return parts.join(' \\\n\t');
}

function normalizePlaceholder(name: string): string {
	return name.replace(/[^A-Za-z0-9_]+/g, '_');
}

function shellQuote(s: string): string {
	// Quote single quotes for POSIX sh
	if (s === '') { return "''"; }
	return `'${s.replace(/'/g, `'\''`)}'`;
}

function sampleValueForGoType(goType: string, fieldName: string): unknown {
	const base = goType.trim();
	if (base.startsWith('*')) { return sampleValueForGoType(base.slice(1), fieldName); }
	if (base.startsWith('[]')) { return [sampleValueForGoType(base.slice(2), fieldName)]; }
	if (/^map\[.*\]/.test(base)) { return { key: `<key>`, value: `<value>` }; }
	switch (base) {
		case 'string': return `<${normalizePlaceholder(fieldName)}>`;
		case 'int': case 'int8': case 'int16': case 'int32': case 'int64':
		case 'uint': case 'uint8': case 'uint16': case 'uint32': case 'uint64':
		case 'uintptr': return 0;
		case 'float32': case 'float64': return 0.0;
		case 'bool': return false;
		case 'time.Time': return new Date().toISOString();
		case 'json.RawMessage': return {};
		default:
			// Struct or alias: nest placeholder object minimally
			if (/^[A-Z][A-Za-z0-9_]*$/.test(base)) {
				return { [fieldName]: `<${normalizePlaceholder(fieldName)}>` };
			}
			return `<${normalizePlaceholder(fieldName)}>`;
	}
}


