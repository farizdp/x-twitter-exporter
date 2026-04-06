/**
 * ╔════════════════════════════════════════════════════╗
 * ║   Twitter/X Exporter v5 — Likes & Bookmarks       ║
 * ║   Paste in DevTools Console on /likes or /bookmarks║
 * ╚════════════════════════════════════════════════════╝
 */

(function () {
  "use strict";

  // ── Page detection ───────────────────────────────────────────────────────
  const PAGE_TYPE = /\/bookmarks/.test(location.pathname)
    ? "bookmarks"
    : /\/likes/.test(location.pathname)
    ? "likes"
    : null;

  if (!PAGE_TYPE) {
    alert("⚠️ Go to your Likes or Bookmarks page first!\nhttps://x.com/[username]/likes\nhttps://x.com/i/bookmarks");
    return;
  }

  // For /likes the username is in the path: /username/likes
  // For /bookmarks it's /i/bookmarks — grab from cookie or wait until first tweet
  function getPageUsername() {
    const m = location.pathname.match(/^\/([^\/]+)\/likes/);
    return m ? m[1] : "";
  }

  // ── Columns ──────────────────────────────────────────────────────────────
  const COLUMNS = [
    "id", "user_name", "user_screen_name",
    "full_text", "url", "media_url", "media_type", "media_count",
    "created_at",
  ];

  // ── State ────────────────────────────────────────────────────────────────
  const state = {
    tweets: new Map(),
    running: false,
    scrollTimer: null,
    stalledCount: 0,
    lastHeight: 0,
    fetchPatched: false,
  };

  function emptyRow() {
    return Object.fromEntries(COLUMNS.map((c) => [c, ""]));
  }

  function mergeRows(existing, incoming) {
    const out = { ...existing };
    for (const k of COLUMNS) {
      const v = incoming[k];
      if (v !== "" && v !== undefined && v !== null) out[k] = v;
    }
    return out;
  }

  // ── Text cleaner ─────────────────────────────────────────────────────────
  // Replaces t.co shortlinks with expanded URLs, strips trailing media t.co, collapses spaces
  function cleanText(text, urlEntities = []) {
    let t = text;
    for (const u of urlEntities) {
      if (u.url && u.expanded_url) {
        t = t.split(u.url).join(u.expanded_url);
      }
    }
    // Strip trailing t.co URLs Twitter appends for media/cards
    t = t.replace(/\s*https?:\/\/t\.co\/\S+$/g, "").trim();
    // Collapse multiple whitespace (spaces/tabs)
    t = t.replace(/[ \t]{2,}/g, " ").trim();
    return t;
  }

  function buildFilename(ext) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    if (PAGE_TYPE === "bookmarks") {
      return `x-bookmarks-${date}.${ext}`;
    }
    const username = getPageUsername() || "unknown";
    return `x-${username}-likes-${date}.${ext}`;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LAYER 1 — GraphQL fetch interceptor
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  function patchFetch() {
    if (state.fetchPatched) return;
    state.fetchPatched = true;

    const _fetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
      const res = await _fetch(...args);
      const url = (args[0]?.url ?? args[0] ?? "").toString();
      if (url.includes("/graphql/")) {
        try {
          const json = await res.clone().json();
          walkForTweets(json);
        } catch (_) {}
      }
      return res;
    };
  }

  function walkForTweets(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 30) return;
    // Detect tweet result node: has rest_id OR id_str, has legacy.full_text
    if (
      (obj.rest_id || obj.id_str) &&
      obj.legacy &&
      typeof obj.legacy.full_text === "string"
    ) {
      ingestGQL(obj);
      return;
    }
    for (const v of Array.isArray(obj) ? obj : Object.values(obj)) {
      if (v && typeof v === "object") walkForTweets(v, depth + 1);
    }
  }

  function ingestGQL(result) {
    const core   = result.tweet ?? result;
    const legacy = core.legacy;
    if (!legacy) return;

    const id = core.rest_id ?? legacy.id_str ?? "";
    if (!id) return;

    // ── User ──────────────────────────────────────────────────────────────
    const userResult =
      core.core?.user_results?.result ??
      core.user_results?.result ??
      null;
    const uLegacy = userResult?.legacy ?? {};

    const user_name        = uLegacy.name        ?? "";
    const user_screen_name = uLegacy.screen_name ?? "";

    // ── Media ─────────────────────────────────────────────────────────────
    const urlEntities = legacy.entities?.urls ?? [];
    const mediaArr =
      legacy.extended_entities?.media ??
      legacy.entities?.media ?? [];

    const media_url   = mediaArr.map((m) => m.media_url_https ?? "").filter(Boolean).join("\n");
    const media_type  = [...new Set(mediaArr.map((m) => m.type ?? "").filter(Boolean))].join("\n");
    const media_count = mediaArr.length ? String(mediaArr.length) : "";

    // ── Full text ─────────────────────────────────────────────────────────
    const full_text = cleanText(legacy.full_text ?? "", urlEntities);

    const row = {
      id,
      user_name,
      user_screen_name,
      full_text,
      url: user_screen_name ? `https://x.com/${user_screen_name}/status/${id}` : "",
      media_url,
      media_type,
      media_count,
      created_at: legacy.created_at ?? "",
    };

    const existing = state.tweets.get(id);
    state.tweets.set(id, existing ? mergeRows(existing, row) : row);
    updateUI();
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LAYER 2 — DOM scraper (fallback / supplement for already-rendered tweets)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  function scrapePage() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    let added = 0;

    articles.forEach((el) => {
      try {
        // ── ID from permalink ─────────────────────────────────────────────
        const timeEl = el.querySelector("time");
        const href   = timeEl?.closest("a")?.getAttribute("href") ?? "";
        const idM    = href.match(/\/status\/(\d+)/);
        if (!idM) return;
        const id = idM[1];

        // Skip if already fully enriched (has user_id from GQL)
        const ex = state.tweets.get(id);
        if (ex?.user_id) return;

        // ── user_screen_name from permalink ───────────────────────────────
        const user_screen_name = href.split("/")[1] ?? "";

        // ── user_name: find the display name link ─────────────────────────
        const userNameBlock = el.querySelector('[data-testid="User-Name"]');
        let user_name = "";
        if (userNameBlock) {
          const profileLink = userNameBlock.querySelector(`a[href="/${user_screen_name}"]`);
          if (profileLink) {
            user_name = profileLink.querySelector("span")?.textContent.trim() ?? "";
          }
          if (!user_name) {
            const spans = [...userNameBlock.querySelectorAll("span")]
              .map((s) => s.textContent.trim())
              .filter((s) => s && !s.startsWith("@") && s !== user_screen_name);
            user_name = spans[0] ?? "";
          }
        }

        // ── Full text ─────────────────────────────────────────────────────
        const textEl = el.querySelector('[data-testid="tweetText"]');
        let full_text = "";
        if (textEl) {
          const clone = textEl.cloneNode(true);
          clone.querySelectorAll("img[alt]").forEach((img) => img.replaceWith(img.getAttribute("alt")));
          full_text = clone.innerText.replace(/[ \t]{2,}/g, " ").trim();
        }

        // ── Expanded URLs from DOM ────────────────────────────────────────
        // Twitter renders <a href="https://t.co/xxx">display_url</a> in tweet text
        // BUT also sets data-expanded-url on the wrapper span in some versions.
        // Most reliable: grab all <a> in the tweet text that are external links,
        // check for data-expanded-url or use the visible link text heuristic.
        const expandedSet = new Set();

        if (textEl) {
          textEl.querySelectorAll("a[href]").forEach((a) => {
            const h = a.getAttribute("href") ?? "";
            // data-expanded-url is set by Twitter on external link anchors
            const exp = a.getAttribute("data-expanded-url") ?? "";
            if (exp) { expandedSet.add(exp); return; }
            // If href is a t.co link, try to find expanded from aria/data attrs on parent
            const parent = a.closest("[data-testid]");
            const parentExp = parent?.getAttribute("data-expanded-url") ?? "";
            if (parentExp) { expandedSet.add(parentExp); return; }
            // Use the link text if it looks like a real URL (contains a dot but not pic.twitter or t.co)
            const txt = a.textContent.trim();
            if (txt && /\.\w{2,}\//.test(txt) && !/t\.co|twitter\.com|x\.com/.test(txt)) {
              // Reconstruct: Twitter truncates display URLs with "…" — not reliable, skip
            }
          });
        }

        // Link card: the preview card below the tweet text contains the real URL
        const cardAnchors = el.querySelectorAll(
          'a[data-testid="card.layoutSmall.detail"], a[data-testid="card.layoutLarge.detail"], ' +
          'div[data-testid="card.wrapper"] a[role="link"]'
        );
        cardAnchors.forEach((a) => {
          const h = a.getAttribute("href") ?? "";
          if (h && !h.startsWith("/") && !/twitter\.com|x\.com/.test(h)) {
            expandedSet.add(h);
          }
        });

        const expanded_url = [...expandedSet].join("\n");

        // ── Media ─────────────────────────────────────────────────────────
        const photos   = [...el.querySelectorAll('[data-testid="tweetPhoto"] img')];
        const hasVideo = !!el.querySelector('[data-testid="videoPlayer"]');
        const hasGif   = !!el.querySelector('[data-testid="videoComponent"]');
        const media_url   = photos.map((img) => (img.getAttribute("src") ?? "").replace(/\?.*$/, "") + "?format=jpg&name=orig").join("\n");
        const media_type  = hasVideo ? "video" : hasGif ? "animated_gif" : photos.length ? "photo" : "";
        const media_count = hasVideo || hasGif ? "1" : photos.length ? String(photos.length) : "";

        const row = {
          ...emptyRow(),
          id,
          user_name,
          user_screen_name,
          full_text,
          url:        `https://x.com/${user_screen_name}/status/${id}`,
          media_url,
          media_type,
          media_count,
          created_at: timeEl?.getAttribute("datetime") ?? "",
        };

        state.tweets.set(id, ex ? mergeRows(ex, row) : row);
        added++;
      } catch (_) {}
    });

    if (added > 0) updateUI();
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Auto-scroll  (stall threshold = 20 checks so slow feeds don't stop early)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const SCROLL_MS  = 3000;   // interval between scrolls
  const CHECK_MS   = 2500;   // delay before checking if page grew
  const STALL_MAX  = 20;     // consecutive stalls before auto-stop

  function startScroll() {
    state.running      = true;
    state.stalledCount = 0;
    state.lastHeight   = document.documentElement.scrollHeight;
    scrapePage();
    updateUI();

    state.scrollTimer = setInterval(() => {
      scrapePage();
      window.scrollBy({ top: window.innerHeight * 2, behavior: "smooth" });

      setTimeout(() => {
        const h = document.documentElement.scrollHeight;
        if (h === state.lastHeight) {
          state.stalledCount++;
          setStatus(`⏳ Waiting… (${state.stalledCount}/${STALL_MAX})`);
          if (state.stalledCount >= STALL_MAX) {
            scrapePage();
            stopScroll();
            setStatus(`✅ Done — ${state.tweets.size} tweets collected`);
          }
        } else {
          state.stalledCount = 0;
          state.lastHeight   = h;
          setStatus(`Scrolling… ${state.tweets.size} collected`);
          scrapePage();
        }
        updateUI();
      }, CHECK_MS);
    }, SCROLL_MS);
  }

  function stopScroll() {
    state.running = false;
    clearInterval(state.scrollTimer);
    state.scrollTimer = null;
    updateUI();
  }

  function resetData() {
    stopScroll();
    state.tweets.clear();
    state.stalledCount = 0;
    state.lastHeight   = 0;
    setStatus("Reset — click ▶ Start to begin again");
    updateUI();
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Export
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  function exportCSV() {
    const rows = [...state.tweets.values()];
    if (!rows.length) return alert("No tweets collected yet.");
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => esc(r[c])).join(","))].join("\n");
    dl(csv, buildFilename("csv"), "text/csv");
  }

  function exportJSON() {
    const data = [...state.tweets.values()];
    if (!data.length) return alert("No tweets collected yet.");
    dl(JSON.stringify(data, null, 2), buildFilename("json"), "application/json");
  }

  function dl(content, filename, type) {
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([content], { type })),
      download: filename,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // UI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  let countEl, statusEl, btnToggle;

  function buildUI() {
    document.getElementById("__xex5_wrap")?.remove();
    document.getElementById("__xex5_style")?.remove();

    const style = document.createElement("style");
    style.id = "__xex5_style";
    style.textContent = `
      #__xex5 {
        position: fixed; bottom: 22px; right: 22px; z-index: 2147483647;
        width: 280px;
        background: #0b0b0b;
        border: 1px solid #1f1f1f;
        border-radius: 16px;
        box-shadow: 0 24px 64px rgba(0,0,0,.85), inset 0 1px 0 rgba(255,255,255,.04);
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 12px; color: #bbb; overflow: hidden;
      }
      #__xex5_head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 13px; background: #111; border-bottom: 1px solid #1c1c1c;
      }
      #__xex5_hl { display: flex; align-items: center; gap: 7px; }
      #__xex5_dot {
        width: 7px; height: 7px; border-radius: 50%; background: #2a2a2a; flex-shrink: 0;
        transition: background .3s, box-shadow .3s;
      }
      #__xex5_dot.on { background: #22c55e; box-shadow: 0 0 7px #22c55e66; }
      #__xex5_title { font-weight: 700; font-size: 12px; color: #ddd; letter-spacing: .04em; }
      #__xex5_badge {
        font-size: 9px; font-weight: 800; padding: 2px 8px; border-radius: 99px;
        letter-spacing: .08em; text-transform: uppercase;
      }
      .b-likes     { background: #f4212e1a; color: #f4212e; border: 1px solid #f4212e33; }
      .b-bookmarks { background: #1d9bf01a; color: #1d9bf0; border: 1px solid #1d9bf033; }
      #__xex5_x {
        background: none; border: none; color: #3a3a3a; cursor: pointer; font-size: 14px; line-height: 1;
      }
      #__xex5_x:hover { color: #fff; }
      #__xex5_body { padding: 13px 13px 11px; }
      #__xex5_n {
        font-size: 34px; font-weight: 900; color: #fff;
        letter-spacing: -1.5px; line-height: 1; margin-bottom: 1px;
      }
      #__xex5_sub { font-size: 10px; color: #3a3a3a; letter-spacing: .06em; text-transform: uppercase; margin-bottom: 10px; }
      #__xex5_status {
        font-size: 11px; color: #4a4a4a; margin-bottom: 11px; min-height: 14px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #__xex5_row1, #__xex5_row2 { display: flex; gap: 6px; margin-bottom: 6px; }
      #__xex5_row1 button, #__xex5_row2 button {
        flex: 1; padding: 9px 3px; border-radius: 10px; border: 1px solid #1e1e1e;
        cursor: pointer; font-size: 11px; font-weight: 700;
        background: #141414; color: #666;
        transition: background .15s, color .15s, border-color .15s;
      }
      #__xex5_row1 button:hover, #__xex5_row2 button:hover { background: #1e1e1e; color: #fff; border-color: #333; }
      #__xex5_go   { background: #1d9bf0 !important; color: #fff !important; border-color: #1d9bf0 !important; }
      #__xex5_go:hover { background: #1a8cd8 !important; }
      #__xex5_go.stop { background: #f4212e !important; border-color: #f4212e !important; }
      #__xex5_reset { color: #555 !important; }
      #__xex5_reset:hover { color: #ff6b6b !important; border-color: #ff6b6b44 !important; }
      #__xex5_cols { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 8px; margin-bottom: 8px; }
      #__xex5_cols span {
        font-size: 9px; padding: 2px 5px; border-radius: 4px;
        background: #131313; border: 1px solid #1c1c1c; color: #383838;
      }
      #__xex5_tip { font-size: 10px; color: #222; text-align: center; }
    `;
    document.head.appendChild(style);

    const badgeClass = PAGE_TYPE === "bookmarks" ? "b-bookmarks" : "b-likes";
    const pageLabel  = PAGE_TYPE === "bookmarks" ? "Bookmarks" : "Likes";

    const wrap = document.createElement("div");
    wrap.id = "__xex5_wrap";
    wrap.innerHTML = `
      <div id="__xex5">
        <div id="__xex5_head">
          <div id="__xex5_hl">
            <div id="__xex5_dot"></div>
            <span id="__xex5_title">X Exporter</span>
            <span id="__xex5_badge" class="${badgeClass}">${pageLabel}</span>
          </div>
          <button id="__xex5_x" title="Close">✕</button>
        </div>
        <div id="__xex5_body">
          <div id="__xex5_n">0</div>
          <div id="__xex5_sub">tweets collected</div>
          <div id="__xex5_status">Ready — click ▶ Start to begin</div>
          <div id="__xex5_row1">
            <button id="__xex5_go">▶ Start</button>
            <button id="__xex5_reset">↺ Reset</button>
          </div>
          <div id="__xex5_row2">
            <button id="__xex5_csv">⬇ CSV</button>
            <button id="__xex5_json">⬇ JSON</button>
          </div>
          <div id="__xex5_cols">${COLUMNS.map((c) => `<span>${c}</span>`).join("")}</div>
          <div id="__xex5_tip">Works on /likes · /bookmarks</div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    countEl   = wrap.querySelector("#__xex5_n");
    statusEl  = wrap.querySelector("#__xex5_status");
    btnToggle = wrap.querySelector("#__xex5_go");

    btnToggle.onclick                            = () => state.running ? stopScroll() : startScroll();
    wrap.querySelector("#__xex5_reset").onclick  = resetData;
    wrap.querySelector("#__xex5_csv").onclick    = exportCSV;
    wrap.querySelector("#__xex5_json").onclick   = exportJSON;
    wrap.querySelector("#__xex5_x").onclick      = () => { stopScroll(); wrap.remove(); };
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  function updateUI() {
    if (!countEl) return;
    const n = state.tweets.size;
    countEl.textContent = n.toLocaleString();

    const dot = document.getElementById("__xex5_dot");
    if (state.running) {
      btnToggle.textContent = "⏹ Stop";
      btnToggle.classList.add("stop");
      dot?.classList.add("on");
    } else {
      btnToggle.textContent = "▶ Start";
      btnToggle.classList.remove("stop");
      dot?.classList.remove("on");
      const s = statusEl?.textContent ?? "";
      if (n > 0 && !/✅|⏳|Reset/.test(s)) {
        setStatus(`Paused — ${n} tweets ready to export`);
      }
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  patchFetch();
  buildUI();
  scrapePage();
  console.log(
    `%c[X Exporter v5] Active on /${PAGE_TYPE}. Fetch interceptor + DOM scraper running.`,
    "color:#1d9bf0;font-weight:bold;font-size:13px"
  );
})();
