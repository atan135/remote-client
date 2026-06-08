const DEFAULT_SELECTOR = "body";
const JIETU_LOG_PREFIX = "[remote-client:jietu]";
const RESOURCE_INLINE_TIMEOUT_MS = 2500;
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
let realCaptureStream = null;
let realCaptureVideo = null;
let realCaptureButton = null;

export function installBrowserJietu() {
  window.remoteClientJietu = async function remoteClientJietu(options = {}) {
    const requestId = String(options.requestId || "").trim();
    const selector = options.selector || DEFAULT_SELECTOR;
    const name = options.name || createDefaultName();
    const engine = options.engine || "real";

    logJietu("开始处理浏览器截图", {
      requestId,
      selector,
      name,
      engine,
      route: window.location.hash || window.location.pathname,
      viewport: getViewportSnapshot(),
      scroll: getScrollSnapshot()
    });

    const normalizedOptions = {
      ...options,
      engine
    };

    const realCaptureResult = shouldUseRealCapture(engine)
      ? await captureFromRealScreenStream(normalizedOptions)
      : null;

    if (realCaptureResult) {
      logJietu("已使用真实浏览器画面截图", {
        requestId,
        engine: realCaptureResult.engine,
        width: realCaptureResult.width,
        height: realCaptureResult.height
      });
      return uploadScreenshotImage({
        image: realCaptureResult.image,
        name,
        options: normalizedOptions,
        engine: realCaptureResult.engine
      });
    }

    if (isRealScreenEngine(engine)) {
      throw new Error(
        "真实画面截图流未启用。请先点击页面上的真实截图授权按钮，并在浏览器弹窗中选择当前标签页。"
      );
    }

    const root = resolveCaptureRoot(selector);
    logJietu("已定位截图根节点", {
      requestId,
      selector,
      tagName: root.tagName,
      className: root.className || ""
    });

    const { image, engine: captureEngine } = await captureElementAsPng(root, normalizedOptions);
    return uploadScreenshotImage({
      image,
      name,
      options: normalizedOptions,
      engine: captureEngine
    });
  };

  window.remoteClientJietu.startRealCapture = startRealCapture;
  window.remoteClientJietu.stopRealCapture = stopRealCapture;
  window.remoteClientJietu.showRealCaptureButton = showRealCaptureButton;
  window.remoteClientJietu.getRealCaptureState = getRealCaptureState;
}

async function uploadScreenshotImage({ image, name, options = {}, engine = "" }) {
  const requestId = String(options.requestId || "").trim();
  logJietu("开始上传截图到服务端", {
    requestId,
    name,
    engine,
    imageBytesEstimate: estimatePngDataUrlBytes(image)
  });

  const response = await fetch("/api/jietu", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      image,
      name,
      metadata: createMetadata({
        ...options,
        captureEngine: engine
      })
    })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    logJietuError("服务端保存截图失败", {
      requestId,
      status: response.status,
      message: payload.message || "截图保存失败"
    });
    throw new Error(payload.message || "截图保存失败");
  }

  logJietu("服务端保存截图完成", {
    requestId,
    status: response.status,
    relativePath: payload.item?.relativePath || "",
    bytes: payload.item?.bytes || 0,
    engine
  });

  return payload.item;
}

export async function captureBrowserJietu(options = {}) {
  if (typeof window.remoteClientJietu !== "function") {
    installBrowserJietu();
  }

  return window.remoteClientJietu(options);
}

export async function startRealCapture(options = {}) {
  if (!isRealCaptureSupported()) {
    throw new Error("当前浏览器不支持真实画面截图，或页面不是 localhost/HTTPS 安全上下文");
  }

  stopRealCapture({ log: false });
  logJietu("开始申请真实浏览器画面授权", {
    route: window.location.hash || window.location.pathname
  });

  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: {
      cursor: "always",
      frameRate: {
        ideal: Number(options.frameRate) || 5,
        max: Math.max(1, Number(options.maxFrameRate) || 15)
      }
    }
  });
  const video = document.createElement("video");

  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.setAttribute("aria-hidden", "true");
  video.style.cssText = [
    "position:fixed",
    "left:-99999px",
    "top:-99999px",
    "width:1px",
    "height:1px",
    "opacity:0",
    "pointer-events:none"
  ].join(";");

  document.body.appendChild(video);
  realCaptureStream = stream;
  realCaptureVideo = video;

  for (const track of stream.getTracks()) {
    track.addEventListener("ended", () => {
      cleanupRealCapture("stream-ended");
    });
  }

  await waitForRealCaptureVideo(video);
  logJietu("真实浏览器画面授权完成", getRealCaptureState());
  return getRealCaptureState();
}

