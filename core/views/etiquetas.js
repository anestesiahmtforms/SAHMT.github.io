export async function mount(ctx){
const {Services,localStorage,sessionStorage,document,window,navigator,location,history,fetch,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame,cancelAnimationFrame}=ctx;

const CONFIG = {guideWidthRatio:0.94,guideAspectRatio:4,maxSearchResults:60};

const LEGACY_SCRIPT_URLS = new Set();

const ALERT_TYPES = new Set(["particular", "complementacao", "complementação"]);
const CREDOR_CAIXA = "Caixa";
const FINANCIAL_TYPES = new Set(["particular", "complementacao"]);
const CONSULTA_TYPE = "Consulta Pré-anestésica";
const SADT_TYPE = "SADT";
const TOP_LEVEL_LOGIN_PARAM = "topLogin";

const state = {
  stream: null,
  cameraOpen: false,
  cameraStarting: false,
  cameraRequestId: 0,
  imageBlob: null,
  imageUrl: "",
  metadata: null,
  aiHealth: null,
  config: loadConfig(),
  summaryRows: [],
  summaryMode: "date",
  monthlyRows: [],
  monthlyMonth: "",
  editingRow: null,
  auth: null,
  authenticated: false,
  googleButtonRendered: false,
  googleAuthInProgress: false,
  aiReady: false,
  aiHealthRequestInFlight: false,
  authorizedWarmupPromise: null,
};

const AI_HEALTH_CACHE_KEY = "etiqueta-hmt-ai-health-v1";
const AI_HEALTH_CACHE_TTL_MS = 10 * 60 * 1000;

const cameraEl = document.querySelector("#camera");
const canvasEl = document.querySelector("#snapshot");
const previewEl = document.querySelector("#preview");
const cameraStatusEl = document.querySelector("#camera-status");
const processingStatusEl = document.querySelector("#processing-status");
const pendingSubmissionsStatusEl = document.querySelector("#pending-submissions-status");
const pendingSendConfirmationEl = document.querySelector("#pending-send-confirmation");
const pendingSendConfirmationOkEl = document.querySelector("#pending-send-confirmation-ok");
const sheetStatusEl = document.querySelector("#sheet-status");
const aiStatusEl = document.querySelector("#ai-status");
const authGateEl = document.querySelector("#auth-gate");
const authMessageEl = document.querySelector("#auth-message");
const authUserEl = document.querySelector("#auth-user");
const authGoogleButtonEl = document.querySelector("#auth-google");
const googleSigninEl = document.querySelector("#google-signin");
const scriptUrlEl = document.querySelector("#script-url");
const entryPanelEl = document.querySelector("#entry-panel");
const formEl = document.querySelector("#label-form");
const summaryPanelEl = document.querySelector("#summary-panel");
const summaryPanelButtonEl = document.querySelector("#open-summary-panel");
const summaryDateEl = document.querySelector("#summary-date");
const summaryDateFieldEl = document.querySelector("#summary-date-field");
const summaryTodayButtonEl = document.querySelector("#summary-today-button");
const reportMonthEl = document.querySelector("#report-month");
const monthlyReportButtonEl = document.querySelector("#open-monthly-report");
const monthlyPanelEl = document.querySelector("#monthly-panel");
const summaryTotalsEl = document.querySelector("#summary-totals");
const summaryListEl = document.querySelector("#summary-list");
const monthlyStatusEl = document.querySelector("#monthly-status");
const monthlyListEl = document.querySelector("#monthly-list");
const sendFeedbackEl = document.querySelector("#send-feedback");
const confirmOverlayEl = document.querySelector("#confirm-overlay");
const confirmSummaryEl = document.querySelector("#confirm-summary");
const confirmSendEl = document.querySelector("#confirm-send");
const editOverlayEl = document.querySelector("#edit-overlay");
const editContextEl = document.querySelector("#edit-context");
const editSummaryEl = document.querySelector("#edit-summary");
const editFeedbackEl = document.querySelector("#edit-feedback");
const editSaveEl = document.querySelector("#edit-save");

pendingSendConfirmationOkEl?.addEventListener("click", () => {
  pendingSendConfirmationEl.hidden = true;
});

function showPendingSendConfirmation(sentCount) {
  if (!pendingSendConfirmationEl) {
    return;
  }
  const countLabel = sentCount === 1 ? "O registro pendente foi enviado com sucesso." : `${sentCount} registros pendentes foram enviados com sucesso.`;
  pendingSendConfirmationEl.querySelector("span").textContent = countLabel;
  pendingSendConfirmationEl.hidden = false;
  pendingSendConfirmationOkEl?.focus({ preventScroll: true });
}

const fields = {
  data: document.querySelector("#data"),
  nomePaciente: document.querySelector("#nomePaciente"),
  cirurgia: document.querySelector("#cirurgia"),
  atendimento: document.querySelector("#atendimento"),
  tipo: document.querySelector("#tipo"),
  valor: document.querySelector("#valor"),
  convenio: document.querySelector("#convenio"),
  credor: document.querySelector("#credor"),
  plantonistas: document.querySelector("#plantonistas"),
};

const conditionalFields = {
  valor: document.querySelector("#valor-field"),
};

const plantonistasUi = {
  wrapper: null,
  button: null,
  panel: null,
  checks: [],
};

function setCaptureButtonIdleState() {
  const captureButton = document.querySelector("#capture-image");
  if (!captureButton) {
    return;
  }
  const label = captureButton.querySelector("span");
  if (label) label.textContent = "Abrir camera";
  else captureButton.textContent = "Abrir camera";
  captureButton.setAttribute("aria-label", "Abrir camera");
  captureButton.disabled = false;
}

function setCaptureButtonReadyState() {
  const captureButton = document.querySelector("#capture-image");
  if (!captureButton) {
    return;
  }
  const label = captureButton.querySelector("span");
  if (label) label.textContent = "Capturar Etiqueta";
  else captureButton.textContent = "Capturar Etiqueta";
  captureButton.setAttribute("aria-label", "Capturar etiqueta");
  captureButton.disabled = false;
}

document.querySelector("#capture-image").addEventListener("click", handleCameraCaptureButton);
document.querySelector("#open-manual-entry").addEventListener("click", openManualEntry);
document.querySelector("#upload-image")?.addEventListener("change", handleFileUpload);
document.querySelector("#process-image").addEventListener("click", processCurrentImage);
document.querySelector("#send-sheet").addEventListener("click", sendToSheet);
document.querySelector("#clear-form").addEventListener("click", resetForm);
document.querySelector("#save-settings").addEventListener("click", saveSettings);
document.querySelector("#generate-month-pdf-whatsapp").addEventListener("click", generateMonthlyPdfForWhatsApp);
authGoogleButtonEl?.addEventListener("click", authorizeDeviceWithGoogle);
document.querySelector("#auth-other-account")?.addEventListener("click", chooseAnotherGoogleAccount);
document.querySelectorAll("[data-return-home]").forEach((button) => {
  button.addEventListener("click", returnToAppHome);
});
window.addEventListener("popstate", handleBrowserBack);
fields.tipo.addEventListener("change", () => {
  fields.tipo.value = normalizeTipoValue(fields.tipo.value);
  syncConditionalEntryFields();
});
fields.valor.addEventListener("blur", () => {
  fields.valor.value = formatStoredCurrency(fields.valor.value);
  updateEntryValidationStates();
});
Object.values(fields).forEach((field) => {
  field?.addEventListener("input", updateEntryValidationStates);
  field?.addEventListener("change", updateEntryValidationStates);
});
summaryDateEl.addEventListener("change", () => {
  if (summaryDateEl.value) {
    loadSummary({ silent: true, date: summaryDateEl.value });
  }
});
summaryPanelButtonEl?.addEventListener("click", openSummaryPanel);
summaryTodayButtonEl?.addEventListener("click", resetSummaryToToday);
monthlyReportButtonEl?.addEventListener("click", toggleMonthlyReportPanel);
reportMonthEl.addEventListener("change", loadMonthlySummary);
fields.credor.addEventListener("change", () => {
  syncPlantonistasRequirement();
  updateEntryValidationStates();
});
editSaveEl?.addEventListener("click", saveEditedRecord);
document.addEventListener("click", closePlantonistasPickerOnOutsideClick);
document.addEventListener("pointerdown", (event) => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !["INPUT", "TEXTAREA"].includes(active.tagName)) {
    return;
  }
  if (event.target instanceof Element && event.target.closest("input, textarea, select, button, .multi-select-options")) {
    return;
  }
  active.blur();
});
entryPanelEl?.addEventListener("focusin", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (!target.matches("input, textarea, select, button")) {
    return;
  }

  window.setTimeout(() => {
    if (!entryPanelEl || entryPanelEl.hidden || !target.isConnected) {
      return;
    }
    const formGrid = target.closest("#label-form");
    if (!(formGrid instanceof HTMLElement)) {
      return;
    }
    const field = target.closest("label") || target;
    const formRect = formGrid.getBoundingClientRect();
    const fieldRect = field.getBoundingClientRect();
    const safeGap = 10;
    let nextScrollTop = formGrid.scrollTop;

    if (fieldRect.top < formRect.top + safeGap) {
      nextScrollTop += fieldRect.top - formRect.top - safeGap;
    } else if (fieldRect.bottom > formRect.bottom - safeGap) {
      nextScrollTop += fieldRect.bottom - formRect.bottom + safeGap;
    }

    if (Math.abs(nextScrollTop - formGrid.scrollTop) > 1) {
      formGrid.scrollTo({ top: Math.max(0, nextScrollTop), behavior: "auto" });
    }
  }, 80);
});
window.addEventListener("focus", refreshDisplayedSummaries);
window.addEventListener("pageshow", refreshDisplayedSummaries);
if (window.visualViewport) {
  const syncKeyboardViewport = () => {
    const entryIsOpen = entryPanelEl && !entryPanelEl.hidden;
    const keyboardOpen = window.visualViewport.height < window.innerHeight * 0.78;
    document.body.classList.toggle("keyboard-open", keyboardOpen && !entryIsOpen);
    entryPanelEl?.classList.toggle("entry-keyboard-open", Boolean(keyboardOpen && entryIsOpen));
    document.documentElement.style.setProperty("--visual-height", `${Math.round(window.visualViewport.height)}px`);
  };
  window.visualViewport.addEventListener("resize", syncKeyboardViewport);
  window.visualViewport.addEventListener("scroll", syncKeyboardViewport);
  syncKeyboardViewport();
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshDisplayedSummaries();
    flushPendingSubmissions({ notify: true });
  }
});

bootstrap();

async function bootstrap() {
  configureVirtualKeyboard();
  ;
  await authenticateSharedAppAccess();
  renderAuthStatus();
  if (!window.SAHMT_SHELL) prepareBackNavigationToHome();
  resetInitialPanels();
  const today = getTodayISO();
  fields.data.value = today;
  summaryDateEl.value = "";
  reportMonthEl.value = "";
  scriptUrlEl.value = state.config.scriptUrl;
  setupPlantonistasPicker();
  syncConditionalEntryFields();
  syncPlantonistasRequirement();
  renderSheetStatus();
  updatePendingSubmissionsStatus();
  flushPendingSubmissions({ notify: true });
  initializeAuthorizedApp().catch((error) => console.warn("Falha no aquecimento inicial:", error));
  registerServiceWorker();
}

function configureVirtualKeyboard() {
  if (navigator.virtualKeyboard) {
    navigator.virtualKeyboard.overlaysContent = true;
  }
}

async function authenticateSharedAppAccess() {
  if (!window.SAHMT_AUTH?.requireAccess) {
    state.auth = null;
    state.authenticated = false;
    renderAuthStatus();
    throw new Error("Autenticacao compartilhada indisponivel neste app.");
  }

  const auth = await window.SAHMT_AUTH.requireAccess({
    moduleId: "ETIQUETAS",
    pageId: "home",
    returnUrl: window.location.href
  });

  applyAuthenticatedUser(auth || {});
  state.authenticated = state.auth?.authenticated === true;
  window.SAHMT_AUTH.onChange((nextAuth) => {
    if (!nextAuth) {
      return;
    }
    applyAuthenticatedUser(nextAuth);
    state.authenticated = state.auth?.authenticated === true;
    renderAuthStatus();
    if (state.authenticated) {
      initializeAuthorizedApp().catch((error) => console.warn("Falha ao reativar IA após autenticação:", error));
    }
  });
}

function resetInitialPanels() {
  [entryPanelEl, summaryPanelEl, monthlyPanelEl].forEach((panel) => {
    if (!panel) {
      return;
    }

    panel.hidden = true;
    panel.classList.remove("is-open");
  });
  document.body.classList.remove("modal-open");
}

function returnToAppHome() {
  hideEntryPanel();
  closeSummaryPanel();
  closeMonthlyReportPanel();
  closeEditRecord();
  resetScannerView();
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

function shouldRequireTopLevelLogin() {
  return isEmbeddedContext() && isLikelyIOS();
}

function isEmbeddedContext() {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

function isLikelyIOS() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/i.test(ua) || (/Mac/i.test(ua) && "ontouchend" in document);
}

function openTopLevelLogin() {
  const url = new URL(window.location.href);
  url.searchParams.set(TOP_LEVEL_LOGIN_PARAM, "1");
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.href = url.toString();
      return;
    }
  } catch {
    // Fallback para a navegação local.
  }
  window.location.href = url.toString();
}

