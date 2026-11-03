/*
  Minimal chat client for the FIR Intake Assistant.
  Talks to the FastAPI backend with fetch(). No framework, no build step.
  To replace with React/Next.js later: reuse the same three calls
  (POST /cases, POST /cases/{id}/messages, POST /cases/{id}/confirm).
*/
const API = ""; // same origin. Set to "http://localhost:8000" if the UI is served elsewhere.

const el = {
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  composer: document.getElementById("composer"),
  caseId: document.getElementById("case-id"),
  newCase: document.getElementById("new-case"),
  status: document.getElementById("status-line"),
  progressBar: document.getElementById("progress-bar"),
  progressText: document.getElementById("progress-text"),
  checklist: document.getElementById("checklist"),
  contradictions: document.getElementById("contradictions"),
  missing: document.getElementById("missing"),
  stateJson: document.getElementById("state-json"),
  download: document.getElementById("download"),
  reviewBar: document.getElementById("review-bar"),
  confirmYes: document.getElementById("confirm-yes"),
  confirmNo: document.getElementById("confirm-no"),
};

let caseId = null;
let lastState = null;

// ---------- rendering ----------
function addMessage(role, text, meta) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (meta) {
    const m = document.createElement("span");
    m.className = "meta";
    m.textContent = meta;
    div.appendChild(m);
  }
  div.appendChild(document.createTextNode(text));
  el.messages.appendChild(div);
  el.messages.scrollTop = el.messages.scrollHeight;
}

function setStatus(text) { el.status.textContent = text || ""; }

function renderProgress(progress, completeness, status) {
  const pct = completeness ? completeness.completion_percentage : 0;
  el.progressBar.style.width = `${pct}%`;
  const label = status === "complete" ? "confirmed" : status === "awaiting_confirmation" ? "awaiting your review" : "in progress";
  el.progressText.textContent = `${pct}% - ${label}`;
  el.checklist.innerHTML = "";
  (progress || []).forEach((p) => {
    const li = document.createElement("li");
    li.className = `status-${p.status}`;
    li.innerHTML = `<span>${p.label}</span><span class="detail" title="${p.detail || ""}">${p.detail || ""}</span>`;
    el.checklist.appendChild(li);
  });
}

function renderContradictions(list) {
  el.contradictions.innerHTML = "";
  if (!list || !list.length) {
    el.contradictions.innerHTML = '<li class="muted">None</li>';
    return;
  }
  list.forEach((c) => {
    const li = document.createElement("li");
    li.className = "contradiction";
    li.textContent = `${c.type} (${c.severity}): ${c.explanation}`;
    el.contradictions.appendChild(li);
  });
}

function renderMissing(completeness) {
  el.missing.innerHTML = "";
  const items = (completeness && completeness.missing) || [];
  if (!items.length) {
    el.missing.innerHTML = '<li class="muted">Nothing important missing</li>';
    return;
  }
  items.slice(0, 8).forEach((m) => {
    const li = document.createElement("li");
    li.className = m.priority;
    li.textContent = `${m.field}  (${m.priority})`;
    el.missing.appendChild(li);
  });
}

function renderState(state) {
  lastState = state;
  el.stateJson.textContent = JSON.stringify(state, null, 2);
}

function applyResponse(data) {
  if (data.progress) renderProgress(data.progress, data.completeness, data.status);
  else {  // e.g. after /confirm: keep the checklist, refresh bar + label only
    const pct = data.completeness ? data.completeness.completion_percentage : 0;
    el.progressBar.style.width = `${pct}%`;
    el.progressText.textContent = `${pct}% - ${data.status === "complete" ? "confirmed" : "in progress"}`;
  }
  renderContradictions(data.open_contradictions);
  renderMissing(data.completeness);
  renderState(data.case_state);
  const review = data.next_action === "review_summary" || data.status === "awaiting_confirmation";
  el.reviewBar.classList.toggle("hidden", !review);
  const done = data.status === "complete";
  el.input.disabled = done;
  el.send.disabled = done;
  if (done) setStatus("Case confirmed. Download the JSON from the side panel or start a new case.");
}

