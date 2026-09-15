
"use strict";
/* ───────────────────────── helpers ───────────────────────── */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("shub." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("shub." + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("shub." + k); } catch {} },
};
let toastTimer;
function toast(msg, bad = false) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = "toast", bad ? 6000 : 3200);
}
function slugify(s, max = 48) {
  const x = String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (x.slice(0, max).replace(/-+$/, "")) || "short";
}
function b64utf8(str) {
  const bytes = new TextEncoder().encode(str); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function copyText(text) {  // synchronous copy keeps the tap "active" for the share sheet
  let ok = false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    ok = document.execCommand("copy"); ta.remove();
  } catch {}
  if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  return true;
}
function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function mmss(sec) { sec = Math.max(0, Math.round(sec)); if (sec >= 3600) return Math.floor(sec / 3600) + "h " + Math.floor(sec % 3600 / 60) + "m"; return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
function idTime(id) { const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id || ""); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null; }

/* ───────────────────────── settings ───────────────────────── */
const DEFAULTS = { owner: "thmarine24-blip", repo: "ai-shorts-pipeline", token: "", gemini: "", model: "gemini-flash-latest", autoYT: false };
let S = { ...DEFAULTS, ...store.get("settings", {}) };
const API = "https://api.github.com";
const configured = () => !!(S.owner && S.repo && S.token);