export function stopRealCapture(options = {}) {
  const shouldLog = options.log !== false;

  if (realCaptureStream) {
    for (const track of realCaptureStream.getTracks()) {
      track.stop();
    }
  }

  cleanupRealCapture("manual-stop");

  if (shouldLog) {
    logJietu("真实浏览器画面流已停止", getRealCaptureState());
  }
}

export function showRealCaptureButton(options = {}) {
  if (realCaptureButton?.isConnected) {
    return realCaptureButton;
  }

  const button = document.createElement("button");

  button.type = "button";
  button.textContent = String(options.label || "启用真实截图");
  button.title = "授权后命令行截图将直接截取当前浏览器真实画面";
  button.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483647",
    "height:36px",
    "padding:0 12px",
    "border:1px solid #2563eb",
    "border-radius:6px",
    "background:#2563eb",
    "color:#fff",
    "font:13px/1.2 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "box-shadow:0 8px 24px rgba(15,23,42,.18)",
    "cursor:pointer"
  ].join(";");

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "授权中...";

    try {
      await startRealCapture(options);
      button.remove();
      realCaptureButton = null;
    } catch (error) {
      button.disabled = false;
      button.textContent = String(options.label || "启用真实截图");
      logJietuError("真实浏览器画面授权失败", {
        message: error?.message || String(error || "")
      });
    }
  });

  document.body.appendChild(button);
  realCaptureButton = button;
  logJietu("已显示真实截图授权按钮", {
    route: window.location.hash || window.location.pathname
  });
  return button;
}

export function getRealCaptureState() {
  const videoTrack = realCaptureStream?.getVideoTracks?.()[0] || null;

  return {
    supported: isRealCaptureSupported(),
    active: Boolean(
      realCaptureStream &&
        videoTrack &&
        videoTrack.readyState === "live" &&
        realCaptureVideo &&
        realCaptureVideo.videoWidth > 0
    ),
    trackState: videoTrack?.readyState || "",
    label: videoTrack?.label || "",
    width: realCaptureVideo?.videoWidth || 0,
    height: realCaptureVideo?.videoHeight || 0
  };
}

function resolveCaptureRoot(selector = DEFAULT_SELECTOR) {
  const root = document.querySelector(String(selector || DEFAULT_SELECTOR));

  if (!root) {
    throw new Error(`找不到截图根节点：${selector}`);
  }

  return root;
}

async function captureElementAsPng(root, options) {
  if (options.engine === "html2canvas") {
    return captureWithEngineAsPng("html2canvas", root, options);
  }

  try {
    return await captureWithEngineAsPng("native-svg", root, options);
  } catch (error) {
    logJietuError("native-svg 截图失败", {
      requestId: options.requestId || "",
      message: error?.message || String(error || "")
    });

    if (options.engine === "native") {
      throw error;
    }

    logJietu("切换到 html2canvas 截图", {
      requestId: options.requestId || ""
    });

    try {
      return await captureWithEngineAsPng("html2canvas", root, options);
    } catch (fallbackError) {
      logJietuError("html2canvas 截图失败", {
        requestId: options.requestId || "",
        message: fallbackError?.message || String(fallbackError || "")
      });
      throw fallbackError;
    }
  }
}

async function captureWithEngineAsPng(engine, root, options) {
  logJietu("开始截图", {
    requestId: options.requestId || "",
    engine,
    viewport: getViewportSnapshot(),
    scroll: getScrollSnapshot()
  });

  const canvas =
    engine === "native-svg"
      ? await captureWithNativeSvg(root, options)
      : await captureWithHtml2Canvas(root, options);

  logJietu("截图画布生成完成", {
    requestId: options.requestId || "",
    engine,
    width: canvas.width,
    height: canvas.height
  });

  const image = exportCanvasToPngDataUrl(canvas, options, engine);
  logJietu("PNG 导出完成", {
    requestId: options.requestId || "",
    engine,
    imageBytesEstimate: estimatePngDataUrlBytes(image)
  });

  return {
    canvas,
    image,
    engine
  };
}

