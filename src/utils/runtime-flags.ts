// Process-wide runtime flags set during CLI bootstrap. Mirrors the
// setQuiet/isQuiet pattern in palette.ts so global CLI options can opt
// commands out of strict policies without threading the flag through
// every function signature.

let _allowUnknownTypes = false;

export function setAllowUnknownTypes(value: boolean): void {
	_allowUnknownTypes = value;
}

export function isAllowUnknownTypes(): boolean {
	return _allowUnknownTypes;
}

export function resetRuntimeFlags(): void {
	_allowUnknownTypes = false;
}
