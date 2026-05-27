const CARD_TOTAL = 150;
const CALL_TOTAL = 75;
const LETTERS = ["B", "I", "N", "G", "O"];
const RANGES = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75]
];
const STAGE_MESSAGES = {
  oneLine: "บิงโก 1 แถว",
  twoLines: "บิงโก 2 แถว",
  fullHouse: "ฟูลเฮาส์ บิงโก"
};
const STAGE_TYPES = {
  oneLine: "1 แถว",
  twoLines: "2 แถว",
  fullHouse: "เต็มใบ"
};
const TRACKER_STORAGE_KEY = "jt-bingo-card-tracker-v2";
const WINNER_STORAGE_KEY = "jt-bingo-winners-v1";
const CARD_STORAGE_KEY = "jt-bingo-card-set-v1";
const CARD_SETS_STORAGE_KEY = "jt-bingo-card-sets-v1";
const ACTIVE_SET_STORAGE_KEY = "jt-bingo-active-set-id-v1";
const CALLER_STATE_STORAGE_KEY = "jt-bingo-caller-state-v1";
const SHORT_SET_ID_PATTERN = /^[A-Z]\d{4}$/;

let bingoCards = [];
let callerPool = [];
let calledNumbers = [];
let drawHistory = [];
let latestNumber = null;
let winnerLocks = createWinnerLocks();
let trackerRecords = [];
let winnerRecords = [];
let cardSets = [];
let activeSetId = "";
let deferredInstallPrompt = null;
let audioContext = null;
let liveAnalysisMode = "all";

document.addEventListener("DOMContentLoaded", () => {
  registerOfflineApp();
  initInstallPrompt();

  if (document.getElementById("cardsContainer")) {
    initCardGenerator();
  }

  if (document.getElementById("drawNumberBtn")) {
    initCaller();
  }
});

function initCardGenerator() {
  const generateButton = document.getElementById("generateCardsBtn");
  const printButton = document.getElementById("printCardsBtn");
  const previewSelect = document.getElementById("previewSelect");
  const previewCard = document.getElementById("previewCard");
  const cardsContainer = document.getElementById("cardsContainer");
  const closeWinnerPopup = document.getElementById("closeWinnerPopup");
  const trackerSearch = document.getElementById("trackerSearch");
  const exportTrackerButton = document.getElementById("exportTrackerBtn");
  const resetTrackerButton = document.getElementById("resetTrackerBtn");
  const clearWinnerHistoryButton = document.getElementById("clearWinnerHistoryBtn");
  const cardSetSelect = document.getElementById("cardSetSelect");
  const createSetButton = document.getElementById("createSetBtn");

  generateButton.addEventListener("click", generateAndRenderCards);
  createSetButton.addEventListener("click", generateAndRenderCards);
  cardSetSelect.addEventListener("change", () => selectCardSet(cardSetSelect.value));
  printButton.addEventListener("click", () => {
    if (bingoCards.length !== CARD_TOTAL) {
      generateAndRenderCards();
    }
    window.print();
  });
  previewSelect.addEventListener("change", () => renderPreview(Number(previewSelect.value)));
  previewCard.addEventListener("click", handleCardMark);
  cardsContainer.addEventListener("click", handleCardMark);
  closeWinnerPopup.addEventListener("click", closeWinnerNotification);
  trackerSearch.addEventListener("input", renderTrackerTable);
  exportTrackerButton.addEventListener("click", exportTrackerCsv);
  resetTrackerButton.addEventListener("click", resetTracker);
  clearWinnerHistoryButton.addEventListener("click", clearWinnerHistory);
  document.getElementById("trackerTableBody").addEventListener("input", handleTrackerInput);
  document.getElementById("trackerTableBody").addEventListener("change", handleTrackerInput);

  trackerRecords = loadTrackerRecords();
  winnerRecords = loadWinnerRecords();
  winnerLocks = createWinnerLocks(winnerRecords);
  loadOrCreateBingoCards();
  renderTrackerTable();
  renderWinnerHistory();
  renderSetControls();
  renderGeneratedCards();
}

function generateAndRenderCards() {
  if (!confirm("Create a new SET ID? Current printed cards may no longer match the caller if you switch sets.")) {
    return;
  }

  const newSet = createCardSet();
  cardSets.push(newSet);
  activeSetId = newSet.id;
  bingoCards = newSet.cards;
  winnerLocks = createWinnerLocks(winnerRecords);
  closeWinnerNotification();
  saveCardSets();
  saveActiveSetId();
  renderSetControls();
  renderGeneratedCards();
}

function createUniqueBingoCards() {
  const seenCards = new Set();
  const cards = [];

  while (cards.length < CARD_TOTAL) {
    const card = createBingoCard();
    const key = card.flat().join("-");

    if (!seenCards.has(key)) {
      seenCards.add(key);
      cards.push(card);
    }
  }

  return cards;
}

