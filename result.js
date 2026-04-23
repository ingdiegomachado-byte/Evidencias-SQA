/* ═══════════════════════════════════════════════════════════════════
   Evidencias SQA — result.js v6.3.0 (Pro Release)
   ─────────────────────────────────────────────────────────────────
   Arquitectura: Motor de Objetos Fabric.js (Acelerado)
   • Modularización: ES Modules para mejor mantenimiento.
   • Auto-guardado: Sistema de borradores (Drafts) en tiempo real.
   • Multi-selección: Gestión avanzada de grupos de anotaciones.
   ═══════════════════════════════════════════════════════════════════ */

import * as db from './modules/db.js';
import * as imgUtils from './modules/image-utils.js';

// ── DOM refs ──────────────────────────────────────────────────────
const viewerView = document.getElementById("viewer-view");
const historyView = document.getElementById("history-view");
const editorView = document.getElementById("editor-view");
const img = document.getElementById("screenshot");
const loadingOverlay = document.getElementById("loadingOverlay");
const toast = document.getElementById("toast");
const historyLink = document.getElementById("historyLink");
const backBtn = document.getElementById("backBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const editBtn = document.getElementById("editBtn");
const historialContainer = document.getElementById("historialContainer");
const deleteAllBtn = document.getElementById("deleteAllBtn");
const downloadAllBtn = document.getElementById("downloadAllBtn");

// Editor
const editorCanvas = document.getElementById("editorCanvas");
let fCanvas = null; // Fabric Canvas instance
const editorSaveBtn = document.getElementById("editorSaveBtn");
const editorCancelBtn = document.getElementById("editorCancelBtn");
const toolUndo = document.getElementById("tool-undo");
const toolRedo = document.getElementById("tool-redo");
const strokeSizeSelect = document.getElementById("strokeSize");
const editorCanvasArea = document.getElementById("editorCanvasArea");
const editorStatus = document.getElementById("editorStatus");
const fontSizeInput = document.getElementById("fontSizeInput");

// Crop overlay
const cropOverlay = document.getElementById("cropOverlay");
const cTop = document.getElementById("cs-top");
const cBottom = document.getElementById("cs-bottom");
const cLeft = document.getElementById("cs-left");
const cRight = document.getElementById("cs-right");
const cBorder = document.getElementById("cb");

// Zoom
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const zoomResetBtn = document.getElementById("zoom-reset");
const zoomLabel = document.getElementById("zoom-label");

// ── MODELO DE ESTADO ──────────────────────────────────────────────
let currentView = "viewer";
let editorZoom = 0.5;
let editorTool = null;
let editorColor = "#FF3B30";
let editorHistory = [];
let editorFuture = [];

// Estado de dibujo temporal
let isDrawing = false;
let startX = 0, startY = 0;
let activeObj = null;
let cropRect = { x: 0, y: 0, w: 0, h: 0 };
let isCropDragging = false;
let cropDragStart = null;

// Configuración común de objetos (Estética SQA)
const SQA_OBJ_CONFIG = {
    transparentCorners: false,
    cornerColor: '#FF6B00',
    cornerStrokeColor: '#ffffff',
    cornerSize: 8,
    perPixelTargetFind: false
};

/* ════════════════════════════════════════════
   STITCHING ENGINE (Captura en vivo)
   ════════════════════════════════════════════ */
const captureSessions = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'engine') return false;
    
    console.log(`[Result] Recibido mensaje: ${message.action}`);
    
    if (message.action === 'initCaptureSession') {
        console.log("[Result] Iniciando stitching...");
        initStitchingSession(message.width, message.totalHeight, message.devicePixelRatio || 1, message.info);
        sendResponse({ status: 'ok' });
    }
    else if (message.action === 'appendCaptureChunk') {
        appendStitchingChunk(message.dataUrl, message.y, message.height)
            .then(() => sendResponse({ status: 'ok' }));
        return true;
    }
    else if (message.action === 'finalizeCapture') {
        console.log("[Result] Finalizando stitching...");
        finalizeStitchingSession();
        sendResponse({ status: 'ok' });
    }
});

// Notificar al SW que el motor está listo
chrome.runtime.sendMessage({ action: 'engineReady' });