/* ───────────────────────── GitHub API ───────────────────────── */
class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function gh(path, { method = "GET", body, accept = "application/vnd.github+json", raw = false } = {}) {
  const res = await fetch(`${API}/repos/${S.owner}/${S.repo}${path}`, {
    method, cache: "no-store",
    headers: { Authorization: `Bearer ${S.token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28",
               ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = ""; try { msg = (await res.json()).message || ""; } catch {}
    if (res.status === 401) msg = "GitHub rejected the token — check it in Settings.";
    else if (res.status === 404 && path === "") msg = "Repository not found — check the name, or give the token access to it.";
    else if (res.status === 403 && /Resource not accessible/i.test(msg)) msg = "Your token is missing a permission (needs Actions + Contents: Read and write).";
    throw new ApiError(msg || `GitHub error ${res.status}`, res.status);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}
let repoInfo = null;
async function getRepo() { if (!repoInfo) repoInfo = await gh(""); return repoInfo; }
async function mainFile(path) {
  const r = await getRepo();
  try { return await gh(`/contents/${path}?ref=${encodeURIComponent(r.default_branch)}`, { accept: "application/vnd.github.raw+json" }); }
  catch (e) { if (e.status === 404) return null; throw e; }
}
async function mediaHead() {
  try { return (await gh("/git/ref/heads/media")).object.sha; } catch (e) { if (e.status === 404) return null; throw e; }
}
async function mediaFiles() {
  const head = await mediaHead();
  if (!head) return {};
  const commit = await gh(`/git/commits/${head}`);
  const tree = await gh(`/git/trees/${commit.tree.sha}?recursive=1`);
  const out = {};
  for (const e of tree.tree || []) if (e.type === "blob") out[e.path] = e.sha;
  return out;
}
const blobText = {};  // sha → text (status.json etc.)
async function readBlobText(sha) {
  if (blobText[sha]) return blobText[sha];
  const cached = store.get("blob." + sha);
  if (cached) return (blobText[sha] = cached);
  const t = await gh(`/git/blobs/${sha}`, { accept: "application/vnd.github.raw+json" });
  const text = typeof t === "string" ? t : JSON.stringify(t);
  blobText[sha] = text;
  if (text.length < 20000) store.set("blob." + sha, text);
  return text;
}
const blobUrls = {};  // sha → object URL (covers)
async function blobObjectUrl(sha, type) {
  if (blobUrls[sha]) return blobUrls[sha];
  const res = await gh(`/git/blobs/${sha}`, { accept: "application/vnd.github.raw+json", raw: true });
  const b = new Blob([await res.arrayBuffer()], { type });
  return (blobUrls[sha] = URL.createObjectURL(b));
}
async function downloadBlob(sha, type, onProgress) {
  const res = await gh(`/git/blobs/${sha}`, { accept: "application/vnd.github.raw+json", raw: true });
  const total = +res.headers.get("content-length") || 0;
  if (!res.body || !total) return new Blob([await res.arrayBuffer()], { type });
  const reader = res.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress && onProgress(got / total); }
  return new Blob(chunks, { type });
}
/** One commit on the media branch: {path: "text" | null(delete)}. Retries if the branch moved. */
async function commitMedia(changes, message) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const head = await mediaHead();
    if (!head) throw new Error("No videos saved yet.");
    const commit = await gh(`/git/commits/${head}`);
    const files = await mediaFiles();
    const tree = [];
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) { if (files[path]) tree.push({ path, mode: "100644", type: "blob", sha: null }); }
      else tree.push({ path, mode: "100644", type: "blob", content });
    }
    if (!tree.length) return;
    const t = await gh("/git/trees", { method: "POST", body: { base_tree: commit.tree.sha, tree } });
    const c = await gh("/git/commits", { method: "POST", body: { message, tree: t.sha, parents: [head] } });
    try { await gh("/git/refs/heads/media", { method: "PATCH", body: { sha: c.sha, force: false } }); return; }
    catch (e) { if (e.status !== 422) throw e; await new Promise(r => setTimeout(r, 800 * (attempt + 1))); }
  }
  throw new Error("Couldn't save — the media branch kept changing. Try again.");
}
async function dispatch(workflow, inputs) {
  const r = await getRepo();
  await gh(`/actions/workflows/${workflow}/dispatches`, { method: "POST", body: { ref: r.default_branch, inputs } });
}

/* ───────────────────────── repo config (themes, prompt) ───────────────────────── */
const FALLBACK_PROMPT = `You write scripts for a faceless YouTube Shorts / TikTok channel called "{channel}". Narrator style: {style}.
Topic: {theme}. Do not repeat: {avoid}.
INTENT MATCHING IS MANDATORY. Make the requested video; do not automatically turn the topic into trivia, education, or an explanation.
If the topic names an experience, action, mood, aesthetic, or entertainment concept, create that experience directly with vivid, sensory, action-led lines. For example, "ASMR fruit cutting" means the cutting experience itself—not brain science, history, popularity, benefits, statistics, or why people enjoy it.
Match tips and how-to topics with useful steps; rankings with a clear list; stories with a narrative; and opinions with an explicitly subjective argument. Use facts, trivia, history, science, myths, or an explainer ONLY when the topic explicitly requests that treatment.
Pick ONE specific, sharp angle. The title and hook must sell the requested experience or format, not reframe it as an explainer.
Use {min_words}-{max_words} words in frequent short scenes. Start with a bold hook under 14 words, build momentum, and end with a short call to action.
Do not invent factual claims. Make opinions clearly subjective. Each scene gets a concrete 2-4 word stock-footage "visual" query.
Prefer real demonstration footage for mechanisms. Diagrams and maps are off unless explicitly requested. Add specific 2–4 second visual_beats where useful.
Return ONLY JSON: {{"topic":"","map_location":"specific real place or empty string","title":"","hook":"2-5 WORDS","scenes":[{{"text":"","visual":"","visual_type":"optional animated_diagram","diagram":"optional supported kind"}}],"description":"","hashtags":[],"fact_check":[]}}`;
let RC = { themes: [], prompt: FALLBACK_PROMPT, channel: "Fact Drop", style: "curious, punchy", minW: 95, maxW: 130, temp: 0.9, history: [] };
let repoConfigReady = Promise.resolve();
function tomlValue(toml, section, key) {
  const sec = new RegExp(`^\\[${section}\\][^\\[]*`, "m").exec(toml || "");
  if (!sec) return null;
  const m = new RegExp(`^\\s*${key}\\s*=\\s*("([^"]*)"|[^#\\n]+)`, "m").exec(sec[0]);
  return m ? (m[2] ?? m[1].trim()) : null;
}
async function loadRepoConfig() {
  const [topics, prompt, cfg, hist] = await Promise.all([
    mainFile("topics.txt"), mainFile("prompts/script_prompt.txt"), mainFile("config.toml"), mainFile("scripts/history.json")]);
  if (topics) RC.themes = topics.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
  if (prompt) RC.prompt = prompt;
  if (cfg) {
    RC.channel = tomlValue(cfg, "channel", "name") || RC.channel;
    RC.style = tomlValue(cfg, "channel", "style") || RC.style;
    RC.minW = +tomlValue(cfg, "writer", "min_words") || RC.minW;
    RC.maxW = +tomlValue(cfg, "writer", "max_words") || RC.maxW;
    RC.temp = +tomlValue(cfg, "writer", "temperature") || RC.temp;
  }
  try { RC.history = hist ? JSON.parse(hist) : []; } catch { RC.history = []; }
  store.set("rc", RC);
  renderThemes();
}

/* ───────────────────────── theme chips ───────────────────────── */
let theme = store.get("theme", "");
function renderThemes() {
  const box = $("#theme-chips"); box.innerHTML = "";
  const all = ["", ...RC.themes];
  for (const t of all) {
    const b = document.createElement("button");
    b.className = "chip"; b.type = "button"; b.textContent = t || "🎲 Surprise me";
    b.setAttribute("aria-pressed", String(t === theme));
    b.onclick = () => { theme = t; store.set("theme", t); $("#custom-topic").value = ""; renderThemes(); };
    box.appendChild(b);
  }
}

/* ───────────────────────── script writing (Gemini) ───────────────────────── */
function fillPrompt(tpl, vars) {
  return tpl.replace(/\{\{|\}\}|\{(\w+)\}/g, (m, k) => m === "{{" ? "{" : m === "}}" ? "}" : (k in vars ? String(vars[k]) : m));
}
function parseJSON(text) {
  return StudioCore.parse(text);
}
function cleanScript(s) {
  if (!s || !Array.isArray(s.scenes)) throw new Error("The AI reply had no scenes. Tap Rewrite.");
  const scenes = s.scenes.map(x => typeof x === "string" ? { text: x } : x)
    .map(x => {
      if(!x || typeof x!=='object')throw new Error('Each scene must contain narration text.');
      const scene = { ...x, text: String(x.text || "").trim(), visual: String(x.visual || "").trim() };
      const visualType = String(x.visual_type || "").trim().toLowerCase().replace(/-/g, "_");
      if (["animated_diagram", "diagram", "mechanism"].includes(visualType)) {
        scene.visual_type = "animated_diagram";
        if (x.diagram || x.diagram_kind) scene.diagram = String(x.diagram || x.diagram_kind).trim();
      }
      return scene;
    })
    .filter(x => x.text);
  if (!scenes.length) throw new Error("The script came back empty. Tap Rewrite.");
  const tags = (Array.isArray(s.hashtags) ? s.hashtags : String(s.hashtags || "").split(/[\s,]+/))
    .map(t => String(t).trim().replace(/\s+/g, "")).filter(Boolean).map(t => t.startsWith("#") ? t : "#" + t);
  return { ...s, topic: String(s.topic || s.title || "").trim(), title: String(s.title || scenes[0].text).trim().slice(0, 100),
           hook: String(s.hook || "").trim(), scenes, description: String(s.description || "").trim(),
           hashtags: tags.length ? tags : ["#shorts"],
           fact_check: (Array.isArray(s.fact_check) ? s.fact_check : []).map(String),
           map_location: String(s.map_location || "").trim() };
}
function selectedThemeText() {
  const custom = $("#custom-topic").value.trim();
  return custom || theme || (RC.themes.length ? RC.themes[Math.floor(Math.random() * RC.themes.length)] : "a compelling short-form video");
}
function buildScriptPrompt(themeText) {
  const avoid = [...new Set([...RC.history, ...jobs.map(j => j.topic || j.title).filter(Boolean)])].slice(-60).join("; ") || "(none yet)";
  const seconds = Number($("#video-length").value || 60);
  const profile = seconds <= 45 ? [95, 110, "7-9"] : seconds >= 75 ? [165, 185, "11-14"] : [135, 155, "9-12"];
  const location = $("#map-location").value.trim();
  const base = fillPrompt(RC.prompt, { channel: RC.channel, style: RC.style, theme: themeText, avoid,
                                      min_words: profile[0], max_words: profile[1] });
  return `${base}\n\nProduction mode: ${document.querySelector('#production-mode')?.value || 'stock'}. Series style: ${document.querySelector('#style-reference')?.value || 'consistent cinematic visual style'}. For illustrated or character stories, describe original narrative images rather than educational stock. Add visual_beats to each scene, with 2–4 second duration, concrete visual search, image_prompt, video_prompt and optional sound_cue. Do not enable paid generation yourself. No diagrams unless explicitly requested.\nThis request targets about ${seconds} seconds and ${profile[2]} scenes. ` +
    `Set map_location to ${location ? JSON.stringify(location) : 'an empty string'}. ` +
    `When map_location is present, make scene one work over a fast map flyover into that exact place.` + StudioCore.castPrompt(store.get('creative',{}));
}
async function writeScript(themeText) {
  if (!S.gemini) throw new Error("Add your Gemini API key in Settings first.");
  // A fast tap during startup must not write from stale cached instructions.
  await repoConfigReady;
  const prompt = buildScriptPrompt(themeText);
  const model = (S.model || DEFAULTS.model).trim();
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": S.gemini },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }],
                             generationConfig: { temperature: RC.temp, responseMimeType: "application/json" } }),
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(res.status === 429 ? "Gemini free-tier limit hit — wait a minute and try again." : "Gemini is busy — trying again…");
      if (res.status === 429) lastErr.isRateLimit = true;
      await new Promise(r => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const m = data?.error?.message || `Gemini error ${res.status}`;
      if (res.status === 404) throw new Error(`Model "${model}" not found. Change the Gemini model in Settings (e.g. gemini-2.5-flash).`);
      if (res.status === 400 && /API key/i.test(m)) throw new Error("Gemini rejected the API key — check it in Settings.");
      throw new Error(m);
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    try { return cleanScript(parseJSON(parts.filter(p => !p.thought).map(p => p.text || "").join(""))); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("Couldn't write a script.");
}

/* ───────────────────────── draft editor ───────────────────────── */
let draft = store.get("draft", null);
function wordCount(sc) { return sc.reduce((n, s) => n + (s.text.trim() ? s.text.trim().split(/\s+/).length : 0), 0); }
function showDraft() {
  const has = !!draft; $("#draft").hidden = !has;
  if (!has) return;
  const preferences=store.get('creative',{});
  for(const [key,value] of Object.entries(preferences)) if(draft[key]===undefined) draft[key]=value;
  document.dispatchEvent(new CustomEvent('studio:draft'));
  $("#d-title").value = draft.title; $("#d-hook").value = draft.hook;
  $("#d-map-location").value = draft.map_location || "";
  $("#d-desc").value = draft.description; $("#d-tags").value = draft.hashtags.join(" ");
  $("#d-yt").checked = draft.upload_youtube ?? S.autoYT;
  $("#d-theme").textContent = draft.theme ? "· " + draft.theme : "";
  const box = $("#d-scenes"); box.innerHTML = "";
  draft.scenes.forEach((sc, i) => {
    const el = document.createElement("div"); el.className = "scene";
    const isDiagram = sc.visual_type === "animated_diagram";
    const visualPlaceholder = isDiagram ? `animated ${sc.diagram || "flow"} diagram` : "stock footage search words";
    el.innerHTML = `<div class="n"><span>SCENE ${i + 1}</span><button class="x" title="Remove scene" aria-label="Remove scene">✕</button></div>
      <textarea rows="2"></textarea><div class="vis">${isDiagram ? "◆" : "🎞"}<input type="text" placeholder="${esc(visualPlaceholder)}"></div>`;
    const ta = $("textarea", el), vi = $("input", el);
    ta.value = sc.text; vi.value = sc.visual;
    const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
    ta.oninput = () => { sc.text = ta.value; (sc.visual_beats||[]).forEach(b=>delete b.narration);fit(); saveDraft(); };
    vi.oninput = () => { sc.visual = vi.value; saveDraft(); };
    $(".x", el).onclick = () => { if (draft.scenes.length > 1) { draft.scenes.splice(i, 1); saveDraft(); showDraft(); } };
    box.appendChild(el); requestAnimationFrame(fit);
  });
  $("#d-facts").innerHTML = draft.fact_check.length ? draft.fact_check.map(f => `<li>${esc(f)}</li>`).join("") : "<li>No claims listed — skim the script for anything that sounds off.</li>";
  updateStats();
}
function updateStats() { const w = wordCount(draft.scenes); $("#d-words").textContent = w; $("#d-secs").textContent = Math.round(w / 2.6 + 1); }
function saveDraft() {
  if (!draft) return;
  draft.title = $("#d-title").value; draft.hook = $("#d-hook").value; draft.description = $("#d-desc").value;
  draft.map_location = $("#d-map-location").value.trim();
  draft.hashtags = $("#d-tags").value.split(/[\s,]+/).filter(Boolean).map(t => t.startsWith("#") ? t : "#" + t);
  draft.upload_youtube = $("#d-yt").checked;
  store.set("draft", draft); updateStats();
}
["#d-title", "#d-hook", "#d-map-location", "#d-desc", "#d-tags"].forEach(s => $(s).addEventListener("input", saveDraft));
$("#d-yt").addEventListener("change", saveDraft);
$("#btn-add-scene").onclick = () => { draft.scenes.push({ text: "", visual: "" }); saveDraft(); showDraft(); };
$("#btn-discard").onclick = () => { draft = null; store.del("draft"); showDraft(); };

$("#btn-copy-ai-prompt").onclick = async () => {
  const status = $("#manual-ai-status");
  try {
    await repoConfigReady;
    const themeText = selectedThemeText();
    copyText(buildScriptPrompt(themeText));
    store.set("manualTheme", themeText);
    status.hidden = false;
    status.textContent = `Prompt copied for “${themeText}”. Open ChatGPT or Claude and paste it there.`;
  } catch (e) {
    status.hidden = false;
    status.innerHTML = `<span class="err">${esc(e.message)}</span>`;
  }
};
$("#btn-import-ai").onclick = () => {
  const status = $("#manual-ai-status"), raw = $("#manual-ai-response").value.trim();
  if (!raw) {
    status.hidden = false;
    status.innerHTML = '<span class="err">Paste the complete AI response first.</span>';
    return;
  }
  try {
    const sc = cleanScript(parseJSON(raw));
    const themeText = store.get("manualTheme", "") || selectedThemeText();
    draft = { ...sc, map_location: sc.map_location || $("#map-location").value.trim(),
              theme: themeText, upload_youtube: S.autoYT };
    store.set("draft", draft);
    showDraft();
    status.hidden = true;
    $("#manual-ai").open = false;
    $("#draft").scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Imported! Review the script before making the video.");
  } catch (e) {
    status.hidden = false;
    status.innerHTML = `<span class="err">Couldn't import that response: ${esc(e.message)}</span>`;
  }
};

let writeCooldownTimer = null;
function startWriteCooldown(st, btns, seconds) {
  clearInterval(writeCooldownTimer);
  btns.forEach(b => b.disabled = true);
  let left = seconds;
  const tick = () => {
    if (left <= 0) {
      clearInterval(writeCooldownTimer);
      st.hidden = true;
      btns.forEach(b => b.disabled = false);
      return;
    }
    st.hidden = false;
    st.innerHTML = `<span class="err">Gemini free-tier limit hit — you can try again in ${left}s.</span>`;
    left--;
  };
  tick();
  writeCooldownTimer = setInterval(tick, 1000);
}
async function doWrite(themeText) {
  const btns = [$("#btn-write"), $("#btn-rewrite"), $("#btn-approve")];
  clearInterval(writeCooldownTimer);
  btns.forEach(b => b.disabled = true);
  const st = $("#write-status"); st.hidden = false; st.innerHTML = `<span class="spinner"></span> Writing a script about <b>${esc(themeText)}</b>…`;
  try {
    const sc = await writeScript(themeText);
    Object.assign(sc,creative());
    draft = { ...sc, map_location: sc.map_location || $("#map-location").value.trim(),
              theme: themeText, upload_youtube: S.autoYT };
    store.set("draft", draft); showDraft(); st.hidden = true;
    $("#draft").scrollIntoView({ behavior: "smooth", block: "start" });
    btns.forEach(b => b.disabled = false);
  } catch (e) {
    if (e.isRateLimit) {
      // Repeatedly tapping right after a 429 just burns more of the same per-minute
      // quota and keeps tripping it — lock the buttons for a real cooldown instead.
      startWriteCooldown(st, btns, 65);
    } else {
      st.innerHTML = `<span class="err">${esc(e.message)}</span>`;
      btns.forEach(b => b.disabled = false);
    }
  }
}
$("#btn-write").onclick = () => {
  if (!configured() || !S.gemini) return openSettings();
  doWrite(selectedThemeText());
};
$("#btn-rewrite").onclick = () => doWrite(draft?.theme || theme || "surprising science facts");
$("#btn-approve").onclick = async () => {
  saveDraft();
  const sc = { ...draft, scenes: draft.scenes.filter(s => s.text.trim()).map(s => ({
    ...s, text: s.text.trim(), visual: s.visual.trim() || draft.topic || draft.title,
    ...(s.visual_type ? { visual_type: s.visual_type } : {}), ...(s.diagram ? { diagram: s.diagram } : {})
  })) };
  if (!sc.scenes.length) return toast("The script is empty.", true);
  if (!sc.title.trim()) return toast("Give it a title first.", true);
  const btn = $("#btn-approve"); btn.disabled = true; btn.textContent = "Starting…";
  try {
    await startRender(sc, sc.upload_youtube);
    draft = null; store.del("draft"); showDraft();
    toast("On it! Your video will be ready in about 4 minutes.");
    window.scrollTo({ top: $("#list").offsetTop - 80, behavior: "smooth" });
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; btn.textContent = "Make my video →"; }
};
async function startRender(sc, uploadYT) {
  StudioCore.applyCast(sc);
  if(sc.cast_errors.length)throw new Error(sc.cast_errors.join(' '));
  if(sc.scenes.some(s=>s.visual_beats.some(b=>b.cast_required))&&sc.ai?.enabled!==true)throw new Error('Your cast needs generated scenes. Enable paid visuals in Creative settings, or upload and lock finished scene artwork.');
  const d = new Date().toISOString().replace(/[-:]/g, "");
  const id = `${d.slice(0, 8)}-${d.slice(9, 15)}-${slugify(sc.topic || sc.title)}`;
  const script = { ...StudioCore.compact(sc), topic: sc.topic, title: sc.title.trim(), hook: sc.hook.trim(), scenes: sc.scenes,
                   description: sc.description, hashtags: sc.hashtags, fact_check: sc.fact_check,
                   map_location: sc.map_location || "" };
  script.scenes=StudioCore.compact(sc).scenes;
  if(script.ai?.enabled===true){
    const cost=StudioCore.estimate(script),cap=Number(script.ai.budget)||0;
    if(cost>cap)throw new Error(`Selected visuals need a $${cost.toFixed(2)} allowance; your cap is $${cap.toFixed(2)}.`);
    if(cost && !confirm(`Allow up to $${cost.toFixed(2)} for these generated visuals? Failed or retried generations can use this allowance. Maximum video budget: $${cap.toFixed(2)}.`))throw new Error('Generation cancelled. Your draft is saved.');
    script.ai.approved_cost=cost;
  }else script.ai={enabled:false,budget:0,approved_cost:0};
  script.generation_id ||= crypto.randomUUID();
  const serialized=JSON.stringify(script);
  if(new TextEncoder().encode(serialized).length>43000)throw new Error('This script is too large. Reduce long prompts or reference metadata before rendering.');
  await dispatch("render.yml", { job_id: id, title: script.title.slice(0, 80), script_b64: b64utf8(JSON.stringify(script)),
                                 upload_youtube: uploadYT ? "true" : "false" });
  const pending = store.get("pending", []);
  pending.push({ id, kind: "render", title: script.title, at: Date.now() });
  store.set("pending", pending);
  await refresh(true);
  return id;
}

/* ───────────────────────── jobs list ───────────────────────── */
let jobs = store.get("jobs", []);   // last known list (so the page paints instantly)
let files = {};
let runs = [];
let refreshing = false, lastRefresh = 0, refreshAgain = false;
function statusFromRun(run) {
  if (!run) return null;
  if (run.status === "completed") return run.conclusion === "success" ? "finished" : "run_failed";
  return "running";
}
async function refresh(force = false) {
  if (!configured()) { renderList(); return; }
  if (refreshing) { if (force) refreshAgain = true; return; }
  if (!force && Date.now() - lastRefresh < 4000) return;
  refreshing = true;
  try {
    const [f, r] = await Promise.all([mediaFiles(), gh("/actions/runs?event=workflow_dispatch&per_page=40").then(x => x.workflow_runs || [])]);
    files = f; runs = r; lastRefresh = Date.now();
    setConn(true);
    const savedDismissed = store.get("dismissed", {});
    const dismissed = savedDismissed && !Array.isArray(savedDismissed) ? savedDismissed : {};
    for (const [id, at] of Object.entries(dismissed)) {
      if (Date.now() - Number(at) > 7 * 24 * 3600 * 1000) delete dismissed[id];
    }
    store.set("dismissed", dismissed);
    const ids = new Set();
    for (const p of Object.keys(files)) {
      const m = /^jobs\/([^/]+)\//.exec(p);
      if (m && !dismissed[m[1]] && !files[`deleted/${m[1]}.json`]) ids.add(m[1]);
    }
    const runInfo = {};  // id → {render, youtube}
    for (const run of runs) {
      const m = /^(render|youtube) (\S+)(?: · (.*))?$/.exec(run.display_title || "");
      if (!m) continue;
      const slot = (runInfo[m[2]] ||= {});
      if (!slot[m[1]]) slot[m[1]] = { ...run, title: m[3] || "" };  // newest first
    }
    const pending = store.get("pending", []).filter(p => Date.now() - p.at < 45 * 60 * 1000);
    for (const p of pending) if(!dismissed[p.id] && !files[`deleted/${p.id}.json`]) ids.add(p.id);
    for (const id of Object.keys(runInfo)) {
      if(dismissed[id] || files[`deleted/${id}.json`]) continue;
      const rr = runInfo[id].render; if (!rr) continue;
      const recent = Date.now() - new Date(rr.updated_at || rr.created_at).getTime() < 24 * 3600 * 1000;
      if (statusFromRun(rr) === "running" ||
          (recent && statusFromRun(rr) === "run_failed" && !dismissed[id])) ids.add(id);
    }
    const list = [];
    await Promise.all([...ids].map(async id => {
      const sha = files[`jobs/${id}/status.json`];
      let st = null;
      if (sha) { try { st = JSON.parse(await readBlobText(sha)); } catch {} }
      const receipt=files[`jobs/${id}/youtube-receipt.json`];
      if(receipt){try{st={...(st||{}),status:'done',youtube:JSON.parse(await readBlobText(receipt))};}catch{}}
      const ri = runInfo[id] || {}, pend = pending.filter(p => p.id === id);
      const job = { id, st, sha, title: st?.title || ri.render?.title || pend[0]?.title || id.replace(/^\d{8}-\d{6}-/, "").replace(/-/g, " "),
                    topic: st?.topic, created: st?.created || idTime(id), renderRun: ri.render, ytRun: ri.youtube };
      if (st) job.state = StudioCore.state(st,!!files[`jobs/${id}/video.mp4`],ri.render);
      else if (ri.render) {
        const rs = statusFromRun(ri.render);
        const justFinished = rs === "finished" && Date.now() - new Date(ri.render.updated_at || 0).getTime() < 120000;
        job.state = rs === "running" || justFinished ? "rendering" : "failed";
      }
      else if (pend.some(p => p.kind === "render")) job.state = "starting";
      else return;
      job.ytBusy = !!(ri.youtube && ri.youtube.status !== "completed") ||
                   (pend.some(p => p.kind === "youtube") && !st?.youtube && !st?.youtube_error && !(ri.youtube && ri.youtube.status === "completed"));
      job.hasVideo = !!files[`jobs/${id}/video.mp4`];
      list.push(job);
    }));
    // drop pending entries that are resolved
    store.set("pending", pending.filter(p => {
      const j = list.find(x => x.id === p.id);
      if (!j) return false;
      if (p.kind === "render") return j.state === "starting" || j.state === "rendering";
      return j.ytBusy;
    }));
    list.sort((a, b) => b.id.localeCompare(a.id));
    jobs = list;
    store.set("jobs", jobs.map(j => ({ ...j, renderRun: null, ytRun: null })));
    renderList();
    if (viewing) updateViewer();
  } catch (e) {
    setConn(false);
    if (force) toast(e.message, true);
  } finally {
    refreshing = false;
    if (refreshAgain) { refreshAgain = false; setTimeout(() => refresh(true), 50); } else schedule();
  }
}
function setConn(ok) { const d = $("#conn-dot"); d.className = "dot " + (ok ? "ok" : "bad"); d.title = ok ? "Connected to GitHub" : "Can't reach GitHub"; }
let pollTimer;
function schedule() {
  clearTimeout(pollTimer);
  const active = jobs.some(j => j.state === "starting" || j.state === "rendering" || j.ytBusy);
  pollTimer = setTimeout(() => { if (document.visibilityState === "visible") refresh(); else schedule(); }, active ? 8000 : 60000);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });

const stepNames = { "Set up job": "Starting a server", "Get the pipeline code": "Starting a server", "Set up Python": "Installing tools",
                    "Install video tools": "Installing tools", "Make the video": "Voice, footage & editing", "Upload to YouTube": "Uploading to YouTube" };
const stepCache = {};
async function runStep(run) {
  if (!run || run.status === "completed") return "";
  if (run.status === "queued") return "Waiting for a free server";
  const c = stepCache[run.id];
  if (c && Date.now() - c.at < 7000) return c.text;
  try {
    const data = await gh(`/actions/runs/${run.id}/jobs`);
    const steps = data.jobs?.[0]?.steps || [];
    const cur = steps.find(s => s.status === "in_progress") || steps.filter(s => s.status === "completed").pop();
    const text = cur ? (stepNames[cur.name] || cur.name) : "Starting";
    stepCache[run.id] = { text, at: Date.now() };
    return text;
  } catch { return ""; }
}
let ticks = [];
function renderList() {
  ticks.forEach(clearInterval); ticks = [];
  const box = $("#list"); box.innerHTML = "";
  $("#empty").hidden = jobs.length > 0 || !configured();
  for (const j of jobs) {
    const el = document.createElement("div"); el.className = "card job"; el.dataset.id = j.id;
    const st = j.st || {};
    let pill = "";
    if (j.state === "done") pill = `<span class="pill ok">Ready${st.seconds ? " · " + Math.round(st.seconds) + "s" : ""}</span>`;
    else if (j.state === "failed") pill = `<span class="pill bad">Failed</span>`;
    else if (j.state === "starting") pill = `<span class="pill run"><span class="spinner" style="width:12px;height:12px"></span> Starting…</span>`;
    else pill = `<span class="pill run"><span class="spinner" style="width:12px;height:12px"></span> Making video <span class="elapsed"></span></span>`;
    const badges = [];
    if (st.youtube) badges.push(`<span class="badge yt">YouTube ${esc(st.youtube.privacy || "")}</span>`);
    if (j.ytBusy) badges.push(`<span class="badge yt">Uploading…</span>`);
    if (st.posted?.youtube) badges.push(`<span class="badge yt">✓ Posted YT</span>`);
    if (st.posted?.tiktok) badges.push(`<span class="badge tt">✓ Posted TikTok</span>`);
    el.innerHTML = `<div class="thumb">${j.state === "done" ? "" : '<div class="spin">' + (j.state === "failed" ? "⚠" : '<span class="spinner"></span>') + "</div>"}</div>
      <div style="min-width:0;flex:1"><div class="t">${esc(j.title)}</div>${pill}
      <div class="small muted" style="margin-top:6px"><span class="step"></span>${j.state === "done" || j.state === "failed" ? esc(ago(st.finished || j.created)) : ""}</div>
      <div class="badges">${badges.join("")}</div></div>`;
    el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',`Open ${j.title}`);
    el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openViewer(j.id);}};
    el.onclick = () => openViewer(j.id);
    box.appendChild(el);
    const coverSha = files[`jobs/${j.id}/cover.jpg`];
    if (coverSha) blobObjectUrl(coverSha, "image/jpeg").then(u => { $(".thumb", el).style.backgroundImage = `url("${u}")`; }).catch(() => {});
    if (j.state === "rendering" && j.renderRun) {
      const started = new Date(j.renderRun.run_started_at || j.renderRun.created_at).getTime();
      const tick = () => { const e = $(".elapsed", el); if (e) e.textContent = mmss((Date.now() - started) / 1000); };
      tick(); ticks.push(setInterval(tick, 1000));
      if(st.message) $('.step',el).textContent=st.message;
      else runStep(j.renderRun).then(t => { if (t) $(".step", el).textContent = t; });
    } else if (j.state === "starting") $(".step", el).textContent = "Asking GitHub for a server…";
  }
}

