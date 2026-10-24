/** Pure nav ordering (D045). Discover first, then Events, then the existing-relationship paths. */
export interface NavEntry { href: string; label: string }

export function orderNav<T extends NavEntry>(discovery: readonly T[], others: readonly T[], isDiscoveryOn: boolean): T[] {
  return isDiscoveryOn ? [...discovery, ...others] : [...others];
}
