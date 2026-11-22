import { newId, summary, validateRecord, type ProjectSummary, type StoredProject } from './records'

const DB_NAME = 'pixura'
const STORE = 'projects'

let opened: Promise<IDBDatabase> | null = null

function openOnce(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onblocked = () => reject(new Error('IndexedDB blocked'))
  })
}

async function openChecked(): Promise<IDBDatabase> {
  const db = await openOnce()
  if (db.objectStoreNames.contains(STORE)) return db
  // a database without our store (left behind by something else): start over
  db.close()
  await new Promise<void>((resolve) => {
    const del = indexedDB.deleteDatabase(DB_NAME)
    del.onsuccess = del.onerror = del.onblocked = () => resolve()
  })
  return openOnce()
}

function open(): Promise<IDBDatabase> {
  opened ??= openChecked()
  opened.catch(() => (opened = null))
  return opened
}

// One transaction per call; resolves when it has committed.
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    let result: T
    req.onsuccess = () => (result = req.result)
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error ?? req.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

export async function putProject(r: StoredProject): Promise<void> {
  await run('readwrite', (s) => s.put(r))
}

export async function getProject(id: string): Promise<StoredProject | null> {
  return validateRecord(await run('readonly', (s) => s.get(id)))
}

// Newest first; entries that fail validation are skipped.
export async function listProjects(limit = 30): Promise<ProjectSummary[]> {
  const all = (await run('readonly', (s) => s.getAll())) as unknown[]
  return all
    .map(validateRecord)
    .filter((r): r is StoredProject => r !== null)
    .map(summary)
    .sort((a, b) => b.updated - a.updated)
    .slice(0, limit)
}

export async function deleteProject(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id))
}

export async function duplicateProject(id: string): Promise<string | null> {
  const r = await getProject(id)
  if (!r) return null
  const copy: StoredProject = { ...r, id: newId(), name: `${r.name} (Kopie)`, updated: Date.now() }
  await putProject(copy)
  return copy.id
}

// Removes the whole database, i.e. every stored project on this device.
export async function clearAll(): Promise<void> {
  if (opened) (await opened.catch(() => null))?.close()
  opened = null
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('delete failed'))
    req.onblocked = () => resolve()
  })
}
