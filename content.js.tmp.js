		//receive messages
		function isContextValid() {
			try {
				return !!(chrome.runtime && chrome.runtime.id && chrome.runtime.getURL(''));
			} catch (e) {
				return false;
			}
		}

		function safeSendMessage(msg, cb) {
			if (!isContextValid()) {
				console.warn("[Content] Contexto invalidado. Deteniendo procesos.");
				capture_working = 0; // Detener bucle de captura si existe
				return;
			}
			try {
				chrome.runtime.sendMessage(msg, (response) => {
					if (chrome.runtime.lastError) {
						// Ignorar errores de "Receiving end does not exist" aquí, se manejan en los retries
					}
					if (cb) cb(response);
				});
			} catch (e) {
				console.warn("[Content] Error en safeSendMessage:", e.message);
				capture_working = 0;
			}
		}