function returnToHomePage() {
  window.location.href = "../../index.html?from=etiquetas&skipNotice=1";
}

function prepareBackNavigationToHome() {
  if (!window.history?.pushState) {
    return;
  }

  try {
    const currentState = window.history.state || {};
    if (!currentState.etiquetaBackGuard) {
      window.history.replaceState({ ...currentState, etiquetaEntry: true }, "", window.location.href);
      window.history.pushState({ etiquetaBackGuard: true }, "", window.location.href);
    }
  } catch {
    // Se o navegador bloquear history API, o botão visual continua funcionando.
  }
}

function handleBrowserBack() {
  returnToHomePage();
}



async function authorizeDeviceWithGoogle(){return window.SAHMT_AUTH.chooseAnotherAccount();}

async function chooseAnotherGoogleAccount(){return window.SAHMT_AUTH.chooseAnotherAccount();}







function initializeAuthorizedApp() {
  if (state.authorizedWarmupPromise) {
    return state.authorizedWarmupPromise;
  }

  const today = getTodayISO();
  if (summaryDateEl && !summaryDateEl.value) {
    summaryDateEl.value = today;
  }
  if (reportMonthEl && !reportMonthEl.value) {
    reportMonthEl.value = today.slice(0, 7);
  }

  // Warm every authorized dependency in parallel after the session is ready.
  // A slow AI health check must not delay spreadsheet summaries or page entry.
  state.authorizedWarmupPromise = Promise.allSettled([
    loadAiHealthWithRetry(),
    loadMetadata(),
    loadSummary({ silent: true, date: today }),
    loadMonthlySummary({ silent: true }),
  ]).then(() => undefined);

  return state.authorizedWarmupPromise;
}
async function loadAiHealthWithRetry() {
  const delays = [0, 800, 2200];
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) {
      await new Promise((resolve) => window.setTimeout(resolve, delays[attempt]));
    }
    await loadAiHealth();
    if (state.aiReady) {
      return;
    }
  }
}





function applyAuthenticatedUser(auth){state.auth={email:auth.email||"",name:auth.name||"",authenticated:auth.authenticated===true};state.authenticated=state.auth.authenticated;}



















function showAuthGate(message, options = {}) {
  if (authMessageEl) {
    authMessageEl.textContent = message;
  }
  if (authGoogleButtonEl) {
    authGoogleButtonEl.hidden = !options.showButton;
  }
  if (googleSigninEl) {
    googleSigninEl.hidden = true;
  }
  authGateEl?.removeAttribute("hidden");
  document.body.classList.add("auth-locked");
}

function hideAuthGate() {
  if (authGoogleButtonEl) {
    authGoogleButtonEl.hidden = true;
  }
  if (googleSigninEl) {
    googleSigninEl.hidden = true;
  }
  authGateEl?.setAttribute("hidden", "");
  document.body.classList.remove("auth-locked");
}

function renderAuthStatus() {
  if (!authUserEl) {
    return;
  }
  authUserEl.textContent = state.auth?.email ? String(state.auth.email) : "Aguardando login";
  authUserEl.className = "";
}



function ensureAuthenticated() {
  return state.auth || { email: "", name: "", token: "", deviceToken: "" };
}

function addAuthToUrl(url){return url;}

function withAuthPayload(payload){return {...payload};}

function loadConfig(){return {scriptUrl:Services.configured?"central-service":""};}

async function saveSettings(){setStatus("A conexão é configurada uma única vez para todo o SAHMT.","info");}

function renderSheetStatus() {
  if (state.config.scriptUrl && state.metadata?.spreadsheetName) {
    sheetStatusEl.textContent = state.metadata.spreadsheetName;
    sheetStatusEl.className = "status-pill";
  } else if (state.config.scriptUrl) {
    sheetStatusEl.textContent = "Planilha configurada";
    sheetStatusEl.className = "status-pill";
  } else {
    sheetStatusEl.textContent = "Planilha nao configurada";
    sheetStatusEl.className = "status-pill neutral";
  }

  renderAiStatus();
}

function renderAiStatus() {
  const processButton = document.querySelector("#process-image");
  processButton?.classList.toggle("ai-ready", Boolean(state.aiReady));
  processButton?.classList.toggle("ai-unavailable", !state.aiReady);

  if (!aiStatusEl) {
    return;
  }

  if (!state.config.scriptUrl) {
    aiStatusEl.textContent = "IA nao configurada";
    aiStatusEl.className = "status-pill neutral";
    return;
  }

  if (state.aiHealth?.ok) {
    aiStatusEl.textContent = `IA configurada${state.aiHealth.model ? `: ${state.aiHealth.model}` : ""}`;
    aiStatusEl.className = "status-pill";
    return;
  }

  if (state.aiHealth?.message) {
    aiStatusEl.textContent = "IA nao confirmada";
    aiStatusEl.className = "status-pill error";
    return;
  }

  aiStatusEl.textContent = state.authenticated ? "Ativando IA..." : "IA nao verificada";
  aiStatusEl.className = "status-pill neutral";
}

async function loadMetadata(){try{state.metadata={ok:true,...await Services.read("etiquetas.metadata")};}catch{state.metadata=null;}renderSheetStatus();}

async function loadAiHealth(){if(state.aiHealthRequestInFlight)return;state.aiHealthRequestInFlight=true;try{const r=await Services.read("etiquetas.aiHealth");state.aiHealth={ok:r.configured,model:r.model,message:r.configured?"Configuração disponível. Leitura ainda não testada.":"IA não configurada."};state.aiReady=r.configured;}catch(e){state.aiReady=false;state.aiHealth={ok:false,message:e.message};}finally{state.aiHealthRequestInFlight=false;document.querySelector("#process-image").disabled=!state.imageBlob||!state.aiReady;renderAiStatus();}}

function readAiHealthCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(AI_HEALTH_CACHE_KEY) || "null");
    if (!cached?.ok || !cached.checkedAt) {
      return null;
    }
    const age = Date.now() - new Date(cached.checkedAt).getTime();
    return Number.isFinite(age) && age >= 0 && age < AI_HEALTH_CACHE_TTL_MS ? cached : null;
  } catch {
    return null;
  }
}

function saveAiHealthCache(health) {
  try {
    localStorage.setItem(AI_HEALTH_CACHE_KEY, JSON.stringify(health));
  } catch {
    // Cache is an optimization only; the live health check remains authoritative.
  }
}

function registerServiceWorker(){}

async function startCamera() {
  if (state.cameraStarting || state.stream) return;
  stopCamera();
  const requestId = state.cameraRequestId;
  state.cameraStarting = true;
  resetScannerView();
  document.querySelector("#capture-image").disabled = true;
  setStatus("Abrindo camera…", "info");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 2560 },
        height: { ideal: 1440 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    });
    // A permission prompt may finish after the user leaves this screen.
    if (requestId !== state.cameraRequestId) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    state.stream = stream;
    cameraEl.srcObject = stream;
    await cameraEl.play();
    if (requestId !== state.cameraRequestId) return;
    const track = stream.getVideoTracks()[0];
    try {
      if (track?.getCapabilities?.().focusMode?.includes("continuous")) {
        await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      }
    } catch (error) {
      // Keep the camera's native focus behavior if optional control is rejected.
      console.warn("Foco automatico mantido pelo aparelho:", error);
    }
    if (requestId !== state.cameraRequestId) return;
    setCaptureButtonReadyState();
    if (cameraStatusEl) {
      cameraStatusEl.textContent = "Camera ativa";
      cameraStatusEl.className = "status-pill";
    }
    setStatus("Centralize a etiqueta. Aguarde a imagem ficar nitida antes de capturar.", "info");
  } catch (error) {
    if (requestId !== state.cameraRequestId) return;
    stopCamera();
    if (cameraStatusEl) {
      cameraStatusEl.textContent = "Sem acesso";
      cameraStatusEl.className = "status-pill error";
    }
    setStatus(`Nao foi possivel abrir a camera: ${error.message}`, "error");
  } finally {
    if (requestId === state.cameraRequestId) state.cameraStarting = false;
  }
}

function openNativeCameraCapture() {
  const input = document.querySelector("#upload-image");
  if (input) {
    input.value = "";
    input.click();
  } else {
    setStatus("Camera indisponivel neste navegador. Escolha uma imagem.", "error");
  }
}

async function handleCameraCaptureButton() {
  if (state.cameraStarting) return;
  if (state.stream) {
    await captureFromCamera();
    return;
  }

  await startCamera();
}

function stopCamera() {
  state.cameraRequestId += 1;
  state.cameraStarting = false;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  cameraEl.srcObject = null;
  if (cameraStatusEl) {
    cameraStatusEl.textContent = "Camera desligada";
    cameraStatusEl.className = "status-pill neutral";
  }
  setCaptureButtonIdleState();
}

async function captureFromCamera() {
  if (!state.stream) {
    setStatus("Abra a camera antes de capturar.", "error");
    return;
  }

  if (state.cameraStarting || cameraEl.readyState < 2 || !cameraEl.videoWidth || !cameraEl.videoHeight) {
    setStatus("Aguarde a imagem da camera antes de capturar.", "info");
    return;
  }

  const crop = getGuideCropRect(cameraEl.videoWidth, cameraEl.videoHeight);
  canvasEl.width = crop.width;
  canvasEl.height = crop.height;

  const context = canvasEl.getContext("2d", { willReadFrequently: true });
  context.drawImage(cameraEl, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);

  const blob = await new Promise((resolve) => canvasEl.toBlob(resolve, "image/jpeg", 0.98));
  stopCamera();
  if (!blob) {
    setStatus("Nao foi possivel preparar a imagem capturada. Tente novamente.", "error");
    return;
  }
  setImageBlob(blob);
  setStatus("Etiqueta capturada. Toque em Ler Etiqueta.", "success");
}

function handleFileUpload(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  setImageBlob(file);
  stopCamera();
  if (cameraStatusEl) {
    cameraStatusEl.textContent = "Foto enviada";
    cameraStatusEl.className = "status-pill neutral";
  }
  setStatus("Foto carregada. Toque em Ler Etiqueta.", "success");
}

function setImageBlob(blob) {
  state.imageBlob = blob;
  if (state.imageUrl) {
    URL.revokeObjectURL(state.imageUrl);
  }

  state.imageUrl = URL.createObjectURL(blob);
  previewEl.src = state.imageUrl;
  previewEl.classList.add("has-image");
  document.querySelector(".camera-stage")?.classList.add("has-capture");
  cameraEl.style.display = "none";
  document.querySelector("#process-image").disabled = false;
}

function resetScannerView() {
  document.querySelector(".camera-stage")?.classList.remove("has-capture");
  previewEl.removeAttribute("src");
  previewEl.classList.remove("has-image");
  cameraEl.style.display = "block";
  setCaptureButtonIdleState();
}

function getGuideCropRect(sourceWidth, sourceHeight) {
  const videoRect = cameraEl.getBoundingClientRect();
  const guideRect = document.querySelector(".guide-frame")?.getBoundingClientRect();
  if (!videoRect.width || !videoRect.height || !guideRect?.width || !guideRect.height) {
    return {
      width: Math.round(sourceWidth * CONFIG.guideWidthRatio),
      height: Math.round(sourceWidth * CONFIG.guideWidthRatio / CONFIG.guideAspectRatio),
      x: Math.round(sourceWidth * (1 - CONFIG.guideWidthRatio) / 2),
      y: Math.round(sourceHeight * 0.5 - sourceWidth * CONFIG.guideWidthRatio / CONFIG.guideAspectRatio / 2),
    };
  }

  // Convert the visible guide through object-fit: cover back to camera pixels.
  const scale = Math.max(videoRect.width / sourceWidth, videoRect.height / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = (renderedWidth - videoRect.width) / 2;
  const offsetY = (renderedHeight - videoRect.height) / 2;
  const guideLeft = guideRect.left - videoRect.left;
  const guideTop = guideRect.top - videoRect.top;
  const x = (guideLeft + offsetX) / scale;
  const y = (guideTop + offsetY) / scale;
  const width = guideRect.width / scale;
  const height = guideRect.height / scale;
  const safeX = Math.max(0, Math.min(sourceWidth - 1, Math.round(x)));
  const safeY = Math.max(0, Math.min(sourceHeight - 1, Math.round(y)));

  return {
    x: safeX,
    y: safeY,
    width: Math.max(1, Math.min(sourceWidth - safeX, Math.round(width))),
    height: Math.max(1, Math.min(sourceHeight - safeY, Math.round(height))),
  };
}

async function processCurrentImage() {
  if (!state.imageBlob) {
    setStatus("Capture ou escolha uma imagem primeiro.", "error");
    return;
  }

  if (!state.config.scriptUrl) {
    setStatus("Salve primeiro a URL do Google Apps Script.", "error");
    return;
  }

  // The startup health check is advisory: a temporary failure must not prevent
  // a user-requested read. The AI endpoint still validates the session itself.

  stopCamera();
  toggleBusy(true);
  setStatus("Lendo Etiqueta", "info");

  try {
    const parsed = await extractLabelWithAi(state.imageBlob);
    applyDataToForm(parsed);
    showEntryPanel({ showPlantonistasGrid: true });

    const missingKeys = normalizeTipoValue(parsed.tipo) === SADT_TYPE
      ? ["nomePaciente", "convenio", "atendimento"]
      : ["nomePaciente", "convenio", "cirurgia", "atendimento"];
    const missing = missingKeys.filter((key) => !parsed[key]);
    const qualityNote = missing.length ? " Confira a foto e tente novamente com a etiqueta inteira mais nitida." : "";
    const missingNote = missing.length ? ` Confira manualmente: ${missing.join(", ")}.` : "";
    setStatus(`Leitura Concluída.${missingNote}${qualityNote}`, missing.length ? "info" : "success");
  } catch (error) {
    state.aiHealth = {
      ok: false,
      model: String(state.aiHealth?.model || "").trim(),
      message: error instanceof Error ? error.message : String(error || "Falha na leitura por IA."),
      checkedAt: new Date().toISOString(),
    };
    renderAiStatus();
    console.error(error);
    setStatus(`Falha na leitura da etiqueta: ${error.message}`, "error");
  } finally {
    toggleBusy(false);
  }
}

async function extractLabelWithAi(imageBlob){const imageSet=await prepareAiImageSet(imageBlob);const result=await Services.write("etiquetas.aiExtract",imageSet,{timeoutMs:45000});state.aiHealth={ok:true,model:result.model,message:"Leitura concluída."};state.aiReady=true;renderAiStatus();return result;}

async function prepareAiImageSet(blob) {
  const image = await loadImageForAi(blob);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  if (!width || !height) {
    return { imageDataUrl: await blobToDataUrl(blob), numericImageDataUrls: [] };
  }

  let imageDataUrl;
  try {
    imageDataUrl = renderAiImage(image, width, height, 1600, 0.86);
  } catch (error) {
    console.warn("Falha ao otimizar imagem; usando a foto original:", error);
    imageDataUrl = await blobToDataUrl(blob);
  }

  // The label numbers are normally printed below the barcodes. Enlarging those
  // regions separately gives the vision model more pixels without changing the
  // original image used for names and the label model.
  const lowerTop = Math.round(height * 0.56);
  const lowerHeight = Math.max(1, height - lowerTop);
  const split = Math.round(width * 0.5);
  const numericImageDataUrls = [
    renderAiCrop(image, 0, lowerTop, split, lowerHeight, 2.6),
    renderAiCrop(image, split, lowerTop, width - split, lowerHeight, 2.6),
  ].filter(Boolean);

  return { imageDataUrl, numericImageDataUrls };
}

function loadImageForAi(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Falha ao preparar os recortes da etiqueta."));
    };
    image.src = url;
  });
}

