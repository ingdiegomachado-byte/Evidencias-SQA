let resultTabId = null;
const captureInProgress = new Set();

// Variables globales para gestión de datos
let contentjsIsLoad = 0;
let permissionAllSite = 0;
let activeTab;
let nowShotImgData;
let allShotImgData0;
let allShotImgData0_index = 0;
let allShotImgData1;
let allShotImgData1_index = 0;
let allShotImgData2;
let allShotImgData2_index = 0;
let allShotImgData3;
let allShotImgData3_index = 0;
let allShotImgData4;
let allShotImgData4_index = 0;
let allShotImgData5;
let allShotImgData5_index = 0;
let allShotImgData6;
let allShotImgData6_index = 0;
let allShotImgData7;
let allShotImgData7_index = 0;
let linkText = '';
let pageHtml = '';
let capture2edit = 0;
let tab_title;
let tab_url;

function reSetData() {
  nowShotImgData = undefined;
  allShotImgData0 = undefined;
  allShotImgData0_index = 0;
  allShotImgData1 = undefined;
  allShotImgData1_index = 0;
  allShotImgData2 = undefined;
  allShotImgData2_index = 0;
  allShotImgData3 = undefined;
  allShotImgData3_index = 0;
  allShotImgData4 = undefined;
  allShotImgData4_index = 0;
  allShotImgData5 = undefined;
  allShotImgData5_index = 0;
  allShotImgData6 = undefined;
  allShotImgData6_index = 0;
  allShotImgData7 = undefined;
  allShotImgData7_index = 0;
  linkText = '';
  pageHtml = '';
  capture2edit = 0;
  tab_title = undefined;
  tab_url = undefined;
}

// ============================================
// LISTENER PRINCIPAL: Ejecución desde barra
// ============================================
chrome.action.onClicked.addListener(async (tab) => {
  if (
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("edge://") ||
    tab.url.startsWith("about:") ||
    tab.url.startsWith("chrome-extension://") // <- AGREGADO, bloquea páginas de extensión
  ) {
    return;
  }

  if (captureInProgress.has(tab.id)) {
    console.log("Captura ya en progreso en esta pestaña");
    return;
  }

  captureInProgress.add(tab.id);
  console.log("Iniciando captura en pestaña:", tab.id);

  activeTab = tab;
  reSetData();

  try {
    // Verificar si el content script ya está cargado
    const isLoaded = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: "checkContentLoaded" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.loaded) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });

    if (!isLoaded) {
      console.log("Inyectando content.js...");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      await new Promise(r => setTimeout(r, 500));
    } else {
      console.log("content.js ya estaba cargado.");
    }

    console.log("Enviando mensaje captureAllPageScreenshot");

    // Reintenta el envío del mensaje en caso de que el content script aún no esté listo
    const maxRetries = 3;
    const retryDelayMs = 300;
    let sent = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const success = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { action: "captureAllPageScreenshot" }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn(`Intento ${attempt}/${maxRetries} fallido: ${chrome.runtime.lastError.message}`);
            resolve(false);
          } else {
            console.log("Captura iniciada correctamente en intento", attempt);
            resolve(true);
          }
        });
      });

      if (success) {
        sent = true;
        break;
      }

      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, retryDelayMs * attempt));
      }
    }

    if (!sent) {
      console.error("No se pudo iniciar la captura tras", maxRetries, "intentos.");
      captureInProgress.delete(tab.id);
    }

  } catch (err) {
    console.error("Error de inyección:", err.message);
    captureInProgress.delete(tab.id);
  }
});

// ============================================
// LISTENERS DE INSTALACIÓN Y ACTUALIZACIÓN
// ============================================
chrome.runtime.onInstalled.addListener(function (details) {
  // No abrir página al instalar/actualizar
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab) {
      activeTab = tab;
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (activeTab && activeTab.id === tabId) {
    activeTab = tab;
  }

  if (changeInfo.status === "complete" && permissionAllSite == 1) {
    if (checkTab(activeTab)) {
      setTimeout(function () {
        if (tabId == activeTab.id) {
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['content.js']
          });
        }
      }, 100);
    }
  }
});

function checkTab(tab) {
  if (tab && tab.url &&
    tab.url.indexOf("chrome://") != 0 &&
    tab.url.indexOf("edge://") != 0 &&
    tab.url.indexOf("chrome-extension://") != 0 &&
    tab.url.indexOf("about:") != 0) {
    return true;
  }
  return false;
}

function getActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    activeTab = tabs[0];
  });
}

getActiveTab();

chrome.permissions.contains(
  { origins: ["<all_urls>"] },
  (result) => {
    permissionAllSite = result ? 1 : 0;
  }
);

