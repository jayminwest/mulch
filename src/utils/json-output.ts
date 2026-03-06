export interface JsonResult {
	success: boolean;
	command: string;
	[key: string]: unknown;
}

export function outputJson(result: JsonResult): void {
	console.log(JSON.stringify(result, null, 2));
}

export function outputJsonError(command: string, error: string): void {
	console.error(JSON.stringify({ success: false, command, error }, null, 2));
}