// ---------- API ----------
async function api(path, options) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.detail || j.error || detail; } catch (_) {}
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
}

async function newCase() {
  el.messages.innerHTML = "";
  el.reviewBar.classList.add("hidden");
  el.input.disabled = false; el.send.disabled = false;
  setStatus("Creating case...");
  try {
    const data = await api("/cases", { method: "POST", body: JSON.stringify({ language: "en" }) });
    caseId = data.case_id;
    el.caseId.textContent = caseId;
    localStorage.setItem("fir_case_id", caseId);
    addMessage("assistant", data.assistant_message);
    addMessage("warning", data.disclaimer);
    renderProgress([], { completion_percentage: 0 }, data.status);
    renderContradictions([]); renderMissing(null); renderState({});
    setStatus("");
  } catch (e) {
    setStatus(`Could not create case: ${e.message}`);
  }
}

async function resumeCase(id) {
  try {
    const data = await api(`/cases/${id}`);
    caseId = id;
    el.caseId.textContent = id;
    el.messages.innerHTML = "";
    data.messages.forEach((m) => addMessage(m.role === "assistant" ? "assistant" : "user", m.content));
    applyResponse({ ...data, next_action: data.status === "awaiting_confirmation" ? "review_summary" : "ask_question", open_contradictions: data.case_state.contradictions.filter((c) => !c.resolved) });
  } catch (_) {
    await newCase();
  }
}

async function sendMessage(text) {
  if (!caseId) await newCase();
  addMessage("user", text);
  el.input.value = "";
  el.send.disabled = true;
  setStatus("Thinking...");
  try {
    const data = await api(`/cases/${caseId}/messages`, { method: "POST", body: JSON.stringify({ message: text }) });
    if (data.warning) addMessage("warning", data.warning);
    const reply = data.warning ? data.assistant_message.replace(data.warning, "").trim() : data.assistant_message;
    addMessage("assistant", reply, data.changes && data.changes.length ? `recorded: ${data.changes.slice(0, 4).join("; ")}` : undefined);
    applyResponse(data);
    if (data.status !== "complete") setStatus("");
  } catch (e) {
    addMessage("warning", `Error: ${e.message}`);
    setStatus("");
  } finally {
    if (!el.input.disabled) el.send.disabled = false;
    el.input.focus();
  }
}

async function confirmCase(confirmed) {
  el.reviewBar.classList.add("hidden");
  setStatus(confirmed ? "Confirming..." : "");
  try {
    const data = await api(`/cases/${caseId}/confirm`, { method: "POST", body: JSON.stringify({ confirmed }) });
    addMessage("assistant", data.assistant_message);
    applyResponse({ ...data, progress: null, completeness: { completion_percentage: data.case_state.completion_percentage, missing: data.case_state.missing_information }, open_contradictions: data.case_state.contradictions.filter((c) => !c.resolved), next_action: confirmed ? "complete" : "ask_question" });
    if (!confirmed) { el.input.disabled = false; el.send.disabled = false; el.input.focus(); }
  } catch (e) {
    addMessage("warning", `Error: ${e.message}`);
  }
}

// ---------- wiring ----------
el.composer.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const text = el.input.value.trim();
  if (text) sendMessage(text);
});
el.input.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    const text = el.input.value.trim();
    if (text && !el.send.disabled) sendMessage(text);
  }
});
el.newCase.addEventListener("click", newCase);
el.confirmYes.addEventListener("click", () => confirmCase(true));
el.confirmNo.addEventListener("click", () => confirmCase(false));
el.download.addEventListener("click", () => {
  if (!lastState) return;
  const blob = new Blob([JSON.stringify(lastState, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${caseId || "case"}.json`;
  a.click();
});

const saved = localStorage.getItem("fir_case_id");
if (saved) resumeCase(saved); else newCase();