/* ───────────────────────── viewer ───────────────────────── */
let viewing = null;   // job id
let videoBlob = null, videoSha = null;
function currentJob() { return jobs.find(j => j.id === viewing); }
async function openViewer(id) {
  viewing = id; $("#viewer").hidden = false; document.body.style.overflow = "hidden";
  videoBlob = null; videoSha = null;
  const v = $("#v-video"); v.removeAttribute("src"); v.load();
  updateViewer();
  const j = currentJob();
  if (j?.state === "done" && j.hasVideo) loadVideo(j);
}
function closeViewer() {
  viewing = null; $("#viewer").hidden = true; document.body.style.overflow = "";
  const v = $("#v-video"); v.pause();
}
$("#v-close").onclick = closeViewer;
async function loadVideo(j) {
  const sha = files[`jobs/${j.id}/video.mp4`];
  if (!sha || sha === videoSha) return;
  videoSha = sha;
  $("#v-load").hidden = false; $("#v-load-text").textContent = "Loading video…"; $("#v-prog").style.width = "0";
  try {
    const blob = await downloadBlob(sha, "video/mp4", p => { $("#v-prog").style.width = Math.round(p * 100) + "%"; });
    if (viewing !== j.id) return;
    videoBlob = blob;
    const url = URL.createObjectURL(blob);
    $("#v-video").src = url; $("#v-load").hidden = true;
    const a = $("#v-download"); a.href = url; a.download = slugify(j.title) + ".mp4";
    $("#v-share").disabled = false;
  } catch (e) { $("#v-load-text").textContent = "Couldn't load video: " + e.message; videoSha = null; }
}
function updateViewer() {
  const j = currentJob();
  if (!j) { if (viewing) closeViewer(); return; }
  const st = j.st || {};
  $("#v-title").textContent = j.title;
  $("#v-meta").textContent = [st.seconds ? Math.round(st.seconds) + " sec" : "", st.voice ? st.voice.replace(/^en-\w+-|Neural$/g, "") + " voice" : "", ago(st.finished || j.created)].filter(Boolean).join(" · ");
  const pill = $("#v-pill");
  pill.className = "pill " + (j.state === "done" ? "ok" : j.state === "failed" ? "bad" : "run");
  pill.textContent = j.state === "done" ? "Ready" : j.state === "failed" ? "Failed" : "Making video…";
  if (j.state === "starting" || j.state === "rendering") $("#v-meta").textContent = "Being made on GitHub — usually 3–5 minutes. You can close this.";
  $("#v-delete").hidden = j.state === "starting" || j.state === "rendering";
  $('#v-cancel').hidden=!$('#v-delete').hidden;
  $("#v-done").hidden = j.state !== "done";
  $("#v-failed").hidden = j.state !== "failed";
  $(".player").hidden = j.state !== "done";
  $("#v-error").textContent = st.error || "The build stopped before saving. Open the build log to see why.";
  const runUrl = st.run_url || j.renderRun?.html_url;
  $("#v-runlink").hidden = !runUrl; if (runUrl) $("#v-runlink").href = runUrl;
  // youtube
  $("#v-yt-none").hidden = !!st.youtube || j.ytBusy;
  $("#v-yt-busy").hidden = !j.ytBusy;
  $("#v-yt-done").hidden = !st.youtube;
  if (st.youtube) {
    $("#v-yt-privacy").textContent = st.youtube.privacy || "private";
    $("#v-yt-studio").href = st.youtube.studio_url; $("#v-yt-watch").href = st.youtube.url;
  }
  const ye = $("#v-yt-err"); ye.hidden = !st.youtube_error || !!st.youtube; ye.textContent = st.youtube_error || "";
  $("#v-posted-yt").checked = !!st.posted?.youtube; $("#v-posted-tt").checked = !!st.posted?.tiktok;
  $("#v-facts").innerHTML = (st.fact_check || []).map(f => `<li>${esc(f)}</li>`).join("") || "<li>None listed.</li>";
  $("#v-kv").innerHTML = [["Words", st.words], ["Music", st.music || "none"], ["Size", st.size_mb ? st.size_mb + " MB" : ""], ["Job", j.id]]
    .filter(r => r[1]).map(r => `<span>${esc(r[0])}</span><span>${esc(r[1])}</span>`).join("");
  if (j.state === "done" && j.hasVideo && !videoSha) loadVideo(j);
}
$("#v-share").onclick = async () => {
  const j = currentJob(); if (!j || !videoBlob) return;
  const caption = j.st?.tiktok_caption || j.title;
  copyText(caption);
  const file = new File([videoBlob], slugify(j.title) + ".mp4", { type: "video/mp4" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: j.title, text: caption }); toast("Caption copied — paste it in TikTok."); }
    catch (e) { if (e.name !== "AbortError") toast("Sharing failed: " + e.message, true); }
  } else {
    $("#v-download").click();
    toast("This browser can't share files — downloaded it instead. Caption copied.");
  }
};
$$("[data-copy]").forEach(b => b.onclick = () => {
  const j = currentJob(); const t = j?.st?.[b.dataset.copy]; if (!t) return;
  copyText(t); toast("Copied!");
});
$("#v-yt-upload").onclick = async () => {
  const j = currentJob(); if (!j) return;
  const btn = $("#v-yt-upload"); btn.disabled = true;
  try {
    await dispatch("youtube.yml", { job_id: j.id });
    const p = store.get("pending", []); p.push({ id: j.id, kind: "youtube", title: j.title, at: Date.now() }); store.set("pending", p);
    j.ytBusy = true; updateViewer(); renderList();
    toast("Uploading to YouTube — about a minute.");
    setTimeout(() => refresh(true), 3000);
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; }
};
async function setPosted(which, value) {
  const j = currentJob(); if (!j?.st) return;
  const path = `jobs/${j.id}/status.json`;
  try {
    const fresh = JSON.parse(await readBlobText(files[path]));
    fresh.posted = { ...(fresh.posted || {}), [which]: value };
    await commitMedia({ [path]: JSON.stringify(fresh, null, 2) }, `hub: ${which} ${value ? "posted" : "not posted"} — ${j.title}`);
    j.st = fresh; renderList(); toast(value ? "Marked as posted." : "Unmarked.");
    refresh(true);
  } catch (e) { toast(e.message, true); updateViewer(); }
}
$("#v-posted-yt").onchange = e => setPosted("youtube", e.target.checked);
$("#v-posted-tt").onchange = e => setPosted("tiktok", e.target.checked);
let delArmed = 0;
$("#v-delete").onclick = async () => {
  const j = currentJob(); if (!j) return;
  const btn = $("#v-delete");
  if (Date.now() - delArmed > 4000) { delArmed = Date.now(); btn.textContent = "Tap again to delete for good"; setTimeout(() => btn.textContent = "Delete video", 4000); return; }
  btn.disabled = true;
  const failedAttempt = j.state === "failed";
  try {
    await ensureMedia();
    const freshFiles=await mediaFiles();
    const paths = Object.keys(freshFiles).filter(p => p.startsWith(`jobs/${j.id}/`));
    await commitMedia({...Object.fromEntries(paths.map(p => [p, null])),[`deleted/${j.id}.json`]:JSON.stringify({id:j.id,deleted:new Date().toISOString()})}, `hub: delete ${j.title}`);
    {
      store.set("pending", store.get("pending", []).filter(p => p.id !== j.id));
      const dismissed = store.get("dismissed", {});
      store.set("dismissed", { ...(dismissed && !Array.isArray(dismissed) ? dismissed : {}), [j.id]: Date.now() });
      jobs = jobs.filter(x => x.id !== j.id);
      store.set("jobs", jobs.map(x => ({ ...x, renderRun: null, ytRun: null })));
      closeViewer(); renderList();
    }
    toast(failedAttempt ? "Failed attempt removed." : "Deleted.");
    refresh(true);
  } catch (e) {
    toast(`Could not delete this attempt: ${e.message}`, true);
  }
  finally { btn.disabled = false; btn.textContent = "Delete video"; delArmed = 0; }
};
async function jobScript(j) {
  const sha = files[`jobs/${j.id}/script.json`];
  if (!sha) throw new Error("This job has no saved script.");
  return JSON.parse(await readBlobText(sha));
}
$("#v-retry").onclick = async () => {
  const j = currentJob(); if (!j) return;
  try { const sc = cleanScript(await jobScript(j)); await startRender(sc, false); closeViewer(); toast("Trying again…"); }
  catch (e) { toast(e.message, true); }
};
$("#v-edit").onclick = async () => {
  const j = currentJob(); if (!j) return;
  try { const sc = cleanScript(await jobScript(j)); draft = { ...sc, theme: sc.topic, upload_youtube: S.autoYT }; store.set("draft", draft); showDraft(); closeViewer(); $("#draft").scrollIntoView({ behavior: "smooth" }); }
  catch (e) { toast(e.message, true); }
};

