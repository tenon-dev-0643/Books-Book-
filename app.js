// ==============================
// 設定・定数
// ==============================
const STORAGE_KEY = "manga-release-watch.v1";
const API_KEY_STORAGE_KEY = "manga-release-watch.googleBooksKey";
const DISCORD_WEBHOOK_STORAGE_KEY = "manga-release-watch.discordWebhook";
const BACKGROUND_STORAGE_KEY = "manga-release-watch.backgroundImage";
const AUTO_NOTIFY_KEY = "manga-release-watch.autoNotify";
const NOTIFIED_KEY = "manga-release-watch.notified.v1";

// Google Apps Script経由でのクラウド同期を使う場合は、デプロイしたウェブアプリのURLをここに入れてください。
// 空文字のままなら syncToCloud() は何もせず終了します。
const CLOUD_SYNC_URL = ""; // 自分で管理するGASのURLを設定する場合のみ使用

// ==============================
// 状態管理
// ==============================
const state = {
  titles: [],
  releases: [],
  candidates: [],
  calendarDate: new Date(),
  noticeDays: 3,
  search: "",
  syncing: false,
  googleApiKey: "",
  discordWebhookUrl: "",
  sortOrder: "name",
  expandedTitles: new Set(),
  selectedCalendarDate: null,
  autoNotify: false,
};

const els = {
  titleCount: document.querySelector("#titleCount"),
  futureCount: document.querySelector("#futureCount"),
  noticeCount: document.querySelector("#noticeCount"),
  mangaForm: document.querySelector("#mangaForm"),
  mangaTitle: document.querySelector("#mangaTitle"),
  mangaAuthor: document.querySelector("#mangaAuthor"),
  mangaTitleSuggestions: document.querySelector("#mangaTitleSuggestions"),
  releaseForm: document.querySelector("#releaseForm"),
  releaseManga: document.querySelector("#releaseManga"),
  releaseVolume: document.querySelector("#releaseVolume"),
  releaseDate: document.querySelector("#releaseDate"),
  releasePrice: document.querySelector("#releasePrice"),
  releaseMemo: document.querySelector("#releaseMemo"),
  noticeDays: document.querySelector("#noticeDays"),
  searchInput: document.querySelector("#searchInput"),
  sortOrder: document.querySelector("#sortOrder"),
  mangaList: document.querySelector("#mangaList"),
  googleApiKey: document.querySelector("#googleApiKey"),
  discordWebhook: document.querySelector("#discordWebhook"),
  syncButton: document.querySelector("#syncButton"),
  syncStatus: document.querySelector("#syncStatus"),
  candidateList: document.querySelector("#candidateList"),
  noticeList: document.querySelector("#noticeList"),
  calendar: document.querySelector("#calendar"),
  dayDetail: document.querySelector("#dayDetail"),
  dayDetailOverlay: document.querySelector("#dayDetailOverlay"),
  dayDetailClose: document.querySelector("#dayDetailClose"),
  monthLabel: document.querySelector("#monthLabel"),
  prevMonth: document.querySelector("#prevMonth"),
  nextMonth: document.querySelector("#nextMonth"),
  todayButton: document.querySelector("#todayButton"),
  notifyButton: document.querySelector("#notifyButton"),
  seedButton: document.querySelector("#seedButton"),
  exportButton: document.querySelector("#exportButton"),
  importInput: document.querySelector("#importInput"),
  backgroundInput: document.querySelector("#backgroundInput"),
  resetBackgroundButton: document.querySelector("#resetBackgroundButton"),
  emptyTemplate: document.querySelector("#emptyTemplate"),
  autoNotify: document.querySelector("#autoNotify"),
  notificationHelp: document.querySelector("#notificationHelp"),
  jumpRegister: document.querySelector("#jumpRegister"),
  toast: document.querySelector("#toast"),
};

const formatDate = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});

const formatMonth = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
});

// ==============================
// 汎用ヘルパー
// ==============================
function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

let toastTimer;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("visible"), 3500);
}