function createCardSet(cards = createUniqueBingoCards()) {
  const id = getNextSetId();
  return {
    id,
    cards,
    createdAt: new Date().toISOString()
  };
}

function loadOrCreateBingoCards() {
  cardSets = loadCardSets();
  const savedActiveSetId = loadActiveSetId();
  const migratedActiveSetId = migrateCardSetIds(savedActiveSetId);
  if (cardSets.length === 0) {
    const migratedCards = loadBingoCards();
    cardSets = [createCardSet(migratedCards.length === CARD_TOTAL ? migratedCards : createUniqueBingoCards())];
    activeSetId = cardSets[0].id;
    saveCardSets();
    saveActiveSetId();
  }

  activeSetId = migratedActiveSetId || loadActiveSetId();
  if (!cardSets.some((set) => set.id === activeSetId)) {
    activeSetId = cardSets[0].id;
    saveActiveSetId();
  }

  const activeSet = cardSets.find((set) => set.id === activeSetId);
  bingoCards = activeSet?.cards || [];
  if (bingoCards.length === CARD_TOTAL) {
    return;
  }

  const repairedSet = createCardSet();
  cardSets.push(repairedSet);
  activeSetId = repairedSet.id;
  bingoCards = repairedSet.cards;
  saveCardSets();
  saveActiveSetId();
}

function renderGeneratedCards() {
  renderPreviewOptions();
  renderPreview(0);
  renderAllCards();
  document.getElementById("cardCount").textContent = String(bingoCards.length);
  updateActiveSetLabels();
}

function loadBingoCards() {
  try {
    const savedCards = JSON.parse(localStorage.getItem(CARD_STORAGE_KEY) || "[]");
    if (!Array.isArray(savedCards) || savedCards.length !== CARD_TOTAL) {
      return [];
    }

    return savedCards;
  } catch {
    return [];
  }
}

function saveBingoCards() {
  localStorage.setItem(CARD_STORAGE_KEY, JSON.stringify(bingoCards));
}

function getNextSetId() {
  const usedIds = new Set(cardSets.map((set) => set.id));
  let highestIndex = 0;

  usedIds.forEach((id) => {
    if (!SHORT_SET_ID_PATTERN.test(id)) {
      return;
    }

    const letterIndex = id.charCodeAt(0) - 65;
    const number = Number(id.slice(1));
    highestIndex = Math.max(highestIndex, letterIndex * 9999 + number);
  });

  for (let index = highestIndex + 1; index <= 26 * 9999; index += 1) {
    const id = formatSetId(index);
    if (!usedIds.has(id)) {
      return id;
    }
  }

  throw new Error("No available SET IDs");
}

function formatSetId(index) {
  const letterIndex = Math.floor((index - 1) / 9999);
  const number = ((index - 1) % 9999) + 1;
  return `${String.fromCharCode(65 + letterIndex)}${String(number).padStart(4, "0")}`;
}

function migrateCardSetIds(savedActiveSetId) {
  const usedIds = new Set();
  const idMap = new Map();
  let changed = false;

  cardSets.forEach((set) => {
    if (SHORT_SET_ID_PATTERN.test(set.id) && !usedIds.has(set.id)) {
      usedIds.add(set.id);
      return;
    }

    const oldId = set.id;
    const newId = getNextSetIdFromUsed(usedIds);
    set.id = newId;
    usedIds.add(newId);
    idMap.set(oldId, newId);
    changed = true;
  });

  if (changed) {
    saveCardSets();
  }

  const migratedActiveSetId = idMap.get(savedActiveSetId) || savedActiveSetId;
  if (migratedActiveSetId && migratedActiveSetId !== savedActiveSetId) {
    activeSetId = migratedActiveSetId;
    saveActiveSetId();
  }

  return migratedActiveSetId;
}

function getNextSetIdFromUsed(usedIds) {
  for (let index = 1; index <= 26 * 9999; index += 1) {
    const id = formatSetId(index);
    if (!usedIds.has(id)) {
      return id;
    }
  }

  throw new Error("No available SET IDs");
}

function loadCardSets() {
  try {
    const savedSets = JSON.parse(localStorage.getItem(CARD_SETS_STORAGE_KEY) || "[]");
    if (!Array.isArray(savedSets)) {
      return [];
    }

    return savedSets.filter((set) => set?.id && Array.isArray(set.cards) && set.cards.length === CARD_TOTAL);
  } catch {
    return [];
  }
}

function saveCardSets() {
  localStorage.setItem(CARD_SETS_STORAGE_KEY, JSON.stringify(cardSets));
}

function loadActiveSetId() {
  return localStorage.getItem(ACTIVE_SET_STORAGE_KEY) || "";
}

function saveActiveSetId() {
  localStorage.setItem(ACTIVE_SET_STORAGE_KEY, activeSetId);
}