function initStitchingSession(width, totalHeight, dpr, info) {
    console.log(`[Engine] Iniciando sesión: ${width}x${totalHeight} @ ${dpr}dpr`);
    
    // Validar dimensiones
    if (!width || isNaN(width) || width <= 0) width = window.innerWidth;
    if (!totalHeight || isNaN(totalHeight) || totalHeight <= 0) totalHeight = window.innerHeight;
    
    showLoading();
    const HEADER_HEIGHT = 100;
    const canvas = document.createElement('canvas');
    canvas.width = width * dpr;
    canvas.height = (totalHeight + HEADER_HEIGHT) * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Header
    ctx.fillStyle = "#002b55";
    ctx.fillRect(0, 0, width, HEADER_HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px Arial";
    ctx.fillText("EVIDENCIA DE PRUEBAS QA", 80, 40);
    ctx.font = "14px Arial";
    ctx.fillStyle = "#cbd5e0";
    ctx.fillText(`URL: ${info.url}`, 80, 65);
    ctx.fillText(`📅 ${info.date}`, 80, 85);
    ctx.fillStyle = "#FF6B00";
    ctx.fillRect(20, 25, 45, 45);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px Arial";
    ctx.fillText("SQA", 25, 55);

    captureSessions.set("current", { canvas, ctx, HEADER_HEIGHT, dpr, info });
}

async function appendStitchingChunk(dataUrl, y, height) {
    const session = captureSessions.get("current");
    if (!session) return;
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    session.ctx.drawImage(bitmap, 0, y + session.HEADER_HEIGHT, bitmap.width / session.dpr, bitmap.height / session.dpr);
    bitmap.close();
    console.log(`[Engine] Chunk en y=${y}`);
}

function finalizeStitchingSession() {
    const session = captureSessions.get("current");
    if (!session) return;
    session.canvas.toBlob((blob) => {
        img.src = URL.createObjectURL(blob);
        img.onload = () => {
            hideLoading();
            switchView("viewer");
            // Guardar en DB
            db.saveCapture(blob, session.info?.url, () => {
                console.log("[Engine] Guardado completo");
                // Notificar localmente para actualizar la vista
                loadCapture();
                setTimeout(() => copyToClipboard(true), 500);
            });
        };
        captureSessions.delete("current");
    }, 'image/webp', 0.8);
}

/* ════════════════════════════════════════════
   INICIALIZACIÓN FABRIC.JS
   ════════════════════════════════════════════ */
function initEditor() {
    const im = new Image();
    im.onload = () => {
        const width = im.width;
        const height = im.height;

        if (!fCanvas) {
            fCanvas = new fabric.Canvas('editorCanvas', {
                width: width,
                height: height,
                selection: true,
                preserveObjectStacking: true,
                stopContextMenu: true
            });
            setupFabricEvents();
        } else {
            fCanvas.clear();
            fCanvas.setDimensions({ width, height });
        }

        fabric.Image.fromURL(im.src, (fImg) => {
            fCanvas.setBackgroundImage(fImg, () => {
                applyZoom(0.5);
                fCanvas.calcOffset();
                fCanvas.renderAll();
            });
            editorHistory = []; editorFuture = [];
            selectTool(null);
            saveSnapshot();
            switchView("editor");
        });
    };
    im.src = img.src;
}

function setupFabricEvents() {
    fCanvas.on('mouse:down', function (opt) {
        if (!editorTool || editorTool === 'select') return;
        const pointer = fCanvas.getPointer(opt.e);
        isDrawing = true;
        startX = pointer.x; startY = pointer.y;

        if (editorTool === 'crop') {
            isCropDragging = true;
            cropDragStart = { x: pointer.x, y: pointer.y };
            cropRect = { x: pointer.x, y: pointer.y, w: 0, h: 0 };
            showCropOverlay();
            return;
        }

        const color = editorColor;
        const stroke = parseInt(strokeSizeSelect.value);

        if (editorTool === 'rect') {
            activeObj = new fabric.Rect({
                left: startX, top: startY, width: 0, height: 0,
                fill: 'rgba(0,0,0,0.001)', // Semi-clickable
                stroke: color, strokeWidth: stroke,
                selectable: false, evented: false,
                ...SQA_OBJ_CONFIG
            });
        } else if (editorTool === 'highlight') {
            activeObj = new fabric.Rect({
                left: startX, top: startY, width: 0, height: 0,
                fill: color, opacity: 0.35,
                selectable: false, evented: false,
                ...SQA_OBJ_CONFIG
            });
        } else if (editorTool === 'arrow') {
            activeObj = new fabric.Line([startX, startY, startX, startY], {
                stroke: color, strokeWidth: stroke, strokeLineCap: 'round',
                selectable: false, evented: false
            });
        } else if (editorTool === 'text') {
            const text = new fabric.IText('Texto', {
                left: startX, top: startY,
                fontFamily: "'Segoe UI', Roboto, sans-serif",
                fontSize: parseInt(fontSizeInput.value) || 50,
                fill: color, stroke: '#ffffff', strokeWidth: 1, paintFirst: 'stroke',
                padding: 10,
                ...SQA_OBJ_CONFIG
            });
            fCanvas.add(text);
            fCanvas.setActiveObject(text);
            text.enterEditing();
            text.selectAll();
            selectTool(null);
            return;
        } else if (editorTool === 'blur') {
            activeObj = new fabric.Rect({
                left: startX, top: startY, width: 0, height: 0,
                fill: 'rgba(255,255,255,0.1)', stroke: '#3498db', strokeWidth: 1, strokeDashArray: [5, 5],
                selectable: false, evented: false
            });
        }

        if (activeObj) fCanvas.add(activeObj);
    });

    fCanvas.on('mouse:move', function (opt) {
        if (!isDrawing) return;
        const pointer = fCanvas.getPointer(opt.e);

        if (editorTool === 'crop' && isCropDragging) {
            cropRect.x = Math.min(pointer.x, cropDragStart.x);
            cropRect.y = Math.min(pointer.y, cropDragStart.y);
            cropRect.w = Math.abs(pointer.x - cropDragStart.x);
            cropRect.h = Math.abs(pointer.y - cropDragStart.y);
            updateCropShades();
            return;
        }

        if (!activeObj) return;

        if (editorTool === 'arrow') {
            activeObj.set({ x2: pointer.x, y2: pointer.y });
        } else {
            activeObj.set({
                left: Math.min(startX, pointer.x),
                top: Math.min(startY, pointer.y),
                width: Math.abs(startX - pointer.x),
                height: Math.abs(startY - pointer.y)
            });
        }
        fCanvas.renderAll();
    });

    fCanvas.on('mouse:up', function () {
        if (!isDrawing) return;
        isDrawing = false;

        if (editorTool === 'crop') {
            isCropDragging = false;
            return;
        }

        if (activeObj) {
            if (activeObj.width < 5 && activeObj.height < 5 && activeObj.type !== 'line') {
                fCanvas.remove(activeObj);
            } else {
                activeObj.set({ selectable: true, evented: true, ...SQA_OBJ_CONFIG });
                activeObj.setCoords(); // Actualiza caja de colisión
                
                if (editorTool === 'arrow') createFabricArrow(activeObj);
                if (editorTool === 'blur') applyBlurFilter(activeObj);
                
                fCanvas.calcOffset(); // Sincroniza coordenadas del canvas
                fCanvas.setActiveObject(activeObj); // Selecciona inmediatamente
                fCanvas.renderAll();
                saveSnapshot();
            }
        }
        activeObj = null;
        selectTool(null);
    });

    fCanvas.on('mouse:dblclick', function () {
        if (editorTool === 'crop' && cropRect.w > 5) applyCrop();
    });

    fCanvas.on('object:modified', () => saveSnapshot());
}

function createFabricArrow(line) {
    const x1 = line.x1, y1 = line.y1, x2 = line.x2, y2 = line.y2;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLength = 15;
    const head = new fabric.Triangle({
        left: x2, top: y2, angle: (angle * 180 / Math.PI) + 90,
        width: headLength, height: headLength, fill: line.stroke,
        originX: 'center', originY: 'center', selectable: false, evented: false,
        strokeWidth: 0
    });
    const group = new fabric.Group([line, head], { 
        selectable: true, 
        evented: true, 
        ...SQA_OBJ_CONFIG,
        padding: 2,
        subTargetCheck: false
    });
    fCanvas.remove(line); 
    fCanvas.add(group); 
    fCanvas.setActiveObject(group);
    fCanvas.renderAll();
}

function applyBlurFilter(rect) {
    const { left, top, width, height } = rect;
    if (!fCanvas || !fCanvas.backgroundImage) {
        showToast("Error: Canvas no listo", true);
        return;
    }
    fCanvas.remove(rect);
    
    // Clonar el fondo para el efecto regional
    fCanvas.backgroundImage.cloneAsImage((clonedImg) => {
        if (!clonedImg) return;
        
        // El clipper define qué área se ve (el rectángulo de blur)
        const clipper = new fabric.Rect({ 
            left, top, width, height, 
            absolutePositioned: true 
        });
        
        clonedImg.set({ 
            clipPath: clipper, 
            selectable: true, 
            evented: true, 
            hoverCursor: 'move',
            ...SQA_OBJ_CONFIG 
        });
        
        // Aplicar pixelado
        clonedImg.filters.push(new fabric.Image.filters.Pixelate({ blocksize: 12 }));
        clonedImg.applyFilters();
        
        // Insertar justo encima del fondo (capa baja) para que no tape anotaciones
        fCanvas.insertAt(clonedImg, 0); 
        fCanvas.setActiveObject(clonedImg);
        fCanvas.renderAll();
        saveSnapshot();
    });
}

/* ════════════════════════════════════════════
   CROP ENGINE
════════════════════════════════════════════ */
function showCropOverlay() {
    if (!fCanvas) return;
    const container = fCanvas.getElement().parentElement;
    cropOverlay.style.display = 'block';
    cropOverlay.style.left = container.offsetLeft + 'px';
    cropOverlay.style.top = container.offsetTop + 'px';
    cropOverlay.style.width = container.clientWidth + 'px';
    cropOverlay.style.height = container.clientHeight + 'px';
    updateCropShades();
}

function hideCropOverlay() { cropOverlay.style.display = 'none'; }

function updateCropShades() {
    const TW = fCanvas.width, TH = fCanvas.height;
    const cx = cropRect.x * editorZoom, cy = cropRect.y * editorZoom;
    const cw = cropRect.w * editorZoom, ch = cropRect.h * editorZoom;

    cTop.style.cssText = `position:absolute;background:rgba(0,0,0,0.8);left:0;top:0;width:${TW}px;height:${cy}px;`;
    cBottom.style.cssText = `position:absolute;background:rgba(0,0,0,0.8);left:0;top:${cy+ch}px;width:${TW}px;height:${TH-(cy+ch)}px;`;
    cLeft.style.cssText = `position:absolute;background:rgba(0,0,0,0.8);left:0;top:${cy}px;width:${cx}px;height:${ch}px;`;
    cRight.style.cssText = `position:absolute;background:rgba(0,0,0,0.8);left:${cx+cw}px;top:${cy}px;width:${TW-(cx+cw)}px;height:${ch}px;`;
    cBorder.style.cssText = `position:absolute;border:2px solid #FF6B00;left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;`;
}

function applyCrop() {
    if (cropRect.w < 5) return;
    fCanvas.discardActiveObject().renderAll();
    const x = cropRect.x, y = cropRect.y, w = cropRect.w, h = cropRect.h;
    const croppedUrl = fCanvas.toDataURL({
        left: x, top: y, width: w, height: h, multiplier: 1/editorZoom
    });
    fCanvas.clear();
    fCanvas.setDimensions({ width: w, height: h });
    fabric.Image.fromURL(croppedUrl, (fImg) => {
        fCanvas.setBackgroundImage(fImg, () => {
            applyZoom(editorZoom);
            saveSnapshot();
            hideCropOverlay();
            selectTool(null);
        });
    });
}

/* ════════════════════════════════════════════
   HISTORIAL (UNDO / REDO)
════════════════════════════════════════════ */
function saveSnapshot() {
    if (!fCanvas) return;
    editorHistory.push(JSON.stringify(fCanvas));
    editorFuture = [];
    updateUndoRedoBtns();
}

function undo() {
    if (editorHistory.length <= 1) return;
    editorFuture.push(editorHistory.pop());
    const snap = editorHistory[editorHistory.length - 1];
    fCanvas.loadFromJSON(snap, () => {
        if (fCanvas.backgroundImage) {
            const restoredW = fCanvas.width;
            const originalW = fCanvas.backgroundImage.width;
            editorZoom = restoredW / originalW;
            applyZoom(editorZoom);
        }
        fCanvas.renderAll();
        updateUndoRedoBtns();
    });
}

function redo() {
    if (editorFuture.length === 0) return;
    const snap = editorFuture.pop();
    editorHistory.push(snap);
    fCanvas.loadFromJSON(snap, () => {
        if (fCanvas.backgroundImage) {
            const restoredW = fCanvas.width;
            const originalW = fCanvas.backgroundImage.width;
            editorZoom = restoredW / originalW;
            applyZoom(editorZoom);
        }
        fCanvas.renderAll();
        updateUndoRedoBtns();
    });
}

function updateUndoRedoBtns() {
    toolUndo.disabled = editorHistory.length <= 1;
    toolRedo.disabled = editorFuture.length === 0;
}

/* ════════════════════════════════════════════
   UTILIDADES UI
════════════════════════════════════════════ */
function applyZoom(z) {
    editorZoom = Math.min(5.0, Math.max(0.1, z));
    if (fCanvas) {
        fCanvas.setZoom(editorZoom);
        fCanvas.setWidth(fCanvas.backgroundImage.width * editorZoom);
        fCanvas.setHeight(fCanvas.backgroundImage.height * editorZoom);
        fCanvas.calcOffset();
    }
    zoomLabel.textContent = Math.round(editorZoom * 100) + "%";
}

function selectTool(t) {
    if (editorTool === t) t = null;
    editorTool = t;
    document.querySelectorAll('.tool-btn').forEach(b => {
        b.classList.toggle('active', b.id === `tool-${editorTool}`);
    });
    if (fCanvas) {
        const isInteracting = (t === null || t === 'select');
        fCanvas.selection = isInteracting;
        fCanvas.forEachObject(obj => {
            obj.selectable = isInteracting;
            obj.evented = isInteracting || (t === 'text');
            obj.set(SQA_OBJ_CONFIG);
        });
        if (!isInteracting) fCanvas.discardActiveObject().renderAll();
    }
}

function showToast(msg, isError = false) {
    toast.innerText = msg;
    toast.style.background = isError ? "#e74c3c" : "#27ae60";
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
}

function showLoading() { if (loadingOverlay) loadingOverlay.classList.remove("hidden"); if (img) img.style.display = "none"; }
function hideLoading() { if (loadingOverlay) loadingOverlay.classList.add("hidden"); if (img) img.style.display = "block"; }

// Listeners
editBtn.onclick = () => { initEditor(); };
editorSaveBtn.onclick = () => {
    showLoading();
    setTimeout(() => {
        fCanvas.discardActiveObject().renderAll();
        const dataUrl = fCanvas.toDataURL({ format: 'png', quality: 1, multiplier: 1/editorZoom });
        img.src = dataUrl;
        if (typeof upsertCapture === 'function') {
            upsertCapture(dataUrl, window.location.href, () => {
                hideLoading();
                showToast("✅ Cambios guardados");
                switchView("viewer");
            });
        } else {
            hideLoading();
            showToast("✅ Cambios aplicados");
            switchView("viewer");
        }
    }, 50);
};
editorCancelBtn.onclick = () => switchView("viewer");

toolUndo.onclick = undo;
toolRedo.onclick = redo;

['arrow','rect','text','highlight','blur','crop'].forEach(t => {
    document.getElementById(`tool-${t}`).onclick = () => selectTool(t);
});

document.querySelectorAll(".color-swatch").forEach(s => s.onclick = () => {
    document.querySelectorAll(".color-swatch").forEach(x => x.classList.remove("active"));
    s.classList.add("active");
    editorColor = s.dataset.color;
    
    // Aplicar cambio en vivo si hay algo seleccionado
    const active = fCanvas ? fCanvas.getActiveObject() : null;
    if (active) {
        if (active.type === 'group') {
            active.getObjects().forEach(o => {
                if (o.type === 'line') o.set('stroke', editorColor);
                if (o.type === 'triangle') { o.set('fill', editorColor); o.set('stroke', editorColor); }
            });
        } else if (active.type === 'i-text') {
            active.set('fill', editorColor);
        } else {
            active.set('stroke', editorColor);
            if (active.type === 'rect' && active.opacity < 1) active.set('fill', editorColor); // para resaltadores
        }
        fCanvas.renderAll();
        saveSnapshot();
    }
});

strokeSizeSelect.onchange = () => {
    editorWidth = parseInt(strokeSizeSelect.value);
    const active = fCanvas ? fCanvas.getActiveObject() : null;
    if (active) {
        if (active.type === 'group') {
            active.getObjects().forEach(o => { if (o.type === 'line') o.set('strokeWidth', editorWidth); });
        } else {
            active.set('strokeWidth', editorWidth);
        }
        fCanvas.renderAll();
        saveSnapshot();
    }
};

zoomInBtn.onclick = () => applyZoom(editorZoom + 0.1);
zoomOutBtn.onclick = () => applyZoom(editorZoom - 0.1);
zoomResetBtn.onclick = () => applyZoom(1.0);

fontSizeInput.oninput = () => {
    const active = fCanvas ? fCanvas.getActiveObject() : null;
    if (active && active.type === 'i-text') {
        active.set('fontSize', parseInt(fontSizeInput.value));
        fCanvas.renderAll();
    }
};

fontSizeInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
        saveSnapshot();
        fontSizeInput.blur();
    }
};

