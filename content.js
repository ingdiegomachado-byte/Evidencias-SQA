(function () {
	// Verificar si ya hay un listener activo en este contexto específico
	if (window.capturex_active_instance) {
		try {
			// Si el runtime sigue vivo, no necesitamos re-inicializar
			chrome.runtime.getURL('');
			console.log("[Content] Script ya activo y conectado.");
			return;
		} catch (e) {
			console.log("[Content] Detectada instancia vieja desconectada, re-inicializando...");
		}
	}
	window.capturex_active_instance = true;

	//this my code start
		var capturex_capture_max_height = 90000;

		var capturex_alert_msg_content;
		var capturex_alert_msg_title;
		var capturex_scrollPosition;
		var capturex_contentEle; //real content element
		var capturex_contentEle_over_top;
		var capturex_contentEle_over_bottom;
		var capturex_contentEleRectLeft, capturex_contentEleRectTop, capturex_contentEleRectRight, capturex_contentEleRectBottom;
		var capturex_contentEleIframe; //real content element
		var capturex_documentHeight_o; //original documentHeight before scrolling
		var capturex_documentHeight;
		var capturex_documentWidth;
		var capturex_onePageHeight;
		var capturex_onePageOverlap; //scroll overlap height
		var capturex_contentPageCrollTop;
		var capturex_nowRealPageCrollTop;
		var capturex_preRealPageCrollTop;
		var capturex_scrollbarWidth;
		var capturex_changStyleForShotTimes = 0;
		var elementAbsolutePositions = new Map();

		var capturex_setChildScrollableHeight = 0;
		var capturex_fullpage = 0;

		var capturex_scrollableEles = [];

		let capturex_startX, capturex_startY, capturex_endX, capturex_endY;
		let capturex_isSelecting = false;
		let capturex_overScrollTop = 0;
		let capture_working = 0;

		//receive messages
		//receive messages
		function isContextValid() {
			try {
				return !!(chrome.runtime && chrome.runtime.id && chrome.runtime.getURL(''));
			} catch (e) {
				return false;
			}
		}

		function safeSendMessage(msg, cb, attempts = 0) {
			if (!isContextValid()) {
				console.warn("[Content] Contexto invalidado o extensión recargada. Deteniendo captura.");
				capture_working = 0;
				return;
			}
			
			console.log(`[Content] Enviando mensaje (${attempts}): ${msg.action} a ${msg.target || 'SW'}`);
			
			try {
				chrome.runtime.sendMessage(msg, (response) => {
					const err = chrome.runtime.lastError;
					if (err) {
						const msgText = err.message || "";
						// Si el error es transitorio (ej: el SW está despertando), reintentamos
						if ((msgText.includes("Receiving end") || msgText.includes("Could not establish connection")) && attempts < 3) {
							const delay = Math.pow(2, attempts) * 500;
							console.warn(`[Content] Error transitorio detectado, reintentando en ${delay}ms...`);
							setTimeout(() => safeSendMessage(msg, cb, attempts + 1), delay);
							return;
						}
						console.error("[Content] Error de comunicación no recuperable:", msgText);
						if (cb) cb({ status: 'error', message: msgText });
						return;
					}
					if (cb) cb(response);
				});
			} catch (e) {
				console.warn("[Content] Excepción en safeSendMessage:", e.message);
				capture_working = 0;
			}
		}

		chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
			if (request.action === "checkContentLoaded") {
				sendResponse({ loaded: true });
			}
			else if (request.action === 'showTip') {
				capturex_com_saveAction.showTip(request.msg);
			}
			else if (request.action === 'showLoading') {
				capturex_com_saveAction.showProgressOverlay();
				capturex_com_saveAction.updateProgress(5);
			}
			else if (request.action === 'setProgress') {
				capturex_com_saveAction.showProgressOverlay();
				capturex_com_saveAction.updateProgress(request.progress);
			}
			else if (request.action === 'captureAllPageScreenshot') {
				console.log("[Content] Recibida orden de inicio de captura total.");
				capturex_com_saveAction.captureAllPageScreenshot();
				sendResponse({ started: true });
			}
			else if (request.action === 'getNowShotImgData') {
				console.log(`[Content] Recibido fragmento de imagen. Y: ${request.y1}`);
				sendResponse({ started: true });

				// Enviar fragmento al motor (result.js) para unirlo
				safeSendMessage({
					target: "engine",
					action: "appendCaptureChunk",
					dataUrl: request.dataUrl,
					y: request.y1,
					height: request.y2 - request.y1
				}, (response) => {
					console.log(`[Content] Fragmento enviado al motor con éxito. Siguiente: ${request.nextPageData ? 'SI' : 'FIN'}`);
					if (request.nextPageData) {
						capturex_com_saveAction.captureVisiblePageScreenshot(
							request.nextPageData.docHeight, 
							request.nextPageData.nextScrollTop, 
							request.nextPageData.windowInnerHeight, 
							0, 0
						);
					}
					else {
						// Finalizar captura
						capturex_com_saveAction.restoreStyleForShot();
						safeSendMessage({ target: "engine", action: "finalizeCapture" });
					}
				});
			}
		});

		var capturex_com_tools = {
			isInElement: function (parentElement, childElement) {
				if (!parentElement || !childElement || !(parentElement instanceof Element) || !(childElement instanceof Element)) {
					return false;
				}
				let currentParent = childElement.parentElement;
				while (currentParent) {
					if (currentParent === parentElement) {
						return true;
					}
					currentParent = currentParent.parentElement;
				}
				return false;
			},
			isVerticallyScrollable: function (element, threshold = 0) {
				const scrollHeight = element.scrollHeight;
				const clientHeight = element.clientHeight;
				const computedStyle = window.getComputedStyle(element);
				const overflowY = computedStyle.getPropertyValue('overflow-y');

				let isOver = 0;
				if (element.tagName.toLowerCase() == 'html' && (clientHeight > window.innerHeight || scrollHeight > clientHeight)) {
					isOver = 1;
				}
				else if (scrollHeight > clientHeight + threshold) {
					isOver = 1;
				}

				if (element.tagName.toLowerCase() == 'html')
					return isOver == 1 && (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'visible');
				else if (element.classList && element.classList.toString().toLowerCase().indexOf('scroll') > -1)
					return isOver == 1 && (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden');
				else
					return isOver == 1 && (overflowY === 'auto' || overflowY === 'scroll');
			},
			isVerticallyScrollableFrame: function (element) {
				if ((element.tagName == 'IFRAME' || element.tagName == 'FRAME')) {
					if (capturex_com_tools.iframeIsSameOrigin(element)) {
						const iframeDocument = element.contentDocument || element.contentWindow.document;
						const documentHeight = iframeDocument.body.scrollHeight;
						const windowHeight = element.contentWindow.innerHeight;
						return documentHeight > windowHeight;
					}
					else
						return false;
				}
				else
					return false;
			},
			getVisibleBoundingRect: function (element) {
				let rect = element.getBoundingClientRect();
				let ancestor = element.parentElement;

				while (ancestor) {
					const ancestorRect = ancestor.getBoundingClientRect();
					rect = {
						top: Math.max(rect.top, ancestorRect.top),
						left: Math.max(rect.left, ancestorRect.left),
						bottom: Math.min(rect.bottom, ancestorRect.bottom),
						right: Math.min(rect.right, ancestorRect.right),
						width: Math.min(rect.right, ancestorRect.right) - Math.max(rect.left, ancestorRect.left),
						height: Math.min(rect.bottom, ancestorRect.bottom) - Math.max(rect.top, ancestorRect.top)
					};
					if (rect.top >= rect.bottom || rect.left >= rect.right) {
						return null;
					}

					ancestor = ancestor.parentElement;
				}
				return rect;
			},
			iframeIsSameOrigin: function (iframe) {
				const currentOrigin = window.location.origin;
				const iframeSrc = iframe.src;
				try {
					const iframeUrl = new URL(iframeSrc);
					const iframeOrigin = iframeUrl.origin;
					return currentOrigin === iframeOrigin;
				} catch (error) {
					return false;
				}
			},
			EnEight: function (txt) {
				var monyer = new Array(); var i, s;
				for (i = 0; i < txt.length; i++)
					monyer += "//" + txt.charCodeAt(i).toString(8);
				return monyer;
			},
			getScrollbarWidth2: function (element) { //Get the scrollbar width of a element
				if (element.tagName == 'IFRAME' || element.tagName == 'FRAME') {
					const iframeDocument = element.contentDocument || element.contentWindow.document;
					const outer = iframeDocument.createElement('div');
					outer.style.visibility = 'hidden';
					outer.style.overflow = 'scroll';
					outer.style.msOverflowStyle = 'scrollbar';
					iframeDocument.body.appendChild(outer);
					const inner = iframeDocument.createElement('div');
					outer.appendChild(inner);

					const computedStyle = window.getComputedStyle(element);
					const paddingLeft = parseFloat(computedStyle.paddingLeft);
					const paddingRight = parseFloat(computedStyle.paddingRight);

					let scrollbarWidth = outer.offsetWidth - inner.offsetWidth - paddingLeft - paddingRight;
					outer.parentNode.removeChild(outer);
					if (scrollbarWidth > 30 || scrollbarWidth < 0)
						scrollbarWidth = 0;

					return scrollbarWidth;
				}
				else {
					const originalOverflow = element.style.overflow;
					element.style.overflow = 'scroll';
					const withScroll = element.offsetWidth;
					const inner = document.createElement('div');
					inner.style.width = '100%';
					element.appendChild(inner);

					const computedStyle = window.getComputedStyle(element);
					const paddingLeft = parseFloat(computedStyle.paddingLeft);
					const paddingRight = parseFloat(computedStyle.paddingRight);

					const withoutScroll = inner.offsetWidth;

					element.removeChild(inner);

					element.style.overflow = originalOverflow;

					let scrollbarWidth = withScroll - withoutScroll - paddingLeft - paddingRight;
					if (scrollbarWidth > 30 || scrollbarWidth < 0)
						scrollbarWidth = 0;

					if (computedStyle.scrollbarWidth && computedStyle.scrollbarWidth == 'thin')
						scrollbarWidth = 10;

					return scrollbarWidth;
				}
			},
			getScrollbarWidth: function () { //Get the scrollbar width of page
				const outer = document.createElement('div');
				outer.style.visibility = 'hidden';
				outer.style.overflow = 'scroll';
				outer.style.msOverflowStyle = 'scrollbar';
				document.body.appendChild(outer);
				const inner = document.createElement('div');
				outer.appendChild(inner);
				let scrollbarWidth = outer.offsetWidth - inner.offsetWidth;
				outer.parentNode.removeChild(outer);
				if (scrollbarWidth > 50 || scrollbarWidth < 0)
					scrollbarWidth = 0;
				return scrollbarWidth;
			},
			dom: function (obj) {
				if (!obj.hasChildNodes) {
					return;
				}
				var nodes = obj.childNodes;
				for (var i = 0; i < nodes.length; i++) {
					var curNode = nodes[i];
					var attrs = curNode.attributes;
					if (curNode.nodeName.toLowerCase() == "script"
						|| curNode.nodeName.toLowerCase() == "iframe"
						|| curNode.nodeName.toLowerCase() == "link"
						|| curNode.nodeName.toLowerCase() == "meta"
						|| !this.isVisibleNode(curNode)) {
						curNode.parentNode.removeChild(curNode)
					} else if (curNode.nodeName.toLowerCase() == "a"
						|| curNode.nodeName.toLowerCase() == "img"
						|| curNode.nodeName.toLowerCase() == "embed") {
						if (attrs != null) {
							for (var j = 0; j < attrs.length; j++) {
								var a = attrs[j].nodeName.toLowerCase();
								var v = attrs[j].nodeValue;
								if (a == "href" || a == "src") {
									if (v.toLowerCase().indexOf("javascript:") == 0
										|| v.indexOf("#") == 0) {
										attrs[j].nodeValue = "";
									} else {
										v = this.replaceURL(v);
										attrs[j].nodeValue = v;
									}
								}
							}
						}
					}
					if (curNode != null && curNode.hasChildNodes) {
						this.dom(curNode);
					}
				}
			},
			replaceURL: function (url) {
				if (!window.location) {
					return url;
				}
				var match = null;
				url = this.trim(url);
				var host = window.location.host;
				var proto = window.location.protocol;
				var base = window.location.href.split("?")[0].split('#')[0];
				base = base.substr(0, base.lastIndexOf('/')) + "/";
				var rbase = proto + "//" + host;
				if ((match = url.match(/^(https?):/i)) != null) {
					return url;
				} else {
					if (url.indexOf("/") == 0) {
						return rbase + url;
					} else {
						return base + url;
					}
				}
			},
			trim: function (str) {
				if (typeof str != "string") {
					return str;
				} else {
					return str.replace(/^\s+/, '').replace(/\s+$/, '');
				}
			},
			isBrowser: function () {
				if (navigator.appVersion.indexOf("MSIE", 0) != -1)
					return 'IE';
				if (navigator.appVersion.indexOf("WebKit", 0) != -1)
					return 'Safari';
				if (navigator.userAgent.indexOf("Firefox", 0) != -1)
					return 'Firefox';
				if (navigator.userAgent.indexOf("WebKit") > 0
					&& navigator.userAgent.indexOf("iPad") > 0)
					return 'Ipad';
				if (navigator.userAgent.indexOf("WebKit") > 0
					&& navigator.userAgent.indexOf("iPhone") > 0)
					return 'Iphone';
				if (navigator.userAgent.indexOf("WebKit") > 0
					&& navigator.userAgent.indexOf("Chrome") > 0)
					return 'Chrome';
			},
			isVisibleNode: function (node) {
				if (node.nodeType) {
					if (node.nodeType == 3) {
						return true;
					}
					if (this.isBrowser() == 'IE') {
						if (node.currentStyle != null
							&& node.currentStyle['display'] == "none") {
							return false;
						}
					} else {
						try {
							if (window.getComputedStyle(node, null)['display'] == "none") {
								return false;
							}
						} catch (e) {
							return false;
						}
					}
					return true;
				} else {
					return false;
				}
			},
			scrollToHeight: function (height) {
				window.scrollTo({
					top: height
				});
			},
			withoutInlineStyleImportant: function (element) {
				const inlineStyle = element.style.cssText;
				if (inlineStyle.includes('opacity') && inlineStyle.includes('!important')) {
					const match = inlineStyle.match(/opacity:\s*([\d.]+)\s*!important/);
					if (match) {
						const opacityValue = match[1];
						const newStyle = inlineStyle.replace(/opacity:\s*([\d.]+)\s*!important/, `opacity: ${opacityValue}`);
						element.style.cssText = newStyle;
					}
				}
				if (inlineStyle.includes('transition') && element.classList.toString().indexOf('adsbygoogle') > -1) {
					const newStyleWithoutTransition = element.style.cssText.replace(/transition:[^;]+;/g, '');
					element.style.cssText = newStyleWithoutTransition;
				}
			},
			isScrollLoadedElement: async function (targetElement, timeout = 1000) {
				const initialHTML = targetElement.innerHTML;
				const initialLength = initialHTML.length;
				const originalScrollTop = targetElement.scrollTop;

				const checkContentGrowth = () => {
					return targetElement.innerHTML.length > initialLength * 1.1;
				};

				return new Promise(resolve => {
					const observer = new MutationObserver(() => {
						if (checkContentGrowth()) {
							cleanup();
							resolve(true);
						}
					});

					const timeoutId = setTimeout(() => {
						cleanup();
						resolve(checkContentGrowth());
					}, timeout);

					const cleanup = () => {
						observer.disconnect();
						targetElement.scrollTop = originalScrollTop;
						clearTimeout(timeoutId);
					};

					observer.observe(targetElement, {
						childList: true,
						subtree: true,
						attributes: false,
						characterData: false
					});

					targetElement.scrollTop = targetElement.scrollHeight * 0.5;
				});
			},
			isElementOccluded: function (el) { //Determine if it is obstructed
				const rect = el.getBoundingClientRect();
				const centerX = rect.left + rect.width / 2;
				const centerY = rect.top + rect.height / 2;
				const elementAtPoint = document.elementFromPoint(centerX, centerY);
				return elementAtPoint !== el && !el.contains(elementAtPoint);
			},
			pauseAllAnimations: function () {
				document.querySelectorAll('*').forEach(el => {
					const computedStyle = window.getComputedStyle(el);
					const hasAnimation = computedStyle.animationName !== 'none' || computedStyle.transitionProperty !== 'none';
					if (hasAnimation) {
						el.style.animationPlayState = 'paused';
						el.style.transition = 'none';
					}
				});
			},
			resumeAllAnimations: function () {
				document.querySelectorAll('[style*="animation-play-state"], [style*="transition"]').forEach(el => {
					el.style.animationPlayState = '';
					el.style.transition = '';
				});
			},
			copyImageToClipboard: async function (imageData, mimeType = 'image/png') {
				try {
					if (!navigator.clipboard) {
						capturex_com_saveAction.showTip('Copiar no está soportado');
						throw new Error('Clipboard API Error');
					}
					let blob;

					if (typeof imageData === 'string' && imageData.startsWith('data:')) {
						const base64Str = imageData.replace(/^data:image\/\w+;base64,/, '');
						const byteCharacters = atob(base64Str);
						const byteArrays = [];

						for (let offset = 0; offset < byteCharacters.length; offset += 512) {
							const slice = byteCharacters.slice(offset, offset + 512);
							const byteNumbers = new Array(slice.length);

							for (let i = 0; i < slice.length; i++) {
								byteNumbers[i] = slice.charCodeAt(i);
							}

							byteArrays.push(new Uint8Array(byteNumbers));
						}
						blob = new Blob(byteArrays, { type: mimeType });
					}
					else if (imageData instanceof Blob) {
						blob = imageData;
					}
					else {
						throw new Error('Data Error');
					}

					await navigator.clipboard.write([
						new ClipboardItem({
							[mimeType]: blob
						})
					]);
					capturex_com_saveAction.showTip('Imagen copiada al portapapeles');
					return true;
				} catch (error) {
					capturex_com_saveAction.showTip('Error al copiar imagen');
					return false;
				}
			}
		};

		var capturex_com_saveAction = {
			contentjsIsLoad: function () {
				safeSendMessage({ action: "contentjsIsLoad" });
			},
			setCanvasMaxHeight: function (width) {
				//count capturex_canvas_browserMaxHeight
				if (width > 0) {
					const maxArea = capturex_canvas_browserMaxArea_sys; //Chrome 73+
					let maxHeight = Math.floor(maxArea / width);
					if (maxHeight < capturex_canvas_browserMaxHeight_sys)
						capturex_canvas_browserMaxHeight = maxHeight;
				}
			},
			reSetCaptureXData: function () {
				//console.log('reSetCaptureXData');
				//Reset global variables
				capturex_scrollPosition = 0;
				capturex_contentEle = undefined;
				capturex_contentEleIframe = undefined;
				capturex_contentEle_over_top = 0;
				capturex_contentEle_over_bottom = 0;
				capturex_documentHeight_o = 0;
				capturex_documentHeight = 0;
				capturex_documentWidth = 0;
				capturex_onePageHeight = 0;
				capturex_onePageOverlap = 0;
				capturex_contentPageCrollTop = 0;
				capturex_nowRealPageCrollTop = 0;
				capturex_preRealPageCrollTop = 0;
				capturex_scrollbarWidth = 0;
				capturex_changStyleForShotTimes = 0;
				capturex_snap_mergedImage_array = [];
				capturex_snap_mergedImage_index = 0;
				capturex_capture_top = undefined;
				capturex_capture_bottom = undefined;
				capturex_capture_left = undefined;
				capturex_capture_right = undefined;
				capturex_capture_array = [];
				capturex_capture_array_width = [];
				capturex_capture_array_height = [];
				capturex_capture_array_splicing_index = 0;
				capturex_overScrollTop = 0;
				elementAbsolutePositions.clear();
				capture_working = 0;
				capturex_scrollableEles = [];
				capturex_setChildScrollableHeight = 0;
				capturex_fullpage = 0;
			},
			captureSelectionEdit: function () {
				clearSelectionDiv();

				var docHeight = Math.max(
					document.body.scrollHeight, document.documentElement.scrollHeight,
					document.body.offsetHeight, document.documentElement.offsetHeight,
					document.body.clientHeight, document.documentElement.clientHeight
				);

				var docWidth = Math.max(
					document.body.scrollWidth, document.documentElement.scrollWidth,
					document.body.offsetWidth, document.documentElement.offsetWidth,
					document.body.clientWidth, document.documentElement.clientWidth
				);

				var capturex_overlay_0 = document.createElement("div");
				capturex_overlay_0.style.cssText = "position: absolute; left: 0px; top: 0px; opacity: 0; cursor: crosshair; z-index: 2147483640; display: block !important; width: " + docWidth + "px; height: " + docHeight + "px;";
				capturex_overlay_0.id = "capturex_overlay_0";
				document.body.appendChild(capturex_overlay_0);

				var capturex_overlay_1 = document.createElement("div");
				capturex_overlay_1.style.cssText = "position: absolute; background: rgb(0, 0, 0); opacity: 0.3; z-index: 2147483639; cursor: crosshair; display: block !important; left: 0px; top: 0px; width: " + docWidth + "px; height: 0px;";
				capturex_overlay_1.id = "capturex_overlay_1";
				document.body.appendChild(capturex_overlay_1);

				var capturex_overlay_2 = document.createElement("div");
				capturex_overlay_2.style.cssText = "position: absolute; background: rgb(0, 0, 0); opacity: 0.3; z-index: 2147483639; cursor: crosshair; display: block !important; left: 0px; top: 0px; width: " + docWidth + "px; height: " + docHeight + "px;";
				capturex_overlay_2.id = "capturex_overlay_2";
				document.body.appendChild(capturex_overlay_2);

				var capturex_overlay_3 = document.createElement("div");
				capturex_overlay_3.style.cssText = "position: absolute; background: rgb(0, 0, 0); opacity: 0.3; z-index: 2147483639; cursor: crosshair; display: block !important; left: 0px; top: 0px; width: 0px; height: 0px;";
				capturex_overlay_3.id = "capturex_overlay_3";
				document.body.appendChild(capturex_overlay_3);

				var capturex_overlay_4 = document.createElement("div");
				capturex_overlay_4.style.cssText = "position: absolute; background: rgb(0, 0, 0); opacity: 0.3; z-index: 2147483639; cursor: crosshair; display: block !important; left: 0px; top: 0px; width: " + docWidth + "px; height: 0px;";
				capturex_overlay_4.id = "capturex_overlay_4";
				document.body.appendChild(capturex_overlay_4);

				var capturex_slection_area = document.createElement("div");
				capturex_slection_area.style.cssText = "position: absolute; left: 0px; top: 0px; width: 0px; height: 0px; z-index: 2147483639; cursor: crosshair; display: block !important;";
				capturex_slection_area.id = "capturex_slection_area";

				var capturex_slection_area_div0 = document.createElement("div");
				capturex_slection_area_div0.style.cssText = 'background: url("data:image/gif;base64,R0lGODlhAQAGAKEAAP///wAAADY2Nv///yH/C05FVFNDQVBFMi4wAwEAAAAh/hpDcmVhdGVkIHdpdGggYWpheGxvYWQuaW5mbwAh+QQACgD/ACwAAAAAAQAGAAACAxQuUgAh+QQBCgADACwAAAAAAQAGAAACA5SAUgAh+QQBCgADACwAAAAAAQAGAAACA5SBBQAh+QQBCgADACwAAAAAAQAGAAACA4QOUAAh+QQBCgADACwAAAAAAQAGAAACAwSEUAAh+QQBCgADACwAAAAAAQAGAAACA4SFBQA7") left top repeat-y; opacity: 0.5; position: absolute; cursor: crosshair; display: block !important; inset: 0px;';
				capturex_slection_area.appendChild(capturex_slection_area_div0);

				var capturex_slection_area_div1 = document.createElement("div");
				capturex_slection_area_div1.style.cssText = 'background: url("data:image/gif;base64,R0lGODlhBgABAKEAAP///wAAADY2Nv///yH/C05FVFNDQVBFMi4wAwEAAAAh/hpDcmVhdGVkIHdpdGggYWpheGxvYWQuaW5mbwAh+QQACgD/ACwAAAAABgABAAACAxQuUgAh+QQBCgADACwAAAAABgABAAACA5SAUgAh+QQBCgADACwAAAAABgABAAACA5SBBQAh+QQBCgADACwAAAAABgABAAACA4QOUAAh+QQBCgADACwAAAAABgABAAACAwSEUAAh+QQBCgADACwAAAAABgABAAACA4SFBQA7") left top repeat-x; opacity: 0.5; position: absolute; cursor: crosshair; display: block !important; inset: 0px;';
				capturex_slection_area.appendChild(capturex_slection_area_div1);

				var capturex_slection_area_div2 = document.createElement("div");
				capturex_slection_area_div2.style.cssText = 'background: url("data:image/gif;base64,R0lGODlhAQAGAKEAAP///wAAADY2Nv///yH/C05FVFNDQVBFMi4wAwEAAAAh/hpDcmVhdGVkIHdpdGggYWpheGxvYWQuaW5mbwAh+QQACgD/ACwAAAAAAQAGAAACAxQuUgAh+QQBCgADACwAAAAAAQAGAAACA5SAUgAh+QQBCgADACwAAAAAAQAGAAACA5SBBQAh+QQBCgADACwAAAAAAQAGAAACA4QOUAAh+QQBCgADACwAAAAAAQAGAAACAwSEUAAh+QQBCgADACwAAAAAAQAGAAACA4SFBQA7") right top repeat-y; opacity: 0.5; position: absolute; cursor: crosshair; display: block !important; inset: 0px;';
				capturex_slection_area.appendChild(capturex_slection_area_div2);

				var capturex_slection_area_div3 = document.createElement("div");
				capturex_slection_area_div3.style.cssText = 'background: url("data:image/gif;base64,R0lGODlhBgABAKEAAP///wAAADY2Nv///yH/C05FVFNDQVBFMi4wAwEAAAAh/hpDcmVhdGVkIHdpdGggYWpheGxvYWQuaW5mbwAh+QQACgD/ACwAAAAABgABAAACAxQuUgAh+QQBCgADACwAAAAABgABAAACA5SAUgAh+QQBCgADACwAAAAABgABAAACA5SBBQAh+QQBCgADACwAAAAABgABAAACA4QOUAAh+QQBCgADACwAAAAABgABAAACAwSEUAAh+QQBCgADACwAAAAABgABAAACA4SFBQA7") left bottom repeat-x; opacity: 0.5; position: absolute; cursor: crosshair; display: block !important; inset: 0px;';
				capturex_slection_area.appendChild(capturex_slection_area_div3);

				var capturex_slection_area_txt = document.createElement("div");
				capturex_slection_area_txt.id = "capturex_slection_area_txt";
				capturex_slection_area_txt.style.cssText = "font-family: Tahoma, Helvetica, Arial; font-size: 14px; color: rgb(255, 255, 255); width: auto; height: auto; padding: 3px; background: rgb(0, 0, 0); opacity: 0.9; position: absolute; border: 1px solid rgb(51, 51, 51); cursor: crosshair; display: block !important; visibility: hidden; bottom: 10px; right: 10px;";
				capturex_slection_area_txt.innerText = "0 x 0";
				capturex_slection_area.appendChild(capturex_slection_area_txt);

				document.body.appendChild(capturex_slection_area);

				let originalUserSelect = document.body.style.userSelect;
				function handleMousedown(e) {
					e.preventDefault();
					originalUserSelect = document.body.style.userSelect;
					document.body.style.userSelect = 'none';

					capturex_scrollPosition = document.documentElement.scrollTop || document.body.scrollTop;
					capturex_startX = e.clientX;
					capturex_startY = e.clientY + capturex_scrollPosition;
					capturex_overlay_1.style.height = capturex_startY + "px";
					capturex_overlay_3.style.top = capturex_startY + "px";
					capturex_overlay_3.style.width = capturex_startX + "px";
					capturex_isSelecting = true;
				}
				document.addEventListener('mousedown', handleMousedown);

				function handleMousemove(e) {
					if (capturex_isSelecting) {
						let limitedX = Math.max(0, Math.min(e.clientX, window.innerWidth));
						let limitedY = Math.max(0, Math.min(e.clientY, window.innerHeight));

						capturex_endX = limitedX;
						capturex_endY = limitedY + capturex_scrollPosition;
						//top shadow
						if (capturex_endY - capturex_startY > 0)
							capturex_overlay_1.style.height = capturex_startY + "px"
						else
							capturex_overlay_1.style.height = capturex_endY + "px"
						//bottom shadow	
						if (capturex_endY - capturex_startY > 0)
							capturex_overlay_2.style.top = capturex_endY + "px"
						else
							capturex_overlay_2.style.top = capturex_startY + "px"

						if (capturex_endY - capturex_startY > 0)
							capturex_overlay_2.style.height = docHeight - capturex_endY + "px";
						else
							capturex_overlay_2.style.height = docHeight - capturex_startY + "px";
						//left shadow
						if (capturex_endY - capturex_startY > 0)
							capturex_overlay_3.style.top = capturex_startY + "px";
						else
							capturex_overlay_3.style.top = capturex_endY + "px";

						if (capturex_endX - capturex_startX > 0)
							capturex_overlay_3.style.width = capturex_startX + "px";
						else
							capturex_overlay_3.style.width = capturex_endX + "px";

						capturex_overlay_3.style.height = Math.abs(capturex_endY - capturex_startY) + "px";
						//right shadow
						if (capturex_endX > capturex_startX)
							capturex_overlay_4.style.left = capturex_endX + "px";
						else
							capturex_overlay_4.style.left = capturex_startX + "px";

						if (capturex_endY > capturex_startY)
							capturex_overlay_4.style.top = capturex_startY + "px";
						else
							capturex_overlay_4.style.top = capturex_endY + "px";

						capturex_overlay_4.style.height = Math.abs(capturex_endY - capturex_startY) + "px";

						if (capturex_endX > capturex_startX)
							capturex_overlay_4.style.width = (docWidth - capturex_endX) + "px";
						else
							capturex_overlay_4.style.width = (docWidth - capturex_startX) + "px";
						//selection
						if (capturex_endX > capturex_startX)
							capturex_slection_area.style.left = capturex_startX + "px";
						else
							capturex_slection_area.style.left = capturex_endX + "px";

						if (capturex_endY > capturex_startY)
							capturex_slection_area.style.top = capturex_startY + "px";
						else
							capturex_slection_area.style.top = capturex_endY + "px";
						capturex_slection_area.style.width = Math.abs(capturex_endX - capturex_startX) + "px";
						capturex_slection_area.style.height = Math.abs(capturex_endY - capturex_startY) + "px";
					}
				}
				document.addEventListener('mousemove', handleMousemove);

				function handleMouseup(e) {
					capturex_isSelecting = false;

					let limitedX = Math.max(0, Math.min(e.clientX, window.innerWidth));
					let limitedY = Math.max(0, Math.min(e.clientY, window.innerHeight));

					capturex_endX = limitedX;
					capturex_endY = limitedY + capturex_scrollPosition;

					document.body.style.userSelect = originalUserSelect;

					document.removeEventListener('mousedown', handleMousedown);
					document.removeEventListener('mousemove', handleMousemove);
					document.removeEventListener('mouseup', handleMouseup);
					document.removeEventListener('keydown', handleKeyDown);

					var capturex_selection_save_div = document.createElement("div");
					capturex_selection_save_div.id = "capturex_selection_save_div";
					var selectBtnHtml = '';
					selectBtnHtml += '<span id="capturex_selection_copyButton" style="cursor:pointer;font-size:14px;padding:5px;border-radius: 6px 0px 0px 6px;background-color: #007bff;color:#fff;z-index: 2147483647 !important;" onmouseover="this.style.backgroundColor=\'#0056b3\'" onmouseout="this.style.backgroundColor=\'#007bff\'">Copiar</span>';
					selectBtnHtml += '<span id="capturex_selection_editButton" style="margin-left:2px;cursor:pointer;font-size:14px;padding:5px;border-radius: 0px 0px 0px 0px;background-color: #007bff;color:#fff;z-index: 2147483647 !important;" onmouseover="this.style.backgroundColor=\'#0056b3\'" onmouseout="this.style.backgroundColor=\'#007bff\'">Editar</span>';
					selectBtnHtml += '<span id="capturex_selection_cancelButton" style="margin-left:2px;cursor:pointer;font-size:14px;padding:5px;border-radius: 0px 6px 6px 0px;background-color: #007bff;color:#fff;z-index: 2147483647 !important;" onmouseover="this.style.backgroundColor=\'#0056b3\'" onmouseout="this.style.backgroundColor=\'#007bff\'">Cancelar</span>';
					capturex_selection_save_div.innerHTML = selectBtnHtml;
					capturex_selection_save_div.style.width = 'auto';
					capturex_selection_save_div.style.position = 'absolute';
					capturex_selection_save_div.style.zIndex = 2147483641;

					var capturex_scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
					document.body.appendChild(capturex_selection_save_div);
					var element_slection_area = document.getElementById('capturex_slection_area');
					var element_slection_area_rect = element_slection_area.getBoundingClientRect();
					capturex_selection_save_div.style.left = (element_slection_area_rect.right - capturex_selection_save_div.offsetWidth - 2) + 'px';
					capturex_selection_save_div.style.top = (element_slection_area_rect.bottom + capturex_scrollTop - capturex_selection_save_div.offsetHeight - 2) + 'px';

					const copyButton = document.getElementById('capturex_selection_copyButton');
					const editButton = document.getElementById('capturex_selection_editButton');
					const cancelButton = document.getElementById('capturex_selection_cancelButton');
					copyButton.addEventListener('mouseover', function () {
						this.style.backgroundColor = '#0056b3';
					});
					copyButton.addEventListener('mouseout', function () {
						this.style.backgroundColor = '#007bff';
					});
					editButton.addEventListener('mouseover', function () {
						this.style.backgroundColor = '#0056b3';
					});
					editButton.addEventListener('mouseout', function () {
						this.style.backgroundColor = '#007bff';
					});
					cancelButton.addEventListener('mouseover', function () {
						this.style.backgroundColor = '#0056b3';
					});
					cancelButton.addEventListener('mouseout', function () {
						this.style.backgroundColor = '#007bff';
					});

					copyButton.addEventListener('click', handleCopyBtnClick);
					editButton.addEventListener('click', handleEditBtnClick);
					cancelButton.addEventListener('click', handleCancelBtnClick);
					function handleEditBtnClick(event) {
						handleCancelBtnClick(event);
						setTimeout(function () {
							safeSendMessage({ action: "captureVisiblePageScreenshot4Selection" });
						}, 20);
					}
					function handleCancelBtnClick(event) {
						clearSelectionDiv();
					}
					function handleCopyBtnClick(event) {
						handleCancelBtnClick(event);
						setTimeout(function () {
							safeSendMessage({ action: "captureVisiblePageScreenshot4SelectionCopy" });
						}, 20);
					}
				}
				document.addEventListener('mouseup', handleMouseup);

				function clearSelectionDiv() {
					let element_0 = document.getElementById('capturex_overlay_0');
					if (element_0) document.body.removeChild(element_0);
					let element_1 = document.getElementById('capturex_overlay_1');
					if (element_1) document.body.removeChild(element_1);
					let element_2 = document.getElementById('capturex_overlay_2');
					if (element_2) document.body.removeChild(element_2);
					let element_3 = document.getElementById('capturex_overlay_3');
					if (element_3) document.body.removeChild(element_3);
					let element_4 = document.getElementById('capturex_overlay_4');
					if (element_4) document.body.removeChild(element_4);
					let element_slection_area = document.getElementById('capturex_slection_area');
					if (element_slection_area) document.body.removeChild(element_slection_area);
					let capturex_selection_save_div = document.getElementById('capturex_selection_save_div');
					if (capturex_selection_save_div) document.body.removeChild(capturex_selection_save_div);
				}

				document.addEventListener('keydown', handleKeyDown);
				function handleKeyDown(e) {
					if (event.key === 'Escape' || event.key === 'Esc') {
						var element_0 = document.getElementById('capturex_overlay_0');
						if (element_0) document.body.removeChild(element_0);
						var element_1 = document.getElementById('capturex_overlay_1');
						if (element_1) document.body.removeChild(element_1);
						var element_2 = document.getElementById('capturex_overlay_2');
						if (element_2) document.body.removeChild(element_2);
						var element_3 = document.getElementById('capturex_overlay_3');
						if (element_3) document.body.removeChild(element_3);
						var element_4 = document.getElementById('capturex_overlay_4');
						if (element_4) document.body.removeChild(element_4);
						var element_slection_area = document.getElementById('capturex_slection_area');
						if (element_slection_area) document.body.removeChild(element_slection_area);

						document.removeEventListener('mousedown', handleMousedown);
						document.removeEventListener('mousemove', handleMousemove);
						document.removeEventListener('mouseup', handleMouseup);
						document.removeEventListener('keydown', handleKeyDown);
					}
				}
			},
			cropRangeImage: function (imageDataUrl) {
				if (capturex_contentEleRectTop > 0 || (capturex_contentEleRectBottom - 20) < window.innerHeight) {
					const image = new Image();
					image.src = imageDataUrl;
					image.onload = function () {

						var zoomLevel = window.devicePixelRatio;
						if (capturex_contentEleRectTop > 0) //get capturex_capture_top 
						{
							const canvas = document.createElement('canvas');
							const context = canvas.getContext('2d');

							const cropWidth = window.innerWidth * zoomLevel;
							const cropHeight = capturex_contentEleRectTop * zoomLevel;

							canvas.width = cropWidth;
							canvas.height = cropHeight;
							context.drawImage(image, 0, 0, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

							capturex_capture_top = canvas.toDataURL('image/png');
						}

						if (capturex_contentEleRectBottom < window.innerHeight) {
							const canvas = document.createElement('canvas');
							const context = canvas.getContext('2d');

							const cropWidth = window.innerWidth * zoomLevel;
							const cropHeight = Math.abs(window.innerHeight - capturex_contentEleRectBottom) * zoomLevel;

							canvas.width = cropWidth;
							canvas.height = cropHeight;
							context.drawImage(image, 0, capturex_contentEleRectBottom * zoomLevel, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

							capturex_capture_bottom = canvas.toDataURL('image/png');
						}

						if (capturex_contentEleRectLeft > 0) {
							const canvas = document.createElement('canvas');
							const context = canvas.getContext('2d');

							const cropWidth = capturex_contentEleRectLeft * zoomLevel;
							const cropHeight = window.innerHeight * zoomLevel;

							canvas.width = cropWidth;
							canvas.height = cropHeight;
							context.drawImage(image, 0, 0, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

							capturex_capture_left = canvas.toDataURL('image/png');
						}

						if (capturex_contentEleRectRight < window.innerWidth) {
							const canvas = document.createElement('canvas');
							const context = canvas.getContext('2d');

							const cropWidth = (window.innerWidth - capturex_contentEleRectRight) * zoomLevel;
							const cropHeight = window.innerHeight * zoomLevel;

							canvas.width = cropWidth;
							canvas.height = cropHeight;
							context.drawImage(image, capturex_contentEleRectRight * zoomLevel, 0, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

							capturex_capture_right = canvas.toDataURL('image/png');
						}

					};
				}
			},
			cropImageContent: function (imageDataUrl, pageType = 0) {
				return new Promise((resolve, reject) => {
					let startX = capturex_contentEleRectLeft;
					let startY = capturex_contentEleRectTop + capturex_contentEle_over_top;
					let endX = capturex_contentEleRectRight;
					let endY = capturex_contentEleRectBottom - capturex_contentEle_over_bottom;

					if (capturex_contentEle.style.transform) {
						startX = capturex_contentEleRectLeft;
						startY = capturex_contentEleRectTop - capturex_contentEle_over_top;
						endX = capturex_contentEleRectRight;
						endY = capturex_contentEleRectBottom - capturex_contentEle_over_bottom;
					}

					var pageScrollPosition = 0;
					if (capturex_scrollableEles.length == 0)
						pageScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

					const zoomLevel = window.devicePixelRatio;
					let _startX = startX * zoomLevel;
					let _startY = (startY - pageScrollPosition) * zoomLevel;
					let _endX = endX * zoomLevel;
					let _endY = (endY - pageScrollPosition) * zoomLevel;

					if (capturex_scrollbarWidth > 0)
						_endX = _endX - capturex_scrollbarWidth * zoomLevel;

					if (capturex_onePageOverlap > 0) {
						var capturex_onePageOverlap_half = capturex_onePageOverlap / 2 * zoomLevel;
						if (pageType == 0) {
							_endY = _endY - Math.floor(capturex_onePageOverlap_half);
						}
						else if (pageType == 1) {
							_startY = _startY + Math.ceil(capturex_onePageOverlap_half);
							_endY = _endY - Math.floor(capturex_onePageOverlap_half);
						}
						else if (pageType == 2) {
						}
					}

					if (pageType == 0 && capturex_fullpage == 1) {
						capturex_com_saveAction.cropRangeImage(imageDataUrl);
					}

					capturex_startX = 0;
					capturex_startY = 0;
					capturex_endX = 0;
					capturex_endY = 0;

					const image = new Image();
					image.src = imageDataUrl;
					image.onload = function () {
						const canvas = document.createElement('canvas');
						const context = canvas.getContext('2d');

						const cropWidth = Math.abs(_endX - _startX);
						const cropHeight = Math.abs(_endY - _startY);
						canvas.width = cropWidth;
						canvas.height = cropHeight;

						context.drawImage(image, Math.min(_startX, _endX), Math.min(_startY, _endY), cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

						const cropImageDataUrl = canvas.toDataURL('image/png');
						capturex_capture_array_width.push(canvas.width);
						capturex_capture_array_height.push(canvas.height);
						resolve(cropImageDataUrl);
					};

					image.onerror = function (err) {
						reject(new Error("Image failed to load"));
					};
				});
			},
			cropImage: function (imageDataUrl, startX, startY, endX, endY, forCopy = 0) {
				var zoomLevel = window.devicePixelRatio;
				var _startX = startX * zoomLevel;
				var _startY = (startY - capturex_scrollPosition) * zoomLevel;
				var _endX = endX * zoomLevel;
				var _endY = (endY - capturex_scrollPosition) * zoomLevel;

				capturex_startX = 0;
				capturex_startY = 0;
				capturex_endX = 0;
				capturex_endY = 0;
				capturex_scrollPosition = 0;

				var image = new Image();
				image.src = imageDataUrl;
				image.onload = function () {
					var canvas = document.createElement('canvas');
					var context = canvas.getContext('2d');

					var cropWidth = Math.abs(_endX - _startX);
					var cropHeight = Math.abs(_endY - _startY);
					canvas.width = cropWidth;
					canvas.height = cropHeight;

					context.drawImage(image, Math.min(_startX, _endX), Math.min(_startY, _endY), cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
					var cropImageDataUrl = canvas.toDataURL('image/png');

					if (forCopy == 1)
						capturex_com_tools.copyImageToClipboard(cropImageDataUrl, 'image/png');
					else
						safeSendMessage({ action: "setSelectionCaptureData", dataUrl: cropImageDataUrl, pageHtml: document.documentElement.outerHTML });
				};
			},
			capturePageEdit: function () {
				capturex_changStyleForShotTimes = 0;
				const capturex_win_save_div = document.getElementById('capturex_win_save_div');
				if (capturex_win_save_div)
					document.body.removeChild(capturex_win_save_div);

				capturex_com_saveAction.changStyleForShot();

				setTimeout(function () {
					safeSendMessage({ action: "captureVisiblePageScreenshot4Edit", pageHtml: document.documentElement.outerHTML });
				}, 200);

				setTimeout(function () {
					capturex_com_saveAction.restoreStyleForShot();
				}, 500);
			},
			getNewDocHeight: function () {
				var newDocHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

				if (capturex_contentEle) {
					newDocHeight = capturex_contentEle.scrollHeight;
					if ((capturex_contentEle.tagName == 'IFRAME' || capturex_contentEle.tagName == 'FRAME') && capturex_com_tools.iframeIsSameOrigin(capturex_contentEle)) {
						const iframeDocument = capturex_contentEle.contentDocument || capturex_contentEle.contentWindow.document;
						newDocHeight = iframeDocument.body.scrollHeight;
					}
				}

				return newDocHeight;
			},
			getMaxHeight: function (element, currentDepth, maxDepth) {
				if (currentDepth > maxDepth) {
					return 0;
				}

				const rect = element.getBoundingClientRect();
				const width = rect.width;

				let maxHeight = element.scrollHeight;
				if ((element.tagName == 'IFRAME' || element.tagName == 'FRAME') && capturex_com_tools.iframeIsSameOrigin(element)) {
					const iframeDocument = element.contentDocument || element.contentWindow.document;
					maxHeight = iframeDocument.body.scrollHeight;
				}

				let computedStyle = window.getComputedStyle(element);

				if (element.tagName == 'IFRAME' && width > capturex_documentWidth - 100 && rect.top < window.innerHeight / 2 && maxHeight > capturex_documentHeight / 2) {
					if (element.src && element.src.indexOf('http') == 0 && !capturex_com_tools.iframeIsSameOrigin(element)) {
						capturex_contentEleIframe = element;
					}
				}

				if (computedStyle.overflowY == 'scroll' || computedStyle.overflowY == 'auto') {
					if ((element.innerHTML.length > 100 || element.innerHTML.includes('<img')) && rect.top < window.innerHeight / 2 && element.tagName != 'BODY' && maxHeight > capturex_documentHeight && (width > 500 || width > capturex_documentWidth / 2)) {
						if (element.scrollHeight > element.clientHeight) {
							capturex_documentHeight = maxHeight;
							capturex_contentEle = element;
						}
					}
				}
				else if (computedStyle.transform && computedStyle.transform != 'none' && capturex_documentHeight < window.innerHeight * 1.5) {
					if (element.parentElement.transform == 'none' && (element.innerHTML.length > 100 || element.innerHTML.includes('<img')) && rect.top < window.innerHeight / 2 && element.tagName != 'BODY' && maxHeight > capturex_documentHeight && (width > 500 || width > capturex_documentWidth / 2)) {
						capturex_documentHeight = maxHeight;
						capturex_contentEle = element;
					}
				}
				else if (element.tagName == 'IFRAME' || element.tagName == 'FRAME') {
					if (element.src && capturex_com_tools.iframeIsSameOrigin(element) && maxHeight > capturex_documentHeight && (width > 500 || width > capturex_documentWidth / 2)) {
						if (document.documentElement.scrollHeight == document.documentElement.clientHeight) {
							capturex_documentHeight = maxHeight;
							capturex_contentEle = element;
						}
					}
				}

				for (let i = 0; i < element.children.length; i++) {
					let child = element.children[i];
					maxHeight = Math.max(maxHeight, capturex_com_saveAction.getMaxHeight(child, currentDepth + 1, maxDepth));
				}
				return maxHeight;
			},
			captureAllPageScreenshot: function (nowTop = 0) {
				console.log('Iniciando captureAllPageScreenshot...');
				capturex_com_saveAction.reSetCaptureXData();
				capture_working = 1;
				capturex_fullpage = 1;

				// Mostrar barra de progreso inmediatamente
				capturex_com_saveAction.showProgressOverlay();
				capturex_com_saveAction.updateProgress(5);

				const capturex_win_save_div = document.getElementById('capturex_win_save_div');
				if (capturex_win_save_div)
					document.body.removeChild(capturex_win_save_div);

				let scrollableElements;

				var docHeight = Math.max(
					document.body.scrollHeight, document.documentElement.scrollHeight
				);
				console.log('DocHeight:', docHeight, 'WindowHeight:', window.innerHeight);

				if (docHeight < window.innerHeight * 1.2) {
					console.log('Buscando elementos scrollables...');
					scrollableElements = capturex_com_saveAction.findScrollableElements();
					console.log('Elementos scrollables encontrados:', scrollableElements.length);
					if (scrollableElements && scrollableElements.length > 0) {
						let windowArea = window.innerWidth * window.innerHeight;
						for (let i = scrollableElements.length - 1; i >= 0; i--) {
							const rect = scrollableElements[i].getBoundingClientRect();
							const area = rect.width * rect.height;
							if (rect.height < window.innerHeight * 0.6 && area < windowArea * 0.3)
								scrollableElements.splice(i, 1);
						}
					}
				}

				let mainScrollableElement = null;
				if (scrollableElements && scrollableElements.length > 0) {
					console.log('Evaluando mainScrollableElement...');
					let maxArea = 0;
					let windowArea = window.innerWidth * window.innerHeight;
					for (const element of scrollableElements) {
						const rect = element.getBoundingClientRect();
						const area = rect.width * rect.height;
						if (area > maxArea && area > (windowArea * 0.5)) {
							maxArea = area;
							mainScrollableElement = element;
						}
					}
				}

				console.log('Buscando iframes...');
				const iframeElements = document.body.querySelectorAll('iframe, frame');
				for (let i = 0; i < iframeElements.length; i++) {
					const element = iframeElements[i];
					let rect = element.getBoundingClientRect();
					if (!capturex_com_tools.isElementOccluded(element) && rect.width > window.innerWidth * 0.7 && rect.height > window.innerHeight * 0.7 && !capturex_com_tools.iframeIsSameOrigin(element)) {
						console.log('capture iframe detected');
						capturex_com_saveAction.captureSelectAllPageScreenshot(null, 1);
						return;
					}
				}
				console.log('Fin búsqueda iframes. mainScrollableElement:', mainScrollableElement);

				if (mainScrollableElement) {
					const _rect = mainScrollableElement.getBoundingClientRect();
					const bodyStyles = window.getComputedStyle(document.body);

					if (parseFloat(bodyStyles.marginLeft) > 10 || parseFloat(bodyStyles.marginRight) > 10) {
						capturex_com_saveAction.captureSelectAllPageScreenshot(mainScrollableElement, 1, nowTop);
						return;
					}
					else if (mainScrollableElement.tagName == 'IFRAME' || mainScrollableElement.tagName == 'FRAME') {
						capturex_com_saveAction.captureSelectAllPageScreenshot(mainScrollableElement, 1, nowTop);
						return;
					}
					else {
						if (_rect.left == 0 && _rect.right == window.innerWidth && _rect.bottom == window.innerHeight && _rect.height > window.innerHeight * 0.5) {
							capturex_com_saveAction.captureSelectAllPageScreenshot(mainScrollableElement, 1, nowTop);
							return;
						}

						capturex_com_tools.isScrollLoadedElement(mainScrollableElement).then(isLazy => {
							if (!isLazy) {
								var _now_scrollPosition = mainScrollableElement.scrollTop + _rect.top;
								if (_now_scrollPosition < 0) {
									capturex_com_saveAction.captureSelectAllPageScreenshot(mainScrollableElement, 1, nowTop);
									return;
								}

								if (nowTop == 0 || _now_scrollPosition < 0)
									getFullPageAction(0);
								else
									getFullPageAction(_now_scrollPosition);
							}
							else {
								capturex_com_saveAction.captureSelectAllPageScreenshot(mainScrollableElement, 1, nowTop);
								return;
							}
						});
					}
				}
				else {
					console.log('No se detectó elemento scrollable principal, usando documentElement.');
					capturex_scrollPosition = document.documentElement.scrollTop || document.body.scrollTop;
					if (nowTop == 0) {
						console.log('Llamando a getFullPageAction(0)');
						getFullPageAction(0);
					}
					else {
						console.log('Llamando a getFullPageAction con scroll:', capturex_scrollPosition);
						getFullPageAction(capturex_scrollPosition);
					}
				}

				function getFullPageAction(top = 0) {
					console.log('Ejecutando getFullPageAction con top:', top);
					if (scrollableElements && scrollableElements.length > 0) {
						capturex_setChildScrollableHeight = 1;
						for (let i = scrollableElements.length - 1; i >= 0; i--) {
							capturex_com_saveAction.changStyleForFullShot(scrollableElements[i]);
						}
					}

					capturex_documentHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
					capturex_documentHeight_o = capturex_documentHeight;
					capturex_onePageHeight = window.innerHeight;
					capturex_documentWidth = document.documentElement.clientWidth;

					var prepareTime = 800;
					if (!scrollableElements || scrollableElements.length == 0)
						prepareTime = 100;

					setTimeout(function () {
						if (top == 0) window.scrollTo({ top: 0 });
						if (capturex_setChildScrollableHeight == 1) capturex_com_saveAction.changStyleForFullShot(document.body);
						capturex_com_saveAction.changStyleForShot();
					}, 20);

					setTimeout(function () {
						console.log("[Content] Inicializando sesión desde getFullPageAction...");
						safeSendMessage({
							target: "engine",
							action: "initCaptureSession",
							width: capturex_documentWidth,
							totalHeight: capturex_documentHeight,
							devicePixelRatio: window.devicePixelRatio || 1,
							info: {
								url: window.location.href,
								date: new Date().toLocaleString(),
								browser: navigator.userAgent.includes("Edg") ? "Edge" : "Chrome"
							}
						}, (response) => {
							console.log("[Content] Sesión lista, iniciando captura visible...");
							capturex_com_saveAction.captureVisiblePageScreenshot(capturex_documentHeight, top, capturex_onePageHeight, 0, 0);
						});
					}, prepareTime);
				}
			},
			captureSelectAllPageScreenshot: function (selectElement, fullPage, nowTop = 0) {
				console.log('captureSelectAllPageScreenshot');

				capturex_com_saveAction.reSetCaptureXData();
				if (fullPage) capturex_fullpage = 1;
				if (selectElement) capturex_scrollableEles.push(selectElement);

				capture_working = 1;

				const capturex_win_save_div = document.getElementById('capturex_win_save_div');
				if (capturex_win_save_div)
					document.body.removeChild(capturex_win_save_div);

				var docHeight = Math.max(
					document.body.scrollHeight, document.documentElement.scrollHeight,
					document.body.offsetHeight, document.documentElement.offsetHeight,
					document.body.clientHeight, document.documentElement.clientHeight
				);
				var windowInnerHeight = window.innerHeight;
				capturex_documentWidth = document.documentElement.clientWidth;

				if (selectElement) {
					capturex_contentEle = selectElement;

					if ((capturex_contentEle.tagName == 'IFRAME' || capturex_contentEle.tagName == 'FRAME') && capturex_com_tools.iframeIsSameOrigin(capturex_contentEle)) {
						const iframeDocument = capturex_contentEle.contentDocument || capturex_contentEle.contentWindow.document;
						docHeight = iframeDocument.body.scrollHeight;
					}
					else {
						docHeight = Math.max(
							capturex_contentEle.scrollHeight,
							capturex_contentEle.offsetHeight,
							capturex_contentEle.clientHeight
						);
					}

					capturex_documentHeight = docHeight;
					capturex_documentHeight_o = capturex_documentHeight;

				}
				else {
					capturex_documentHeight = docHeight;

					var _docHeight = capturex_com_saveAction.getMaxHeight(document.body, 0, 20);
					if (capturex_contentEleIframe) {
						capture_working = 0;
						alert('No se pueden capturar iframes de diferente origen');
						safeSendMessage({ action: "openNewTab", url: capturex_contentEleIframe.src });
						return;
					}


					if (_docHeight && _docHeight > docHeight && capturex_contentEle) {
						docHeight = capturex_documentHeight;
					}
					else {
						capturex_contentEle = undefined;
					}
					capturex_documentHeight_o = capturex_documentHeight;
				}

				if (capturex_contentEle) {
					const rect_capturex_contentEle = capturex_contentEle.getBoundingClientRect();

					const computedStyle = window.getComputedStyle(capturex_contentEle);
					const borderLeftWidth = parseFloat(computedStyle.borderLeftWidth);
					const borderRightWidth = parseFloat(computedStyle.borderRightWidth);
					const borderTopWidth = parseFloat(computedStyle.borderTopWidth);
					const borderBottomWidth = parseFloat(computedStyle.borderBottomWidth);

					capturex_contentEleRectLeft = rect_capturex_contentEle.left + borderLeftWidth;
					capturex_contentEleRectTop = rect_capturex_contentEle.top + borderTopWidth;
					capturex_contentEleRectRight = rect_capturex_contentEle.right - borderRightWidth;
					capturex_contentEleRectBottom = rect_capturex_contentEle.bottom - borderBottomWidth;

					if (capturex_contentEleRectTop < 0)
						capturex_contentEle_over_top = Math.abs(capturex_contentEleRectTop);
					if (capturex_contentEleRectBottom > window.innerHeight)
						capturex_contentEle_over_bottom = capturex_contentEleRectBottom - window.innerHeight;

					if (capturex_contentEle_over_top > 0 || capturex_contentEle_over_bottom > 0) {
						docHeight = docHeight - capturex_contentEle_over_top - capturex_contentEle_over_bottom;
						capturex_documentHeight = docHeight;
						capturex_documentHeight_o = capturex_documentHeight;
					}
				}

				if (capturex_contentEle) {
					if (capturex_contentEle.tagName == 'IFRAME' || capturex_contentEle.tagName == 'FRAME') {
						const iframeDocument = capturex_contentEle.contentDocument || capturex_contentEle.contentWindow.document;
						capturex_scrollPosition = iframeDocument.documentElement.scrollTop;
						capturex_scrollbarWidth = capturex_com_tools.getScrollbarWidth2(capturex_contentEle);
					}
					else if (capturex_contentEle.style.transform) {
						capturex_scrollPosition = 0;
						capturex_com_saveAction.simulateScroll(0 - capturex_documentHeight, capturex_contentEle);
					}
					else {
						capturex_scrollPosition = capturex_contentEle.scrollTop;
						console.log("capturex_scrollPosition", capturex_scrollPosition);
						capturex_scrollbarWidth = capturex_com_tools.getScrollbarWidth2(capturex_contentEle);
					}
				}
				else {
					capturex_scrollPosition = document.documentElement.scrollTop || document.body.scrollTop;
				}


				var prepareTime = 100;
				var scrollPosition = window.scrollY || document.documentElement.scrollTop;
				if (scrollPosition > 0 && !selectElement) {
					window.scrollTo({ top: 0 });
					prepareTime = 200;
				}

				capturex_onePageHeight = windowInnerHeight;
				if (capturex_contentEle) {
					capturex_onePageHeight = capturex_contentEle.clientHeight - capturex_contentEle_over_top - capturex_contentEle_over_bottom;
					if (capturex_onePageHeight < 0)
						capturex_onePageHeight = capturex_contentEle.clientHeight;

					if (capturex_onePageHeight >= 800)
						capturex_onePageOverlap = 400;
					else if (capturex_onePageHeight >= 600 && capturex_onePageHeight < 800)
						capturex_onePageOverlap = 300;
					else if (capturex_onePageHeight >= 400 && capturex_onePageHeight < 600)
						capturex_onePageOverlap = 100;
					else if (capturex_onePageHeight < 400)
						capturex_onePageOverlap = (Math.ceil(capturex_onePageHeight / 8)) * 2;

					if (capturex_onePageHeight > windowInnerHeight || capturex_contentEle.style.transform) {
						let _rect = capturex_com_tools.getVisibleBoundingRect(capturex_contentEle)
						if (!_rect)
							_rect = capturex_contentEle.parentElement.getBoundingClientRect();
						capturex_onePageHeight = _rect.bottom - _rect.top - 200;
					}
				}
				else {
					if (capturex_com_tools.isVerticallyScrollable(document.documentElement)) {
					}
					else if (capturex_com_tools.isVerticallyScrollable(document.body)) {
						if (!document.body.classList.contains('capturex_temp_scroll_auto')) {
							document.body.classList.add('capturex_temp_scroll_auto');
							document.body.classList.add('capturex_temp_shot_noscrollbar');
						}
						document.body.scrollTop = 0;
					}
				}

				if (capturex_documentHeight > capturex_onePageHeight && capturex_scrollableEles.length == 0) {
					setTimeout(function () {
						capturex_com_saveAction.changStyleForShot();
						window.scrollTo({ top: 0 });
					}, 20);
				}

				if (capturex_contentEle) {
					capturex_contentEle.scrollTop = 0 - capturex_contentEle.scrollHeight;
					let test_scrollTop = capturex_contentEle.scrollTop;
					if (test_scrollTop < 0) {
						capturex_overScrollTop = Math.abs(test_scrollTop);
						console.log("capturex_overScrollTop", capturex_overScrollTop);
					}
				}

				setTimeout(function () {
					console.log("[Content] Intentando enviar initCaptureSession al motor...");
						safeSendMessage({
							target: "engine",
							action: "initCaptureSession",
							width: capturex_documentWidth,
							totalHeight: capturex_documentHeight,
							devicePixelRatio: window.devicePixelRatio || 1,
							info: {
								url: window.location.href,
								date: new Date().toLocaleString(),
								browser: navigator.userAgent.includes("Edg") ? "Edge" : "Chrome"
							}
						}, (response) => {
							if (response && response.status === 'error') {
								console.error("[Content] Error al inicializar:", response.message);
								return;
							}

							console.log("[Content] Sesión inicializada en SW:", response);
							
							if (nowTop > 0 && capturex_contentEle) {
								var fistTop = capturex_scrollPosition + capturex_overScrollTop;
								capturex_com_saveAction.captureVisiblePageScreenshot(capturex_documentHeight, fistTop, capturex_onePageHeight, 0, 0);
							}
							else
								capturex_com_saveAction.captureVisiblePageScreenshot(capturex_documentHeight, 0, capturex_onePageHeight, 0, 0);
						});
				}, prepareTime);
			},
			simulateScroll: function (deltaY, element, scrollTop) {
				const _o_style = window.getComputedStyle(capturex_contentEle);
				const transform_o = _o_style.transform;

				const event = new WheelEvent("wheel", {
					deltaY: deltaY,
					bubbles: true,
					cancelable: true,
					view: window
				});
				element.dispatchEvent(event);

				setTimeout(() => {
					const _n_style = window.getComputedStyle(capturex_contentEle);
					const transform_n = _n_style.transform;
					if (transform_o == transform_n) {
						console.log("set matrix");
						const _style = window.getComputedStyle(capturex_contentEle);
						const transform = _style.transform;
						const matrix = transform.match(/^matrix\((.+)\)$/);
						if (matrix) {
							const values = matrix[1].split(', ');
							const translateY = scrollTop;
							capturex_contentEle.style.transform = `matrix(${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, -${translateY})`;
						}
					}
				}, 80);
			},
			getPageClientHeight: function () {
				let pageClientHeight = window.innerHeight;
				if (capturex_contentEle) {
					pageClientHeight = capturex_contentEle.clientHeight;
				}
				return pageClientHeight;
			},
			getPageScrollTop: function () {
				if (capturex_contentEle) {
					if (capturex_contentEle.tagName == 'IFRAME' || capturex_contentEle.tagName == 'FRAME') {
						const iframeWindow = capturex_contentEle.contentWindow;
						const scrollTop = iframeWindow.pageYOffset || iframeWindow.document.documentElement.scrollTop || iframeWindow.document.body.scrollTop;
						return scrollTop;
					}
					else {
						return capturex_contentEle.scrollTop;
					}
				}
				else {
					if (document.body && document.body.classList.contains('capturex_temp_scroll_auto')) {
						return document.body.scrollTop;
					}
					else {
						if (document.documentElement.scrollTop == 0 && document.body.scrollTop > 0)
							return document.body.scrollTop;
						else
							return window.pageYOffset || document.documentElement.scrollTop;
					}
				}
			},
			scrollTopForCapture: function (scrollTop) {
				if (capturex_contentEle) {
					if (capturex_contentEle.tagName == 'IFRAME' || capturex_contentEle.tagName == 'FRAME') {
						const iframeWindow = capturex_contentEle.contentWindow;
						iframeWindow.scrollTo(0, scrollTop);
					}
					else {
						if (capturex_contentEle.style.transform) {
							console.log("simulateScroll");
							capturex_com_saveAction.simulateScroll(scrollTop - capturex_contentPageCrollTop, capturex_contentEle, scrollTop);
						}
						else {
							capturex_contentEle.scrollTop = scrollTop - capturex_overScrollTop;
						}
					}
				}
				else {
					if (document.body && document.body.classList.contains('capturex_temp_scroll_auto')) {
						document.body.scrollTop = scrollTop;
					}
					else {
						window.scrollTo({ top: scrollTop });
					}
				}
			},
			captureVisiblePageScreenshot: function (docHeight, scrollTop, windowInnerHeight, _y1, _y2) {
				console.log('Ejecutando captureVisiblePageScreenshot. scrollTop:', scrollTop, 'docHeight:', docHeight);
				capturex_contentPageCrollTop = scrollTop;
				capturex_preRealPageCrollTop = capturex_com_saveAction.getPageScrollTop();
				capturex_com_saveAction.scrollTopForCapture(scrollTop);

				if (scrollTop > 0) {
					setTimeout(function () {
						capturex_com_saveAction.changStyleForShot(capturex_contentEle);
						capturex_nowRealPageCrollTop = capturex_com_saveAction.getPageScrollTop();
					}, 100);
				}

				setTimeout(function () {

					var waitTime = 500;
					if (scrollTop == 0)
						waitTime = 150;

					var newDocHeight = capturex_com_saveAction.getNewDocHeight();

					if (newDocHeight > docHeight) {
						docHeight = newDocHeight;
						capturex_documentHeight = docHeight;
						if (!capturex_contentEle && capturex_setChildScrollableHeight == 1)
							capturex_com_saveAction.changStyleForFullShot(document.body);
					}
					else if (newDocHeight < docHeight) {
						let reduceHeight = docHeight - newDocHeight;
						console.log('reduce scroll Height', reduceHeight);

						docHeight = newDocHeight;
						capturex_documentHeight = docHeight;
						if (scrollTop > 0 && (scrollTop - reduceHeight) > 0) {
							if (!capturex_contentEle && capturex_setChildScrollableHeight == 1)
								capturex_com_saveAction.changStyleForFullShot(document.body);

							scrollTop = scrollTop - reduceHeight;
							capturex_contentPageCrollTop = scrollTop;
							capturex_com_saveAction.scrollTopForCapture(scrollTop);
						}
					}

					if (newDocHeight > capturex_documentHeight_o + 2000 || (scrollTop > 6000 && docHeight > 10000)) {
						// Mostrar botón de detención si es necesario
					}

					let pageClientHeight = capturex_com_saveAction.getPageClientHeight();
					if (capture_working == 0) {
						setTimeout(function () {
							var y1 = 0;
							var y2 = 0;
							if (scrollTop > 0) {
								y1 = capturex_onePageHeight - (capturex_nowRealPageCrollTop - capturex_preRealPageCrollTop) - Math.floor(capturex_onePageOverlap / 2);
								y2 = capturex_onePageHeight;
							}
							capturex_com_saveAction.hideProgressOverlay(function () {
								safeSendMessage({ action: "captureVisiblePageScreenshot", y1: y1, y2: y2 });
							});
						}, waitTime);
					}
					else if ((scrollTop + pageClientHeight) < docHeight && scrollTop < capturex_capture_max_height) {
						if ((scrollTop + pageClientHeight * 2) > docHeight && docHeight > capturex_documentHeight_o)
							waitTime = waitTime + 800;

						var nextScrollTop = scrollTop + capturex_onePageHeight - capturex_onePageOverlap;
						var nextPageData = { docHeight: docHeight, nextScrollTop: nextScrollTop, windowInnerHeight: capturex_onePageHeight, y1: 0, y2: 0 };

						setTimeout(function () {
							capturex_com_saveAction.scrollTopForCapture(scrollTop);
							capturex_com_saveAction.hideProgressOverlay(function () {
								console.log('Enviando captureVisiblePageScreenshot al Service Worker...');
								safeSendMessage({ action: "captureVisiblePageScreenshot", y1: _y1, y2: _y2, nextPageData: nextPageData });
							});
						}, waitTime);

						let progressRate = (((scrollTop + pageClientHeight) / docHeight).toFixed(1)) * 100;
						if (progressRate > 100)
							progressRate = 99;

						if (progressRate > 0)
							safeSendMessage({ action: "setProgress", progress: progressRate });
					}
					else {
						if (docHeight > capturex_documentHeight_o)
							waitTime = waitTime + 1000;

						setTimeout(function () {
							capturex_com_saveAction.scrollTopForCapture(scrollTop);

							let _waitTime = 100;
							if (scrollTop > 0) _waitTime = 1000;
							setTimeout(function () {
								let _newDocHeight = capturex_com_saveAction.getNewDocHeight();
								if (_newDocHeight > docHeight) {
									docHeight = _newDocHeight;
									capturex_documentHeight = docHeight;
								}

								if ((scrollTop + pageClientHeight) < docHeight && scrollTop < capturex_capture_max_height) {
									var nextScrollTop = scrollTop + capturex_onePageHeight - capturex_onePageOverlap;
									var nextPageData = { docHeight: docHeight, nextScrollTop: nextScrollTop, windowInnerHeight: capturex_onePageHeight, y1: 0, y2: 0 };
									capturex_com_saveAction.hideProgressOverlay(function () {
										safeSendMessage({ action: "captureVisiblePageScreenshot", y1: _y1, y2: _y2, nextPageData: nextPageData });
									});

									let progressRate = (((scrollTop + pageClientHeight) / docHeight).toFixed(1)) * 100;
									if (progressRate > 100)
										progressRate = 99;

									if (progressRate > 0)
										safeSendMessage({ action: "setProgress", progress: progressRate });
								}
								else {
									safeSendMessage({ action: "setProgress", progress: 100 });

									capturex_nowRealPageCrollTop = capturex_com_saveAction.getPageScrollTop();

									var y1 = 0;
									var y2 = 0;
									if (scrollTop > 0) {
										y1 = capturex_onePageHeight - (capturex_nowRealPageCrollTop - capturex_preRealPageCrollTop) - Math.floor(capturex_onePageOverlap / 2);
										y2 = capturex_onePageHeight;
										if (y1 < 0) y1 = 0;
									}
									capturex_com_saveAction.hideProgressOverlay(function () {
										safeSendMessage({ action: "captureVisiblePageScreenshot", y1: y1, y2: y2 });
									});
								}
							}, _waitTime);
						}, waitTime);
					}

				}, 100);
			},
			hideProgressOverlay: function (callback) {
				// Remover del DOM para garantizar que NO aparece en el screenshot
				const ov = document.getElementById('capturex_sqa_progress_overlay');
				if (ov && ov.parentNode) {
					ov.parentNode.removeChild(ov);
				}
				// Esperar 2 frames para que el browser repinte antes del screenshot
				requestAnimationFrame(function () {
					requestAnimationFrame(function () {
						if (callback) callback();
					});
				});
			},
			restoreProgressOverlay: function () {
				// Re-insertar el overlay si no está ya en el DOM
				if (!document.getElementById('capturex_sqa_progress_overlay')) {
					capturex_com_saveAction.showProgressOverlay();
				}
			},
			showProgressOverlay: function () {
				if (document.getElementById('capturex_sqa_progress_overlay')) return;
				const overlay = document.createElement('div');
				overlay.id = 'capturex_sqa_progress_overlay';
				overlay.style.cssText = [
					'position:fixed',
					'top:18px',
					'right:22px',
					'z-index:2147483647',
					'background:#003366',
					'border-radius:10px',
					'box-shadow:0 4px 24px rgba(0,0,0,0.38),0 1px 6px rgba(0,51,102,0.22)',
					'padding:16px 22px 14px 16px',
					'display:flex',
					'align-items:center',
					'gap:13px',
					'min-width:230px',
					'max-width:320px',
					'border:1.5px solid #1a5fa8',
					'font-family:Segoe UI,Arial,sans-serif',
					'animation:capturex_sqa_fadein 0.22s cubic-bezier(.4,0,.2,1)'
				].join(';');

				// Inyectar keyframes si no existen
				if (!document.getElementById('capturex_sqa_style')) {
					const st = document.createElement('style');
					st.id = 'capturex_sqa_style';
					st.textContent = `
						@keyframes capturex_sqa_fadein {
							from { opacity:0; transform:translateY(-12px) scale(0.97); }
							to   { opacity:1; transform:translateY(0) scale(1); }
						}
						@keyframes capturex_sqa_bar {
							0%   { background-position: 0% 50%; }
							100% { background-position: 100% 50%; }
						}
					`;
					document.head.appendChild(st);
				}

				// Logo
				const logoImg = document.createElement('img');
				logoImg.src = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
					? chrome.runtime.getURL('SQA.png')
					: '';
				logoImg.style.cssText = 'width:38px;height:38px;object-fit:contain;flex-shrink:0;border-radius:6px;';

				// Contenido derecho
				const right = document.createElement('div');
				right.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:1;min-width:0;';

				const title = document.createElement('div');
				title.style.cssText = 'color:#fff;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;opacity:0.85;white-space:nowrap;';
				title.textContent = 'Capturando Evidencia';

				const barWrap = document.createElement('div');
				barWrap.style.cssText = 'background:rgba(255,255,255,0.13);border-radius:99px;height:6px;width:100%;overflow:hidden;';

				const bar = document.createElement('div');
				bar.id = 'capturex_sqa_bar';
				bar.style.cssText = [
					'height:100%',
					'width:5%',
					'border-radius:99px',
					'background:linear-gradient(90deg,#FF6B00,#FF9A3C,#FF6B00)',
					'background-size:200% 100%',
					'transition:width 0.4s cubic-bezier(.4,0,.2,1)',
					'animation:capturex_sqa_bar 1.2s linear infinite'
				].join(';');
				barWrap.appendChild(bar);

				const pct = document.createElement('div');
				pct.id = 'capturex_sqa_pct';
				pct.style.cssText = 'color:#FF9A3C;font-size:11px;font-weight:600;text-align:right;letter-spacing:0.3px;';
				pct.textContent = '0%';

				right.appendChild(title);
				right.appendChild(barWrap);
				right.appendChild(pct);

				overlay.appendChild(logoImg);
				overlay.appendChild(right);
				document.body.appendChild(overlay);
			},
			updateProgress: function (progress) {
				const bar = document.getElementById('capturex_sqa_bar');
				const pct = document.getElementById('capturex_sqa_pct');
				if (bar) bar.style.width = Math.min(progress, 100) + '%';
				if (pct) pct.textContent = Math.min(progress, 100) + '%';
				if (progress >= 100) {
					setTimeout(function () {
						const ov = document.getElementById('capturex_sqa_progress_overlay');
						if (ov) {
							ov.style.transition = 'opacity 0.4s,transform 0.4s';
							ov.style.opacity = '0';
							ov.style.transform = 'translateY(-10px) scale(0.96)';
							setTimeout(function () {
								if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
							}, 420);
						}
						const st = document.getElementById('capturex_sqa_style');
						if (st && st.parentNode) st.parentNode.removeChild(st);
					}, 900);
				}
			},
			showTip: function (txt) {
				var capturex_win_tip_div = document.createElement("div");
				capturex_win_tip_div.id = "capturex_win_tip_div";

				var tipDiv = document.createElement("div");
				tipDiv.style.cssText = "z-index: 2147483647; width: auto; height: auto; position:fixed; top:50%; left:50%; transform: translate(-50%, -50%); background-color: #000; opacity:0.7; padding: 10px 15px 10px 15px; border-radius: 4px; text-align: center; font-size:20px; color:#fff;";
				tipDiv.innerText = txt;

				capturex_win_tip_div.appendChild(tipDiv);
				document.body.appendChild(capturex_win_tip_div);
				setTimeout(function () {
					document.body.removeChild(document.getElementById('capturex_win_tip_div'));
				}, 1500);
			},
			setStyleForShot: function (element, className, styleText) {
				if (element.classList.toString().indexOf('capturex_temp_shot') == -1) {
					element.setAttribute('capturex_o_style', element.style.cssText);
				}

				let o_style = element.style.cssText;
				if (element.hasAttribute('capturex_o_style'))
					o_style = element.getAttribute('capturex_o_style');

				if (element.classList.toString().indexOf(className) == -1) {
					element.classList.add(className);
				}
				element.style.cssText = o_style + ';' + styleText;
			},
			changStyleForFullShot: function (element, minHeight) {
				let elementHeight = element.scrollHeight;
				if (minHeight && minHeight > 0 && elementHeight < minHeight)
					elementHeight = minHeight;

				var body_styleContent_class = 'capturex_temp_shot_body';
				var body_styleContent = 'transform: translateZ(0px); min-height: ' + capturex_documentHeight + 'px !important; overflow: hidden !important; position: absolute; top: 0px; left: 0px; right: 0px;';

				var item_styleContent_class = 'capturex_temp_shot_item';
				var item_styleContent = 'overflow-y: visible; min-height: ' + elementHeight + 'px !important;';
				if (minHeight && minHeight > 0)
					item_styleContent = 'min-height: ' + elementHeight + 'px !important;';
				if (element.tagName == 'BODY' || element.tagName == 'HTML') {
					capturex_com_saveAction.setStyleForShot(document.body, body_styleContent_class, body_styleContent);
				}
				else {
					capturex_com_saveAction.setStyleForShot(element, item_styleContent_class, item_styleContent);
					let parentElement = element.parentElement;
					if (parentElement && parentElement.tagName != 'BODY') {
						const elementStyle = window.getComputedStyle(parentElement);
						if (elementStyle.position == 'static' || elementStyle.position == 'relative')
							capturex_com_saveAction.changStyleForFullShot(parentElement, elementHeight);
						else if (elementStyle.position == 'absolute') {
							let rect = parentElement.getBoundingClientRect();
							if (rect.width > window.innerWidth * 0.7 && rect.height > window.innerHeight * 0.7) {
								capturex_com_saveAction.changStyleForFullShot(parentElement, elementHeight);
							}
						}
					}
				}
			},
			changStyleForShot: function (contentElement) {
				var fixed_styleContent_class = 'capturex_temp_shot_fixed';
				var fixed_styleContent = 'opacity:0 !important;z-index: -1 !important; animation: unset !important; transition-duration: 0s !important;';

				var fixed2absolute_styleContent_class = 'capturex_temp_shot_fixed2absolute';
				var fixed2absolute_styleContent = 'position: absolute !important; transition: none !important;';

				var sticky_styleContent_class = 'capturex_temp_shot_sticky';
				var sticky_styleContent = 'position:relative !important; inset: auto !important;';

				var content_styleContent_class = 'capturex_temp_shot_content';
				var content_styleContent = 'overflow-x: hidden !important; overflow-y: auto; z-index: 2147483647 !important;opacity:1 !important;';

				var html_styleContent_class = 'capturex_temp_shot_html';
				var html_styleContent = 'scrollbar-width: none; scroll-behavior: unset !important;';

				var styleTag = document.getElementById('capturex_temp_shot');
				if (!styleTag) {
					var styleTag = document.createElement('style');
					styleTag.id = 'capturex_temp_shot';

					var _capturex_temp_shot_noscrollbar = '.capturex_temp_shot_noscrollbar {scrollbar-width: none;} .capturex_temp_shot_noscrollbar::-webkit-scrollbar {display: none;}';
					styleTag.appendChild(document.createTextNode(_capturex_temp_shot_noscrollbar));

					var _fixed_styleContent = '.capturex_temp_shot_fixed {opacity:0 !important;z-index: -1 !important; animation: unset !important; transition-duration: 0s !important;}';
					styleTag.appendChild(document.createTextNode(_fixed_styleContent));

					var _fixed2absolute_styleContent = '.capturex_temp_shot_fixed2absolute {position: absolute !important; transition: none !important;}';
					styleTag.appendChild(document.createTextNode(_fixed2absolute_styleContent));

					var _sticky_styleContent = '.capturex_temp_shot_sticky {position:relative !important; inset: auto !important;}';
					styleTag.appendChild(document.createTextNode(_sticky_styleContent));

					var _content_styleContent = '.capturex_temp_shot_content {overflow-x: hidden !important; overflow-y: auto; z-index: 2147483647 !important;opacity:1 !important; scroll-behavior:auto !important;}';
					styleTag.appendChild(document.createTextNode(_content_styleContent));

					var _hide_styleContent = '.capturex_temp_shot_hide {opacity:0 !important;z-index: -1 !important;}';
					styleTag.appendChild(document.createTextNode(_hide_styleContent));

					document.head.appendChild(styleTag);

					var htmlElement = document.documentElement;
					capturex_com_saveAction.setStyleForShot(htmlElement, html_styleContent_class, html_styleContent);
				}

				if (contentElement) {
					capturex_com_saveAction.setStyleForShot(contentElement, content_styleContent_class, content_styleContent);
				}

				let elements;
				if (contentElement)
					elements = contentElement.querySelectorAll('*');
				else
					elements = document.querySelectorAll('*');

				elements.forEach((element, index) => {
					const elementStyle = window.getComputedStyle(element);
					if (elementStyle.position === 'sticky') {
						capturex_com_saveAction.setStyleForShot(element, sticky_styleContent_class, sticky_styleContent);
					}
					else if (elementStyle.position === 'fixed' && !capturex_com_tools.isInElement(element, capturex_contentEle)) {
						if (capturex_capture_array.length == 0) {
							let rect = element.getBoundingClientRect();
							if (rect.top > 200 && ((rect.left > window.innerWidth * 1 / 4 && rect.left < window.innerWidth * 3 / 4) || rect.width > window.innerWidth / 4)) {
								capturex_com_tools.withoutInlineStyleImportant(element);
								capturex_com_saveAction.setStyleForShot(element, fixed_styleContent_class, fixed_styleContent);
							}
							else if (element.parentElement && element.parentElement.tagName.toLowerCase() == 'html' && element.classList.toString().indexOf('adsbygoogle') > -1) {
								capturex_com_tools.withoutInlineStyleImportant(element);
								capturex_com_saveAction.setStyleForShot(element, fixed_styleContent_class, fixed_styleContent);
							}
						}
						else if (capturex_capture_array.length == 1) {
							let rect = element.getBoundingClientRect();

							if (rect.top < 100 && rect.height > 300 && rect.width > 100) {
								capturex_com_tools.withoutInlineStyleImportant(element);
								capturex_com_saveAction.setStyleForShot(element, fixed2absolute_styleContent_class, fixed2absolute_styleContent);
							}
							else {
								capturex_com_tools.withoutInlineStyleImportant(element);
								capturex_com_saveAction.setStyleForShot(element, fixed_styleContent_class, fixed_styleContent);
							}
						}
						else {
							element.classList.remove('capturex_temp_shot_fixed2absolute');
							capturex_com_tools.withoutInlineStyleImportant(element);
							capturex_com_saveAction.setStyleForShot(element, fixed_styleContent_class, fixed_styleContent);
						}
					}
				});
				capturex_changStyleForShotTimes++;
			},
			restoreStyleForShot: function () {
				capturex_com_saveAction.scrollTopForCapture(capturex_scrollPosition);
				capturex_changStyleForShotTimes = 0;

				document.documentElement.classList.remove('capturex_temp_scroll_auto');
				document.body.classList.remove('capturex_temp_scroll_auto');

				const bodyElements = document.querySelectorAll('.capturex_temp_shot_body');
				bodyElements.forEach(element => {
					element.classList.remove('capturex_temp_shot_body');
					if (element.hasAttribute('capturex_o_style')) {
						element.style.cssText = element.getAttribute('capturex_o_style');
						element.removeAttribute('capturex_o_style');
					}
				});

				const itemElements = document.querySelectorAll('.capturex_temp_shot_item');
				itemElements.forEach(element => {
					if (element.hasAttribute('capturex_o_style')) {
						element.style.cssText = element.getAttribute('capturex_o_style');
						element.removeAttribute('capturex_o_style');
					}
					element.classList.remove('capturex_temp_shot_item');
				});

				const htmlElements = document.querySelectorAll('.capturex_temp_shot_html');
				htmlElements.forEach(element => {
					if (element.hasAttribute('capturex_o_style')) {
						element.style.cssText = element.getAttribute('capturex_o_style');
						element.removeAttribute('capturex_o_style');
					}
					element.classList.remove('capturex_temp_shot_html');
				});

				const contentElements = document.querySelectorAll('.capturex_temp_shot_content');
				contentElements.forEach(element => {
					if (element.hasAttribute('capturex_o_style')) {
						element.style.cssText = element.getAttribute('capturex_o_style');
						element.removeAttribute('capturex_o_style');
					}
					element.classList.remove('capturex_temp_shot_content');
				});

				const noscrollbar_elements = document.querySelectorAll('.capturex_temp_shot_noscrollbar');
				noscrollbar_elements.forEach(element => {
					if (element.hasAttribute('capturex_o_style')) {
						element.style.cssText = element.getAttribute('capturex_o_style');
						element.removeAttribute('capturex_o_style');
					}
					element.classList.remove('capturex_temp_shot_noscrollbar');
				});

				const noscrollbar_x_elements = document.querySelectorAll('.capturex_temp_shot_noscrollbar_x');
				noscrollbar_x_elements.forEach(element => {
					if (element.hasAttribute('capturex_o_style')) {
						element.style.cssText = element.getAttribute('capturex_o_style');
						element.removeAttribute('capturex_o_style');
					}
					element.classList.remove('capturex_temp_shot_noscrollbar_x');
				});

				const fixed_elements = document.querySelectorAll('.capturex_temp_shot_fixed');
				fixed_elements.forEach(element => {
					if (element.hasAttribute('capturex_o_style')) {
						element.style.cssText = element.getAttribute('capturex_o_style');
						element.removeAttribute('capturex_o_style');
					}
					element.classList.remove('capturex_temp_shot_fixed');
				});

				const fixed2absolute_elements = document.querySelectorAll('.capturex_temp_shot_fixed2absolute');
				fixed2absolute_elements.forEach(element => {
					if (element.hasAttribute('capturex_o_style')) {
						element.style.cssText = element.getAttribute('capturex_o_style');
						element.removeAttribute('capturex_o_style');
					}
					element.classList.remove('capturex_temp_shot_fixed2absolute');
				});

				const sticky_elements = document.querySelectorAll('.capturex_temp_shot_sticky');
				sticky_elements.forEach(element => {
					if (element.hasAttribute('capturex_o_style')) {
						element.style.cssText = element.getAttribute('capturex_o_style');
						element.removeAttribute('capturex_o_style');
					}
					element.classList.remove('capturex_temp_shot_sticky');
				});

				var styleTag = document.getElementById('capturex_temp_shot');
				if (styleTag)
					styleTag.remove();
			},
			splicingImagesAndSendAction: function (imageWidth, imageHeight, y1, y2) {
				if (capturex_capture_array_splicing_index > 0) {
					capturex_com_saveAction.splicingImagesAarrayLast(imageWidth, imageHeight, y1, y2)
						.then(mergedImage => {
							capturex_snap_mergedImage_array.push(mergedImage);
							capturex_snap_mergedImage_index++;

							if (capturex_capture_array_splicing_index < (capturex_capture_array.length - 1)) {
								capturex_com_saveAction.splicingImagesAndSendAction(imageWidth, imageHeight, y1, y2);
							}
							else {
								capturex_com_saveAction.splitSendImgData();
							}
						})
						.catch(error => {
							console.error('Error merging images ' + capturex_snap_mergedImage_index, error);
						});
				}
				else {
					capturex_com_saveAction.splicingImagesAarray(imageWidth, imageHeight, y1, y2)
						.then(mergedImage => {
							capturex_snap_mergedImage_array.push(mergedImage);

							capturex_snap_mergedImage_index++;

							if (capturex_capture_array_splicing_index < (capturex_capture_array.length - 1)) {
								capturex_com_saveAction.splicingImagesAndSendAction(imageWidth, imageHeight, y1, y2);
							}
							else {
								capturex_com_saveAction.splitSendImgData();
							}
						})
						.catch(error => {
							console.error('Error merging images ' + capturex_snap_mergedImage_index, error);
						});
				}
			},
			splicingImagesAarray: async function (width, height, y1, y2) {
				safeSendMessage({ action: "setProgress", progress: 100 });

				try { safeSendMessage({ action: "showLoading" }); } catch (error) { };

				// ----- HEADER PATCH -----
				const HEADER_HEIGHT = 100;
				// Utilidades header
				function pad(n) { return String(n).padStart(2, "0"); }
				function formateaFechaHora(date) {
					let h = date.getHours(), m = date.getMinutes(), s = date.getSeconds();
					let ampm = h >= 12 ? "p.m." : "a.m.";
					let h12 = h % 12; if (h12 === 0) h12 = 12;
					return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${h12}:${pad(m)}:${pad(s)} ${ampm}`;
				}
				function recortaUrl(url) {
					if (url.length > 150) return url.substring(0, 147) + "...";
					return url;
				}
				async function getBrowserVersion() {
					let browserName = "N/A", fullVersion = "N/A", ua = navigator.userAgent;
					try {
						if (navigator.userAgentData?.getHighEntropyValues) {
							const uaData = await navigator.userAgentData.getHighEntropyValues(['fullVersionList']);
							const info = uaData.fullVersionList?.find(b => b.brand === "Microsoft Edge" || b.brand === "Google Chrome");
							if (info) {
								browserName = info.brand.includes("Edge") ? "Edge" : "Chrome";
								fullVersion = info.version;
							}
						} else if (ua.indexOf("Edg/") !== -1) {
							browserName = "Edge";
							fullVersion = ua.split("Edg/")[1].split(" ")[0];
						} else if (ua.indexOf("Chrome/") !== -1) {
							browserName = "Chrome";
							fullVersion = ua.split("Chrome/")[1].split(" ")[0];
						}
					} catch (e) { }
					return { browserName, fullVersion };
				}
				async function drawEvidenceHeader(ctx, canvasWidth, headerHeight) {
					return new Promise(resolve => {
						let h = headerHeight;
						ctx.save();
						
						// Fondo azul oscuro sólido y nítido
						ctx.fillStyle = "#002b55"; 
						ctx.fillRect(0, 0, canvasWidth, h);
						
						// Línea inferior de acento (SQA Orange)
						ctx.fillStyle = "#FF6B00";
						ctx.fillRect(0, h - 4, canvasWidth, 4);

						const logoImg = new window.Image();
						logoImg.onload = async function () {
							// Dibujar Logo
							ctx.drawImage(logoImg, 25, 15, 80, 55);

							// Configuración de texto para máxima nitidez
							ctx.textBaseline = "top";
							
							// Título principal
							ctx.font = "bold 26px Segoe UI, Roboto, sans-serif";
							ctx.fillStyle = "#ffffff";
							ctx.fillText("EVIDENCIA DE PRUEBAS QA", 125, 18);

							// URL
							ctx.font = "600 17px Segoe UI, Roboto, sans-serif";
							ctx.fillStyle = "#ffffff";
							ctx.fillText("URL: " + recortaUrl(window.location.href), 125, 48);

							// Fecha y Navegador
							ctx.font = "italic 15px Segoe UI, Roboto, sans-serif";
							ctx.fillStyle = "#cbd5e0"; 
							let brow = await getBrowserVersion();
							ctx.fillText(`📅 ${formateaFechaHora(new Date())}    💻 ${brow.browserName} ${brow.fullVersion}`, 125, 72);

							ctx.restore();
							resolve();
						};
						logoImg.onerror = () => { resolve(); };
						logoImg.src = chrome.runtime.getURL("SQA.png");
					});
				}
				// ----- FIN HEADER PATCH -----

				let totalWidth = width;
				let n_y = 0;
				if (y1 > 0 && y2 > 0) n_y = Math.floor(height / y2 * y1);

				let totalHeight = 0;
				let end_index = capturex_capture_array.length - 1;
				if (capturex_capture_array_height && capturex_capture_array_height.length > 0) {
					let last_height = capturex_capture_array_height[capturex_capture_array_height.length - 1];
					if (y1 > 0 && y2 > 0) n_y = Math.floor(last_height / y2 * y1);

					totalHeight = 0;
					capturex_capture_array_height.forEach(function (number) {
						totalHeight += number;
					});
					if (y1 > 0 && y2 > 0)
						totalHeight = totalHeight - n_y;
				}
				else {
					totalHeight = height * (capturex_capture_array.length - 1) + (height - n_y);
				}
				capturex_com_saveAction.setCanvasMaxHeight(width);

				if (totalHeight > capturex_canvas_browserMaxHeight) {
					var _totalHeight = 0;
					for (let i = 0; i < capturex_capture_array.length; i++) {
						let dtotalHeight = 0, dheight = 0;
						if (capturex_capture_array_height && capturex_capture_array_height.length > 0) {
							for (let j = 0; j < i; j++) {
								dheight += capturex_capture_array_height[j];
							}
						}
						if (capturex_capture_array_height && capturex_capture_array_height.length > 0)
							dtotalHeight = dheight + capturex_capture_array_height[i];
						else
							dtotalHeight = (i + 1) * height;
						if (dtotalHeight > capturex_canvas_browserMaxHeight)
							break;
						else {
							end_index = i;
							_totalHeight = dtotalHeight;
						}
					}
					totalHeight = _totalHeight;
					if (end_index == capturex_capture_array.length - 2) {
						if (capturex_capture_array_height && capturex_capture_array_height.length > 0)
							totalHeight = totalHeight - capturex_capture_array_height[end_index];
						else
							totalHeight = end_index * height;
						end_index = end_index - 1;
					}
				}

				var zoomLevel = window.devicePixelRatio;
				if (capturex_capture_top || capturex_capture_bottom || capturex_capture_right || capturex_capture_left)
					totalWidth = window.innerWidth * zoomLevel;

				if (capturex_capture_top) totalHeight = totalHeight + capturex_contentEleRectTop * zoomLevel;
				if (capturex_capture_bottom && capturex_capture_array.length > 1 && end_index == capturex_capture_array.length - 1)
					totalHeight = totalHeight + (window.innerHeight - capturex_contentEleRectBottom) * zoomLevel;

				// =========== CREA EL CANVAS FINAL (AÑADE HEADER)
				const canvas = document.createElement('canvas');
				canvas.width = totalWidth;
				canvas.height = totalHeight + HEADER_HEIGHT;
				const context = canvas.getContext('2d');
				await drawEvidenceHeader(context, canvas.width, HEADER_HEIGHT);

				// Fondo blanco debajo:
				context.save();
				context.fillStyle = "#fff";
				context.fillRect(0, HEADER_HEIGHT, canvas.width, canvas.height - HEADER_HEIGHT);
				context.restore();

				let top_image_height = 0;
				if (capturex_capture_top) {
					const image = new Image();
					image.src = capturex_capture_top;
					await new Promise(resolve => {
						image.onload = () => {
							top_image_height = image.naturalHeight;
							context.drawImage(image, 0, HEADER_HEIGHT, image.naturalWidth, image.naturalHeight);
							resolve();
						};
					});
				}
				let left_image_width = 0;
				if (capturex_capture_left) {
					const image = new Image();
					image.src = capturex_capture_left;
					await new Promise(resolve => {
						image.onload = () => {
							left_image_width = image.naturalWidth;
							let dheight = 0;
							if (capturex_contentEleRectBottom < window.innerHeight)
								dheight = (window.innerHeight - capturex_contentEleRectBottom) * zoomLevel;
							context.drawImage(image, 0, HEADER_HEIGHT, image.naturalWidth, image.naturalHeight - dheight, 0, HEADER_HEIGHT, image.naturalWidth, image.naturalHeight - dheight);
							resolve();
						};
					});
				}
				if (capturex_capture_right) {
					const image = new Image();
					image.src = capturex_capture_right;
					await new Promise(resolve => {
						image.onload = () => {
							let dheight = 0;
							if (capturex_contentEleRectBottom < window.innerHeight)
								dheight = (window.innerHeight - capturex_contentEleRectBottom) * zoomLevel;
							context.drawImage(image, 0, HEADER_HEIGHT, image.naturalWidth, image.naturalHeight - dheight, totalWidth - image.naturalWidth, HEADER_HEIGHT, image.naturalWidth, image.naturalHeight - dheight);
							resolve();
						};
					});
				}

				for (let i = 0; i < capturex_capture_array.length; i++) {
					if (i > end_index) break;
					capturex_capture_array_splicing_index = i;
					const image = new Image();
					image.src = capturex_capture_array[i];
					await new Promise(resolve => {
						image.onload = () => {
							let destY = HEADER_HEIGHT;
							if (i == (capturex_capture_array.length - 1) && y1 > 0 && y2 > 0) {
								if (capturex_capture_array_height && capturex_capture_array_height.length > 0) {
									let dheight = 0;
									for (let j = 0; j < i; j++) {
										dheight += capturex_capture_array_height[j];
									}
									context.drawImage(image, 0, n_y, width, capturex_capture_array_height[i] - n_y, 0 + left_image_width, dheight + top_image_height + HEADER_HEIGHT, width, capturex_capture_array_height[i] - n_y);
								}
								else {
									context.drawImage(image, 0, n_y, width, height - n_y, 0 + left_image_width, height * i + top_image_height + HEADER_HEIGHT, width, height - n_y);
								}
							}
							else {
								if (capturex_capture_array_height && capturex_capture_array_height.length > 0) {
									let dheight = 0;
									for (let j = 0; j < i; j++) {
										dheight += capturex_capture_array_height[j];
									}
									context.drawImage(image, 0 + left_image_width, dheight + top_image_height + HEADER_HEIGHT, width, capturex_capture_array_height[i]);
								}
								else {
									context.drawImage(image, 0 + left_image_width, i * height + top_image_height + HEADER_HEIGHT, width, height);
								}
							}
							resolve();
						};
					});
				}
				if (capturex_capture_bottom && capturex_capture_array_splicing_index == (capturex_capture_array.length - 1)) {
					const image = new Image();
					image.src = capturex_capture_bottom;
					await new Promise(resolve => {
						image.onload = () => {
							left_image_width = image.naturalWidth;
							context.drawImage(image, 0, (canvas.height - image.naturalHeight), image.naturalWidth, image.naturalHeight);
							resolve();
						};
					});
				}
				// ================ FIN HEADER

				return new Promise(resolve => {
					canvas.toBlob(blob => {
						const reader = new FileReader();
						reader.onload = () => resolve(reader.result);
						reader.readAsDataURL(blob);
					}, 'image/png');
				});
			}, // <-- NO OLVIDES la coma si hay más métodos abajo en el objeto

			splicingImagesAarrayLast: async function (width, height, y1, y2) {
				let start_index = capturex_capture_array_splicing_index + 1;
				let totalWidth = width;

				let n_y = 0;
				if (y1 > 0 && y2 > 0) n_y = Math.floor(height / y2 * y1);

				let totalHeight = 0;
				let end_index = capturex_capture_array.length - 1;
				if (capturex_capture_array_height && capturex_capture_array_height.length > 0) {
					let last_height = capturex_capture_array_height[capturex_capture_array_height.length - 1];
					if (y1 > 0 && y2 > 0) n_y = Math.floor(last_height / y2 * y1);

					totalHeight = 0;
					for (var i = start_index; i < capturex_capture_array_height.length; i++) {
						totalHeight += capturex_capture_array_height[i];
					}
					if (y1 > 0 && y2 > 0)
						totalHeight = totalHeight - n_y;
				}
				else {
					totalHeight = height * ((capturex_capture_array.length - start_index) - 1) + (height - n_y);
				}

				if (totalHeight > capturex_canvas_browserMaxHeight) {
					var _totalHeight = 0;
					for (let i = start_index; i < capturex_capture_array.length; i++) {

						let dtotalHeight = 0;
						let dheight = 0;
						if (capturex_capture_array_height && capturex_capture_array_height.length > 0) {
							for (let j = start_index; j < i; j++) {
								dheight += capturex_capture_array_height[j];
							}
						}

						if (capturex_capture_array_height && capturex_capture_array_height.length > 0) {
							dtotalHeight = dheight + capturex_capture_array_height[i];
						}
						else {
							dtotalHeight = (i - start_index + 1) * height;
						}

						if (dtotalHeight > capturex_canvas_browserMaxHeight) {
							break;
						}
						else {
							end_index = i;
							_totalHeight = dtotalHeight;
						}
					}
					totalHeight = _totalHeight;
				}

				var zoomLevel = window.devicePixelRatio;
				if (capturex_capture_top || capturex_capture_bottom || capturex_capture_right || capturex_capture_left)
					totalWidth = window.innerWidth * zoomLevel;

				if (capturex_capture_bottom && capturex_capture_array.length > 1 && end_index == capturex_capture_array.length - 1) {
					totalHeight = totalHeight + (window.innerHeight - capturex_contentEleRectBottom) * zoomLevel;
				}

				let left_image_width = 0;
				if (capturex_capture_left) {
					left_image_width = capturex_contentEleRectLeft * zoomLevel;
				}

				const canvas = document.createElement('canvas');
				canvas.width = totalWidth;
				canvas.height = totalHeight;
				const context = canvas.getContext('2d');
				let bgColor = 'rgb(255, 255, 255)';
				if (document.body) bgColor = window.getComputedStyle(document.body).backgroundColor;
				if (bgColor == 'rgba(0, 0, 0, 0)' || bgColor == 'transparent') bgColor = 'rgb(255, 255, 255)';
				context.fillStyle = bgColor;
				context.fillRect(0, 0, canvas.width, canvas.height);

				for (let i = start_index; i < capturex_capture_array.length; i++) {
					if (i > end_index)
						break;
					capturex_capture_array_splicing_index = i;

					const image = new Image();
					image.src = capturex_capture_array[i];
					await new Promise(resolve => {
						image.onload = () => {
							if (i == (capturex_capture_array.length - 1) && y1 > 0 && y2 > 0) {
								if (capturex_capture_array_height && capturex_capture_array_height.length > 0) {
									let dheight = 0;
									for (let j = start_index; j < i; j++) {
										dheight += capturex_capture_array_height[j];
									}

									context.drawImage(image, 0, n_y, width, capturex_capture_array_height[i] - n_y, 0 + left_image_width, dheight, width, capturex_capture_array_height[i] - n_y);
								}
								else {
									context.drawImage(image, 0, n_y, width, height - n_y, 0 + left_image_width, height * (i - start_index), width, height - n_y);
								}
							}
							else {
								if (capturex_capture_array_height && capturex_capture_array_height.length > 0) {
									let dheight = 0;
									for (let j = start_index; j < i; j++) {
										dheight += capturex_capture_array_height[j];
									}
									context.drawImage(image, 0 + left_image_width, dheight, width, capturex_capture_array_height[i]);
								}
								else {
									context.drawImage(image, 0 + left_image_width, (i - start_index) * height, width, height + 1);
								}
							}
							resolve();
						};
					});
				}

				if (capturex_capture_bottom && capturex_capture_array_splicing_index == (capturex_capture_array.length - 1)) {
					const image = new Image();
					image.src = capturex_capture_bottom;
					await new Promise(resolve => {
						image.onload = () => {
							left_image_width = image.naturalWidth;
							context.drawImage(image, 0, (totalHeight - image.naturalHeight), image.naturalWidth, image.naturalHeight);
							resolve();
						};
					});
				}

				return new Promise(resolve => {
					canvas.toBlob(blob => {
						const reader = new FileReader();
						reader.onload = () => resolve(reader.result);
						reader.readAsDataURL(blob);
					}, 'image/png');
				});
			},
			splitSendImgData: function () {
				safeSendMessage({ action: "setProgress", progress: 100 });

				if (capturex_snap_mergedImage_array && capturex_snap_mergedImage_array.length > 0) {
					for (let k = 0; k < capturex_snap_mergedImage_array.length; k++) {
						const data = capturex_snap_mergedImage_array[k];
						const chunkSize = 2 * 1024 * 1024; // 2MB chunks for stability
						const imgDataChunks = [];
						for (let i = 0; i < data.length; i += chunkSize) {
							const chunk = data.slice(i, i + chunkSize);
							imgDataChunks.push(chunk);
						}
						if (k == (capturex_snap_mergedImage_array.length - 1))
							capturex_com_saveAction.sendImgDataById(imgDataChunks, k, 0, 0);
						else
							capturex_com_saveAction.sendImgDataById(imgDataChunks, k, 0, 1);
					}
				}
				capture_working = 0;
			},
			sendImgDataById: function (imgDataChunks, id, index, hasNextImg) {
				if (index < imgDataChunks.length) {
					safeSendMessage({ action: 'imgDataChunk' + id, dataItem: imgDataChunks[index], dataIndex: index, dataLength: imgDataChunks.length, hasNextImg: hasNextImg }, (response) => {
						if (response.rtn && response.rtn == 1)
							capturex_com_saveAction.sendImgDataById(imgDataChunks, id, (index + 1), hasNextImg);
					});
				}
			},
			// ── PROGRESS OVERLAY ──────────────────────────────────────────
			showProgressOverlay: function () {
				if (window.capturex_is_hiding_overlay) return;
				let overlay = document.getElementById('sqa_progress_overlay');
				if (overlay) {
					overlay.style.opacity = '1';
					overlay.style.display = 'flex';
					return;
				}
				overlay = document.createElement('div');
				overlay.id = 'sqa_progress_overlay';
				overlay.style.cssText = [
					'position: fixed',
					'top: 0',
					'right: 0',
					'z-index: 2147483647',
					'display: flex',
					'align-items: center',
					'gap: 10px',
					'background: #003366',
					'color: #fff',
					'font-family: Segoe UI, Arial, sans-serif',
					'font-size: 13px',
					'font-weight: 600',
					'padding: 8px 16px 8px 12px',
					'border-radius: 0 0 0 8px',
					'box-shadow: -2px 2px 10px rgba(0,0,0,0.35)',
					'letter-spacing: 0.3px',
					'pointer-events: none',
					'transition: opacity 0.15s ease',
					'min-width: 200px'
				].join(';');

				// Logo SQA
				const logo = document.createElement('img');
				try { logo.src = chrome.runtime.getURL('SQA.png'); } catch (e) { }
				logo.style.cssText = 'height:28px;width:auto;object-fit:contain;flex-shrink:0';

				// Texto
				const label = document.createElement('span');
				label.id = 'sqa_progress_label';
				label.textContent = 'CAPTURANDO EVIDENCIA';
				label.style.cssText = 'flex-shrink:0;white-space:nowrap';

				// Barra contenedora
				const barWrap = document.createElement('div');
				barWrap.style.cssText = [
					'flex:1',
					'height:6px',
					'background:rgba(255,255,255,0.25)',
					'border-radius:3px',
					'overflow:hidden',
					'min-width:60px'
				].join(';');

				const bar = document.createElement('div');
				bar.id = 'sqa_progress_bar';
				bar.style.cssText = [
					'height:100%',
					'width:5%',
					'background:#7ec8ff',
					'border-radius:3px',
					'transition:width 0.4s ease'
				].join(';');

				// Porcentaje
				const pct = document.createElement('span');
				pct.id = 'sqa_progress_pct';
				pct.textContent = '5%';
				pct.style.cssText = 'font-size:12px;opacity:0.85;flex-shrink:0;min-width:32px;text-align:right';

				barWrap.appendChild(bar);
				overlay.appendChild(logo);
				overlay.appendChild(label);
				overlay.appendChild(barWrap);
				overlay.appendChild(pct);
				document.body.appendChild(overlay);
			},
			hideProgressOverlay: function (callback) {
				// Oculta momentáneamente para el screenshot, se restaura en restoreProgressOverlay
				window.capturex_is_hiding_overlay = true;
				const overlay = document.getElementById('sqa_progress_overlay');
				if (overlay) {
					overlay.style.opacity = '0';
					overlay.style.display = 'none'; // Aseguramos que no ocupe espacio visual
				}
				if (callback) {
					// Usamos un timeout simple para asegurar la ejecución incluso en segundo plano
					setTimeout(() => {
						callback();
					}, 100);
				}
			},
			restoreProgressOverlay: function () {
				window.capturex_is_hiding_overlay = false;
				const overlay = document.getElementById('sqa_progress_overlay');
				if (overlay) {
					overlay.style.display = 'flex';
					overlay.style.opacity = '1';
				}
			},
			updateProgress: function (value) {
				const bar = document.getElementById('sqa_progress_bar');
				const pct = document.getElementById('sqa_progress_pct');
				if (bar) bar.style.width = Math.min(value, 100) + '%';
				if (pct) pct.textContent = Math.min(Math.round(value), 100) + '%';

				// Al llegar al 100% quitar el overlay con fade
				if (value >= 100) {
					setTimeout(() => {
						const overlay = document.getElementById('sqa_progress_overlay');
						if (overlay) {
							overlay.style.transition = 'opacity 0.6s ease';
							overlay.style.opacity = '0';
							setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 700);
						}
					}, 600);
				}
			},
			showTip: function (msg) {
				let tip = document.getElementById('sqa_tip_msg');
				if (!tip) {
					tip = document.createElement('div');
					tip.id = 'sqa_tip_msg';
					tip.style.cssText = [
						'position:fixed',
						'bottom:24px',
						'left:50%',
						'transform:translateX(-50%)',
						'background:#27ae60',
						'color:#fff',
						'font-family:Segoe UI,Arial,sans-serif',
						'font-size:13px',
						'font-weight:600',
						'padding:10px 22px',
						'border-radius:50px',
						'z-index:2147483647',
						'box-shadow:0 4px 12px rgba(0,0,0,0.25)',
						'pointer-events:none',
						'transition:opacity 0.4s ease'
					].join(';');
					document.body.appendChild(tip);
				}
				tip.textContent = msg;
				tip.style.opacity = '1';
				clearTimeout(tip._hideTimer);
				tip._hideTimer = setTimeout(() => { tip.style.opacity = '0'; }, 2500);
			},
			// ── END PROGRESS OVERLAY ───────────────────────────────────

			findScrollableElements: function () {
				const scrollableElements = [];
				const allElements = document.body.querySelectorAll('*');
				allElements.forEach(element => {
					if (capturex_com_tools.isVerticallyScrollable(element)) {
						let rect = element.getBoundingClientRect();
						let scrollHeight = element.scrollHeight;
						if (rect.height > 30 && rect.width > 30 && rect.top < window.innerHeight && scrollHeight > rect.height * 1.1) {
							if (!capturex_com_tools.isElementOccluded(element))
								scrollableElements.push(element);
						}
					}
					else if (capturex_com_tools.isVerticallyScrollableFrame(element)) {
						scrollableElements.push(element);
					}
				});
				return scrollableElements;
			}
		};

		capturex_com_saveAction.contentjsIsLoad();

		//this my code end
})();