function selectCardSet(setId) {
  const selectedSet = cardSets.find((set) => set.id === setId);
  if (!selectedSet) {
    return;
  }

  activeSetId = selectedSet.id;
  bingoCards = selectedSet.cards;
  saveActiveSetId();
  renderSetControls();
  renderGeneratedCards();
}

function renderSetControls() {
  const setSelect = document.getElementById("cardSetSelect");
  if (setSelect) {
    setSelect.innerHTML = cardSets
      .map((set) => `<option value="${set.id}" ${set.id === activeSetId ? "selected" : ""}>${set.id}</option>`)
      .join("");
  }
  updateActiveSetLabels();
}

function updateActiveSetLabels() {
  document.querySelectorAll("#activeSetIdLabel, #callerSetIdLabel").forEach((label) => {
    label.textContent = activeSetId || "-";
  });
}

function createBingoCard() {
  const columns = RANGES.map(([min, max]) => shuffle(range(min, max)).slice(0, 5));
  const grid = [];

  for (let row = 0; row < 5; row += 1) {
    const rowValues = [];
    for (let col = 0; col < 5; col += 1) {
      rowValues.push(row === 2 && col === 2 ? "FREE" : columns[col][row]);
    }
    grid.push(rowValues);
  }

  return grid;
}

function renderPreviewOptions() {
  const previewSelect = document.getElementById("previewSelect");
  previewSelect.innerHTML = bingoCards
    .map((_, index) => `<option value="${index}">Card #${formatCardNumber(index + 1)}</option>`)
    .join("");
}

function renderPreview(index) {
  const previewCard = document.getElementById("previewCard");
  previewCard.innerHTML = "";
  previewCard.appendChild(buildCardElement(bingoCards[index], index + 1));
}

function renderAllCards() {
  const cardsContainer = document.getElementById("cardsContainer");
  const fragment = document.createDocumentFragment();

  cardsContainer.innerHTML = "";
  bingoCards.forEach((card, index) => {
    fragment.appendChild(buildCardElement(card, index + 1));
  });

  cardsContainer.appendChild(fragment);
}

function renderTrackerTable() {
  const tableBody = document.getElementById("trackerTableBody");
  const searchTerm = document.getElementById("trackerSearch").value.trim().toLowerCase();
  const fragment = document.createDocumentFragment();

  tableBody.innerHTML = "";
  trackerRecords
    .filter((record) => {
      const cardNumber = formatCardNumber(record.cardNumber);
      return !searchTerm || cardNumber.includes(searchTerm) || record.name.toLowerCase().includes(searchTerm);
    })
    .forEach((record) => {
      const row = document.createElement("tr");
      row.dataset.cardNumber = String(record.cardNumber);
      row.innerHTML = `
        <td><strong>#${formatCardNumber(record.cardNumber)}</strong></td>
        <td>
          <input class="tracker-name-input" type="text" value="${escapeHtml(record.name)}" aria-label="ชื่อผู้เล่น การ์ด #${formatCardNumber(record.cardNumber)}">
        </td>
        <td>
          <label class="tracker-check">
            <input type="checkbox" data-field="distributed" ${record.distributed ? "checked" : ""}>
            <span>แจกแล้ว</span>
          </label>
        </td>
        <td>
          <label class="tracker-check">
            <input type="checkbox" data-field="present" ${record.present ? "checked" : ""}>
            <span>มาแล้ว</span>
          </label>
        </td>
      `;
      fragment.appendChild(row);
    });

  tableBody.appendChild(fragment);
  updateTrackerSummary();
}

function handleTrackerInput(event) {
  const row = event.target.closest("tr[data-card-number]");
  if (!row) {
    return;
  }

  const record = trackerRecords.find((item) => item.cardNumber === Number(row.dataset.cardNumber));
  if (!record) {
    return;
  }

  if (event.target.classList.contains("tracker-name-input")) {
    record.name = event.target.value;
  }

  if (event.target.matches("input[type='checkbox'][data-field]")) {
    record[event.target.dataset.field] = event.target.checked;
  }

  saveTrackerRecords();
  updateTrackerSummary();
}

function updateTrackerSummary() {
  const distributedCount = trackerRecords.filter((record) => record.distributed).length;
  const presentCount = trackerRecords.filter((record) => record.present).length;

  document.getElementById("distributedCount").textContent = String(distributedCount);
  document.getElementById("presentCount").textContent = String(presentCount);
  document.getElementById("availableCount").textContent = String(CARD_TOTAL - distributedCount);
}

function loadTrackerRecords() {
  const defaultRecords = createTrackerRecords();

  try {
    const savedRecords = JSON.parse(localStorage.getItem(TRACKER_STORAGE_KEY) || "[]");
    if (!Array.isArray(savedRecords)) {
      return defaultRecords;
    }

    return defaultRecords.map((record) => ({
      ...record,
      ...(savedRecords.find((saved) => saved.cardNumber === record.cardNumber) || {})
    }));
  } catch {
    return defaultRecords;
  }
}