window.onkeydown = (e) => {
    if (currentView === "viewer") {
        if (e.key === "Escape") document.body.classList.toggle("zoom-active");
        if (e.ctrlKey && e.key === 'c') { e.preventDefault(); copyToClipboard(); }
        return;
    }
    // Editor shortcuts
    if (fCanvas && fCanvas.getActiveObject() && fCanvas.getActiveObject().isEditing) return;
    
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    
    // Mejorado: Borrado de multi-selección
    if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObjects = fCanvas.getActiveObjects();
        if (activeObjects.length > 0) {
            fCanvas.remove(...activeObjects);
            fCanvas.discardActiveObject();
            fCanvas.renderAll();
            saveSnapshot();
        }
    }
    if (editorTool === 'crop' && e.key === 'Enter') applyCrop();
};

editorCanvasArea.addEventListener("wheel", (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
        applyZoom(editorZoom + (e.deltaY < 0 ? 0.05 : -0.05));
    }
}, { passive: false });

/* ════════════════════════════════════════════
   HISTORIAL (INDEXED DB)
════════════════════════════════════════════ */
function loadHistory() {
    db.getAllCaptures((captures) => {
        historialContainer.innerHTML = '';
        if (!captures.length) { 
            historialContainer.innerHTML = "<div class='empty'>Sin capturas registradas.</div>"; 
            return; 
        }

        captures.slice().reverse().forEach((item) => {
            const div = document.createElement("div");
            div.className = "item";
            
            // Generar URL para la miniatura
            const itemUrl = (item.dataUrl instanceof Blob) ? URL.createObjectURL(item.dataUrl) : item.dataUrl;

            div.innerHTML = `
                <div class="date"><b>Fecha:</b> ${new Date(item.date).toLocaleString()}</div>
                <div class="url"><b>URL:</b> ${item.url || 'N/A'}</div>
                <img src="${itemUrl}" class="imgPreview" alt="Captura"/>
                <div class="item-actions">
                    <button class="copyBtn">Copiar</button>
                    <button class="dlBtn">Descargar</button>
                    <button class="delBtn">Borrar</button>
                </div>`;

            // Navegar a la captura al hacer clic en la miniatura
            div.querySelector(".imgPreview").onclick = () => { 
                if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
                img.src = itemUrl; 
                switchView("viewer"); 
            };

            div.querySelector(".copyBtn").onclick = async () => {
                try {
                    const blob = (item.dataUrl instanceof Blob) ? item.dataUrl : await (await fetch(item.dataUrl)).blob();
                    copyToClipboardFromBlob(blob);
                } catch (err) {
                    console.error("Error copiando desde historial:", err);
                    showToast("⚠️ Error al copiar", true);
                }
            };

            div.querySelector(".dlBtn").onclick = () => {
                const a = document.createElement('a'); 
                a.href = itemUrl;
                a.download = `SQA_${new Date(item.date).getTime()}.png`; 
                a.click();
            };

            div.querySelector(".delBtn").onclick = () => { 
                if (confirm("¿Borrar esta captura?")) {
                    db.deleteCapture(item.id, () => {
                        if (itemUrl.startsWith('blob:')) URL.revokeObjectURL(itemUrl);
                        loadHistory();
                    });
                }
            };

            historialContainer.appendChild(div);
        });
    });
}