function renderAiCrop(image, sourceX, sourceY, sourceWidth, sourceHeight, scale) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  try {
    context.filter = "grayscale(1) contrast(1.18)";
  } catch {
    context.filter = "none";
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

function renderAiImage(image, sourceWidth, sourceHeight, maxWidth, quality) {
  const scale = Math.min(1, maxWidth / sourceWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Falha ao preparar imagem."));
    reader.readAsDataURL(blob);
  });
}

function normalizeText(text) {
  return String(text || "")
    .replace(/[|]/g, "I")
    .replace(/[“”"]/g, "")
    .replace(/[‘’]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[^\S\r\n]+/g, " ");
}

function cleanDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function applyDataToForm(data) {
  if (data.nomePaciente) {
    fields.nomePaciente.value = data.nomePaciente;
  }
  if (data.convenio) {
    fields.convenio.value = data.convenio;
  }
  if (data.cirurgia) {
    fields.cirurgia.value = data.cirurgia;
  }
  if (data.atendimento) {
    fields.atendimento.value = data.atendimento;
  }

  if (data.tipo) {
    fields.tipo.value = normalizeTipoValue(data.tipo);
  }

  if (data.credor) {
    fields.credor.value = data.credor;
  }

  syncConditionalEntryFields();
  syncPlantonistasRequirement();

  updateEntryValidationStates();
}

function openManualEntry() {
  stopCamera();
  resetForm({ keepImage: false, hideEntry: false, keepDate: fields.data.value || getTodayISO() });
  showEntryPanel({ showPlantonistasGrid: true });
  setStatus("Preencha o registro manualmente.", "info");
}

function showEntryPanel(options = {}) {
  if (!entryPanelEl) {
    return;
  }

  movePanelToModalLayer(entryPanelEl);
  entryPanelEl.hidden = false;
  entryPanelEl.classList.add("is-open");
  const showPlantonistasGrid = options.showPlantonistasGrid === true;
  entryPanelEl.classList.toggle("manual-entry-expanded", showPlantonistasGrid);
  if (plantonistasUi.panel) {
    plantonistasUi.panel.hidden = !showPlantonistasGrid;
    plantonistasUi.button?.setAttribute("aria-expanded", String(showPlantonistasGrid));
  }
  syncConditionalEntryFields();
  syncPlantonistasRequirement();
  updateEntryValidationStates();
  syncModalLock();
  if (options.scroll !== false) {
    entryPanelEl.scrollTop = 0;
  }
}

function hideEntryPanel() {
  if (!entryPanelEl) {
    return;
  }

  entryPanelEl.hidden = true;
  entryPanelEl.classList.remove("is-open");
  entryPanelEl.classList.remove("manual-entry-expanded");
  entryPanelEl.scrollTop = 0;
  closePlantonistasPicker();
  syncModalLock();
}

function openSummaryPanel() {
  if (!summaryPanelEl) {
    return;
  }

  movePanelToModalLayer(summaryPanelEl);
  summaryPanelEl.hidden = false;
  summaryPanelEl.classList.add("is-open");
  summaryDateEl.value = summaryDateEl.value || getTodayISO();
  syncModalLock();
  loadSummary({ silent: true, date: summaryDateEl.value });
}

function closeSummaryPanel() {
  if (!summaryPanelEl) {
    return;
  }

  summaryPanelEl.hidden = true;
  summaryPanelEl.classList.remove("is-open");
  syncModalLock();
}

function openMonthlyReportPanel() {
  if (!monthlyPanelEl) {
    return;
  }

  movePanelToModalLayer(monthlyPanelEl);
  monthlyPanelEl.hidden = false;
  monthlyPanelEl.classList.add("is-open");
  monthlyReportButtonEl?.setAttribute("aria-expanded", "true");
  if (!reportMonthEl.value) {
    reportMonthEl.value = getTodayISO().slice(0, 7);
    loadMonthlySummary({ silent: true });
  }
  syncModalLock();
}

function closeMonthlyReportPanel() {
  if (!monthlyPanelEl) {
    return;
  }

  monthlyPanelEl.hidden = true;
  monthlyPanelEl.classList.remove("is-open");
  monthlyReportButtonEl?.setAttribute("aria-expanded", "false");
  syncModalLock();
}

async function refreshOpenPanelsData() {
  const tasks = [];
  if (summaryPanelEl && !summaryPanelEl.hidden) {
    tasks.push(loadSummary({ silent: true, date: summaryDateEl?.value || getTodayISO() }));
  }
  if (monthlyPanelEl && !monthlyPanelEl.hidden && reportMonthEl?.value) {
    tasks.push(loadMonthlySummary({ silent: true }));
  }
  await Promise.all(tasks);
}

function syncModalLock() {
  const hasOpenPanel = [entryPanelEl, summaryPanelEl, monthlyPanelEl].some((panel) => panel && !panel.hidden);
  document.body.classList.toggle("modal-open", hasOpenPanel);
}

function movePanelToModalLayer(panel) {
  if (!panel || panel.parentElement === document.body) {
    return;
  }

  document.body.appendChild(panel);
}

function collectFormData() {
  const tipo = normalizeTipoValue(fields.tipo.value);
  const isCaixa = fields.credor.value.trim() === CREDOR_CAIXA;
  return {
    data: fields.data.value,
    nomePaciente: fields.nomePaciente.value.trim(),
    cirurgia: fields.cirurgia.value.trim(),
    atendimento: fields.atendimento.value.trim(),
    tipo,
    valor: (shouldRequireValor(tipo) || isSadtType(tipo)) ? formatStoredCurrency(fields.valor.value) : "",
    convenio: fields.convenio.value.trim(),
    credor: fields.credor.value.trim(),
    plantonistas: isCaixa ? "" : getSelectedPlantonistasValue(),
    consulta: tipo === CONSULTA_TYPE,
    observacoes: "",
    userEmail: state.auth?.email || "",
    userAgent: navigator.userAgent,
  };
}

async function sendToSheet() {
  setSendFeedback("", "neutral");

  if (!state.config.scriptUrl) {
    showSendError("Salve primeiro a URL do Google Apps Script.");
    return;
  }

  let payload = collectFormData();
  const missingFields = getMissingRequiredFields(payload);
  if (missingFields.length) {
    updateEntryValidationStates({ showMissing: true });
    showSendError(`Preencha os campos obrigatórios: ${missingFields.map(getEntryFieldLabel).join(", ")}.`);
    return;
  }

  toggleBusy(true);
  setSendFeedback("Enviando para a planilha...", "neutral");
  setStatus("Enviando para a planilha...", "info");

  try {
    const result = await postWithTimeout(withAuthPayload(payload), 10000);
    if (result?.queued) {
      setSendFeedback("", "neutral");
      setStatus("Registro aguardando conexão para envio.", "error");
      return;
    }

    const sentDate = payload.data;
    resetForm({ keepImage: false, keepDate: sentDate });
    summaryDateEl.value = sentDate;
    reportMonthEl.value = sentDate.slice(0, 7);
    await refreshOpenPanelsData();
    resetScannerView();
    setSendFeedback("Dados enviados com sucesso!", "success");
    setStatus("Dados enviados com sucesso!", "success");
  } catch (error) {
    showSendError(error.message);
  } finally {
    toggleBusy(false);
  }
}

const PENDING_SUBMISSIONS_KEY = "etiquetas-sahmt-pending-submissions";

async function postWithTimeout(payload,timeoutMs,options={}){try{return await Services.saveLabel(payload,{queue:options.queueOnFailure!==false});}catch(e){if(e.code!=="DUPLICATE")throw e;const decision=await confirmSubmission(payload,[payload]);if(!decision.confirmed)throw new Error("Envio cancelado. Nenhum novo registro foi criado.");return Services.saveLabel({...payload,duplicateJustification:decision.duplicateJustification},{queue:options.queueOnFailure!==false});}}

function queueSubmission(){throw new Error("Confira os envios pendentes no menu da conta.");}

function stripQueueMetadata(payload) {
  const { queuedAt, ...cleanPayload } = payload || {};
  return cleanPayload;
}

function readPendingSubmissions(){return Services.pending("etiquetas.save");}

async function flushPendingSubmissions(options={}){try{const r=await Services.flush();updatePendingSubmissionsStatus();if(r.sent&&options.notify)showPendingSendConfirmation(r.sent);}catch{updatePendingSubmissionsStatus();}}

function updatePendingSubmissionsStatus() {
  if (!pendingSubmissionsStatusEl) {
    return;
  }
  const pendingCount = readPendingSubmissions().length;
  pendingSubmissionsStatusEl.hidden = pendingCount === 0;
  pendingSubmissionsStatusEl.textContent = pendingCount === 1
    ? "Registro aguardando conexão para envio."
    : `${pendingCount} registros aguardando conexão para envio.`;
}

window.addEventListener("online", () => flushPendingSubmissions({ notify: true }));
window.setInterval(() => flushPendingSubmissions({ notify: true }), 30000);

function showSendError(message) {
  setSendFeedback(message, "error");
  setStatus(message, "error");
  sendFeedbackEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setSendFeedback(message, tone = "neutral") {
  if (!sendFeedbackEl) {
    return;
  }

  sendFeedbackEl.textContent = message;
  sendFeedbackEl.dataset.tone = tone;
  sendFeedbackEl.hidden = !message;
}

function findExactDuplicates(payload) {
  return state.summaryRows.filter((row) =>
    normalizeDateKey(row.data) === normalizeDateKey(payload.data) &&
    normalizeCompare(row.nomePaciente) === normalizeCompare(payload.nomePaciente) &&
    cleanDigits(row.cirurgia) === cleanDigits(payload.cirurgia) &&
    cleanDigits(row.atendimento) === cleanDigits(payload.atendimento) &&
    normalizeCompare(row.tipo) === normalizeCompare(payload.tipo) &&
    normalizeCompare(row.valor || "") === normalizeCompare(payload.valor || "") &&
    normalizeCompare(row.convenio || "") === normalizeCompare(payload.convenio || "") &&
    normalizeCompare(row.credor) === normalizeCompare(payload.credor) &&
    normalizeCompare(row.plantonistas || "") === normalizeCompare(payload.plantonistas || "")
  );
}

function confirmSubmission(payload, duplicateRows = []) {
  if (!confirmOverlayEl || !confirmSummaryEl || !confirmSendEl || !cancelSendEl) {
    return Promise.resolve({ confirmed: false, duplicateJustification: "" });
  }

  const duplicateWarning = duplicateRows.length ? `
    <div class="duplicate-warning">
      <strong>Atenção: possível lançamento duplicado.</strong>
      <span>Já existe ${duplicateRows.length} registro(s) com exatamente os mesmos dados nesta data. Justifique para continuar.</span>
      <label>
        <span>Justificativa da duplicidade</span>
        <textarea id="duplicate-justification" rows="3" placeholder="Explique por que este lançamento deve ser repetido"></textarea>
      </label>
      <small id="duplicate-warning-feedback" hidden>Informe a justificativa para enviar este lançamento duplicado.</small>
    </div>
  ` : "";

  confirmSummaryEl.innerHTML = `
    <dl>
      <div><dt>Data</dt><dd>${escapeHtml(formatDate(payload.data))}</dd></div>
      <div><dt>Nome</dt><dd>${escapeHtml(payload.nomePaciente)}</dd></div>
      <div><dt>Cirurgia</dt><dd>${escapeHtml(payload.cirurgia)}</dd></div>
      <div><dt>Atendimento</dt><dd>${escapeHtml(payload.atendimento)}</dd></div>
      <div><dt>Tipo</dt><dd>${escapeHtml(payload.tipo)}</dd></div>
      <div><dt>Credor</dt><dd>${escapeHtml(payload.credor)}</dd></div>
      <div><dt>Plantonista(s)</dt><dd>${escapeHtml(payload.plantonistas || "Nao necessario")}</dd></div>
    </dl>
    ${duplicateWarning}
  `;

  confirmOverlayEl.hidden = false;
  confirmSendEl.focus();

  return new Promise((resolve) => {
    const finish = (confirmed, duplicateJustification = "") => {
      confirmOverlayEl.hidden = true;
      confirmSendEl.removeEventListener("click", onConfirm);
      cancelSendEl.removeEventListener("click", onCancel);
      confirmOverlayEl.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKeydown);
      resolve({ confirmed, duplicateJustification });
    };

    const onConfirm = () => {
      if (duplicateRows.length) {
        const justificationEl = confirmSummaryEl.querySelector("#duplicate-justification");
        const feedbackEl = confirmSummaryEl.querySelector("#duplicate-warning-feedback");
        const justification = justificationEl?.value.trim() || "";
        if (!justification) {
          if (feedbackEl) {
            feedbackEl.hidden = false;
          }
          justificationEl?.focus();
          return;
        }
        finish(true, justification);
        return;
      }

      finish(true);
    };
    const onCancel = () => finish(false);
    const onBackdrop = (event) => {
      if (event.target === confirmOverlayEl) {
        finish(false);
      }
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        finish(false);
      }
    };

    confirmSendEl.addEventListener("click", onConfirm);
    cancelSendEl.addEventListener("click", onCancel);
    confirmOverlayEl.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKeydown);
  });
}