function createTrackerRecords() {
  return Array.from({ length: CARD_TOTAL }, (_, index) => ({
    cardNumber: index + 1,
    name: "",
    distributed: false,
    present: false
  }));
}

function saveTrackerRecords() {
  localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(trackerRecords));
}

function resetTracker() {
  if (!confirm("ล้างข้อมูลการแจกการ์ดและการเข้าเล่นทั้งหมด?")) {
    return;
  }

  trackerRecords = createTrackerRecords();
  saveTrackerRecords();
  renderTrackerTable();
}

function exportTrackerCsv() {
  const rows = [
    ["Card", "Player Name", "Distributed", "Present"],
    ...trackerRecords.map((record) => [
      `JT-BINGO Card #${formatCardNumber(record.cardNumber)}`,
      record.name,
      record.distributed ? "Yes" : "No",
      record.present ? "Yes" : "No"
    ])
  ];
  const csv = rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.download = "jt-bingo-card-tracker.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function loadWinnerRecords() {
  try {
    const savedWinners = JSON.parse(localStorage.getItem(WINNER_STORAGE_KEY) || "[]");
    return Array.isArray(savedWinners) ? savedWinners.filter((winner) => STAGE_MESSAGES[winner.stage]) : [];
  } catch {
    return [];
  }
}

function saveWinnerRecords() {
  localStorage.setItem(WINNER_STORAGE_KEY, JSON.stringify(winnerRecords));
}

function renderWinnerHistory() {
  const historyList = document.getElementById("winnerHistoryList");
  if (!historyList) {
    return;
  }

  historyList.innerHTML = "";
  if (winnerRecords.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "winner-history-empty";
    emptyState.textContent = "ยังไม่มีผู้ชนะ";
    historyList.appendChild(emptyState);
    return;
  }

  winnerRecords.forEach((winner) => {
    const item = document.createElement("article");
    item.className = "winner-history-item";
    item.innerHTML = `
      <strong>ผู้ชนะคนแรก: การ์ด #${formatCardNumber(winner.cardNumber)}</strong>
      <span>รหัสการ์ด: ${escapeHtml(winner.cardId)}</span>
      <span>ประเภทชนะ: ${escapeHtml(winner.type)}</span>
      <small>${escapeHtml(winner.timeLabel)}</small>
    `;
    historyList.appendChild(item);
  });
}

function clearWinnerHistory() {
  if (!confirm("ล้างประวัติผู้ชนะทั้งหมด?")) {
    return;
  }

  winnerRecords = [];
  winnerLocks = createWinnerLocks();
  saveWinnerRecords();
  renderWinnerHistory();
}

function buildCardElement(card, cardNumber) {
  const article = document.createElement("article");
  article.className = "bingo-card";
  article.dataset.cardNumber = String(cardNumber);
  article.dataset.announcedStages = "";

  const title = document.createElement("div");
  title.className = "card-title";
  title.innerHTML = `
    <span class="card-title-main">JT-BINGO</span>
    <span class="card-meta">SET ${escapeHtml(activeSetId || "-")} &bull; CARD #${formatCardNumber(cardNumber)}</span>
  `;
  article.appendChild(title);

  const winBanner = document.createElement("div");
  winBanner.className = "win-banner";
  winBanner.setAttribute("aria-live", "polite");
  winBanner.textContent = "บิงโก!";
  article.appendChild(winBanner);

  const grid = document.createElement("div");
  grid.className = "bingo-grid";
  grid.setAttribute("aria-label", `SET ${activeSetId || "-"} Card #${formatCardNumber(cardNumber)}`);

  LETTERS.forEach((letter) => {
    const cell = document.createElement("div");
    cell.className = "bingo-cell bingo-head";
    cell.textContent = letter;
    grid.appendChild(cell);
  });

  card.flat().forEach((value, index) => {
    const row = Math.floor(index / 5);
    const column = index % 5;
    const cell = document.createElement("div");
    cell.className = value === "FREE" ? "bingo-cell free-cell marked" : "bingo-cell playable-cell";
    cell.dataset.row = String(row);
    cell.dataset.column = String(column);
    cell.dataset.marked = value === "FREE" ? "true" : "false";
    cell.setAttribute("role", "button");
    cell.setAttribute("tabindex", "0");
    cell.setAttribute("aria-pressed", value === "FREE" ? "true" : "false");
    cell.setAttribute("aria-label", value === "FREE" ? "FREE center marked" : `Mark number ${value}`);
    cell.textContent = value;
    grid.appendChild(cell);
  });

  article.appendChild(grid);
  updateCardWinState(article);
  return article;
}

function handleCardMark(event) {
  const cell = event.target.closest(".bingo-cell[data-row]");
  if (!cell || !event.currentTarget.contains(cell) || cell.classList.contains("free-cell")) {
    return;
  }

  toggleMarkedCell(cell);
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const cell = event.target.closest?.(".bingo-cell[data-row]");
  if (!cell || cell.classList.contains("free-cell")) {
    return;
  }

  event.preventDefault();
  toggleMarkedCell(cell);
});