async function copyToClipboardFromBlob(blob) {
    try {
        let blobToCopy = blob;
        if (blob.type !== 'image/png') {
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width; canvas.height = bitmap.height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0);
            blobToCopy = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            bitmap.close();
        }
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blobToCopy })
        ]);
        showToast("✅ Copiado al portapapeles");
    } catch (err) {
        console.error("Error copyToClipboardFromBlob:", err);
        showToast("⚠️ Error al copiar", true);
    }
}

function switchView(view) {
    currentView = view;
    viewerView.classList.toggle("active", view === "viewer");
    historyView.classList.toggle("active", view === "history");
    editorView.classList.toggle("active", view === "editor");
    if (view === "history") { loadHistory(); document.title = "Historial — SQA"; }
    else if (view === "viewer") document.title = "Visor — SQA";
    else document.title = "Editor — SQA";
}

document.addEventListener("mousedown", (e) => {
    if (!fCanvas) return;
    const isToolbar = e.target.closest(".editor-header") || e.target.closest("#editor-info-bar");
    const isCanvas = e.target.closest(".canvas-container");
    if (!isToolbar && !isCanvas) {
        const active = fCanvas.getActiveObject();
        if (active && active.isEditing) active.exitEditing();
        fCanvas.discardActiveObject().renderAll();
    }
});

