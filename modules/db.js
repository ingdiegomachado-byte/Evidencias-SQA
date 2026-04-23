export function openDB(callback) {
    const request = indexedDB.open('SQAEvidence', 1);
    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('captures')) {
            db.createObjectStore('captures', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('drafts')) {
            db.createObjectStore('drafts', { keyPath: 'id' }); // id 0 for current draft
        }
    };
    request.onsuccess = (event) => callback(event.target.result);
    request.onerror = () => console.error("IndexedDB Error");
}

export function saveCapture(dataUrl, url, callback) {
    openDB(db => {
        const tx = db.transaction(['captures'], 'readwrite');
        const store = tx.objectStore('captures');
        const captureData = {
            dataUrl,
            url: url || '',
            date: new Date().toISOString(),
            comment: ""
        };
        store.add(captureData);
        tx.oncomplete = () => callback();
    });
}

export function getAllCaptures(callback) {
    openDB(db => {
        const tx = db.transaction(['captures'], 'readonly');
        const store = tx.objectStore('captures');
        const request = store.getAll();
        request.onsuccess = () => callback(request.result);
    });
}

export function deleteCapture(id, callback) {
    openDB(db => {
        const tx = db.transaction(['captures'], 'readwrite');
        tx.objectStore('captures').delete(id);
        tx.oncomplete = () => callback();
    });
}

export function clearAllCaptures(callback) {
    openDB(db => {
        const tx = db.transaction(['captures'], 'readwrite');
        tx.objectStore('captures').clear();
        tx.oncomplete = () => callback();
    });
}

export function saveDraft(json, callback) {
    openDB(db => {
        const tx = db.transaction(['drafts'], 'readwrite');
        tx.objectStore('drafts').put({ id: 0, json, date: new Date().toISOString() });
        tx.oncomplete = () => callback && callback();
    });
}

export function getDraft(callback) {
    openDB(db => {
        const tx = db.transaction(['drafts'], 'readonly');
        const request = tx.objectStore('drafts').get(0);
        request.onsuccess = () => callback(request.result);
    });
}