function toggleMarkedCell(cell) {
  const isMarked = cell.dataset.marked !== "true";
  cell.dataset.marked = String(isMarked);
  cell.classList.toggle("marked", isMarked);
  cell.setAttribute("aria-pressed", String(isMarked));
  cell.setAttribute("aria-label", `${isMarked ? "Unmark" : "Mark"} number ${cell.textContent}`);

  updateCardWinState(cell.closest(".bingo-card"));
}

function updateCardWinState(cardElement) {
  if (!cardElement) {
    return;
  }

  const marked = getMarkedGrid(cardElement);
  const completedLines = getCompletedLines(marked);
  const winningKeys = new Set(completedLines.flatMap((line) => line.cells.map(([row, column]) => `${row}-${column}`)));
  const fullHouse = marked.every((row) => row.every(Boolean));
  const stage = getCurrentStage(completedLines.length, fullHouse);
  const banner = cardElement.querySelector(".win-banner");

  cardElement.querySelectorAll(".bingo-cell[data-row]").forEach((cell) => {
    const key = `${cell.dataset.row}-${cell.dataset.column}`;
    cell.classList.toggle("winning-cell", fullHouse || winningKeys.has(key));
  });

  cardElement.classList.toggle("has-bingo", Boolean(stage));
  if (banner) {
    banner.textContent = stage ? STAGE_MESSAGES[stage] : "บิงโก!";
  }

  announceWinnerStage(cardElement, stage);
}

function getMarkedGrid(cardElement) {
  const marked = Array.from({ length: 5 }, () => Array(5).fill(false));

  cardElement.querySelectorAll(".bingo-cell[data-row]").forEach((cell) => {
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    marked[row][column] = cell.dataset.marked === "true";
  });

  return marked;
}

function getCompletedLines(marked) {
  const lines = [];

  marked.forEach((row, rowIndex) => {
    if (row.every(Boolean)) {
      lines.push({
        type: "row",
        cells: row.map((_, column) => [rowIndex, column])
      });
    }
  });

  for (let column = 0; column < 5; column += 1) {
    if (marked.every((row) => row[column])) {
      lines.push({
        type: "column",
        cells: marked.map((_, row) => [row, column])
      });
    }
  }

  if (marked.every((row, index) => row[index])) {
    lines.push({
      type: "diagonal",
      cells: marked.map((_, index) => [index, index])
    });
  }

  if (marked.every((row, index) => row[4 - index])) {
    lines.push({
      type: "diagonal",
      cells: marked.map((_, index) => [index, 4 - index])
    });
  }

  return lines;
}

function getCurrentStage(lineCount, fullHouse) {
  if (fullHouse) {
    return "fullHouse";
  }

  if (lineCount >= 2) {
    return "twoLines";
  }

  if (lineCount >= 1) {
    return "oneLine";
  }

  return "";
}

function announceWinnerStage(cardElement, currentStage) {
  if (!currentStage) {
    return;
  }

  const cardNumber = Number(cardElement.dataset.cardNumber);
  const announcedStages = new Set((cardElement.dataset.announcedStages || "").split(",").filter(Boolean));
  const stagesToCheck = getReachedStages(currentStage);

  stagesToCheck.forEach((stage) => {
    if (announcedStages.has(stage) || winnerLocks[stage]) {
      return;
    }

    const winnerRecord = registerWinner(stage, cardNumber);
    announcedStages.add(stage);
    showWinnerNotification(winnerRecord);
  });

  cardElement.dataset.announcedStages = [...announcedStages].join(",");
}

function getReachedStages(stage) {
  if (stage === "fullHouse") {
    return ["oneLine", "twoLines", "fullHouse"];
  }

  if (stage === "twoLines") {
    return ["oneLine", "twoLines"];
  }

  return ["oneLine"];
}

function registerWinner(stage, cardNumber) {
  const winnerRecord = {
    stage,
    cardNumber,
    cardId: `JT-BINGO Card #${formatCardNumber(cardNumber)}`,
    type: STAGE_TYPES[stage],
    title: STAGE_MESSAGES[stage],
    timeLabel: new Date().toLocaleString("th-TH")
  };

  winnerLocks[stage] = winnerRecord;
  winnerRecords.push(winnerRecord);
  saveWinnerRecords();
  renderWinnerHistory();
  return winnerRecord;
}

