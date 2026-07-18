const paint = (code: number, value: string) => `\x1b[${code}m${value}\x1b[0m`;
export const color = { cyan: (v: string) => paint(36, v), indigo: (v: string) => paint(94, v), green: (v: string) => paint(32, v), yellow: (v: string) => paint(33, v), red: (v: string) => paint(31, v), dim: (v: string) => paint(2, v), bold: (v: string) => paint(1, v) };
