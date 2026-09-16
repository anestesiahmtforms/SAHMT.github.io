export async function mount(ctx){
const {Services,localStorage,sessionStorage,document,window,navigator,location,history,fetch,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame,cancelAnimationFrame}=ctx;

(async function () {
  const fallbackData = window.SAHMT_DATA;
  const siglaPattern = /(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*/g;
  const siglaAliases = new Map([
    ["DC", ["AD", "CR", "LA", "LH"]]
  ]);
  const dcAliasesByWeekday = Services.dcAliasesByWeekday;
  const scheduleSpreadsheetId = "";
  const scheduleSheetSources = [];
  const vacationSheetTitle = "";
  const eventListsSpreadsheetId = "";
  const eventListsSheetTitle = "";
  const recordsSheetTitle = "";
  const syncConfig = {pollIntervalMs:20000};
  // Endpoints operacionais do envio de eventos.
  // Referencia de codigo-fonte: tools/apps-script/SAHMT-eventos-registros.gs
  // Mantemos fallback entre implantacoes validas para o app continuar gravando
  // mesmo quando um deploy antigo deixa de responder temporariamente.
  const eventEntryConfig = {endpointUrl:"central-service",fallbackEndpointUrls:[],requestTimeoutMs:25000};
  const eventWriteUsers = new Set();
  const highlightedEventPeople = [
    "Fernando Astrogildo",
    "Bernardo Guimaraes",
    "Lucas Marques",
    "Carolina Valadares",
    "Jessica Karine",
    "Bruna Candida",
    "CAIXA DA EQUIPE"
  ];
  const appPassword = null;
  const appAccessStorageKey = "sahmt-eventos-access-v1";
  const siglaStateStorageKey = "sahmt-sigla-checks-v1";
  const siglaEventStateStorageKey = "sahmt-sigla-events-v1";
  const clientIdStorageKey = "sahmt-client-id-v1";
  const scheduleSyncStorageKey = "sahmt-eventos-schedule-cache-v1";
  const listsSyncStorageKey = "sahmt-eventos-lists-cache-v1";
  const recordsSyncStorageKey = "sahmt-eventos-records-cache-v1";
  const sharedStateEndpoint = "central-service";
  const eventSharedSiglaPrefix = "EVENTO:";
  const syncPollIntervalMs = Number(syncConfig.pollIntervalMs) > 0 ? Number(syncConfig.pollIntervalMs) : 20000;
  const sharedPendingTtlMs = Number(syncConfig.pendingTtlMs) > 0 ? Number(syncConfig.pendingTtlMs) : 180000;

  const todayKey = formatKey(new Date());
  const siglaCheckState = loadSiglaCheckState();
  const clientId = getOrCreateClientId();
  let data = null;
  let byDate = new Map();
  let orderedDates = [];
  let deferredInstallPrompt = null;
  let sharedStateHash = serializeSiglaState(siglaCheckState);
  let sharedStateTimer = null;
  const pendingSharedUpdates = new Map();
  const siglaEventState = loadSiglaEventState();
  let eventRecords = [];
  let memberDirectory = buildFallbackMemberDirectory();
  let dcMemberOptions = buildFallbackDcOptions();
  let eventFieldOptions = buildFallbackEventFieldOptions();
  let eventTypeDefaults = buildFallbackEventTypeDefaults();
  let siglaChoiceResolver = null;
  let activeEventLaunch = null;
  let activeEventRecordEdit = null;
  let autoFilledFieldLocks = new Set();
  let supportShortcutLaunchActive = false;

  const elements = {
    authGate: document.getElementById("authGate"),
    authForm: document.getElementById("authForm"),
    authPasswordInput: document.getElementById("authPasswordInput"),
    authStatus: document.getElementById("authStatus"),
    appFrame: document.getElementById("appFrame"),
    dateInput: document.getElementById("dateInput"),
    eventDateInput: document.getElementById("eventDateInput"),
    eventEntryForm: document.getElementById("eventEntryForm"),
    openEventEntryModal: document.getElementById("openEventEntryModal"),
    eventEntryModal: document.getElementById("eventEntryModal"),
    eventEntryBackdrop: document.getElementById("eventEntryBackdrop"),
    closeEventEntryModal: document.getElementById("closeEventEntryModal"),
    eventEntryKicker: document.getElementById("eventEntryTitle"),
    siglaChoiceModal: document.getElementById("siglaChoiceModal"),
    siglaChoiceBackdrop: document.getElementById("siglaChoiceBackdrop"),
    closeSiglaChoiceModal: document.getElementById("closeSiglaChoiceModal"),
    siglaChoiceTitle: document.getElementById("siglaChoiceTitle"),
    siglaChoiceDescription: document.getElementById("siglaChoiceDescription"),
    siglaChoiceOptions: document.getElementById("siglaChoiceOptions"),
    submitEventEntryButton: document.getElementById("submitEventEntryButton"),
    eventEntryStatus: document.getElementById("eventEntryStatus"),
    memberStatusInput: document.getElementById("memberStatusInput"),
    eventTypeInput: document.getElementById("eventTypeInput"),
    eventDescriptionInput: document.getElementById("eventDescriptionInput"),
    delayMultipleInput: document.getElementById("delayMultipleInput"),
    substituteInput: document.getElementById("substituteInput"),
    shiftInput: document.getElementById("shiftInput"),
    payerInput: document.getElementById("payerInput"),
    creditorInput: document.getElementById("creditorInput"),
    amountToPayInput: document.getElementById("amountToPayInput"),
    originInput: document.getElementById("originInput"),
    prevButton: document.getElementById("prevButton"),
    todayButton: document.getElementById("todayButton"),
    nextButton: document.getElementById("nextButton"),
    installButton: document.getElementById("installButton"),
    recordsDateInput: document.getElementById("recordsDateInput"),
    recordsLoadingState: document.getElementById("recordsLoadingState"),
    recordsEmptyState: document.getElementById("recordsEmptyState"),
    recordsList: document.getElementById("recordsList"),
    toggleRecordsPanel: document.getElementById("toggleRecordsPanel"),
    recordsPanelModal: document.getElementById("recordsPanelModal"),
    recordsPanelBackdrop: document.getElementById("recordsPanelBackdrop"),
    closeRecordsPanel: document.getElementById("closeRecordsPanel"),
    recordsPanelBody: document.getElementById("recordsPanelBody"),
    openMonthlyRecordsModal: document.getElementById("openMonthlyRecordsModal"),
    monthlyRecordsModal: document.getElementById("monthlyRecordsModal"),
    monthlyRecordsBackdrop: document.getElementById("monthlyRecordsBackdrop"),
    closeMonthlyRecordsModal: document.getElementById("closeMonthlyRecordsModal"),
    monthlyRecordsInput: document.getElementById("monthlyRecordsInput"),
    shareMonthlyPdfButton: document.getElementById("shareMonthlyPdfButton"),
    monthlyRecordsStatus: document.getElementById("monthlyRecordsStatus"),
    monthlyRecordsSummary: document.getElementById("monthlyRecordsSummary"),
    monthlyRecordsEmptyState: document.getElementById("monthlyRecordsEmptyState"),
    monthlyRecordsList: document.getElementById("monthlyRecordsList"),
    pendingEventStatus: document.getElementById("pending-event-status"),
    pendingSendConfirmation: document.getElementById("pending-send-confirmation"),
    pendingSendConfirmationOk: document.getElementById("pending-send-confirmation-ok"),
    emptyState: document.getElementById("emptyState"),
    siglasGrid: document.getElementById("siglasGrid")
  };
  let currentAccessLabel = "";

  elements.pendingSendConfirmationOk?.addEventListener("click", () => {
    elements.pendingSendConfirmation.hidden = true;
  });

  function showPendingSendConfirmation(sentCount) {
    if (!elements.pendingSendConfirmation) {
      return;
    }
    const countLabel = sentCount === 1 ? "O registro pendente foi enviado com sucesso." : `${sentCount} registros pendentes foram enviados com sucesso.`;
    elements.pendingSendConfirmation.querySelector("span").textContent = countLabel;
    elements.pendingSendConfirmation.hidden = false;
    elements.pendingSendConfirmationOk?.focus({ preventScroll: true });
  }

  await ensureSharedAuthorizedAccess();

  data = loadSyncCache(scheduleSyncStorageKey) || fallbackData;

  if (!data || !Array.isArray(data.days) || data.days.length === 0) {
    try {
      data = await loadScheduleDataWithTimeout(6000);
    } catch (error) {
      throw new Error("Dados da escala nao encontrados.");
    }
  }

  applyScheduleData(data);
  syncDailyDateInputs(todayKey);
  if (elements.recordsDateInput) {
    elements.recordsDateInput.value = todayKey;
  }
  if (elements.monthlyRecordsInput) {
    elements.monthlyRecordsInput.value = todayKey.slice(0, 7);
  }
  populateEventEntryOptionLists();
  hydrateMemberDirectory().catch(() => {});
  hydrateEventRecords().catch(() => {});
  hydrateSharedSiglaState().then(() => render(elements.dateInput.value)).catch(() => {});
  flushPendingEventSubmissions();
  updatePendingEventStatus();
  window.addEventListener("online", () => {
    updatePendingEventStatus();
    flushPendingEventSubmissions({ notify: true });
  });
  window.setInterval(() => flushPendingEventSubmissions({ notify: true }), 30000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      hydrateEventRecords().catch(()=>{});
      hydrateSharedSiglaState().then(()=>render(elements.dateInput.value)).catch(()=>{});
      updatePendingEventStatus();
      flushPendingEventSubmissions({ notify: true });
    }
  });

  elements.dateInput.addEventListener("input", () => {
    setActiveDailyDate(elements.dateInput.value);
  });

  elements.dateInput.addEventListener("change", () => {
    setActiveDailyDate(elements.dateInput.value);
  });

  elements.recordsDateInput?.addEventListener("change", () => {
    setActiveDailyDate(elements.recordsDateInput.value || todayKey);
  });

  elements.monthlyRecordsInput?.addEventListener("change", () => {
    renderMonthlyRecordsForMonth(elements.monthlyRecordsInput.value || todayKey.slice(0, 7));
  });

  elements.prevButton.addEventListener("click", () => {
    setActiveDailyDate(shiftDate(elements.dateInput.value, -1));
  });

  elements.nextButton.addEventListener("click", () => {
    setActiveDailyDate(shiftDate(elements.dateInput.value, 1));
  });

  enableDateSwipeNavigation(elements.siglasGrid, (delta) => {
    setActiveDailyDate(shiftDate(elements.dateInput.value, delta));
  });

  elements.todayButton.addEventListener("click", () => {
    setActiveDailyDate(todayKey);
  });

  if (elements.openEventEntryModal) {
    elements.openEventEntryModal.addEventListener("click", () => {
      resetEventEntryForm(elements.dateInput?.value || todayKey);
      openEventEntryModal();
    });
  }


  if (elements.closeEventEntryModal) {
    elements.closeEventEntryModal.addEventListener("click", closeEventEntryModal);
  }

  if (elements.eventEntryBackdrop) {
    elements.eventEntryBackdrop.addEventListener("click", closeEventEntryModal);
  }

  if (elements.closeSiglaChoiceModal) {
    elements.closeSiglaChoiceModal.addEventListener("click", () => closeSiglaChoiceModal(null));
  }

  if (elements.siglaChoiceBackdrop) {
    elements.siglaChoiceBackdrop.addEventListener("click", () => closeSiglaChoiceModal(null));
  }

  if (elements.eventEntryForm) {
    elements.eventEntryForm.addEventListener("submit", onEventEntrySubmit);
    elements.eventEntryForm.addEventListener("focusin", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      window.setTimeout(() => {
        if (!target.isConnected || !elements.eventEntryForm) {
          return;
        }
        const targetCenter = target.offsetTop + target.offsetHeight / 2;
        const scrollTop = Math.max(0, targetCenter - elements.eventEntryForm.clientHeight / 2);
        elements.eventEntryForm.scrollTo({ top: scrollTop, behavior: "smooth" });
      }, 80);
    });
  }

  elements.openMonthlyRecordsModal?.addEventListener("click", openMonthlyRecordsModal);
  elements.closeMonthlyRecordsModal?.addEventListener("click", closeMonthlyRecordsModal);
  elements.monthlyRecordsBackdrop?.addEventListener("click", closeMonthlyRecordsModal);
  elements.shareMonthlyPdfButton?.addEventListener("click", shareMonthlyRecordsPdf);
  elements.toggleRecordsPanel?.addEventListener("click", toggleDailyRecordsPanel);
  elements.closeRecordsPanel?.addEventListener("click", closeDailyRecordsPanel);
  elements.recordsPanelBackdrop?.addEventListener("click", closeDailyRecordsPanel);

  if (elements.eventTypeInput) {
    elements.eventTypeInput.addEventListener("change", () => {
      const normalizedEventType = normalizeEventType(elements.eventTypeInput.value);
      if (normalizedEventType === "atraso" && elements.delayMultipleInput) {
        elements.delayMultipleInput.value = "";
      }
      updateEventEntryState();
    });
  }

  elements.memberStatusInput?.addEventListener("input", updateEventEntryState);
  elements.eventDateInput?.addEventListener("input", updateEventEntryState);
  elements.eventDescriptionInput?.addEventListener("input", updateEventEntryState);
  elements.substituteInput?.addEventListener("change", updateEventEntryState);
  elements.shiftInput?.addEventListener("change", updateEventEntryState);
  elements.delayMultipleInput?.addEventListener("change", updateEventEntryState);
  elements.payerInput?.addEventListener("change", updateEventEntryState);
  elements.creditorInput?.addEventListener("change", updateEventEntryState);
  elements.amountToPayInput?.addEventListener("input", updateEventEntryState);
  elements.amountToPayInput?.addEventListener("blur", () => {
    elements.amountToPayInput.value = formatStoredCurrency(elements.amountToPayInput.value);
    updateEventEntryState();
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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (isSiglaChoiceModalOpen()) {
        closeSiglaChoiceModal(null);
        return;
      }
      if (isMonthlyRecordsModalOpen()) {
        closeMonthlyRecordsModal();
        return;
      }
      closeEventEntryModal();
    }
  });

  ;

  render(elements.dateInput.value);
  refreshScheduleFromSheet();

  function applyScheduleData(scheduleData) {
    data = scheduleData;
    byDate = new Map(data.days.map((day) => [day.date, day]));
    orderedDates = data.days.map((day) => day.date).sort();
    elements.dateInput.min = orderedDates[0];
    elements.dateInput.max = orderedDates[orderedDates.length - 1];
  }

  function refreshScheduleFromSheet() {
    loadScheduleDataWithTimeout(12000)
      .then((liveData) => {
        if (!Array.isArray(liveData?.days) || !liveData.days.length) {
          return;
        }

        const selectedDate = elements.dateInput.value;
        saveSyncCache(scheduleSyncStorageKey, liveData);
        applyScheduleData(liveData);
        render(clampKey(selectedDate));
      })
      .catch(() => {});
  }

  function render(dateKey) {
    const activeDate = syncDailyDateInputs(dateKey);
    const day = byDate.get(activeDate);
    elements.todayButton.textContent = `HOJE\n${(day?.weekdayLabel || getWeekdayLabel(activeDate)).toUpperCase()}`;

    if (!day) {
      elements.emptyState.classList.remove("hidden");
      elements.siglasGrid.innerHTML = "";
      return;
    }

    elements.emptyState.classList.add("hidden");
    renderSiglas(day.siglas, day.weekdayLabel, day.date);
    renderRecordsForDate(activeDate);
  }

  function renderSiglas(siglas, weekdayLabel, dateKey) {
    elements.siglasGrid.innerHTML = "";
    const totalItems = siglas.length + 1;
    const columnCount = totalItems <= 15 ? 5 : 6;
    const rowCount = Math.ceil(totalItems / columnCount);
    elements.siglasGrid.style.setProperty("--sigla-columns", String(columnCount));
    elements.siglasGrid.style.setProperty("--sigla-rows", String(rowCount));
    const vacationSiglas = getVacationSiglasForDate(dateKey);
    const vacationOrder = getVacationOrderForDate(dateKey);
    const scheduledVacationSiglas = getScheduledVacationSiglas(siglas, vacationSiglas);
    const showVacationPositions = scheduledVacationSiglas.size > 1;

    siglas.forEach((sigla, index) => {
      const item = document.createElement("div");
      item.className = "sigla-item";

      const token = document.createElement("button");
      token.className = "sigla-token sigla-button";
      token.type = "button";
      token.setAttribute("aria-label", `Abrir lançamento de evento para a sigla ${sigla}.`);
      token.title = "Abrir lançamento de evento.";
      bindSiglaInteractions(token, sigla, weekdayLabel, dateKey);

      const dcVacationSiglas = getDcVacationSiglas(sigla, vacationSiglas, weekdayLabel);
      if (dcVacationSiglas.length >= 2) {
        appendStackedDcDisplay(token, dcVacationSiglas, vacationOrder, showVacationPositions);
      } else {
        appendSiglaDisplay(token, sigla, vacationSiglas, vacationOrder, showVacationPositions);

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

      if (shouldHighlightEventSigla(dateKey, sigla)) {
        token.classList.add("sigla-token--event");
      }

      const counter = document.createElement("div");
      counter.className = "sigla-index";
      counter.textContent = String(index + 1);

      item.appendChild(token);
      item.appendChild(counter);
      elements.siglasGrid.appendChild(item);
    });

    const supportItem = document.createElement("div");
    supportItem.className = "sigla-item sigla-item--support";

    const supportButton = document.createElement("button");
    supportButton.className = "sigla-token sigla-button sigla-token--support";
    supportButton.type = "button";
    supportButton.textContent = "Suporte";
    supportButton.disabled = !canWriteEventData();
    supportButton.setAttribute("aria-disabled", canWriteEventData() ? "false" : "true");
    supportButton.setAttribute("aria-label", "Abrir lançamento de evento de Suporte.");
    supportButton.title = "Abrir lançamento de evento de Suporte.";
    if (shouldHighlightEventSigla(dateKey, "SUPORTE")) {
      supportButton.classList.add("sigla-token--event");
    }
    supportButton.addEventListener("click", openSupportEventLaunch);

    const supportCounter = document.createElement("div");
    supportCounter.className = "sigla-index";
    supportCounter.textContent = String(siglas.length + 1);

    supportItem.appendChild(supportButton);
    supportItem.appendChild(supportCounter);
    elements.siglasGrid.appendChild(supportItem);
  }

  function bindSiglaInteractions(token, sigla, weekdayLabel, dateKey) {
    token.addEventListener("click", () => handleSiglaClick(sigla, weekdayLabel, dateKey));
    token.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
      }
    });
  }

  async function toggleSiglaCheck(token, dateKey, sigla) {
    if (!canWriteEventData()) {
      showReadOnlyNotice();
      return;
    }
    const marked = !token.classList.contains("sigla-token--checked");
    applySiglaCheckAppearance(token, marked);

    if (!dateKey || !sigla) {
      return;
    }

    updateSiglaCheckState(dateKey, sigla, marked);
    persistSiglaCheckState();
    registerPendingSharedUpdate(dateKey, sigla, marked);

    if (!sharedStateEndpoint) {
      return;
    }

    try {
      const remoteState = await pushSharedSiglaCheck(dateKey, sigla, marked);
      if (remoteState) {
        replaceSiglaCheckState(remoteState);
        render(elements.dateInput.value);
      }
    } catch (error) {
      // Keep the local optimistic state when the shared sync endpoint is unavailable.
    }
  }

  function isSiglaChecked(dateKey, sigla) {
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

  function syncDailyDateInputs(dateKey) {
    const normalizedDate = clampKey(String(dateKey || todayKey).trim() || todayKey);
    if (elements.dateInput) {
      elements.dateInput.value = normalizedDate;
    }
    if (elements.recordsDateInput) {
      elements.recordsDateInput.value = normalizedDate;
    }
    if (elements.eventDateInput) {
      elements.eventDateInput.value = normalizedDate;
    }
    return normalizedDate;
  }

  function setActiveDailyDate(dateKey) {
    render(syncDailyDateInputs(dateKey));
  }

  

  

  

  

  function lockApplication() {
    elements.authGate?.classList.remove("hidden");
    elements.appFrame?.classList.add("hidden");
  }

  function unlockApplication() {
    elements.authGate?.classList.add("hidden");
    elements.appFrame?.classList.remove("hidden");
  }

  async function ensureSharedAuthorizedAccess() {
    if (window.SAHMT_AUTH?.requireAccess) {
      const auth = await window.SAHMT_AUTH.requireAccess({
        moduleId: "EVENTOS",
        pageId: "home",
        returnUrl: window.location.href
      });
      currentAccessLabel = String(auth?.email || "").trim();
      applyWriteAccessUi();
      window.SAHMT_AUTH.onChange((nextAuth) => {
        currentAccessLabel = String(nextAuth?.email || "").trim();
        applyWriteAccessUi();
      });
    }

    clearAuthStatus();
    unlockApplication();
  }

  function setAuthStatus(message) {
    if (!elements.authStatus) {
      return;
    }

    elements.authStatus.textContent = message;
    elements.authStatus.classList.toggle("hidden", !message);
  }

  function clearAuthStatus() {
    setAuthStatus("");
  }

  function applyWriteAccessUi() {
    const canWrite = canWriteEventData();
    [elements.openEventEntryModal, elements.siglasGrid?.querySelector(".sigla-token--support")].forEach((button) => {
      if (!button) {
        return;
      }
      button.disabled = !canWrite;
      button.setAttribute("aria-disabled", canWrite ? "false" : "true");
    });
    if (elements.recordsList && elements.recordsDateInput) {
      renderRecordsForDate(elements.recordsDateInput.value || todayKey);
    }
  }

  function canWriteEventData(){return Services.permission("events");}

  function showReadOnlyNotice() {
    window.alert("Apenas os usuarios autorizados podem lancar, editar ou alterar dados do EVENTOS DE ESCALA.");
  }

  function loadSiglaEventState() {
    try {
      const raw = window.localStorage.getItem(siglaEventStateStorageKey);

      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveSiglaEventState() {
    try {
      window.localStorage.setItem(siglaEventStateStorageKey, JSON.stringify(siglaEventState));
    } catch (error) {
      // Ignore storage failures to avoid blocking the UI on restricted browsers.
    }
  }

  function beginEventLaunch(sigla, dateKey) {
    if (!sigla || !dateKey) {
      activeEventLaunch = null;
      return;
    }

    activeEventLaunch = {
      sigla: String(sigla).trim().toUpperCase(),
      dateKey: String(dateKey).trim()
    };
    render(elements.dateInput?.value || dateKey);
  }

  function cancelActiveEventLaunch() {
    if (!activeEventLaunch) {
      return;
    }

    const currentDate = activeEventLaunch.dateKey;
    activeEventLaunch = null;
    render(elements.dateInput?.value || currentDate);
  }

  function commitActiveEventLaunch() {
    if (!activeEventLaunch?.dateKey || !activeEventLaunch?.sigla) {
      return;
    }

    const { dateKey, sigla } = activeEventLaunch;

    if (!Array.isArray(siglaEventState[dateKey])) {
      siglaEventState[dateKey] = [];
    }

    if (!siglaEventState[dateKey].includes(sigla)) {
      siglaEventState[dateKey].push(sigla);
    }

    saveSiglaEventState();
    activeEventLaunch = null;
    render(elements.dateInput?.value || dateKey);
  }

  function shouldHighlightEventSigla(dateKey, sigla) {
    const normalizedDate = String(dateKey || "").trim();
    const normalizedSigla = String(sigla || "").trim().toUpperCase();

    if (!normalizedDate || !normalizedSigla) {
      return false;
    }

    if (activeEventLaunch?.dateKey === normalizedDate && activeEventLaunch?.sigla === normalizedSigla) {
      return true;
    }

    return Array.isArray(siglaEventState[normalizedDate]) && siglaEventState[normalizedDate].includes(normalizedSigla);
  }

  function applySiglaCheckAppearance(token, marked) {
    token.classList.toggle("sigla-token--checked", marked);
    token.setAttribute("aria-pressed", marked ? "true" : "false");
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
        replaceSiglaCheckState(removeEventSharedState(remoteState));
        replaceSiglaEventState(extractEventSharedState(remoteState));
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
        const mergedState = mergeSharedState(removeEventSharedState(remoteState));
        const nextHash = serializeSiglaState(mergedState);

        if (nextHash && nextHash !== sharedStateHash) {
          replaceSiglaCheckState(mergedState);
          render(elements.dateInput.value);
        }

        const remoteEventState = extractEventSharedState(remoteState);
        if (serializeSiglaState(remoteEventState) !== serializeSiglaState(siglaEventState)) {
          replaceSiglaEventState(remoteEventState);
          render(elements.dateInput.value);
        }
      } catch (error) {
        // Polling should fail silently to avoid interrupting the app UX.
      }
    }, syncPollIntervalMs);
  }

  async function fetchSharedSiglaState(){return normalizeSharedState(await Services.highlights());}

  function extractEventSharedState(rawState) {
    const normalizedState = normalizeSharedState(rawState);
    return Object.entries(normalizedState).reduce((state, [dateKey, siglas]) => {
      const eventSiglas = siglas
        .filter((value) => value.startsWith(eventSharedSiglaPrefix))
        .map((value) => value.slice(eventSharedSiglaPrefix.length).trim().toUpperCase())
        .filter(Boolean);

      if (eventSiglas.length) {
        state[dateKey] = Array.from(new Set(eventSiglas));
      }
      return state;
    }, {});
  }

  function removeEventSharedState(rawState) {
    const normalizedState = normalizeSharedState(rawState);
    return Object.entries(normalizedState).reduce((state, [dateKey, siglas]) => {
      const regularSiglas = siglas.filter((value) => !value.startsWith(eventSharedSiglaPrefix));
      if (regularSiglas.length) {
        state[dateKey] = regularSiglas;
      }
      return state;
    }, {});
  }

  function replaceSiglaEventState(nextState) {
    const normalizedState = normalizeSharedState(nextState);
    Object.keys(siglaEventState).forEach((key) => delete siglaEventState[key]);
    Object.entries(normalizedState).forEach(([dateKey, siglas]) => {
      siglaEventState[dateKey] = siglas;
    });
    saveSiglaEventState();
  }

  async function pushSharedSiglaCheck(dateKey,sigla,marked){return normalizeSharedState(await Services.mark(dateKey,sigla,marked));}

  function replaceSiglaCheckState(nextState) {
    const mergedState = mergeSharedState(nextState);
    Object.keys(siglaCheckState).forEach((key) => delete siglaCheckState[key]);
    Object.entries(mergedState).forEach(([stateDateKey, siglas]) => {
      siglaCheckState[stateDateKey] = siglas;
    });
    persistSiglaCheckState();
  }

  function normalizeSharedState(rawState) {
    if (!rawState || typeof rawState !== "object") {
      return {};
    }

    return Object.entries(rawState).reduce((accumulator, [stateDateKey, siglas]) => {
      const normalizedDateKey = normalizeRemoteSharedDateKey(stateDateKey);
      if (!normalizedDateKey || !Array.isArray(siglas)) {
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
        .reduce((accumulator, stateDateKey) => {
          accumulator[stateDateKey] = [...(state[stateDateKey] || [])].sort();
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

  async function handleSiglaClick(sigla, weekdayLabel, dateKey) {
    if (!canWriteEventData()) {
      showReadOnlyNotice();
      return;
    }
    beginEventLaunch(sigla, dateKey);
    const choices = getMemberChoicesForSigla(sigla, weekdayLabel);

    if (!choices.length) {
      resetEventEntryForm(dateKey);
      prefillMemberStatus(sigla, dateKey);
      openEventEntryModal();
      return;
    }

    if (choices.length === 1) {
      resetEventEntryForm(dateKey);
      prefillMemberStatus(choices[0].name, dateKey);
      openEventEntryModal();
      return;
    }

    const selectedChoice = await openSiglaChoiceModal(sigla, choices);
    if (!selectedChoice) {
      cancelActiveEventLaunch();
      return;
    }

    resetEventEntryForm(dateKey);
    prefillMemberStatus(selectedChoice.name, dateKey);
    openEventEntryModal();
  }

  function openSupportEventLaunch() {
    if (!canWriteEventData()) {
      showReadOnlyNotice();
      return;
    }
    const activeDate = String(elements.dateInput?.value || todayKey).trim() || todayKey;
    resetEventEntryForm(activeDate);
    beginEventLaunch("SUPORTE", activeDate);
    supportShortcutLaunchActive = true;
    populateEventEntryOptionLists();

    if (elements.eventTypeInput) {
      setSelectControlValue(elements.eventTypeInput, "Suporte");
      setAutoFilledFieldLock(elements.eventTypeInput, true);
      syncFieldInteractivity(elements.eventTypeInput);
    }

    updateEventEntryState();
    openEventEntryModal();
  }

  function openEventEntryModal() {
    if (!elements.eventEntryModal) {
      return;
    }

    clearEventEntryStatus();
    syncEventEntryModeUi();
    updateEventEntryState();
    elements.eventEntryModal.classList.remove("hidden");
    elements.eventEntryModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeEventEntryModal() {
    if (!elements.eventEntryModal) {
      return;
    }

    elements.eventEntryModal.classList.add("hidden");
    elements.eventEntryModal.setAttribute("aria-hidden", "true");
    if (!isSiglaChoiceModalOpen() && !isMonthlyRecordsModalOpen()) {
      document.body.classList.remove("modal-open");
    }
    cancelActiveEventLaunch();
    activeEventRecordEdit = null;
    syncEventEntryModeUi();
  }

  function prefillMemberStatus(memberName, dateKey) {
    if (elements.eventDateInput) {
      elements.eventDateInput.value = dateKey || elements.dateInput?.value || todayKey;
    }

    if (elements.memberStatusInput) {
      elements.memberStatusInput.value = memberName || "";
      setAutoFilledFieldLock(elements.memberStatusInput, Boolean(String(memberName || "").trim()));
    }

    updateEventEntryState();
  }

  function openSiglaChoiceModal(sigla, choices) {
    if (!elements.siglaChoiceModal || !elements.siglaChoiceOptions) {
      return Promise.resolve(null);
    }

    if (elements.siglaChoiceTitle) {
      elements.siglaChoiceTitle.textContent = `Escolha o membro de ${sigla}`;
    }

    if (elements.siglaChoiceDescription) {
      elements.siglaChoiceDescription.textContent = "Selecione o nome para preencher automaticamente em MEMBRO (AUSENTE/ATRASADO).";
    }

    elements.siglaChoiceOptions.innerHTML = "";

    choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-sheet__option";
      button.textContent = choice.label;
      button.addEventListener("click", () => closeSiglaChoiceModal(choice));
      elements.siglaChoiceOptions.appendChild(button);
    });

    elements.siglaChoiceModal.classList.remove("hidden");
    elements.siglaChoiceModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    return new Promise((resolve) => {
      siglaChoiceResolver = resolve;
    });
  }

  function closeSiglaChoiceModal(selectedChoice) {
    if (!elements.siglaChoiceModal) {
      return;
    }

    elements.siglaChoiceModal.classList.add("hidden");
    elements.siglaChoiceModal.setAttribute("aria-hidden", "true");

    if (!isEventEntryModalOpen()) {
      document.body.classList.remove("modal-open");
    }

    if (typeof siglaChoiceResolver === "function") {
      const resolver = siglaChoiceResolver;
      siglaChoiceResolver = null;
      resolver(selectedChoice || null);
    }
  }

  function openMonthlyRecordsModal() {
    if (!elements.monthlyRecordsModal) {
      return;
    }

    clearMonthlyRecordsStatus();
    if (elements.monthlyRecordsInput && !elements.monthlyRecordsInput.value) {
      elements.monthlyRecordsInput.value = todayKey.slice(0, 7);
    }
    renderMonthlyRecordsForMonth(elements.monthlyRecordsInput?.value || todayKey.slice(0, 7));
    elements.monthlyRecordsModal.classList.remove("hidden");
    elements.monthlyRecordsModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeMonthlyRecordsModal() {
    if (!elements.monthlyRecordsModal) {
      return;
    }

    elements.monthlyRecordsModal.classList.add("hidden");
    elements.monthlyRecordsModal.setAttribute("aria-hidden", "true");
    if (!isEventEntryModalOpen() && !isSiglaChoiceModalOpen()) {
      document.body.classList.remove("modal-open");
    }
  }

  function toggleDailyRecordsPanel(forceOpen) {
    if (!elements.recordsPanelModal || !elements.toggleRecordsPanel) {
      return;
    }

    const shouldOpen = typeof forceOpen === "boolean"
      ? forceOpen
      : elements.recordsPanelModal.classList.contains("hidden");

    elements.recordsPanelModal.classList.toggle("hidden", !shouldOpen);
    elements.recordsPanelModal.setAttribute("aria-hidden", shouldOpen ? "false" : "true");
    elements.toggleRecordsPanel.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    elements.toggleRecordsPanel.classList.toggle("records-panel-toggle--open", shouldOpen);
    if (shouldOpen) {
      renderRecordsForDate(elements.recordsDateInput?.value || todayKey);
      document.body.classList.add("modal-open");
    } else if (!isEventEntryModalOpen() && !isSiglaChoiceModalOpen() && !isMonthlyRecordsModalOpen()) {
      document.body.classList.remove("modal-open");
    }
  }

  function closeDailyRecordsPanel() {
    toggleDailyRecordsPanel(false);
  }

  function isMonthlyRecordsModalOpen() {
    return Boolean(elements.monthlyRecordsModal && !elements.monthlyRecordsModal.classList.contains("hidden"));
  }

  function isEventEntryModalOpen() {
    return Boolean(elements.eventEntryModal && !elements.eventEntryModal.classList.contains("hidden"));
  }

  function isSiglaChoiceModalOpen() {
    return Boolean(elements.siglaChoiceModal && !elements.siglaChoiceModal.classList.contains("hidden"));
  }

  async function onEventEntrySubmit(event) {
    event.preventDefault();

    if (!validateEventEntryForm()) {
      return;
    }

    const authenticatedEmail = getAuthenticatedEmail();
    if (!authenticatedEmail) {
      setEventEntryStatus("E-mail autenticado nao identificado. Entre novamente no app antes de salvar.", "error");
      return;
    }

    const payload = buildEventEntryPayload();
    setEventEntrySubmitting(true);
    setEventEntryStatus(isEditingEventRecord() ? "Salvando alteracao na planilha..." : "Salvando dados na planilha...", "");

    try {
      const result = await postEventEntryPayload(payload);
      if(result.queued){updatePendingEventStatus();setEventEntryStatus("Registro guardado para envio. Confira os pendentes no menu da conta.","error");return;}
      const successMessage = isEditingEventRecord()
        ? `Alteracao enviada com sucesso. ${result?.message || "Registro atualizado."}`
        : `Enviado para a planilha com sucesso. ${result?.message || "Registro confirmado."}`;
      commitActiveEventLaunch();
      upsertRecentEventRecord(payload, result);
      const panelDate = normalizeRecordDate(payload.dataDoEvento) || elements.recordsDateInput?.value || todayKey;
      if (elements.recordsDateInput) {
        elements.recordsDateInput.value = panelDate;
      }
      renderRecordsForDate(panelDate);
      window.setTimeout(() => {
        hydrateEventRecords().catch(() => {});
      }, 2500);
      setEventEntryStatus(successMessage, "success");
      window.alert(successMessage);
      resetEventEntryForm(payload.dataDoEvento);
      closeEventEntryModal();
    } catch (error) {
      const detail = String(error?.message || "").trim();
      
      updatePendingEventStatus();
      setEventEntryStatus(
        detail || "O registro não foi enviado.",
        "error"
      );
      activeEventLaunch = null;
      render(elements.dateInput?.value || todayKey);
    } finally {
      setEventEntrySubmitting(false);
    }
  }

  function buildEventEntryPayload() {
    const eventDate = String(elements.eventDateInput?.value || "").trim();
    const displayEventDate = formatRecordDate(eventDate);
    const eventType = String(elements.eventTypeInput?.value || "").trim();
    const normalizedEventType = normalizeEventType(eventType);
    const memberStatus = String(elements.memberStatusInput?.value || "").trim() || (normalizedEventType === "suporte" ? "SUPORTE" : "");
    const eventDescription = String(elements.eventDescriptionInput?.value || "").trim();
    const delayMultiple = String(elements.delayMultipleInput?.value || "").trim();
    const substitute = String(elements.substituteInput?.value || "").trim();
    const shift = String(elements.shiftInput?.value || "").trim();
    const payer = String(elements.payerInput?.value || "").trim();
    const creditor = String(elements.creditorInput?.value || "").trim();
    const amountToPay = formatStoredCurrency(elements.amountToPayInput?.value);
    const origin = "PWA Eventos de escala";
    const createdAtIso = isEditingEventRecord()
      ? String(activeEventRecordEdit.timestampRaw || activeEventRecordEdit.timestamp || new Date().toISOString()).trim()
      : new Date().toISOString();
    const updatedBy = getEventEntryEditorLabel();
    const editMetadata = isEditingEventRecord() ? {
      operation: "update",
      id:activeEventRecordEdit.record.id,version:activeEventRecordEdit.record.version,
      rowIndex: activeEventRecordEdit.rowIndex,
      originalTimestamp: activeEventRecordEdit.timestampRaw || activeEventRecordEdit.timestamp,
      originalHistory: activeEventRecordEdit.history || "",
      originalDataDoEvento: activeEventRecordEdit.record?.dataDoEvento || "",
      originalMembro: activeEventRecordEdit.record?.membro || "",
      originalTipo: activeEventRecordEdit.record?.tipo || "",
      originalDescricao: activeEventRecordEdit.record?.descricao || "",
      originalMultiplo: activeEventRecordEdit.record?.multiplo || "",
      originalSubstituto: activeEventRecordEdit.record?.substituto || "",
      originalTurno: activeEventRecordEdit.record?.turno || "",
      originalPagador: activeEventRecordEdit.record?.pagador || "",
      originalCredor: activeEventRecordEdit.record?.credor || "",
      originalValor: activeEventRecordEdit.record?.valor || "",
      updatedBy
    } : {};

    const payload = {
      data: displayEventDate,
      dataDoEvento: displayEventDate,
      siglaEvento: activeEventLaunch?.sigla
        ? `${eventSharedSiglaPrefix}${activeEventLaunch.sigla}`
        : "",
      ausente: memberStatus,
      membroAusenteAtrasado: memberStatus,
      evento: eventType,
      tipoDeEvento: eventType,
      eventoDescricao: eventDescription,
      descricaoDoEvento: eventDescription,
      atrasoTempo: delayMultiple,
      multiploDoAtraso: delayMultiple,
      presente: substitute,
      membroSubstituto: substitute,
      turno: shift,
      devedor: payer,
      pagador: payer,
      responsavelPeloOnus: payer,
      credor: creditor,
      resultadoCredor: creditor,
      valorPagar: amountToPay,
      valorAPagar: amountToPay,
      origem: origin,
      updatedBy,
      userEmail: updatedBy,
      criadoEm: createdAtIso,
      criadoEmIso: createdAtIso,
      ...editMetadata
    };

    return window.SAHMT_AUTH?.withPayload ? window.SAHMT_AUTH.withPayload(payload) : payload;
  }

  async function postEventEntryPayload(payload){return Services.saveEvent(payload);}

  const pendingEventSubmissionsKey = "sahmt-eventos-pending-submissions-v1";

  function stripEventAuthPayload(payload) {
    const {
      authToken,
      deviceToken,
      userEmail,
      userName,
      ...safePayload
    } = payload || {};
    return safePayload;
  }

  function readPendingEventSubmissions(){return Services.pending("eventos.save");}

  function queueEventSubmission(){throw new Error("O envio não foi confirmado. Revise o formulário.");}

  async function flushPendingEventSubmissions(options={}){try{const r=await Services.flush();updatePendingEventStatus();if(r.sent){await hydrateEventRecords();await hydrateSharedSiglaState();if(options.notify)showPendingSendConfirmation(r.sent);}}catch{updatePendingEventStatus();}}

  function commitEventSiglaFromPayload(payload) {
    const rawSigla = String(payload?.siglaEvento || "").trim().toUpperCase();
    const sigla = rawSigla.startsWith(eventSharedSiglaPrefix)
      ? rawSigla.slice(eventSharedSiglaPrefix.length).trim()
      : rawSigla;
    const dateKey = normalizeRecordDate(payload?.dataDoEvento || payload?.data);
    if (!sigla || !dateKey) {
      return;
    }
    if (!Array.isArray(siglaEventState[dateKey])) {
      siglaEventState[dateKey] = [];
    }
    if (!siglaEventState[dateKey].includes(sigla)) {
      siglaEventState[dateKey].push(sigla);
      saveSiglaEventState();
    }
  }

  function updatePendingEventStatus() {
    if (elements.pendingEventStatus) {
      elements.pendingEventStatus.hidden = readPendingEventSubmissions().length === 0;
    }
  }

  function resetEventEntryForm(dateKey) {
    if (!elements.eventEntryForm) {
      return;
    }

    elements.eventEntryForm.reset();
    activeEventRecordEdit = null;
    supportShortcutLaunchActive = false;
    resetAutoFilledFieldLocks();
    populateEventEntryOptionLists();
    clearNewEventEntryFields();
    syncEventEntryModeUi();

    if (elements.eventDateInput) {
      elements.eventDateInput.value = dateKey || elements.dateInput?.value || todayKey;
    }

    if (elements.originInput) {
      elements.originInput.value = "PWA Eventos de escala";
    }

    updateEventEntryState();
  }

  function clearNewEventEntryFields() {
    if (isEditingEventRecord()) {
      return;
    }

    if (elements.eventTypeInput) {
      setSelectControlValue(elements.eventTypeInput, "");
    }
    if (elements.eventDescriptionInput) {
      elements.eventDescriptionInput.value = "";
    }
    if (elements.delayMultipleInput) {
      setSelectControlValue(elements.delayMultipleInput, "");
    }
    if (elements.substituteInput) {
      setSelectControlValue(elements.substituteInput, "");
    }
    if (elements.shiftInput) {
      setSelectControlValue(elements.shiftInput, "");
    }
    if (elements.payerInput) {
      setSelectControlValue(elements.payerInput, "");
    }
    if (elements.creditorInput) {
      setSelectControlValue(elements.creditorInput, "");
    }
    if (elements.amountToPayInput) {
      elements.amountToPayInput.value = "";
    }
  }

  function validateEventEntryForm() {
    if (!elements.eventEntryForm) {
      return false;
    }

    const controls = [
      elements.eventDateInput,
      elements.memberStatusInput,
      elements.eventTypeInput,
      elements.eventDescriptionInput,
      elements.delayMultipleInput,
      elements.substituteInput,
      elements.shiftInput,
      elements.payerInput,
      elements.creditorInput,
      elements.amountToPayInput
    ].filter(Boolean);

    for (const control of controls) {
      const field = control.closest(".entry-field");
      const isVisible = !field?.classList.contains("hidden");
      const isRequired = control.required;
      const isDisabled = control.disabled;
      const value = String(control.value || "").trim();

      if (isVisible && isRequired && !isDisabled && !value) {
        const label = field?.querySelector("span")?.textContent || "campo obrigatorio";
        setEventEntryStatus(`Preencha o campo obrigatorio: ${label}.`, "error");
        control.focus();
        return false;
      }
    }

    if (!elements.eventEntryForm.reportValidity()) {
      return false;
    }

    return true;
  }

  function setEventEntrySubmitting(isSubmitting) {
    if (elements.submitEventEntryButton) {
      elements.submitEventEntryButton.disabled = isSubmitting;
      elements.submitEventEntryButton.textContent = isSubmitting ? "Salvando..." : getEventEntrySubmitLabel();
    }
  }

  function clearEventEntryStatus() {
    setEventEntryStatus("", "");
  }

  function setEventEntryStatus(message, tone) {
    if (!elements.eventEntryStatus) {
      return;
    }

    elements.eventEntryStatus.textContent = message;
    elements.eventEntryStatus.classList.toggle("hidden", !message);
    elements.eventEntryStatus.classList.toggle("is-error", tone === "error");
    elements.eventEntryStatus.classList.toggle("is-success", tone === "success");
  }

  async function hydrateMemberDirectory() {
    try {
      const cachedRows = loadSyncCache(listsSyncStorageKey);
      const rows = Array.isArray(cachedRows) ? cachedRows : await fetchEventListsRows();
      if (!Array.isArray(cachedRows)) {
        saveSyncCache(listsSyncStorageKey, rows);
      }
      const nextDirectory = new Map();
      const nextDcOptions = [];
      const nextFieldOptions = {
        eventTypes: [],
        delayMultiples: [],
        substitutes: [],
        shifts: [],
        payers: [],
        creditors: []
      };
      const nextEventTypeDefaults = new Map();

      rows.forEach((row) => {
        const devedorEntry = parseSiglaNameEntry(row[1]);
        if (devedorEntry) {
          nextDirectory.set(devedorEntry.sigla, devedorEntry);
        }

        const dcEntry = parseSiglaNameEntry(row[5]);
        if (dcEntry && !nextDcOptions.some((option) => option.sigla === dcEntry.sigla)) {
          nextDcOptions.push(dcEntry);
        }

        pushUniqueOption(nextFieldOptions.eventTypes, row[0]);
        pushUniqueOption(nextFieldOptions.delayMultiples, row[4]);
        pushUniqueOption(nextFieldOptions.shifts, row[3]);
        pushUniqueOption(nextFieldOptions.payers, row[1]);
        pushUniqueOption(nextFieldOptions.creditors, row[2]);

        const devedorName = extractDisplayName(row[1]);
        const creditorName = extractDisplayName(row[2]);
        if (devedorName && devedorName !== "CAIXA DA EQUIPE") {
          pushUniqueOption(nextFieldOptions.substitutes, devedorName);
        }
        if (creditorName && creditorName !== "CAIXA DA EQUIPE") {
          pushUniqueOption(nextFieldOptions.substitutes, creditorName);
        }

        const eventType = String(row[0] || "").trim();
        if (eventType) {
          nextEventTypeDefaults.set(eventType, {
            delayMultiple: String(row[4] || "").trim(),
            shift: String(row[3] || "").trim(),
            payer: String(row[1] || "").trim(),
            creditor: String(row[2] || "").trim()
          });
        }
      });

      if (nextDirectory.size) {
        memberDirectory = nextDirectory;
      }

      if (nextDcOptions.length) {
        dcMemberOptions = nextDcOptions;
      }

      if (nextFieldOptions.eventTypes.length) {
        eventFieldOptions = nextFieldOptions;
        populateEventEntryOptionLists();
      }

      if (nextEventTypeDefaults.size) {
        eventTypeDefaults = nextEventTypeDefaults;
      }

      if (Array.isArray(cachedRows)) {
        fetchEventListsRows().then((freshRows) => {
          saveSyncCache(listsSyncStorageKey, freshRows);
          hydrateMemberDirectoryFromRows(freshRows);
        }).catch(() => {});
      }
    } catch (error) {
      // Keep the built-in directory when the list sheet is temporarily unavailable.
    }
  }

  async function hydrateEventRecords() {
    toggle(elements.recordsLoadingState, true);

    try {
      const cachedRecords = loadSyncCache(recordsSyncStorageKey);
      if (Array.isArray(cachedRecords)) {
        eventRecords = cachedRecords;
        renderRecordsForDate(elements.recordsDateInput?.value || todayKey);
        if (isMonthlyRecordsModalOpen()) {
          renderMonthlyRecordsForMonth(elements.monthlyRecordsInput?.value || todayKey.slice(0, 7));
        }
      }
      eventRecords = await fetchEventRecordsRows();
      saveSyncCache(recordsSyncStorageKey, eventRecords);
    } catch (error) {
      // Preserve cached records when the live spreadsheet is temporarily slow.
    } finally {
      toggle(elements.recordsLoadingState, false);
      renderRecordsForDate(elements.recordsDateInput?.value || todayKey);
      if (isMonthlyRecordsModalOpen()) {
        renderMonthlyRecordsForMonth(elements.monthlyRecordsInput?.value || todayKey.slice(0, 7));
      }
    }
  }

  function hydrateMemberDirectoryFromRows(rows) {
    if (!Array.isArray(rows)) {
      return;
    }
    const nextDirectory = new Map();
    const nextDcOptions = [];
    const nextFieldOptions = { eventTypes: [], delayMultiples: [], substitutes: [], shifts: [], payers: [], creditors: [] };
    const nextEventTypeDefaults = new Map();
    rows.forEach((row) => {
      const devedorEntry = parseSiglaNameEntry(row[1]);
      if (devedorEntry) nextDirectory.set(devedorEntry.sigla, devedorEntry);
      const dcEntry = parseSiglaNameEntry(row[5]);
      if (dcEntry && !nextDcOptions.some((option) => option.sigla === dcEntry.sigla)) nextDcOptions.push(dcEntry);
      pushUniqueOption(nextFieldOptions.eventTypes, row[0]);
      pushUniqueOption(nextFieldOptions.delayMultiples, row[4]);
      pushUniqueOption(nextFieldOptions.shifts, row[3]);
      pushUniqueOption(nextFieldOptions.payers, row[1]);
      pushUniqueOption(nextFieldOptions.creditors, row[2]);
      const devedorName = extractDisplayName(row[1]);
      const creditorName = extractDisplayName(row[2]);
      if (devedorName && devedorName !== "CAIXA DA EQUIPE") pushUniqueOption(nextFieldOptions.substitutes, devedorName);
      if (creditorName && creditorName !== "CAIXA DA EQUIPE") pushUniqueOption(nextFieldOptions.substitutes, creditorName);
      const eventType = String(row[0] || "").trim();
      if (eventType) nextEventTypeDefaults.set(eventType, { delayMultiple: String(row[4] || "").trim(), shift: String(row[3] || "").trim(), payer: String(row[1] || "").trim(), creditor: String(row[2] || "").trim() });
    });
    if (nextDirectory.size) memberDirectory = nextDirectory;
    if (nextDcOptions.length) dcMemberOptions = nextDcOptions;
    if (nextFieldOptions.eventTypes.length) { eventFieldOptions = nextFieldOptions; populateEventEntryOptionLists(); }
    if (nextEventTypeDefaults.size) eventTypeDefaults = nextEventTypeDefaults;
  }

  function loadSyncCache(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw).value : null;
    } catch (error) {
      return null;
    }
  }

  function saveSyncCache(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
    } catch (error) {
      // Storage can be unavailable in private browsing; network sync still works.
    }
  }

  async function fetchEventRecordsRows(){return (await Services.eventRecords()).sort(compareEventRecordsDesc);}

  function upsertRecentEventRecord(payload, result) {
    if (!payload) {
      return;
    }

    const baseRecord = activeEventRecordEdit?.record || null;
    const localEditHistory = isEditingEventRecord() ? buildEventEditHistoryEntry(baseRecord, payload, result?.updatedBy || payload.updatedBy) : "";
    const editHistory = localEditHistory || String(result?.history || payload.editHistory || "").trim();

    const nextRecord = {
      id:result?.record?.id||baseRecord?.id,version:result?.record?.version||baseRecord?.version,
      rowIndex: Number.parseInt(String(result?.rowIndex || payload.rowIndex || activeEventRecordEdit?.rowIndex || ""), 10) || null,
      timestampRaw: String(payload.criadoEmIso || payload.criadoEm || new Date().toISOString()).trim(),
      timestamp: formatRecordTimestamp(payload.criadoEmIso || payload.criadoEm || new Date().toISOString()),
      dataDoEvento: formatRecordDate(payload.dataDoEvento || payload.data),
      dataDoEventoKey: normalizeRecordDate(payload.dataDoEvento || payload.data),
      membro: String(payload.membroAusenteAtrasado || payload.ausente || "").trim(),
      tipo: String(payload.tipoDeEvento || payload.evento || "").trim(),
      descricao: String(payload.descricaoDoEvento || payload.eventoDescricao || "").trim(),
      multiplo: String(payload.multiploDoAtraso || payload.atrasoTempo || "").trim(),
      substituto: String(payload.membroSubstituto || payload.presente || "").trim(),
      turno: String(payload.turno || "").trim(),
      pagador: String(payload.pagador || payload.devedor || payload.responsavelPeloOnus || "").trim(),
      credor: String(payload.credor || payload.resultadoCredor || "").trim(),
      valor: formatStoredCurrency(payload.valorAPagar || payload.valorPagar),
      origem: String(payload.origem || "PWA Eventos de escala").trim(),
      history: String(editHistory || activeEventRecordEdit?.history || "").trim(),
      registeredBy: String(
        activeEventRecordEdit?.record?.registeredBy
          || payload.userEmail
          || payload.updatedBy
          || getAuthenticatedEmail()
          || ""
      ).trim().toLowerCase()
    };

    if (!nextRecord.dataDoEventoKey) {
      return;
    }

    if (isEditingEventRecord() && activeEventRecordEdit?.timestampRaw) {
      nextRecord.timestampRaw = activeEventRecordEdit.timestampRaw;
      nextRecord.timestamp = activeEventRecordEdit.timestamp;
    }

    eventRecords = [
      nextRecord,
      ...eventRecords.filter((record) => !isSameEventRecord(record, nextRecord) && !isSameRecordRow(record, nextRecord))
    ].sort(compareEventRecordsDesc);
  }

  function isSameEventRecord(left, right) {
    return [
      left?.rowIndex,
      left?.timestamp,
      left?.timestampRaw,
      left?.dataDoEventoKey,
      left?.membro,
      left?.tipo,
      left?.descricao,
      left?.multiplo,
      left?.substituto,
      left?.turno,
      left?.pagador,
      left?.credor,
      left?.valor,
      left?.history
    ].join("||") === [
      right?.rowIndex,
      right?.timestamp,
      right?.timestampRaw,
      right?.dataDoEventoKey,
      right?.membro,
      right?.tipo,
      right?.descricao,
      right?.multiplo,
      right?.substituto,
      right?.turno,
      right?.pagador,
      right?.credor,
      right?.valor,
      right?.history
    ].join("||");
  }

  function isSameRecordRow(left, right) {
    return Number(left?.rowIndex || 0) > 0 && Number(left?.rowIndex || 0) === Number(right?.rowIndex || -1);
  }

  function dedupeEventRecords(records) {
    const grouped = new Map();

    (records || []).forEach((record) => {
      const key = buildEventRecordIdentity(record);
      const current = grouped.get(key);
      if (!current || shouldReplaceEventRecord(current, record)) {
        grouped.set(key, record);
      }
    });

    return Array.from(grouped.values());
  }

  function buildEventRecordIdentity(record) {
    return [
      String(record?.timestampRaw || record?.timestamp || "").trim(),
      String(record?.membro || "").trim()
    ].join("||");
  }

  function shouldReplaceEventRecord(current, candidate) {
    const currentHistory = String(current?.history || "").trim();
    const candidateHistory = String(candidate?.history || "").trim();
    if (!currentHistory && candidateHistory) {
      return true;
    }
    if (currentHistory && !candidateHistory) {
      return false;
    }

    const currentRowIndex = Number(current?.rowIndex || 0);
    const candidateRowIndex = Number(candidate?.rowIndex || 0);
    if (candidateRowIndex !== currentRowIndex) {
      return candidateRowIndex > currentRowIndex;
    }

    return compareEventRecordsDesc(candidate, current) < 0;
  }

  function formatRecordTimestamp(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value || "").trim();
    }

    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(parsed);
  }

  function compareEventRecordsDesc(left, right) {
    const leftTime = Date.parse(left?.timestampRaw || left?.timestamp || "");
    const rightTime = Date.parse(right?.timestampRaw || right?.timestamp || "");

    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    const leftDateKey = String(left?.dataDoEventoKey || "");
    const rightDateKey = String(right?.dataDoEventoKey || "");
    if (leftDateKey !== rightDateKey) {
      return rightDateKey.localeCompare(leftDateKey);
    }

    return String(right?.membro || "").localeCompare(String(left?.membro || ""), "pt-BR");
  }

  function compareEventRecordsAsc(left, right) {
    const leftDateKey = String(left?.dataDoEventoKey || "");
    const rightDateKey = String(right?.dataDoEventoKey || "");
    if (leftDateKey !== rightDateKey) {
      return leftDateKey.localeCompare(rightDateKey);
    }

    const leftTime = Date.parse(left?.timestampRaw || left?.timestamp || "");
    const rightTime = Date.parse(right?.timestampRaw || right?.timestamp || "");
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return String(left?.membro || "").localeCompare(String(right?.membro || ""), "pt-BR");
  }

  function renderRecordsForDate(dateKey) {
    if (!elements.recordsList || !elements.recordsEmptyState) {
      return;
    }

    const activeDate = String(dateKey || todayKey).trim();
    const records = eventRecords.filter((record) => record.dataDoEventoKey === activeDate);
    elements.recordsList.innerHTML = "";
    toggle(elements.recordsEmptyState, records.length === 0);

    records.forEach((record, index) => {
      const card = document.createElement("article");
      card.className = `record-card record-card--tone-${(index % 4) + 1}`;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `Editar registro de ${record.membro || record.tipo || "evento"}`);

      const number = document.createElement("div");
      number.className = "record-card__number";
      number.textContent = String(index + 1);
      card.appendChild(number);

      const rows = document.createElement("div");
      rows.className = "record-card__rows";

      [
        ["Data do Evento", record.dataDoEvento],
        ["Membro", record.membro],
        ["Tipo de Evento", record.tipo],
        ["Descricao do evento", record.descricao],
        ["Multiplo do atraso", record.multiplo],
        ["Substituto", record.substituto],
        ["Turno", record.turno],
        ["Pagador", record.pagador],
        ["Credor", record.credor],
        ["Valor a pagar", formatStoredCurrency(record.valor)],
        ["Responsável pelo Registro", `${getRecordResponsible(record)}${record.timestamp ? ` - ${record.timestamp}` : ""}`],
        ["Edicao de Registro", String(record.history || "").trim()]
      ]
        .filter(([, value]) => String(value || "").trim())
        .forEach(([label, value]) => {
          const row = document.createElement("div");
          row.className = "record-card__row";
          if (label === "Edicao de Registro") {
            row.classList.add("record-card__row--history");
          }
          if (label === "Responsável pelo Registro") {
            row.classList.add("record-card__row--registration");
          }

          const labelElement = document.createElement("span");
          labelElement.className = "record-card__label";
          if (label === "Edicao de Registro") {
            labelElement.classList.add("record-card__label--history");
          }
          if (label === "Responsável pelo Registro") {
            labelElement.classList.add("record-card__label--registration");
          }
          labelElement.textContent = label;

          const valueElement = document.createElement("span");
          valueElement.className = "record-card__value";
          if (label === "Edicao de Registro") {
            row.appendChild(labelElement);
            appendHistoryDisplayBlock(row, value);
            rows.appendChild(row);
            return;
          }
          valueElement.textContent = value;
          row.appendChild(labelElement);
          row.appendChild(valueElement);
          rows.appendChild(row);
        });

      card.appendChild(rows);

      if (canWriteEventData()) {
        const actions = document.createElement("div");
        actions.className = "record-card__actions";
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "record-card__edit-button";
        editButton.textContent = "EDITAR REGISTRO";
        editButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          startEventRecordEdit(record);
        });
        actions.appendChild(editButton);
        card.appendChild(actions);
      }
      elements.recordsList.appendChild(card);
    });
  }

  function renderMonthlyRecordsForMonth(monthKey) {
    if (!elements.monthlyRecordsList || !elements.monthlyRecordsEmptyState || !elements.monthlyRecordsSummary) {
      return;
    }

    const activeMonth = normalizeMonthKey(monthKey) || todayKey.slice(0, 7);
    const records = getMonthlyRecords(activeMonth);
    elements.monthlyRecordsList.innerHTML = "";
    toggle(elements.monthlyRecordsEmptyState, records.length === 0);
    elements.monthlyRecordsSummary.textContent = `${formatMonthLabel(activeMonth)} - ${records.length} registro${records.length === 1 ? "" : "s"}`;

    records.forEach((record, index) => {
      const card = document.createElement("article");
      card.className = `record-card record-card--tone-${(index % 4) + 1}`;

      const number = document.createElement("div");
      number.className = "record-card__number";
      number.textContent = String(index + 1);
      card.appendChild(number);

      const rows = document.createElement("div");
      rows.className = "record-card__rows";

      [
        ["Data do Evento", record.dataDoEvento],
        ["Membro", record.membro],
        ["Tipo de Evento", record.tipo],
        ["Descricao", record.descricao],
        ["Multiplo do atraso", record.multiplo],
        ["Substituto", record.substituto],
        ["Turno", record.turno],
        ["Pagador", record.pagador],
        ["Credor", record.credor],
        ["Valor", formatStoredCurrency(record.valor)]
      ]
        .filter(([, value]) => String(value || "").trim())
        .forEach(([label, value]) => {
          const row = document.createElement("div");
          row.className = "record-card__row";
          if (label === "Edicao de Registro") {
            row.classList.add("record-card__row--history");
          }
          if (label === "Responsável pelo Registro") {
            row.classList.add("record-card__row--registration");
          }

          const labelElement = document.createElement("span");
          labelElement.className = "record-card__label";
          if (label === "Edicao de Registro") {
            labelElement.classList.add("record-card__label--history");
          }
          if (label === "Responsável pelo Registro") {
            labelElement.classList.add("record-card__label--registration");
          }
          labelElement.textContent = label;

          const valueElement = document.createElement("span");
          valueElement.className = "record-card__value";
          if (label === "Edicao de Registro") {
            row.appendChild(labelElement);
            appendHistoryDisplayBlock(row, value);
            rows.appendChild(row);
            return;
          }
          valueElement.textContent = value;
          row.appendChild(labelElement);
          row.appendChild(valueElement);
          rows.appendChild(row);
        });

      card.appendChild(rows);
      elements.monthlyRecordsList.appendChild(card);
    });
  }

  function getMonthlyRecords(monthKey) {
    const normalizedMonth = normalizeMonthKey(monthKey);
    return eventRecords
      .filter((record) => String(record?.dataDoEventoKey || "").startsWith(`${normalizedMonth}-`))
      .sort(compareEventRecordsAsc);
  }

  function startEventRecordEdit(record) {
    if (!canWriteEventData()) {
      showReadOnlyNotice();
      return;
    }
    if (!record) {
      return;
    }

    activeEventRecordEdit = {
      rowIndex: record.rowIndex,
      timestampRaw: record.timestampRaw,
      timestamp: record.timestamp,
      history: record.history || "",
      record: { ...record }
    };

    resetAutoFilledFieldLocks();
    populateEventEntryOptionLists();

    if (elements.eventDateInput) {
      elements.eventDateInput.value = record.dataDoEventoKey || todayKey;
    }
    if (elements.memberStatusInput) {
      elements.memberStatusInput.value = record.membro || "";
    }
    if (elements.eventTypeInput) {
      setSelectControlValue(elements.eventTypeInput, record.tipo || "");
    }
    if (elements.eventDescriptionInput) {
      elements.eventDescriptionInput.value = record.descricao || "";
    }
    if (elements.delayMultipleInput) {
      setSelectControlValue(elements.delayMultipleInput, record.multiplo || "");
    }
    if (elements.substituteInput) {
      setSelectControlValue(elements.substituteInput, record.substituto || "");
    }
    if (elements.shiftInput) {
      setSelectControlValue(elements.shiftInput, record.turno || "");
    }
    if (elements.payerInput) {
      setSelectControlValue(elements.payerInput, record.pagador || "");
    }
    if (elements.creditorInput) {
      setSelectControlValue(elements.creditorInput, record.credor || "");
    }
    if (elements.amountToPayInput) {
      elements.amountToPayInput.value = formatStoredCurrency(record.valor);
    }

    openEventEntryModal();
  }

  function isEditingEventRecord() {
    return Boolean(activeEventRecordEdit && Number(activeEventRecordEdit.rowIndex || 0) > 0);
  }

  function syncEventEntryModeUi() {
    elements.eventEntryModal?.classList.toggle("entry-modal--editing", isEditingEventRecord());

    if (elements.eventEntryKicker) {
      elements.eventEntryKicker.textContent = isEditingEventRecord() ? "Editar registro do evento" : "Lançamento do evento";
    }

    if (elements.submitEventEntryButton) {
      elements.submitEventEntryButton.textContent = getEventEntrySubmitLabel();
    }
  }

  function getEventEntrySubmitLabel() {
    return isEditingEventRecord() ? "Salvar alteracao" : "Salvar na planilha";
  }

  function normalizeMonthKey(value) {
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}$/.test(text) ? text : "";
  }

  function formatMonthLabel(monthKey) {
    const normalized = normalizeMonthKey(monthKey);
    if (!normalized) {
      return "Mes invalido";
    }

    return new Intl.DateTimeFormat("pt-BR", {
      month: "long",
      year: "numeric"
    }).format(new Date(`${normalized}-01T12:00:00`));
  }

  function setMonthlyRecordsStatus(message, tone) {
    if (!elements.monthlyRecordsStatus) {
      return;
    }

    elements.monthlyRecordsStatus.textContent = message;
    elements.monthlyRecordsStatus.classList.toggle("hidden", !message);
    elements.monthlyRecordsStatus.classList.toggle("is-error", tone === "error");
    elements.monthlyRecordsStatus.classList.toggle("is-success", tone === "success");
  }

  function clearMonthlyRecordsStatus() {
    setMonthlyRecordsStatus("", "");
  }

  async function shareMonthlyRecordsPdf() {
    const monthKey = normalizeMonthKey(elements.monthlyRecordsInput?.value || todayKey.slice(0, 7));
    const records = getMonthlyRecords(monthKey);

    if (!records.length) {
      setMonthlyRecordsStatus("Nao ha registros no mes escolhido para gerar o PDF.", "error");
      return;
    }

    setMonthlyRecordsStatus("Gerando PDF mensal...", "");

    try {
      const pdfFile = await buildMonthlyRecordsPdfFile(monthKey, records);
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        await navigator.share({
          title: `Registros ${formatMonthLabel(monthKey)}`,
          text: `Registros mensais de ${formatMonthLabel(monthKey)}.`,
          files: [pdfFile]
        });
        setMonthlyRecordsStatus("PDF pronto para envio no WhatsApp.", "success");
        return;
      }

      const shareUrl = `https://wa.me/?text=${encodeURIComponent(`Relatorio mensal pronto: ${pdfFile.name}`)}`;
      window.open(shareUrl, "_blank", "noopener");
      setMonthlyRecordsStatus("Seu aparelho nao permite anexar o PDF direto. Abri o WhatsApp para compartilhar a mensagem.", "error");
    } catch (error) {
      const detail = String(error?.message || "").trim();
      setMonthlyRecordsStatus(`Nao foi possivel gerar ou compartilhar o PDF.${detail ? ` ${detail}` : ""}`, "error");
    }
  }

  async function buildMonthlyRecordsPdfFile(monthKey, records) {
    await window.SAHMT_SHELL.ensurePdf();
    const jsPdfNamespace = window.jspdf;
    if (!jsPdfNamespace?.jsPDF) {
      throw new Error("Biblioteca de PDF indisponivel.");
    }

    const pdf = new jsPdfNamespace.jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4"
    });

    const title = `Registros de ${formatMonthLabel(monthKey)}`;
    pdf.setFillColor(13, 50, 87);
    pdf.rect(0, 0, pdf.internal.pageSize.getWidth(), 84, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(18);
    pdf.text(title, 40, 42);
    pdf.setFontSize(10);
    pdf.text(`Gerado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}`, 40, 62);
    pdf.setTextColor(20, 50, 84);

    const optionalPdfColumns = [
      ["Descrição", (record) => record.descricao],
      ["Múltiplo do atraso", (record) => record.multiplo],
      ["Substituto", (record) => record.substituto],
      ["Turno", (record) => record.turno],
      ["Pagador", (record) => record.pagador],
      ["Credor", (record) => record.credor],
      ["Valor", (record) => formatStoredCurrency(record.valor)],
    ].filter(([, getValue]) => records.some((record) => String(getValue(record) || "").trim()));
    const pdfColumns = [
      ["#", (record, index) => String(index + 1)],
      ["Data", (record) => record.dataDoEvento],
      ["Membro", (record) => record.membro],
      ["Tipo de Evento", (record) => record.tipo],
      ...optionalPdfColumns,
    ];
    const dateGroups = [];
    const dateGroupByRecord = records.map((record) => {
      const dateKey = String(record.dataDoEventoKey || record.dataDoEvento || "").trim();
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

    pdf.autoTable({
      startY: 100,
      head: [pdfColumns.map(([label]) => label)],
      body: records.map((record, index) => pdfColumns.map(([, getValue]) => getValue(record, index) || "")),
      theme: "grid",
      styles: {
        fontSize: 8,
        cellPadding: 5,
        lineColor: [220, 228, 238],
        lineWidth: 0.5,
        textColor: [20, 50, 84],
        overflow: "linebreak"
      },
      headStyles: {
        fillColor: [13, 50, 87],
        textColor: [255, 255, 255],
        fontStyle: "bold"
      },
      alternateRowStyles: {
        fillColor: [247, 242, 232]
      },
      didParseCell(data) {
        if (data.section === "body") {
          const group = dateGroupByRecord[data.row.index] || { groupIndex: 0, rowInGroup: 0 };
          const dateFills = [[189, 224, 235], [208, 231, 216], [244, 218, 181], [218, 216, 241]];
          const rowFills = [[248, 252, 250], [242, 247, 252]];
          if (data.column.index === dateColumnIndex) {
            data.cell.styles.fillColor = dateFills[group.groupIndex % dateFills.length];
            data.cell.styles.fontStyle = "bold";
          } else {
            data.cell.styles.fillColor = rowFills[group.rowInGroup % rowFills.length];
          }
        }
      },
      margin: {
        left: 24,
        right: 24,
        bottom: 48
      }
    });

    const blob = pdf.output("blob");
    return new File([blob], `registros-${monthKey}.pdf`, { type: "application/pdf" });
  }

  function formatRecordHistoryForDisplay(value) {
    const text = String(value || "").trim();
    if (!text) {
      return "";
    }

    return text
      .replace(/\s*\n+\s*/g, " - ")
      .replace(/^Alterado em\s+/i, "Editado em ")
      .replace(/\s+\|\s+/g, ". ")
      .replace(/:\s*"([^"]*)"\s*->\s*"([^"]*)"/g, ': $1 -> $2')
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function appendHistoryDisplayBlock(row, value) {
    if (!row) {
      return;
    }

    const entries = parseRecordHistoryEntries(value);
    const container = document.createElement("div");
    container.className = "record-card__history";

    if (!entries.length) {
      const fallback = document.createElement("div");
      fallback.className = "record-card__history-entry";
      fallback.textContent = String(value || "").trim();
      container.appendChild(fallback);
    } else {
      entries.forEach((entry) => {
        const block = document.createElement("div");
        block.className = "record-card__history-entry";

        appendHistoryLine(block, "Data", entry.data);
        appendHistoryLine(block, "Responsável", entry.responsavel);
        const states = splitHistoryStates(entry.alteracao);
        appendHistoryLine(block, "Estado inicial", states.initial);
        appendHistoryLine(block, "Estado editado", states.edited);
        container.appendChild(block);
      });
    }

    row.appendChild(container);
  }

  function appendHistoryLine(container, label, value) {
    const text = String(value || "").trim();
    if (!container || !text) {
      return;
    }

    const line = document.createElement("div");
    line.className = "record-card__history-line";

    const labelElement = document.createElement("span");
    labelElement.className = "record-card__history-label";
    labelElement.textContent = `${label}:`;

    const valueElement = document.createElement("span");
    valueElement.className = "record-card__history-value";
    valueElement.textContent = text;

    line.appendChild(labelElement);
    line.appendChild(valueElement);
    container.appendChild(line);
  }

  function splitHistoryStates(value) {
    const initial = [];
    const edited = [];
    String(value || "").split(/;\s*/).filter(Boolean).forEach((change) => {
      const match = change.match(/^([^:]+):\s*(.*?)\s*->\s*(.*)$/);
      if (match) {
        initial.push(`${match[1].trim()}: ${match[2].trim()}`);
        edited.push(`${match[1].trim()}: ${match[3].trim()}`);
      } else {
        edited.push(change.trim());
      }
    });
    return {
      initial: initial.join("; ") || "Não informado",
      edited: edited.join("; ") || "Não informado"
    };
  }

  function parseRecordHistoryEntries(value) {
    const text = String(value || "").trim();
    if (!text) {
      return [];
    }

    return text
      .split(/\n{2,}/)
      .map((chunk) => parseRecordHistoryEntry(chunk))
      .filter(Boolean);
  }

  function parseRecordHistoryEntry(value) {
    const raw = String(value || "").replace(/\r/g, "").trim();
    if (!raw) {
      return null;
    }

    const entry = {
      data: "",
      responsavel: "",
      alteracao: ""
    };

    raw.split(/\n+/).map((line) => String(line || "").trim()).filter(Boolean).forEach((line) => {
      const dataMatch = line.match(/^(?:Data|Alterado em):\s*(.+)$/i);
      if (dataMatch) {
        entry.data = dataMatch[1].trim();
        return;
      }

      const responsavelMatch = line.match(/^Respons[aá]vel:\s*(.+)$/i);
      if (responsavelMatch) {
        entry.responsavel = responsavelMatch[1].trim();
        return;
      }

      const alteracaoMatch = line.match(/^(?:Altera[cç][aã]o|Mudan[cç]a):\s*(.+)$/i);
      if (alteracaoMatch) {
        entry.alteracao = alteracaoMatch[1].trim();
        return;
      }
    });

    if (!entry.data) {
      const legacyDateMatch = raw.match(/^Alterado em\s+([^|]+)(?:\s*\|\s*(.*))?$/i);
      if (legacyDateMatch) {
        entry.data = legacyDateMatch[1].trim();
        if (legacyDateMatch[2] && !entry.alteracao) {
          entry.alteracao = legacyDateMatch[2].trim();
        }
      }
    }

    if (!entry.responsavel) {
      entry.responsavel = getAuthenticatedEmail() || "Responsável não informado";
    }

    if (!entry.alteracao) {
      const trailingText = raw
        .replace(/^(?:Data|Alterado em):\s*.+$/im, "")
        .replace(/^Respons[aá]vel:\s*.+$/im, "")
        .replace(/^(?:Altera[cç][aã]o|Mudan[cç]a):\s*/im, "")
        .trim();
      entry.alteracao = trailingText || raw;
    }

    return entry;
  }

  function buildEventEditHistoryEntry(previousRecord, payload, updatedBy) {
    const current = previousRecord || {};
    const next = {
      dataDoEvento: formatRecordDate(payload?.dataDoEvento || payload?.data),
      membro: String(payload?.membroAusenteAtrasado || payload?.ausente || "").trim(),
      tipo: String(payload?.tipoDeEvento || payload?.evento || "").trim(),
      descricao: String(payload?.descricaoDoEvento || payload?.eventoDescricao || "").trim(),
      multiplo: String(payload?.multiploDoAtraso || payload?.atrasoTempo || "").trim(),
      substituto: String(payload?.membroSubstituto || payload?.presente || "").trim(),
      turno: String(payload?.turno || "").trim(),
      pagador: String(payload?.pagador || payload?.devedor || payload?.responsavelPeloOnus || "").trim(),
      credor: String(payload?.credor || payload?.resultadoCredor || "").trim(),
      valor: formatStoredCurrency(payload?.valorAPagar || payload?.valorPagar)
    };

    const changes = [
      ["Data do Evento", current.dataDoEvento, next.dataDoEvento],
      ["MEMBRO (AUSENTE/ATRASADO)", current.membro, next.membro],
      ["Tipo de Evento", current.tipo, next.tipo],
      ["Descricao do evento", current.descricao, next.descricao],
      ["Multiplo do atraso", current.multiplo, next.multiplo],
      ["SUBSTITUTO", current.substituto, next.substituto],
      ["TURNO", current.turno, next.turno],
      ["PAGADOR", current.pagador, next.pagador],
      ["CREDOR", current.credor, next.credor],
      ["VALOR A PAGAR", current.valor, next.valor]
    ]
      .filter(([, previousValue, nextValue]) => String(previousValue || "").trim() !== String(nextValue || "").trim())
      .map(([label, previousValue, nextValue]) => `${label}: "${String(previousValue || "").trim()}" -> "${String(nextValue || "").trim()}"`);

    if (!changes.length) {
      return "";
    }

    return [
      `Data: ${formatHistoryTimestamp(new Date())}`,
      `Responsável: ${String(updatedBy || getEventEntryEditorLabel()).trim()}`,
      `Alteração: ${changes.join("; ")}`
    ].join("\n");
  }

  function formatHistoryTimestamp(value) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value || "").trim();
    }

    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(parsed);
  }

  function getEventEntryEditorLabel() {
    return getAuthenticatedEmail() || "";
  }

  function getRecordResponsible(record) {
    return String(
      record?.registeredBy
        || record?.responsavelPeloRegistro
        || record?.userEmail
        || getAuthenticatedEmail()
        || "Responsável não informado"
    ).trim().toLowerCase();
  }

  function getAuthenticatedEmail() {
    const sessionEmail = String(window.SAHMT_AUTH?.getSession?.()?.email || "").trim();
    const userEmail = String(currentAccessLabel || sessionEmail || window.SAHMT_AUTH?.getUserLabel?.() || "").trim().toLowerCase();
    if (userEmail) {
      return userEmail;
    }
    return "";
  }

  function buildMonthlyCreditorSummaryRows(records) {
    const grouped = new Map();

    (records || []).forEach((record) => {
      const creditor = String(record?.credor || "").trim();
      const payer = String(record?.pagador || "").trim();
      if (!creditor || !payer) {
        return;
      }

      const groupKey = `${creditor}::${payer}`;
      const entry = grouped.get(groupKey) || {
        credor: creditor,
        pagador: payer,
        total: 0,
        datas: []
      };

      entry.total += parseCurrencyValue(record?.valor);

      const dateText = String(record?.dataDoEvento || "").trim();
      if (dateText) {
        entry.datas.push(dateText);
      }

      grouped.set(groupKey, entry);
    });

    return Array.from(grouped.values())
      .map((entry) => ({
        credor: entry.credor,
        pagador: entry.pagador,
        datas: dedupeValues(entry.datas).join(", "),
        total: entry.total,
        totalFormatado: formatCurrencyInput(entry.total)
      }))
      .filter((entry) => entry.total > 0)
      .sort((left, right) => {
        const creditorCompare = left.credor.localeCompare(right.credor, "pt-BR");
        if (creditorCompare !== 0) {
          return creditorCompare;
        }

        return left.pagador.localeCompare(right.pagador, "pt-BR");
      });
  }

  function parseCurrencyValue(value) {
    const text = String(value ?? "").trim();
    if (!text) {
      return 0;
    }

    const normalized = text
      .replace(/[R$\s]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function dedupeValues(values) {
    return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
  }

  function normalizeRecordDate(value) {
    const text = String(value || "").trim();
    if (!text) {
      return "";
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
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

  function formatRecordDate(value) {
    const normalizedDate = normalizeRecordDate(value);
    if (!normalizedDate) {
      return "";
    }

    return formatShort(normalizedDate);
  }

  function populateEventEntryOptionLists() {
    setSelectOptions(elements.eventTypeInput, eventFieldOptions.eventTypes, "Selecione o tipo de evento", {
      hiddenValues: supportShortcutLaunchActive ? [] : ["Suporte"]
    });
    setSelectOptions(elements.delayMultipleInput, eventFieldOptions.delayMultiples, "Selecione o multiplo");
    setSelectOptions(elements.substituteInput, eventFieldOptions.substitutes, "Selecione o substituto", {
      highlightedValues: highlightedEventPeople
    });
    setSelectOptions(elements.shiftInput, eventFieldOptions.shifts, "Selecione o turno");
    setSelectOptions(elements.payerInput, eventFieldOptions.payers, "Selecione o pagador");
    setSelectOptions(elements.creditorInput, eventFieldOptions.creditors, "Selecione o credor", {
      highlightedValues: highlightedEventPeople
    });
    updateEventEntryState();
  }

  function setSelectOptions(select, options, placeholder, config = {}) {
    if (!select) {
      return;
    }

    const highlightedValues = Array.isArray(config.highlightedValues) ? config.highlightedValues : [];
    const hiddenValues = Array.isArray(config.hiddenValues) ? config.hiddenValues : [];
    const currentValue = String(select.value || "").trim();
    const uniqueOptions = Array.from(new Set((options || []).map((value) => String(value || "").trim()).filter(Boolean)));
    const currentOptionValue = uniqueOptions.includes(currentValue) ? currentValue : "";
    const normalizedHighlightedValues = Array.from(new Set(highlightedValues.map(normalizeSelectableValue).filter(Boolean)));
    const normalizedHiddenValues = new Set(hiddenValues.map(normalizeSelectableValue).filter(Boolean));
    const highlightedOptions = uniqueOptions.filter((value) => normalizedHighlightedValues.includes(normalizeSelectableValue(value)));
    select.dataset.highlightedValues = JSON.stringify(normalizedHighlightedValues);
    const remainingOptions = uniqueOptions.filter((value) => !normalizedHighlightedValues.includes(normalizeSelectableValue(value)));
    select.innerHTML = "";

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    placeholderOption.selected = !currentOptionValue;
    select.appendChild(placeholderOption);

    if (highlightedOptions.length) {
      appendOptionGroup(select, "", highlightedOptions, currentOptionValue, true, normalizedHiddenValues);
    }

    appendOptionGroup(select, "", remainingOptions, currentOptionValue, false, normalizedHiddenValues);

    syncHighlightedSelectState(select);
  }

  function appendOptionGroup(select, label, options, currentValue, isHighlighted, hiddenValues = new Set()) {
    if (!select || !Array.isArray(options) || !options.length) {
      return;
    }

    const container = label ? document.createElement("optgroup") : document.createDocumentFragment();
    if (label && container instanceof HTMLOptGroupElement) {
      container.label = label;
      container.className = isHighlighted ? "select-optgroup select-optgroup--highlight" : "select-optgroup";
    }

    options.forEach((optionValue) => {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = isHighlighted ? String(optionValue || "").toUpperCase() : optionValue;
      option.selected = currentValue === optionValue;
      if (hiddenValues.has(normalizeSelectableValue(optionValue))) {
        option.hidden = true;
        option.disabled = true;
      }
      if (isHighlighted) {
        option.className = "select-option-highlight";
      }
      container.appendChild(option);
    });

    select.appendChild(container);
  }

  function updateEventEntryState() {
    const eventType = String(elements.eventTypeInput?.value || "").trim();
    const normalizedEventType = normalizeEventType(eventType);
    const memberName = String(elements.memberStatusInput?.value || "").trim();
    const substitute = String(elements.substituteInput?.value || "").trim();
    const shift = String(elements.shiftInput?.value || "").trim();
    const delayMultiple = Number.parseFloat(String(elements.delayMultipleInput?.value || "").replace(",", "."));
    const rule = getEventEntryRule(normalizedEventType);
    const hideMemberStatus = normalizedEventType === "suporte";

    toggleEventField(elements.memberStatusInput, !hideMemberStatus);
    toggleEventField(elements.eventDescriptionInput, rule.showDescription);
    toggleEventField(elements.delayMultipleInput, rule.showDelayMultiple);
    toggleEventField(elements.substituteInput, !rule.hideSubstitute);
    toggleEventField(elements.shiftInput, rule.showShift);

    setFieldDisabled(elements.memberStatusInput, hideMemberStatus);
    setAutoFilledFieldLock(elements.eventTypeInput, supportShortcutLaunchActive && normalizedEventType === "suporte");
    setAutoFilledFieldLock(elements.payerInput, !isEditingEventRecord() && rule.autoPayer && Boolean(resolveEventEntryPayer(rule, memberName)));
    setAutoFilledFieldLock(elements.creditorInput, !isEditingEventRecord() && rule.autoCreditor && Boolean(resolveEventEntryCreditor(rule, substitute)));
    setAutoFilledFieldLock(elements.amountToPayInput, !isEditingEventRecord() && rule.autoAmount);

    setFieldDisabled(elements.substituteInput, rule.disableSubstitute);
    setFieldRequired(elements.eventDateInput, true);
    setFieldRequired(elements.memberStatusInput, !hideMemberStatus);
    setFieldRequired(elements.eventTypeInput, true);
    setFieldRequired(elements.eventDescriptionInput, rule.showDescription);
    setFieldRequired(elements.delayMultipleInput, rule.showDelayMultiple);
    setFieldRequired(elements.substituteInput, !rule.hideSubstitute && !rule.disableSubstitute);
    setFieldRequired(elements.shiftInput, rule.showShift);
    setFieldRequired(elements.payerInput, true);
    setFieldRequired(elements.creditorInput, true);
    setFieldRequired(elements.amountToPayInput, true);

    if (rule.disableSubstitute && elements.substituteInput) {
      elements.substituteInput.value = "";
    }

    if (hideMemberStatus && elements.memberStatusInput) {
      elements.memberStatusInput.value = "";
      setAutoFilledFieldLock(elements.memberStatusInput, false);
    }

    if (!rule.showDescription && elements.eventDescriptionInput) {
      elements.eventDescriptionInput.value = "";
    }

    if (!rule.showDelayMultiple && elements.delayMultipleInput) {
      elements.delayMultipleInput.value = "";
    }

    if (!rule.showShift && elements.shiftInput) {
      elements.shiftInput.value = "";
    }

    if (elements.payerInput && rule.autoPayer) {
      setSelectControlValue(elements.payerInput, resolveEventEntryPayer(rule, memberName));
    }

    if (elements.creditorInput && rule.autoCreditor) {
      setSelectControlValue(elements.creditorInput, resolveEventEntryCreditor(rule, substitute));
    }

    if (elements.amountToPayInput && rule.autoAmount) {
      const amount = resolveEventEntryAmount(rule, shift, Number.isFinite(delayMultiple) ? delayMultiple : 0);
      elements.amountToPayInput.value = formatCurrencyInput(amount);
    }

    syncEventEntryFieldStates();
  }

  function getEventEntryRule(normalizedEventType) {
    if (normalizedEventType === "atraso") {
      return {
        showDescription: false,
        showDelayMultiple: true,
        hideSubstitute: true,
        showShift: false,
        disableSubstitute: true,
        autoPayer: true,
        autoCreditor: true,
        autoAmount: true,
        payerMode: "member",
        creditorMode: "team",
        amountMode: "delay"
      };
    }

    if (normalizedEventType === "suporte") {
      return {
        showDescription: false,
        showDelayMultiple: false,
        hideSubstitute: false,
        showShift: true,
        disableSubstitute: false,
        autoPayer: true,
        autoCreditor: true,
        autoAmount: true,
        payerMode: "team",
        creditorMode: "substitute",
        amountMode: "shift"
      };
    }

    if (normalizedEventType === "gestao" || normalizedEventType === "congresso") {
      return {
        showDescription: false,
        showDelayMultiple: false,
        hideSubstitute: false,
        showShift: true,
        disableSubstitute: false,
        autoPayer: true,
        autoCreditor: true,
        autoAmount: true,
        payerMode: "team",
        creditorMode: "substitute",
        amountMode: "shift"
      };
    }

    if (normalizedEventType === "pessoal" || normalizedEventType === "ferias" || normalizedEventType === "saude" || normalizedEventType === "ausencia") {
      return {
        showDescription: false,
        showDelayMultiple: false,
        hideSubstitute: false,
        showShift: true,
        disableSubstitute: false,
        autoPayer: true,
        autoCreditor: true,
        autoAmount: normalizedEventType !== "ausencia",
        payerMode: "member",
        creditorMode: "substitute",
        amountMode: normalizedEventType === "ausencia" ? "manual" : "shift"
      };
    }

    if (normalizedEventType === "outros") {
      return {
        showDescription: true,
        showDelayMultiple: true,
        hideSubstitute: false,
        showShift: true,
        disableSubstitute: false,
        autoPayer: false,
        autoCreditor: true,
        autoAmount: false,
        payerMode: "manual",
        creditorMode: "substitute",
        amountMode: "manual"
      };
    }

    return {
      showDescription: false,
      showDelayMultiple: false,
      hideSubstitute: false,
      showShift: false,
      disableSubstitute: false,
      autoPayer: false,
      autoCreditor: false,
      autoAmount: false,
      payerMode: "manual",
      creditorMode: "manual",
      amountMode: "manual"
    };
  }

  function normalizeEventType(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function toggleEventField(control, shouldShow) {
    const field = control?.closest(".entry-field");
    if (!field) {
      return;
    }

    field.classList.toggle("hidden", !shouldShow);
  }

  function setFieldDisabled(control, disabled) {
    if (!control) {
      return;
    }

    control.dataset.baseDisabled = disabled ? "true" : "false";
    syncFieldInteractivity(control);
  }

  function setFieldRequired(control, required) {
    if (!control) {
      return;
    }

    control.required = required;
  }

  function setSelectControlValue(select, value) {
    if (!select) {
      return;
    }

    const text = String(value || "").trim();
    if (!text) {
      select.value = "";
      syncHighlightedSelectState(select);
      return;
    }

    const option = Array.from(select.options).find((item) => item.value === text);
    let selectedOption = option || null;
    if (!option) {
      const dynamicOption = document.createElement("option");
      dynamicOption.value = text;
      dynamicOption.textContent = text;
      select.appendChild(dynamicOption);
      selectedOption = dynamicOption;
    }

    if (selectedOption) {
      selectedOption.selected = true;
      select.value = selectedOption.value;
      select.selectedIndex = Array.from(select.options).indexOf(selectedOption);
    } else {
      select.value = text;
    }
    syncHighlightedSelectState(select);
  }

  function syncHighlightedSelectState(select) {
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }

    const highlightedValues = readHighlightedSelectValues(select);
    const currentValue = normalizeSelectableValue(select.value);
    select.classList.toggle("select-has-highlighted-value", highlightedValues.includes(currentValue));
  }

  function readHighlightedSelectValues(select) {
    if (!(select instanceof HTMLSelectElement)) {
      return [];
    }

    const raw = String(select.dataset.highlightedValues || "").trim();
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(normalizeSelectableValue).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function normalizeSelectableValue(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function resetAutoFilledFieldLocks() {
    autoFilledFieldLocks = new Set();
    syncAutoFilledFieldLocks();
  }

  function setAutoFilledFieldLock(control, shouldLock) {
    if (!control?.id) {
      return;
    }

    if (shouldLock) {
      autoFilledFieldLocks.add(control.id);
    } else {
      autoFilledFieldLocks.delete(control.id);
    }

    syncFieldInteractivity(control);
  }

  function hasAutoFilledFieldLock(control) {
    if (!control?.id || isEditingEventRecord()) {
      return false;
    }

    return autoFilledFieldLocks.has(control.id);
  }

  function syncAutoFilledFieldLocks() {
    [
      elements.memberStatusInput,
      elements.eventTypeInput,
      elements.payerInput,
      elements.creditorInput,
      elements.amountToPayInput,
      elements.substituteInput
    ].filter(Boolean).forEach(syncFieldInteractivity);
  }

  function syncFieldInteractivity(control) {
    if (!control) {
      return;
    }

    const field = control.closest(".entry-field");
    const baseDisabled = control.dataset.baseDisabled === "true";
    const autoLocked = hasAutoFilledFieldLock(control);
    const shouldDisableSelect = control instanceof HTMLSelectElement && (baseDisabled || autoLocked);

    if (control instanceof HTMLSelectElement) {
      control.disabled = shouldDisableSelect;
    } else {
      control.disabled = baseDisabled;
      control.readOnly = autoLocked;
      control.setAttribute("aria-readonly", autoLocked ? "true" : "false");
    }

    if (field) {
      field.classList.toggle("entry-field--disabled", baseDisabled || autoLocked);
      field.classList.toggle("entry-field--locked", autoLocked);
    }
  }

  function syncEventEntryFieldStates() {
    const controls = getEventEntryControls();
    const isComplete = controls
      .filter((control) => isVisibleEventEntryField(control) && control.required && !control.disabled)
      .every((control) => String(control.value || "").trim());

    controls.forEach((control) => {
      const field = control.closest(".entry-field");
      if (!field) {
        return;
      }

      const isVisible = isVisibleEventEntryField(control);
      const autoLocked = hasAutoFilledFieldLock(control);
      const isManualActive = isVisible && !control.disabled && !autoLocked;
      const hasValue = Boolean(String(control.value || "").trim());
      const isPending = isManualActive && control.required && !hasValue;
      const isCompleteField = isVisible && hasValue && (autoLocked || isComplete);

      field.classList.toggle("entry-field--pending", isPending);
      field.classList.toggle("entry-field--autofilled", isVisible && autoLocked && hasValue);
      field.classList.toggle("entry-field--complete", isCompleteField);
    });
  }

  function getEventEntryControls() {
    return [
      elements.eventDateInput,
      elements.memberStatusInput,
      elements.eventTypeInput,
      elements.eventDescriptionInput,
      elements.delayMultipleInput,
      elements.substituteInput,
      elements.shiftInput,
      elements.payerInput,
      elements.creditorInput,
      elements.amountToPayInput
    ].filter(Boolean);
  }

  function isVisibleEventEntryField(control) {
    return Boolean(control && !control.closest(".entry-field")?.classList.contains("hidden"));
  }

  function resolveEventEntryPayer(rule, memberStatus) {
    if (rule.payerMode === "team") {
      return "CAIXA DA EQUIPE";
    }

    return String(memberStatus || "").trim();
  }

  function resolveEventEntryCreditor(rule, substitute) {
    if (rule.creditorMode === "team") {
      return "CAIXA DA EQUIPE";
    }

    if (rule.creditorMode === "substitute") {
      return substitute;
    }

    return String(elements.creditorInput?.value || "").trim();
  }

  function resolveEventEntryAmount(rule, shift, delayMultiple) {
    if (rule.amountMode === "delay") {
      return delayMultiple > 0 ? delayMultiple * 200 : 0;
    }

    if (rule.amountMode === "shift") {
      const normalizedShift = normalizeShift(shift);
      if (normalizedShift === "manha" || normalizedShift === "tarde") {
        return 1000;
      }

      if (normalizedShift === "integral") {
        return 2000;
      }
    }

    return 0;
  }

  function normalizeShift(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function formatCurrencyInput(value) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value);
  }

  function formatStoredCurrency(value) {
    const text = String(value ?? "").trim();
    return text ? formatCurrencyInput(parseCurrencyValue(text)) : "";
  }

  async function fetchEventListsRows(){return Services.eventLists();}

  function getMemberChoicesForSigla(sigla, weekdayLabel) {
    const normalizedSigla = String(sigla || "").trim().toUpperCase();
    if (!normalizedSigla) {
      return [];
    }

    if (normalizedSigla === "DC") {
      const weekdayAliases = new Set((dcAliasesByWeekday.get(weekdayLabel) || []).map((value) => String(value || "").toUpperCase()));
      const weekdayOptions = dcMemberOptions.filter((option) => weekdayAliases.has(option.sigla));
      return weekdayOptions.length ? weekdayOptions : dcMemberOptions;
    }

    const rawParts = normalizedSigla.split(/[/-]/).map((value) => value.trim()).filter(Boolean);
    const choices = rawParts
      .map((part) => memberDirectory.get(part))
      .filter(Boolean);

    return dedupeMemberChoices(choices);
  }

  function dedupeMemberChoices(choices) {
    const seen = new Set();
    return choices.filter((choice) => {
      const key = `${choice.sigla}::${choice.name}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  function parseSiglaNameEntry(value) {
    const text = String(value || "").trim();
    if (!text) {
      return null;
    }

    const match = text.match(/^([A-Z0-9]{2})\s*-\s*(.+)$/);
    if (!match) {
      return null;
    }

    return {
      sigla: match[1].trim().toUpperCase(),
      name: match[2].trim(),
      label: text
    };
  }

  function buildFallbackMemberDirectory() {
    return new Map(
      [
        "AA - Adriano Neves de Almeida",
        "AD - Adelson Jose de Macedo",
        "AL - Alexandre de Castro Morais",
        "BA - Barbara Ribeiro Coutinho Leduc",
        "CH - Carlos Humberto Barbosa Ganem",
        "CR - Crelio Viana",
        "DE - Deiler Celio Jeunon",
        "DN - Dener Augusto Diniz",
        "FL - Flavio Maciel Fonseca",
        "FR - Francisco Tadeu da Mota Albuquerque",
        "GB - Gustavo Prosperi Bicalho",
        "GU - Guilherme Vieira Cunha",
        "IG - Igor Fagundes Vieira",
        "JA - Jayme Bueno Castilho",
        "L2 - Leonardo Alves Araujo",
        "LA - Luiz Antonio Carneiro Silva",
        "LC - Lucas Cardoso de Andrade",
        "LD - Leonardo Diniz Correa Pinto",
        "LE - Leonardo Carvalho Figueiredo",
        "LH - Lucia Helena Jacomett",
        "LO - Luiz Otavio Fernandes Andrade",
        "LU - Luciano Costa Ferreira",
        "MA - Marcelo Giovannoni Assis",
        "MH - Marcio Henrique Mendes",
        "PR - Paulo Renato Andrade Silva",
        "RA - Rafael Augusto Carneiro Rezende",
        "RC - Rodrigo Capuano de Rezende Carneiro",
        "RL - Ricardo Lucas da Mota Albuquerque",
        "RO - Rodrigo de Lima e Souza",
        "RU - Rubens Claudio Pinheiro",
        "WE - Wendell Valadares Campos Pereira"
      ]
        .map((value) => parseSiglaNameEntry(value))
        .filter(Boolean)
        .map((entry) => [entry.sigla, entry])
    );
  }

  function buildFallbackDcOptions() {
    return [
      "AD - Adelson Jose de Macedo",
      "CR - Crelio Viana",
      "LH - Lucia Helena Jacomett",
      "LA - Luiz Antonio Carneiro Silva"
    ]
      .map((value) => parseSiglaNameEntry(value))
      .filter(Boolean);
  }

  function buildFallbackEventFieldOptions() {
    return {
      eventTypes: ["Pessoal", "Ferias", "ATRASO", "Suporte", "Gestao", "Congresso", "Saude", "Ausencia", "Outros"],
      delayMultiples: ["0", "1", "2", "3", "4", "5", "6"],
      substitutes: [
        "Fernando Astrogildo",
        "Bernardo Guimaraes",
        "Lucas Marques",
        "Carolina Valadares",
        "Jessica Karine",
        "Bruna Candida",
        "Adelson Jose de Macedo",
        "Adriano Neves de Almeida",
        "Alexandre de Castro Morais",
        "Barbara Ribeiro Coutinho Leduc",
        "Carlos Humberto Barbosa Ganem",
        "Crelio Viana",
        "Deiler Celio Jeunon",
        "Dener Augusto Diniz",
        "Flavio Maciel Fonseca",
        "Francisco Tadeu da Mota Albuquerque",
        "Guilherme Vieira Cunha",
        "Gustavo Prosperi Bicalho",
        "Igor Fagundes Vieira",
        "Jayme Bueno Castilho",
        "Leonardo Alves Araujo",
        "Leonardo Carvalho Figueiredo",
        "Leonardo Diniz Correa Pinto",
        "Lucas Cardoso de Andrade",
        "Lucia Helena Jacomett",
        "Luciano Costa Ferreira",
        "Luiz Antonio Carneiro Silva",
        "Luiz Otavio Fernandes Andrade",
        "Marcelo Giovannoni Assis",
        "Marcio Henrique Mendes",
        "Paulo Renato Andrade Silva",
        "Rafael Augusto Carneiro Rezende",
        "Ricardo Lucas da Mota Albuquerque",
        "Rodrigo Capuano de Rezende Carneiro",
        "Rodrigo de Lima e Souza",
        "Rubens Claudio Pinheiro",
        "Wendell Valadares Campos Pereira"
      ],
      shifts: ["Manha", "Tarde", "Integral"],
      payers: [
        "CAIXA DA EQUIPE",
        "AD - Adelson Jose de Macedo",
        "AA - Adriano Neves de Almeida",
        "AL - Alexandre de Castro Morais",
        "BA - Barbara Ribeiro Coutinho Leduc",
        "CH - Carlos Humberto Barbosa Ganem",
        "CR - Crelio Viana"
      ],
      creditors: [
        "Fernando Astrogildo",
        "Bernardo Guimaraes",
        "Lucas Marques",
        "Carolina Valadares",
        "Jessica Karine",
        "Bruna Candida",
        "CAIXA DA EQUIPE"
      ]
    };
  }

  function buildFallbackEventTypeDefaults() {
    return new Map([
      ["Pessoal", { delayMultiple: "0", shift: "Manha", payer: "CAIXA DA EQUIPE", creditor: "Fernando Astrogildo" }],
      ["Ferias", { delayMultiple: "1", shift: "Tarde", payer: "AD - Adelson Jose de Macedo", creditor: "Bernardo Guimaraes" }],
      ["ATRASO", { delayMultiple: "2", shift: "Integral", payer: "AA - Adriano Neves de Almeida", creditor: "Lucas Marques" }],
      ["Suporte", { delayMultiple: "3", shift: "", payer: "AL - Alexandre de Castro Morais", creditor: "Carolina Valadares" }],
      ["Gestao", { delayMultiple: "4", shift: "", payer: "BA - Barbara Ribeiro Coutinho Leduc", creditor: "Jessica Karine" }],
      ["Congresso", { delayMultiple: "5", shift: "", payer: "CH - Carlos Humberto Barbosa Ganem", creditor: "Bruna Candida" }],
      ["Saude", { delayMultiple: "6", shift: "", payer: "CR - Crelio Viana", creditor: "CAIXA DA EQUIPE" }]
    ]);
  }

  function pushUniqueOption(list, value) {
    const text = String(value || "").trim();
    if (!text || list.includes(text)) {
      return;
    }

    list.push(text);
  }

  function extractDisplayName(value) {
    const entry = parseSiglaNameEntry(value);
    if (entry) {
      return entry.name;
    }

    return String(value || "").trim();
  }

  function getVacationSiglasForDate(dateKey) {
    return new Set(getVacationOrderForDate(dateKey));
  }

  function getVacationOrderForDate(dateKey) {
    const label = String(byDate.get(dateKey)?.vacationLabel || "");
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

  function appendSiglaDisplay(token, sigla, vacationSiglas, vacationOrder, showVacationPositions) {
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
        partWrap.appendChild(document.createTextNode(part));
      }

      token.appendChild(partWrap);
    });
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

  function extractSiglas(token) {
    const normalized = String(token || "").toUpperCase();
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