/* ───────────────────────── settings dialog ───────────────────────── */
const dlg = $("#settings");
function openSettings() {
  $("#s-owner").value = S.owner; $("#s-repo").value = S.repo; $("#s-token").value = S.token;
  $("#s-gemini").value = S.gemini; $("#s-model").value = S.model; $("#s-autoyt").checked = S.autoYT;
  $("#s-result").hidden = true;
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
}
function readSettings() {
  return { owner: $("#s-owner").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/.*$/, ""),
           repo: $("#s-repo").value.trim().replace(/\.git$/, ""), token: $("#s-token").value.trim(),
           gemini: $("#s-gemini").value.trim(), model: $("#s-model").value.trim() || DEFAULTS.model, autoYT: $("#s-autoyt").checked };
}
$("#btn-settings").onclick = openSettings;
$("#btn-open-settings").onclick = openSettings;
$("#s-close").onclick = () => dlg.close();
$("#btn-refresh").onclick = () => refresh(true);
$("#s-save").onclick = async () => {
  S = readSettings(); store.set("settings", S); repoInfo = null; dlg.close();
  boot();
};
$("#s-test").onclick = async () => {
  const prev = S; S = readSettings(); repoInfo = null;
  const out = $("#s-result"); out.hidden = false; out.innerHTML = '<span class="spinner"></span> Testing…';
  const lines = [];
  try {
    const r = await getRepo();
    lines.push(`✅ GitHub: connected to <b>${esc(r.full_name)}</b>${r.private ? " (private)" : ""}`);
    try { await gh("/actions/workflows/render.yml"); lines.push("✅ Video workflow found"); }
    catch (e) { lines.push(e.status === 404 ? "❌ render.yml workflow not found — push the latest pipeline code to GitHub" : "❌ " + esc(e.message)); }
  } catch (e) { lines.push("❌ GitHub: " + esc(e.message)); }
  if (S.gemini) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(S.model)}`, { headers: { "x-goog-api-key": S.gemini } });
      lines.push(res.ok ? `✅ Gemini: ${esc(S.model)} ready` : `❌ Gemini: ${res.status === 404 ? "model not found — try gemini-2.5-flash" : "key rejected (" + res.status + ")"}`);
    } catch (e) { lines.push("❌ Gemini: " + esc(e.message)); }
  } else lines.push("⚠️ No Gemini key — you can't write new scripts yet");
  out.innerHTML = lines.join("<br>");
  S = prev; repoInfo = null;
};

/* the TikTok web uploader only works on a computer — hide it on phones */
if (matchMedia("(pointer: coarse)").matches) $("#v-tiktok-web").hidden = true;

/* ───────────────────────── boot ───────────────────────── */
async function boot() {
  // Cache themes and display settings, but never trust a cached prompt across releases.
  RC = { ...RC, ...store.get("rc", {}), prompt: FALLBACK_PROMPT };
  renderThemes(); showDraft(); renderList();
  $("#setup-banner").hidden = configured();
  if (!configured()) { setConn(false); $("#empty").hidden = true; return; }
  refresh(true);
  repoConfigReady = loadRepoConfig().catch(() => {});
}
boot();
