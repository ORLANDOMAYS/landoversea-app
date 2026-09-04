export interface DiscoveryFilters {
  minAge: number;
  maxAge: number;
  gender: string;
  location: string;
}
export function normalizeDiscoveryFilters(filters?: Partial<Record<keyof DiscoveryFilters, unknown>>): DiscoveryFilters;
export function translatedBodyOrNull(original: string, translated?: string | null): string | null;
export function restoreFailedDraft(currentDraft: string, failedDraft: string): string;
export function nextSwipeState(index: number, persisted: boolean): number;