function showWinnerNotification(winnerRecord) {
  const popup = document.getElementById("winnerPopup");
  const title = document.getElementById("winnerTitle");
  const message = document.getElementById("winnerMessage");
  const cardId = document.getElementById("winnerCardId");
  const winnerType = document.getElementById("winnerType");
  const firstLine = document.getElementById("winnerFirstLine");

  if (!popup || !title || !message || !cardId || !winnerType || !firstLine) {
    return;
  }

  title.textContent = winnerRecord.title;
  message.textContent = "ประกาศผู้ชนะ";
  cardId.textContent = `รหัสการ์ด: ${winnerRecord.cardId}`;
  winnerType.textContent = `ประเภทชนะ: ${winnerRecord.type}`;
  firstLine.textContent = `ผู้ชนะคนแรก: การ์ด #${formatCardNumber(winnerRecord.cardNumber)}`;
  popup.classList.add("show");
  popup.setAttribute("aria-hidden", "false");
  playCelebrationSound();
  launchConfetti();
}

function closeWinnerNotification() {
  const popup = document.getElementById("winnerPopup");
  if (!popup) {
    return;
  }

  popup.classList.remove("show");
  popup.setAttribute("aria-hidden", "true");
}

function createWinnerLocks(records = []) {
  const locks = {
    oneLine: null,
    twoLines: null,
    fullHouse: null
  };

  records.forEach((winner) => {
    if (Object.hasOwn(locks, winner.stage) && !locks[winner.stage]) {
      locks[winner.stage] = winner;
    }
  });

  return locks;
}

function registerOfflineApp() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.register("sw.js").catch(() => {
    // Offline support is optional when opened from file URLs or older browsers.
  });
}

function initInstallPrompt() {
  const installButton = document.getElementById("installAppBtn");
  if (!installButton) {
    return;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      return;
    }

    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });
}

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

function playTone(frequency, startTime, duration, volume = 0.08, type = "sine") {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

function playDrawSound(number) {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  const baseFrequency = 360 + (number % 15) * 14;
  playTone(baseFrequency, context.currentTime, 0.11, 0.07, "triangle");
  playTone(baseFrequency * 1.5, context.currentTime + 0.1, 0.14, 0.06, "sine");
}

function playCelebrationSound() {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
    playTone(frequency, context.currentTime + index * 0.08, 0.22, 0.075, "triangle");
  });
}

function launchConfetti() {
  let confettiLayer = document.getElementById("confettiLayer");
  if (!confettiLayer) {
    confettiLayer = document.createElement("div");
    confettiLayer.id = "confettiLayer";
    confettiLayer.className = "confetti-layer";
    document.body.appendChild(confettiLayer);
  }

  confettiLayer.innerHTML = "";
  for (let index = 0; index < 90; index += 1) {
    const piece = document.createElement("span");
    const xDrift = `${Math.random() * 220 - 110}px`;
    const rotate = `${Math.random() * 720 - 360}deg`;
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = index % 3 === 0 ? "var(--yellow-500)" : index % 3 === 1 ? "var(--blue-650)" : "var(--white)";
    piece.style.setProperty("--x-drift", xDrift);
    piece.style.setProperty("--spin", rotate);
    piece.style.animationDelay = `${Math.random() * 0.22}s`;
    confettiLayer.appendChild(piece);
  }

  window.setTimeout(() => {
    confettiLayer.innerHTML = "";
  }, 2400);
}

function initCaller() {
  document.getElementById("drawNumberBtn").addEventListener("click", drawNumber);
  document.getElementById("undoDrawBtn").addEventListener("click", undoDraw);
  document.getElementById("resetCallerBtn").addEventListener("click", resetCaller);
  document.getElementById("fullscreenBtn").addEventListener("click", toggleFullscreen);
  document.getElementById("projectorModeBtn").addEventListener("click", toggleProjectorMode);
  document.getElementById("analyzeAllCardsBtn").addEventListener("click", () => setLiveAnalysisMode("all"));
  document.getElementById("analyzeDistributedCardsBtn").addEventListener("click", () => setLiveAnalysisMode("distributed"));
  loadOrCreateBingoCards();
  loadCallerState();
  updateActiveSetLabels();
  trackerRecords = loadTrackerRecords();

  document.addEventListener("fullscreenchange", () => {
    document.body.classList.toggle("fullscreen-active", Boolean(document.fullscreenElement));
  });

  updateCallerDisplay();
  renderCallerBoard();
  renderLiveWinnerStatus();
}