function dateOnly(value) {
  const d = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysUntil(value) {
  const today = dateOnly(new Date());
  const target = dateOnly(value);
  return Math.round((target - today) / 86400000);
}

function normalizeDate(value) {
  if (!value) return "";
  const text = String(value).trim().replace(/\//g, "-");
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return "";
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return "";
  const check = new Date(y, m - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function uniqueItems(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function formatPrice(price) {
  if (!price) return "";
  if (price.currency === "JPY") {
    return `¥${price.amount.toLocaleString("ja-JP")}`;
  }
  return `${price.amount.toLocaleString()} ${price.currency}`;
}

// ==============================
// 保存・読み込み
// ==============================
function load(remoteData = null) {
  const raw = remoteData ? JSON.stringify(remoteData) : null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state.titles = Array.isArray(parsed.titles) ? parsed.titles : [];
      state.releases = Array.isArray(parsed.releases) ? parsed.releases : [];
      state.noticeDays = Number(parsed.noticeDays) || 3;
      els.noticeDays.value = String(state.noticeDays);
    } catch {
      console.warn("クラウドデータの形式を確認してください");
    }
  }

  state.autoNotify = localStorage.getItem(AUTO_NOTIFY_KEY) === "true";
  els.autoNotify.checked = state.autoNotify;
  state.googleApiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || "";
  els.googleApiKey.value = state.googleApiKey;

  state.discordWebhookUrl = localStorage.getItem(DISCORD_WEBHOOK_STORAGE_KEY) || "";
  els.discordWebhook.value = state.discordWebhookUrl;

  const savedBackground = localStorage.getItem(BACKGROUND_STORAGE_KEY);
  if (savedBackground) applyBackgroundImage(savedBackground);
}

function save() {
  localStorage.setItem(AUTO_NOTIFY_KEY, String(state.autoNotify));
  window.BooksAuth?.queueSave({
    titles: state.titles,
    releases: state.releases,
    noticeDays: state.noticeDays,
  });

  if (state.googleApiKey) {
    localStorage.setItem(API_KEY_STORAGE_KEY, state.googleApiKey);
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }

  if (state.discordWebhookUrl) {
    localStorage.setItem(DISCORD_WEBHOOK_STORAGE_KEY, state.discordWebhookUrl);
  } else {
    localStorage.removeItem(DISCORD_WEBHOOK_STORAGE_KEY);
  }
}

// ==============================
// データ参照・並び替え・検索
// ==============================
function titleFor(id) {
  return state.titles.find((title) => title.id === id);
}

function sortedReleases() {
  return [...state.releases].sort((a, b) => a.date.localeCompare(b.date));
}

function upcomingReleases() {
  return sortedReleases().filter((release) => daysUntil(release.date) >= 0);
}

function noticeReleases() {
  return upcomingReleases().filter((release) => daysUntil(release.date) <= state.noticeDays);
}

function nextReleaseDateFor(titleId) {
  const upcoming = sortedReleases().filter(
    (release) => release.titleId === titleId && daysUntil(release.date) >= 0,
  );
  return upcoming.length ? upcoming[0].date : null;
}

function sortTitles(titles) {
  const sorted = [...titles];

  if (state.sortOrder === "nextRelease") {
    sorted.sort((a, b) => {
      const dateA = nextReleaseDateFor(a.id);
      const dateB = nextReleaseDateFor(b.id);
      if (!dateA && !dateB) return a.name.localeCompare(b.name, "ja");
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA.localeCompare(dateB);
    });
  } else if (state.sortOrder === "recentlyAdded") {
    sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }

  return sorted;
}

function matchesSearch(title, releases) {
  const q = state.search.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    title.name,
    title.author,
    ...releases.flatMap((release) => [release.volume, release.memo, release.date]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function releaseExists(candidate) {
  return state.releases.some((release) => {
    if (candidate.isbn && release.sourceId === candidate.isbn) return true;
    return (
      release.titleId === candidate.titleId &&
      release.volume === candidate.volume &&
      release.date === candidate.date
    );
  });
}

function emptyNode() {
  return els.emptyTemplate.content.firstElementChild.cloneNode(true);
}

// ==============================
// 画面描画
// ==============================
function render() {
  save();
  renderMetrics();
  renderSelect();
  renderMangaList();
  renderCandidates();
  renderNotices();
  renderCalendar();
  syncToCloud();
}

function renderMetrics() {
  els.titleCount.textContent = state.titles.length;
  els.futureCount.textContent = upcomingReleases().length;
  els.noticeCount.textContent = noticeReleases().length;
}

function renderSelect() {
  els.releaseManga.replaceChildren();
  if (!state.titles.length) {
    const option = new Option("先に作品を登録", "");
    option.disabled = true;
    option.selected = true;
    els.releaseManga.append(option);
    els.releaseForm.querySelector("button").disabled = true;
    return;
  }

  [...state.titles]
    .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    .forEach((title) => {
      els.releaseManga.append(new Option(title.name, title.id));
    });
  els.releaseForm.querySelector("button").disabled = false;
}

function renderMangaList() {
  const matched = sortTitles(state.titles)
    .map((title) => {
      const releases = sortedReleases().filter((release) => release.titleId === title.id);
      return { title, releases };
    })
    .filter(({ title, releases }) => matchesSearch(title, releases));

  const cards = matched.map(({ title, releases }) => buildMangaCard(title, releases));

  els.mangaList.replaceChildren(...(cards.length ? cards : [emptyNode()]));
}

function buildMangaCard(title, releases) {
  const card = document.createElement("article");
  card.className = "manga-card";
  const isExpanded = state.expandedTitles.has(title.id);

  const cover = document.createElement("div");
  cover.className = title.thumbnailUrl ? "manga-cover" : "manga-cover empty";
  if (title.thumbnailUrl) {
    const img = document.createElement("img");
    img.src = title.thumbnailUrl;
    img.alt = "";
    cover.append(img);
  } else {
    cover.textContent = "No image";
  }
  ensureTitleThumbnail(title); // 未確定、または未取得なら条件を満たす範囲でバックグラウンド確認する
  card.append(cover);

  const head = document.createElement("div");
  head.className = "manga-card-head";
  head.innerHTML = `
    <div class="manga-title">
      <strong></strong>
      <span></span>
    </div>
    <div class="card-actions">
      <span class="toggle-icon" aria-hidden="true">${isExpanded ? "▾" : "▸"}</span>
      <button class="edit-button" type="button" title="作品を編集" aria-label="作品を編集">✎</button>
      <button class="delete-button" type="button" title="作品を削除" aria-label="作品を削除">×</button>
    </div>
  `;
  head.querySelector("strong").textContent = title.name;
  head.querySelector("span").textContent = title.author || "作者未登録";

  head.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    if (state.expandedTitles.has(title.id)) {
      state.expandedTitles.delete(title.id);
    } else {
      state.expandedTitles.add(title.id);
    }
    renderMangaList();
  });

  head.querySelector(".edit-button").addEventListener("click", (event) => {
    event.stopPropagation();
    showTitleEditor(card, title);
  });
  head.querySelector(".delete-button").addEventListener("click", (event) => {
    event.stopPropagation();
    deleteTitle(title.id);
  });

  card.append(head);

  if (isExpanded) {
    card.append(buildReleaseList(releases));
  } else {
    card.append(buildReleaseSummary(releases, title.id));
  }

  return card;
}

function buildReleaseSummary(releases, titleId) {
  const summary = document.createElement("div");
  summary.className = "release-summary";
  const nextDate = nextReleaseDateFor(titleId);

  if (!releases.length) {
    summary.textContent = "発売予定は未登録";
  } else if (nextDate) {
    const nextRelease = releases.find((r) => r.date === nextDate);
    const delta = daysUntil(nextDate);
    const when = delta === 0 ? "本日発売" : `あと${delta}日`;
    const rest = releases.length - 1;
    summary.textContent = `次回: ${nextRelease.volume}巻 / ${formatDate.format(dateOnly(nextDate))} / ${when}${rest ? `（他${rest}件）` : ""}`;
  } else {
    summary.textContent = `発売予定 ${releases.length}件（すべて発売済み）`;
  }

  return summary;
}

function buildReleaseList(releases) {
  const list = document.createElement("div");
  list.className = "release-list";

  if (!releases.length) {
    const empty = document.createElement("div");
    empty.className = "release-row";
    empty.innerHTML = `<span class="release-meta">発売予定は未登録</span>`;
    list.append(empty);
    return list;
  }

  releases.forEach((release) => {
    const row = document.createElement("div");
    row.className = "release-row";
    const delta = daysUntil(release.date);
    const when = delta < 0 ? `${Math.abs(delta)}日前に発売` : delta === 0 ? "本日発売" : `あと${delta}日`;

    row.innerHTML = `
      <div>
        <div class="release-name"></div>
        <div class="release-meta"></div>
      </div>
      ${!release.price ? '<button class="ghost-button price-refresh-button" type="button">価格を確認</button>' : ""}
      <button class="delete-button" type="button" title="発売日を削除" aria-label="発売日を削除">×</button>
    `;
    row.querySelector(".release-name").textContent = `${release.volume}巻`;
    row.querySelector(".release-meta").textContent = [
      formatDate.format(dateOnly(release.date)),
      when,
      formatPrice(release.price),
      release.memo,
    ]
      .filter(Boolean)
      .join(" / ");

    const refreshButton = row.querySelector(".price-refresh-button");
    if (refreshButton) {
      refreshButton.addEventListener("click", () => updateReleasePrice(release.id, refreshButton));
    }

    row.querySelector(".delete-button").addEventListener("click", () => deleteRelease(release.id));
    list.append(row);
  });

  return list;
}

function renderCandidates() {
  els.syncButton.disabled = state.syncing || state.titles.length === 0;
  if (state.titles.length === 0) {
    els.syncStatus.textContent = "先に作品を登録してください。";
  }

  const cards = state.candidates.map((candidate) => {
    const title = titleFor(candidate.titleId);
    const card = document.createElement("article");
    card.className = "candidate-card";

    const cover = document.createElement("div");
    cover.className = candidate.thumbnail ? "candidate-cover" : "candidate-cover empty";
    if (candidate.thumbnail) {
      const img = document.createElement("img");
      img.src = candidate.thumbnail;
      img.alt = "";
      cover.append(img);
    } else {
      cover.textContent = "No image";
    }

    const body = document.createElement("div");
    body.innerHTML = `
      <div class="candidate-title"></div>
      <div class="candidate-meta"></div>
    `;
    body.querySelector(".candidate-title").textContent = candidate.bookTitle;
    body.querySelector(".candidate-meta").textContent = [
      title ? `登録作品: ${title.name}` : "登録作品: 不明",
      candidate.volume ? `${candidate.volume}巻` : "巻数未判定",
      candidate.date ? formatDate.format(dateOnly(candidate.date)) : "発売日未取得",
      candidate.publisher,
      formatPrice(candidate.price),
      candidate.isbn ? `ISBN ${candidate.isbn}` : "",
      candidate.sourceLabel,
    ]
      .filter(Boolean)
      .join(" / ");

    const actions = document.createElement("div");
    actions.className = "candidate-actions";
    const score = document.createElement("div");
    score.className = "score-badge";
    score.textContent = `一致度 ${candidate.score}`;
    const button = document.createElement("button");
    button.className = "ghost-button";
    button.type = "button";
    button.textContent = "取り込む";
    button.disabled = !candidate.date;
    button.addEventListener("click", () => importCandidate(candidate.id));
    actions.append(score, button);

    card.append(cover, body, actions);
    return card;
  });

  els.candidateList.replaceChildren(...cards);
}

function renderNotices() {
  const cards = noticeReleases().map((release) => {
    const title = titleFor(release.titleId);
    const delta = daysUntil(release.date);
    const card = document.createElement("article");
    card.className = `notice-card ${delta === 0 ? "today" : delta <= 1 ? "soon" : ""}`;

    const cover = document.createElement("div");
    const coverUrl = release.thumbnailUrl || title?.thumbnailUrl || "";
    cover.className = coverUrl ? "notice-cover" : "notice-cover empty";
    if (coverUrl) {
      const img = document.createElement("img");
      img.src = coverUrl;
      img.alt = "";
      cover.append(img);
    }
    if (!release.thumbnailConfirmed) {
      ensureReleaseThumbnail(release); // その巻専用の表紙がまだ確定していなければ、裏で取得を試みる
    }

    const info = document.createElement("div");
    info.className = "notice-info";
    info.innerHTML = `
      <div>
        <strong></strong>
        <span></span>
      </div>
      <div class="badge"></div>
      <div class="notice-date"></div>
    `;
    info.querySelector("strong").textContent = title ? title.name : "削除済みの作品";
    info.querySelector("span").textContent = `${release.volume}巻${release.memo ? ` / ${release.memo}` : ""}`;
    info.querySelector(".badge").textContent = delta === 0 ? "今日" : `あと${delta}日`;
    info.querySelector(".notice-date").textContent = formatDate.format(dateOnly(release.date));

    card.append(cover, info);
    return card;
  });

  if (!cards.length) {
    const empty = emptyNode();
    empty.querySelector("strong").textContent = "通知対象はありません";
    empty.querySelector("span").textContent = `発売${state.noticeDays}日前までの新刊がここに表示されます。`;
    els.noticeList.replaceChildren(empty);
    return;
  }

  els.noticeList.replaceChildren(...cards);
}

function renderCalendar() {
  const month = state.calendarDate.getMonth();
  const year = state.calendarDate.getFullYear();
  els.monthLabel.textContent = formatMonth.format(new Date(year, month, 1));

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"].map((day) => {
    const el = document.createElement("div");
    el.className = "weekday";
    el.textContent = day;
    return el;
  });

  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const todayIso = isoDate(new Date());
  const cells = [];
  const maxDots = 4;

  for (let i = 0; i < 42; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const dayIso = isoDate(day);
    const dayReleases = state.releases.filter((release) => release.date === dayIso);

    const cell = document.createElement("div");
    cell.className = [
      "day",
      day.getMonth() !== month ? "other-month" : "",
      dayIso === todayIso ? "today" : "",
      dayReleases.length ? "has-releases" : "",
      state.selectedCalendarDate === dayIso ? "selected" : "",
    ]
      .filter(Boolean)
      .join(" ");

    cell.innerHTML = `<span class="day-number"></span><div class="day-dots"></div>`;
    cell.querySelector(".day-number").textContent = day.getDate();

    const dotsContainer = cell.querySelector(".day-dots");
    dayReleases.slice(0, maxDots).forEach(() => {
      const dot = document.createElement("span");
      dot.className = "day-dot";
      dotsContainer.append(dot);
    });
    if (dayReleases.length > maxDots) {
      const more = document.createElement("span");
      more.className = "day-more";
      more.textContent = `+${dayReleases.length - maxDots}`;
      dotsContainer.append(more);
    }

    if (dayReleases.length) {
      cell.addEventListener("click", () => {
        state.selectedCalendarDate = state.selectedCalendarDate === dayIso ? null : dayIso;
        renderCalendar();
      });
    }

    cells.push(cell);
  }

  els.calendar.replaceChildren(...weekdays, ...cells);
  renderDayDetail();
}

function renderDayDetail() {
  if (!state.selectedCalendarDate) {
    els.dayDetailOverlay.classList.remove("visible");
    els.dayDetail.replaceChildren();
    return;
  }

  const dayReleases = state.releases
    .filter((release) => release.date === state.selectedCalendarDate)
    .sort((a, b) => (titleFor(a.titleId)?.name || "").localeCompare(titleFor(b.titleId)?.name || "", "ja"));

  if (!dayReleases.length) {
    state.selectedCalendarDate = null;
    els.dayDetailOverlay.classList.remove("visible");
    els.dayDetail.replaceChildren();
    return;
  }

  const wrapper = document.createElement("div");

  const heading = document.createElement("div");
  heading.className = "day-detail-title";
  heading.textContent = `${formatDate.format(dateOnly(state.selectedCalendarDate))}の発売予定`;
  wrapper.append(heading);

  const list = document.createElement("div");
  list.className = "day-detail-list";

  dayReleases.forEach((release) => {
    const title = titleFor(release.titleId);
    const coverUrl = release.thumbnailUrl || title?.thumbnailUrl || "";

    const item = document.createElement("div");
    item.className = "day-detail-item";

    const cover = document.createElement("div");
    cover.className = "day-detail-cover";
    if (coverUrl) {
      const img = document.createElement("img");
      img.src = coverUrl;
      img.alt = "";
      cover.append(img);
    }

    const info = document.createElement("div");
    info.innerHTML = `<strong></strong><span></span>`;
    info.querySelector("strong").textContent = title
      ? `${title.name} ${release.volume}巻`
      : `${release.volume}巻（削除済みの作品）`;
    info.querySelector("span").textContent =
      [formatPrice(release.price), release.memo].filter(Boolean).join(" / ") || "詳細情報なし";

    item.append(cover, info);
    list.append(item);
  });

  wrapper.append(list);
  els.dayDetail.replaceChildren(wrapper);
  els.dayDetailOverlay.classList.add("visible");
}

function closeDayDetail() {
  state.selectedCalendarDate = null;
  renderCalendar();
}

// ==============================
// 作品・発売日の登録/編集/削除
// ==============================
function addTitle(event) {
  event.preventDefault();
  const name = els.mangaTitle.value.trim();
  const author = els.mangaAuthor.value.trim();
  if (!name) return;

  const existing = state.titles.find((title) => title.name.toLocaleLowerCase("ja").trim() === name.toLocaleLowerCase("ja"));
  if (existing) {
    existing.author = author || existing.author;
  } else {
    state.titles.push({ id: uid(), name, author, createdAt: Date.now() });
  }

  els.mangaForm.reset();
  showToast(existing ? "登録済みの作品を更新しました" : "作品を登録しました");
  els.mangaTitleSuggestions.replaceChildren();
  render();
}

function showTitleEditor(card, title) {
  const oldEditor = card.querySelector(".title-edit-form");
  if (oldEditor) {
    oldEditor.remove();
    return;
  }

  const editor = document.createElement("form");
  editor.className = "title-edit-form";
  editor.innerHTML = `
    <label>
      <span>作品名</span>
      <input name="name" required autocomplete="off" />
    </label>
    <label>
      <span>作者</span>
      <input name="author" autocomplete="off" />
    </label>
    <div class="edit-actions">
      <button class="primary-button" type="submit">保存</button>
      <button class="ghost-button" type="button">キャンセル</button>
    </div>
  `;

  editor.elements.name.value = title.name;
  editor.elements.author.value = title.author || "";
  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    updateTitle(title.id, editor.elements.name.value, editor.elements.author.value);
  });
  editor.querySelector(".ghost-button").addEventListener("click", () => editor.remove());

  const head = card.querySelector(".manga-card-head");
  head.insertAdjacentElement("afterend", editor);
  editor.elements.name.focus();
}

