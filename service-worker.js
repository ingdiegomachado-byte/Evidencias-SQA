/**
 * Evidencias SQA — service-worker.js v2.0.0
 * Synchronized Router: Uses a handshake, auto-injection, and robust capture.
 */

let sourceTabId = null;
const captureInProgress = new Set();

// ============================================
// CLICK HANDLER
// ============================================
chrome.action.onClicked.addListener(async (tab) => {
    if (captureInProgress.has(tab.id)) return;
    
    try {
        await ensureContentScriptInjected(tab.id);
        captureInProgress.add(tab.id);
        sourceTabId = tab.id;
        
        console.log("[SW] Iniciando captura para pestaña:", tab.id);
        
        const url = chrome.runtime.getURL("result.html");
        chrome.tabs.create({ url, active: false });
    } catch (err) {
        console.error("[SW] Error al iniciar captura:", err);
        captureInProgress.delete(tab.id);
    }
});

// ============================================
// MESSAGE HANDLING
// ============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'engine') return false;

    const tabId = (sender.tab && sender.tab.id) ? Number(sender.tab.id) : null;

    if (message.action === 'engineReady') {
        console.log("[SW] Motor listo. Notificando a la pestaña origen:", sourceTabId);
        if (sourceTabId) {
            // Dar un respiro al navegador antes de empezar el scroll
            setTimeout(() => {
                chrome.tabs.sendMessage(sourceTabId, { action: "captureAllPageScreenshot" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("[SW] Error crítico: El script de contenido desapareció:", chrome.runtime.lastError.message);
                        captureInProgress.delete(sourceTabId);
                    }
                });
            }, 500);
        }
        return false;
    }

    if (message.action === 'captureVisiblePageScreenshot') {
        console.log("[SW] Recibida solicitud de captura visible.");
        // Intentar capturar con reintentos para manejar el error "Tabs cannot be edited"
        captureWithRetry(5).then(dataUrl => {
            if (dataUrl) {
                console.log("[SW] Captura visible obtenida. Enviando de vuelta a la pestaña...");
                if (tabId) {
                    chrome.tabs.sendMessage(tabId, {
                        action: "getNowShotImgData",
                        dataUrl: dataUrl,
                        y1: message.y1,
                        y2: message.y2,
                        nextPageData: message.nextPageData
                    }, () => {
                        if (chrome.runtime.lastError) { /* Silencio */ }
                    });
                }
            } else {
                console.error("[SW] Falló la captura tras reintentos.");
            }
        });
        return true;
    }

    if (message.action === 'finalizeCapture') {
        console.log("[SW] Captura finalizada.");
        if (sourceTabId) {
            captureInProgress.delete(sourceTabId);
            if (sender.tab && sender.tab.id) {
                chrome.tabs.update(sender.tab.id, { active: true });
            }
        }
        sourceTabId = null;
        sendResponse({ status: 'ok' });
        return false;
    }

    if (message.action === 'setProgress') {
        // El SW simplemente actúa como puente si fuera necesario, 
        // pero por ahora solo confirmamos recepción para evitar errores de puerto.
        sendResponse({ status: 'ok' });
        return false;
    }

    // Respuesta genérica para cualquier otro mensaje no manejado explícitamente
    sendResponse({ status: 'unhandled' });
    return false;
});

// ============================================
// UTILS
// ============================================
async function ensureContentScriptInjected(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, { action: "checkContentLoaded" });
    } catch (e) {
        console.log("[SW] Script no detectado, inyectando...");
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });
        // Esperar un momento a que el script se inicialice
        await new Promise(r => setTimeout(r, 500));
    }
}

async function captureWithRetry(maxAttempts, attempt = 1) {
    return new Promise((resolve) => {
        chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                const msg = chrome.runtime.lastError.message;
                console.warn(`[SW] Intento ${attempt} falló: ${msg}`);
                
                if (attempt < maxAttempts && (msg.includes("cannot be edited") || msg.includes("Internal error"))) {
                    setTimeout(() => {
                        resolve(captureWithRetry(maxAttempts, attempt + 1));
                    }, 500);
                } else {
                    console.error("[SW] Fallo definitivo en captureVisibleTab");
                    resolve(null);
                }
            } else {
                resolve(dataUrl);
            }
        });
    });
}