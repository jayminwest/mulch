// Process-wide runtime flags set during CLI bootstrap. Mirrors the
// setQuiet/isQuiet pattern in palette.ts so global CLI options can opt
// commands out of strict policies without threading the flag through
// every function signature.

let _allowUnknownTypes = false;
let _allowDomainMismatch = false;

export function setAllowUnknownTypes(value: boolean): void {
	_allowUnknownTypes = value;
}

export function isAllowUnknownTypes(): boolean {
	return _allowUnknownTypes;
}

export function setAllowDomainMismatch(value: boolean): void {
	_allowDomainMismatch = value;
}

export function isAllowDomainMismatch(): boolean {
	return _allowDomainMismatch;
}

export function resetRuntimeFlags(): void {
	_allowUnknownTypes = false;
	_allowDomainMismatch = false;
}
