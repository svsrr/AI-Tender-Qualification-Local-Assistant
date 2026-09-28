export function safeLocalStorageSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err: any) {
    console.warn(`[storage] localStorage.setItem failed for key "${key}":`, err);
    return false;
  }
}

export function stripHeavyFileData<T>(obj: T): T {
  if (obj === undefined || obj === null) return obj;
  if (typeof obj === 'string') {
    return (obj.length > 100000 ? '' : obj) as unknown as T;
  }
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(stripHeavyFileData) as unknown as T;
  }
  const clean: Record<string, any> = {};
  for (const key of Object.keys(obj as Record<string, any>)) {
    if (key === 'fileData') {
      continue;
    }
    clean[key] = stripHeavyFileData((obj as Record<string, any>)[key]);
  }
  return clean as T;
}