function exportCanvasToPngDataUrl(canvas, options = {}, engine = "unknown") {
  try {
    return canvas.toDataURL("image/png");
  } catch (error) {
    const message = error?.message || String(error || "");

    throw new Error(`${engine} 截图导出 PNG 失败：${message || "canvas 无法导出"}`);
  }
}

async function captureFromRealScreenStream(options = {}) {
  if (!isRealCaptureStateActive()) {
    logJietu("真实浏览器画面流未启用，继续使用 DOM 截图", {
      requestId: options.requestId || "",
      state: getRealCaptureState()
    });
    return null;
  }

  await waitForRealCaptureVideo(realCaptureVideo);

  const width = realCaptureVideo.videoWidth;
  const height = realCaptureVideo.videoHeight;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;

  if (!context) {
    throw new Error("浏览器不支持 Canvas 截图");
  }

  logJietu("开始从真实浏览器画面流截帧", {
    requestId: options.requestId || "",
    width,
    height
  });
  context.drawImage(realCaptureVideo, 0, 0, width, height);

  const image = exportCanvasToPngDataUrl(canvas, options, "real-screen");
  logJietu("真实浏览器画面截帧完成", {
    requestId: options.requestId || "",
    width,
    height,
    imageBytesEstimate: estimatePngDataUrlBytes(image)
  });

  return {
    image,
    engine: "real-screen",
    width,
    height
  };
}

function isRealCaptureStateActive() {
  return getRealCaptureState().active;
}

function isRealScreenEngine(value) {
  return ["real", "real-screen", "screen", "display"].includes(String(value || "").trim());
}

function shouldUseRealCapture(value) {
  const engine = String(value || "").trim();

  return !engine || engine === "auto" || isRealScreenEngine(engine);
}

function isRealCaptureSupported() {
  return Boolean(
    window.isSecureContext &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === "function"
  );
}

function waitForRealCaptureVideo(video) {
  return new Promise((resolve, reject) => {
    if (!video) {
      reject(new Error("真实画面视频流未初始化"));
      return;
    }

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      resolve();
      return;
    }

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("等待真实画面视频帧超时"));
    }, 5000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", handleReady);
      video.removeEventListener("canplay", handleReady);
      video.removeEventListener("error", handleError);
    };
    const handleReady = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("真实画面视频流读取失败"));
    };

    video.addEventListener("loadedmetadata", handleReady, { once: true });
    video.addEventListener("canplay", handleReady, { once: true });
    video.addEventListener("error", handleError, { once: true });
    void video.play().catch(() => {});
  });
}

function cleanupRealCapture(reason = "") {
  if (realCaptureVideo?.parentNode) {
    realCaptureVideo.parentNode.removeChild(realCaptureVideo);
  }

  realCaptureStream = null;
  realCaptureVideo = null;

  if (reason && reason !== "manual-stop") {
    logJietu("真实浏览器画面流已结束", {
      reason
    });
  }
}

async function captureWithNativeSvg(root, options = {}) {
  const width = Math.max(1, Math.ceil(window.innerWidth));
  const height = Math.max(1, Math.ceil(window.innerHeight));
  const scale = Number(options.scale) || window.devicePixelRatio || 1;
  logJietu("native-svg 生成截图文档", {
    requestId: options.requestId || "",
    width,
    height,
    scale
  });

  const xhtml = await createViewportXhtml(root, options);
  const svg = createSvgDocument({
    width,
    height,
    xhtml
  });
  logJietu("native-svg 渲染截图图片", {
    requestId: options.requestId || "",
    svgChars: svg.length
  });

  const image = await loadSvgImage(svg);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);

  if (!context) {
    throw new Error("浏览器不支持 Canvas 截图");
  }

  context.scale(scale, scale);

  if (options.backgroundColor) {
    context.fillStyle = String(options.backgroundColor);
    context.fillRect(0, 0, width, height);
  }

  context.drawImage(image, 0, 0, width, height);
  logJietu("native-svg 截图完成", {
    requestId: options.requestId || "",
    canvasWidth: canvas.width,
    canvasHeight: canvas.height
  });
  return canvas;
}

