// Dependency-free: the startup gate imports this before anything else.
/** Supported runtimes: the Node 22, 24 and 26 lines, each tested. Odd-numbered lines are short-lived and not tested. */
export const SUPPORTED_NODE = { range: '^22.12.0 || ^24.0.0 || ^26.0.0', text: 'Node 22 (22.12 or later), Node 24 or Node 26' } as const;
export function supportedNode(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  return (major === 22 && minor >= 12) || major === 24 || major === 26;
}