function updateTitle(id, nameValue, authorValue) {
  const title = titleFor(id);
  const name = String(nameValue || "").trim();
  const author = String(authorValue || "").trim();
  if (!title || !name) return;

  const duplicate = state.titles.find((item) => item.id !== id && item.name === name);
  if (duplicate) {
    alert("同じ作品名がすでに登録されています。");
    return;
  }

  title.name = name;
  title.author = author;
  state.candidates = state.candidates.filter((candidate) => candidate.titleId !== id);
  render();
}

function addRelease(event) {
  event.preventDefault();
  const titleId = els.releaseManga.value;
  if (!titleId) return;

  const rawPrice = els.releasePrice.value.trim();
  const priceAmount = rawPrice ? Number(rawPrice) : null;

  const volume = els.releaseVolume.value.trim();
  const date = normalizeDate(els.releaseDate.value);
  if (!volume || !date || (rawPrice && (!Number.isFinite(priceAmount) || priceAmount < 0))) {
    showToast("発売日・巻数・価格を確認してください");
    return;
  }
  if (state.releases.some((item) => item.titleId === titleId && item.volume === volume && item.date === date)) {
    showToast("同じ巻数・発売日はすでに登録されています");
    return;
  }
  state.releases.push({
    id: uid(),
    titleId,
    volume,
    date,
    memo: els.releaseMemo.value.trim(),
    price: priceAmount ? { amount: priceAmount, currency: "JPY" } : null,
  });

  els.releaseForm.reset();
  showToast("発売予定を追加しました");
  els.releaseManga.value = titleId;
  render();
}