function setLiveAnalysisMode(mode) {
  liveAnalysisMode = mode;
  document.querySelectorAll(".analysis-mode-button").forEach((button) => {
    const isActive = button.dataset.mode === mode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  renderLiveWinnerStatus();
  saveCallerState();
}

function resetCaller() {
  callerPool = shuffle(range(1, CALL_TOTAL));
  calledNumbers = [];
  drawHistory = [];
  latestNumber = null;

  renderCallerBoard();
  updateCallerDisplay();
  renderLiveWinnerStatus();
  saveCallerState();
}

function drawNumber() {
  if (callerPool.length === 0) {
    document.getElementById("currentLetter").textContent = "All numbers called";
    return;
  }

  latestNumber = callerPool.pop();
  calledNumbers.push(latestNumber);
  drawHistory.push(latestNumber);
  playDrawSound(latestNumber);
  updateCallerDisplay();
  renderCallerBoard();
  renderLiveWinnerStatus();
  saveCallerState();
}

function undoDraw() {
  const lastDraw = drawHistory.pop();
  if (!lastDraw) {
    return;
  }

  const undoneNumber = calledNumbers.pop();
  if (undoneNumber !== lastDraw) {
    calledNumbers = drawHistory.slice();
  }

  if (!callerPool.includes(lastDraw)) {
    callerPool.push(lastDraw);
  }
  latestNumber = calledNumbers[calledNumbers.length - 1] || null;
  updateCallerDisplay();
  renderCallerBoard();
  renderLiveWinnerStatus();
  saveCallerState();
}

function loadCallerState() {
  try {
    const savedState = JSON.parse(localStorage.getItem(CALLER_STATE_STORAGE_KEY) || "null");
    if (!isValidCallerState(savedState)) {
      callerPool = shuffle(range(1, CALL_TOTAL));
      calledNumbers = [];
      drawHistory = [];
      latestNumber = null;
      saveCallerState();
      return;
    }

    callerPool = savedState.callerPool;
    calledNumbers = savedState.calledNumbers;
    drawHistory = savedState.drawHistory;
    latestNumber = savedState.latestNumber;
    liveAnalysisMode = savedState.liveAnalysisMode || liveAnalysisMode;

    if (savedState.activeSetId && cardSets.some((set) => set.id === savedState.activeSetId)) {
      activeSetId = savedState.activeSetId;
      bingoCards = cardSets.find((set) => set.id === activeSetId).cards;
      saveActiveSetId();
    }
    setLiveAnalysisMode(liveAnalysisMode);
  } catch {
    callerPool = shuffle(range(1, CALL_TOTAL));
    calledNumbers = [];
    drawHistory = [];
    latestNumber = null;
    saveCallerState();
  }
}

function isValidCallerState(state) {
  if (!state || !Array.isArray(state.callerPool) || !Array.isArray(state.calledNumbers) || !Array.isArray(state.drawHistory)) {
    return false;
  }

  const allNumbers = [...state.callerPool, ...state.calledNumbers];
  return allNumbers.length === CALL_TOTAL && new Set(allNumbers).size === CALL_TOTAL && allNumbers.every((number) => Number.isInteger(number) && number >= 1 && number <= CALL_TOTAL);
}

function saveCallerState() {
  localStorage.setItem(CALLER_STATE_STORAGE_KEY, JSON.stringify({
    activeSetId,
    callerPool,
    calledNumbers,
    drawHistory,
    latestNumber,
    liveAnalysisMode
  }));
}

function updateCallerDisplay() {
  const currentNumber = document.getElementById("currentNumber");
  const currentLetter = document.getElementById("currentLetter");

  currentNumber.textContent = latestNumber ?? "--";
  currentLetter.textContent = latestNumber ? `${getBingoLetter(latestNumber)}-${latestNumber}` : "Ready";
  document.getElementById("drawnCount").textContent = String(calledNumbers.length);
  document.getElementById("remainingCount").textContent = String(callerPool.length);
}

function renderCallerBoard() {
  LETTERS.forEach((letter, columnIndex) => {
    const [min, max] = RANGES[columnIndex];
    const strip = document.getElementById(`strip${letter}`);
    const calledSet = new Set(calledNumbers);

    strip.innerHTML = "";
    range(min, max).forEach((number) => {
      const numberCell = document.createElement("span");
      numberCell.className = "caller-number";
      if (calledSet.has(number)) {
        numberCell.classList.add("called");
      }
      if (number === latestNumber) {
        numberCell.classList.add("latest");
      }
      numberCell.textContent = number;
      strip.appendChild(numberCell);
    });
  });
}

function renderLiveWinnerStatus() {
  const summary = document.getElementById("liveWinnerSummary");
  const groupsContainer = document.getElementById("liveWinnerGroups");
  const closeList = document.getElementById("closeWinnerList");
  if (!summary || !groupsContainer || !closeList) {
    return;
  }

  trackerRecords = loadTrackerRecords();
  const activeCards = getLiveAnalysisCards();
  const analysis = getLiveWinnerAnalysis(activeCards);
  const possibleWinners = analysis.groups;
  const totalPossible = possibleWinners.oneLine.length + possibleWinners.twoLines.length + possibleWinners.fullHouse.length;
  const modeLabel = liveAnalysisMode === "all" ? "ทุกการ์ด" : "เฉพาะการ์ดที่แจกแล้ว";

  summary.textContent = `โหมด: ${modeLabel} | วิเคราะห์ ${activeCards.length} ใบ | เรียกแล้ว ${calledNumbers.length} เลข | Possible winners ${totalPossible} ใบ`;
  groupsContainer.innerHTML = "";

  [
    ["oneLine", "1 line bingo"],
    ["twoLines", "2 line bingo"],
    ["fullHouse", "full card bingo"]
  ].forEach(([stage, label]) => {
    const group = document.createElement("div");
    group.className = "live-winner-group";
    const cards = possibleWinners[stage];
    group.innerHTML = `
      <strong>${label}</strong>
      <div class="live-winner-cards">
        ${cards.length ? cards.map((card) => `<span>${escapeHtml(card.cardId)} · ขาด 0</span>`).join("") : "<em>ยังไม่มี</em>"}
      </div>
    `;
    groupsContainer.appendChild(group);
  });

  closeList.innerHTML = "";
  if (analysis.closeCards.length === 0) {
    closeList.innerHTML = "<em>ยังไม่มีข้อมูลใกล้บิงโก</em>";
    return;
  }

  analysis.closeCards.slice(0, 18).forEach((card) => {
    const item = document.createElement("div");
    item.className = "close-winner-item";
    item.innerHTML = `
      <strong>${escapeHtml(card.cardId)}</strong>
      <span>ขาดอีก ${card.missingToBingo} เลข เพื่อบิงโก 1 แถว</span>
      <small>${escapeHtml(card.bestLineLabel)}</small>
    `;
    closeList.appendChild(item);
  });
}

function getLiveAnalysisCards() {
  if (liveAnalysisMode === "distributed") {
    return trackerRecords.filter((record) => record.distributed);
  }

  return createTrackerRecords().map((record) => {
    const savedRecord = trackerRecords.find((item) => item.cardNumber === record.cardNumber);
    return savedRecord ? { ...record, ...savedRecord } : record;
  });
}

function getLiveWinnerAnalysis(activeCards) {
  const groups = {
    oneLine: [],
    twoLines: [],
    fullHouse: []
  };
  const closeCards = [];

  activeCards.forEach((record) => {
    const card = bingoCards[record.cardNumber - 1];
    if (!card) {
      return;
    }

    const stage = getCardStageFromDraws(card);
    const progress = getCardBingoProgress(card);
    const result = {
      cardId: `Card #${formatCardNumber(record.cardNumber)}`,
      cardNumber: record.cardNumber,
      missingToBingo: progress.missingToBingo,
      bestLineLabel: progress.bestLineLabel
    };

    if (stage) {
      groups[stage].push(result);
    } else if (progress.missingToBingo <= 2) {
      closeCards.push(result);
    }
  });

  closeCards.sort((a, b) => a.missingToBingo - b.missingToBingo || a.cardNumber - b.cardNumber);
  return { groups, closeCards };
}

function getCardStageFromDraws(card) {
  const calledSet = new Set(calledNumbers);
  const marked = card.map((row) => row.map((value) => value === "FREE" || calledSet.has(Number(value))));
  const completedLines = getCompletedLines(marked);
  const fullHouse = marked.every((row) => row.every(Boolean));

  return getCurrentStage(completedLines.length, fullHouse);
}

function getCardBingoProgress(card) {
  const calledSet = new Set(calledNumbers);
  const lines = getCardLines(card);
  let bestLine = {
    missingCount: 5,
    label: "แถว"
  };

  lines.forEach((line) => {
    const missingCount = line.values.filter((value) => value !== "FREE" && !calledSet.has(Number(value))).length;
    if (missingCount < bestLine.missingCount) {
      bestLine = {
        missingCount,
        label: line.label
      };
    }
  });

  return {
    missingToBingo: bestLine.missingCount,
    bestLineLabel: bestLine.label
  };
}

function getCardLines(card) {
  const lines = [];

  card.forEach((row, index) => {
    lines.push({
      label: `แถวที่ ${index + 1}`,
      values: row
    });
  });

  for (let column = 0; column < 5; column += 1) {
    lines.push({
      label: `คอลัมน์ ${LETTERS[column]}`,
      values: card.map((row) => row[column])
    });
  }

  lines.push({
    label: "แนวทแยงซ้าย",
    values: card.map((row, index) => row[index])
  });
  lines.push({
    label: "แนวทแยงขวา",
    values: card.map((row, index) => row[4 - index])
  });

  return lines;
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
    return;
  }

  document.documentElement.requestFullscreen();
}

function toggleProjectorMode() {
  const projectorButton = document.getElementById("projectorModeBtn");
  const isProjectorMode = document.body.classList.toggle("projector-mode");

  projectorButton.setAttribute("aria-pressed", String(isProjectorMode));
  projectorButton.textContent = isProjectorMode ? "ปิดโหมดโปรเจคเตอร์" : "โหมดโปรเจคเตอร์";
}

function getBingoLetter(number) {
  if (number <= 15) return "B";
  if (number <= 30) return "I";
  if (number <= 45) return "N";
  if (number <= 60) return "G";
  return "O";
}

function range(min, max) {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

function shuffle(items) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function formatCardNumber(number) {
  return String(number).padStart(3, "0");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeCsvValue(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