function confirmSubmissionEditable(payload, duplicateRows = []) {
  if (!confirmOverlayEl || !confirmSummaryEl || !confirmSendEl) {
    return Promise.resolve({ confirmed: false, payload, duplicateJustification: "" });
  }

  let currentPayload = { ...payload };
  let currentDuplicateRows = duplicateRows;

  const renderConfirmationFields = (feedback = "") => {
    const duplicateWarning = currentDuplicateRows.length ? `
      <div class="duplicate-warning">
        <strong>Atenção: possível lançamento duplicado.</strong>
        <span>Já existe ${currentDuplicateRows.length} registro(s) com exatamente os mesmos dados nesta data. Justifique para continuar.</span>
        <label>
          <span>Justificativa da duplicidade</span>
          <textarea id="duplicate-justification" rows="3" placeholder="Explique por que este lançamento deve ser repetido">${escapeHtml(currentPayload.duplicateJustification || "")}</textarea>
        </label>
      </div>
    ` : "";

    confirmSummaryEl.innerHTML = `
      <div class="confirm-edit-grid">
        <label>
          <span>Data</span>
          <input id="confirm-data" type="date" value="${escapeHtml(currentPayload.data || "")}" required>
        </label>
        <label class="full-width">
          <span>Nome do Paciente</span>
          <input id="confirm-nomePaciente" type="text" value="${escapeHtml(currentPayload.nomePaciente || "")}" required>
        </label>
        <label>
          <span>Cirurgia</span>
          <input id="confirm-cirurgia" inputmode="numeric" value="${escapeHtml(currentPayload.cirurgia || "")}" required>
        </label>
        <label>
          <span>Atendimento</span>
          <input id="confirm-atendimento" inputmode="numeric" value="${escapeHtml(currentPayload.atendimento || "")}" required>
        </label>
        <label>
          <span>Tipo</span>
          <select id="confirm-tipo" required>
            ${renderOption("", "Selecione", currentPayload.tipo)}
            ${renderOption("Particular", "Particular", currentPayload.tipo)}
            ${renderOption("Complementação", "Complementação", currentPayload.tipo)}
            ${renderOption("Convênio", "Convênio", currentPayload.tipo)}
            ${renderOption(CONSULTA_TYPE, CONSULTA_TYPE, currentPayload.tipo)}
            ${renderOption(SADT_TYPE, SADT_TYPE, currentPayload.tipo)}
          </select>
        </label>
        <label id="confirm-valor-field" ${(shouldRequireValor(currentPayload.tipo) || isSadtType(currentPayload.tipo)) ? "" : "hidden"}>
          <span>Valor em Real</span>
          <input id="confirm-valor" inputmode="decimal" value="${escapeHtml(currentPayload.valor || "")}" placeholder="R$ 0,00">
        </label>
        <label id="confirm-convenio-field" ${shouldRequireConvenio(currentPayload.tipo) ? "" : "hidden"}>
          <span>Convênio</span>
          <input id="confirm-convenio" type="text" value="${escapeHtml(currentPayload.convenio || "")}" placeholder="Nome do convênio">
        </label>
        <label>
          <span>Credor</span>
          <select id="confirm-credor" required>
            ${renderOption("", "Selecione", currentPayload.credor)}
            ${renderOption("Caixa", "Caixa", currentPayload.credor)}
            ${renderOption("Plantão", "Plantão", currentPayload.credor)}
            ${renderOption("Plantão/Caixa", "Plantão/Caixa", currentPayload.credor)}
          </select>
        </label>
        <label class="full-width">
          <span>Plantonista(s)</span>
          <input id="confirm-plantonistas" type="text" value="${escapeHtml(currentPayload.plantonistas || "")}" placeholder="Nao necessario quando Credor for Caixa">
        </label>
      </div>
      ${duplicateWarning}
      <p id="confirm-edit-feedback" class="confirm-edit-feedback" ${feedback ? "" : "hidden"}>${escapeHtml(feedback)}</p>
    `;
  };

  renderConfirmationFields();
  confirmOverlayEl.hidden = false;
  bindConfirmConditionalFields();
  confirmSendEl.focus();

  return new Promise((resolve) => {
    const finish = (confirmed, finalPayload = currentPayload, duplicateJustification = "") => {
      confirmOverlayEl.hidden = true;
      confirmSendEl.removeEventListener("click", onConfirm);
      confirmOverlayEl.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKeydown);
      resolve({ confirmed, payload: finalPayload, duplicateJustification });
    };

    const onConfirm = async () => {
      currentPayload = collectConfirmationPayload(currentPayload);
      const missing = getMissingRequiredFields(currentPayload);
      if (missing.length) {
        renderConfirmationFields("Corrija os campos obrigatórios antes de confirmar o envio.");
        bindConfirmConditionalFields();
        return;
      }

      await loadSummary({ silent: true, date: currentPayload.data });
      currentDuplicateRows = findExactDuplicates(currentPayload);
      const duplicateJustification = currentPayload.duplicateJustification || "";
      if (currentDuplicateRows.length && !duplicateJustification) {
        renderConfirmationFields("Informe a justificativa para enviar este lançamento duplicado.");
        bindConfirmConditionalFields();
        confirmSummaryEl.querySelector("#duplicate-justification")?.focus();
        return;
      }

      finish(true, currentPayload, duplicateJustification);
    };
    const onBackdrop = (event) => {
      if (event.target === confirmOverlayEl) {
        finish(false);
      }
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        finish(false);
      }
    };

    confirmSendEl.addEventListener("click", onConfirm);
    confirmOverlayEl.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKeydown);
  });
}

function bindConfirmConditionalFields() {
  const typeEl = confirmSummaryEl?.querySelector("#confirm-tipo");
  const valueEl = confirmSummaryEl?.querySelector("#confirm-valor");
  if (typeEl) {
    typeEl.addEventListener("change", () => syncInlineConditionalFields(confirmSummaryEl, "confirm"));
    syncInlineConditionalFields(confirmSummaryEl, "confirm");
  }
  if (valueEl) {
    valueEl.addEventListener("blur", () => {
      valueEl.value = formatCurrencyInput(valueEl.value);
    });
  }
}

function renderOption(value, label, selectedValue) {
  const selected = normalizeCompare(value) === normalizeCompare(selectedValue || "") ? " selected" : "";
  return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
}

