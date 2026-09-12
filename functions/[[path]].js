// ============================================================================
// NooMiNav V16.2 UI Refresh Pro - Patched Full
// 双擎驱动适配器：支持 Cloudflare Workers 和 Pages (_worker.js)
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const app = new NooMiNav(request, env, ctx);
    return app.handle();
  }
};

// ============================================================================
// 核心应用类
// ============================================================================
class NooMiNav {
  constructor(request, env, ctx) {
    this.request = request;
    this.env = env;
    this.ctx = ctx;
    this.url = new URL(request.url);

    this.COOKIE_NAME = "nav_session_v13_pro";
    this.DEFAULT_IMG = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=2073";
    this.FONT_STACK = `'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    const y = now.getFullYear().toString();
    const mo = (now.getMonth() + 1).toString().padStart(2, "0");
    const d = now.getDate().toString().padStart(2, "0");
    const hh = now.getHours().toString().padStart(2, "0");
    const mm = now.getMinutes().toString().padStart(2, "0");
    const ss = now.getSeconds().toString().padStart(2, "0");

    this.time = {
      now,
      year: y,
      month: mo,
      todayStr: `${y}-${mo}-${d}`,
      fullStr: `${y}-${mo}-${d} ${hh}:${mm}:${ss}`,
      dateKey: `${y}_${mo}`
    };
  }

  // ------------------------------------------------------------------------
  // 初始化配置
  // ------------------------------------------------------------------------
  async initConfig() {
    this.dbSettings = {};

    if (this.env.db) {
      try {
        await this.env.db.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)").run();
        await this.env.db.prepare(`
          CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            link_id TEXT,
            click_time TEXT,
            month_key TEXT,
            ip_address TEXT,
            user_agent TEXT
          )
        `).run();
        await this.env.db.prepare(`
          CREATE TABLE IF NOT EXISTS stats (
            id TEXT PRIMARY KEY,
            name TEXT,
            type TEXT,
            total_clicks INTEGER DEFAULT 0,
            year_clicks INTEGER DEFAULT 0,
            month_clicks INTEGER DEFAULT 0,
            day_clicks INTEGER DEFAULT 0,
            last_year TEXT,
            last_month TEXT,
            last_day TEXT,
            last_time TEXT
          )
        `).run();

        const res = await this.env.db.prepare("SELECT * FROM settings").all();
        (res.results || []).forEach(r => this.dbSettings[r.key] = r.value);
      } catch (e) {
        console.error("initConfig DB error:", e);
      }
    }

    this.ADMIN_PATH = "/" + (this.env.admin || "admin").replace(/^\//, "");

    this.config = {
      admin_pass: this.dbSettings.admin_pass || "123456",
      title: this.dbSettings.title || this.env.TITLE || "云端加速 · 精选导航",
      subtitle: this.dbSettings.subtitle || this.env.SUBTITLE || "优质资源推荐 · 随时畅联",
      contact_url: this.dbSettings.contact_url || this.env.CONTACT_URL || "",
      mail: this.dbSettings.mail !== undefined ? this.dbSettings.mail : (this.env.mail || ""),
      push: this.dbSettings.push !== undefined ? this.dbSettings.push : (this.env.push || ""),
      host: (this.dbSettings.host || this.env.host || this.url.origin).replace(/\/$/, ""),
      notice: this.dbSettings.notice !== undefined
        ? this.dbSettings.notice
        : (this.env.notice || `<div style="margin-bottom:8px">🎉 欢迎使用 FlarePortal 极简导航！</div><div class="notice-sub">您可以在后台「系统设置」中修改此处的公告内容，支持 HTML 标签。如果清空内容，公告板将自动隐藏。</div>`),

      promo_enable: this.dbSettings.promo_enable !== undefined ? this.dbSettings.promo_enable : (this.env.promo_enable || "1"),
      promo_badge: this.dbSettings.promo_badge !== undefined ? this.dbSettings.promo_badge : (this.env.promo_badge || "免费域名可托管 CF"),
      promo_title: this.dbSettings.promo_title !== undefined ? this.dbSettings.promo_title : (this.env.promo_title || "本站域名服务由 DigitalPlat FreeDomain 提供支持"),
      promo_desc: this.dbSettings.promo_desc !== undefined ? this.dbSettings.promo_desc : (this.env.promo_desc || "可免费申请域名，支持 Cloudflare 托管接入，适合导航站与个人项目使用。"),
      promo_url: this.dbSettings.promo_url !== undefined ? this.dbSettings.promo_url : (this.env.promo_url || "https://dash.domain.digitalplat.org/signup?ref=s8ywnMQRkL"),
      promo_format: this.dbSettings.promo_format !== undefined ? this.dbSettings.promo_format : (this.env.promo_format || "markdown"),

      account_enable: this.dbSettings.account_enable !== undefined ? this.dbSettings.account_enable : (this.env.account_enable || "0"),
      account_format: this.dbSettings.account_format !== undefined ? this.dbSettings.account_format : (this.env.account_format || "markdown"),
      account_content: this.dbSettings.account_content !== undefined ? this.dbSettings.account_content : (this.env.account_content || "")
    };

    if (this.config.push && !this.config.push.endsWith("/contact")) {
      this.config.push = this.config.push.replace(/\/$/, "") + "/contact";
    }

    this.config.img = this.DEFAULT_IMG;
    const imgSource = this.dbSettings.img || this.env.img;
    if (imgSource) {
      const imgStr = imgSource.trim();
      if (imgStr.startsWith("data:")) {
        this.config.img = imgStr;
      } else {
        const list = imgStr.split(",").map(s => s.trim()).filter(Boolean);
        if (list.length > 0) {
          const dayIndex = Math.floor(this.time.now.getTime() / 86400000);
          this.config.img = list[dayIndex % list.length];
        }
      }
    }
  }

  parseJsonArraySafe(raw, fallback = []) {
    try {
      const x = JSON.parse(raw);
      return Array.isArray(x) ? x : fallback;
    } catch {
      return fallback;
    }
  }

  loadJsonData() {
    const getJsonEnv = k => {
      try {
        if (!this.env[k]) return [];
        const v = JSON.parse(this.env[k]);
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    };

    this.LINKS_DATA = this.dbSettings.links !== undefined
      ? this.parseJsonArraySafe(this.dbSettings.links, getJsonEnv("LINKS"))
      : getJsonEnv("LINKS");

    this.FRIENDS_DATA = this.dbSettings.friends !== undefined
      ? this.parseJsonArraySafe(this.dbSettings.friends, getJsonEnv("FRIENDS"))
      : getJsonEnv("FRIENDS");
  }

  // ------------------------------------------------------------------------
  // 路由
  // ------------------------------------------------------------------------
  async handle() {
    await this.initConfig();
    const path = this.url.pathname;

    if (path === "/message") return this.route_MessageDetail();
    if (path === "/contact") return this.route_Contact();
    if (path === `${this.ADMIN_PATH}/api/logs`) return this.api_GetLogs();
    if (path === `${this.ADMIN_PATH}/api/settings`) return this.api_SaveSettings();
    if (path === `${this.ADMIN_PATH}/logout`) return this.route_AdminLogout();
    if (path === this.ADMIN_PATH) return this.route_AdminPage();

    if (path.startsWith("/go/") || path.startsWith("/fgo/")) {
      this.loadJsonData();
      return this.route_Redirect(path);
    }

    this.loadJsonData();
    return this.route_HomePage();
  }

  // ------------------------------------------------------------------------
  // 路由控制
  // ------------------------------------------------------------------------
  async route_Redirect(path) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return new Response("Invalid URL", { status: 400 });

    const type = parts[0] === "go" ? "link" : "friend";
    const id = parts[1];
    const isBackup = parts[2] === "backup";

    const set = type === "link" ? this.LINKS_DATA : this.FRIENDS_DATA;
    const item = set.find(x => x.id === id);
    if (!item) return new Response("Target not found", { status: 404 });

    let targetUrl = item.url;
    let logName = item.name;

    if (type === "link" && isBackup && item.backup_url) {
      targetUrl = item.backup_url;
      logName += "(备用)";
    }

    if (!targetUrl) return new Response("No valid URL available", { status: 400 });

    if (this.env.db) {
      this.ctx.waitUntil(this.db_recordClick(isBackup ? `${id}_backup` : id, logName, type));
    }

    return Response.redirect(targetUrl, 302);
  }

  route_MessageDetail() {
    const dataStr = this.url.searchParams.get("d");
    let msgData = { c: "未知", m: "内容解析失败或已损坏", t: this.time.fullStr };
    if (dataStr) {
      try {
        msgData = JSON.parse(decodeURIComponent(atob(dataStr)));
      } catch {}
    }
    return new Response(this.render_MessageDetail(msgData), {
      headers: { "content-type": "text/html;charset=UTF-8" }
    });
  }

  async route_Contact() {
    if (this.request.method === "GET") {
      return new Response(this.render_ContactPage(), {
        headers: { "content-type": "text/html;charset=UTF-8" }
      });
    }

    if (this.request.method === "POST") {
      try {
        const formData = await this.request.formData();
        const contactInfo = String(formData.get("guest_contact") || "匿名访客").slice(0, 120);
        const messageContent = String(formData.get("message") || "无内容").slice(0, 5000);

        if (!this.config.push) return new Response("⚠️ 站长尚未配置接收通道", { status: 500 });

        const payload = JSON.stringify({ c: contactInfo, m: messageContent, t: this.time.fullStr });
        const detailUrl = `${this.config.host}/message?d=${btoa(encodeURIComponent(payload))}`;
        const shortMsg = messageContent.length > 60 ? messageContent.substring(0, 60) + "..." : messageContent;

        await fetch(this.config.push, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `💬 导航站留言: ${contactInfo}`,
            content: `时间: ${this.time.fullStr}\n内容: ${shortMsg}\n\n👉 点击卡片查看完整详情`,
            url: detailUrl
          })
        });

        return new Response("✅ 发送成功！站长已收到你的留言", { status: 200 });
      } catch {
        return new Response("❌ 发送失败，请稍后重试", { status: 500 });
      }
    }

    return new Response("Method not allowed", { status: 405 });
  }

  route_HomePage() {
    return new Response(this.render_HomePage(), {
      headers: { "content-type": "text/html;charset=UTF-8" }
    });
  }

  parseCookies() {
    const raw = this.request.headers.get("Cookie") || "";
    const out = {};
    raw.split(";").forEach(p => {
      const i = p.indexOf("=");
      if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
    return out;
  }

  isAuthed() {
    return this.parseCookies()[this.COOKIE_NAME] === "true";
  }

  async route_AdminPage() {
    if (this.request.method === "POST") {
      const formData = await this.request.formData();
      const password = formData.get("password") || "";

      if (password.length > 100) {
        return new Response(this.render_LoginPage("密码长度异常"), {
          headers: { "content-type": "text/html;charset=UTF-8" }
        });
      }

      if (password === this.config.admin_pass) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: this.ADMIN_PATH,
            "Set-Cookie": `${this.COOKIE_NAME}=true; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`
          }
        });
      }

      return new Response(this.render_LoginPage("密码错误"), {
        headers: { "content-type": "text/html;charset=UTF-8" }
      });
    }

    if (!this.isAuthed()) {
      return new Response(this.render_LoginPage(""), {
        headers: { "content-type": "text/html;charset=UTF-8" }
      });
    }

    this.loadJsonData();
    const selectedDateOrMonth = this.getSafeParam(this.url.searchParams, "m", this.time.dateKey);

    try {
      const dashboardData = await this.db_getDashboardData(selectedDateOrMonth);
      return new Response(this.render_AdminDashboard(dashboardData, selectedDateOrMonth), {
        headers: { "content-type": "text/html;charset=UTF-8" }
      });
    } catch (dbErr) {
      return new Response(`Data Error: ${dbErr.message}`, { status: 500 });
    }
  }

  route_AdminLogout() {
    return new Response(null, {
      status: 302,
      headers: {
        Location: this.ADMIN_PATH,
        "Set-Cookie": `${this.COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
      }
    });
  }

  async api_GetLogs() {
    if (this.request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (!this.isAuthed()) return new Response("Unauthorized", { status: 401 });
    if (!this.env.db) return new Response("Database not available", { status: 500 });

    const id = this.getSafeParam(this.url.searchParams, "id");
    const m = this.getSafeParam(this.url.searchParams, "m", this.time.dateKey);

    try {
      const normalized = m.replace("_", "-").substring(0, 7);
      const queryParam = /^\d{4}-\d{2}$/.test(normalized) ? m.replace("_", "-") : this.time.dateKey.replace("_", "-");
      const { results } = await this.env.db
        .prepare("SELECT click_time, ip_address, user_agent FROM logs WHERE link_id = ? AND click_time LIKE ? || '%' ORDER BY id DESC LIMIT 50")
        .bind(id, queryParam)
        .all();

      return new Response(JSON.stringify(results || []), {
        headers: { "content-type": "application/json" }
      });
    } catch {
      return new Response("Failed to fetch logs", { status: 500 });
    }
  }

  async api_SaveSettings() {
    if (this.request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!this.isAuthed()) return new Response("Unauthorized", { status: 401 });
    if (!this.env.db) return new Response("Database not available", { status: 500 });

    try {
      const body = await this.request.json();
      const allowed = new Set([
        "admin_pass", "title", "subtitle", "img", "contact_url", "mail", "push", "host", "notice",
        "promo_enable", "promo_badge", "promo_title", "promo_desc", "promo_url", "promo_format",
        "account_enable", "account_format", "account_content",
        "links", "friends"
      ]);

      const stmts = Object.keys(body)
        .filter(k => allowed.has(k))
        .map(k =>
          this.env.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
            .bind(k, String(body[k] ?? ""))
        );

      if (stmts.length) await this.env.db.batch(stmts);

      return new Response("OK", {
        headers: { "content-type": "text/plain;charset=UTF-8" }
      });
    } catch (e) {
      console.error("api_SaveSettings error:", e);
      return new Response("Save failed", { status: 500 });
    }
  }

  // ------------------------------------------------------------------------
  // 数据库
  // ------------------------------------------------------------------------
  async db_recordClick(id, name, type) {
    try {
      const ip = this.request.headers.get("CF-Connecting-IP") || "unknown";
      const ua = this.request.headers.get("User-Agent") || "unknown";
      const { dateKey, fullStr, year, todayStr } = this.time;

      await this.env.db.prepare(
        "INSERT INTO logs (link_id, click_time, month_key, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)"
      ).bind(id, fullStr, dateKey, ip, ua).run();

      await this.env.db.prepare(`
        INSERT INTO stats (
          id, name, type, total_clicks, year_clicks, month_clicks, day_clicks, last_year, last_month, last_day, last_time
        ) VALUES (?1, ?2, ?3, 1, 1, 1, 1, ?4, ?5, ?7, ?6)
        ON CONFLICT(id) DO UPDATE SET
          total_clicks = total_clicks + 1,
          year_clicks = CASE WHEN last_year = ?4 THEN year_clicks + 1 ELSE 1 END,
          month_clicks = CASE WHEN last_month = ?5 THEN month_clicks + 1 ELSE 1 END,
          day_clicks = CASE WHEN last_day = ?7 THEN day_clicks + 1 ELSE 1 END,
          last_year = ?4,
          last_month = ?5,
          last_day = ?7,
          last_time = ?6,
          name = ?2,
          type = ?3
      `).bind(id, name, type, year, dateKey, fullStr, todayStr).run();
    } catch (e) {
      console.error("DB Record Error:", e);
    }
  }

  async db_getDashboardData(selectedDateOrMonth) {
    if (!this.env.db) throw new Error("Database not bound");

    const currentMonthKey = selectedDateOrMonth.replace("-", "_").substring(0, 7);
    const queryParam = selectedDateOrMonth.replace("_", "-");
    const isDayMode = selectedDateOrMonth.length > 7 && /^\d{4}-\d{2}-\d{2}$/.test(selectedDateOrMonth);

    const queries = [
      this.env.db.prepare("SELECT id, total_clicks, last_time FROM stats").all().catch(() => ({ results: [] })),
      this.env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE click_time LIKE ? || '%' GROUP BY link_id").bind(this.time.todayStr).all().catch(() => ({ results: [] })),
      this.env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE click_time LIKE ? || '%' GROUP BY link_id").bind(queryParam).all().catch(() => ({ results: [] }))
    ];

    if (isDayMode) {
      queries.push(this.env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE month_key = ? GROUP BY link_id").bind(currentMonthKey).all().catch(() => ({ results: [] })));
    } else {
      queries.push(Promise.resolve({ results: [] }));
    }

    queries.push(this.env.db.prepare("SELECT COUNT(*) as total FROM logs WHERE month_key = ?").bind(currentMonthKey).all().catch(() => ({ results: [{ total: 0 }] })));

    const [statsResult, dailyResult, periodResult, monthContextResult, monthTotalResult] = await Promise.all(queries);

    const statsMap = new Map();
    const dailyMap = new Map();
    const periodMap = new Map();
    const monthContextMap = new Map();

    (statsResult?.results || []).forEach(r => statsMap.set(r.id, r));
    (dailyResult?.results || []).forEach(r => dailyMap.set(r.link_id, r.count));
    (periodResult?.results || []).forEach(r => periodMap.set(r.link_id, r.count));
    (monthContextResult?.results || []).forEach(r => monthContextMap.set(r.link_id, r.count));

    return {
      statsMap,
      dailyMap,
      periodMap,
      monthContextMap,
      monthTotalClicks: monthTotalResult?.results?.[0]?.total || 0,
      isDayMode
    };
  }

  getSafeParam(sp, key, def = "") {
    return sp.get(key)?.trim() || def;
  }

  safeCssUrl(url) {
    return String(url || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  safeScriptJson(obj) {
    return JSON.stringify(obj)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  }

  getBgShellStyle() {
    return `background-color:#0f172a;background-size:cover;background-position:center;background-repeat:no-repeat;`;
  }

  render_BgRuntimeScript() {
    const primary = this.safeCssUrl(this.config.img);
    const fallback = this.safeCssUrl(this.DEFAULT_IMG);
    return `<script>
(function(){
  if(window.__bgInitDone) return;
  window.__bgInitDone = true;
  const body = document.body;
  const primary = '${primary}';
  const fallback = '${fallback}';
  function applyBg(url){
    body.style.backgroundImage = "linear-gradient(rgba(2,6,23,0.30), rgba(2,6,23,0.40)), url('" + url + "')";
  }
  function loadImage(url, ok, fail){
    if(!url){ fail && fail(); return; }
    const img = new Image();
    img.onload = () => ok && ok(url);
    img.onerror = () => fail && fail();
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  }
  applyBg(fallback);
  if(primary && primary !== fallback){
    loadImage(primary, applyBg, () => loadImage(fallback, applyBg));
  } else {
    loadImage(fallback, applyBg);
  }
})();
</script>`;
  }

  escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  escapeAttr(str = "") {
    return this.escapeHtml(str).replace(/`/g, "&#96;");
  }

  renderRichContent(content = "", format = "html") {
    const raw = String(content || "");
    const mode = String(format || "html").toLowerCase();

    if (mode === "html") return raw;

    let s = this.escapeHtml(raw);
    s = s.replace(/^###\s+(.*)$/gm, "<h3>$1</h3>");
    s = s.replace(/^##\s+(.*)$/gm, "<h2>$1</h2>");
    s = s.replace(/^#\s+(.*)$/gm, "<h1>$1</h1>");
    s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.*?)\*/g, "<em>$1</em>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    const lines = s.split("\n");
    const html = [];
    let inList = false;

    for (let line of lines) {
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inList) {
          html.push("<ul>");
          inList = true;
        }
        html.push("<li>" + line.replace(/^\s*[-*]\s+/, "") + "</li>");
      } else {
        if (inList) {
          html.push("</ul>");
          inList = false;
        }
        if (line.trim() === "") html.push("");
        else if (/^<h[1-3]>/.test(line)) html.push(line);
        else html.push("<p>" + line + "</p>");
      }
    }

    if (inList) html.push("</ul>");
    return html.join("\n");
  }

  // ------------------------------------------------------------------------
  // 基础页面
  // ------------------------------------------------------------------------
  render_Head(t) {
    return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${this.escapeHtml(t)}</title><style>
      :root{--glass:rgba(15,23,42,.58);--border:rgba(255,255,255,.15);--text-shadow:0 2px 4px rgba(0,0,0,.7)}
      *{box-sizing:border-box}
      body{margin:0;min-height:100vh;font-family:${this.FONT_STACK};color:#fff;display:flex;justify-content:center;align-items:center}
      .glass-panel{background:var(--glass);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--border);box-shadow:0 8px 24px rgba(0,0,0,.18);border-radius:20px}
      h1,div,span,a,p,h2,h3,label,button,input,textarea{text-shadow:var(--text-shadow)}
    </style>`;
  }

  render_MessageDetail(data) {
    const t = this.escapeHtml(data?.t || "");
    const c = this.escapeHtml(data?.c || "");
    const m = this.escapeHtml(data?.m || "");

    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>留言详情</title><style>
      body{font-family:${this.FONT_STACK};background:#f3f4f6;margin:0;padding:20px;display:flex;justify-content:center;min-height:100vh;box-sizing:border-box}
      .ticket-card{background:#fff;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.08);width:100%;max-width:600px;padding:40px;margin-top:5vh;height:fit-content;border-top:6px solid #8b5cf6}
      .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:25px}
      .badge{background:#ede9fe;color:#7c3aed;padding:6px 12px;border-radius:20px;font-size:.85rem;font-weight:700;letter-spacing:.5px}
      .time{color:#94a3b8;font-size:.9rem;font-family:monospace}
      .sender-box{margin-bottom:25px}.label{font-size:.85rem;color:#64748b;text-transform:uppercase;font-weight:600;letter-spacing:1px;margin-bottom:5px}
      .sender{font-size:1.5rem;color:#0f172a;font-weight:800;margin:0;word-break:break-all}
      .divider{height:1px;background:#e2e8f0;margin:25px 0}
      .message{font-size:1.1rem;line-height:1.8;color:#334155;white-space:pre-wrap;word-break:break-word}
      .footer{margin-top:40px;text-align:center;color:#cbd5e1;font-size:.85rem}
      @media (max-width:600px){.ticket-card{padding:25px}.sender{font-size:1.2rem}.message{font-size:1rem}}
    </style></head><body><div class="ticket-card"><div class="header"><span class="badge">INBOX MESSAGE</span><span class="time">${t}</span></div><div class="sender-box"><div class="label">Contact / 发件人</div><h2 class="sender">${c}</h2></div><div class="divider"></div><div class="label">Message / 内容</div><div class="message">${m}</div><div class="footer">🔒 Encrypted transmission powered by Cloudflare</div></div></body></html>`;
  }

  render_ContactPage() {
    return `<!DOCTYPE html><html><head>${this.render_Head(this.config.title)}<style>
      .box{padding:40px;width:380px;text-align:left}
      h2{font-size:1.6rem;margin:0 0 10px;display:flex;align-items:center;gap:8px}
      p.desc{color:#cbd5e1;font-size:.92rem;margin-bottom:25px;line-height:1.65}
      form{display:flex;flex-direction:column;width:100%}
      label{font-size:.85rem;color:#f1f5f9;margin-bottom:8px;font-weight:600}
      input,textarea{width:100%;padding:14px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.2);border-radius:14px;color:#fff;margin-bottom:20px;outline:none;transition:.2s;font-size:.95rem;box-sizing:border-box;font-family:inherit}
      input:focus,textarea:focus{border-color:#60a5fa;background:rgba(0,0,0,.5);box-shadow:0 0 0 4px rgba(96,165,250,.18)}
      input::placeholder,textarea::placeholder{color:rgba(255,255,255,.4)}
      textarea{resize:vertical;min-height:100px}
      button{width:100%;padding:16px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;border:none;border-radius:14px;font-weight:800;cursor:pointer;font-size:1rem;transition:.2s;box-shadow:0 4px 12px rgba(59,130,246,.26)}
      button:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(59,130,246,.35)}
      button:disabled{opacity:.7;cursor:not-allowed;transform:none}
      .status{margin-top:15px;font-size:.9rem;font-weight:600;text-align:center;min-height:20px}
      .back{text-align:center;margin-top:20px}.back a{color:#94a3b8;text-decoration:none;font-size:.85rem;transition:.2s}.back a:hover{color:#fff}
    </style></head><body style="${this.getBgShellStyle()}display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;"><div class="glass-panel box"><h2>📝 给我留言</h2><p class="desc">有任何问题、疑问？<br>留下联系方式，看到了就会联系，优先邮箱或者QQ。</p><form id="msgForm"><label>留下你的联系方式？</label><input type="text" name="guest_contact" placeholder="邮箱或者QQ" required><label>你想说什么？</label><textarea name="message" placeholder="写下你的留言内容..." required></textarea><button type="submit" id="submitBtn">发送留言</button></form><div id="status" class="status"></div><div class="back"><a href="/">← 返回导航主页</a></div></div>${this.render_BgRuntimeScript()}<script>document.getElementById('msgForm').addEventListener('submit',async e=>{e.preventDefault();const btn=document.getElementById('submitBtn'),status=document.getElementById('status');btn.disabled=true;btn.innerText='发送中...';status.innerText='';try{const res=await fetch('/contact',{method:'POST',body:new FormData(e.target)}),text=await res.text();status.style.color=res.ok?'#34d399':'#f87171';status.innerText=text;if(res.ok)e.target.reset()}catch{status.style.color='#f87171';status.innerText='网络错误，请稍后重试'}finally{btn.disabled=false;btn.innerText='发送留言'}});</script></body></html>`;
  }

  render_LoginPage(errorMsg = "") {
    return `<!DOCTYPE html><html><head>${this.render_Head(this.config.title)}<style>
      .box{padding:50px 40px;text-align:center;width:340px;display:flex;flex-direction:column;align-items:center}
      h1{font-size:1.8rem;margin-bottom:30px}
      form{width:100%;display:flex;flex-direction:column;align-items:center}
      input{width:100%;padding:16px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.2);border-radius:14px;color:#fff;margin-bottom:20px;outline:none;transition:.2s;font-size:1rem;box-sizing:border-box;text-align:center}
      input:focus{border-color:#60a5fa;background:rgba(0,0,0,.5);transform:scale(1.01);box-shadow:0 0 0 4px rgba(96,165,250,.18)}
      input::placeholder{color:rgba(255,255,255,.5)}
      button{width:100%;padding:16px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;border:none;border-radius:14px;font-weight:800;cursor:pointer;font-size:1rem;transition:.2s;box-shadow:0 4px 12px rgba(59,130,246,.25)}
      button:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(59,130,246,.35)}
      .error-msg{color:#f87171;margin-bottom:15px;font-size:.9rem;min-height:20px}
    </style></head><body style="${this.getBgShellStyle()}display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;"><div class="glass-panel box"><h1>🔐 管理后台</h1>${errorMsg ? `<div class="error-msg">❌ ${this.escapeHtml(errorMsg)}</div>` : ""}<form method="POST" action="${this.ADMIN_PATH}"><input type="password" name="password" placeholder="请输入访问口令" required autofocus><button type="submit">立即登录</button></form></div>${this.render_BgRuntimeScript()}</body></html>`;
  }

  // ------------------------------------------------------------------------
  // 首页
  // ------------------------------------------------------------------------
  render_HomePage() {
    const safeLinks = Array.isArray(this.LINKS_DATA) ? this.LINKS_DATA : [];
    const safeFriends = Array.isArray(this.FRIENDS_DATA) ? this.FRIENDS_DATA : [];

    const promoEnabled = String(this.config.promo_enable || "0") === "1";
    const promoUrl = this.config.promo_url || "";
    const promoBadge = this.config.promo_badge || "推广支持";
    const promoTitle = this.config.promo_title || "推广支持";
    const promoDesc = this.config.promo_desc || "";

    const accountEnabled = String(this.config.account_enable || "0") === "1";
    const accountFormat = this.config.account_format || "markdown";
    const accountContent = (this.config.account_content || "").trim();

    const cardsHtml = safeLinks.map(item => {
      const itemId = this.escapeAttr(item.id || "");
      const mainUrl = `/go/${itemId}`;
      const backupHtml = item.backup_url ? `<a href="/go/${itemId}/backup" class="tag-backup" title="备用线路">备用</a>` : "";
      const customTagHtml = item.tag ? `<span class="tag-special">${this.escapeHtml(item.tag)}</span>` : "";
      return `<div class="glass-card resource-card-wrap"><a href="${mainUrl}" class="resource-main-link"><div class="card-icon">${this.escapeHtml(item.emoji || "🔗")}</div><div class="card-info"><h3 style="display:flex;align-items:center;flex-wrap:wrap;">${this.escapeHtml(item.name || "")}${customTagHtml}</h3><p>⚠️ ${this.escapeHtml(item.note || "无说明")}</p></div></a>${backupHtml}</div>`;
    }).join("");

    const friendsHtml = safeFriends.map(f => `<a href="/fgo/${this.escapeAttr(f.id || "")}" target="_blank" class="glass-card partner-card">${this.escapeHtml(f.name || "")}</a>`).join("");

    let fabHtml = `<div class="fab-container">`;
    if (this.config.contact_url) fabHtml += `<a href="${this.escapeAttr(this.config.contact_url)}" target="_blank" class="fab-btn fab-telegram">💬 获取支持</a>`;
    if (this.config.mail) fabHtml += `<a href="mailto:${this.escapeAttr(this.config.mail)}" class="fab-btn fab-mail">📧 发送邮件</a>`;
    if (this.config.push) fabHtml += `<a href="/contact" class="fab-btn fab-push">📝 给我留言</a>`;
    fabHtml += `</div>`;

    let noticeHtml = "";
    if (this.config.notice && this.config.notice.trim() !== "") {
      noticeHtml = `<div class="glass-card notice-card"><div class="notice-title"><span>❤️</span> 温馨提示</div><div class="notice-content">${this.config.notice}</div></div>`;
    }

    let accountCardHtml = "";
    if (accountEnabled && accountContent) {
      let accountRendered = this.renderRichContent(accountContent, accountFormat);
      accountRendered = accountRendered.replace(/<div class="ad-badge">[\s\S]*?<\/div>/i, "");

      let accountUrl = "";
      const mdMatch = accountContent.match(/\[.*?\]\((https?:\/\/[^\s)]+)\)/i);
      const htmlMatch = accountContent.match(/href=["'](https?:\/\/[^"']+)["']/i);
      if (mdMatch?.[1]) accountUrl = mdMatch[1];
      if (!accountUrl && htmlMatch?.[1]) accountUrl = htmlMatch[1];

      const badgeHtml = `<div class="promo-badge">账号购买</div>`;
      const contentHtml = `<div class="promo-content"><div class="promo-desc rich-content">${accountRendered}</div></div>`;

      accountCardHtml = accountUrl
        ? `<a href="${this.escapeAttr(accountUrl)}" target="_blank" rel="noopener noreferrer" class="glass-card promo-card account-promo-card">${badgeHtml}${contentHtml}</a>`
        : `<section class="glass-card promo-card account-promo-card">${badgeHtml}${contentHtml}</section>`;
    }

    let promoHtml = "";
    if (promoEnabled && promoUrl) {
      const promoRendered = this.renderRichContent(promoDesc, this.config.promo_format);
      promoHtml = `<a href="${this.escapeAttr(promoUrl)}" target="_blank" rel="noopener noreferrer" class="glass-card promo-card"><div class="promo-badge">${this.escapeHtml(promoBadge)}</div><div class="promo-content"><div class="promo-title">${this.escapeHtml(promoTitle)}</div><div class="promo-desc rich-content">${promoRendered}</div></div></a>`;
    }

    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${this.escapeHtml(this.config.title)}</title><style>
      :root{--glass:rgba(255,255,255,.14);--border:rgba(255,255,255,.16);--text-main:#fff;--text-sub:rgba(226,232,240,.92);--backdrop-blur:12px;--shadow-soft:0 8px 20px rgba(15,23,42,.14);--shadow-hover:0 14px 28px rgba(15,23,42,.18);--transition:.22s ease}
      .dark-theme{--glass:rgba(15,23,42,.82);--border:rgba(255,255,255,.10);--text-main:#f8fafc;--text-sub:rgba(226,232,240,.88)}
      *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
      body{font-family:${this.FONT_STACK};color:var(--text-main);${this.getBgShellStyle()}min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px 100px;position:relative}
      .container{width:100%;max-width:1200px}
      .glass-card{background:linear-gradient(135deg,rgba(255,255,255,.14),rgba(255,255,255,.08));backdrop-filter:blur(var(--backdrop-blur));-webkit-backdrop-filter:blur(var(--backdrop-blur));border:1px solid var(--border);border-radius:20px;box-shadow:var(--shadow-soft);transition:var(--transition)}
      .dark-theme .glass-card{background:linear-gradient(135deg,rgba(15,23,42,.82),rgba(15,23,42,.68))}
      .header{text-align:center;padding:48px 28px;margin-bottom:28px}
      .header h1{font-size:clamp(2.1rem,5vw,3.3rem);font-weight:800;line-height:1.08;letter-spacing:-.035em;margin-bottom:12px;text-shadow:0 6px 18px rgba(0,0,0,.28)}
      .header p{max-width:720px;margin:0 auto;font-size:1rem;line-height:1.75;color:var(--text-sub)}
      .section-title{font-size:.95rem;font-weight:800;color:#7dd3fc;margin:0 0 15px 6px;text-transform:uppercase;letter-spacing:.06em;text-shadow:0 2px 4px rgba(0,0,0,.35)}
      .search-container{margin-bottom:28px;width:100%}
      .search-wrap{position:relative;width:100%;max-width:560px;margin:0 auto}
      .search-icon{position:absolute;left:18px;top:50%;transform:translateY(-50%);opacity:.8;font-size:1rem;pointer-events:none}
      .search-box{width:100%;height:56px;padding:0 20px 0 48px;border-radius:18px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.14);backdrop-filter:blur(6px);color:#fff;font-size:1rem;box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 4px 14px rgba(0,0,0,.10);transition:var(--transition)}
      .search-box::placeholder{color:rgba(255,255,255,.64)}
      .search-box:focus{outline:none;background:rgba(255,255,255,.2);border-color:rgba(125,211,252,.4);box-shadow:0 0 0 4px rgba(56,189,248,.10),0 8px 18px rgba(0,0,0,.12)}
      .grid-resources{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;margin-bottom:40px}
      .resource-card-wrap{display:flex;position:relative;overflow:hidden;min-height:112px}
      .resource-card-wrap:hover,.partner-card:hover{background:rgba(255,255,255,.22);transform:translateY(-2px);box-shadow:var(--shadow-hover)}
      .resource-main-link{flex:1;display:flex;align-items:center;gap:16px;text-decoration:none;color:#fff;padding:22px 20px;text-shadow:0 2px 4px rgba(0,0,0,.42)}
      .card-icon{width:52px;display:flex;align-items:center;justify-content:center;font-size:2.2rem;flex-shrink:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.25))}
      .card-info h3{font-size:1.06rem;font-weight:700;line-height:1.35;margin-bottom:6px}
      .card-info p{font-size:.84rem;color:rgba(252,211,77,.92);font-weight:500;line-height:1.5}
      .tag-special{display:inline-flex;align-items:center;margin-left:8px;padding:3px 8px;font-size:.65rem;font-weight:800;color:#ecfdf5;background:linear-gradient(135deg,rgba(16,185,129,.78),rgba(5,150,105,.88));border:1px solid rgba(52,211,153,.35);border-radius:999px;box-shadow:0 2px 8px rgba(16,185,129,.18);transform:translateY(-1px);text-shadow:0 1px 2px rgba(0,0,0,.35);white-space:nowrap}
      .tag-backup{position:absolute;top:12px;right:12px;padding:4px 9px;border-radius:999px;background:rgba(15,23,42,.35);border:1px solid rgba(255,255,255,.12);font-size:11px;color:#e2e8f0;text-decoration:none;transition:var(--transition)}
      .tag-backup:hover{background:rgba(139,92,246,.88);color:#fff}
      .grid-partners{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-bottom:40px}
      .partner-card{text-decoration:none;color:#fff;text-align:center;padding:16px 14px;font-size:.92rem;font-weight:600;border-radius:16px;text-shadow:0 1px 3px rgba(0,0,0,.45);transition:var(--transition);min-height:68px;display:flex;align-items:center;justify-content:center}
      .fab-container{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);display:flex;gap:12px;z-index:100;flex-wrap:wrap;justify-content:center}
      .fab-btn{padding:11px 18px;border-radius:16px;text-decoration:none;font-weight:700;color:#fff;transition:var(--transition);box-shadow:0 6px 16px rgba(0,0,0,.16);white-space:nowrap;border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
      .fab-telegram{background:rgba(139,92,246,.66)} .fab-mail{background:rgba(59,130,246,.66)} .fab-push{background:rgba(244,63,94,.66)}
      .fab-btn:hover{transform:translateY(-2px);box-shadow:0 10px 20px rgba(0,0,0,.20)}
      .theme-toggle{position:fixed;top:20px;right:20px;width:44px;height:44px;border-radius:14px;background:rgba(255,255,255,.16);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:100;color:#fff}
      .no-result{text-align:center;padding:40px 0;color:var(--text-sub);font-size:1.06rem;display:none}
      .notice-card{margin-bottom:22px;padding:22px 28px;text-align:left;background:linear-gradient(135deg,rgba(244,63,94,.10),rgba(30,41,59,.32));border-left:4px solid #fb7185}
      .notice-title{font-size:1.1rem;font-weight:800;background:linear-gradient(to right,#fb7185,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:15px;display:flex;align-items:center;gap:10px;text-shadow:none}
      .notice-title span{-webkit-text-fill-color:initial}
      .notice-content{font-size:.95rem;line-height:1.8;color:rgba(255,255,255,.92)}
      .promo-card{display:flex;align-items:center;gap:18px;margin-bottom:30px;padding:22px 26px;text-decoration:none;color:var(--text-main);background:linear-gradient(135deg,rgba(255,255,255,.16),rgba(59,130,246,.10));border:1px solid rgba(125,211,252,.22);box-shadow:0 6px 18px rgba(15,23,42,.12)}
      .promo-card:hover{transform:translateY(-2px)}
      .promo-badge{flex-shrink:0;min-width:138px;padding:12px 16px;border-radius:999px;text-align:center;font-size:.95rem;font-weight:800;color:#dbeafe;background:linear-gradient(135deg,rgba(255,255,255,.28),rgba(191,219,254,.18));border:1px solid rgba(255,255,255,.22)}
      .promo-title{font-size:1rem;font-weight:800;color:#fff;line-height:1.45}
      .promo-desc{font-size:.95rem;color:rgba(226,232,240,.92);line-height:1.6}
      .rich-content p{margin:0 0 8px}.rich-content p:last-child{margin-bottom:0}
      .account-promo-card{margin-bottom:18px;background:linear-gradient(135deg,rgba(255,255,255,.16),rgba(16,185,129,.10));border:1px solid rgba(125,211,252,.22);text-decoration:none;color:var(--text-main)}
      .account-promo-card .promo-badge{color:#d1fae5;background:linear-gradient(135deg,rgba(16,185,129,.28),rgba(59,130,246,.18));border:1px solid rgba(167,243,208,.24)}
      .account-promo-card .promo-content{flex:1;min-width:0}
      .account-promo-card .promo-desc h1,.account-promo-card .promo-desc h2,.account-promo-card .promo-desc h3{margin:0 0 8px;line-height:1.35;color:#fff}
      .account-promo-card .promo-desc ul{margin:4px 0 0 18px;padding:0}.account-promo-card .promo-desc li{margin:4px 0}
      .account-promo-card .promo-desc code{padding:2px 6px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)}
      .account-promo-card .promo-desc a{color:#93c5fd}
      .account-promo-card .promo-desc .ad-badge{display:none!important}
      .account-promo-card .promo-desc .ad-btn{display:inline-flex;align-items:center;justify-content:center;margin-top:8px;padding:9px 12px;border-radius:10px;text-decoration:none;color:#fff;font-weight:800;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border:1px solid rgba(255,255,255,.12)}
      @media (max-width:768px){
        .header h1{font-size:2.2rem}.container{padding:0 10px}.grid-resources{grid-template-columns:1fr;gap:15px}
        .grid-partners{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
        .fab-container{bottom:18px;gap:10px;width:calc(100% - 20px)}.fab-btn{padding:10px 14px;font-size:.85rem}
        .notice-card{padding:16px 18px}.promo-card{flex-direction:column;align-items:flex-start;gap:14px;padding:18px}
        .promo-badge{min-width:auto;width:auto;max-width:100%;font-size:.9rem}
      }
    </style><script>
      function initSearch(){
        const searchBox=document.querySelector('.search-box');
        const gridResources=document.querySelector('.grid-resources');
        const noResult=document.createElement('div');
        noResult.className='no-result';
        noResult.innerHTML='😕 暂无匹配结果';
        gridResources.after(noResult);
        if(!searchBox)return;
        let timer=null;
        searchBox.addEventListener('keydown',e=>e.key==='Enter'&&e.preventDefault());
        searchBox.addEventListener('input',function(e){
          clearTimeout(timer);
          timer=setTimeout(()=>{
            const searchTerm=e.target.value.toLowerCase().trim();
            const cards=document.querySelectorAll('.resource-card-wrap,.partner-card');
            let hasMatch=false;
            cards.forEach(card=>{
              const isMatch=!searchTerm||card.textContent.toLowerCase().includes(searchTerm);
              card.style.display=isMatch?'':'none';
              if(isMatch)hasMatch=true;
            });
            noResult.style.display=searchTerm&&!hasMatch?'block':'none';
          },120);
        });
      }
      function initThemeToggle(){
        const themeBtn=document.querySelector('.theme-toggle');
        if(!themeBtn)return;
        const toggleTheme=()=>{
          document.body.classList.toggle('dark-theme');
          const isDark=document.body.classList.contains('dark-theme');
          localStorage.setItem('theme',isDark?'dark':'light');
          themeBtn.textContent=isDark?'☀️':'🌙';
        };
        themeBtn.addEventListener('click',toggleTheme);
        const savedTheme=localStorage.getItem('theme');
        const prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;
        if(savedTheme==='dark'||(!savedTheme&&prefersDark)){document.body.classList.add('dark-theme');themeBtn.textContent='☀️';}
        else themeBtn.textContent='🌙';
      }
      document.addEventListener('DOMContentLoaded',()=>{initSearch();initThemeToggle();});
    </script></head><body>
      <button class="theme-toggle" title="切换主题">🌙</button>
      <div class="container">
        <div class="header glass-card"><h1>${this.escapeHtml(this.config.title)}</h1><p>${this.escapeHtml(this.config.subtitle)}</p></div>
        <div class="search-container"><div class="search-wrap"><span class="search-icon">🔎</span><input type="text" class="search-box" placeholder="搜索导航项目..." /></div></div>
        ${noticeHtml}
        ${accountCardHtml}
        ${promoHtml}
        <div class="section-title">💎 精选</div>
        <div class="grid-resources">${cardsHtml}</div>
        <div class="section-title">🔗 友链</div>
        <div class="grid-partners">${friendsHtml}</div>
      </div>
      ${fabHtml}
      ${this.render_BgRuntimeScript()}
    </body></html>`;
  }

  // ------------------------------------------------------------------------
  // 后台
  // ------------------------------------------------------------------------
  render_AdminDashboard(dbData, m) {
    const { statsMap, dailyMap, periodMap, monthContextMap, monthTotalClicks, isDayMode } = dbData;
    const safeLinks = Array.isArray(this.LINKS_DATA) ? this.LINKS_DATA : [];
    const safeFriends = Array.isArray(this.FRIENDS_DATA) ? this.FRIENDS_DATA : [];
    const activeIds = new Set([...safeLinks.map(i => i.id), ...safeFriends.map(i => i.id)]);

    let historyTotal = 0;
    for (const v of statsMap.values()) if (activeIds.has(v.id)) historyTotal += (v.total_clicks || 0);

    let viewTotalDenominator = 0;
    if (isDayMode) for (const c of monthContextMap.values()) viewTotalDenominator += c;
    else for (const c of periodMap.values()) viewTotalDenominator += c;

    let prevDay = m, nextDay = m, prevMonthStr = "", nextMonthStr = "";
    try {
      if (isDayMode) {
        const d = new Date(m);
        d.setDate(d.getDate() - 1);
        prevDay = d.toISOString().split("T")[0];
        d.setDate(d.getDate() + 2);
        nextDay = d.toISOString().split("T")[0];
      }
      const currentY_int = parseInt(m.substring(0, 4));
      const currentM_int = parseInt(m.substring(5, 7));
      let prevM_Y = currentY_int, prevM_M = currentM_int - 1;
      if (prevM_M === 0) { prevM_Y -= 1; prevM_M = 12; }
      prevMonthStr = `${prevM_Y}_${String(prevM_M).padStart(2, "0")}`;
      let nextM_Y = currentY_int, nextM_M = currentM_int + 1;
      if (nextM_M === 13) { nextM_Y += 1; nextM_M = 1; }
      nextMonthStr = `${nextM_Y}_${String(nextM_M).padStart(2, "0")}`;
    } catch {}

    const buildCard = (id, name, emoji, isMini) => {
      const stat = statsMap.get(id) || { total_clicks: 0, last_time: "" };
      const realTodayVal = dailyMap.get(id) || 0;
      const selectedTargetVal = periodMap.get(id) || 0;
      const monthContextVal = monthContextMap.get(id) || 0;
      let col2Label, col2Val, col3Label, col3Val, progressVal = 0;

      if (isDayMode) {
        col2Label = (m === this.time.todayStr) ? "今日" : "当日";
        col2Val = selectedTargetVal;
        col3Label = "当月";
        col3Val = monthContextVal;
        progressVal = viewTotalDenominator > 0 ? ((monthContextVal / viewTotalDenominator) * 100).toFixed(1) : 0;
      } else {
        col2Label = "今日";
        col2Val = realTodayVal;
        col3Label = (m === this.time.dateKey) ? "本月" : "当月";
        col3Val = selectedTargetVal;
        progressVal = viewTotalDenominator > 0 ? ((selectedTargetVal / viewTotalDenominator) * 100).toFixed(1) : 0;
      }

      let timeDisplay = stat.last_time || "暂无";
      let timeIcon = "🕒";
      if (timeDisplay !== "暂无") {
        if (isDayMode) timeDisplay = timeDisplay.split(" ")[1] || timeDisplay;
        else { timeDisplay = timeDisplay.split(" ")[0].substring(5); timeIcon = "📅"; }
      }

      const safeId = this.escapeAttr(id || "");
      const safeM = this.escapeAttr(m || "");
      const safeName = this.escapeHtml(name || "");
      const encodedName = encodeURIComponent(name || "");

      if (isMini) {
        return `<div class="mini-card" onclick="openLog('${safeId}','${safeM}','${encodedName}')"><div class="mini-top"><span class="mini-name" title="${safeName}">${safeName}</span><span class="mini-badge">${selectedTargetVal}</span></div><div class="mini-meta">${this.escapeHtml(timeDisplay)}</div></div>`;
      }

      return `<div class="stat-card" onclick="openLog('${safeId}','${safeM}','${encodedName}')"><div class="stat-top"><div class="stat-title-wrap"><span class="stat-emoji">${this.escapeHtml(emoji || "🔗")}</span><span class="stat-title">${safeName}</span></div><span class="stat-pct">${progressVal}%</span></div><div class="stat-metrics"><div class="metric"><span class="metric-label">历史</span><span class="metric-value">${stat.total_clicks || 0}</span></div><div class="metric"><span class="metric-label">${col2Label}</span><span class="metric-value metric-gold">${col2Val}</span></div><div class="metric"><span class="metric-label">${col3Label}</span><span class="metric-value metric-blue">${col3Val}</span></div></div><div class="progress"><div style="width:${progressVal}%"></div></div><div class="stat-foot">${timeIcon} ${this.escapeHtml(timeDisplay)}</div></div>`;
    };

    const linkHtml = safeLinks.map(i => buildCard(i.id, i.name, i.emoji, false)).join("");
    const friendHtml = safeFriends.map(i => buildCard(i.id, i.name, "", true)).join("");

    const sysSettings = {
      admin_pass: this.config.admin_pass,
      title: this.config.title,
      subtitle: this.config.subtitle,
      img: this.dbSettings.img || this.env.img || "",
      contact_url: this.config.contact_url,
      mail: this.config.mail,
      push: this.dbSettings.push || this.env.push || "",
      host: this.dbSettings.host || this.env.host || "",
      notice: this.config.notice,
      promo_enable: this.config.promo_enable,
      promo_badge: this.config.promo_badge,
      promo_title: this.config.promo_title,
      promo_desc: this.config.promo_desc,
      promo_url: this.config.promo_url,
      promo_format: this.config.promo_format,
      account_enable: this.config.account_enable,
      account_format: this.config.account_format,
      account_content: this.config.account_content,
      links: JSON.stringify(this.LINKS_DATA, null, 2),
      friends: JSON.stringify(this.FRIENDS_DATA, null, 2)
    };

    let noticeHtmlPreview = "";
    if (this.config.notice && this.config.notice.trim() !== "") {
      noticeHtmlPreview = `<div class="panel notice-panel"><div class="panel-head"><span>❤️</span><strong>公告预览</strong></div><div class="notice-preview">${this.config.notice}</div></div>`;
    }

    const promoPreview = String(this.config.promo_enable) === "1"
      ? `<div class="panel notice-panel"><div class="panel-head"><span>📣</span><strong>推广卡预览（首页中部）</strong></div><div class="promo-preview-box"><div class="promo-preview-badge">${this.escapeHtml(this.config.promo_badge || "推广支持")}</div><div class="promo-preview-main"><div class="promo-preview-title">${this.escapeHtml(this.config.promo_title || "推广支持")}</div><div class="promo-preview-desc">${this.renderRichContent(this.config.promo_desc || "", this.config.promo_format)}</div></div></div></div>`
      : "";

    const accountPreview = (String(this.config.account_enable || "0") === "1" && String(this.config.account_content || "").trim())
      ? (() => {
          let rendered = this.renderRichContent(this.config.account_content || "", this.config.account_format || "markdown");
          rendered = rendered.replace(/<div class="ad-badge">[\s\S]*?<\/div>/i, "");
          return `<div class="panel notice-panel"><div class="panel-head"><span>🧾</span><strong>账号推广卡预览</strong></div><div class="promo-preview-box account-promo-preview-box"><div class="promo-preview-badge account-preview-badge">账号购买</div><div class="promo-preview-main"><div class="promo-preview-desc account-preview-desc">${rendered}</div></div></div></div>`;
        })()
      : "";

    return `<!DOCTYPE html><html lang="zh-CN"><head>${this.render_Head(this.config.title)}<style>
      :root{--bg-card:rgba(15,23,42,.70);--bg-card-soft:rgba(15,23,42,.58);--bg-elev:rgba(255,255,255,.05);--bd:rgba(255,255,255,.10);--bd-strong:rgba(255,255,255,.16);--txt:#f8fafc;--txt-sub:#94a3b8;--txt-soft:#cbd5e1;--blue:#38bdf8;--gold:#fbbf24;--red:#f87171;--shadow:0 10px 28px rgba(2,6,23,.18);--shadow-soft:0 4px 14px rgba(2,6,23,.12)}
      .light-theme{--bg-card:rgba(255,255,255,.92);--bg-card-soft:rgba(255,255,255,.84);--bg-elev:rgba(15,23,42,.04);--bd:rgba(15,23,42,.08);--bd-strong:rgba(15,23,42,.12);--txt:#0f172a;--txt-sub:#475569;--txt-soft:#64748b;--shadow:0 10px 24px rgba(15,23,42,.08);--shadow-soft:0 4px 12px rgba(15,23,42,.06)}
      *{box-sizing:border-box} html{scroll-behavior:smooth}
      body{color:var(--txt);${this.getBgShellStyle()}padding:24px;display:block;margin:0}
      .admin-shell{width:min(1320px,100%);margin:0 auto}
      .theme-toggle{position:fixed;top:18px;left:18px;width:42px;height:42px;border-radius:14px;border:1px solid var(--bd);background:var(--bg-card-soft);color:var(--txt);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:120;backdrop-filter:blur(10px);box-shadow:var(--shadow-soft)}
      .topbar{background:var(--bg-card);border:1px solid var(--bd);border-radius:28px;backdrop-filter:blur(14px);box-shadow:var(--shadow);padding:28px;display:grid;grid-template-columns:1.4fr 1fr;gap:22px;margin-bottom:20px}
      .hero-title{font-size:clamp(1.9rem,4vw,2.8rem);line-height:1.08;letter-spacing:-.04em;margin:0 0 10px;font-weight:900}
      .hero-sub{color:var(--txt-soft);line-height:1.7;font-size:.98rem;max-width:760px}
      .hero-tags{margin-top:18px;display:flex;gap:10px;flex-wrap:wrap}
      .pill{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:var(--bg-elev);border:1px solid var(--bd);color:var(--txt-soft);font-size:.84rem;font-weight:700}
      .top-actions{display:flex;flex-direction:column;justify-content:space-between;gap:16px}
      .quick-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
      .quick-card{background:var(--bg-elev);border:1px solid var(--bd);border-radius:18px;padding:16px;min-height:92px;display:flex;flex-direction:column;justify-content:space-between}
      .quick-label{color:var(--txt-sub);font-size:.82rem;font-weight:700;letter-spacing:.03em}
      .quick-value{font-size:1.76rem;font-weight:900;line-height:1}
      .action-row{display:flex;gap:12px;flex-wrap:wrap;justify-content:flex-end;align-items:center}
      .action-btn{appearance:none;border:none;text-decoration:none;cursor:pointer;padding:11px 15px;border-radius:14px;font-weight:800;font-size:.92rem;transition:.18s ease;display:inline-flex;align-items:center;justify-content:center;gap:8px;box-shadow:var(--shadow-soft)}
      .action-btn:hover{transform:translateY(-1px)}
      .action-primary{background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff}
      .action-soft{background:var(--bg-elev);color:var(--txt);border:1px solid var(--bd)}
      .action-danger{background:rgba(248,113,113,.14);color:var(--red);border:1px solid rgba(248,113,113,.18)}
      .toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;background:var(--bg-card-soft);border:1px solid var(--bd);border-radius:20px;backdrop-filter:blur(12px);box-shadow:var(--shadow-soft);margin-bottom:20px;flex-wrap:wrap}
      .toolbar-left,.toolbar-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .tbtn{text-decoration:none;color:var(--txt);background:var(--bg-elev);border:1px solid var(--bd);padding:10px 14px;border-radius:12px;font-size:.9rem;font-weight:800;transition:.16s ease}
      .tbtn:hover,.tbtn.active{background:rgba(56,189,248,.14);border-color:rgba(56,189,248,.24);color:#7dd3fc}
      .date-chip{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:14px;border:1px solid var(--bd);background:var(--bg-elev);position:relative;overflow:hidden}
      .date-chip strong{font-family:monospace;font-size:1rem;letter-spacing:.02em}
      .date-chip input[type="date"]{position:absolute;inset:0;opacity:0;cursor:pointer}
      .grid-main{display:grid;grid-template-columns:1fr;gap:20px}
      .panel{background:var(--bg-card);border:1px solid var(--bd);border-radius:24px;backdrop-filter:blur(14px);box-shadow:var(--shadow);padding:20px}
      .panel-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap}
      .panel-title{margin:0;font-size:1rem;letter-spacing:.04em;text-transform:uppercase;color:#7dd3fc;font-weight:900}
      .panel-sub{color:var(--txt-sub);font-size:.86rem}
      .stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
      .stat-card{border-radius:20px;border:1px solid var(--bd);background:linear-gradient(180deg,var(--bg-elev),rgba(255,255,255,.02));padding:18px;cursor:pointer;transition:.16s ease;min-height:166px}
      .stat-card:hover{transform:translateY(-2px);border-color:rgba(56,189,248,.24);box-shadow:0 10px 24px rgba(2,6,23,.12)}
      .stat-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
      .stat-title-wrap{display:flex;align-items:center;gap:12px;min-width:0;flex:1}
      .stat-emoji{width:42px;height:42px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);border:1px solid var(--bd);flex-shrink:0;font-size:1.3rem}
      .stat-title{font-size:1rem;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .stat-pct{flex-shrink:0;padding:6px 10px;border-radius:999px;background:rgba(56,189,248,.12);color:#7dd3fc;font-weight:900;font-size:.82rem;border:1px solid rgba(56,189,248,.16)}
      .stat-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
      .metric{background:rgba(255,255,255,.02);border:1px solid var(--bd);border-radius:14px;padding:12px 10px;text-align:center}
      .metric-label{display:block;font-size:.74rem;color:var(--txt-sub);margin-bottom:5px;font-weight:700}
      .metric-value{font-size:1.05rem;font-weight:900;color:var(--txt)}
      .metric-gold{color:var(--gold)} .metric-blue{color:var(--blue)}
      .progress{height:8px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden;margin-bottom:12px}
      .progress div{height:100%;border-radius:999px;background:linear-gradient(90deg,#fbbf24,#38bdf8,#8b5cf6)}
      .stat-foot{color:var(--txt-sub);font-size:.82rem;font-family:monospace;text-align:right}
      .mini-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
      .mini-card{background:linear-gradient(180deg,var(--bg-elev),rgba(255,255,255,.02));border:1px solid var(--bd);border-radius:18px;padding:14px;cursor:pointer;transition:.16s ease}
      .mini-card:hover{transform:translateY(-2px);border-color:rgba(56,189,248,.24)}
      .mini-top{display:flex;align-items:center;gap:8px;justify-content:space-between;margin-bottom:12px}
      .mini-name{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:800}
      .mini-badge{flex-shrink:0;border-radius:999px;padding:4px 8px;background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.16);color:#7dd3fc;font-weight:900;font-size:.78rem}
      .mini-meta{text-align:right;color:var(--txt-sub);font-family:monospace;font-size:.78rem}
      .notice-panel{padding:18px 20px}
      .panel-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;color:#fda4af;font-weight:900}
      .notice-preview{color:var(--txt-soft);line-height:1.8;font-size:.94rem}
      .promo-preview-box{display:flex;gap:16px;align-items:flex-start;padding:14px;border-radius:18px;background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(59,130,246,.06));border:1px solid var(--bd)}
      .promo-preview-badge{min-width:130px;padding:10px 14px;border-radius:999px;text-align:center;background:rgba(255,255,255,.08);border:1px solid var(--bd);font-weight:800;color:#dbeafe}
      .promo-preview-main{flex:1;min-width:0}
      .promo-preview-title{font-weight:900;margin-bottom:8px}
      .promo-preview-desc{color:var(--txt-soft);line-height:1.75;font-size:.93rem}
      .promo-preview-desc p{margin:0 0 8px}.promo-preview-desc p:last-child{margin-bottom:0}
      .promo-preview-desc ul{margin:4px 0 0 18px;padding:0}.promo-preview-desc li{margin:4px 0}
      .promo-preview-desc code{padding:2px 6px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid var(--bd)}
      .promo-preview-desc a{color:#93c5fd}
      .account-promo-preview-box{background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(16,185,129,.08))}
      .account-preview-badge{color:#d1fae5;background:linear-gradient(135deg,rgba(16,185,129,.24),rgba(59,130,246,.14));border:1px solid rgba(167,243,208,.18)}
      .account-preview-desc h1,.account-preview-desc h2,.account-preview-desc h3{margin:0 0 8px;line-height:1.35}
      .account-preview-desc p{margin:0 0 8px}.account-preview-desc p:last-child{margin-bottom:0}
      .account-preview-desc ul{margin:4px 0 0 18px;padding:0}.account-preview-desc li{margin:4px 0}
      .account-preview-desc code{padding:2px 6px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid var(--bd)}
      .account-preview-desc a{color:#93c5fd}.account-preview-desc .ad-badge{display:none!important}
      .account-preview-desc .ad-btn{display:inline-flex;align-items:center;justify-content:center;margin-top:8px;padding:9px 12px;border-radius:10px;text-decoration:none;color:#fff;font-weight:800;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border:1px solid rgba(255,255,255,.12)}
      .mask{position:fixed;inset:0;background:rgba(2,6,23,.44);z-index:140;opacity:0;pointer-events:none;transition:.16s ease}
      .mask.show{opacity:1;pointer-events:auto}
      .drawer{position:fixed;top:0;right:-440px;width:400px;max-width:100vw;height:100vh;z-index:150;transition:.18s ease;background:var(--bg-card);border-left:1px solid var(--bd);backdrop-filter:blur(14px);box-shadow:-12px 0 24px rgba(2,6,23,.16);display:flex;flex-direction:column}
      .drawer.open{right:0}
      .drawer-head{padding:18px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;gap:12px}
      .drawer-title{margin:0;font-size:1.05rem;font-weight:900}
      .icon-btn{width:36px;height:36px;border:none;border-radius:12px;cursor:pointer;background:var(--bg-elev);color:var(--txt);border:1px solid var(--bd);font-size:1.1rem}
      .log-list{flex:1;overflow:auto;padding:14px;margin:0;list-style:none;display:flex;flex-direction:column;gap:10px}
      .log-item{padding:14px;border-radius:16px;border:1px solid var(--bd);background:rgba(255,255,255,.02)}
      .log-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
      .log-index{color:#7dd3fc;font-weight:900}.log-time{color:var(--txt);font-size:.86rem}
      .log-meta{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-family:monospace;color:var(--txt-sub);font-size:.76rem}
      .fs-modal{position:fixed;inset:0;background:rgba(2,6,23,.58);z-index:160;display:none;overflow:auto}
      .fs-modal.open{display:block}
      .settings-wrap{width:min(1180px,calc(100% - 24px));margin:18px auto;background:var(--bg-card);border:1px solid var(--bd);border-radius:28px;box-shadow:var(--shadow);overflow:hidden}
      .settings-head{padding:20px 22px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;position:sticky;top:0;background:var(--bg-card);z-index:2}
      .settings-title{margin:0;font-size:1.22rem;font-weight:900}
      .settings-sub{color:var(--txt-sub);font-size:.9rem;margin-top:6px}
      .settings-actions{display:flex;gap:10px;flex-wrap:wrap}
      .settings-body{padding:22px}
      .settings-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
      .full{grid-column:1 / -1}
      .field{background:rgba(255,255,255,.02);border:1px solid var(--bd);border-radius:18px;padding:16px}
      .field label{display:block;font-size:.88rem;color:var(--txt-sub);margin-bottom:10px;font-weight:800}
      .field small{display:block;color:var(--txt-sub);font-size:.78rem;margin-top:8px;line-height:1.6}
      .field input,.field textarea,.field select{width:100%;border-radius:14px;border:1px solid var(--bd-strong);background:rgba(2,6,23,.18);color:var(--txt);padding:14px;font-size:.95rem;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;outline:none;transition:.16s ease}
      .light-theme .field input,.light-theme .field textarea,.light-theme .field select{background:#fff}
      .field input:focus,.field textarea:focus,.field select:focus{border-color:rgba(56,189,248,.42);box-shadow:0 0 0 4px rgba(56,189,248,.10)}
      .field textarea{min-height:130px;resize:vertical;line-height:1.55;white-space:pre}
      .field textarea.code{min-height:250px}
      .field-tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
      .mini-btn{appearance:none;border:none;cursor:pointer;padding:8px 12px;border-radius:12px;font-weight:800;font-size:.82rem;background:var(--bg-elev);color:var(--txt);border:1px solid var(--bd);transition:.16s ease}
      .mini-btn:hover{background:rgba(56,189,248,.12);border-color:rgba(56,189,248,.22);color:#7dd3fc}
      .switch-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .switch{position:relative;width:52px;height:30px;display:inline-block}
      .switch input{display:none}
      .slider{position:absolute;inset:0;background:rgba(255,255,255,.10);border:1px solid var(--bd);border-radius:999px;transition:.18s ease}
      .slider:before{content:'';position:absolute;width:22px;height:22px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.18s ease;box-shadow:0 2px 8px rgba(0,0,0,.18)}
      .switch input:checked + .slider{background:rgba(56,189,248,.26);border-color:rgba(56,189,248,.28)}
      .switch input:checked + .slider:before{transform:translateX(22px)}
      @media (max-width:1024px){.topbar{grid-template-columns:1fr}}
      @media (max-width:768px){
        body{padding:16px}
        .quick-stats{grid-template-columns:1fr}
        .action-row{justify-content:flex-start}
        .toolbar{padding:14px}
        .stats-grid,.settings-grid{grid-template-columns:1fr}
        .drawer{width:100%;right:-100%}
        .settings-wrap{width:calc(100% - 10px);margin:5px auto;border-radius:20px}
        .settings-head,.settings-body{padding:16px}
        .promo-preview-box{flex-direction:column}
        .promo-preview-badge{min-width:auto;width:fit-content}
      }
    </style></head><body>
      <button class="theme-toggle" onclick="toggleAdminTheme()" title="切换主题">☀️</button>
      <div class="admin-shell">
        <section class="topbar">
          <div>
            <h1 class="hero-title">📊 数据看板</h1>
            <div class="hero-sub">当前查看维度：<strong style="color:var(--txt)">${this.escapeHtml(m)}</strong>。你可以在这里查看精选资源与友链的点击情况、快速预览公告与推广卡内容，并直接进入系统配置面板修改站点设置。</div>
            <div class="hero-tags">
              <span class="pill">🧭 路径：${this.escapeHtml(this.ADMIN_PATH)}</span>
              <span class="pill">🕒 时间：${this.escapeHtml(this.time.fullStr)}</span>
              <span class="pill">📦 历史总计：${historyTotal}</span>
            </div>
          </div>
          <div class="top-actions">
            <div class="quick-stats">
              <div class="quick-card"><div class="quick-label">总项目</div><div class="quick-value">${safeLinks.length}</div></div>
              <div class="quick-card"><div class="quick-label">本月总点击</div><div class="quick-value" style="color:var(--blue)">${monthTotalClicks}</div></div>
              <div class="quick-card"><div class="quick-label">活跃项目</div><div class="quick-value">${Array.from(statsMap.values()).filter(c => c.total_clicks > 0).length}</div></div>
            </div>
            <div class="action-row">
              <a href="/" class="action-btn action-soft">🏠 返回主页</a>
              <button type="button" class="action-btn action-primary" onclick="openSettings()">⚙️ 系统设置</button>
              <a href="${this.ADMIN_PATH}/logout" class="action-btn action-danger">登出</a>
            </div>
          </div>
        </section>

        <section class="toolbar">
          <div class="toolbar-left">
            <a href="${this.ADMIN_PATH}?m=${prevMonthStr}" class="tbtn" title="上个月">⏪ 上月</a>
            <a href="${this.ADMIN_PATH}?m=${prevDay}" class="tbtn">◀ 上一项</a>
            <div class="date-chip" title="点击切换日期">
              <span>📅</span>
              <strong>${this.escapeHtml(m)}</strong>
              <input type="date" value="${isDayMode ? this.escapeAttr(m) : ''}" onchange="if(this.value) location.href='${this.ADMIN_PATH}?m='+this.value">
            </div>
            <a href="${this.ADMIN_PATH}?m=${nextDay}" class="tbtn">下一项 ▶</a>
            <a href="${this.ADMIN_PATH}?m=${nextMonthStr}" class="tbtn" title="下个月">下月 ⏩</a>
          </div>
          <div class="toolbar-right">
            <a href="${this.ADMIN_PATH}?m=${this.time.todayStr}" class="tbtn ${m===this.time.todayStr?'active':''}">今日</a>
            <a href="${this.ADMIN_PATH}?m=${this.time.dateKey}" class="tbtn ${m===this.time.dateKey?'active':''}">本月</a>
          </div>
        </section>

        <div class="grid-main">
          ${noticeHtmlPreview}
          ${promoPreview}
          ${accountPreview}

          <section class="panel">
            <div class="panel-header"><div><h3 class="panel-title">💎 精选数据</h3><div class="panel-sub">点击任意卡片可查看访问记录详情</div></div></div>
            <div class="stats-grid">${linkHtml}</div>
          </section>

          <section class="panel">
            <div class="panel-header"><div><h3 class="panel-title">🔗 友链数据</h3><div class="panel-sub">简要查看友链表现</div></div></div>
            <div class="mini-grid">${friendHtml}</div>
          </section>
        </div>
      </div>

      <div class="mask" id="mask" onclick="cls()"></div>

      <aside class="drawer" id="dr">
        <div class="drawer-head">
          <h3 class="drawer-title" id="dt">点击记录</h3>
          <button type="button" class="icon-btn" onclick="cls()">×</button>
        </div>
        <ul class="log-list" id="dl"></ul>
      </aside>

      <div class="fs-modal" id="set-fs">
        <div class="settings-wrap">
          <div class="settings-head">
            <div>
              <h3 class="settings-title">⚙️ 系统全局配置</h3>
              <div class="settings-sub">支持 JSON 自动格式化、示例模板填充、推广卡 HTML / Markdown 内容配置、账号推广卡配置。</div>
            </div>
            <div class="settings-actions">
              <button type="button" class="action-btn action-soft" onclick="cls()">取消 (Esc)</button>
              <button type="button" class="action-btn action-primary" onclick="saveSettings(this)">💾 保存并生效</button>
            </div>
          </div>

          <div class="settings-body">
            <div class="settings-grid">
              <div class="field"><label>后台登录密码</label><input type="text" id="s_pass" placeholder="默认: 123456"></div>
              <div class="field"><label>网站主标题</label><input type="text" id="s_title"></div>
              <div class="field"><label>网站副标题</label><input type="text" id="s_sub"></div>
              <div class="field"><label>客服支持链接</label><input type="text" id="s_tg" placeholder="例如 Telegram / 工单地址"></div>

              <div class="field full">
                <label>背景图 URL（多图用逗号隔开，支持 Base64）</label>
                <input type="text" id="s_img" placeholder="留空使用默认高清壁纸">
                <small>建议使用可公开访问、跨浏览器兼容的图片地址。如果图床开启防盗链，部分浏览器会回退到默认背景。</small>
              </div>

              <div class="field"><label>联系邮箱</label><input type="text" id="s_mail" placeholder="留空则不显示底部邮箱按钮"></div>
              <div class="field"><label>留言板推送 Webhook</label><input type="text" id="s_push" placeholder="留空则不显示留言按钮"></div>

              <div class="field full"><label>温馨提示公告（支持 HTML，清空则隐藏）</label><textarea id="s_notice"></textarea></div>

              <div class="field full">
                <label>推广卡开关 / 配置（首页中部）</label>
                <div class="switch-row" style="margin-bottom:12px;">
                  <label class="switch"><input type="checkbox" id="s_promo_enable"><span class="slider"></span></label>
                  <span style="color:var(--txt-sub);font-weight:700;">启用首页推广卡</span>
                </div>
                <div class="settings-grid">
                  <div class="field"><label>推广卡徽标文字</label><input type="text" id="s_promo_badge" placeholder="如：免费域名可托管 CF"></div>
                  <div class="field"><label>推广卡标题</label><input type="text" id="s_promo_title" placeholder="如：本站域名服务由 ... 提供支持"></div>
                  <div class="field"><label>推广卡跳转链接</label><input type="text" id="s_promo_url" placeholder="https://..."></div>
                  <div class="field"><label>推广卡内容格式</label><select id="s_promo_format"><option value="markdown">Markdown</option><option value="html">HTML</option></select></div>
                </div>
                <div style="margin-top:16px;">
                  <label style="display:block;margin-bottom:10px;font-size:.88rem;color:var(--txt-sub);font-weight:800;">推广卡描述内容</label>
                  <textarea id="s_promo_desc" style="min-height:150px"></textarea>
                  <small>支持 Markdown 或 HTML。Markdown 支持标题、加粗、斜体、列表、链接、行内代码等基础语法。</small>
                </div>
              </div>

              <div class="field full">
                <label>账号推广卡开关 / 配置（首页中部）</label>
                <div class="switch-row" style="margin-bottom:12px;">
                  <label class="switch"><input type="checkbox" id="s_account_enable"><span class="slider"></span></label>
                  <span style="color:var(--txt-sub);font-weight:700;">启用首页账号推广卡</span>
                </div>
                <div class="settings-grid">
                  <div class="field"><label>内容格式</label><select id="s_account_format"><option value="markdown">Markdown</option><option value="html">HTML</option></select></div>
                  <div class="field">
                    <label>快捷填充</label>
                    <div class="field-tools" style="margin-bottom:0;">
                      <button type="button" class="mini-btn" onclick="fillAccountMarkdownExample()">填入 Markdown 示例</button>
                      <button type="button" class="mini-btn" onclick="fillAccountHtmlExample()">填入 HTML 示例</button>
                    </div>
                    <small>推荐优先使用 Markdown。想做按钮、自定义结构时用 HTML。</small>
                  </div>
                </div>
                <div style="margin-top:16px;">
                  <label style="display:block;margin-bottom:10px;font-size:.88rem;color:var(--txt-sub);font-weight:800;">推广卡内容</label>
                  <textarea id="s_account_content" class="code" style="min-height:220px" placeholder="可直接粘贴 Markdown 或 HTML 片段"></textarea>
                  <small>内容会直接渲染到首页中部账号推广卡。HTML 模式下请只粘贴你自己信任的代码，不要放 script。</small>
                </div>
              </div>

              <div class="field full"><label>自定义卡片跳转域名</label><input type="text" id="s_host" placeholder="如果不填，默认自动使用当前访问域名"></div>

              <div class="field full">
                <label>💎 精选资源 LINKS（JSON 格式）</label>
                <div class="field-tools">
                  <button type="button" class="mini-btn" onclick="formatJsonField('s_links')">自动格式化</button>
                  <button type="button" class="mini-btn" onclick="fillLinksExample()">填入示例模板</button>
                </div>
                <textarea id="s_links" class="code"></textarea>
              </div>

              <div class="field full">
                <label>🔗 合作伙伴 FRIENDS（JSON 格式）</label>
                <div class="field-tools">
                  <button type="button" class="mini-btn" onclick="formatJsonField('s_friends')">自动格式化</button>
                  <button type="button" class="mini-btn" onclick="fillFriendsExample()">填入示例模板</button>
                </div>
                <textarea id="s_friends" class="code"></textarea>
              </div>
            </div>
          </div>
        </div>
      </div>

      ${this.render_BgRuntimeScript()}

      <script>
        const ADMIN_PATH='${this.ADMIN_PATH}';
        const SYS_SET=${this.safeScriptJson(sysSettings)};
        const LINKS_EXAMPLE=[{id:"google",name:"Google 搜索",url:"https://www.google.com",backup_url:"https://www.google.com.hk",emoji:"🔎",note:"全球常用搜索引擎",tag:"推荐"},{id:"github",name:"GitHub",url:"https://github.com",emoji:"💻",note:"代码托管与开源社区"}];
        const FRIENDS_EXAMPLE=[{id:"friend_1",name:"示例友链站点",url:"https://example.com"},{id:"friend_2",name:"另一个合作伙伴",url:"https://example.org"}];
        const ACCOUNT_MD_EXAMPLE='Google / Apple 外区 ID / Telegram / Instagram / X\\n\\n多种类型可选 · 快速处理 · 自动发货\\n\\n[👉 立即进入购买通道](https://tgsss.com/9EB6941B)';
        const ACCOUNT_HTML_EXAMPLE='<p><strong>Google / Apple 外区 ID / Telegram / Instagram / X</strong></p>\\n<p>多种类型可选 · 快速处理 · 自动发货</p>\\n<p><a href="https://tgsss.com/9EB6941B" target="_blank" rel="noopener noreferrer">👉 立即进入购买通道</a></p>';

        function initAdminTheme(){
          const btn=document.querySelector('.theme-toggle');
          if(!btn) return;
          if(localStorage.getItem('admin_theme')==='light'){document.body.classList.add('light-theme');btn.textContent='🌙';}
          else btn.textContent='☀️';
        }
        initAdminTheme();

        function toggleAdminTheme(){
          const btn=document.querySelector('.theme-toggle');
          document.body.classList.toggle('light-theme');
          const isLight=document.body.classList.contains('light-theme');
          localStorage.setItem('admin_theme',isLight?'light':'dark');
          if(btn) btn.textContent=isLight?'🌙':'☀️';
        }

        async function openLog(id,m,n){
          const dr=document.getElementById('dr');
          const mask=document.getElementById('mask');
          const l=document.getElementById('dl');
          dr.classList.add('open');
          mask.classList.add('show');
          document.getElementById('dt').innerText=decodeURIComponent(n||'')+' · 点击记录';
          l.innerHTML='<li style="padding:20px;text-align:center;color:var(--txt-sub)">加载中...</li>';
          try{
            const r=await fetch(ADMIN_PATH+'/api/logs?id='+encodeURIComponent(id)+'&m='+encodeURIComponent(m));
            const data=await r.json();
            if(!data.length){l.innerHTML='<li style="padding:20px;text-align:center;opacity:.6;color:var(--txt-sub)">该时段无记录</li>';return;}
            let html='';
            for(let i=0;i<data.length;i++){
              const x=data[i];
              html+='<li class="log-item"><div class="log-row"><span class="log-index">#'+(i+1)+'</span><span class="log-time">'+(x.click_time||'')+'</span></div><div class="log-meta"><span>'+(x.ip_address||'unknown')+'</span><span>'+(((x.user_agent||'').slice(0,46))||'unknown')+'</span></div></li>';
            }
            l.innerHTML=html;
          }catch(e){
            l.innerHTML='<li style="padding:20px;text-align:center;color:#f87171">加载失败</li>';
          }
        }

        function openSettings(){
          document.getElementById('s_pass').value=SYS_SET.admin_pass||'';
          document.getElementById('s_title').value=SYS_SET.title||'';
          document.getElementById('s_sub').value=SYS_SET.subtitle||'';
          document.getElementById('s_img').value=SYS_SET.img||'';
          document.getElementById('s_tg').value=SYS_SET.contact_url||'';
          document.getElementById('s_mail').value=SYS_SET.mail||'';
          document.getElementById('s_push').value=SYS_SET.push||'';
          document.getElementById('s_host').value=SYS_SET.host||'';
          document.getElementById('s_notice').value=SYS_SET.notice||'';
          document.getElementById('s_promo_enable').checked=String(SYS_SET.promo_enable||'0')==='1';
          document.getElementById('s_promo_badge').value=SYS_SET.promo_badge||'';
          document.getElementById('s_promo_title').value=SYS_SET.promo_title||'';
          document.getElementById('s_promo_desc').value=SYS_SET.promo_desc||'';
          document.getElementById('s_promo_url').value=SYS_SET.promo_url||'';
          document.getElementById('s_promo_format').value=SYS_SET.promo_format||'markdown';
          document.getElementById('s_account_enable').checked=String(SYS_SET.account_enable||'0')==='1';
          document.getElementById('s_account_format').value=SYS_SET.account_format||'markdown';
          document.getElementById('s_account_content').value=SYS_SET.account_content||'';
          document.getElementById('s_links').value=SYS_SET.links||'[]';
          document.getElementById('s_friends').value=SYS_SET.friends||'[]';
          document.getElementById('set-fs').classList.add('open');
          document.getElementById('mask').classList.add('show');
          document.body.style.overflow='hidden';
        }

        function formatJsonField(id){
          const el=document.getElementById(id);
          try{el.value=JSON.stringify(JSON.parse(el.value),null,2);alert('✅ 已自动格式化');}
          catch(e){alert('⚠️ JSON 格式有误，无法格式化');}
        }
        function fillLinksExample(){
          const el=document.getElementById('s_links');
          if(el.value.trim()&&!confirm('当前 LINKS 内容不为空，确定要用示例模板覆盖吗？')) return;
          el.value=JSON.stringify(LINKS_EXAMPLE,null,2);
        }
        function fillFriendsExample(){
          const el=document.getElementById('s_friends');
          if(el.value.trim()&&!confirm('当前 FRIENDS 内容不为空，确定要用示例模板覆盖吗？')) return;
          el.value=JSON.stringify(FRIENDS_EXAMPLE,null,2);
        }
        function fillAccountMarkdownExample(){
            const el=document.getElementById('s_account_content');
            if(el.value.trim()&&!confirm('当前账号推广卡内容不为空，确定要用 Markdown 示例覆盖吗？')) return;
            document.getElementById('s_account_format').value='markdown';
            el.value=ACCOUNT_MD_EXAMPLE;
          }
        function fillAccountHtmlExample(){
          const el=document.getElementById('s_account_content');
          if(el.value.trim()&&!confirm('当前账号推广卡内容不为空，确定要用 HTML 示例覆盖吗？')) return;
          document.getElementById('s_account_format').value='html';
          el.value=ACCOUNT_HTML_EXAMPLE;
        }

        async function saveSettings(btn){
          try{
            JSON.parse(document.getElementById('s_links').value);
            JSON.parse(document.getElementById('s_friends').value);
          }catch(e){
            alert('⚠️ JSON 格式解析错误！请检查是否有遗漏的逗号、引号或括号。');
            return;
          }
          const data={
            admin_pass:document.getElementById('s_pass').value,
            title:document.getElementById('s_title').value,
            subtitle:document.getElementById('s_sub').value,
            img:document.getElementById('s_img').value,
            contact_url:document.getElementById('s_tg').value,
            mail:document.getElementById('s_mail').value,
            push:document.getElementById('s_push').value,
            host:document.getElementById('s_host').value,
            notice:document.getElementById('s_notice').value,
            promo_enable:document.getElementById('s_promo_enable').checked?'1':'0',
            promo_badge:document.getElementById('s_promo_badge').value,
            promo_title:document.getElementById('s_promo_title').value,
            promo_desc:document.getElementById('s_promo_desc').value,
            promo_url:document.getElementById('s_promo_url').value,
            promo_format:document.getElementById('s_promo_format').value,
            account_enable:document.getElementById('s_account_enable').checked?'1':'0',
            account_format:document.getElementById('s_account_format').value,
            account_content:document.getElementById('s_account_content').value,
            links:document.getElementById('s_links').value,
            friends:document.getElementById('s_friends').value
          };

          const originalText=btn.innerText;
          btn.innerText='保存中...';
          btn.disabled=true;

          try{
            const res=await fetch(ADMIN_PATH+'/api/settings',{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify(data)
            });
            if(res.ok){
              alert('✅ 配置已保存并生效！');
              location.reload();
            }else{
              alert('❌ 保存失败：'+await res.text());
            }
          }catch(e){
            alert('❌ 网络错误');
          }

          btn.innerText=originalText;
          btn.disabled=false;
        }

        function cls(){
          document.getElementById('dr').classList.remove('open');
          document.getElementById('set-fs').classList.remove('open');
          document.getElementById('mask').classList.remove('show');
          document.body.style.overflow='';
        }

        document.addEventListener('keydown',e=>{
          if(e.key==='Escape') cls();
        });
      </script>
    </body></html>`;
  }
}
