export async function mount(ctx){
const {Services,localStorage,sessionStorage,document,window,navigator,location,history,fetch,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame,cancelAnimationFrame}=ctx;

(async function () {
  const fallbackData = window.SAHMT_DATA;
  const contactsPayload = window.SAHMT_CONTACTS;
  const fallbackNoticesPayload = {
    activeId: "aviso-seguranca",
    notices: [
      {
        id: "aviso-seguranca",
        eyebrow: "Comunicado SAHMT",
        title: "Aviso SAHMT",
        message: "A configuracao de avisos precisa ser revisada no arquivo notices.js."
      }
    ]
  };
  const noticesPayload = window.SAHMT_NOTICES || fallbackNoticesPayload;
  // Temporarily keep the home screen immediate while the opening notice is reviewed.
  const openingNoticeEnabled = false;
  const skipOpeningNotice = !openingNoticeEnabled || new URLSearchParams(window.location.search).get("skipNotice") === "1";

  const siglaPattern = /(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*/g;
  const contacts = Array.isArray(contactsPayload?.records) ? contactsPayload.records : [];
  const contactsBySigla = new Map(contacts.map((contact) => [contact.sigla, contact]));
  const siglaAliases = new Map([
    ["DC", ["AD", "CR", "LA", "LH"]]
  ]);
  const dcAliasesByWeekday = Services.dcAliasesByWeekday;
  const scheduleSpreadsheetId = "";
  const scheduleSheetSources = [];
  const vacationSheetTitle = "";
  const defaultSiteUrl = fallbackData?.siteUrl || "https://sites.google.com/view/sahmt/in%C3%ADcio";
  const managementSiteUrl = "./apps/gestao/";
  const eventsUrl = "./apps/eventos/";
  const labelsUrl = "./apps/etiquetas/";
  const RELEASE_AUTHORIZED_EMAILS = new Set();
  const syncConfig = {pollIntervalMs:20000};
  const siglaStateStorageKey = "sahmt-sigla-release-v2";
  const clientIdStorageKey = "sahmt-client-id-v1";
  const sharedStateEndpoint = "central-service";
  const syncPollIntervalMs = Number(syncConfig.pollIntervalMs) > 0 ? Number(syncConfig.pollIntervalMs) : 20000;
  const sharedPendingTtlMs = Number(syncConfig.pendingTtlMs) > 0 ? Number(syncConfig.pendingTtlMs) : 180000;
  const scheduleCacheStorageKey = "sahmt-scale-schedule-cache-v1";

  const todayKey = formatKey(new Date());
  const siglaCheckState = loadSiglaCheckState();
  const clientId = getOrCreateClientId();
  let data = null;
  let byDate = new Map();
  let orderedDates = [];
  let deferredInstallPrompt = null;
  let activeContactToken = "";
  let activeContactWeekday = "";
  let sharedStateHash = serializeSiglaState(siglaCheckState);
  let sharedStateTimer = null;
  const pendingSharedUpdates = new Map();

  const elements = {
    dateInput: document.getElementById("dateInput"),
    prevButton: document.getElementById("prevButton"),
    todayButton: document.getElementById("todayButton"),
    nextButton: document.getElementById("nextButton"),
    installButton: document.getElementById("installButton"),
    pageShell: document.querySelector(".page-shell"),
    appFrame: document.querySelector(".app-frame"),
    emptyState: document.getElementById("emptyState"),
    siglasGrid: document.getElementById("siglasGrid"),
    eventsLauncher: document.getElementById("eventsLauncher"),
    eventsModal: document.getElementById("eventsModal"),
    eventsBackdrop: document.getElementById("eventsBackdrop"),
    closeEventsModal: document.getElementById("closeEventsModal"),
    eventsFrame: document.getElementById("eventsFrame"),
    labelsLauncher: document.getElementById("labelsLauncher"),
    checklistLauncher: document.getElementById("checklistLauncher"),
    trainingLauncher: document.getElementById("trainingLauncher"),
    labelsModal: document.getElementById("labelsModal"),
    labelsBackdrop: document.getElementById("labelsBackdrop"),
    closeLabelsModal: document.getElementById("closeLabelsModal"),
    labelsFrame: document.getElementById("labelsFrame"),
    managementModal: document.getElementById("managementModal"),
    managementBackdrop: document.getElementById("managementBackdrop"),
    closeManagementModal: document.getElementById("closeManagementModal"),
    managementFrame: document.getElementById("managementFrame"),
    contactModal: document.getElementById("contactModal"),
    contactBackdrop: document.getElementById("contactBackdrop"),
    closeContactModal: document.getElementById("closeContactModal"),
    contactKicker: document.getElementById("contactKicker"),
    contactTitle: document.getElementById("contactTitle"),
    contactSummary: document.getElementById("contactSummary"),
    contactList: document.getElementById("contactList"),
    noticeModal: document.getElementById("noticeModal"),
    noticeEyebrow: document.getElementById("noticeEyebrow"),
    noticeTitle: document.getElementById("noticeTitle"),
    noticeMessage: document.getElementById("noticeMessage"),
    noticeMedia: document.getElementById("noticeMedia"),
    noticeCountdown: document.getElementById("noticeCountdown"),
    closeNoticeModal: document.getElementById("closeNoticeModal")
  };

  // Start the public spreadsheet read while the shared authentication surface
  // restores the trusted device.
  const scheduleWarmupPromise = loadScheduleDataWithTimeout(12000).catch(() => null);

  // Render the local schedule immediately; authentication continues in the background.
  // This prevents a slow session restore from leaving the main page blank.
  ensureSharedAccess().catch((error) => console.warn("Falha na autenticacao inicial:", error));
  window.SAHMT_AUTH?.onChange?.(() => {
    if (activeContactToken && !elements.contactModal.classList.contains("hidden")) {
      openTokenDetails(activeContactToken, activeContactWeekday);
    }
  });

  if (elements.closeNoticeModal) {
    elements.closeNoticeModal.addEventListener("click", closeNoticeModal);
  }

  showOpeningNotice();

  data = loadScheduleCache() || fallbackData;

  if (!data || !Array.isArray(data.days) || data.days.length === 0) {
    try {
      data = await loadScheduleDataWithTimeout(6000);
    } catch (error) {
      throw new Error("Dados da escala nao encontrados.");
    }
  }

  applyScheduleData(data);
  const fallbackDate = clampKey(todayKey);
  elements.dateInput.value = clampKey(fallbackDate);

  // Shared highlights must never delay the local schedule display.

  elements.dateInput.addEventListener("change", () => {
    render(clampKey(elements.dateInput.value));
  });

  elements.prevButton.addEventListener("click", () => {
    render(shiftDate(elements.dateInput.value, -1));
  });

  elements.nextButton.addEventListener("click", () => {
    render(shiftDate(elements.dateInput.value, 1));
  });

  enableDateSwipeNavigation(elements.siglasGrid, (delta) => {
    render(shiftDate(elements.dateInput.value, delta));
  });

  elements.todayButton.addEventListener("click", () => {
    render(clampKey(todayKey));
  });

  if (elements.installButton) {
    elements.installButton.addEventListener("click", async () => {
      if (!deferredInstallPrompt) {
        return;
      }

      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      elements.installButton.classList.add("hidden");
    });
  }

  if (elements.closeContactModal) {
    elements.closeContactModal.addEventListener("click", closeContactModal);
  }

  if (elements.eventsLauncher) {
    elements.eventsLauncher.addEventListener("click", openEventsModal);
  }

  if (elements.labelsLauncher) {
    elements.labelsLauncher.addEventListener("click", (event) => {
      event.preventDefault();
      openLabelsModal();
    });
  }

  if (elements.checklistLauncher) {
    elements.checklistLauncher.addEventListener("click", () => {
      window.openArsenalChecklist?.().catch((error) => console.warn("Falha ao abrir Checklist:", error));
    });
  }

  if (elements.trainingLauncher) {
    elements.trainingLauncher.addEventListener("click", () => {
      openTraining().catch((error) => console.warn("Falha ao abrir Treinamentos:", error));
    });
  }
  if (elements.closeEventsModal) {
    elements.closeEventsModal.addEventListener("click", closeEventsModal);
  }

  if (elements.eventsBackdrop) {
    elements.eventsBackdrop.addEventListener("click", closeEventsModal);
  }

  if (elements.closeLabelsModal) {
    elements.closeLabelsModal.addEventListener("click", closeLabelsModal);
  }

  if (elements.labelsBackdrop) {
    elements.labelsBackdrop.addEventListener("click", closeLabelsModal);
  }

  if (elements.closeManagementModal) {
    elements.closeManagementModal.addEventListener("click", closeManagementModal);
  }

  if (elements.managementBackdrop) {
    elements.managementBackdrop.addEventListener("click", closeManagementModal);
  }

  if (elements.contactBackdrop) {
    elements.contactBackdrop.addEventListener("click", closeContactModal);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeEventsModal();
      closeLabelsModal();
      closeManagementModal();
      closeContactModal();
    }
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (elements.installButton) {
      elements.installButton.classList.remove("hidden");
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (elements.installButton) {
      elements.installButton.classList.add("hidden");
    }
  });

  window.addEventListener("resize", requestViewportFit);
  window.addEventListener("orientationchange", requestViewportFit);
  window.visualViewport?.addEventListener("resize", requestViewportFit);

  ;

  render(elements.dateInput.value);
  refreshScheduleFromSheet(scheduleWarmupPromise);
  hydrateSharedSiglaState().then(()=>render(elements.dateInput.value)).catch(()=>{});
  document.addEventListener('sahmt:show',()=>{refreshScheduleFromSheet();hydrateSharedSiglaState().then(()=>render(elements.dateInput.value)).catch(()=>{});});

  async function ensureSharedAccess() {
    if (!window.SAHMT_AUTH?.requireAccess) {
      return;
    }

    await window.SAHMT_AUTH.requireAccess({
      moduleId: "SAHMT",
      pageId: "home",
      returnUrl: window.location.href
    });
  }

  function applyScheduleData(scheduleData) {
    data = scheduleData;
    byDate = new Map(data.days.map((day) => [day.date, day]));
    orderedDates = data.days.map((day) => day.date).sort();
    elements.dateInput.min = orderedDates[0];
    elements.dateInput.max = orderedDates[orderedDates.length - 1];
  }

  function refreshScheduleFromSheet(warmupPromise = null) {
    (warmupPromise || loadScheduleDataWithTimeout(12000))
      .then((liveData) => {
        if (!Array.isArray(liveData?.days) || !liveData.days.length) {
          return;
        }

        const selectedDate = elements.dateInput.value;
        saveScheduleCache(liveData);
        applyScheduleData(liveData);
        render(clampKey(selectedDate));
      })
      .catch(() => {});
  }

  function loadScheduleCache(){return null;}

  function saveScheduleCache(){}

  function render(dateKey) {
    elements.dateInput.value = dateKey;
    const day = byDate.get(dateKey);
    elements.todayButton.textContent = `HOJE\n${(day?.weekdayLabel || getWeekdayLabel(dateKey)).toUpperCase()}`;

    if (!day) {
      elements.emptyState.classList.remove("hidden");
      elements.siglasGrid.innerHTML = "";
      requestViewportFit();
      return;
    }

    elements.emptyState.classList.add("hidden");
    renderSiglas(day.siglas, day.weekdayLabel);
    requestViewportFit();
  }

  function requestViewportFit() {
    window.requestAnimationFrame(fitAppToViewport);
  }

  function fitAppToViewport() {
    const shell = elements.pageShell;
    const frame = elements.appFrame;
    if (!shell || !frame || document.body.classList.contains("modal-open")) {
      return;
    }

    frame.style.setProperty("--app-scale", "1");
    const shellStyle = window.getComputedStyle(shell);
    const availableHeight = shell.clientHeight
      - Number.parseFloat(shellStyle.paddingTop)
      - Number.parseFloat(shellStyle.paddingBottom);
    const contentHeight = frame.scrollHeight;
    const scale = contentHeight > 0 ? Math.min(1, availableHeight / contentHeight) : 1;

    frame.style.setProperty("--app-scale", String(Math.max(0, scale)));
  }

  function renderSiglas(siglas, weekdayLabel) {
    elements.siglasGrid.innerHTML = "";
    const totalItems = siglas.length + 1;
    const columnCount = totalItems <= 15 ? 5 : 6;
    const rowCount = Math.ceil(totalItems / columnCount);
    elements.siglasGrid.style.setProperty("--sigla-columns", String(columnCount));
    elements.siglasGrid.style.setProperty("--sigla-rows", String(rowCount));
    const activeDate = elements.dateInput.value;
    const vacationSiglas = getVacationSiglasForDate(activeDate);
    const vacationOrder = getVacationOrderForDate(activeDate);
    const scheduledVacationSiglas = getScheduledVacationSiglas(siglas, vacationSiglas);
    const showVacationPositions = scheduledVacationSiglas.size > 1;

    siglas.forEach((sigla, index) => {
      const item = document.createElement("div");
      item.className = "sigla-item";

      const token = document.createElement("button");
      token.className = "sigla-token sigla-button";
      token.type = "button";
      token.setAttribute("aria-label", `Abrir contato da sigla ${sigla}.`);
      token.title = "Abrir contato";
      bindSiglaInteractions(token, sigla, weekdayLabel);

      const dcVacationSiglas = getDcVacationSiglas(sigla, vacationSiglas, weekdayLabel);
      if (sigla === "DC") {
        appendDcReleaseDisplay(token, dcAliasesByWeekday.get(weekdayLabel) || siglaAliases.get("DC") || [], activeDate);
      } else if (dcVacationSiglas.length >= 2) {
        appendStackedDcDisplay(token, dcVacationSiglas, vacationOrder, showVacationPositions);
      } else {
        appendSiglaDisplay(token, sigla, vacationSiglas, vacationOrder, showVacationPositions, activeDate);

        if (dcVacationSiglas.length) {
          token.appendChild(document.createTextNode(" - "));
          token.appendChild(
            createVacationSiglaNode(
              dcVacationSiglas[0],
              "dc-vacation-sigla",
              getVacationPosition(dcVacationSiglas[0], vacationOrder, showVacationPositions)
            )
          );
        }
      }
      if (isWholeSiglaOnVacation(sigla, vacationSiglas)) {
        token.classList.add("sigla-token--vacation");
      }

      if (isSiglaChecked(activeDate, sigla)) {
        token.classList.add("sigla-token--checked");
        token.setAttribute("aria-pressed", "true");
      }

      const counter = document.createElement("div");
      counter.className = "sigla-index";
      counter.textContent = String(index + 1);

      item.appendChild(token);
      item.appendChild(counter);
      elements.siglasGrid.appendChild(item);
    });

    const offlineItem = document.createElement("div");
    offlineItem.className = "sigla-item sigla-item--offline";

    const offlineLink = document.createElement("a");
    offlineLink.className = "sigla-token sigla-button offline-sigla";
    offlineLink.href = "./escala-ferias-imagens.html";
    offlineLink.textContent = "OFF LINE";
    offlineLink.setAttribute("aria-label", "Abrir escala e ferias em modo off line");
    offlineLink.title = "Abrir escala e ferias sem conexão";

    const offlineCounter = document.createElement("div");
    offlineCounter.className = "sigla-index";
    offlineCounter.textContent = String(siglas.length + 1);

    offlineItem.appendChild(offlineLink);
    offlineItem.appendChild(offlineCounter);
    elements.siglasGrid.appendChild(offlineItem);
  }

  function bindSiglaInteractions(token, sigla, weekdayLabel) {
    token.addEventListener("click", () => openTokenDetails(sigla, weekdayLabel));
    token.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openTokenDetails(sigla, weekdayLabel);
      }
    });
  }

  function canReleaseSiglas(){return Services.permission("events");}

  async function releaseContactForDate(button, contact, token, activeDate, groupContacts) {
    if (!canReleaseSiglas() || !contact?.sigla || !activeDate) {
      return;
    }

    const marked = !isSiglaChecked(activeDate, contact.sigla);
    const tokenWasMarked = isSiglaChecked(activeDate, token);
    const tokenMarked = groupContacts.every((groupContact) =>
      groupContact.sigla === contact.sigla ? marked : isSiglaChecked(activeDate, groupContact.sigla)
    );

    button.disabled = true;
    updateSiglaCheckState(activeDate, contact.sigla, marked);
    updateSiglaCheckState(activeDate, token, tokenMarked);
    persistSiglaCheckState();
    render(activeDate);

    if (!sharedStateEndpoint) {
      button.disabled = false;
      return;
    }

    try {
      const contactState = await pushSharedSiglaCheck(activeDate, contact.sigla, marked);
      if (tokenMarked !== tokenWasMarked) {
        await pushSharedSiglaCheck(activeDate, token, tokenMarked);
      }
      if (contactState) {
        replaceSiglaCheckState(contactState);
      }
    } catch (error) {
      // Keep the local toggle when the shared endpoint is temporarily unavailable.
    } finally {
      button.disabled = false;
      button.classList.toggle("contact-card__release--released", marked);
    }
  }  function isSiglaChecked(dateKey, sigla) {
    return Array.isArray(siglaCheckState[dateKey]) && siglaCheckState[dateKey].includes(sigla);
  }

  function loadSiglaCheckState() {
    try {
      const raw = window.localStorage.getItem(siglaStateStorageKey);

      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveSiglaCheckState() {
    try {
      window.localStorage.setItem(siglaStateStorageKey, JSON.stringify(siglaCheckState));
    } catch (error) {
      // Ignore storage failures to avoid blocking the UI on restricted browsers.
    }
  }

  function updateSiglaCheckState(dateKey, sigla, marked) {
    if (marked) {
      if (!Array.isArray(siglaCheckState[dateKey])) {
        siglaCheckState[dateKey] = [];
      }

      if (!siglaCheckState[dateKey].includes(sigla)) {
        siglaCheckState[dateKey].push(sigla);
      }
    } else if (Array.isArray(siglaCheckState[dateKey])) {
      siglaCheckState[dateKey] = siglaCheckState[dateKey].filter((value) => value !== sigla);

      if (siglaCheckState[dateKey].length === 0) {
        delete siglaCheckState[dateKey];
      }
    }
  }

  function persistSiglaCheckState() {
    sharedStateHash = serializeSiglaState(siglaCheckState);
    saveSiglaCheckState();
  }

  async function hydrateSharedSiglaState() {
    if (!sharedStateEndpoint) {
      return;
    }

    try {
      const remoteState = await fetchSharedSiglaState();
      if (remoteState) {
        replaceSiglaCheckState(remoteState);
      }
      startSharedStatePolling();
    } catch (error) {
      // If the endpoint is not configured or temporarily unavailable, keep local behavior.
    }
  }

  function startSharedStatePolling() {
    if (!sharedStateEndpoint || sharedStateTimer) {
      return;
    }

    sharedStateTimer = window.setInterval(async () => {
      try {
        const remoteState = await fetchSharedSiglaState();
        const mergedState = mergeSharedState(remoteState);
        const nextHash = serializeSiglaState(mergedState);

        if (nextHash && nextHash !== sharedStateHash) {
          replaceSiglaCheckState(mergedState);
          render(elements.dateInput.value);
        }
      } catch (error) {
        // Polling should fail silently to avoid interrupting the app UX.
      }
    }, syncPollIntervalMs);
  }

  async function fetchSharedSiglaState(){return normalizeSharedState(await Services.highlights());}

  async function pushSharedSiglaCheck(dateKey,sigla,marked){return normalizeSharedState(await Services.mark(dateKey,sigla,marked));}

  function replaceSiglaCheckState(nextState) {
    const mergedState = mergeSharedState(nextState);
    Object.keys(siglaCheckState).forEach((key) => delete siglaCheckState[key]);
    Object.entries(mergedState).forEach(([dateKey, siglas]) => {
      siglaCheckState[dateKey] = siglas;
    });
    persistSiglaCheckState();
  }

  function normalizeSharedState(rawState) {
    if (!rawState || typeof rawState !== "object") {
      return {};
    }

    return Object.entries(rawState).reduce((accumulator, [dateKey, siglas]) => {
      const normalizedDateKey = normalizeRemoteSharedDateKey(dateKey);
      if (!normalizedDateKey) {
        return accumulator;
      }

      if (!Array.isArray(siglas)) {
        return accumulator;
      }

      const normalizedSiglas = Array.from(
        new Set(
          siglas
            .map((value) => String(value || "").trim())
            .filter(Boolean)
        )
      );

      if (normalizedSiglas.length) {
        accumulator[normalizedDateKey] = normalizedSiglas;
      }

      return accumulator;
    }, {});
  }

  function serializeSiglaState(state) {
    return JSON.stringify(
      Object.keys(state || {})
        .sort()
        .reduce((accumulator, dateKey) => {
          accumulator[dateKey] = [...(state[dateKey] || [])].sort();
          return accumulator;
        }, {})
    );
  }

  function registerPendingSharedUpdate(dateKey, sigla, marked) {
    pendingSharedUpdates.set(buildPendingKey(dateKey, sigla), {
      dateKey,
      sigla,
      marked,
      createdAt: Date.now()
    });
  }

  function mergeSharedState(rawState) {
    const baseState = normalizeSharedState(rawState);
    const now = Date.now();

    pendingSharedUpdates.forEach((entry, key) => {
      if (now - entry.createdAt > sharedPendingTtlMs) {
        pendingSharedUpdates.delete(key);
        return;
      }

      const isReflected = entry.marked
        ? stateHasSigla(baseState, entry.dateKey, entry.sigla)
        : !stateHasSigla(baseState, entry.dateKey, entry.sigla);

      if (isReflected) {
        pendingSharedUpdates.delete(key);
        return;
      }

      if (entry.marked) {
        if (!Array.isArray(baseState[entry.dateKey])) {
          baseState[entry.dateKey] = [];
        }

        if (!baseState[entry.dateKey].includes(entry.sigla)) {
          baseState[entry.dateKey].push(entry.sigla);
          baseState[entry.dateKey].sort();
        }
      } else if (Array.isArray(baseState[entry.dateKey])) {
        baseState[entry.dateKey] = baseState[entry.dateKey].filter((value) => value !== entry.sigla);
        if (baseState[entry.dateKey].length === 0) {
          delete baseState[entry.dateKey];
        }
      }
    });

    return baseState;
  }

  function stateHasSigla(state, dateKey, sigla) {
    return Array.isArray(state[dateKey]) && state[dateKey].includes(sigla);
  }

  function buildPendingKey(dateKey, sigla) {
    return `${dateKey}::${String(sigla || "").toUpperCase()}`;
  }

  function normalizeRemoteSharedDateKey(value) {
    const text = String(value || "").trim();
    if (!text) {
      return "";
    }

    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      return text;
    }

    const brMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }

    return formatKey(parsed);
  }

  function getOrCreateClientId() {
    try {
      const stored = window.localStorage.getItem(clientIdStorageKey);
      if (stored) {
        return stored;
      }

      const created = `client-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(clientIdStorageKey, created);
      return created;
    } catch (error) {
      return `client-${Date.now()}`;
    }
  }

  function normalizeEndpoint(value) {
    const trimmed = String(value || "").trim();
    return trimmed || "";
  }

  function getVacationSiglasForDate(dateKey) {
    return new Set(getVacationOrderForDate(dateKey));
  }

  function getVacationOrderForDate(dateKey) {
    const label = String(byDate.get(dateKey)?.vacationLabel || "");
    // The vacation ranking is written before the optional note in parentheses.
    return extractSiglas(label.split("(")[0]);
  }

  function getVacationPosition(sigla, vacationOrder, showVacationPositions) {
    if (!showVacationPositions || !Array.isArray(vacationOrder) || vacationOrder.length < 2) {
      return 0;
    }

    const index = vacationOrder.indexOf(sigla);
    return index === -1 ? 0 : index + 1;
  }

  function getScheduledVacationSiglas(siglas, vacationSiglas) {
    const scheduled = new Set();

    siglas.forEach((sigla) => {
      extractSiglas(sigla).forEach((part) => {
        if (vacationSiglas.has(part)) {
          scheduled.add(part);
        }
      });
    });

    return scheduled;
  }

  function appendSiglaDisplay(token, sigla, vacationSiglas, vacationOrder, showVacationPositions, activeDate) {
    const parts = String(sigla || "").toUpperCase().split(/([/-])/);
    const isCombinedSigla = parts.some((part) => part === "/" || part === "-");

    parts.forEach((part) => {
      if (!/^(?:[A-Z]{2}|L2)$/.test(part)) {
        token.appendChild(document.createTextNode(part));
        return;
      }

      const partWrap = document.createElement("span");
      partWrap.className = "sigla-token__part";

      if (vacationSiglas.has(part)) {
        partWrap.appendChild(
          createVacationSiglaNode(
            part,
            isCombinedSigla ? "sigla-token__vacation-part" : "sigla-token__vacation-label",
            getVacationPosition(part, vacationOrder, showVacationPositions)
          )
        );
      } else {
        const partLabel = document.createElement("span");
        partLabel.className = "sigla-token__released-part";
        partLabel.textContent = part;
        if (isCombinedSigla && isSiglaChecked(activeDate, part)) {
          partLabel.classList.add("sigla-token__released-part--checked");
        }
        partWrap.appendChild(partLabel);
      }

      token.appendChild(partWrap);
    });
  }

  function appendDcReleaseDisplay(token, dcSiglas, activeDate) {
    token.classList.add("sigla-token--stacked");

    const topRow = document.createElement("span");
    topRow.className = "sigla-token__stacked-top";
    topRow.textContent = "DC";

    const bottomRow = document.createElement("span");
    bottomRow.className = "sigla-token__stacked-bottom sigla-token__dc-members";

    dcSiglas.forEach((dcSigla, position) => {
      if (position > 0) {
        const separator = document.createElement("span");
        separator.className = "sigla-token__stacked-separator";
        separator.textContent = "/";
        separator.setAttribute("aria-hidden", "true");
        bottomRow.appendChild(separator);
      }

      const member = document.createElement("span");
      member.className = "sigla-token__dc-member";
      member.textContent = dcSigla;
      if (isSiglaChecked(activeDate, dcSigla)) {
        member.classList.add("sigla-token__dc-member--released");
      }
      bottomRow.appendChild(member);
    });

    token.append(topRow, bottomRow);
  }
  function appendStackedDcDisplay(token, vacationSiglas, vacationOrder, showVacationPositions) {
    token.classList.add("sigla-token--stacked");

    const topRow = document.createElement("span");
    topRow.className = "sigla-token__stacked-top";
    topRow.textContent = "DC";

    const bottomRow = document.createElement("span");
    bottomRow.className = "sigla-token__stacked-bottom";

    vacationSiglas.forEach((vacationSigla, position) => {
      if (position > 0) {
        const separator = document.createElement("span");
        separator.className = "sigla-token__stacked-separator";
        separator.textContent = "/";
        separator.setAttribute("aria-hidden", "true");
        bottomRow.appendChild(separator);
      }

      bottomRow.appendChild(
        createVacationSiglaNode(
          vacationSigla,
          "dc-vacation-sigla",
          getVacationPosition(vacationSigla, vacationOrder, showVacationPositions)
        )
      );
    });

    token.append(topRow, bottomRow);
  }

  function createVacationSiglaNode(sigla, className, position) {
    const vacationPart = document.createElement("span");
    vacationPart.className = className;
    vacationPart.textContent = sigla;

    if (!position) {
      return vacationPart;
    }

    const wrap = document.createElement("span");
    wrap.className = "sigla-token__vacation-wrap";
    wrap.appendChild(vacationPart);

    const marker = document.createElement("span");
    marker.className = "sigla-token__position";
    marker.textContent = String(position);
    marker.setAttribute("aria-hidden", "true");
    wrap.appendChild(marker);
    return wrap;
  }

  function isWholeSiglaOnVacation(sigla, vacationSiglas) {
    if (!vacationSiglas || vacationSiglas.size === 0 || /[/-]/.test(sigla)) {
      return false;
    }

    return vacationSiglas.has(String(sigla || "").trim().toUpperCase());
  }

  function getDcVacationSiglas(sigla, vacationSiglas, weekdayLabel) {
    if (sigla !== "DC" || !vacationSiglas || vacationSiglas.size === 0) {
      return [];
    }

    return (dcAliasesByWeekday.get(weekdayLabel) || []).filter((value) => vacationSiglas.has(value));
  }

  function openTokenDetails(token, weekdayLabel) {
    activeContactToken = token;
    activeContactWeekday = weekdayLabel || "";
    const details = resolveTokenDetails(token, activeContactWeekday);
    const matchedContacts = details.contacts;
    const unresolved = details.unresolved;

    elements.contactKicker.textContent = `Sigla ${token}`;
    elements.contactTitle.textContent = matchedContacts.length
      ? matchedContacts.length === 1
        ? matchedContacts[0].name
        : `Contatos vinculados a ${token}`
      : `Sigla ${token}`;
    elements.contactSummary.textContent = buildSummaryText(token, matchedContacts, unresolved);
    const activeDate = elements.dateInput.value;
    elements.contactList.replaceChildren(...buildContactNodes(matchedContacts, unresolved, token, activeDate));

    elements.contactModal.classList.remove("hidden");
    elements.contactModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeContactModal() {
    activeContactToken = "";
    activeContactWeekday = "";
    elements.contactModal.classList.add("hidden");
    elements.contactModal.setAttribute("aria-hidden", "true");
    updateBodyModalState();
  }

  async function openTraining() {
    await ensureSharedAccess();
    const target = new URL("./apps/treinamentos/", window.location.href);
    const email = window.SAHMT_AUTH?.getUserLabel?.();
    if (email) {
      target.searchParams.set("userEmail", email);
    }
    window.location.assign(target.href);
  }
  function openEventsModal() {
    window.location.href = new URL(eventsUrl, window.location.href).href;
  }

  function closeEventsModal() {
    elements.eventsModal.classList.add("hidden");
    elements.eventsModal.setAttribute("aria-hidden", "true");
    updateBodyModalState();
  }

  function openLabelsModal() {
    if (window.SAHMT_SHELL) { window.location.href = labelsUrl; return; }
    preloadLabelsModule();
    elements.labelsModal.classList.remove("hidden");
    elements.labelsModal.setAttribute("aria-hidden", "false");
    updateBodyModalState();
  }

  async function preloadEcosystemShells(){}

  function preloadLabelsModule() {
    if (!elements.labelsFrame || elements.labelsFrame.src) {
      return;
    }

    elements.labelsFrame.src = new URL(labelsUrl, window.location.href).href;
  }

  function closeLabelsModal() {
    elements.labelsModal.classList.add("hidden");
    elements.labelsModal.setAttribute("aria-hidden", "true");
    updateBodyModalState();
  }

  function openManagementModal() {
    window.location.href = new URL(managementSiteUrl, window.location.href).href;
  }

  function closeManagementModal() {
    elements.managementModal.classList.add("hidden");
    elements.managementModal.setAttribute("aria-hidden", "true");
    updateBodyModalState();
  }

  function updateBodyModalState() {
    const hasOpenModal =
      !elements.contactModal.classList.contains("hidden") ||
      !elements.eventsModal.classList.contains("hidden") ||
      !elements.labelsModal.classList.contains("hidden") ||
      !elements.managementModal.classList.contains("hidden") ||
      !elements.noticeModal.classList.contains("hidden");
    document.body.classList.toggle("modal-open", hasOpenModal);

    if (!hasOpenModal) {
      requestViewportFit();
    }
  }

  function showOpeningNotice() {
    if (skipOpeningNotice) {
      return;
    }

    const notices = Array.isArray(noticesPayload.notices) ? noticesPayload.notices : [];
    const showAllNotices = noticesPayload.activeId === "all";
    const selectedNotices = showAllNotices
      ? notices
      : noticesPayload.activeId === null
        ? []
        : [notices.find((notice) => notice.id === noticesPayload.activeId) || notices[0]];

    if (!selectedNotices.length || !elements.noticeModal) {
      return;
    }

    const activeNotice = selectedNotices[0];
    elements.noticeEyebrow.textContent = showAllNotices ? "Tutoriais em vídeo" : (activeNotice.eyebrow || "Comunicado SAHMT");
    elements.noticeTitle.replaceChildren();
    selectedNotices.forEach((notice) => {
      const embeddedMediaUrl = getSafeNoticeUrl(notice.videoUrl || extractNoticeUrl(notice.message));
      const title = notice.title || "Aviso";
      const titleLink = document.createElement("a");
      titleLink.className = "notice-card__video-title";
      titleLink.href = embeddedMediaUrl || "#";
      if (embeddedMediaUrl) {
        const applyTrainingHref = (emailValue = "") => {
          const sessionEmail = String(emailValue || "").trim();
          const trainingUrl = new URL(embeddedMediaUrl, window.location.href);
          if (sessionEmail) {
            trainingUrl.searchParams.set("userEmail", sessionEmail);
          }
          titleLink.href = trainingUrl.href;
        };

        // The same-origin training shell keeps navigation inside the installed PWA.
        const trainingPageUrl = new URL(embeddedMediaUrl, window.location.href);
        const opensInsidePwa = trainingPageUrl.origin === window.location.origin;
        titleLink.target = opensInsidePwa ? "_self" : "_blank";
        titleLink.rel = opensInsidePwa ? "" : "noopener noreferrer external";
        applyTrainingHref(window.SAHMT_AUTH?.getUserLabel?.());
        window.SAHMT_AUTH?.onChange?.((session) => applyTrainingHref(session?.email));
      } else {
        titleLink.addEventListener("click", (event) => event.preventDefault());
      }
      titleLink.textContent = title;
      titleLink.setAttribute("aria-label", `Abrir video: ${title}`);
      elements.noticeTitle.appendChild(titleLink);
    });
    elements.noticeMessage.textContent = String(showAllNotices ? "" : activeNotice.message || "")
      .replace(extractNoticeUrl(activeNotice.message), "")
      .trim();
    renderNoticeMedia(showAllNotices ? null : activeNotice,
      showAllNotices ? "" : getSafeNoticeUrl(activeNotice.videoUrl || extractNoticeUrl(activeNotice.message)));
    renderNoticePresentation(showAllNotices ? null : activeNotice);
    elements.closeNoticeModal.disabled = true;
    elements.noticeModal.classList.remove("hidden");
    elements.noticeModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    if (activeNotice.presentation) {
      elements.noticeCountdown.textContent = "Apresentação em andamento";
    } else {
      let remaining = 3;
      elements.noticeCountdown.textContent = `Fechamento liberado em ${remaining} segundos`;

      const countdown = window.setInterval(() => {
        remaining -= 1;

        if (remaining > 0) {
          elements.noticeCountdown.textContent = `Fechamento liberado em ${remaining} segundos`;
          return;
        }

        window.clearInterval(countdown);
        elements.noticeCountdown.textContent = "Aviso pronto para ser fechado";
        elements.closeNoticeModal.disabled = false;
      }, 1000);
    }
  }

  function renderNoticePresentation(notice) {
    const container = document.getElementById("noticePresentation");
    const presentation = notice?.presentation;
    if (!container) return;
    container.replaceChildren();
    window.clearInterval(container._sahmtTimer);
    if (!presentation?.slides?.length) {
      container.hidden = true;
      return;
    }

    container.hidden = false;
    const stage = document.createElement("div");
    stage.className = "notice-presentation__stage";
    const title = document.createElement("h3");
    const text = document.createElement("p");
    const progress = document.createElement("div");
    progress.className = "notice-presentation__progress";
    stage.append(title, text, progress);
    const controls = document.createElement("div");
    controls.className = "notice-presentation__controls";
    const pause = document.createElement("button");
    pause.type = "button";
    pause.className = "notice-presentation__pause";
    controls.appendChild(pause);
    container.append(stage, controls);

    let index = 0;
    let paused = false;
    const show = () => {
      const slide = presentation.slides[index];
      title.textContent = slide.title || "";
      text.textContent = slide.text || "";
      stage.style.setProperty("--notice-slide-accent", slide.color || "#0d6380");
      text.style.color = slide.color || "#0d6380";
      progress.textContent = `${index + 1} / ${presentation.slides.length}`;
      pause.textContent = paused ? "Continuar" : "Pausar";
      if (index === presentation.slides.length - 1) {
        elements.noticeCountdown.textContent = "Apresentação concluída";
        elements.closeNoticeModal.disabled = false;
      }
    };
    const advance = () => {
      if (paused || index >= presentation.slides.length - 1) return;
      index += 1;
      show();
    };
    pause.addEventListener("click", () => {
      paused = !paused;
      show();
    });
    show();
    container._sahmtTimer = window.setInterval(advance, presentation.intervalMs || 3000);
  }
  function renderNoticeMedia(notice, embeddedMediaUrl = "") {
    if (!elements.noticeMedia) {
      return;
    }

    elements.noticeMedia.replaceChildren();
    const media = notice?.media || {};
    const imageUrl = getSafeNoticeUrl(notice?.imageUrl || notice?.bannerUrl || (media.type === "image" ? media.url : ""));
    if (imageUrl) {
      const imageLink = document.createElement("a");
      imageLink.className = "notice-card__image-link";
      imageLink.href = imageUrl;
      imageLink.target = "_blank";
      imageLink.rel = "noopener noreferrer";
      const image = document.createElement("img");
      image.className = "notice-card__image";
      image.src = imageUrl;
      image.alt = String(notice?.mediaAlt || notice?.title || "Imagem do comunicado");
      imageLink.appendChild(image);
      elements.noticeMedia.appendChild(imageLink);
    }

    elements.noticeMedia.hidden = !elements.noticeMedia.childElementCount;
  }

  function getSafeNoticeUrl(value) {
    const rawUrl = String(value || "").trim();
    if (!rawUrl) {
      return "";
    }

    try {
      const url = new URL(rawUrl, window.location.href);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function extractNoticeUrl(value) {
    const match = String(value || "").match(/https:\/\/[^\s`<>]+/i);
    return match ? match[0].replace(/[.,;)]+$/, "") : "";
  }

  function closeNoticeModal() {
    if (!elements.closeNoticeModal || elements.closeNoticeModal.disabled) {
      return;
    }

    elements.noticeModal.classList.add("hidden");
    elements.noticeModal.setAttribute("aria-hidden", "true");
    updateBodyModalState();
  }

  function buildSummaryText(token, matchedContacts, unresolved) {
    if (matchedContacts.length && !unresolved.length) {
      return matchedContacts.length === 1
        ? `Ficha de contato vinculada a ${token}.`
        : `Foram encontrados ${matchedContacts.length} contatos vinculados a ${token}.`;
    }

    if (matchedContacts.length && unresolved.length) {
      return `Foram encontrados ${matchedContacts.length} contatos para ${token}. Sem ficha nominal para: ${unresolved.join(", ")}.`;
    }

    return `Nao ha ficha de contato nominal cadastrada para ${token} nesta correlacao.`;
  }

  function buildContactNodes(matchedContacts, unresolved, token, activeDate) {
    const nodes = matchedContacts.map((contact) => createContactCard(contact, token, activeDate, matchedContacts));

    if (!matchedContacts.length || unresolved.length) {
      const note = document.createElement("article");
      note.className = "contact-card contact-card--note";

      const title = document.createElement("h3");
      title.textContent = matchedContacts.length ? "Observacao" : "Sem ficha vinculada";

      const text = document.createElement("p");
      text.textContent = matchedContacts.length
        ? `Ainda nao existe correspondencia nominal para: ${unresolved.join(", ")}.`
        : "Esta sigla aparece na escala, mas nao consta como nome na relacao PDF + cadastro publico.";

      note.append(title, text);
      nodes.push(note);
    }

    return nodes;
  }

  function createContactCard(contact, token, activeDate, matchedContacts) {
    const card = document.createElement("article");
    card.className = "contact-card";

    const header = document.createElement("div");
    header.className = "contact-card__header";

    const titleWrap = document.createElement("div");

    const siglaBadge = document.createElement("span");
    siglaBadge.className = "contact-card__sigla";
    siglaBadge.textContent = contact.sigla;

    const nameLine = document.createElement("div");
    nameLine.className = "contact-card__name-line";

    const name = document.createElement("h3");
    name.textContent = contact.name;
    nameLine.appendChild(name);

    if (canReleaseSiglas()) {
      const releaseButton = document.createElement("button");
      releaseButton.className = "contact-card__release";
      releaseButton.type = "button";
      releaseButton.textContent = "LIBERAR";
      releaseButton.setAttribute("aria-label", `Liberar ${contact.name}`);
      const alreadyReleased = isSiglaChecked(activeDate, contact.sigla);
      if (alreadyReleased) {
        releaseButton.classList.add("contact-card__release--released");
      }
      releaseButton.addEventListener("click", () => releaseContactForDate(
        releaseButton,
        contact,
        token,
        activeDate,
        matchedContacts
      ));
      nameLine.appendChild(releaseButton);
    }

    const meta = document.createElement("p");
    meta.className = "contact-card__meta";
    meta.textContent = [contact.role, contact.scaleFormatted].filter(Boolean).join(" â€¢ ") || "Equipe SAHMT";

    titleWrap.append(siglaBadge, nameLine, meta);
    header.appendChild(titleWrap);

    const infoGrid = document.createElement("div");
    infoGrid.className = "contact-card__grid";

    [
      ["Telefone", contact.phone || "Nao informado"],
      ["E-mail", contact.email || "Nao informado"],
      ["CRM", contact.crm ? String(contact.crm) : "Nao informado"],
      ["Entrada", contact.entryDateFormatted || "Nao informado"]
    ].forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "contact-card__field";

      const fieldLabel = document.createElement("span");
      fieldLabel.className = "contact-card__label";
      fieldLabel.textContent = label;

      const fieldValue = document.createElement("strong");
      fieldValue.className = "contact-card__value";
      fieldValue.textContent = value;

      row.append(fieldLabel, fieldValue);
      infoGrid.appendChild(row);
    });

    const actions = document.createElement("div");
    actions.className = "contact-card__actions";

    if (contact.whatsAppLink) {
      actions.appendChild(createActionLink("WhatsApp", contact.whatsAppLink));
    }

    if (contact.phoneDigits) {
      actions.appendChild(createActionLink("Ligar", `tel:${contact.phoneDigits}`));
    }

    if (contact.email) {
      actions.appendChild(createActionLink("E-mail", `mailto:${contact.email}`));
    }

    card.append(header, infoGrid, actions);
    return card;
  }

  function createActionLink(label, href) {
    const link = document.createElement("a");
    link.className = "contact-card__action";
    link.href = href;
    link.target = href.startsWith("http") ? "_blank" : "_self";
    link.rel = href.startsWith("http") ? "noopener noreferrer" : "";
    link.textContent = label;
    return link;
  }

  function resolveTokenDetails(token, weekdayLabel) {
    const parts = extractSiglas(token, weekdayLabel);
    const contactsFound = [];
    const seen = new Set();
    const unresolved = [];

    parts.forEach((part) => {
      const contact = contactsBySigla.get(part);
      if (contact) {
        if (!seen.has(part)) {
          seen.add(part);
          contactsFound.push(contact);
        }
      } else {
        unresolved.push(part);
      }
    });

    if (!parts.length && token) {
      unresolved.push(token);
    }

    return { contacts: contactsFound, unresolved };
  }

  function extractSiglas(token, weekdayLabel) {
    const normalized = String(token || "").toUpperCase();
    if (normalized === "DC") {
      return [...(dcAliasesByWeekday.get(weekdayLabel) || siglaAliases.get("DC") || [])];
    }
    if (siglaAliases.has(normalized)) {
      return [...siglaAliases.get(normalized)];
    }

    const matches = normalized.match(siglaPattern);
    if (!matches) {
      return [];
    }

    return matches
      .flatMap((value) => value.split(/[/-]/))
      .flatMap((value) => (siglaAliases.has(value) ? siglaAliases.get(value) : [value]))
      .filter(Boolean);
  }

  function shiftDate(dateKey, delta) {
    const date = new Date(`${dateKey}T12:00:00`);
    date.setDate(date.getDate() + delta);
    return clampKey(formatKey(date));
  }

  function enableDateSwipeNavigation(surface, navigateByDays) {
    if (!surface || !window.PointerEvent || typeof navigateByDays !== "function") {
      return;
    }

    const minimumDistance = 48;
    const maximumDurationMs = 900;
    let gesture = null;
    let suppressClickUntil = 0;

    surface.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" || (event.button !== undefined && event.button !== 0)) {
        gesture = null;
        return;
      }

      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: performance.now(),
        pressTarget: event.target instanceof Element ? event.target.closest(".sigla-button") : null,
        rejected: false
      };
    }, true);

    surface.addEventListener("pointermove", (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId) {
        return;
      }

      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 18) {
        gesture.rejected = true;
        return;
      }

      if (Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY)) {
        event.preventDefault();
      }
    }, { capture: true, passive: false });

    surface.addEventListener("pointerup", (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId) {
        return;
      }

      const completedGesture = gesture;
      gesture = null;
      const deltaX = event.clientX - completedGesture.startX;
      const deltaY = event.clientY - completedGesture.startY;
      const elapsed = performance.now() - completedGesture.startedAt;
      const isHorizontalSwipe = !completedGesture.rejected
        && elapsed <= maximumDurationMs
        && Math.abs(deltaX) >= minimumDistance
        && Math.abs(deltaX) > Math.abs(deltaY) * 1.25;

      if (!isHorizontalSwipe) {
        return;
      }

      event.preventDefault();
      suppressClickUntil = performance.now() + 450;
      completedGesture.pressTarget?.dispatchEvent(new Event("pointercancel"));
      window.setTimeout(() => navigateByDays(deltaX < 0 ? 1 : -1), 0);
    }, true);

    surface.addEventListener("pointercancel", () => {
      gesture = null;
    }, true);

    surface.addEventListener("click", (event) => {
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  function clampKey(dateKey) {
    if (dateKey < orderedDates[0]) {
      return orderedDates[0];
    }
    if (dateKey > orderedDates[orderedDates.length - 1]) {
      return orderedDates[orderedDates.length - 1];
    }
    return dateKey;
  }

  function formatKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatShort(dateKey) {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(new Date(`${dateKey}T12:00:00`));
  }

  function formatLong(dateKey) {
    const value = new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(new Date(`${dateKey}T12:00:00`));

    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function getWeekdayLabel(dateKey) {
    const value = new Intl.DateTimeFormat("pt-BR", { weekday: "long" })
      .format(new Date(`${dateKey}T12:00:00`));
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function toggle(element, show) {
    element.classList.toggle("hidden", !show);
  }

  async function loadScheduleData(){return Services.schedule();}

  function loadScheduleDataWithTimeout(timeoutMs) {
    return Promise.race([
      loadScheduleData(),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error("Tempo esgotado ao atualizar a escala.")), timeoutMs);
      })
    ]);
  }

  async function loadVacationData() {
    const fallbackVacations = Array.isArray(fallbackData?.vacations) ? fallbackData.vacations : [];
    let rows = [];

    try {
      rows = await fetchVacationSheetRows();
    } catch (error) {
      return { vacations: fallbackVacations };
    }

    const vacations = rows
      .map((row) => {
        const start = normalizeSheetDate(row[2]);
        const end = normalizeSheetDate(row[3]);
        const label = String(row[4] || "").trim();

        if (!start || !end || !label) {
          return null;
        }

        return { start, end, label };
      })
      .filter(Boolean);

    return {
      vacations: vacations.length ? vacations : fallbackVacations
    };
  }

  async function fetchScheduleSheetRows(){throw new Error("Integração antiga removida. Use o serviço central.");}

  async function fetchVacationSheetRows(){throw new Error("Integração antiga removida. Use o serviço central.");}

  function buildVacationLookup(vacations) {
    const lookup = new Map();

    vacations.forEach((vacation) => {
      const startDate = new Date(`${vacation.start}T12:00:00`);
      const endDate = new Date(`${vacation.end}T12:00:00`);

      for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
        lookup.set(formatKey(cursor), vacation.label);
      }
    });

    return lookup;
  }

  function parseCsvRows(csvText) {
    const rows = [];
    let row = [];
    let cell = "";
    let insideQuotes = false;

    for (let index = 0; index < csvText.length; index += 1) {
      const char = csvText[index];
      const nextChar = csvText[index + 1];

      if (char === "\"") {
        if (insideQuotes && nextChar === "\"") {
          cell += "\"";
          index += 1;
        } else {
          insideQuotes = !insideQuotes;
        }
        continue;
      }

      if (char === "," && !insideQuotes) {
        row.push(cell.trim());
        cell = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !insideQuotes) {
        if (char === "\r" && nextChar === "\n") {
          index += 1;
        }

        row.push(cell.trim());
        if (row.some((value) => value !== "")) {
          rows.push(row);
        }
        row = [];
        cell = "";
        continue;
      }

      cell += char;
    }

    if (cell.length || row.length) {
      row.push(cell.trim());
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
    }

    return rows;
  }

  function normalizeSheetDate(value) {
    const match = String(value || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) {
      return null;
    }

    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }
})();

}