// ============================================
// LISTENERS DE MENSAJES
// ============================================
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === 'contentjsIsLoad') {
    contentjsIsLoad = 1;
  }
  else if (message.action === 'permissionAllSite') {
    permissionAllSite = message.value;
  }
  else if (message.action == 'reSetData') {
    reSetData();
  }
  else if (message.action == 'openNewTab') {
    chrome.tabs.create({ url: message.url });
  }
  else if (message.action === 'setProgress') {
    const targetTabId = sender.tab ? sender.tab.id : (activeTab ? activeTab.id : null);
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { action: 'setProgress', progress: message.progress }, () => {
        if (chrome.runtime.lastError) { /* tab may not be ready yet */ }
      });
    }
  }
  else if (message.action === 'showLoading') {
    const targetTabId = sender.tab ? sender.tab.id : (activeTab ? activeTab.id : null);
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { action: 'showLoading' }, () => {
        if (chrome.runtime.lastError) { /* tab may not be ready yet */ }
      });
    }
  }
  else if (message.action === 'captureVisiblePageScreenshot') {
    console.log('Recibido captureVisiblePageScreenshot en el Service Worker. Intentando capturar pestaña...');
    const targetTabId = sender.tab ? sender.tab.id : (activeTab ? activeTab.id : null);
    nowShotImgData = '';
    chrome.tabs.captureVisibleTab({ format: 'png' }, function (screenshotData) {
      if (chrome.runtime.lastError || !screenshotData) {
        console.error("Error capturando pestaña:", chrome.runtime.lastError ? chrome.runtime.lastError.message : "No data");
        return;
      }
      console.log('Captura exitosa. Enviando getNowShotImgData a la pestaña', targetTabId);
      nowShotImgData = screenshotData;

      if (targetTabId) {
        chrome.tabs.sendMessage(targetTabId, {
          action: 'getNowShotImgData',
          y1: message.y1,
          y2: message.y2,
          nextPageData: message.nextPageData
        });
      }
    });
    return true;
  }
  else if (message.action === 'requestCaptureScreenshot') {
    sendResponse({ imageData: nowShotImgData, y1: message.y1, y2: message.y2 });
    nowShotImgData = '';
    return true;
  }
  // Manejo de fragmentos de imagen (imgDataChunk0, imgDataChunk1, etc.)
  else if (message.action.startsWith('imgDataChunk')) {
    const chunkId = message.action;
    
    // Inicializar si es el primer fragmento
    if (message.dataIndex === 0) {
      if (!globalThis.tempImageStorage) globalThis.tempImageStorage = {};
      globalThis.tempImageStorage[chunkId] = {
        data: '',
        nextIndex: 0
      };
    }

    const storage = globalThis.tempImageStorage ? globalThis.tempImageStorage[chunkId] : null;
    if (storage && message.dataIndex === storage.nextIndex) {
      storage.data += message.dataItem;
      storage.nextIndex++;
    }

    // Si es el último fragmento de la imagen final (hasNextImg == 0)
    if (storage && message.dataIndex === (message.dataLength - 1) && message.hasNextImg === 0) {
      const imageData = storage.data;
      const targetTab = sender.tab || activeTab;
      const title = targetTab ? targetTab.title : "Captura SQA";
      const url = targetTab ? targetTab.url : "";

      saveToIndexedDB(imageData, url, () => {
        chrome.storage.local.set({
          lastCapture: imageData,
          lastCaptureViewed: null
        }, () => {
          openOrUpdateResultTab();
          if (targetTab && targetTab.id) {
            captureInProgress.delete(targetTab.id);
          }
          // Limpiar memoria temporal
          delete globalThis.tempImageStorage[chunkId];
        });
      });
    }

    sendResponse({ rtn: 1, index: message.dataIndex });
    return true;
  }
});

function openOrUpdateResultTab() {
  const resultUrl = chrome.runtime.getURL("result.html");

  chrome.tabs.query({}, (allTabs) => {
    let found = false;

    for (let tab of allTabs) {
      if (tab.url && tab.url.includes("result.html")) {
        console.log("Trayendo pestaña de result.html al frente:", tab.id);
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
        resultTabId = tab.id;
        found = true;
        break;
      }
    }

    if (!found) {
      console.log("Creando nueva pestaña de result.html");
      chrome.tabs.create({ url: resultUrl }, (newTab) => {
        resultTabId = newTab.id;
      });
    }
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === resultTabId) {
    resultTabId = null;
  }
  captureInProgress.delete(tabId);
});

function saveToIndexedDB(dataUrl, pageUrl, callback) {
  if (!dataUrl) {
    console.error("dataUrl vacío en saveToIndexedDB");
    callback();
    return;
  }

  let db;
  const request = indexedDB.open('SQAEvidence', 1);

  request.onerror = () => {
    console.error("Error abriendo IndexedDB");
    callback();
  };

  request.onupgradeneeded = (event) => {
    db = event.target.result;
    if (!db.objectStoreNames.contains('captures')) {
      db.createObjectStore('captures', { keyPath: 'id', autoIncrement: true });
      console.log("Object store 'captures' creado");
    }
  };

  request.onsuccess = (event) => {
    db = event.target.result;
    console.log("IndexedDB abierto");

    const transaction = db.transaction(['captures'], 'readwrite');
    const store = transaction.objectStore('captures');

    const captureData = {
      dataUrl: dataUrl,
      url: pageUrl || '',
      date: new Date().toISOString(),
      comment: ""
    };

    console.log("Insertando captura:", captureData.date);
    const addRequest = store.add(captureData);

    addRequest.onsuccess = () => {
      console.log("Captura insertada exitosamente");
    };

    addRequest.onerror = () => {
      console.error("Error al insertar captura:", addRequest.error);
    };

    transaction.oncomplete = () => {
      console.log("Transacción completada");
      callback();
    };

    transaction.onerror = () => {
      console.error("Error en transacción:", transaction.error);
      callback();
    };
  };
}