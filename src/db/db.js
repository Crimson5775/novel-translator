const DB_NAME = 'AuraNovelTranslatorDB';
const DB_VERSION = 3; // Bumped version to 3 to resolve migration issues with unique constraints

let dbInstance = null;

export function initDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const transaction = event.target.transaction;

      // Novels store
      if (!db.objectStoreNames.contains('novels')) {
        db.createObjectStore('novels', { keyPath: 'id' });
      }

      // Chapters store (compound primary key or custom ID: novelId_chapterIndex)
      let chapterStore;
      if (!db.objectStoreNames.contains('chapters')) {
        chapterStore = db.createObjectStore('chapters', { keyPath: 'id' });
      } else {
        chapterStore = transaction.objectStore('chapters');
      }

      if (!chapterStore.indexNames.contains('novelId')) {
        chapterStore.createIndex('novelId', 'novelId', { unique: false });
      }
      
      // Delete the legacy unique index if it exists to prevent migration aborts
      if (chapterStore.indexNames.contains('novelId_chapterIndex')) {
        chapterStore.deleteIndex('novelId_chapterIndex');
      }

      // Glossary store
      let glossaryStore;
      if (!db.objectStoreNames.contains('glossaries')) {
        glossaryStore = db.createObjectStore('glossaries', { keyPath: 'id', autoIncrement: true });
      } else {
        glossaryStore = transaction.objectStore('glossaries');
      }

      if (!glossaryStore.indexNames.contains('novelId')) {
        glossaryStore.createIndex('novelId', 'novelId', { unique: false });
      }
      if (!glossaryStore.indexNames.contains('sourceTerm')) {
        glossaryStore.createIndex('sourceTerm', 'sourceTerm', { unique: false });
      }
    };
  });
}

// --- Novel Operations ---

export async function saveNovel(novel) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('novels', 'readwrite');
    const store = transaction.objectStore('novels');
    const request = store.put(novel);

    request.onsuccess = () => resolve(novel);
    request.onerror = () => reject(request.error);
  });
}

export async function getNovels() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('novels', 'readonly');
    const store = transaction.objectStore('novels');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getNovel(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('novels', 'readonly');
    const store = transaction.objectStore('novels');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteNovel(id) {
  const db = await initDB();
  
  // Delete the novel
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('novels', 'readwrite');
    const store = transaction.objectStore('novels');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // Delete all chapters belonging to the novel
  await deleteChaptersOfNovel(id);

  // Delete all glossary terms specific to the novel
  await deleteGlossaryTermsOfNovel(id);
}

// --- Chapter Operations ---

export async function saveChapter(chapter) {
  const db = await initDB();
  // Ensure the composite key format: novelId_chapterIndex
  chapter.id = `${chapter.novelId}_${chapter.chapterIndex}`;
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chapters', 'readwrite');
    const store = transaction.objectStore('chapters');
    const request = store.put(chapter);

    request.onsuccess = () => resolve(chapter);
    request.onerror = () => reject(request.error);
  });
}

export async function getChapter(novelId, chapterIndex) {
  const db = await initDB();
  const id = `${novelId}_${chapterIndex}`;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chapters', 'readonly');
    const store = transaction.objectStore('chapters');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getChapters(novelId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chapters', 'readonly');
    const store = transaction.objectStore('chapters');
    const index = store.index('novelId');
    const request = index.getAll(novelId);

    request.onsuccess = () => {
      // Sort chapters by chapterIndex
      const chapters = request.result || [];
      chapters.sort((a, b) => a.chapterIndex - b.chapterIndex);
      resolve(chapters);
    };
    request.onerror = () => reject(request.error);
  });
}


async function deleteChaptersOfNovel(novelId) {
  const db = await initDB();
  const chapters = await getChapters(novelId);
  
  if (chapters.length === 0) return;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chapters', 'readwrite');
    const store = transaction.objectStore('chapters');
    
    let deletedCount = 0;
    chapters.forEach((chapter) => {
      const request = store.delete(chapter.id);
      request.onsuccess = () => {
        deletedCount++;
        if (deletedCount === chapters.length) resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
}

export async function deleteChapterAndReindex(novelId, chapterIndexToDelete) {
  const db = await initDB();
  const chapters = await getChapters(novelId);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['chapters', 'novels'], 'readwrite');
    const chapterStore = transaction.objectStore('chapters');
    const novelStore = transaction.objectStore('novels');

    // 1. Find and delete the chapter to remove
    const chapterToDelete = chapters.find(ch => ch.chapterIndex === chapterIndexToDelete);
    if (chapterToDelete) {
      chapterStore.delete(chapterToDelete.id);
    }

    // 2. Re-index remaining chapters in sequence
    chapters.forEach(ch => {
      if (ch.chapterIndex > chapterIndexToDelete) {
        const oldId = ch.id;
        ch.chapterIndex = ch.chapterIndex - 1;
        ch.id = `${novelId}_${ch.chapterIndex}`;
        
        // Put chapter at new index and delete old index record
        chapterStore.put(ch);
        chapterStore.delete(oldId);
      }
    });

    // 3. Update the novel total chapters metadata
    const novelRequest = novelStore.get(novelId);
    novelRequest.onsuccess = () => {
      const novel = novelRequest.result;
      if (novel) {
        novel.totalChapters = Math.max(0, novel.totalChapters - 1);
        novelStore.put(novel);
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}


// --- Glossary Operations ---

export async function saveGlossaryTerm(term) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('glossaries', 'readwrite');
    const store = transaction.objectStore('glossaries');
    const request = store.put(term);

    request.onsuccess = (event) => {
      const newTerm = { ...term };
      if (!term.id) {
        newTerm.id = event.target.result;
      }
      resolve(newTerm);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getGlossaryTerms(novelId = null) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('glossaries', 'readonly');
    const store = transaction.objectStore('glossaries');
    const request = store.getAll();

    request.onsuccess = () => {
      const allTerms = request.result || [];
      if (novelId === null) {
        resolve(allTerms);
        return;
      }
      
      const filtered = allTerms.filter(t => {
        // A term is global if t.novelId is falsy AND t.novelIds is falsy or empty
        const isGlobal = !t.novelId && (!t.novelIds || t.novelIds.length === 0);
        const isForThisNovel = t.novelId === novelId;
        const isForCertainNovels = t.novelIds && t.novelIds.includes(novelId);
        return isGlobal || isForThisNovel || isForCertainNovels;
      });
      resolve(filtered);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteGlossaryTerm(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('glossaries', 'readwrite');
    const store = transaction.objectStore('glossaries');
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function deleteGlossaryTermsOfNovel(novelId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('glossaries', 'readwrite');
    const store = transaction.objectStore('glossaries');
    const index = store.index('novelId');
    const request = index.openCursor(IDBKeyRange.only(novelId));

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}