async function copyToClipboard(isAuto = false) {
    try {
        if (!img.src || !img.src.startsWith('data:image')) return;

        // Si es auto-copy y no hay foco, omitimos para evitar errores de seguridad en consola
        if (isAuto && !document.hasFocus()) {
            console.log("Copiado automático omitido: falta foco en el documento.");
            return;
        }
        
        const resp = await fetch(img.src);
        const blob = await resp.blob();
        console.log("Clipboard: Bloque original tipo:", blob.type);
        
        // Convertir a PNG si es necesario (Clipboard API solo soporta image/png)
        let blobToCopy = blob;
        if (blob.type !== 'image/png') {
            console.log("Clipboard: Iniciando conversión a PNG...");
            try {
                const bitmap = await createImageBitmap(blob);
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0);
                blobToCopy = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                console.log("Clipboard: Conversión exitosa, nuevo tipo:", blobToCopy.type);
                bitmap.close();
            } catch (convErr) {
                console.error("Clipboard: Error en conversión:", convErr);
            }
        }
        
        // Si después de todo seguimos sin tener un PNG, el clipboard fallará en Chrome
        if (blobToCopy.type !== 'image/png') {
            console.warn("Clipboard: No se pudo obtener un PNG. Reintentando conversión con método alternativo...");
            // Método alternativo: usar un elemento Image tradicional
            blobToCopy = await new Promise((resolve) => {
                const tempImg = new Image();
                tempImg.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = tempImg.width;
                    canvas.height = tempImg.height;
                    canvas.getContext('2d').drawImage(tempImg, 0, 0);
                    canvas.toBlob(resolve, 'image/png');
                };
                tempImg.onerror = () => resolve(blob); // Fallback al original si todo falla
                tempImg.src = img.src;
            });
        }

        // Re-verificar foco justo antes de escribir (vital en extensiones)
        if (!document.hasFocus()) {
            if (isAuto) {
                console.log("Clipboard: Omitiendo auto-copy, documento perdió el foco.");
                return;
            }
            // Para manual, intentamos enfocar
            window.focus();
            await new Promise(r => setTimeout(r, 100));
        }

        console.log("Clipboard: Escribiendo al portapapeles tipo:", blobToCopy.type);
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blobToCopy })
        ]);
        
        if (!isAuto) showToast("✅ ¡Copiado al portapapeles!");
    } catch (err) {
        // Si es un error de foco o permisos en auto-copy, lo tratamos como información, no advertencia
        if (isAuto) {
            console.log("Clipboard: Auto-copy no permitido o falló:", err.name, err.message);
        } else {
            console.warn("Clipboard: Error en copia manual:", err.name, err.message);
            showToast("⚠️ Usa clic derecho -> Copiar imagen", true);
        }
    }
}

