import { validProjectUrl } from '../projects/project-url';

export interface ProjectLibraryRecord {
  id: string;
  name: string;
  url: string;
  updatedAt: number;
}

export interface ProjectStorage {
  loadNames(): Record<string, string>;
  loadLibrary(): ProjectLibraryRecord[];
  saveNames(names: Record<string, string>): boolean;
  saveLibrary(records: readonly ProjectLibraryRecord[]): boolean;
}

type StorageReader = (key: string) => string | null;
type StorageWriter = (key: string, value: string) => boolean;

export function parseProjectNames(value: string | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

export function parseProjectLibrary(value: string | null): ProjectLibraryRecord[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate): ProjectLibraryRecord[] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const record = candidate as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : '';
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const url = validProjectUrl(record.url, id);
      if (!id || !name || !url) return [];
      return [{ id, name, url, updatedAt: Number(record.updatedAt) || 0 }];
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function createProjectStorage(
  reader: StorageReader, writer: StorageWriter, namesKey: string, libraryKey: string,
): ProjectStorage {
  return {
    loadNames: () => parseProjectNames(reader(namesKey)),
    loadLibrary: () => parseProjectLibrary(reader(libraryKey)),
    saveNames: names => writer(namesKey, JSON.stringify(names)),
    saveLibrary: records => writer(libraryKey, JSON.stringify(records)),
  };
}

export function projectNameFor(storage: ProjectStorage, projectId: string): string {
  return String(storage.loadNames()[projectId] || '').trim();
}

export function rememberProject(
  records: readonly ProjectLibraryRecord[], id: string, name: string, pageUrl: string, updatedAt: number,
): ProjectLibraryRecord[] {
  const url = validProjectUrl(pageUrl, id);
  if (!url) return [...records];
  return [{ id, name, url, updatedAt }, ...records.filter(record => record.id !== id)];
}