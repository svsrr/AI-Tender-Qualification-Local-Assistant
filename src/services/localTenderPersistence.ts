import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const TENDERS_FILE = path.join(DATA_DIR, 'tenders.json');

// Initialize data dir
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(TENDERS_FILE)) {
  fs.writeFileSync(TENDERS_FILE, JSON.stringify({}), 'utf-8');
}

export function getLocalTender(id: string) {
  try {
    const raw = fs.readFileSync(TENDERS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return data[id] || null;
  } catch (err) {
    console.error('Error reading tender:', err);
    return null;
  }
}

export function saveLocalTender(id: string, payload: any) {
  try {
    const raw = fs.readFileSync(TENDERS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    payload.updatedAt = new Date().toISOString();
    data[id] = payload;
    fs.writeFileSync(TENDERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return payload.updatedAt;
  } catch (err) {
    console.error('Error saving tender:', err);
    throw err;
  }
}

export function listLocalTenders() {
  try {
    const raw = fs.readFileSync(TENDERS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return Object.keys(data).map(id => ({
      id,
      title: data[id].title || data[id].ioclMetadata?.jobName || 'Untitled Tender',
      ref: data[id].ref || data[id].criteria?.tenderRef || '',
      updatedAt: data[id].updatedAt,
      // Minimal session fields
      isDemo: false,
    }));
  } catch (err) {
    console.error('Error listing tenders:', err);
    return [];
  }
}

export function deleteLocalTender(id: string) {
  try {
    const raw = fs.readFileSync(TENDERS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    delete data[id];
    fs.writeFileSync(TENDERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error deleting tender:', err);
    throw err;
  }
}