function withEditingFallback(value, fallback) {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

function collectConfirmationPayload(basePayload) {
  const credor = confirmSummaryEl.querySelector("#confirm-credor")?.value.trim() || "";
  const duplicateJustification = confirmSummaryEl.querySelector("#duplicate-justification")?.value.trim() || "";

  return {
    ...basePayload,
    data: confirmSummaryEl.querySelector("#confirm-data")?.value || "",
    nomePaciente: confirmSummaryEl.querySelector("#confirm-nomePaciente")?.value.trim() || "",
    cirurgia: cleanDigits(confirmSummaryEl.querySelector("#confirm-cirurgia")?.value || ""),
    atendimento: cleanDigits(confirmSummaryEl.querySelector("#confirm-atendimento")?.value || ""),
    tipo: normalizeTipoValue(confirmSummaryEl.querySelector("#confirm-tipo")?.value || ""),
    valor: (shouldRequireValor(confirmSummaryEl.querySelector("#confirm-tipo")?.value || "") || isSadtType(confirmSummaryEl.querySelector("#confirm-tipo")?.value || ""))
      ? formatStoredCurrency(confirmSummaryEl.querySelector("#confirm-valor")?.value || "")
      : "",
    convenio: shouldRequireConvenio(confirmSummaryEl.querySelector("#confirm-tipo")?.value || "")
      ? (confirmSummaryEl.querySelector("#confirm-convenio")?.value.trim() || "")
      : "",
    credor,
    plantonistas: credor === CREDOR_CAIXA ? "" : (confirmSummaryEl.querySelector("#confirm-plantonistas")?.value.trim() || ""),
    duplicateJustification,
  };
}

function getMissingRequiredFields(payload, options = {}) {
  if (isConsultaMode() || payload.consulta === true) {
    return ["data", "nomePaciente", "atendimento", "credor"].filter((key) => !String(payload[key] || "").trim());
  }
  const {
    requireValor = shouldRequireValor(payload.tipo),
    requireConvenio = true,
    requirePlantonistas = payload.credor !== CREDOR_CAIXA,
  } = options;
  const required = isSadtMode() || normalizeTipoValue(payload.tipo) === SADT_TYPE
    ? ["data", "nomePaciente", "atendimento", "tipo", "credor"]
    : ["data", "nomePaciente", "cirurgia", "atendimento", "tipo", "credor"];
  if (requireValor) {
    required.push("valor");
  }
  if (requireConvenio) {
    required.push("convenio");
  }
  if (requirePlantonistas) {
    required.push("plantonistas");
  }

  return required.filter((key) => !String(payload[key] || "").trim());
}

function getEntryFieldLabel(key) {
  const labels = {
    data: "Data",
    nomePaciente: "Nome do Paciente",
    cirurgia: "Cirurgia",
    atendimento: "Atendimento",
    tipo: "Tipo",
    valor: "Valor em Real",
    convenio: "Convênio",
    credor: "Credor",
    plantonistas: "Plantonista(s)",
  };

  return labels[key] || key;
}

function getEntryValidationControl(key) {
  if (key === "plantonistas") {
    return plantonistasUi.button || fields.plantonistas;
  }

  return fields[key];
}

function updateEntryValidationStates(options = {}) {
  const payload = collectFormData();
  const requiredKeys = isConsultaMode()
    ? ["data", "nomePaciente", "atendimento", "credor"]
    : isSadtMode()
      ? ["data", "nomePaciente", "atendimento", "tipo", "credor"]
      : ["data", "nomePaciente", "cirurgia", "atendimento", "tipo", "credor"];
  if (shouldRequireValor(payload.tipo)) {
    requiredKeys.push("valor");
  }
  if (shouldRequireConvenio(payload.tipo)) {
    requiredKeys.push("convenio");
  }
  if (payload.credor !== CREDOR_CAIXA) {
    requiredKeys.push("plantonistas");
  }

  Object.keys(fields).forEach((key) => {
    const control = getEntryValidationControl(key);
    const label = fields[key]?.closest("label");
    const isRequired = requiredKeys.includes(key);
    const isFilled = String(payload[key] || "").trim().length > 0;
    const emptyRequired = isRequired && !isFilled;
    const filledRequired = isRequired && isFilled;

    label?.classList.toggle("is-required-empty", emptyRequired);
    label?.classList.toggle("is-required-filled", filledRequired);
    control?.classList.toggle("is-required-empty", emptyRequired);
    control?.classList.toggle("is-required-filled", filledRequired);
    control?.setAttribute("aria-invalid", String(emptyRequired));

    if (!isRequired) {
      control?.removeAttribute("aria-invalid");
    }
  });

  if (options.showMissing) {
    const firstMissingKey = requiredKeys.find((key) => !String(payload[key] || "").trim());
    const firstControl = getEntryValidationControl(firstMissingKey);
    firstControl?.focus?.({ preventScroll: true });
    firstControl?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }
}

function syncConditionalEntryFields() {
  syncEntryModeFields();
  const tipo = fields.tipo.value;
  const requiresValor = shouldRequireValor(tipo);
  const needsValor = requiresValor || isSadtType(tipo);

  if (conditionalFields.valor) {
    conditionalFields.valor.hidden = !needsValor;
  }
  if (fields.valor) {
    fields.valor.required = requiresValor;
    if (!needsValor) {
      fields.valor.value = "";
    }
  }

  if (fields.convenio) {
    fields.convenio.required = true;
  }

  updateEntryValidationStates();
}

function syncEntryModeFields() {
  const consultaKeys = new Set(["data", "nomePaciente", "atendimento", "credor"]);
  const consultaMode = isConsultaMode();
  const sadtMode = isSadtType(fields.tipo?.value);
  Object.entries(fields).forEach(([key, field]) => {
    const label = field?.closest("label");
    if (!label) return;
    label.hidden = consultaMode ? !consultaKeys.has(key) : sadtMode && key === "cirurgia";
    field.disabled = sadtMode && key === "cirurgia";
  });

  if (consultaMode) {
    fields.credor.value = CREDOR_CAIXA;
    fields.cirurgia.value = "";
    fields.valor.value = "";
    fields.convenio.value = "";
    clearPlantonistasSelection();
  }

  if (sadtMode) {
    fields.cirurgia.value = "";
  }
}

function isConsultaMode() {
  return fields.tipo?.value === CONSULTA_TYPE;
}

function isSadtType(value) {
  return normalizeCompare(value) === "sadt";
}

function isSadtMode() {
  return isSadtType(fields.tipo?.value);
}

function syncInlineConditionalFields(root, prefix) {
  const typeEl = root?.querySelector(`#${prefix}-tipo`);
  const surgeryFieldEl = root?.querySelector(`#${prefix}-cirurgia`)?.closest("label");
  const surgeryEl = root?.querySelector(`#${prefix}-cirurgia`);
  const valueFieldEl = root?.querySelector(`#${prefix}-valor-field`);
  const valueEl = root?.querySelector(`#${prefix}-valor`);
  const convenioFieldEl = root?.querySelector(`#${prefix}-convenio-field`);
  const convenioEl = root?.querySelector(`#${prefix}-convenio`);
  const needsValor = shouldRequireValor(typeEl?.value || "") || isSadtType(typeEl?.value || "");
  const needsConvenio = shouldRequireConvenio(typeEl?.value || "");
  const sadtMode = isSadtType(typeEl?.value || "");

  if (surgeryFieldEl) {
    surgeryFieldEl.hidden = sadtMode;
  }
  if (surgeryEl) {
    surgeryEl.disabled = sadtMode;
    surgeryEl.required = !sadtMode;
    if (sadtMode) {
      surgeryEl.value = "";
    }
  }

  if (valueFieldEl) {
    valueFieldEl.hidden = !needsValor;
  }
  if (valueEl) {
    valueEl.required = needsValor;
    if (!needsValor) {
      valueEl.value = "";
    }
  }

  if (convenioFieldEl) {
    convenioFieldEl.hidden = !needsConvenio;
  }
  if (convenioEl) {
    convenioEl.required = needsConvenio;
    if (!needsConvenio) {
      convenioEl.value = "";
    }
  }
}

function applyConfirmationPayloadToForm(payload) {
  fields.data.value = payload.data || fields.data.value;
  fields.nomePaciente.value = payload.nomePaciente || "";
  fields.cirurgia.value = payload.cirurgia || "";
  fields.atendimento.value = payload.atendimento || "";
  fields.tipo.value = normalizeTipoValue(payload.tipo || "");
  fields.valor.value = formatStoredCurrency(payload.valor);
  fields.convenio.value = payload.convenio || "";
  fields.credor.value = payload.credor || "";
  syncConditionalEntryFields();
  setSelectedPlantonistasFromValue(payload.plantonistas || "");
  syncPlantonistasRequirement();
  updateEntryValidationStates();
}

async function refreshDisplayedSummaries() {
  if (!state.config.scriptUrl) {
    return;
  }

  await refreshOpenPanelsData();
}

async function loadSummary(options={}){state.summaryMode="date";try{state.summaryRows=(await Services.labelEntries({date:options.date||summaryDateEl.value||getTodayISO()})).sort(compareEtiquetaRecordsDesc);renderSummary(state.summaryRows,"Nenhuma entrada encontrada nesta data.");if(!options.silent)setStatus("Resumo carregado.","success");}catch(e){state.summaryRows=[];renderSummary([],e.message);if(!options.silent)setStatus(e.message,"error");}}

function runSummarySearch() {
  loadSummary({ silent: false, date: summaryDateEl?.value || getTodayISO() });
}

function resetSummaryToToday() {
  if (summaryDateEl) {
    summaryDateEl.value = getTodayISO();
  }
  loadSummary({ silent: false, date: getTodayISO() });
}

async function loadMonthlySummary(options = {}) {
  if (!state.config.scriptUrl) {
    state.monthlyRows = [];
    state.monthlyMonth = "";
    renderMonthlyStatus("Configure a URL do Apps Script para atualizar o relatorio mensal.", "error");
    renderMonthlyList([], "Configure a integracao para carregar os registros.");
    return;
  }

  const month = reportMonthEl.value;
  if (!month) {
    state.monthlyRows = [];
    state.monthlyMonth = "";
    renderMonthlyStatus("Escolha um mes para carregar os registros.", "neutral");
    renderMonthlyList([], "Os registros aparecem somente depois de selecionar um mes.");
    return;
  }

  try {
    state.monthlyRows = (await loadMonthlyEntries(month)).sort(compareEtiquetaRecordsAsc);
    state.monthlyMonth = month;
    const alertCount = state.monthlyRows.filter((row) => isAlertType(row.tipo)).length;
    const updatedAt = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    renderMonthlyStatus(
      `${state.monthlyRows.length} entrada(s) em ${formatMonth(month)}. ${alertCount} alerta(s). Atualizado as ${updatedAt}.`,
      state.monthlyRows.length ? "success" : "neutral"
    );
    renderMonthlyList(state.monthlyRows, "Nenhum registro encontrado para este mes.");

    if (!options.silent) {
      setStatus("Relatorio mensal atualizado.", "success");
    }
  } catch (error) {
    state.monthlyRows = [];
    state.monthlyMonth = "";
    renderMonthlyStatus(`Nao foi possivel atualizar o relatorio mensal: ${error.message}`, "error");
    renderMonthlyList([], "Nao foi possivel carregar os registros deste mes.");
    if (!options.silent) {
      setStatus(`Falha ao atualizar relatorio mensal: ${error.message}`, "error");
    }
  }
}

function renderMonthlyStatus(message, tone = "neutral") {
  monthlyStatusEl.textContent = message;
  monthlyStatusEl.dataset.tone = tone;
}

function renderMonthlyList(rows, emptyMessage = "Nenhum registro encontrado para este mes.") {
  if (!monthlyListEl) {
    return;
  }

  if (!rows.length) {
    monthlyListEl.innerHTML = `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  monthlyListEl.innerHTML = `
    <div class="monthly-records">
      ${rows.map((row, index) => {
        const alertClass = isAlertType(row.tipo) ? " alert-row" : "";
        const editedClass = row.editadoEm || row.editadoPor || row.resumoEdicao || row.observacaoAtualizadaEm || row.observacaoAtualizadaPor ? " edited-row" : "";
        const monthlyTone = ["a", "b", "c", "d"][index % 4];
        return `
        <article class="record-card record-card--tone-${(index % 4) + 1} summary-item${alertClass}${editedClass}" data-row-number="${escapeHtml(row.rowNumber || "")}" tabindex="0">
          <div class="record-card__number">${index + 1}</div>
          <div class="record-card__rows">
            ${renderEtiquetaRecordFields(row)}
            ${renderSummaryEditBlock(row)}
            ${renderSummaryObservationBlock(row, true)}
          </div>
        </article>
      `;
      }).join("")}
    </div>
  `;
}

function toggleMonthlyReportPanel() {
  if (!monthlyPanelEl) {
    return;
  }

  if (monthlyPanelEl.hidden) {
    openMonthlyReportPanel();
  } else {
    closeMonthlyReportPanel();
  }
}

function renderSummary(rows, emptyMessage = "Nenhuma entrada encontrada nesta data.") {
  summaryTotalsEl.innerHTML = "";

  if (!rows.length) {
    summaryListEl.innerHTML = `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  summaryListEl.innerHTML = rows.map((row, index) => {
    const alertClass = isAlertType(row.tipo) ? " alert-row" : "";
    const editedClass = row.editadoEm || row.editadoPor || row.resumoEdicao || row.observacaoAtualizadaEm || row.observacaoAtualizadaPor ? " edited-row" : "";
    const editBlock = renderSummaryEditBlock(row);
    const observationBlock = renderSummaryObservationBlock(row);
    const dailyTone = ["a", "b", "c", "d"][index % 4];
    return `
      <article class="record-card record-card--tone-${(index % 4) + 1} summary-item${alertClass}${editedClass}" data-row-number="${escapeHtml(row.rowNumber || "")}" tabindex="0">
        <div class="record-card__number">${index + 1}</div>
        <div class="record-card__rows">
          ${renderEtiquetaRecordFields(row)}
          ${editBlock}
          ${observationBlock}
          <div class="record-card__actions">
            <button type="button" class="record-card__edit-button" data-edit-record>EDITAR REGISTRO</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  summaryListEl.querySelectorAll("[data-edit-record]").forEach((button, index) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openEditRecord(rows[index]);
    });
  });

  summaryListEl.querySelectorAll(".summary-item").forEach((item, index) => {
    const row = rows[index];
    const open = () => openEditRecord(row);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        open();
      }
    });
  });
}

function renderEtiquetaRecordFields(row) {
  const fields = [
    ["Data", formatDate(row.data || "")],
    ["Nome do Paciente", row.nomePaciente],
    ["Convênio", row.convenio],
    ["Cirurgia", row.cirurgia],
    ["Atendimento", row.atendimento],
    ["Tipo", row.tipo],
    ["Valor", row.valor ? formatStoredCurrency(row.valor) : ""],
    ["Credor", row.credor],
    ["Plantonista(s)", row.plantonistas],
    ["Responsável pelo Registro", row.criadoPor],
  ];
  return fields
    .filter(([, value]) => String(value || "").trim() && String(value).trim() !== "-")
    .map(([label, value]) => {
      const isRegistration = label === "Responsável pelo Registro";
      const rowClass = isRegistration ? " record-card__row--registration" : "";
      const labelClass = isRegistration ? " record-card__label--registration" : "";
      const userClass = isRegistration && isAuthenticatedUserEmail(value)
        ? " record-card__value--authenticated-user"
        : "";
      return `<div class="record-card__row${rowClass}"><span class="record-card__label${labelClass}">${escapeHtml(label)}</span><span class="record-card__value${userClass}">${escapeHtml(value)}</span></div>`;
    })
    .join("");
}

function isAuthenticatedUserEmail(value) {
  const authenticatedEmail = String(state.auth?.email || "").trim().toLowerCase();
  const candidate = String(value || "").trim().toLowerCase();
  return Boolean(authenticatedEmail && candidate && (
    candidate === authenticatedEmail || candidate.includes(authenticatedEmail)
  ));
}

function renderSummaryField(label, value) {
  const text = String(value == null ? "" : value).trim();
  if (!text || text === "-") {
    return "";
  }
  return `<div class="summary-data-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(text)}</strong></div>`;
}

function renderSummaryObservationBlock(row) {
  const hasObservation = row.observacoes || row.observacaoAtualizadaEm || row.observacaoAtualizadaPor;
  if (!hasObservation) {
    return "";
  }

  return `
    <div class="record-card__row record-card__row--registration summary-observation-block">
      <span class="record-card__label record-card__label--registration">Observacao</span>
      <span>${escapeHtml(composeHistoryLine(
        row.observacaoAtualizadaEm || "Sem data registrada",
        row.observacaoAtualizadaPor || "Sem responsavel registrado",
        row.observacoes || "Sem texto de observacao."
      ))}</span>
    </div>
  `;
}

function renderSummaryEditBlock(row) {
  const hasEdit = row.editadoEm || row.editadoPor || row.resumoEdicao;
  if (!hasEdit) {
    return "";
  }

  return `
    <div class="record-card__row record-card__row--history summary-edit-block">
      <span class="record-card__label record-card__label--history">Edicao de Registro</span>
      ${renderEditHistoryLines(row)}
    </div>
  `;
}

function renderEditHistoryLines(row) {
  const history = String(row.resumoEdicao || "").trim();
  const entries = history
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => renderEditHistoryEntry(line))
      .join("");
  const fallback = renderEditHistoryEntry(composeHistoryLine(
    row.editadoEm || "Sem data registrada",
    row.editadoPor || "Sem responsavel registrado",
    "Registro editado."
  ));
  return `<div class="record-card__history">${entries || fallback}</div>`;
}

function renderEditHistoryEntry(line) {
  const raw = String(line || "").trim();
  const separatorIndex = raw.indexOf(" - ");
  const changeSeparatorIndex = raw.indexOf(": ", separatorIndex + 3);
  const date = separatorIndex >= 0 ? raw.slice(0, separatorIndex) : "Sem data registrada";
  const responsible = separatorIndex >= 0 && changeSeparatorIndex >= 0
    ? raw.slice(separatorIndex + 3, changeSeparatorIndex)
    : "Sem responsavel registrado";
  const changes = changeSeparatorIndex >= 0 ? raw.slice(changeSeparatorIndex + 2) : raw;
  const initial = [];
  const edited = [];

  changes.split(/;\s*/).filter(Boolean).forEach((change) => {
    const match = change.match(/^([^:]+):\s*(.*?)\s*->\s*(.*)$/);
    if (match) {
      initial.push(`${match[1].trim()}: ${match[2].trim()}`);
      edited.push(`${match[1].trim()}: ${match[3].trim()}`);
    } else {
      edited.push(change.trim());
    }
  });

  return `<div class="record-card__history-entry">
    ${renderHistoryLine("Data", date)}
    ${renderHistoryLine("Responsável", responsible)}
    ${renderHistoryLine("Estado inicial", initial.join("; ") || "Não informado")}
    ${renderHistoryLine("Estado editado", edited.join("; ") || "Não informado")}
  </div>`;
}

function renderHistoryLine(label, value) {
  const userClass = label === "Responsável" && isAuthenticatedUserEmail(value)
    ? " record-card__history-value--authenticated-user"
    : "";
  return `<div class="record-card__history-line"><span class="record-card__history-label">${escapeHtml(label)}:</span><span class="record-card__history-value${userClass}">${escapeHtml(value)}</span></div>`;
}

function composeHistoryLine(dateTime, responsible, detail) {
  return `${dateTime} - ${responsible}: ${detail}`;
}

function formatEditHistoryLine(line) {
  const rawLine = String(line || "");
  const userSeparatorIndex = rawLine.indexOf(": ", rawLine.indexOf(" - ") + 3);
  if (userSeparatorIndex === -1) {
    return escapeHtml(rawLine);
  }

  const prefix = rawLine.slice(0, userSeparatorIndex + 2);
  const details = rawLine.slice(userSeparatorIndex + 2);
  return escapeHtml(prefix) + escapeHtml(details)
    .replace(/-&gt; ([^;]+)/g, "-&gt; <span class=\"summary-new-value\">$1</span>");
}

function openEditRecord(rowOrRowNumber) {
  const sourceRow = typeof rowOrRowNumber === "object" && rowOrRowNumber
    ? rowOrRowNumber
    : state.summaryRows.find((entry) => String(entry.rowNumber) === String(rowOrRowNumber));
  const row = normalizeEditableRow(sourceRow);
  if (!row || !editOverlayEl || !editSummaryEl) {
    return;
  }

  state.editingRow = { ...row };
  renderEditRecordFields();
  setEditFeedback("", "neutral");
  editOverlayEl.hidden = false;
  editContextEl.textContent = `Lancado por: ${row.criadoPor || "Nao informado"} | Criado em: ${row.criadoEm || "Nao informado"}`;
}

function normalizeEditableRow(source) {
  if (!source) return null;
  if (Array.isArray(source)) {
    return {
      rowNumber: source[0] || "", data: source[1] || "", nomePaciente: source[2] || "",
      convenio: source[3] || "", cirurgia: source[4] || "", atendimento: source[5] || "",
      tipo: normalizeTipoValue(source[6] || ""), credor: source[7] || "", plantonistas: source[8] || "",
      observacoes: source[9] || "", criadoEm: source[10] || "", criadoPor: source[11] || "",
      valor: source[16] || ""
    };
  }
  return {
    ...source,
    rowNumber: source.rowNumber || source.rowIndex || source.linha || "",
    data: source.data || source.date || source.dataRegistro || "",
    nomePaciente: source.nomePaciente || source.nome || source.paciente || "",
    convenio: source.convenio || source.plano || "",
    cirurgia: source.cirurgia || "",
    atendimento: source.atendimento || source.numeroAtendimento || "",
    tipo: normalizeTipoValue(source.tipo || source.tipoRegistro || ""),
    credor: source.credor || "",
    plantonistas: source.plantonistas || source.plantonista || "",
    observacoes: source.observacoes || source.observacao || "",
    criadoEm: source.criadoEm || source.timestamp || "",
    criadoPor: source.criadoPor || source.responsavel || "",
    valor: source.valor ?? source.valorEmReal ?? ""
  };
}

function renderEditRecordFields() {
  const row = state.editingRow || {};
  const isConsulta = normalizeTipoValue(row.tipo) === CONSULTA_TYPE;
  const cirurgiaField = isConsulta ? "" : `
      <label>
        <span>Cirurgia</span>
        <input id="edit-cirurgia" inputmode="numeric" value="${escapeHtml(row.cirurgia || "")}" required>
      </label>`;
  const selectedPlantonistas = String(row.plantonistas || "")
    .split(/[,;]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const editPlantonistaOptions = Array.from(fields.plantonistas.options)
    .filter((option) => option.value)
    .map((option) => {
      const value = option.value.trim();
      const checked = selectedPlantonistas.includes(value.toUpperCase()) ? " checked" : "";
      return `<label><input type="checkbox" name="edit-plantonista" value="${escapeHtml(value)}"${checked}> <span>${escapeHtml(value)}</span></label>`;
    })
    .join("");
  const plantonistasField = isConsulta ? "" : `
      <label class="full-width edit-plantonistas-field">
        <span>Plantonista(s)</span>
        <div id="edit-plantonistas-grid" class="multi-select-options edit-plantonistas-grid">${editPlantonistaOptions}</div>
      </label>`;

  editSummaryEl.innerHTML = `
    <div class="confirm-edit-grid">
      <label>
        <span>Data</span>
        <input id="edit-data" type="date" value="${escapeHtml(row.data || "")}" required>
      </label>
      <label class="full-width">
        <span>Nome do Paciente</span>
        <input id="edit-nomePaciente" type="text" value="${escapeHtml(row.nomePaciente || "")}" required>
      </label>
      ${cirurgiaField}
      <label>
        <span>Atendimento</span>
        <input id="edit-atendimento" inputmode="numeric" value="${escapeHtml(row.atendimento || "")}" required>
      </label>
      <label>
        <span>Tipo</span>
        <select id="edit-tipo" required>
          ${renderOption("", "Selecione", row.tipo)}
          ${renderOption("Particular", "Particular", row.tipo)}
          ${renderOption("Complementação", "Complementação", row.tipo)}
          ${renderOption("Convênio", "Convênio", row.tipo)}
          ${renderOption("Consulta Pré-anestésica", "Consulta Pré-anestésica", row.tipo)}
          ${renderOption(SADT_TYPE, SADT_TYPE, row.tipo)}
        </select>
      </label>
      <label id="edit-valor-field" ${(shouldRequireValor(row.tipo) || isSadtType(row.tipo)) ? "" : "hidden"}>
        <span>Valor em Real</span>
        <input id="edit-valor" inputmode="decimal" value="${escapeHtml(formatStoredCurrency(row.valor))}" placeholder="R$ 0,00">
      </label>
      <label id="edit-convenio-field">
        <span>Convênio</span>
        <input id="edit-convenio" type="text" value="${escapeHtml(row.convenio || "")}" placeholder="Nome do convênio">
      </label>
      <label>
        <span>Credor</span>
        <select id="edit-credor" required>
          ${renderOption("", "Selecione", row.credor)}
          ${renderOption("Caixa", "Caixa", row.credor)}
          ${renderOption("Plantão", "Plantão", row.credor)}
          ${renderOption("Plantão/Caixa", "Plantão/Caixa", row.credor)}
        </select>
      </label>
      ${plantonistasField}
      <label class="full-width">
        <span>Observacoes</span>
        <textarea id="edit-observacoes" rows="3" placeholder="Opcional">${escapeHtml(row.observacoes || "")}</textarea>
      </label>
    </div>
  `;
  bindEditConditionalFields();
}

function collectEditPayload() {
  const original = state.editingRow || {};
  const credor = editSummaryEl.querySelector("#edit-credor")?.value.trim() || "";
  const tipo = editSummaryEl.querySelector("#edit-tipo")?.value.trim() || "";
  const mergedTipo = normalizeTipoValue(withEditingFallback(tipo, original.tipo));
  const mergedCredor = mergedTipo === CONSULTA_TYPE
    ? CREDOR_CAIXA
    : withEditingFallback(credor, original.credor);
  const selectedPlantonistas = Array.from(editSummaryEl.querySelectorAll("input[name='edit-plantonista']:checked"))
    .map((checkbox) => checkbox.value.trim())
    .filter(Boolean)
    .join(", ");
  return {
    id:original.id,version:original.version,
    rowNumber: original.rowNumber || "",
    data: withEditingFallback(editSummaryEl.querySelector("#edit-data")?.value || "", original.data),
    nomePaciente: withEditingFallback(editSummaryEl.querySelector("#edit-nomePaciente")?.value.trim() || "", original.nomePaciente),
    cirurgia: mergedTipo === CONSULTA_TYPE || isSadtType(mergedTipo) ? "" : withEditingFallback(cleanDigits(editSummaryEl.querySelector("#edit-cirurgia")?.value || ""), cleanDigits(original.cirurgia || "")),
    atendimento: withEditingFallback(cleanDigits(editSummaryEl.querySelector("#edit-atendimento")?.value || ""), cleanDigits(original.atendimento || "")),
    tipo: mergedTipo,
    valor: (shouldRequireValor(mergedTipo) || isSadtType(mergedTipo))
      ? withEditingFallback(formatStoredCurrency(editSummaryEl.querySelector("#edit-valor")?.value || ""), formatStoredCurrency(original.valor))
      : "",
    convenio: mergedTipo === CONSULTA_TYPE ? "" : withEditingFallback(editSummaryEl.querySelector("#edit-convenio")?.value.trim() || "", original.convenio),
    credor: mergedCredor,
    plantonistas: mergedCredor === CREDOR_CAIXA
      ? ""
      : withEditingFallback(selectedPlantonistas, original.plantonistas),
    consulta: mergedTipo === CONSULTA_TYPE,
    observacoes: editSummaryEl.querySelector("#edit-observacoes")?.value.trim() || "",
  };
}

function bindEditConditionalFields() {
  const typeEl = editSummaryEl?.querySelector("#edit-tipo");
  const valueEl = editSummaryEl?.querySelector("#edit-valor");
  const credorEl = editSummaryEl?.querySelector("#edit-credor");
  const plantonistaToggle = editSummaryEl?.querySelector("#edit-plantonistas-toggle");
  const plantonistaGrid = editSummaryEl?.querySelector("#edit-plantonistas-grid");
  if (typeEl) {
    typeEl.addEventListener("change", () => {
      typeEl.value = normalizeTipoValue(typeEl.value);
      if (typeEl.value === CONSULTA_TYPE) {
        const credorEl = editSummaryEl.querySelector("#edit-credor");
        if (credorEl) credorEl.value = CREDOR_CAIXA;
      }
      syncInlineConditionalFields(editSummaryEl, "edit");
      syncEditPlantonistaGrid();
    });
    syncInlineConditionalFields(editSummaryEl, "edit");
  }
  if (valueEl) {
    valueEl.addEventListener("blur", () => {
      valueEl.value = formatStoredCurrency(valueEl.value);
    });
  }
  if (credorEl) {
    credorEl.addEventListener("change", syncEditPlantonistaGrid);
    syncEditPlantonistaGrid();
  }
  if (plantonistaToggle && plantonistaGrid) {
    plantonistaToggle.addEventListener("click", () => {
      const isOpen = !plantonistaGrid.hidden;
      plantonistaGrid.hidden = isOpen;
      plantonistaToggle.setAttribute("aria-expanded", String(!isOpen));
    });
    plantonistaGrid.addEventListener("change", updateEditPlantonistaToggle);
  }
}

function syncEditPlantonistaGrid() {
  const credor = editSummaryEl?.querySelector("#edit-credor")?.value.trim() || "";
  const disabled = credor === CREDOR_CAIXA;
  editSummaryEl?.querySelectorAll("input[name='edit-plantonista']").forEach((checkbox) => {
    checkbox.disabled = disabled;
  });
}

function updateEditPlantonistaToggle() {
  const toggle = editSummaryEl?.querySelector("#edit-plantonistas-toggle");
  if (!toggle) return;
  const selected = Array.from(editSummaryEl.querySelectorAll("input[name='edit-plantonista']:checked"))
    .map((checkbox) => checkbox.value.trim())
    .filter(Boolean);
  toggle.textContent = selected.length ? selected.join(", ") : "Selecionar siglas";
}

async function saveEditedRecord() {
  if (!state.editingRow) {
    return;
  }

  const payload = collectEditPayload();
  const missing = getMissingRequiredFields(payload, {
    requireValor: false,
    requireConvenio: false,
    requirePlantonistas: payload.credor !== CREDOR_CAIXA,
  });
  if (missing.length) {
    setEditFeedback("Corrija os campos obrigatorios antes de salvar.", "error");
    return;
  }

  toggleBusy(true);
  setEditFeedback("Salvando edicao...", "neutral");
  try {
    const result=await Services.saveLabel(payload,{update:true,queue:false});

    closeEditRecord();
    if (payload.data) {
      summaryDateEl.value = payload.data;
    }
    await refreshOpenPanelsData();
    setStatus(result.message || "Registro editado com sucesso!", "success");
  } catch (error) {
    setEditFeedback(`Falha ao editar registro: ${error.message}`, "error");
  } finally {
    toggleBusy(false);
  }
}

function closeEditRecord() {
  state.editingRow = null;
  if (editOverlayEl) {
    editOverlayEl.hidden = true;
  }
  setEditFeedback("", "neutral");
}

function setEditFeedback(message, tone = "neutral") {
  if (!editFeedbackEl) {
    return;
  }
  editFeedbackEl.textContent = message;
  editFeedbackEl.dataset.tone = tone;
  editFeedbackEl.hidden = !message;
}

async function loadMonthlyEntries(month){return (await Services.labelEntries({month})).sort(compareEtiquetaRecordsAsc);}

function compareEtiquetaRecordsDesc(left, right) {
  const leftTime = parseEtiquetaDateTime(left?.criadoEm || left?.data);
  const rightTime = parseEtiquetaDateTime(right?.criadoEm || right?.data);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return Number(right?.rowNumber || 0) - Number(left?.rowNumber || 0);
}

function compareEtiquetaRecordsAsc(left, right) {
  return -compareEtiquetaRecordsDesc(left, right);
}

function parseEtiquetaDateTime(value) {
  const text = String(value || "").trim();
  const isoTime = Date.parse(text);
  if (Number.isFinite(isoTime)) {
    return isoTime;
  }
  const match = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) {
    return 0;
  }
  return new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0)
  ).getTime();
}

function generatePdfReport() {
  if (!state.summaryRows.length) {
    setStatus("Carregue um resumo com entradas antes de gerar o PDF.", "error");
    return;
  }

  const jsPdf = window.jspdf?.jsPDF;
  if (!jsPdf) {
    window.print();
    return;
  }

  const date = summaryDateEl.value || getTodayISO();
  const doc = new jsPdf({ orientation: "landscape", unit: "mm", format: "a4" });
  const title = `ETIQUETAS SAHMT - ${formatDate(date)}`;
  const rows = state.summaryRows.map((row, index) => [
    String(index + 1),
    row.nomePaciente || "",
    row.convenio || "-",
    row.cirurgia || "",
    row.atendimento || "",
    row.tipo || "",
    formatStoredCurrency(row.valor) || "-",
    row.credor || "",
    row.plantonistas || "",
    row.observacoes || "",
  ]);

  doc.setFillColor(11, 63, 58);
  doc.rect(0, 0, 297, 24, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text(title, 14, 15);
  doc.setFontSize(9);
  doc.text(`${state.summaryRows.length} entrada(s)`, 260, 15, { align: "right" });

  doc.autoTable({
    startY: 32,
    head: [["#", "Nome do Paciente", "Convênio", "Cirurgia", "Atendimento", "Tipo", "Valor", "Credor", "Plantonista(s)", "Observacoes"]],
    body: rows,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2.2, overflow: "linebreak" },
    headStyles: { fillColor: [11, 63, 58], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 46 },
      2: { cellWidth: 18 },
      3: { cellWidth: 22 },
      4: { cellWidth: 22 },
      5: { cellWidth: 18 },
      6: { cellWidth: 24 },
      7: { cellWidth: 30 },
      8: { cellWidth: 25 },
      9: { cellWidth: 48 },
    },
    didParseCell(data) {
      if (data.section === "body") {
        const row = state.summaryRows[data.row.index];
        if (isAlertType(row?.tipo)) {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [255, 241, 242];
        } else if (row?.resumoEdicao) {
          data.cell.styles.fillColor = [240, 253, 244];
        }
        if (data.column.index === 10 && row?.resumoEdicao) {
          data.cell.styles.textColor = [29, 78, 216];
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  doc.save(`etiquetas-sahmt-${date}.pdf`);
}

async function generateMonthlyPdfForWhatsApp() {
  const month = reportMonthEl.value;
  if (!month) {
    renderMonthlyStatus("Escolha um mes antes de gerar o PDF.", "error");
    setStatus("Escolha um mes antes de gerar o PDF mensal.", "error");
    return;
  }

  toggleBusy(true);
  setStatus("Gerando relatorio mensal em PDF...", "info");

  try {
    let rows = state.monthlyMonth === month ? state.monthlyRows : [];
    if (!rows.length) {
      rows = await loadMonthlyEntries(month);
      state.monthlyRows = rows;
      state.monthlyMonth = month;
      const alertCount = rows.filter((row) => isAlertType(row.tipo)).length;
      renderMonthlyStatus(`${rows.length} entrada(s) em ${formatMonth(month)}. ${alertCount} alerta(s).`, rows.length ? "success" : "neutral");
      renderMonthlyList(rows, "Nenhum registro encontrado para este mes.");
      if (!rows.length) {
        setStatus("Nenhuma entrada encontrada para o mes selecionado.", "error");
        return;
      }
    }

    const alertCount = rows.filter((row) => isAlertType(row.tipo)).length;
    renderMonthlyStatus(`${rows.length} entrada(s) em ${formatMonth(month)}. ${alertCount} alerta(s).`, rows.length ? "success" : "neutral");
    renderMonthlyList(rows, "Nenhum registro encontrado para este mes.");
    if (!rows.length) {
      setStatus("Nenhuma entrada encontrada para o mes selecionado.", "error");
      return;
    }

    const { blob, fileName, summaryText } = buildMonthlyPdf(rows, month);
    const file = new File([blob], fileName, { type: "application/pdf" });

    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({
          files: [file],
          title: `ETIQUETAS SAHMT - ${formatMonth(month)}`,
          text: summaryText,
        });
        setStatus("PDF mensal pronto para envio. Escolha o WhatsApp na tela de compartilhamento.", "success");
        return;
      } catch (shareError) {
        if (shareError.name === "AbortError") {
          setStatus("Compartilhamento cancelado.", "info");
          return;
        }
        throw shareError;
      }
    }

    setStatus("Este aparelho nao oferece compartilhamento direto de PDF. Abra o relatorio em um navegador atualizado e escolha WhatsApp na tela de compartilhamento.", "error");
  } catch (error) {
    setStatus(`Falha ao gerar relatorio mensal: ${error.message}`, "error");
  } finally {
    toggleBusy(false);
  }
}

function buildMonthlyPdfLegacy(rows, month) {
  const jsPdf = window.jspdf?.jsPDF;
  if (!jsPdf) {
    throw new Error("Biblioteca de PDF nao carregada.");
  }

  const doc = new jsPdf({ orientation: "landscape", unit: "mm", format: "a4" });
  const title = `ETIQUETAS SAHMT - RELATÓRIO MENSAL - ETIQUETAS - ${formatMonth(month)}`;
  const alertCount = rows.filter((row) => isAlertType(row.tipo)).length;
  const tableRows = rows.map((row, index) => [
    String(index + 1),
    formatDate(row.data || ""),
    row.nomePaciente || "",
    row.convenio || "-",
    row.cirurgia || "",
    row.atendimento || "",
    row.tipo || "",
    formatStoredCurrency(row.valor) || "-",
    row.credor || "",
    row.plantonistas || "-",
    row.criadoPor || "",
    row.editadoPor || "",
    row.resumoEdicao || "",
    row.observacoes || "",
  ]);

  doc.setFillColor(11, 63, 58);
  doc.rect(0, 0, 297, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text(title, 14, 15);
  doc.setFontSize(9);
  doc.text(`${rows.length} entrada(s) | ${alertCount} alerta(s)`, 280, 15, { align: "right" });

  doc.autoTable({
    startY: 34,
    head: [["#", "Data", "Nome do Paciente", "Convênio", "Cirurgia", "Atendimento", "Tipo", "Valor", "Credor", "Plantonista(s)", "Responsavel", "Editado por", "Alteracoes", "Observacoes"]],
    body: tableRows,
    theme: "striped",
    styles: {
      fontSize: 7.4,
      cellPadding: 2.2,
      overflow: "linebreak",
      valign: "middle",
      lineColor: [209, 223, 233],
      lineWidth: 0.12,
      textColor: [18, 48, 80],
    },
    headStyles: {
      fillColor: [13, 50, 87],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
    },
    alternateRowStyles: { fillColor: [237, 244, 249] },
    bodyStyles: { fillColor: [250, 252, 255] },
    columnStyles: {
      0: { cellWidth: 7 },
      1: { cellWidth: 15 },
      2: { cellWidth: 34 },
      3: { cellWidth: 16 },
      4: { cellWidth: 18 },
      5: { cellWidth: 16 },
      6: { cellWidth: 15 },
      7: { cellWidth: 20 },
      8: { cellWidth: 18 },
      9: { cellWidth: 18 },
      10: { cellWidth: 24 },
      11: { cellWidth: 22 },
      12: { cellWidth: 28 },
      13: { cellWidth: 18 },
    },
    didParseCell(data) {
      if (data.section === "body") {
        const row = rows[data.row.index];
        if (isAlertType(row?.tipo)) {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [255, 241, 242];
        } else if (row?.resumoEdicao) {
          data.cell.styles.fillColor = [240, 253, 244];
        }
        if (data.column.index === 12 && row?.resumoEdicao) {
          data.cell.styles.textColor = [29, 78, 216];
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  const fileName = `etiquetas-sahmt-${month}.pdf`;
  return {
    blob: doc.output("blob"),
    fileName,
    summaryText: `ETIQUETAS SAHMT - ${formatMonth(month)}\n${rows.length} entrada(s)\n${alertCount} alerta(s): Particular/Complementação`,
  };
}

function normalizePdfText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePdfText(value) {
  return normalizePdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function wrapPdfText(value, maxLength) {
  const text = normalizePdfText(value || "-");
  if (!text) {
    return ["-"];
  }
  if (text.length <= maxLength) {
    return [text];
  }

  const lines = [];
  let current = "";
  text.split(" ").forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) {
    lines.push(current);
  }
  return lines;
}

function createLabelsMonthlyPdfBlob(month, rows) {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginX = 32;
  const topY = 810;
  const bottomY = 46;
  const rowPaddingY = 8;
  const lineHeight = 11;
  const usableWidth = pageWidth - marginX * 2;
  const columns = [
    { label: "DATA / PACIENTE", width: 150, maxLength: 25 },
    { label: "CONVENIO / CIRURGIA / ATENDIMENTO", width: 150, maxLength: 25 },
    { label: "TIPO / VALOR / CREDOR", width: 125, maxLength: 20 },
    { label: "PLANTONISTA(S) / RESPONSAVEL", width: usableWidth - 425, maxLength: 18 },
  ];

  const addRect = (commands, x, y, width, height, fillColor, strokeColor, lineWidth = 1) => {
    if (fillColor) commands.push(`${fillColor.join(" ")} rg`);
    if (strokeColor) {
      commands.push(`${strokeColor.join(" ")} RG`);
      commands.push(`${lineWidth} w`);
    }
    commands.push(`${x} ${y} ${width} ${height} re ${fillColor && strokeColor ? "B" : fillColor ? "f" : "S"}`);
  };

  const addText = (commands, text, x, y, size, color, fontAlias) => {
    commands.push("BT");
    commands.push(`/${fontAlias} ${size} Tf`);
    commands.push(`${color.join(" ")} rg`);
    commands.push(`1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj`);
    commands.push("ET");
  };

  const alertCount = rows.filter((row) => isAlertType(row.tipo)).length;
  const records = rows.map((row) => ({
    dataPaciente: `Data: ${formatDate(row.data || "")}\nPaciente: ${row.nomePaciente || "-"}`,
    convenioCirurgia: `Convenio: ${row.convenio || "-"}\nCirurgia: ${row.cirurgia || "-"}\nAtendimento: ${row.atendimento || "-"}`,
    tipoValorCredor: `Tipo: ${row.tipo || "-"}\nValor: ${formatStoredCurrency(row.valor) || "-"}\nCredor: ${row.credor || "-"}`,
    plantonistaResponsavel: `Plantonista(s): ${row.plantonistas || "-"}\nResponsavel: ${row.criadoPor || "-"}${row.editadoPor ? `\nEditado por: ${row.editadoPor}` : ""}${row.observacoes ? `\nObservacao: ${row.observacoes}` : ""}`,
    alert: isAlertType(row.tipo),
  }));

  const drawPageFrame = (commands, pageNumber) => {
    addRect(commands, marginX, 756, usableWidth, 54, [0.05, 0.48, 0.42], null);
    addText(commands, "ETIQUETAS SAHMT", marginX + 18, 787, 20, [1, 1, 1], "F2");
    addText(commands, `Relatorio mensal de ${normalizePdfText(formatMonth(month))}`, marginX + 18, 768, 11, [0.92, 0.98, 0.97], "F1");
    addRect(commands, marginX, 724, usableWidth, 22, [0.95, 0.97, 0.95], [0.82, 0.86, 0.84], 0.8);
    addText(commands, `${rows.length} registro(s) | ${alertCount} alerta(s)`, marginX + 14, 731, 10, [0.08, 0.25, 0.22], "F2");
    addText(commands, `Pagina ${pageNumber}`, pageWidth - marginX - 52, 731, 10, [0.36, 0.42, 0.48], "F1");

    let cursorX = marginX;
    addRect(commands, marginX, 690, usableWidth, 24, [0.84, 0.91, 0.88], [0.72, 0.8, 0.77], 0.8);
    columns.forEach((column, index) => {
      if (index > 0) {
        commands.push("0.72 0.8 0.77 RG");
        commands.push("0.8 w");
        commands.push(`${cursorX} 690 m ${cursorX} 714 l S`);
      }
      addText(commands, column.label, cursorX + 8, 698, 8.1, [0.08, 0.25, 0.22], "F2");
      cursorX += column.width;
    });
  };

  const pages = [];
  let pageRows = [];
  let currentY = 684;
  records.forEach((record, index) => {
    const rowCells = columns.map((column, columnIndex) => wrapPdfText(record[Object.keys(record)[columnIndex]], column.maxLength));
    const maxLines = Math.max(...rowCells.map((lines) => lines.length));
    const rowHeight = rowPaddingY * 2 + maxLines * lineHeight;
    if (currentY - rowHeight < bottomY) {
      pages.push(pageRows);
      pageRows = [];
      currentY = 684;
    }
    pageRows.push({ index, y: currentY, height: rowHeight, cells: rowCells, alert: record.alert });
    currentY -= rowHeight;
  });
  if (pageRows.length || !pages.length) pages.push(pageRows);

  const objects = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontRegularId = 3;
  const fontBoldId = 4;
  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[fontRegularId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[fontBoldId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  const pageObjectIds = [];

  pages.forEach((pageRows, pageIndex) => {
    const commands = [];
    drawPageFrame(commands, pageIndex + 1);
    pageRows.forEach((row) => {
      const rowBottom = row.y - row.height;
      const fillColor = row.alert ? [1, 0.95, 0.95] : row.index % 2 === 0 ? [0.985, 0.985, 0.98] : [0.955, 0.965, 0.972];
      addRect(commands, marginX, rowBottom, usableWidth, row.height, fillColor, [0.86, 0.88, 0.9], 0.8);
      let cellX = marginX;
      row.cells.forEach((cellLines, cellIndex) => {
        if (cellIndex > 0) {
          commands.push("0.86 0.88 0.9 RG");
          commands.push("0.8 w");
          commands.push(`${cellX} ${rowBottom} m ${cellX} ${row.y} l S`);
        }
        cellLines.forEach((line, lineIndex) => {
          addText(commands, line, cellX + 8, row.y - rowPaddingY - 9 - lineIndex * lineHeight, 8.7, row.alert ? [0.62, 0.08, 0.08] : [0.12, 0.16, 0.22], lineIndex === 0 ? "F2" : "F1");
        });
        cellX += columns[cellIndex].width;
      });
    });
    const stream = commands.join("\n");
    const contentId = objects.length;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    const pageId = objects.length + 1;
    objects[pageId] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageObjectIds.push(pageId);
  });
  objects[pagesId] = `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.join(" ")}] >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = pdf.length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function buildMonthlyPdf(rows, month) {
  const jsPdf = window.jspdf?.jsPDF;
  if (!jsPdf) {
    throw new Error("Biblioteca de PDF nao carregada.");
  }

  const toneA = [36, 78, 112];
  const toneB = [93, 104, 128];
  const alertTone = [133, 77, 14];
  const doc = new jsPdf({ orientation: "landscape", unit: "mm", format: "a4" });
  if (typeof doc.autoTable !== "function") {
    throw new Error("Plugin de tabela PDF nao carregado.");
  }
  const optionalPdfColumns = [
    ["Convênio", (row) => row.convenio],
    ["Cirurgia", (row) => row.cirurgia],
    ["Atendimento", (row) => row.atendimento],
    ["Tipo", (row) => row.tipo],
    ["Valor", (row) => row.valor ? formatStoredCurrency(row.valor) : ""],
    ["Credor", (row) => row.credor],
    ["Plantonista(s)", (row) => row.plantonistas],
    ["Observações", (row) => row.observacoes],
  ].filter(([, getValue]) => rows.some((row) => String(getValue(row) || "").trim()));
  const pdfColumns = [
    ["#", (row, index) => String(index + 1)],
    ["Data", (row) => formatDate(row.data || "")],
    ["Nome do Paciente", (row) => row.nomePaciente],
    ...optionalPdfColumns,
  ];
  const body = rows.map((row, index) => pdfColumns.map(([, getValue]) => getValue(row, index) || ""));
  const dateGroups = [];
  const dateGroupByRow = rows.map((row) => {
    const dateKey = normalizeDateKey(row.data) || String(row.data || "").trim();
    let group = dateGroups.find((item) => item.key === dateKey);
    if (!group) {
      group = { key: dateKey, index: dateGroups.length, rowCount: 0 };
      dateGroups.push(group);
    }
    const rowInGroup = group.rowCount;
    group.rowCount += 1;
    return { groupIndex: group.index, rowInGroup };
  });
  const dateColumnIndex = pdfColumns.findIndex(([label]) => label === "Data");

  doc.setFillColor(11, 63, 58);
  doc.rect(0, 0, 297, 24, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("ETIQUETAS SAHMT", 14, 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Relatorio mensal de ${formatMonth(month)}`, 14, 18);

  doc.autoTable({
    startY: 30,
    head: [pdfColumns.map(([label]) => label)],
    body,
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2, overflow: "linebreak", textColor: [31, 41, 55] },
    headStyles: { fillColor: [11, 63, 58], textColor: [255, 255, 255], fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: [244, 248, 252] },
    columnStyles: { 0: { cellWidth: 8, halign: "center" }, 1: { cellWidth: 20 }, 2: { cellWidth: 45 } },
    didParseCell(data) {
      if (data.section === "body") {
        const row = rows[data.row.index];
        const group = dateGroupByRow[data.row.index] || { groupIndex: 0, rowInGroup: 0 };
        const dateFills = [[189, 224, 235], [208, 231, 216], [244, 218, 181], [218, 216, 241]];
        const rowFills = [[248, 252, 250], [242, 247, 252]];
        data.cell.styles.textColor = data.column.index === dateColumnIndex
          ? [36, 78, 112]
          : (group.rowInGroup % 2 === 0 ? toneA : toneB);
        data.cell.styles.fillColor = data.column.index === dateColumnIndex
          ? dateFills[group.groupIndex % dateFills.length]
          : rowFills[group.rowInGroup % rowFills.length];
        if (data.column.index === dateColumnIndex) {
          data.cell.styles.fontStyle = "bold";
        }
        if (isAlertType(row?.tipo)) {
          data.cell.styles.textColor = alertTone;
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [255, 248, 235];
        } else if (row?.resumoEdicao) {
          data.cell.styles.fillColor = [255, 237, 213];
        }
      }
    },
  });

  return {
    blob: doc.output("blob"),
    fileName: `etiquetas-sahmt-${month}.pdf`,
    summaryText: `ETIQUETAS SAHMT - ${formatMonth(month)}`,
  };
}

function openWhatsAppUrl(url, preOpenedWindow) {
  if (preOpenedWindow && !preOpenedWindow.closed) {
    preOpenedWindow.location.href = url;
    return;
  }

  const opened = window.open(url, "_blank", "noopener");
  if (!opened) {
    window.location.href = url;
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function resetForm(options = {}) {
  const selectedDate = options.keepDate || fields.data.value || getTodayISO();
  formEl.reset();
  fields.data.value = options.keepDate ? selectedDate : getTodayISO();
  clearPlantonistasSelection();
  syncPlantonistasRequirement();
  syncConditionalEntryFields();
  updateEntryValidationStates();
  setSendFeedback("", "neutral");

  if (!options.keepImage) {
    clearImage();
  }

    if (options.hideEntry !== false) {
    hideEntryPanel();
  }
}

function clearImage() {
  if (state.imageUrl) {
    URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = "";
  }

  state.imageBlob = null;
  resetScannerView();
  document.querySelector("#process-image").disabled = true;
}

function setStatus(message, tone) {
  processingStatusEl.textContent = message;
  processingStatusEl.dataset.tone = tone;
}

function toggleBusy(isBusy) {
  document.querySelectorAll("button, input[type='file'], select, input, textarea").forEach((element) => {
    if (element.id === "clear-form" || element.id === "save-settings" || element.id === "script-url") {
      return;
    }
    element.disabled = isBusy;
  });

  if (!isBusy) {
    document.querySelector("#capture-image").disabled = false;
    document.querySelector("#process-image").disabled = !state.imageBlob;
    document.querySelector("#open-manual-entry").disabled = false;
    syncPlantonistasRequirement();
  }
}

function isAlertType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalized === "particular" || normalized === "complementacao";
}

function normalizeTipoValue(value) {
  const text = String(value || "").trim();
  const normalized = normalizeCompare(text);
  if (normalized === "consulta pre-anestesica" || normalized === "consulta pre anestesica") {
    return CONSULTA_TYPE;
  }
  if (normalized === "particular") return "Particular";
  if (normalized === "complementacao") return "Complementação";
  if (normalized === "convenio") return "Convênio";
  if (normalized === "sadt") return SADT_TYPE;
  return text;
}

function shouldRequireValor(value) {
  const normalized = normalizeCompare(value);
  return FINANCIAL_TYPES.has(normalized);
}

function shouldRequireConvenio(value) {
  return normalizeTipoValue(value) !== CONSULTA_TYPE;
}

function formatCurrencyInput(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  const numeric = Number(
    text
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".")
  );

  if (!Number.isFinite(numeric)) {
    return text;
  }

  return numeric.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatStoredCurrency(value) {
  const text = String(value ?? "").trim();
  return text ? formatCurrencyInput(text) : "";
}

function syncPlantonistasRequirement() {
  const isCaixa = fields.credor.value.trim() === CREDOR_CAIXA;
  fields.plantonistas.disabled = isCaixa;
  fields.plantonistas.required = !isCaixa;

  if (plantonistasUi.button) {
    plantonistasUi.button.disabled = isCaixa;
  }

  plantonistasUi.checks.forEach((checkbox) => {
    checkbox.disabled = isCaixa;
  });

  if (isCaixa) {
    clearPlantonistasSelection();
    closePlantonistasPicker();
  }
}

function setupPlantonistasPicker() {
  if (plantonistasUi.wrapper) {
    return;
  }

  const options = Array.from(fields.plantonistas.options).filter((option) => option.value);
  fields.plantonistas.classList.add("native-multi-hidden");

  const wrapper = document.createElement("div");
  wrapper.id = "plantonistas-picker";
  wrapper.className = "multi-select";

  const button = document.createElement("button");
  button.id = "plantonistas-toggle";
  button.type = "button";
  button.className = "multi-select-toggle";
  button.setAttribute("aria-label", "Selecionar plantonistas");
  button.setAttribute("aria-expanded", "false");
  button.textContent = "";

  const panel = document.createElement("div");
  panel.id = "plantonistas-options";
  panel.className = "multi-select-options";
  panel.hidden = true;

  const checks = options.map((option) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = option.value;
    checkbox.addEventListener("change", syncPlantonistasFromCheckboxes);
    label.append(checkbox, document.createTextNode(` ${option.textContent.trim()}`));
    panel.append(label);
    return checkbox;
  });

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (button.disabled) {
      return;
    }
    const isOpen = !panel.hidden;
    panel.hidden = isOpen;
    button.setAttribute("aria-expanded", String(!isOpen));
  });

  panel.addEventListener("click", (event) => event.stopPropagation());
  wrapper.append(button, panel);
  fields.plantonistas.insertAdjacentElement("afterend", wrapper);

  plantonistasUi.wrapper = wrapper;
  plantonistasUi.button = button;
  plantonistasUi.panel = panel;
  plantonistasUi.checks = checks;
  syncPlantonistasFromCheckboxes();
}

function syncPlantonistasFromCheckboxes() {
  const selected = plantonistasUi.checks
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);

  Array.from(fields.plantonistas.options).forEach((option) => {
    option.selected = selected.includes(option.value);
  });

  if (plantonistasUi.button) {
    plantonistasUi.button.textContent = selected.length ? selected.join(", ") : "";
    plantonistasUi.button.classList.toggle("has-selection", selected.length > 0);
  }

  updateEntryValidationStates();
}

function getSelectedPlantonistasValue() {
  return Array.from(fields.plantonistas.selectedOptions)
    .map((option) => option.value.trim())
    .filter(Boolean)
    .join(", ");
}

function setSelectedPlantonistasFromValue(value) {
  const selected = String(value || "")
    .split(/[,;]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  plantonistasUi.checks.forEach((checkbox) => {
    checkbox.checked = selected.includes(checkbox.value.toUpperCase());
  });
  Array.from(fields.plantonistas.options).forEach((option) => {
    option.selected = selected.includes(option.value.toUpperCase());
  });
  syncPlantonistasFromCheckboxes();
}

function clearPlantonistasSelection() {
  plantonistasUi.checks.forEach((checkbox) => {
    checkbox.checked = false;
  });
  Array.from(fields.plantonistas.options).forEach((option) => {
    option.selected = false;
  });
  syncPlantonistasFromCheckboxes();
}

function closePlantonistasPicker() {
  if (!plantonistasUi.panel) {
    return;
  }

  plantonistasUi.panel.hidden = true;
  plantonistasUi.button?.setAttribute("aria-expanded", "false");
}

function closePlantonistasPickerOnOutsideClick(event) {
  if (!plantonistasUi.wrapper || plantonistasUi.wrapper.contains(event.target)) {
    return;
  }

  closePlantonistasPicker();
}

function getTodayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function normalizeDateKey(value) {
  const text = String(value || "").trim();
  const brMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  }

  return text;
}

function formatMonth(value) {
  if (!value) {
    return "";
  }
  const [year, month] = value.split("-");
  return `${month}/${year}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeCompare(value) {
  return normalizeSearch(value).replace(/\s+/g, " ");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

window.addEventListener("beforeunload", () => {
  stopCamera();
  if (state.worker) {
    state.worker.terminate();
  }
});

document.addEventListener("sahmt:hide", stopCamera);

}