async function captureWithHtml2Canvas(root, options = {}) {
  logJietu("加载 html2canvas", {
    requestId: options.requestId || ""
  });

  const { default: html2canvas } = await import("html2canvas");

  const canvas = await html2canvas(root, {
    backgroundColor: options.backgroundColor ?? null,
    imageTimeout: 5000,
    logging: false,
    removeContainer: true,
    scale: Number(options.scale) || window.devicePixelRatio || 1,
    useCORS: true,
    windowWidth: document.documentElement.scrollWidth,
    windowHeight: document.documentElement.scrollHeight,
    scrollX: -window.scrollX,
    scrollY: -window.scrollY,
    foreignObjectRendering: true
  });

  logJietu("html2canvas 截图完成", {
    requestId: options.requestId || "",
    canvasWidth: canvas.width,
    canvasHeight: canvas.height
  });

  return canvas;
}

async function cloneNodeForScreenshot(root, options = {}) {
  const clone = root.cloneNode(true);

  removeUnsupportedNodes(clone);
  copyFormValues(root, clone);
  copyCanvasValues(root, clone);
  await inlineOrNeutralizeImages(root, clone, options);
  neutralizeExternalResourceAttributes(clone);
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  return clone;
}

async function createViewportXhtml(root, options = {}) {
  const viewport = document.createElement("div");
  const style = document.createElement("style");
  const scene = document.createElement("div");
  const clonedRoot = await cloneNodeForScreenshot(root, options);

  viewport.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  viewport.setAttribute(
    "style",
    [
      "position:relative",
      "overflow:hidden",
      `width:${Math.ceil(window.innerWidth)}px`,
      `height:${Math.ceil(window.innerHeight)}px`,
      createCssVariableText(document.documentElement)
    ]
      .filter(Boolean)
      .join(";")
  );

  style.textContent = collectDocumentCssText(options);

  scene.setAttribute(
    "style",
    [
      "position:absolute",
      `left:${-window.scrollX}px`,
      `top:${-window.scrollY}px`,
      `width:${Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0)}px`,
      `min-height:${Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)}px`
    ].join(";")
  );

  scene.appendChild(clonedRoot);
  viewport.appendChild(style);
  viewport.appendChild(scene);

  return new XMLSerializer().serializeToString(viewport);
}

function createSvgDocument({ width, height, xhtml }) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<foreignObject x="0" y="0" width="100%" height="100%">',
    xhtml,
    "</foreignObject>",
    "</svg>"
  ].join("");
}

function collectDocumentCssText(options = {}) {
  const cssText = [];
  let removedRules = 0;

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules || []) {
        const sanitized = sanitizeCssText(rule.cssText);

        if (sanitized) {
          cssText.push(sanitized);
        } else {
          removedRules += 1;
        }
      }
    } catch {
      // Ignore cross-origin or otherwise inaccessible stylesheets.
    }
  }

  if (removedRules > 0) {
    logJietu("已移除可能污染截图的 CSS 规则", {
      requestId: options.requestId || "",
      removedRules
    });
  }

  return cssText.join("\n");
}

function sanitizeCssText(cssText) {
  const source = String(cssText || "");

  if (!source || /@font-face/i.test(source)) {
    return "";
  }

  return source.replace(/url\([^)]*\)/gi, "none");
}

function createCssVariableText(element) {
  const computedStyle = window.getComputedStyle(element);

  return Array.from(computedStyle)
    .filter((name) => name.startsWith("--"))
    .map((name) => `${name}:${computedStyle.getPropertyValue(name)}`)
    .join(";");
}

function removeUnsupportedNodes(root) {
  root.querySelectorAll("script, noscript, iframe").forEach((item) => {
    item.remove();
  });
}

async function inlineOrNeutralizeImages(sourceRoot, clonedRoot, options = {}) {
  const sourceImages = sourceRoot.querySelectorAll("img");
  const clonedImages = clonedRoot.querySelectorAll("img");
  let inlined = 0;
  let neutralized = 0;

  for (let index = 0; index < clonedImages.length; index += 1) {
    const source = sourceImages[index];
    const clone = clonedImages[index];

    if (!clone) {
      continue;
    }

    const src = String(source?.currentSrc || source?.src || clone.getAttribute("src") || "");

    if (!src) {
      clone.removeAttribute("src");
      continue;
    }

    if (src.startsWith("data:")) {
      clone.setAttribute("src", src);
      continue;
    }

    try {
      const dataUrl = await fetchImageAsDataUrl(src);
      clone.setAttribute("src", dataUrl);
      clone.removeAttribute("srcset");
      clone.removeAttribute("crossorigin");
      inlined += 1;
    } catch {
      clone.setAttribute("src", TRANSPARENT_PIXEL);
      clone.removeAttribute("srcset");
      clone.removeAttribute("crossorigin");
      neutralized += 1;
    }
  }

  if (inlined > 0 || neutralized > 0) {
    logJietu("已处理截图图片资源", {
      requestId: options.requestId || "",
      inlined,
      neutralized
    });
  }
}

