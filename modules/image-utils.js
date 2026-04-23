export async function compressToWebP(dataUrl, quality = 0.8) {
    return new Promise(async (resolve, reject) => {
        try {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/webp', quality));
            };
            img.onerror = reject;
            img.src = dataUrl;
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * Version for Service Worker using OffscreenCanvas
 */
export async function compressToWebPStream(blob, quality = 0.8) {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const outputBlob = await canvas.convertToBlob({ type: 'image/webp', quality });
    bitmap.close();
    return outputBlob;
}

export async function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