function deleteTitle(id) {
  state.titles = state.titles.filter((title) => title.id !== id);
  state.releases = state.releases.filter((release) => release.titleId !== id);
  render();
}

function deleteRelease(id) {
  state.releases = state.releases.filter((release) => release.id !== id);
  render();
}

// ==============================
// 文字列処理（巻数抽出・正規化）
// ==============================
function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "");
}

function toHalfWidthNumber(value) {
  return String(value || "").replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
}

function extractVolume(bookTitle, registeredTitle) {
  const withoutSeries = String(bookTitle || "").replace(String(registeredTitle || ""), "");
  const normalized = toHalfWidthNumber(withoutSeries);
  const patterns = [
    /(?:第|\s|^)(\d{1,3})\s*巻/,
    /[（(]\s*(\d{1,3})\s*[）)]/,
    /\s(\d{1,3})$/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return match[1];
  }
  return "";
}

// シリーズ名だけを取り出す（巻数・版表記を除去）
function guessSeriesName(rawTitle) {
  return String(rawTitle || "")
    .replace(/[（(\[［].*?[）)\]］]/g, "")
    .replace(/第?\d+\s*巻/g, "")
    .replace(/vol\.?\s*\d+/gi, "")
    .replace(/\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getIsbn(volumeInfo) {
  const identifiers = volumeInfo.industryIdentifiers || [];
  const isbn13 = identifiers.find((item) => item.type === "ISBN_13")?.identifier;
  const isbn10 = identifiers.find((item) => item.type === "ISBN_10")?.identifier;
  return isbn13 || isbn10 || "";
}

function getPrice(volume) {
  const saleInfo = volume.saleInfo || {};
  const priceInfo = saleInfo.retailPrice || saleInfo.listPrice;
  if (!priceInfo || typeof priceInfo.amount !== "number") return null;
  return {
    amount: priceInfo.amount,
    currency: priceInfo.currencyCode || "JPY",
  };
}

function xmlText(node, tagName) {
  return node.getElementsByTagName(tagName)[0]?.textContent?.trim() || "";
}

function isbnFromText(value) {
  const compact = String(value || "").replace(/[-\s]/g, "");
  return compact.match(/97[89]\d{10}/)?.[0] || compact.match(/\d{9}[\dX]/i)?.[0] || "";
}

// ==============================
// スコアリング
// ==============================
function scoreGoogleVolume(volume, registeredTitle) {
  const info = volume.volumeInfo || {};
  const bookTitle = info.title || "";
  const titleKey = normalizeText(registeredTitle.name);
  const bookKey = normalizeText(bookTitle);
  const authors = (info.authors || []).join(" ");
  let score = 0;

  if (bookKey.includes(titleKey)) score += 55;
  if (registeredTitle.author && normalizeText(authors).includes(normalizeText(registeredTitle.author))) {
    score += 25;
  }
  if (extractVolume(bookTitle, registeredTitle.name)) score += 10;
  if (normalizeDate(info.publishedDate)) score += 10;
  if (daysUntil(normalizeDate(info.publishedDate) || "1970-01-01") >= -45) score += 8;
  if (/小説|novel|公式ガイド|ガイドブック|ファンブック|画集|完全版|文庫版|新装版/i.test(bookTitle)) {
    score -= 30;
  }

  return score;
}

function scoreBookTitle(bookTitle, authors, registeredTitle) {
  const titleKey = normalizeText(registeredTitle.name);
  const bookKey = normalizeText(bookTitle);
  let score = 0;
  if (bookKey.includes(titleKey)) score += 55;
  if (registeredTitle.author && normalizeText(authors).includes(normalizeText(registeredTitle.author))) {
    score += 25;
  }
  if (extractVolume(bookTitle, registeredTitle.name)) score += 10;
  if (/小説|novel|公式ガイド|ガイドブック|ファンブック|画集|完全版|文庫版|新装版/i.test(bookTitle)) {
    score -= 30;
  }
  return score;
}

// ==============================
// 外部API呼び出し
// ==============================
async function fetchOpenBdDate(isbn) {
  if (!isbn) return "";
  try {
    const url = `https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(isbn)}`;
    const response = await fetch(url);
    if (!response.ok) return "";
    const [item] = await response.json();
    const summaryDate = item?.summary?.pubdate;
    const hanmotoDate = item?.hanmoto?.dateshuppan;
    const publishingDate =
      item?.onix?.PublishingDetail?.PublishingDate?.[0]?.Date ||
      item?.onix?.PublishingDetail?.PublishingDate?.Date;
    return normalizeDate(summaryDate) || normalizeDate(hanmotoDate) || normalizeDate(publishingDate);
  } catch {
    return "";
  }
}

async function searchGoogleCandidates(registeredTitle) {
  const query = [`intitle:${registeredTitle.name}`];
  if (registeredTitle.author) query.push(`inauthor:${registeredTitle.author}`);
  const params = new URLSearchParams({
    q: query.join(" "),
    orderBy: "newest",
    printType: "books",
    langRestrict: "ja",
    maxResults: "20",
    country: "JP",
  });
  if (state.googleApiKey) params.set("key", state.googleApiKey);

  const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Google Books APIから取得できませんでした。HTTP ${response.status}`);
  }
  const data = await response.json();
  const volumes = Array.isArray(data.items) ? data.items : [];
  const candidates = [];

  for (const volume of volumes) {
    const info = volume.volumeInfo || {};
    const score = scoreGoogleVolume(volume, registeredTitle);
    if (score < 45) continue;

    const isbn = getIsbn(info);
    const openBdDate = await fetchOpenBdDate(isbn);
    const date = openBdDate || normalizeDate(info.publishedDate);
    if (!date) continue;
    if (daysUntil(date) < -45) continue;

    const candidate = {
      id: `${registeredTitle.id}:${isbn || volume.id}:${date}`,
      titleId: registeredTitle.id,
      bookTitle: info.title || registeredTitle.name,
      volume: extractVolume(info.title || "", registeredTitle.name) || "?",
      date,
      memo: ["自動取得", isbn ? `ISBN ${isbn}` : "", info.publisher].filter(Boolean).join(" / "),
      publisher: info.publisher || "",
      isbn,
      price: getPrice(volume),
      sourceId: isbn || volume.id,
      sourceLabel: openBdDate ? "Google Books + openBD" : "Google Books",
      thumbnail: info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || "",
      score,
    };

    if (!releaseExists(candidate)) candidates.push(candidate);
  }

  return candidates;
}

async function searchNdlCandidates(registeredTitle) {
  const params = new URLSearchParams({
    cnt: "20",
    title: registeredTitle.name,
  });
  const response = await fetch(`https://ndlsearch.ndl.go.jp/api/opensearch?${params.toString()}`);
  if (!response.ok) throw new Error(`NDLサーチAPIから取得できませんでした。HTTP ${response.status}`);

  const xml = await response.text();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const items = [...doc.getElementsByTagName("item")];
  const candidates = [];

  items.forEach((item, index) => {
    const bookTitle = xmlText(item, "title");
    const authors = xmlText(item, "dc:creator") || xmlText(item, "author");
    const publisher = xmlText(item, "dc:publisher");
    const date = normalizeDate(xmlText(item, "dc:date") || xmlText(item, "pubDate"));
    const link = xmlText(item, "link");
    const isbn = isbnFromText(xmlText(item, "dc:identifier") || item.textContent);
    const score = scoreBookTitle(bookTitle, authors, registeredTitle) + (date ? 10 : 0);
    if (score < 45 || !date) return;
    if (daysUntil(date) < 0) return;

    // ISBNが一致すればGoogle Books側の候補と同じidになり、価格情報を持つ方が優先して残る
    const candidate = {
      id: `${registeredTitle.id}:${isbn || `ndl-${link || index}`}:${date}`,
      titleId: registeredTitle.id,
      bookTitle,
      volume: extractVolume(bookTitle, registeredTitle.name) || "?",
      date,
      memo: ["自動取得", isbn ? `ISBN ${isbn}` : "", publisher, "NDLサーチ"].filter(Boolean).join(" / "),
      publisher,
      isbn,
      sourceId: isbn || link || `ndl-${index}`,
      sourceLabel: "NDLサーチ",
      thumbnail: "",
      score,
    };

    if (!releaseExists(candidate)) candidates.push(candidate);
  });

  return candidates;
}

async function searchTitleCandidates(registeredTitle) {
  const allCandidates = [];
  const errors = [];
  let successfulSources = 0;

  try {
    allCandidates.push(...(await searchGoogleCandidates(registeredTitle)));
    successfulSources += 1;
  } catch (error) {
    errors.push(error.message);
  }

  try {
    allCandidates.push(...(await searchNdlCandidates(registeredTitle)));
    successfulSources += 1;
  } catch (error) {
    errors.push(error.message);
  }

  if (!allCandidates.length && errors.length && successfulSources === 0) {
    throw new Error(errors.join(" / "));
  }

  return uniqueItems(allCandidates, (candidate) => candidate.id);
}

async function syncCandidates() {
  if (!state.titles.length || state.syncing) return;

  state.syncing = true;
  state.candidates = [];
  els.syncStatus.textContent = "検索しています...";
  renderCandidates();

  try {
    const allCandidates = [];
    for (const title of state.titles) {
      els.syncStatus.textContent = `${title.name} を検索しています...`;
      const candidates = await searchTitleCandidates(title);
      allCandidates.push(...candidates);
    }

    state.candidates = uniqueItems(allCandidates, (candidate) => candidate.id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.score - a.score)
      .slice(0, 24);
    els.syncStatus.textContent = state.candidates.length
      ? `${state.candidates.length}件の候補が見つかりました。`
      : "候補は見つかりませんでした。作品名や作者名を見直すと見つかる場合があります。";
  } catch (error) {
    els.syncStatus.textContent = `${error.message} APIキーやネットワーク制限が必要な場合があります。`;
  } finally {
    state.syncing = false;
    renderCandidates();
  }
}

function importCandidate(candidateId) {
  const candidate = state.candidates.find((item) => item.id === candidateId);
  if (!candidate || !candidate.date) return;

  if (!releaseExists(candidate)) {
    state.releases.push({
      id: uid(),
      titleId: candidate.titleId,
      volume: candidate.volume,
      date: candidate.date,
      memo: candidate.memo,
      price: candidate.price || null,
      isbn: candidate.isbn || "",
      sourceId: candidate.sourceId,
      // 検索時点で見えていたこの巻専用の表紙をそのまま保存（すでに確定済みとして扱う）
      thumbnailUrl: candidate.thumbnail || "",
      thumbnailConfirmed: Boolean(candidate.thumbnail),
      thumbnailCheckedAt: candidate.thumbnail ? Date.now() : 0,
    });
  }

  state.candidates = state.candidates.filter((item) => item.id !== candidateId);
  state.calendarDate = dateOnly(candidate.date);
  render();
}

// ==============================
// 価格の後から確認・更新
// ==============================
async function fetchPriceForRelease(release) {
  try {
    let volume = null;

    if (release.isbn) {
      const params = new URLSearchParams({ q: `isbn:${release.isbn}`, country: "JP" });
      if (state.googleApiKey) params.set("key", state.googleApiKey);
      const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        volume = (data.items || [])[0] || null;
      }
    }

    if (!volume) {
      const title = titleFor(release.titleId);
      if (!title) return null;

      const params = new URLSearchParams({
        q: `intitle:${title.name}`,
        printType: "books",
        langRestrict: "ja",
        maxResults: "10",
        country: "JP",
      });
      if (state.googleApiKey) params.set("key", state.googleApiKey);
      const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        const items = Array.isArray(data.items) ? data.items : [];
        volume = items.find(
          (item) => extractVolume(item.volumeInfo?.title || "", title.name) === release.volume,
        ) || null;
      }
    }

    if (!volume) return null;
    return getPrice(volume);
  } catch {
    return null;
  }
}

