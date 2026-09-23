const DB_NAME = 'sahmt-checklist-local-v1';
const DB_VERSION = 1;
const REPORTS = 'reports';
const OPERATIONS = 'operations';
const QR_UNITS = 'qrUnits';
const MAX_PENDING_OPERATIONS = 500;
const SYNCED_RETENTION_MS = 60 * 86400000;

let databasePromise;
const clone = value => typeof globalThis.structuredClone === 'function' ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value));

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('O armazenamento local seguro não está disponível neste navegador.'));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(REPORTS)) db.createObjectStore(REPORTS, {keyPath: 'key'});
      if (!db.objectStoreNames.contains(OPERATIONS)) {
        const store = db.createObjectStore(OPERATIONS, {keyPath: 'requestId'});
        store.createIndex('byDay', 'day', {unique: false});
        store.createIndex('byOwner', 'ownerEmail', {unique: false});
        store.createIndex('byStatus', 'status', {unique: false});
      }
      if (!db.objectStoreNames.contains(QR_UNITS)) db.createObjectStore(QR_UNITS, {keyPath: 'key'});
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local do Checklist.'));
    request.onblocked = () => reject(new Error('Feche outra aba do SAHMT para liberar o armazenamento local.'));
  }).catch(error => { databasePromise = null; throw error; });
  return databasePromise;
}

function transact(storeNames, mode, action) {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    try { result = action(tx); }
    catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Falha ao confirmar dados locais do Checklist.'));
  }));
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao ler dados locais do Checklist.'));
  });
}

export const ChecklistLocalStore = Object.freeze({
  async getReport(day, ownerUid) {
    const db = await openDatabase();
    const result = await requestResult(db.transaction(REPORTS, 'readonly').objectStore(REPORTS).get(`${ownerUid}:${day}`));
    return result?.ownerUid === ownerUid ? result : null;
  },

  saveReport(day, ownerUid, ownerEmail, data) {
    const snapshot = {key: `${ownerUid}:${day}`, day: String(day), ownerUid, ownerEmail: String(ownerEmail).trim().toLowerCase(), data: clone(data), savedAt: Date.now()};
    return transact(REPORTS, 'readwrite', tx => tx.objectStore(REPORTS).put(snapshot));
  },

  async getOperation(requestId) {
    const db = await openDatabase();
    return requestResult(db.transaction(OPERATIONS, 'readonly').objectStore(OPERATIONS).get(String(requestId)));
  },

  cacheQrUnit(qr, day, unit) {
    const value = {key: `${day}:${String(qr)}`, day: String(day), qr: String(qr), unit: clone(unit), savedAt: Date.now()};
    return transact(QR_UNITS, 'readwrite', tx => tx.objectStore(QR_UNITS).put(value));
  },

  cacheQrCatalog(day, units) {
    const rows = (Array.isArray(units) ? units : []).filter(unit => unit?.qr && unit?.id).map(unit => ({key: `${day}:${String(unit.qr)}`, day: String(day), qr: String(unit.qr), unit: {id: unit.id, name: unit.name}, savedAt: Date.now()}));
    if (!rows.length) return Promise.resolve();
    return transact(QR_UNITS, 'readwrite', tx => { const store = tx.objectStore(QR_UNITS); for (const row of rows) store.put(row); });
  },

  async getQrUnit(qr, day) {
    const db = await openDatabase();
    return requestResult(db.transaction(QR_UNITS, 'readonly').objectStore(QR_UNITS).get(`${day}:${String(qr)}`));
  },

  async enqueue(operation) {
    if (!operation?.requestId || !operation?.ownerEmail || !operation?.actorUid || !operation?.day || !['record', 'sign'].includes(operation.action)) {
      throw new Error('A operação do Checklist está incompleta e não foi salva.');
    }
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OPERATIONS, 'readwrite');
      const store = tx.objectStore(OPERATIONS);
      const get = store.get(operation.requestId);
      let result;
      get.onsuccess = () => {
        const existing = get.result;
        if (existing) {
          if (existing.ownerEmail !== operation.ownerEmail || existing.actorUid !== operation.actorUid || existing.action !== operation.action || JSON.stringify(existing.payload) !== JSON.stringify(operation.payload)) {
            tx.abort();
            reject(new Error('Conflito no identificador da ação. Nenhum dado foi sobrescrito.'));
            return;
          }
          result = existing;
          return;
        }
        const allRequest = store.getAll();
        allRequest.onsuccess = () => {
          const now = Date.now(), rows = allRequest.result;
          for (const row of rows) if (row.status === 'synced' && now - Number(row.syncedAt || row.createdAt || 0) > SYNCED_RETENTION_MS) store.delete(row.requestId);
          const pending = rows.filter(row => ['pending', 'retry', 'error', 'conflict'].includes(row.status)).length;
          if (pending >= MAX_PENDING_OPERATIONS) {
            tx.abort();
            reject(new Error('A fila local atingiu 500 ações pendentes. Conecte o app para sincronizar antes de registrar novas ações.'));
            return;
          }
          result = {
            ...clone(operation),
            ownerEmail: String(operation.ownerEmail).trim().toLowerCase(),
            status: 'pending', attempts: 0, createdAt: now, nextAttemptAt: 0, lastError: ''
          };
          store.add(result);
        };
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Não foi possível guardar a operação do Checklist.'));
    });
  },

  async listOperations({day, ownerEmail, statuses = ['pending', 'retry', 'error', 'conflict']} = {}) {
    const db = await openDatabase();
    const all = await requestResult(db.transaction(OPERATIONS, 'readonly').objectStore(OPERATIONS).getAll());
    const owner = String(ownerEmail || '').trim().toLowerCase();
    return all.filter(item => (!day || item.day === day) && (!owner || item.ownerEmail === owner) && statuses.includes(item.status)).sort((a, b) => a.createdAt - b.createdAt);
  },

  updateOperation(requestId, changes) {
    return openDatabase().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(OPERATIONS, 'readwrite');
      const store = tx.objectStore(OPERATIONS);
      const get = store.get(String(requestId));
      let value;
      get.onsuccess = () => {
        if (!get.result) return;
        value = {...get.result, ...clone(changes)};
        store.put(value);
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Não foi possível atualizar a fila do Checklist.'));
    }));
  },

  async pendingCount(ownerEmail) {
    return (await this.listOperations({ownerEmail})).length;
  }
});
