export type ReadingSession = {
  version?: number; extractionVersion?: string; pageNumber?: number;
  initialFen?: string; timeline?: string[]; cursor?: number; bookOrigins?: string[];
  orientation?: 'white'|'black'; documentGames?: unknown[]; continuationPrefix?: string[]; continuationNotation?: string;
  pages?: Record<string, {reviewed?: boolean; extractionInfo?: {cached?: boolean; source?: string}; [key:string]: unknown}>;
  [key:string]: unknown;
};

// Cache changes never invalidate the user's board, tree, mappings or corrections.
export function restoreReadingSession(saved: ReadingSession | undefined, extractionVersion: string): ReadingSession | undefined {
  if (!saved || ![1,2].includes(saved.version ?? 0)) return undefined;
  const pages = Object.fromEntries(Object.entries(saved.pages ?? {}).filter(([,page]) =>
    page.reviewed || saved.extractionVersion === extractionVersion));
  return {...saved, version:2, pages, extractionVersion};
}

export function compactPageCache(pages: NonNullable<ReadingSession['pages']>, current: number, limit=40) {
  const disposable=Object.keys(pages).filter(key=>!pages[key]?.reviewed && Number(key)!==current);
  while(disposable.length>limit) delete pages[disposable.shift()!];
  return pages;
}