async function updateReleasePrice(releaseId, button) {
  const release = state.releases.find((r) => r.id === releaseId);
  if (!release) return;

  button.disabled = true;
  button.textContent = "確認中…";

  const price = await fetchPriceForRelease(release);
  if (price) {
    release.price = price;
    render();
  } else {
    button.disabled = false;
    button.textContent = "価格を確認";
    alert("価格情報はまだ見つかりませんでした。もう少し後で試してみてください。");
  }
}

// ==============================
// 登録作品のカバー画像（1巻の表紙）取得
// ==============================
const thumbnailFetching = new Set(); // 今まさに取得中の作品idを覚えておく（二重リクエスト防止）
let thumbnailCooldownUntil = 0;

async function fetchFirstVolumeThumbnail(title) {
  try {
    const query = [`intitle:${title.name}`];
    if (title.author) query.push(`inauthor:${title.author}`);
    const params = new URLSearchParams({
      q: query.join(" "),
      printType: "books",
      langRestrict: "ja",
      maxResults: "20",
      country: "JP",
    });
    if (state.googleApiKey) params.set("key", state.googleApiKey);

    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`);
    if (response.status === 429) {
      thumbnailCooldownUntil = Date.now() + 60000;
      return null;
    }
    if (!response.ok) return null;

    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];

    // 巻数が読み取れたものの中で、一番若い巻数の画像を選ぶ（1巻が無ければ次点で若い巻を代用）
    let bestCandidate = null; // { volumeNumber, thumbnail }
    let noVolumeFallback = null; // 巻数が読み取れなかった場合の最終手段

    for (const item of items) {
      const info = item.volumeInfo || {};
      const thumbnail = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail;
      if (!thumbnail) continue;

      const volumeText = extractVolume(info.title || "", title.name);
      const volumeNumber = volumeText ? Number(volumeText) : null;

      if (volumeNumber && (!bestCandidate || volumeNumber < bestCandidate.volumeNumber)) {
        bestCandidate = { volumeNumber, thumbnail };
      }
      if (!noVolumeFallback) noVolumeFallback = thumbnail;
    }

    if (bestCandidate) {
      return { url: bestCandidate.thumbnail, confirmed: bestCandidate.volumeNumber === 1 };
    }
    return noVolumeFallback ? { url: noVolumeFallback, confirmed: false } : null;
  } catch {
    return null;
  }
}

const THUMBNAIL_RECHECK_INTERVAL = 24 * 60 * 60 * 1000; // 未確定の場合、1日おきに再チェック

// ある「発売日データ（release）」に対応する、その巻専用の表紙を検索する
async function fetchVolumeThumbnail(release) {
  try {
    // ISBNが分かっていれば、それでピンポイントに検索（一致すれば確定扱い）
    if (release.isbn) {
      const params = new URLSearchParams({ q: `isbn:${release.isbn}`, country: "JP" });
      if (state.googleApiKey) params.set("key", state.googleApiKey);
      const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`);
      if (response.status === 429) {
        thumbnailCooldownUntil = Date.now() + 60000;
        return null;
      }
      if (response.ok) {
        const data = await response.json();
        const info = (data.items || [])[0]?.volumeInfo;
        const thumbnail = info?.imageLinks?.thumbnail || info?.imageLinks?.smallThumbnail;
        if (thumbnail) return { url: thumbnail, confirmed: true };
      }
    }

    // ISBNが無い/ヒットしなければ、タイトル+巻数で検索して一致するものを探す
    const title = titleFor(release.titleId);
    if (!title) return null;

    const params = new URLSearchParams({
      q: `intitle:${title.name}`,
      printType: "books",
      langRestrict: "ja",
      maxResults: "20",
      country: "JP",
    });
    if (state.googleApiKey) params.set("key", state.googleApiKey);
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`);
    if (response.status === 429) {
      thumbnailCooldownUntil = Date.now() + 60000;
      return null;
    }
    if (!response.ok) return null;

    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];

    for (const item of items) {
      const info = item.volumeInfo || {};
      const thumbnail = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail;
      if (!thumbnail) continue;
      if (extractVolume(info.title || "", title.name) === release.volume) {
        return { url: thumbnail, confirmed: true }; // 巻数が一致したので確定扱い
      }
    }
    return null;
  } catch {
    return null;
  }
}

const releaseThumbnailFetching = new Set();

async function ensureReleaseThumbnail(release) {
  if (release.thumbnailConfirmed) return;
  if (releaseThumbnailFetching.has(release.id)) return;
  if (Date.now() < thumbnailCooldownUntil) return;
  if (release.thumbnailCheckedAt && Date.now() - release.thumbnailCheckedAt < THUMBNAIL_RECHECK_INTERVAL) return;

  releaseThumbnailFetching.add(release.id);
  const result = await fetchVolumeThumbnail(release);
  releaseThumbnailFetching.delete(release.id);

  release.thumbnailCheckedAt = Date.now();

  if (result) {
    release.thumbnailUrl = result.url;
    release.thumbnailConfirmed = result.confirmed;
    save();
    renderNotices();
  } else {
    save();
  }
}

async function ensureTitleThumbnail(title) {
  if (title.thumbnailConfirmed) return; // 1巻の表紙と確定済みなら何もしない
  if (thumbnailFetching.has(title.id)) return;
  if (Date.now() < thumbnailCooldownUntil) return;
  if (title.thumbnailCheckedAt && Date.now() - title.thumbnailCheckedAt < THUMBNAIL_RECHECK_INTERVAL) return;

  thumbnailFetching.add(title.id);
  const result = await fetchFirstVolumeThumbnail(title);
  thumbnailFetching.delete(title.id);

  title.thumbnailCheckedAt = Date.now();

  if (result) {
    title.thumbnailUrl = result.url;
    title.thumbnailConfirmed = result.confirmed;
    save();
    renderMangaList();
  } else {
    save(); // チェック日時だけでも保存し、毎回の再検索を防ぐ
  }
}

// ==============================
// 作品名の入力補完機能（サジェスト）
// ==============================
const suggestionCache = new Map();
let suggestionCooldownUntil = 0;

async function fetchTitleSuggestions(query) {
  if (!query || query.length < 2) {
    els.mangaTitleSuggestions.replaceChildren();
    return;
  }

  if (suggestionCache.has(query)) {
    renderTitleSuggestions(suggestionCache.get(query));
    return;
  }

  if (Date.now() < suggestionCooldownUntil) return;

  try {
    const params = new URLSearchParams({
      q: `intitle:${query}`,
      printType: "books",
      langRestrict: "ja",
      maxResults: "8",
    });
    if (state.googleApiKey) params.set("key", state.googleApiKey);

    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`);

    if (response.status === 429) {
      suggestionCooldownUntil = Date.now() + 60000;
      return;
    }
    if (!response.ok) return;

    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];

    const seen = new Set();
    const suggestions = [];
    for (const item of items) {
      const info = item.volumeInfo || {};
      const seriesName = guessSeriesName(info.title);
      if (!seriesName || seen.has(seriesName)) continue;
      seen.add(seriesName);
      suggestions.push({ name: seriesName, author: (info.authors || [])[0] || "" });
    }

    const result = suggestions.slice(0, 5);
    suggestionCache.set(query, result);
    renderTitleSuggestions(result);
  } catch {
    els.mangaTitleSuggestions.replaceChildren();
  }
}