function neutralizeExternalResourceAttributes(root) {
  root.querySelectorAll("[srcset]").forEach((item) => item.removeAttribute("srcset"));
  root.querySelectorAll("source").forEach((item) => item.remove());

  root.querySelectorAll("[style]").forEach((item) => {
    item.setAttribute("style", sanitizeCssText(item.getAttribute("style") || ""));
  });
}

async function fetchImageAsDataUrl(src) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort();
  }, RESOURCE_INLINE_TIMEOUT_MS);

  try {
    const response = await fetch(src, {
      credentials: "same-origin",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`图片资源读取失败：${response.status}`);
    }

    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } finally {
    window.clearTimeout(timeout);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("图片资源转换失败"));
    reader.readAsDataURL(blob);
  });
}

function copyFormValues(sourceRoot, clonedRoot) {
  const sourceControls = sourceRoot.querySelectorAll("input, textarea, select");
  const clonedControls = clonedRoot.querySelectorAll("input, textarea, select");

  for (let index = 0; index < sourceControls.length; index += 1) {
    const source = sourceControls[index];
    const clone = clonedControls[index];

    if (!source || !clone) {
      continue;
    }

    if (source instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
      clone.setAttribute("value", source.value);

      if (source.checked) {
        clone.setAttribute("checked", "checked");
      } else {
        clone.removeAttribute("checked");
      }
    } else if (source instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) {
      clone.textContent = source.value;
    } else if (source instanceof HTMLSelectElement && clone instanceof HTMLSelectElement) {
      for (const option of clone.options) {
        option.selected = option.value === source.value;
      }
    }
  }
}

function copyCanvasValues(sourceRoot, clonedRoot) {
  const sourceCanvases = sourceRoot.querySelectorAll("canvas");
  const clonedCanvases = clonedRoot.querySelectorAll("canvas");

  for (let index = 0; index < sourceCanvases.length; index += 1) {
    const source = sourceCanvases[index];
    const clone = clonedCanvases[index];

    if (!source || !clone || !clone.parentNode) {
      continue;
    }

    try {
      const image = document.createElement("img");

      image.src = source.toDataURL("image/png");
      image.width = source.width;
      image.height = source.height;
      image.setAttribute("style", clone.getAttribute("style") || "");
      clone.parentNode.replaceChild(image, clone);
    } catch {
      // Tainted canvases cannot be copied; keep the cloned canvas element.
    }
  }
}

function loadSvgImage(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));

  return loadImage(url).finally(() => {
    URL.revokeObjectURL(url);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      reject(new Error("截图 SVG 渲染超时"));
    }, 15000);

    image.onload = () => {
      window.clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("截图 SVG 渲染失败"));
    };
    image.src = source;
  });
}

function createDefaultName() {
  const route = window.location.hash || window.location.pathname || "browser";
  return route.replace(/^#?\/?/, "").replace(/[^a-zA-Z0-9._-]+/g, "-") || "browser";
}

function createMetadata(options = {}) {
  return {
    requestId: options.requestId || "",
    title: document.title,
    href: window.location.href,
    route: window.location.hash || window.location.pathname,
    userAgent: window.navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    },
    scroll: {
      x: window.scrollX,
      y: window.scrollY
    },
    capturedBy: options.capturedBy || "remoteClientJietu"
  };
}

function getViewportSnapshot() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1
  };
}

function getScrollSnapshot() {
  return {
    x: window.scrollX,
    y: window.scrollY
  };
}

function estimatePngDataUrlBytes(value) {
  const text = String(value || "");
  const commaIndex = text.indexOf(",");
  const base64 = commaIndex >= 0 ? text.slice(commaIndex + 1) : text;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;

  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function logJietu(message, details = {}) {
  if (typeof console === "undefined" || typeof console.info !== "function") {
    return;
  }

  console.info(`${JIETU_LOG_PREFIX} ${message}`, details);
}

function logJietuError(message, details = {}) {
  if (typeof console === "undefined" || typeof console.error !== "function") {
    return;
  }

  console.error(`${JIETU_LOG_PREFIX} ${message}`, details);
}