function loadCapture() {
    console.log("[Result] Cargando captura...");
    db.getAllCaptures((captures) => {
        if (captures && captures.length > 0) {
            const last = captures[captures.length - 1];
            console.log("[Result] Captura encontrada:", last);
            
            showLoading();
            
            // Si es un Blob, crear URL de objeto
            if (last.dataUrl instanceof Blob) {
                if (img.src && img.src.startsWith('blob:')) {
                    URL.revokeObjectURL(img.src);
                }
                img.src = URL.createObjectURL(last.dataUrl);
            } else {
                img.src = last.dataUrl;
            }

            img.onload = () => {
                hideLoading();
                document.body.classList.remove("zoom-active");
                switchView("viewer");
                // Copiado automático
                setTimeout(() => copyToClipboard(true), 500);
            };
            
            img.onerror = () => {
                console.error("[Result] Error al cargar imagen del blob");
                hideLoading();
                showToast("Error al cargar la imagen", true);
            };
        }
    });
}

img.onclick = () => { if (currentView === "viewer") document.body.classList.toggle("zoom-active"); };

loadCapture();

// Escuchar cambios (Nueva captura lista)
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "newCaptureReady") {
        console.log("[Result] Notificación: Nueva captura lista");
        loadCapture();
    }
});
historyLink.onclick = () => switchView("history");
backBtn.onclick = () => switchView("viewer");
copyBtn.onclick = () => copyToClipboard();
downloadBtn.onclick = () => {
    const a = document.createElement('a'); a.href = img.src;
    a.download = `SQA_Evidencia_${new Date().getTime()}.png`; a.click();
};