function renderTitleSuggestions(suggestions) {
  if (!suggestions.length) {
    els.mangaTitleSuggestions.replaceChildren();
    return;
  }

  const items = suggestions.map((suggestion) => {
    const item = document.createElement("div");
    item.className = "suggestion-item";
    item.textContent = suggestion.author
      ? `${suggestion.name} / ${suggestion.author}`
      : suggestion.name;
    item.addEventListener("click", () => {
      els.mangaTitle.value = suggestion.name;
      if (suggestion.author) els.mangaAuthor.value = suggestion.author;
      els.mangaTitleSuggestions.replaceChildren();
    });
    return item;
  });

  els.mangaTitleSuggestions.replaceChildren(...items);
}

const debouncedFetchSuggestions = debounce(fetchTitleSuggestions, 500);

// ==============================
// Discord通知
// ==============================
async function sendDiscordNotification(message) {
  if (!state.discordWebhookUrl) return;

  try {
    await fetch(state.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  } catch (error) {
    console.error("Discord通知に失敗しました", error);
  }
}

async function checkNotifications({ automatic = false } = {}) {
  const notices = noticeReleases();
  if (!notices.length) {
    if (!automatic) showToast("現在、通知対象の新刊はありません");
    return;
  }

  const today = isoDate(new Date());
  const notified = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "{}");
  const pending = automatic ? notices.filter((release) => notified[release.id] !== `${release.date}|${today}`) : notices;
  if (!pending.length) return;
  if (!automatic) for (const release of pending.slice(0, 4)) {
    const title = titleFor(release.titleId);
    const delta = daysUntil(release.date);
    const text = `📚 **${title?.name || "新刊"} ${release.volume}巻**\n${delta === 0 ? "本日発売" : `あと${delta}日`} / ${formatDate.format(dateOnly(release.date))}`;
    await sendDiscordNotification(text);
  }

  if (!("Notification" in window)) {
    if (!automatic) showToast("このブラウザは通知に対応していません");
    return;
  }

  const permission = Notification.permission === "granted" ? "granted"
    : automatic ? Notification.permission : await Notification.requestPermission();
  if (permission !== "granted") {
    if (!automatic) showToast("通知を許可するとデスクトップ通知を受け取れます");
    return;
  }

  pending.slice(0, 4).forEach((release) => {
    const title = titleFor(release.titleId);
    const delta = daysUntil(release.date);
    new Notification(`${title?.name || "新刊"} ${release.volume}巻`, {
      body: `${delta === 0 ? "本日発売" : `あと${delta}日`} / ${formatDate.format(dateOnly(release.date))}`,
    });
    notified[release.id] = `${release.date}|${today}`;
  });
  if (automatic) localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified));
}

// ==============================
// クラウド同期（Google Apps Script）
// ==============================
async function syncToCloud() {
  if (!CLOUD_SYNC_URL) return;

  const releases = state.releases.map((release) => {
    const title = titleFor(release.titleId);
    return {
      id: release.id,
      titleName: title ? title.name : "削除済みの作品",
      volume: release.volume,
      date: release.date,
      memo: release.memo,
    };
  });

  try {
    await fetch(CLOUD_SYNC_URL, {
      method: "POST",
      // GASのCORSプリフライト回避のため、あえてContent-Typeヘッダーは付けていません
      body: JSON.stringify({
        releases,
        discordWebhookUrl: state.discordWebhookUrl,
        noticeDays: state.noticeDays,
      }),
    });
  } catch (error) {
    console.error("クラウド同期に失敗しました", error);
  }
}

// ==============================
// 背景画像
// ==============================

// 選んでもらった画像ファイルを、保存に適したサイズ・画質に圧縮してdata URLにする
function resizeImageFile(file, maxDimension = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = Math.min(maxDimension / width, maxDimension / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function applyBackgroundImage(dataUrl) {
  if (dataUrl) {
    document.body.style.backgroundImage = `url("${dataUrl}")`;
    document.body.classList.add("has-custom-background");
  } else {
    document.body.style.backgroundImage = "";
    document.body.classList.remove("has-custom-background");
  }
}

async function handleBackgroundUpload(file) {
  if (!file) return;

  try {
    const dataUrl = await resizeImageFile(file);
    applyBackgroundImage(dataUrl);

    try {
      localStorage.setItem(BACKGROUND_STORAGE_KEY, dataUrl);
    } catch {
      alert(
        "画像の保存に失敗しました（サイズが大きすぎる可能性があります）。表示は反映されていますが、再読み込みすると元に戻ります。",
      );
    }
  } catch {
    alert("画像の読み込みに失敗しました。別の画像でお試しください。");
  }
}

function resetBackgroundImage() {
  localStorage.removeItem(BACKGROUND_STORAGE_KEY);
  applyBackgroundImage(null);
}

// ==============================
// サンプルデータ・バックアップ
// ==============================
function addSampleData() {
  if (state.titles.length || state.releases.length) return;

  const today = dateOnly(new Date());
  const plus = (days) => {
    const date = new Date(today);
    date.setDate(today.getDate() + days);
    return isoDate(date);
  };

  const first = { id: uid(), name: "星灯りの食卓", author: "三浦 ナギ", createdAt: Date.now() };
  const second = { id: uid(), name: "雨上がり探偵社", author: "水野 透", createdAt: Date.now() };
  const third = { id: uid(), name: "北口アパートメント", author: "佐伯 まどか", createdAt: Date.now() };
  state.titles.push(first, second, third);
  state.releases.push(
    { id: uid(), titleId: first.id, volume: "4", date: plus(1), memo: "紙・電子同時", price: { amount: 748, currency: "JPY" } },
    { id: uid(), titleId: second.id, volume: "9", date: plus(7), memo: "", price: null },
    { id: uid(), titleId: third.id, volume: "2", date: plus(18), memo: "特装版あり", price: { amount: 1320, currency: "JPY" } },
  );
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify({titles: state.titles, releases: state.releases, noticeDays: state.noticeDays}, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `manga-release-watch-${isoDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      state.titles = Array.isArray(parsed.titles) ? parsed.titles : [];
      state.releases = Array.isArray(parsed.releases) ? parsed.releases : [];
      state.noticeDays = Number(parsed.noticeDays) || 3;
      els.noticeDays.value = String(state.noticeDays);
      render();
    } catch {
      alert("読み込みに失敗しました。JSONファイルを確認してください。");
    }
  });
  reader.readAsText(file);
}

// ==============================
// イベント登録
// ==============================
els.mangaForm.addEventListener("submit", addTitle);
els.releaseForm.addEventListener("submit", addRelease);

els.noticeDays.addEventListener("change", (event) => {
  state.noticeDays = Number(event.target.value);
  render();
});

els.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderMangaList();
});

els.sortOrder.addEventListener("change", (event) => {
  state.sortOrder = event.target.value;
  renderMangaList();
});

els.googleApiKey.addEventListener("input", (event) => {
  state.googleApiKey = event.target.value.trim();
  save();
});

els.discordWebhook.addEventListener("input", (event) => {
  state.discordWebhookUrl = event.target.value.trim();
  save();
});

els.mangaTitle.addEventListener("input", (event) => {
  debouncedFetchSuggestions(event.target.value.trim());
});

document.addEventListener("click", (event) => {
  if (event.target !== els.mangaTitle && !els.mangaTitleSuggestions.contains(event.target)) {
    els.mangaTitleSuggestions.replaceChildren();
  }
});

els.prevMonth.addEventListener("click", () => {
  state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
  renderCalendar();
});

els.nextMonth.addEventListener("click", () => {
  state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
  renderCalendar();
});

els.todayButton.addEventListener("click", () => {
  state.calendarDate = new Date();
  renderCalendar();
});

els.notifyButton.addEventListener("click", () => checkNotifications());
els.autoNotify.addEventListener("change", async (event) => {
  if (event.target.checked && (!("Notification" in window) || !window.isSecureContext)) {
    showToast("自動通知にはHTTPSまたはlocalhostでの利用が必要です");
    event.target.checked = false;
    return;
  }
  if (event.target.checked && Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showToast("ブラウザ通知が許可されませんでした");
      event.target.checked = false;
    }
  }
  state.autoNotify = event.target.checked;
  save();
  if (state.autoNotify) checkNotifications({ automatic: true });
});
els.jumpRegister.addEventListener("click", () => {
  els.mangaTitle.scrollIntoView({ behavior: "smooth", block: "center" });
  els.mangaTitle.focus({ preventScroll: true });
});

els.dayDetailClose.addEventListener("click", closeDayDetail);
els.dayDetailOverlay.addEventListener("click", (event) => {
  if (event.target === els.dayDetailOverlay) closeDayDetail(); // 背景部分のクリックだけを閉じる対象にする
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.selectedCalendarDate) closeDayDetail();
});
els.syncButton.addEventListener("click", syncCandidates);
els.seedButton.addEventListener("click", addSampleData);
els.exportButton.addEventListener("click", exportData);
els.importInput.addEventListener("change", (event) => importData(event.target.files[0]));
els.backgroundInput.addEventListener("change", (event) => {
  handleBackgroundUpload(event.target.files[0]);
  event.target.value = ""; // 同じファイルを連続で選び直せるようにリセット
});
els.resetBackgroundButton.addEventListener("click", resetBackgroundImage);

// ==============================
// 起動
// ==============================
window.BooksAuth.start((cloudData) => {
  load(cloudData);
  render();
  if (state.autoNotify) checkNotifications({ automatic: true });
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.autoNotify) checkNotifications({ automatic: true });
});
setInterval(() => {
  if (!document.hidden && state.autoNotify) checkNotifications({ automatic: true });
}, 15 * 60 * 1000);