downloadAllBtn.onclick = () => {
    db.getAllCaptures((captures) => {
        if (!captures.length) { showToast("No hay capturas", true); return; }
        if (typeof JSZip === 'undefined') { showToast("Error: JSZip no cargado", true); return; }
        
        const zip = new JSZip();
        captures.forEach((item, index) => {
            const base64Data = item.dataUrl.split(',')[1];
            zip.file(`Evidencia_${index + 1}_${item.date.replace(/[^\d]/g,"")}.png`, base64Data, {base64: true});
        });
        
        zip.generateAsync({type:"blob"}).then(function(content) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(content);
            a.download = `SQA_Evidencias_Lote_${new Date().getTime()}.zip`;
            a.click();
        });
    });
};

deleteAllBtn.onclick = () => {
    if (confirm("¿Estás seguro de borrar TODO el historial?")) {
        db.clearAllCaptures(() => {
            window.close();
        });
    }
};

// ── AUTO-SAVE DRAFTS ──────────────────────────────────────────────
let autoSaveTimer;
function triggerAutoSave() {
    if (!fCanvas) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
        const json = JSON.stringify(fCanvas.toJSON());
        db.saveDraft(json);
    }, 1500);
}

function restoreDraft() {
    db.getDraft((draft) => {
        if (draft && draft.json) {
            const draftDate = new Date(draft.date);
            const now = new Date();
            if ((now - draftDate) < 3600000) { // 1 hora
                fCanvas.loadFromJSON(draft.json, () => {
                    fCanvas.renderAll();
                    showToast("♻️ Borrador restaurado");
                });
            }
        }
    });
}

// Sincronizar coordenadas al redimensionar ventana para evitar problemas de selección
window.addEventListener('resize', () => {
    if (typeof fCanvas !== 'undefined' && fCanvas) fCanvas.calcOffset();
});
