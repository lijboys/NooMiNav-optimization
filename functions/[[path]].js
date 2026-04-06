// ============================================================================
// NooMiNav V13.1 UI Refresh
// 双擎驱动适配器：支持 Cloudflare Workers 和 Pages
// ============================================================================
export default { async fetch(request, env, ctx) { const app = new NooMiNav(request, env, ctx); return app.handle(); } };
export async function onRequest(context) { const app = new NooMiNav(context.request, context.env, context); return app.handle(); }

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

        const now = new Date(new Date().getTime() + 8 * 3600000);
        this.time = {
            now: now,
            year: now.getFullYear().toString(),
            month: (now.getMonth() + 1).toString().padStart(2, '0'),
            todayStr: now.toISOString().split('T')[0],
            fullStr: now.toISOString().replace('T', ' ').substring(0, 19),
            dateKey: `${now.getFullYear()}_${(now.getMonth() + 1).toString().padStart(2, '0')}`
        };
    }

    // ------------------------------------------------------------------------
    // [模块 1] 初始化配置加载
    // ------------------------------------------------------------------------
    async initConfig() {
        this.dbSettings = {};
        if (this.env.db) {
            try {
                const res = await this.env.db.prepare("SELECT * FROM settings").all();
                res.results.forEach(r => this.dbSettings[r.key] = r.value);
            } catch (e) {
                if (e.message.includes("no such table")) {
                    try { await this.env.db.prepare("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)").run(); } catch (err) {}
                }
            }
        }

        this.ADMIN_PATH = '/' + (this.env.admin || 'admin').replace(/^\//, '');
        this.config = {
            admin_pass: this.dbSettings.admin_pass || "123456",
            title: this.dbSettings.title || this.env.TITLE || "云端加速 · 精选导航",
            subtitle: this.dbSettings.subtitle || this.env.SUBTITLE || "优质资源推荐 · 随时畅联",
            contact_url: this.dbSettings.contact_url || this.env.CONTACT_URL || "",
            mail: this.dbSettings.mail !== undefined ? this.dbSettings.mail : (this.env.mail || ""),
            push: this.dbSettings.push !== undefined ? this.dbSettings.push : (this.env.push || ""),
            host: (this.dbSettings.host || this.env.host || this.url.origin).replace(/\/$/, ''),
            notice: this.dbSettings.notice !== undefined
                ? this.dbSettings.notice
                : (this.env.notice || "<div style=\"margin-bottom:8px\">🎉 欢迎使用 FlarePortal 极简导航！</div><div class=\"notice-sub\">您可以在后台「系统设置」中修改此处的公告内容，支持 HTML 标签。如果清空内容，公告板将自动隐藏。</div>")
        };

        if (this.config.push && !this.config.push.endsWith('/contact')) {
            this.config.push = this.config.push.replace(/\/$/, '') + '/contact';
        }

        this.config.img = this.DEFAULT_IMG;
        const imgSource = this.dbSettings.img || this.env.img;
        if (imgSource) {
            const imgStr = imgSource.trim();
            if (imgStr.startsWith('data:')) {
                this.config.img = imgStr;
            } else {
                const list = imgStr.split(',').map(s => s.trim()).filter(s => s);
                if (list.length > 0) {
                    const dayIndex = Math.floor((this.time.now.getTime()) / 86400000);
                    this.config.img = list[dayIndex % list.length];
                }
            }
        }
    }

    loadJsonData() {
        const getJsonEnv = (k) => { try { return this.env[k] ? JSON.parse(this.env[k]) : []; } catch (e) { return []; } };
        this.LINKS_DATA = this.dbSettings.links ? JSON.parse(this.dbSettings.links) : getJsonEnv('LINKS');
        this.FRIENDS_DATA = this.dbSettings.friends ? JSON.parse(this.dbSettings.friends) : getJsonEnv('FRIENDS');
    }

    // ------------------------------------------------------------------------
    // [模块 2] 路由
    // ------------------------------------------------------------------------
    async handle() {
        await this.initConfig();
        const path = this.url.pathname;

        if (path === '/message') return this.route_MessageDetail();
        if (path === '/contact') return this.route_Contact();
        if (path === `${this.ADMIN_PATH}/api/logs`) return this.api_GetLogs();
        if (path === `${this.ADMIN_PATH}/api/settings`) return this.api_SaveSettings();
        if (path === `${this.ADMIN_PATH}/logout`) return this.route_AdminLogout();
        if (path === this.ADMIN_PATH) return this.route_AdminPage();

        if (path.startsWith('/go/') || path.startsWith('/fgo/')) {
            this.loadJsonData();
            return this.route_Redirect(path);
        }

        this.loadJsonData();
        return this.route_HomePage();
    }

    // ------------------------------------------------------------------------
    // [模块 3] 路由控制器
    // ------------------------------------------------------------------------
    async route_Redirect(path) {
        const parts = path.split("/").filter(Boolean);
        if (parts.length < 2) return new Response('Invalid URL', { status: 400 });

        const type = parts[0] === 'go' ? 'link' : 'friend';
        const id = parts[1];
        const isBackup = parts[2] === "backup";

        const dataSet = type === 'link' ? this.LINKS_DATA : this.FRIENDS_DATA;
        const item = dataSet.find(l => l.id === id);

        if (!item) return new Response('Target not found', { status: 404 });

        let targetUrl = item.url;
        let logName = item.name;

        if (type === 'link' && isBackup && item.backup_url) {
            targetUrl = item.backup_url;
            logName += "(备用)";
        }

        if (!targetUrl) return new Response('No valid URL available', { status: 400 });

        if (this.env.db) {
            this.ctx.waitUntil(this.db_recordClick(isBackup ? `${id}_backup` : id, logName, type));
        }

        return Response.redirect(targetUrl, 302);
    }

    route_MessageDetail() {
        const dataStr = this.url.searchParams.get('d');
        let msgData = { c: '未知', m: '内容解析失败或已损坏', t: this.time.fullStr };
        if (dataStr) { try { msgData = JSON.parse(decodeURIComponent(atob(dataStr))); } catch (e) {} }
        return new Response(this.render_MessageDetail(msgData), { headers: { "content-type": "text/html;charset=UTF-8" } });
    }

    async route_Contact() {
        if (this.request.method === 'GET') {
            return new Response(this.render_ContactPage(), { headers: { "content-type": "text/html;charset=UTF-8" } });
        }
        if (this.request.method === 'POST') {
            try {
                const formData = await this.request.formData();
                const contactInfo = formData.get('guest_contact') || '匿名访客';
                const messageContent = formData.get('message') || '无内容';

                if (!this.config.push) return new Response('⚠️ 站长尚未配置接收通道', { status: 500 });

                const payload = JSON.stringify({ c: contactInfo, m: messageContent, t: this.time.fullStr });
                const detailUrl = `${this.config.host}/message?d=${btoa(encodeURIComponent(payload))}`;
                const shortMsg = messageContent.length > 60 ? messageContent.substring(0, 60) + '...' : messageContent;

                await fetch(this.config.push, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: `💬 导航站留言: ${contactInfo}`,
                        content: `时间: ${this.time.fullStr}\n内容: ${shortMsg}\n\n👉 点击卡片查看完整详情`,
                        url: detailUrl
                    })
                });
                return new Response('✅ 发送成功！站长已收到你的留言', { status: 200 });
            } catch (e) {
                return new Response('❌ 发送失败，请稍后重试', { status: 500 });
            }
        }
    }

    route_HomePage() {
        return new Response(this.render_HomePage(), { headers: { "content-type": "text/html;charset=UTF-8" } });
    }

    async route_AdminPage() {
        const cookie = this.request.headers.get('Cookie') || '';

        if (this.request.method === 'POST') {
            const formData = await this.request.formData();
            const password = formData.get('password') || '';
            if (password.length > 100) {
                return new Response(this.render_LoginPage('密码长度异常'), { headers: { "content-type": "text/html;charset=UTF-8" } });
            }
            if (password === this.config.admin_pass) {
                return new Response(null, {
                    status: 302,
                    headers: {
                        'Location': this.ADMIN_PATH,
                        'Set-Cookie': `${this.COOKIE_NAME}=true; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`
                    }
                });
            } else {
                return new Response(this.render_LoginPage('密码错误'), { headers: { "content-type": "text/html;charset=UTF-8" } });
            }
        }

        if (!cookie.includes(`${this.COOKIE_NAME}=true`)) {
            return new Response(this.render_LoginPage(''), { headers: { "content-type": "text/html;charset=UTF-8" } });
        }

        this.loadJsonData();
        const selectedDateOrMonth = this.getSafeParam(this.url.searchParams, 'm', this.time.dateKey);

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
                'Location': this.ADMIN_PATH,
                'Set-Cookie': `${this.COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
            }
        });
    }

    async api_GetLogs() {
        if (this.request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
        const cookie = this.request.headers.get('Cookie') || '';
        if (!cookie.includes(`${this.COOKIE_NAME}=true`)) return new Response('Unauthorized', { status: 401 });

        const id = this.getSafeParam(this.url.searchParams, 'id');
        const m = this.getSafeParam(this.url.searchParams, 'm', this.time.dateKey);

        if (!this.env.db) return new Response('Database not available', { status: 500 });

        try {
            let normalized = m.replace('_', '-').substring(0, 7);
            const queryParam = /^\d{4}-\d{2}$/.test(normalized) ? m.replace('_', '-') : this.time.dateKey.replace('_', '-');
            const { results } = await this.env.db.prepare("SELECT click_time, ip_address, user_agent FROM logs WHERE link_id = ? AND click_time LIKE ? || '%' ORDER BY id DESC LIMIT 50").bind(id, queryParam).all();
            return new Response(JSON.stringify(results || []), { headers: { "content-type": "application/json" } });
        } catch (dbErr) {
            return new Response('Failed to fetch logs', { status: 500 });
        }
    }

    async api_SaveSettings() {
        if (this.request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
        const cookie = this.request.headers.get('Cookie') || '';
        if (!cookie.includes(`${this.COOKIE_NAME}=true`)) return new Response('Unauthorized', { status: 401 });

        try {
            const body = await this.request.json();
            const stmts = Object.keys(body).map(k => this.env.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, String(body[k])));
            await this.env.db.batch(stmts);
            return new Response('OK');
        } catch (e) {
            return new Response('Save failed', { status: 500 });
        }
    }

    // ------------------------------------------------------------------------
    // [模块 4] 数据库
    // ------------------------------------------------------------------------
    async db_recordClick(id, name, type) {
        try {
            const ip = this.request.headers.get('CF-Connecting-IP') || 'unknown';
            const userAgent = this.request.headers.get('User-Agent') || 'unknown';
            const { dateKey, fullStr, year, month, todayStr } = this.time;

            await this.env.db.prepare("INSERT INTO logs (link_id, click_time, month_key, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)").bind(id, fullStr, dateKey, ip, userAgent).run();
            await this.env.db.prepare(`INSERT INTO stats (id, name, type, total_clicks, year_clicks, month_clicks, day_clicks, last_year, last_month, last_day, last_time) VALUES (?1, ?2, ?3, 1, 1, 1, 1, ?4, ?5, ?7, ?6) ON CONFLICT(id) DO UPDATE SET total_clicks = total_clicks + 1, year_clicks = CASE WHEN last_year = ?4 THEN year_clicks + 1 ELSE 1 END, month_clicks = CASE WHEN last_month = ?5 THEN month_clicks + 1 ELSE 1 END, day_clicks = CASE WHEN last_day = ?7 THEN day_clicks + 1 ELSE 1 END, last_year = ?4, last_month = ?5, last_day = ?7, last_time = ?6, name = ?2, type = ?3`).bind(id, name, type, year, dateKey, fullStr, todayStr).run();
        } catch (e) {
            console.error("DB Record Error:", e);
        }
    }

    async db_getDashboardData(selectedDateOrMonth) {
        if (!this.env.db) throw new Error('Database not bound');

        const currentMonthKey = selectedDateOrMonth.replace('-', '_').substring(0, 7);
        const queryParam = selectedDateOrMonth.replace('_', '-');
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

        const statsMap = new Map(); if (statsResult?.results) statsResult.results.forEach(r => statsMap.set(r.id, r));
        const dailyMap = new Map(); if (dailyResult?.results) dailyResult.results.forEach(r => dailyMap.set(r.link_id, r.count));
        const periodMap = new Map(); if (periodResult?.results) periodResult.results.forEach(r => periodMap.set(r.link_id, r.count));
        const monthContextMap = new Map(); if (monthContextResult?.results) monthContextResult.results.forEach(r => monthContextMap.set(r.link_id, r.count));
        const monthTotalClicks = monthTotalResult?.results?.[0]?.total || 0;

        return { statsMap, dailyMap, periodMap, monthContextMap, monthTotalClicks, isDayMode };
    }

    getSafeParam(sp, key, def = '') { return sp.get(key)?.trim() || def; }

    // ------------------------------------------------------------------------
    // [模块 5] 渲染
    // ------------------------------------------------------------------------
    render_Head(t) {
        return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title><style>
        :root{
          --glass:rgba(15,23,42,0.58);
          --border:rgba(255,255,255,0.15);
          --text-shadow:0 2px 4px rgba(0,0,0,0.7);
        }
        *{box-sizing:border-box}
        body{
          margin:0;
          min-height:100vh;
          font-family:${this.FONT_STACK};
          color:#fff;
          display:flex;
          justify-content:center;
          align-items:center;
        }
        .glass-panel{
          background:var(--glass);
          backdrop-filter:blur(24px);
          -webkit-backdrop-filter:blur(24px);
          border:1px solid var(--border);
          box-shadow:0 8px 32px rgba(0,0,0,0.2);
          border-radius:20px;
        }
        h1,div,span,a,p,h2,h3,label,button,input,textarea{text-shadow:var(--text-shadow)}
        </style>`;
    }

    safeCssUrl(url) {
        return String(url || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    getBgShellStyle() {
        return `background-color:#0f172a;background-size:cover;background-position:center;background-repeat:no-repeat;`;
    }

    render_BgRuntimeScript() {
        const primary = this.safeCssUrl(this.config.img);
        const fallback = this.safeCssUrl(this.DEFAULT_IMG);
        return `<script>
(function(){
  const body = document.body;
  const primary = '${primary}';
  const fallback = '${fallback}';
  function applyBg(url){
    body.style.backgroundImage = "linear-gradient(rgba(2,6,23,0.32), rgba(2,6,23,0.42)), url('" + url + "')";
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
  }else{
    loadImage(fallback, applyBg);
  }
})();
</script>`;
    }

    render_MessageDetail(data) {
        return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>留言详情</title><style>
        body { font-family: ${this.FONT_STACK}; background: #f3f4f6; margin: 0; padding: 20px; display: flex; justify-content: center; min-height: 100vh; box-sizing: border-box; }
        .ticket-card { background: #ffffff; border-radius: 18px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); width: 100%; max-width: 600px; padding: 40px; margin-top: 5vh; height: fit-content; border-top: 6px solid #8b5cf6; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 25px; }
        .badge { background: #ede9fe; color: #7c3aed; padding: 6px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.5px; }
        .time { color: #94a3b8; font-size: 0.9rem; font-family: monospace; }
        .sender-box { margin-bottom: 25px; }
        .label { font-size: 0.85rem; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 1px; margin-bottom: 5px; }
        .sender { font-size: 1.5rem; color: #0f172a; font-weight: 800; margin: 0; word-break: break-all; }
        .divider { height: 1px; background: #e2e8f0; margin: 25px 0; }
        .message { font-size: 1.1rem; line-height: 1.8; color: #334155; white-space: pre-wrap; word-break: break-word; }
        .footer { margin-top: 40px; text-align: center; color: #cbd5e1; font-size: 0.85rem; }
        @media (max-width: 600px) {
          .ticket-card { padding: 25px; }
          .sender { font-size: 1.2rem; }
          .message { font-size: 1rem; }
        }
        </style></head><body><div class="ticket-card"><div class="header"><span class="badge">INBOX MESSAGE</span><span class="time">${data.t}</span></div><div class="sender-box"><div class="label">Contact / 发件人</div><h2 class="sender">${data.c}</h2></div><div class="divider"></div><div class="label">Message / 内容</div><div class="message">${data.m}</div><div class="footer">🔒 Encrypted transmission powered by Cloudflare</div></div></body></html>`;
    }

    render_ContactPage() {
        return `<!DOCTYPE html><html><head>${this.render_Head(this.config.title)}<style>
        .box { padding: 40px; width: 380px; text-align: left; }
        h2 { font-size: 1.6rem; margin: 0 0 10px 0; display: flex; align-items: center; gap: 8px; }
        p.desc { color: #cbd5e1; font-size: 0.92rem; margin-bottom: 25px; line-height: 1.65; }
        form { display: flex; flex-direction: column; width: 100%; }
        label { font-size: 0.85rem; color: #f1f5f9; margin-bottom: 8px; font-weight: 600; }
        input, textarea {
          width: 100%;
          padding: 14px;
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 14px;
          color: #fff;
          margin-bottom: 20px;
          outline: none;
          transition: 0.3s;
          font-size: 0.95rem;
          box-sizing: border-box;
          font-family: inherit;
        }
        input:focus, textarea:focus {
          border-color: #60a5fa;
          background: rgba(0,0,0,0.5);
          box-shadow: 0 0 0 4px rgba(96,165,250,0.18);
        }
        input::placeholder, textarea::placeholder { color: rgba(255,255,255,0.4); }
        textarea { resize: vertical; min-height: 100px; }
        button {
          width: 100%;
          padding: 16px;
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          color: #fff;
          border: none;
          border-radius: 14px;
          font-weight: 800;
          cursor: pointer;
          font-size: 1rem;
          transition: 0.3s;
          box-shadow: 0 4px 15px rgba(59,130,246,0.3);
        }
        button:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(59,130,246,0.45); }
        button:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }
        .status { margin-top: 15px; font-size: 0.9rem; font-weight: 600; text-align: center; min-height: 20px; }
        .back { text-align: center; margin-top: 20px; }
        .back a { color: #94a3b8; text-decoration: none; font-size: 0.85rem; transition: 0.2s; }
        .back a:hover { color: #fff; }
        </style></head><body style="${this.getBgShellStyle()} display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;"><div class="glass-panel box"><h2>📝 给我留言</h2><p class="desc">有任何问题、疑问？<br>留下联系方式，看到了就会联系，优先邮箱或者QQ。</p><form id="msgForm"><label>留下你的联系方式？</label><input type="text" name="guest_contact" placeholder="邮箱或者QQ" required><label>你想说什么？</label><textarea name="message" placeholder="写下你的留言内容..." required></textarea><button type="submit" id="submitBtn">发送留言</button></form><div id="status" class="status"></div><div class="back"><a href="/">← 返回导航主页</a></div></div>${this.render_BgRuntimeScript()}<script>document.getElementById('msgForm').addEventListener('submit', async (e) => { e.preventDefault(); const btn = document.getElementById('submitBtn'); const status = document.getElementById('status'); btn.disabled = true; btn.innerText = '发送中...'; status.innerText = ''; try { const res = await fetch('/contact', { method: 'POST', body: new FormData(e.target) }); const text = await res.text(); status.style.color = res.ok ? '#34d399' : '#f87171'; status.innerText = text; if(res.ok) e.target.reset(); } catch(err) { status.style.color = '#f87171'; status.innerText = '网络错误，请稍后重试'; } finally { btn.disabled = false; btn.innerText = '发送留言'; } });</script></body></html>`;
    }

    render_LoginPage(errorMsg = '') {
        return `<!DOCTYPE html><html><head>${this.render_Head(this.config.title)}<style>
        .box { padding: 50px 40px; text-align: center; width: 340px; display: flex; flex-direction: column; align-items: center; }
        h1 { font-size: 1.8rem; margin-bottom: 30px; }
        form { width: 100%; display: flex; flex-direction: column; align-items: center; }
        input {
          width: 100%;
          padding: 16px;
          background: rgba(0,0,0,0.25);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 14px;
          color: #fff;
          margin-bottom: 20px;
          outline: none;
          transition: 0.3s;
          font-size: 1rem;
          box-sizing: border-box;
          text-align: center;
        }
        input:focus {
          border-color: #60a5fa;
          background: rgba(0,0,0,0.5);
          transform: scale(1.02);
          box-shadow: 0 0 0 4px rgba(96,165,250,0.18);
        }
        input::placeholder { color: rgba(255,255,255,0.5); }
        button {
          width: 100%;
          padding: 16px;
          background: linear-gradient(135deg,#3b82f6,#8b5cf6);
          color: #fff;
          border: none;
          border-radius: 14px;
          font-weight: 800;
          cursor: pointer;
          font-size: 1rem;
          transition: 0.3s;
          box-shadow: 0 4px 15px rgba(59,130,246,0.25);
        }
        button:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(59,130,246,0.4); }
        .error-msg { color: #f87171; margin-bottom: 15px; font-size: 0.9rem; min-height: 20px; }
        </style></head><body style="${this.getBgShellStyle()} display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;"><div class="glass-panel box"><h1>🔐 管理后台</h1>${errorMsg ? `<div class="error-msg">❌ ${errorMsg}</div>` : ''}<form method="POST" action="${this.ADMIN_PATH}"><input type="password" name="password" placeholder="请输入访问口令" required autofocus><button type="submit">立即登录</button></form></div>${this.render_BgRuntimeScript()}</body></html>`;
    }

    render_HomePage() {
        const safeLinks = Array.isArray(this.LINKS_DATA) ? this.LINKS_DATA : [];
        const safeFriends = Array.isArray(this.FRIENDS_DATA) ? this.FRIENDS_DATA : [];

        const cardsHtml = safeLinks.map(item => {
            const mainUrl = `/go/${item.id}`;
            const backupHtml = item.backup_url ? `<a href="/go/${item.id}/backup" class="tag-backup" title="备用线路">备用</a>` : '';
            const customTagHtml = item.tag ? `<span class="tag-special">${item.tag}</span>` : '';
            return `<div class="glass-card resource-card-wrap"><a href="${mainUrl}" class="resource-main-link"><div class="card-icon">${item.emoji || '🔗'}</div><div class="card-info"><h3 style="display:flex;align-items:center;flex-wrap:wrap;">${item.name}${customTagHtml}</h3><p>⚠️ ${item.note || '无说明'}</p></div></a>${backupHtml}</div>`;
        }).join('');

        const friendsHtml = safeFriends.map((f) => `<a href="/fgo/${f.id}" target="_blank" class="glass-card partner-card">${f.name}</a>`).join('');

        let fabHtml = `<div class="fab-container">`;
        if (this.config.contact_url) fabHtml += `<a href="${this.config.contact_url}" target="_blank" class="fab-btn fab-telegram">💬 获取支持</a>`;
        if (this.config.mail) fabHtml += `<a href="mailto:${this.config.mail}" class="fab-btn fab-mail">📧 发送邮件</a>`;
        if (this.config.push) fabHtml += `<a href="/contact" class="fab-btn fab-push">📝 给我留言</a>`;
        fabHtml += `</div>`;

        let noticeHtml = '';
        if (this.config.notice && this.config.notice.trim() !== '') {
            noticeHtml = `<div class="glass-card notice-card"><div class="notice-title"><span class="heart-beat">❤️</span> 温馨提示</div><div class="notice-content">${this.config.notice}</div></div>`;
        }

        let promoHtml = `
          <a href="https://dash.domain.digitalplat.org/signup?ref=s8ywnMQRkL"
             target="_blank"
             rel="noopener noreferrer"
             class="glass-card promo-card">
            <div class="promo-badge">免费域名可托管 CF</div>
            <div class="promo-content">
              <div class="promo-title">本站域名服务由 DigitalPlat FreeDomain 提供支持</div>
              <div class="promo-desc">可免费申请域名，支持 Cloudflare 托管接入，适合导航站与个人项目使用。</div>
            </div>
          </a>
        `;

        return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${this.config.title}</title><style>
          :root {
            --glass: rgba(255,255,255,0.14);
            --glass-strong: rgba(255,255,255,0.20);
            --border: rgba(255,255,255,0.16);
            --border-strong: rgba(255,255,255,0.24);
            --text-main: #fff;
            --text-sub: rgba(226,232,240,0.92);
            --text-soft: rgba(226,232,240,0.74);
            --warning: #fcd34d;
            --primary: #8b5cf6;
            --primary-2: #38bdf8;
            --backdrop-blur: 18px;
            --shadow-soft: 0 8px 24px rgba(15,23,42,.16);
            --shadow-hover: 0 16px 40px rgba(15,23,42,.24);
            --transition: .28s ease;
          }
          .dark-theme {
            --glass: rgba(15,23,42,0.76);
            --glass-strong: rgba(15,23,42,0.84);
            --border: rgba(255,255,255,0.10);
            --border-strong: rgba(255,255,255,0.16);
            --text-main: #f8fafc;
            --text-sub: rgba(226,232,240,.88);
            --text-soft: rgba(203,213,225,.72);
          }
          * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
          body {
            font-family: ${this.FONT_STACK};
            color: var(--text-main);
            ${this.getBgShellStyle()}
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 40px 20px 100px;
            position: relative;
            transition: var(--transition);
          }
          .container { width: 100%; max-width: 1200px; }
          .glass-card {
            background: linear-gradient(135deg, rgba(255,255,255,.14), rgba(255,255,255,.08));
            backdrop-filter: blur(var(--backdrop-blur));
            -webkit-backdrop-filter: blur(var(--backdrop-blur));
            border: 1px solid var(--border);
            border-radius: 20px;
            box-shadow: var(--shadow-soft);
            transition: var(--transition);
          }

          .header { text-align: center; padding: 48px 28px; margin-bottom: 28px; }
          .header h1 {
            font-size: clamp(2.1rem, 5vw, 3.3rem);
            font-weight: 800;
            line-height: 1.08;
            letter-spacing: -0.035em;
            margin-bottom: 12px;
            text-shadow: 0 6px 20px rgba(0,0,0,0.32);
          }
          .header p {
            max-width: 720px;
            margin: 0 auto;
            font-size: 1rem;
            line-height: 1.75;
            color: var(--text-sub);
          }

          .section-title {
            font-size: 0.95rem;
            font-weight: 800;
            color: #7dd3fc;
            margin-bottom: 15px;
            margin-left: 6px;
            text-transform: uppercase;
            letter-spacing: .06em;
            text-shadow: 0 2px 4px rgba(0,0,0,0.35);
          }

          .search-container { margin-bottom: 28px; width: 100%; }
          .search-wrap { position: relative; width: 100%; max-width: 560px; margin: 0 auto; }
          .search-icon {
            position: absolute;
            left: 18px;
            top: 50%;
            transform: translateY(-50%);
            opacity: .8;
            font-size: 1rem;
            pointer-events: none;
          }
          .search-box {
            width: 100%;
            height: 56px;
            padding: 0 20px 0 48px;
            border-radius: 18px;
            border: 1px solid rgba(255,255,255,0.16);
            background: rgba(255,255,255,0.14);
            backdrop-filter: blur(10px);
            color: white;
            font-size: 1rem;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 6px 18px rgba(0,0,0,0.12);
            transition: var(--transition);
          }
          .search-box::placeholder { color: rgba(255,255,255,0.64); }
          .search-box:focus {
            outline: none;
            background: rgba(255,255,255,0.2);
            border-color: rgba(125,211,252,0.4);
            box-shadow: 0 0 0 4px rgba(56,189,248,0.12), 0 8px 22px rgba(0,0,0,0.16);
          }

          .grid-resources {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 18px;
            margin-bottom: 40px;
          }
          .resource-card-wrap {
            display: flex;
            position: relative;
            overflow: hidden;
            min-height: 112px;
            opacity: 0;
            transform: translateY(20px);
            animation: fadeInUp 0.6s forwards;
          }
          .resource-card-wrap:hover,
          .partner-card:hover {
            background: rgba(255,255,255,0.22);
            transform: translateY(-4px);
            box-shadow: var(--shadow-hover);
          }
          .resource-main-link {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 16px;
            text-decoration: none;
            color: white;
            padding: 22px 20px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.45);
          }
          .card-icon {
            width: 52px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2.2rem;
            flex-shrink: 0;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35));
          }
          .card-info h3 {
            font-size: 1.06rem;
            font-weight: 700;
            line-height: 1.35;
            margin-bottom: 6px;
          }
          .card-info p {
            font-size: 0.84rem;
            color: rgba(252,211,77,.92);
            font-weight: 500;
            line-height: 1.5;
          }

          .tag-special {
            display: inline-flex;
            align-items: center;
            margin-left: 8px;
            padding: 3px 8px;
            font-size: 0.65rem;
            font-weight: 800;
            color: #ecfdf5;
            background: linear-gradient(135deg, rgba(16,185,129,0.78), rgba(5,150,105,0.88));
            border: 1px solid rgba(52,211,153,0.35);
            border-radius: 999px;
            box-shadow: 0 2px 10px rgba(16,185,129,0.25);
            transform: translateY(-1px);
            text-shadow: 0 1px 2px rgba(0,0,0,0.35);
            white-space: nowrap;
          }

          .tag-backup {
            position: absolute;
            top: 12px;
            right: 12px;
            width: auto;
            height: auto;
            padding: 4px 9px;
            border-radius: 999px;
            background: rgba(15,23,42,.35);
            border: 1px solid rgba(255,255,255,.12);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            color: #e2e8f0;
            letter-spacing: .02em;
            text-decoration: none;
            writing-mode: initial;
            transition: var(--transition);
          }
          .tag-backup:hover { background: rgba(139,92,246,.88); color: white; }

          .grid-partners {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 14px;
            margin-bottom: 40px;
          }
          .partner-card {
            text-decoration: none;
            color: #fff;
            text-align: center;
            padding: 16px 14px;
            font-size: 0.92rem;
            font-weight: 600;
            border-radius: 16px;
            text-shadow: 0 1px 3px rgba(0,0,0,0.5);
            transition: var(--transition);
            min-height: 68px;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transform: translateY(20px);
            animation: fadeInUp 0.6s forwards;
          }

          .fab-container {
            position: fixed;
            bottom: 28px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 12px;
            z-index: 100;
            flex-wrap: wrap;
            justify-content: center;
          }
          .fab-btn {
            padding: 11px 18px;
            border-radius: 16px;
            text-decoration: none;
            font-weight: 700;
            color: white;
            transition: var(--transition);
            box-shadow: 0 8px 22px rgba(0,0,0,0.2);
            white-space: nowrap;
            display: flex;
            align-items: center;
            justify-content: center;
            text-shadow: 0 1px 2px rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,.12);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
          }
          .fab-telegram { background: rgba(139,92,246,.68); }
          .fab-mail { background: rgba(59,130,246,.68); }
          .fab-push { background: rgba(244,63,94,.68); }
          .fab-btn:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(0,0,0,.28); }

          .theme-toggle {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 44px;
            height: 44px;
            border-radius: 14px;
            background: rgba(255,255,255,0.16);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.14);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 100;
            color: white;
            font-size: 1.1rem;
            box-shadow: 0 8px 24px rgba(0,0,0,0.12);
          }

          .no-result {
            text-align: center;
            padding: 40px 0;
            color: var(--text-sub);
            font-size: 1.06rem;
            display: none;
          }

          .notice-card {
            margin-bottom: 22px;
            padding: 22px 28px;
            text-align: left;
            background: linear-gradient(135deg, rgba(244, 63, 94, 0.10) 0%, rgba(30, 41, 59, 0.32) 100%);
            border-left: 4px solid #fb7185;
            backdrop-filter: blur(20px);
            animation: fadeInUp 0.8s forwards;
            animation-delay: 0.05s;
          }
          .notice-title {
            font-size: 1.1rem;
            font-weight: 800;
            background: linear-gradient(to right, #fb7185, #c084fc);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 10px;
            text-shadow: none;
          }
          .notice-title span { -webkit-text-fill-color: initial; }
          .notice-content {
            font-size: 0.95rem;
            line-height: 1.8;
            color: rgba(255, 255, 255, 0.92);
            letter-spacing: 0.2px;
          }
          .notice-highlight {
            color: #fcd34d;
            font-weight: 700;
            padding: 0 4px;
            background: rgba(252, 211, 77, 0.1);
            border-radius: 4px;
          }
          .notice-sub {
            margin-top: 8px;
            font-size: 0.9rem;
            opacity: 0.84;
            font-style: italic;
          }
          .heart-beat { display: inline-block; animation: beat 1.5s infinite ease-in-out; }

          .promo-card {
            display: flex;
            align-items: center;
            gap: 18px;
            margin-bottom: 30px;
            padding: 22px 26px;
            text-decoration: none;
            color: var(--text-main);
            background: linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(59,130,246,0.10) 100%);
            border: 1px solid rgba(125, 211, 252, 0.22);
            box-shadow: 0 8px 30px rgba(15, 23, 42, 0.14);
            animation: fadeInUp 0.8s forwards;
            animation-delay: 0.08s;
          }
          .promo-card:hover {
            transform: translateY(-4px);
            background: linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(59,130,246,0.16) 100%);
            box-shadow: 0 14px 36px rgba(15, 23, 42, 0.22);
          }
          .promo-badge {
            flex-shrink: 0;
            min-width: 138px;
            padding: 12px 16px;
            border-radius: 999px;
            text-align: center;
            font-size: 0.95rem;
            font-weight: 800;
            line-height: 1.35;
            color: #dbeafe;
            background: linear-gradient(135deg, rgba(255,255,255,0.28), rgba(191,219,254,0.18));
            border: 1px solid rgba(255,255,255,0.22);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
            text-shadow: 0 1px 2px rgba(0,0,0,0.18);
          }
          .promo-content {
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 0;
          }
          .promo-title {
            font-size: 1rem;
            font-weight: 800;
            color: #ffffff;
            line-height: 1.45;
            text-shadow: 0 2px 8px rgba(0,0,0,0.28);
          }
          .promo-desc {
            font-size: 0.95rem;
            color: rgba(226, 232, 240, 0.92);
            line-height: 1.6;
          }
          .dark-theme .promo-card {
            background: linear-gradient(135deg, rgba(15,23,42,0.72) 0%, rgba(37,99,235,0.18) 100%);
            border-color: rgba(148, 163, 184, 0.16);
          }

          @keyframes beat { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.22); } }
          @keyframes fadeInUp { to { opacity: 1; transform: translateY(0); } }

          @media (max-width: 768px) {
            .header h1 { font-size: 2.2rem; }
            .container { padding: 0 10px; }
            .grid-resources { grid-template-columns: 1fr; gap: 15px; }
            .resource-card-wrap { min-height: 106px; }
            .grid-partners { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
            .fab-container { bottom: 18px; gap: 10px; width: calc(100% - 20px); }
            .fab-btn { padding: 10px 14px; font-size: 0.85rem; }
            .notice-card { padding: 16px 18px; }
            .promo-card {
              flex-direction: column;
              align-items: flex-start;
              gap: 14px;
              padding: 18px 18px;
            }
            .promo-badge {
              min-width: auto;
              width: auto;
              max-width: 100%;
              font-size: 0.9rem;
            }
            .promo-title { font-size: 0.98rem; }
            .promo-desc { font-size: 0.9rem; }
          }
        </style>
        <script>
          function initSearch() {
            const searchBox = document.querySelector('.search-box');
            const gridResources = document.querySelector('.grid-resources');
            const noResult = document.createElement('div');
            noResult.className = 'no-result';
            noResult.innerHTML = '😕 暂无匹配结果';
            gridResources.after(noResult);
            if (!searchBox) return;
            searchBox.addEventListener('keydown', e => e.key === 'Enter' && e.preventDefault());
            searchBox.addEventListener('input', function(e) {
              const searchTerm = e.target.value.toLowerCase().trim();
              const cards = document.querySelectorAll('.resource-card-wrap, .partner-card');
              let hasMatch = false;
              cards.forEach(card => {
                const isMatch = !searchTerm || card.textContent.toLowerCase().includes(searchTerm);
                card.style.display = isMatch ? (card.classList.contains('partner-card') ? 'flex' : 'flex') : 'none';
                if (isMatch) hasMatch = true;
              });
              noResult.style.display = searchTerm && !hasMatch ? 'block' : 'none';
            });
          }
          function initThemeToggle() {
            const themeBtn = document.querySelector('.theme-toggle');
            if (!themeBtn) return;
            const toggleTheme = () => {
              document.body.classList.toggle('dark-theme');
              const isDark = document.body.classList.contains('dark-theme');
              localStorage.setItem('theme', isDark ? 'dark' : 'light');
              themeBtn.textContent = isDark ? '☀️' : '🌙';
            };
            themeBtn.addEventListener('click', toggleTheme);
            const savedTheme = localStorage.getItem('theme');
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
              document.body.classList.add('dark-theme');
              themeBtn.textContent = '☀️';
            }
          }
          function initAnimation() {
            const baseDelay = 0.08;
            const resources = document.querySelectorAll('.resource-card-wrap');
            resources.forEach((card, i) => card.style.animationDelay = \`\${i * baseDelay}s\`);
            const friends = document.querySelectorAll('.partner-card');
            friends.forEach((card, i) => card.style.animationDelay = \`\${(resources.length + i) * baseDelay}s\`);
          }
          document.addEventListener('DOMContentLoaded', () => { initSearch(); initThemeToggle(); initAnimation(); });
        </script></head><body>
        <button class="theme-toggle" title="切换主题">🌙</button>
        <div class="container">
          <div class="header glass-card"><h1>${this.config.title}</h1><p>${this.config.subtitle}</p></div>

          <div class="search-container">
            <div class="search-wrap">
              <span class="search-icon">🔎</span>
              <input type="text" class="search-box" placeholder="搜索导航项目..." />
            </div>
          </div>

          ${noticeHtml}
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

    render_AdminDashboard(dbData, m) {
        const { statsMap, dailyMap, periodMap, monthContextMap, monthTotalClicks, isDayMode } = dbData;
        const safeLinks = Array.isArray(this.LINKS_DATA) ? this.LINKS_DATA : [];
        const safeFriends = Array.isArray(this.FRIENDS_DATA) ? this.FRIENDS_DATA : [];
        const activeIds = new Set([...safeLinks.map(i => i.id), ...safeFriends.map(i => i.id)]);

        let historyTotal = 0;
        for (let v of statsMap.values()) {
            if (activeIds.has(v.id)) historyTotal += (v.total_clicks || 0);
        }

        let viewTotalDenominator = 0;
        if (isDayMode) {
            for (let c of monthContextMap.values()) viewTotalDenominator += c;
        } else {
            for (let c of periodMap.values()) viewTotalDenominator += c;
        }

        let prevDay = m, nextDay = m, prevMonthStr = "", nextMonthStr = "";
        try {
            if (isDayMode) {
                const d = new Date(m);
                d.setDate(d.getDate() - 1);
                prevDay = d.toISOString().split('T')[0];
                d.setDate(d.getDate() + 2);
                nextDay = d.toISOString().split('T')[0];
            }
            const currentY_int = parseInt(m.substring(0, 4)), currentM_int = parseInt(m.substring(5, 7));
            let prevM_Y = currentY_int, prevM_M = currentM_int - 1;
            if (prevM_M === 0) { prevM_Y -= 1; prevM_M = 12; }
            prevMonthStr = `${prevM_Y}_${String(prevM_M).padStart(2, '0')}`;
            let nextM_Y = currentY_int, nextM_M = currentM_int + 1;
            if (nextM_M === 13) { nextM_Y += 1; nextM_M = 1; }
            nextMonthStr = `${nextM_Y}_${String(nextM_M).padStart(2, '0')}`;
        } catch (e) {}

        const buildCard = (id, name, emoji, isMini) => {
            const stat = statsMap.get(id) || { total_clicks: 0, last_time: '' };
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

            let timeDisplay = stat.last_time || '暂无';
            let timeIcon = '🕒';
            if (timeDisplay !== '暂无') {
                if (isDayMode) {
                    timeDisplay = timeDisplay.split(' ')[1] || timeDisplay;
                } else {
                    timeDisplay = timeDisplay.split(' ')[0].substring(5);
                    timeIcon = '📅';
                }
            }

            if (isMini) {
                return `<div class="mini-card" onclick="openLog('${id}','${m}','${name}')">
                  <div class="mini-top">
                    <span class="mini-name" title="${name}">${name}</span>
                    <span class="mini-badge">${selectedTargetVal}</span>
                  </div>
                  <div class="mini-meta">${timeDisplay}</div>
                </div>`;
            }

            return `<div class="stat-card" onclick="openLog('${id}','${m}','${name}')">
              <div class="stat-top">
                <div class="stat-title-wrap">
                  <span class="stat-emoji">${emoji || '🔗'}</span>
                  <span class="stat-title">${name}</span>
                </div>
                <span class="stat-pct">${progressVal}%</span>
              </div>
              <div class="stat-metrics">
                <div class="metric">
                  <span class="metric-label">历史</span>
                  <span class="metric-value">${stat.total_clicks || 0}</span>
                </div>
                <div class="metric">
                  <span class="metric-label">${col2Label}</span>
                  <span class="metric-value metric-gold">${col2Val}</span>
                </div>
                <div class="metric">
                  <span class="metric-label">${col3Label}</span>
                  <span class="metric-value metric-blue">${col3Val}</span>
                </div>
              </div>
              <div class="progress"><div style="width:${progressVal}%"></div></div>
              <div class="stat-foot">${timeIcon} ${timeDisplay}</div>
            </div>`;
        };

        const linkHtml = safeLinks.map(i => buildCard(i.id, i.name, i.emoji, false)).join('');
        const friendHtml = safeFriends.map(i => buildCard(i.id, i.name, '', true)).join('');

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
            links: JSON.stringify(this.LINKS_DATA, null, 2),
            friends: JSON.stringify(this.FRIENDS_DATA, null, 2)
        };

        let noticeHtmlPreview = '';
        if (this.config.notice && this.config.notice.trim() !== '') {
            noticeHtmlPreview = `<div class="panel notice-panel"><div class="panel-head"><span>❤️</span><strong>公告预览</strong></div><div class="notice-preview">${this.config.notice}</div></div>`;
        }

        return `<!DOCTYPE html><html lang="zh-CN"><head>${this.render_Head(this.config.title)}<style>
        :root{
          --bg-card:rgba(15,23,42,0.72);
          --bg-card-soft:rgba(15,23,42,0.58);
          --bg-elev:rgba(255,255,255,0.06);
          --bd:rgba(255,255,255,0.12);
          --bd-strong:rgba(255,255,255,0.18);
          --txt:#f8fafc;
          --txt-sub:#94a3b8;
          --txt-soft:#cbd5e1;
          --blue:#38bdf8;
          --violet:#8b5cf6;
          --gold:#fbbf24;
          --green:#34d399;
          --red:#f87171;
          --shadow:0 18px 44px rgba(2,6,23,0.24);
          --shadow-soft:0 8px 24px rgba(2,6,23,0.16);
          --radius-xl:24px;
          --radius-lg:18px;
          --radius-md:14px;
          --radius-sm:12px;
        }
        .light-theme{
          --bg-card:rgba(255,255,255,0.90);
          --bg-card-soft:rgba(255,255,255,0.78);
          --bg-elev:rgba(15,23,42,0.04);
          --bd:rgba(15,23,42,0.08);
          --bd-strong:rgba(15,23,42,0.12);
          --txt:#0f172a;
          --txt-sub:#475569;
          --txt-soft:#64748b;
          --shadow:0 18px 44px rgba(15,23,42,0.10);
          --shadow-soft:0 8px 24px rgba(15,23,42,0.06);
        }
        *{box-sizing:border-box}
        body{
          color:var(--txt);
          ${this.getBgShellStyle()}
          transition:.28s ease;
          padding:24px;
          display:block;
        }
        .admin-shell{
          width:min(1320px,100%);
          margin:0 auto;
        }

        .theme-toggle{
          position:fixed;
          top:18px;
          left:18px;
          width:44px;
          height:44px;
          border-radius:14px;
          border:1px solid var(--bd);
          background:var(--bg-card-soft);
          color:var(--txt);
          display:flex;
          align-items:center;
          justify-content:center;
          cursor:pointer;
          z-index:120;
          backdrop-filter:blur(12px);
          box-shadow:var(--shadow-soft);
        }

        .topbar{
          background:var(--bg-card);
          border:1px solid var(--bd);
          border-radius:28px;
          backdrop-filter:blur(20px);
          box-shadow:var(--shadow);
          padding:28px;
          display:grid;
          grid-template-columns:1.4fr 1fr;
          gap:22px;
          margin-bottom:22px;
        }
        .hero-title{
          font-size:clamp(1.9rem,4vw,2.8rem);
          line-height:1.08;
          letter-spacing:-0.04em;
          margin:0 0 10px;
          font-weight:900;
        }
        .hero-sub{
          color:var(--txt-soft);
          line-height:1.7;
          font-size:.98rem;
          max-width:760px;
        }
        .hero-tags{
          margin-top:18px;
          display:flex;
          gap:10px;
          flex-wrap:wrap;
        }
        .pill{
          display:inline-flex;
          align-items:center;
          gap:8px;
          padding:8px 12px;
          border-radius:999px;
          background:var(--bg-elev);
          border:1px solid var(--bd);
          color:var(--txt-soft);
          font-size:.84rem;
          font-weight:700;
        }

        .top-actions{
          display:flex;
          flex-direction:column;
          justify-content:space-between;
          gap:16px;
        }
        .quick-stats{
          display:grid;
          grid-template-columns:repeat(3,1fr);
          gap:12px;
        }
        .quick-card{
          background:var(--bg-elev);
          border:1px solid var(--bd);
          border-radius:18px;
          padding:16px;
          min-height:96px;
          display:flex;
          flex-direction:column;
          justify-content:space-between;
        }
        .quick-label{
          color:var(--txt-sub);
          font-size:.82rem;
          font-weight:700;
          letter-spacing:.03em;
        }
        .quick-value{
          font-size:1.8rem;
          font-weight:900;
          line-height:1;
        }

        .action-row{
          display:flex;
          gap:12px;
          flex-wrap:wrap;
          justify-content:flex-end;
          align-items:center;
        }
        .action-btn{
          appearance:none;
          border:none;
          text-decoration:none;
          cursor:pointer;
          padding:12px 16px;
          border-radius:14px;
          font-weight:800;
          font-size:.92rem;
          transition:.25s ease;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          box-shadow:var(--shadow-soft);
        }
        .action-btn:hover{ transform:translateY(-2px); }
        .action-primary{ background:linear-gradient(135deg,#3b82f6,#8b5cf6); color:#fff; }
        .action-soft{ background:var(--bg-elev); color:var(--txt); border:1px solid var(--bd); }
        .action-danger{ background:rgba(248,113,113,.14); color:var(--red); border:1px solid rgba(248,113,113,.18); }

        .toolbar{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:14px;
          padding:16px 18px;
          background:var(--bg-card-soft);
          border:1px solid var(--bd);
          border-radius:20px;
          backdrop-filter:blur(16px);
          box-shadow:var(--shadow-soft);
          margin-bottom:22px;
          flex-wrap:wrap;
        }
        .toolbar-left,.toolbar-right{
          display:flex;
          align-items:center;
          gap:10px;
          flex-wrap:wrap;
        }
        .tbtn{
          text-decoration:none;
          color:var(--txt);
          background:var(--bg-elev);
          border:1px solid var(--bd);
          padding:10px 14px;
          border-radius:12px;
          font-size:.9rem;
          font-weight:800;
          transition:.22s ease;
        }
        .tbtn:hover,.tbtn.active{
          background:rgba(56,189,248,.16);
          border-color:rgba(56,189,248,.28);
          color:#7dd3fc;
          transform:translateY(-1px);
        }
        .date-chip{
          display:flex;
          align-items:center;
          gap:10px;
          padding:10px 14px;
          border-radius:14px;
          border:1px solid var(--bd);
          background:var(--bg-elev);
          position:relative;
          overflow:hidden;
        }
        .date-chip strong{
          font-family:monospace;
          font-size:1rem;
          letter-spacing:.02em;
        }
        .date-chip input[type="date"]{
          position:absolute;
          inset:0;
          opacity:0;
          cursor:pointer;
        }

        .grid-main{
          display:grid;
          grid-template-columns:1fr;
          gap:22px;
        }
        .panel{
          background:var(--bg-card);
          border:1px solid var(--bd);
          border-radius:24px;
          backdrop-filter:blur(18px);
          box-shadow:var(--shadow);
          padding:22px;
        }
        .panel-header{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          margin-bottom:18px;
          flex-wrap:wrap;
        }
        .panel-title{
          margin:0;
          font-size:1rem;
          letter-spacing:.04em;
          text-transform:uppercase;
          color:#7dd3fc;
          font-weight:900;
        }
        .panel-sub{
          color:var(--txt-sub);
          font-size:.86rem;
        }

        .stats-grid{
          display:grid;
          grid-template-columns:repeat(auto-fill,minmax(280px,1fr));
          gap:16px;
        }
        .stat-card{
          border-radius:20px;
          border:1px solid var(--bd);
          background:linear-gradient(180deg,var(--bg-elev),rgba(255,255,255,0.03));
          padding:18px;
          cursor:pointer;
          transition:.24s ease;
          min-height:168px;
        }
        .stat-card:hover{
          transform:translateY(-4px);
          border-color:rgba(56,189,248,.28);
          box-shadow:0 16px 38px rgba(2,6,23,0.14);
        }
        .stat-top{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
          margin-bottom:16px;
        }
        .stat-title-wrap{
          display:flex;
          align-items:center;
          gap:12px;
          min-width:0;
          flex:1;
        }
        .stat-emoji{
          width:42px;
          height:42px;
          border-radius:14px;
          display:flex;
          align-items:center;
          justify-content:center;
          background:rgba(255,255,255,.08);
          border:1px solid var(--bd);
          flex-shrink:0;
          font-size:1.3rem;
        }
        .stat-title{
          font-size:1rem;
          font-weight:800;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .stat-pct{
          flex-shrink:0;
          padding:6px 10px;
          border-radius:999px;
          background:rgba(56,189,248,.14);
          color:#7dd3fc;
          font-weight:900;
          font-size:.82rem;
          border:1px solid rgba(56,189,248,.18);
        }

        .stat-metrics{
          display:grid;
          grid-template-columns:repeat(3,1fr);
          gap:10px;
          margin-bottom:14px;
        }
        .metric{
          background:rgba(255,255,255,.03);
          border:1px solid var(--bd);
          border-radius:14px;
          padding:12px 10px;
          text-align:center;
        }
        .metric-label{
          display:block;
          font-size:.74rem;
          color:var(--txt-sub);
          margin-bottom:5px;
          font-weight:700;
        }
        .metric-value{
          font-size:1.05rem;
          font-weight:900;
          color:var(--txt);
        }
        .metric-gold{ color:var(--gold); }
        .metric-blue{ color:var(--blue); }

        .progress{
          height:8px;
          border-radius:999px;
          background:rgba(255,255,255,.06);
          overflow:hidden;
          margin-bottom:12px;
        }
        .progress div{
          height:100%;
          border-radius:999px;
          background:linear-gradient(90deg,#fbbf24,#38bdf8,#8b5cf6);
        }
        .stat-foot{
          color:var(--txt-sub);
          font-size:.82rem;
          font-family:monospace;
          text-align:right;
        }

        .mini-grid{
          display:grid;
          grid-template-columns:repeat(auto-fill,minmax(180px,1fr));
          gap:12px;
        }
        .mini-card{
          background:linear-gradient(180deg,var(--bg-elev),rgba(255,255,255,0.02));
          border:1px solid var(--bd);
          border-radius:18px;
          padding:14px;
          cursor:pointer;
          transition:.22s ease;
        }
        .mini-card:hover{
          transform:translateY(-3px);
          border-color:rgba(56,189,248,.28);
        }
        .mini-top{
          display:flex;
          align-items:center;
          gap:8px;
          justify-content:space-between;
          margin-bottom:12px;
        }
        .mini-name{
          min-width:0;
          flex:1;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
          font-weight:800;
        }
        .mini-badge{
          flex-shrink:0;
          border-radius:999px;
          padding:4px 8px;
          background:rgba(56,189,248,.14);
          border:1px solid rgba(56,189,248,.18);
          color:#7dd3fc;
          font-weight:900;
          font-size:.78rem;
        }
        .mini-meta{
          text-align:right;
          color:var(--txt-sub);
          font-family:monospace;
          font-size:.78rem;
        }

        .notice-panel{ padding:18px 20px; }
        .panel-head{
          display:flex;
          align-items:center;
          gap:10px;
          margin-bottom:12px;
          color:#fda4af;
          font-weight:900;
        }
        .notice-preview{
          color:var(--txt-soft);
          line-height:1.8;
          font-size:.94rem;
        }

        .mask{
          position:fixed;
          inset:0;
          background:rgba(2,6,23,.48);
          backdrop-filter:blur(4px);
          z-index:140;
          opacity:0;
          pointer-events:none;
          transition:.25s ease;
        }
        .mask.show{
          opacity:1;
          pointer-events:auto;
        }

        .drawer{
          position:fixed;
          top:0;
          right:-460px;
          width:420px;
          max-width:100vw;
          height:100vh;
          z-index:150;
          transition:.28s ease;
          background:var(--bg-card);
          border-left:1px solid var(--bd);
          backdrop-filter:blur(20px);
          box-shadow:-24px 0 44px rgba(2,6,23,.24);
          display:flex;
          flex-direction:column;
        }
        .drawer.open{ right:0; }
        .drawer-head{
          padding:20px;
          border-bottom:1px solid var(--bd);
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
        }
        .drawer-title{
          margin:0;
          font-size:1.05rem;
          font-weight:900;
        }
        .icon-btn{
          width:36px;
          height:36px;
          border:none;
          border-radius:12px;
          cursor:pointer;
          background:var(--bg-elev);
          color:var(--txt);
          border:1px solid var(--bd);
          font-size:1.1rem;
        }
        .log-list{
          flex:1;
          overflow:auto;
          padding:16px;
          margin:0;
          list-style:none;
          display:flex;
          flex-direction:column;
          gap:10px;
        }
        .log-item{
          padding:14px;
          border-radius:16px;
          border:1px solid var(--bd);
          background:rgba(255,255,255,.03);
        }
        .log-row{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          margin-bottom:8px;
        }
        .log-index{ color:#7dd3fc; font-weight:900; }
        .log-time{ color:var(--txt); font-size:.86rem; }
        .log-meta{
          display:flex;
          justify-content:space-between;
          gap:10px;
          flex-wrap:wrap;
          font-family:monospace;
          color:var(--txt-sub);
          font-size:.76rem;
        }

        .fs-modal{
          position:fixed;
          inset:0;
          background:rgba(2,6,23,.72);
          backdrop-filter:blur(12px);
          z-index:160;
          display:none;
          overflow:auto;
        }
        .fs-modal.open{ display:block; }
        .settings-wrap{
          width:min(1120px,calc(100% - 28px));
          margin:24px auto;
          background:var(--bg-card);
          border:1px solid var(--bd);
          border-radius:28px;
          box-shadow:var(--shadow);
          overflow:hidden;
        }
        .settings-head{
          padding:22px 24px;
          border-bottom:1px solid var(--bd);
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:14px;
          flex-wrap:wrap;
          position:sticky;
          top:0;
          background:var(--bg-card);
          backdrop-filter:blur(16px);
          z-index:2;
        }
        .settings-title{
          margin:0;
          font-size:1.22rem;
          font-weight:900;
        }
        .settings-sub{
          color:var(--txt-sub);
          font-size:.9rem;
          margin-top:6px;
        }
        .settings-actions{
          display:flex;
          gap:10px;
          flex-wrap:wrap;
        }
        .settings-body{
          padding:24px;
        }
        .settings-grid{
          display:grid;
          grid-template-columns:repeat(2,1fr);
          gap:18px;
        }
        .full{ grid-column:1 / -1; }

        .field{
          background:rgba(255,255,255,.03);
          border:1px solid var(--bd);
          border-radius:18px;
          padding:16px;
        }
        .field label{
          display:block;
          font-size:.88rem;
          color:var(--txt-sub);
          margin-bottom:10px;
          font-weight:800;
        }
        .field small{
          display:block;
          color:var(--txt-sub);
          font-size:.78rem;
          margin-top:8px;
          line-height:1.6;
        }
        .field input,.field textarea{
          width:100%;
          border-radius:14px;
          border:1px solid var(--bd-strong);
          background:rgba(2,6,23,.20);
          color:var(--txt);
          padding:14px;
          font-size:.95rem;
          font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;
          outline:none;
          transition:.2s ease;
        }
        .light-theme .field input,
        .light-theme .field textarea{
          background:#fff;
        }
        .field input:focus,.field textarea:focus{
          border-color:rgba(56,189,248,.48);
          box-shadow:0 0 0 4px rgba(56,189,248,.12);
        }
        .field textarea{
          min-height:130px;
          resize:vertical;
          line-height:1.55;
          white-space:pre;
        }
        .field textarea.code{
          min-height:260px;
        }

        @media (max-width: 1024px){
          .topbar{ grid-template-columns:1fr; }
        }
        @media (max-width: 768px){
          body{ padding:16px; }
          .quick-stats{ grid-template-columns:1fr; }
          .action-row{ justify-content:flex-start; }
          .toolbar{ padding:14px; }
          .stats-grid{ grid-template-columns:1fr; }
          .settings-grid{ grid-template-columns:1fr; }
          .drawer{ width:100%; right:-100%; }
          .settings-wrap{ width:calc(100% - 12px); margin:6px auto; border-radius:20px; }
          .settings-head,.settings-body{ padding:16px; }
        }
        </style></head>
        <body>
          <button class="theme-toggle" onclick="toggleAdminTheme()" title="切换主题">☀️</button>

          <div class="admin-shell">
            <section class="topbar">
              <div>
                <h1 class="hero-title">📊 数据看板</h1>
                <div class="hero-sub">
                  当前查看维度：<strong style="color:var(--txt)">${m}</strong>。你可以在这里查看精选资源与友链的点击情况、快速预览公告内容，并直接进入系统配置面板修改站点设置。
                </div>
                <div class="hero-tags">
                  <span class="pill">🧭 路径：${this.ADMIN_PATH}</span>
                  <span class="pill">🕒 时间：${this.time.fullStr}</span>
                  <span class="pill">📦 历史总计：${historyTotal}</span>
                </div>
              </div>

              <div class="top-actions">
                <div class="quick-stats">
                  <div class="quick-card">
                    <div class="quick-label">总项目</div>
                    <div class="quick-value">${safeLinks.length}</div>
                  </div>
                  <div class="quick-card">
                    <div class="quick-label">本月总点击</div>
                    <div class="quick-value" style="color:var(--blue)">${monthTotalClicks}</div>
                  </div>
                  <div class="quick-card">
                    <div class="quick-label">活跃项目</div>
                    <div class="quick-value">${Array.from(statsMap.values()).filter(c=>c.total_clicks>0).length}</div>
                  </div>
                </div>
                <div class="action-row">
                  <a href="/" class="action-btn action-soft">🏠 返回主页</a>
                  <button class="action-btn action-primary" onclick="openSettings()">⚙️ 系统设置</button>
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
                  <strong>${m}</strong>
                  <input type="date" value="${isDayMode ? m : ''}" onchange="if(this.value) location.href='${this.ADMIN_PATH}?m='+this.value">
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

              <section class="panel">
                <div class="panel-header">
                  <div>
                    <h3 class="panel-title">💎 精选数据</h3>
                    <div class="panel-sub">点击任意卡片可查看访问记录详情</div>
                  </div>
                </div>
                <div class="stats-grid">${linkHtml}</div>
              </section>

              <section class="panel">
                <div class="panel-header">
                  <div>
                    <h3 class="panel-title">🔗 友链数据</h3>
                    <div class="panel-sub">简要查看友链表现</div>
                  </div>
                </div>
                <div class="mini-grid">${friendHtml}</div>
              </section>
            </div>
          </div>

          <div class="mask" id="mask" onclick="cls()"></div>

          <aside class="drawer" id="dr">
            <div class="drawer-head">
              <h3 class="drawer-title" id="dt">点击记录</h3>
              <button class="icon-btn" onclick="cls()">×</button>
            </div>
            <ul class="log-list" id="dl"></ul>
          </aside>

          <div class="fs-modal" id="set-fs">
            <div class="settings-wrap">
              <div class="settings-head">
                <div>
                  <h3 class="settings-title">⚙️ 系统全局配置</h3>
                  <div class="settings-sub">保存后立即生效。JSON 区域请保持合法格式。</div>
                </div>
                <div class="settings-actions">
                  <button class="action-btn action-soft" onclick="cls()">取消 (Esc)</button>
                  <button class="action-btn action-primary" onclick="saveSettings(this)">💾 保存并生效</button>
                </div>
              </div>

              <div class="settings-body">
                <div class="settings-grid">
                  <div class="field">
                    <label>后台登录密码</label>
                    <input type="text" id="s_pass" placeholder="默认: 123456">
                  </div>

                  <div class="field">
                    <label>网站主标题</label>
                    <input type="text" id="s_title">
                  </div>

                  <div class="field">
                    <label>网站副标题</label>
                    <input type="text" id="s_sub">
                  </div>

                  <div class="field">
                    <label>客服支持链接</label>
                    <input type="text" id="s_tg" placeholder="例如 Telegram / 工单地址">
                  </div>

                  <div class="field full">
                    <label>背景图 URL（多图用逗号隔开，支持 Base64）</label>
                    <input type="text" id="s_img" placeholder="留空使用默认高清壁纸">
                    <small>建议使用可公开访问、跨浏览器兼容的图片地址。如果图床开启防盗链，部分浏览器会回退到默认背景。</small>
                  </div>

                  <div class="field">
                    <label>联系邮箱</label>
                    <input type="text" id="s_mail" placeholder="留空则不显示底部邮箱按钮">
                  </div>

                  <div class="field">
                    <label>留言板推送 Webhook</label>
                    <input type="text" id="s_push" placeholder="留空则不显示留言按钮">
                  </div>

                  <div class="field full">
                    <label>温馨提示公告（支持 HTML，清空则隐藏）</label>
                    <textarea id="s_notice"></textarea>
                  </div>

                  <div class="field full">
                    <label>自定义卡片跳转域名</label>
                    <input type="text" id="s_host" placeholder="如果不填，默认自动使用当前访问域名">
                  </div>

                  <div class="field full">
                    <label>💎 精选资源 LINKS（JSON 格式）</label>
                    <textarea id="s_links" class="code"></textarea>
                  </div>

                  <div class="field full">
                    <label>🔗 合作伙伴 FRIENDS（JSON 格式）</label>
                    <textarea id="s_friends" class="code"></textarea>
                  </div>
                </div>
              </div>
            </div>
          </div>

          ${this.render_BgRuntimeScript()}

          <script>
            const ADMIN_PATH = '${this.ADMIN_PATH}';
            const SYS_SET = ${JSON.stringify(sysSettings)};

            function initAdminTheme() {
              if(localStorage.getItem('admin_theme') === 'light') {
                document.body.classList.add('light-theme');
                document.querySelector('.theme-toggle').textContent = '🌙';
              }
            }
            initAdminTheme();

            function toggleAdminTheme() {
              document.body.classList.toggle('light-theme');
              const isLight = document.body.classList.contains('light-theme');
              localStorage.setItem('admin_theme', isLight ? 'light' : 'dark');
              document.querySelector('.theme-toggle').textContent = isLight ? '🌙' : '☀️';
            }

            async function openLog(id, m, n){
              document.getElementById('dr').classList.add('open');
              document.getElementById('mask').classList.add('show');
              document.getElementById('dt').innerText = n + ' · 点击记录';

              const l = document.getElementById('dl');
              l.innerHTML = '<li style="padding:20px;text-align:center;color:var(--txt-sub)">加载中...</li>';

              try {
                const r = await fetch(\`\${ADMIN_PATH}/api/logs?id=\${id}&m=\${m}\`);
                const data = await r.json();
                if(!data.length){
                  l.innerHTML = '<li style="padding:20px;text-align:center;opacity:.6;color:var(--txt-sub)">该时段无记录</li>';
                  return;
                }
                l.innerHTML = data.map((x,i)=>\`
                  <li class="log-item">
                    <div class="log-row">
                      <span class="log-index">#\${i+1}</span>
                      <span class="log-time">\${x.click_time}</span>
                    </div>
                    <div class="log-meta">
                      <span>\${x.ip_address}</span>
                      <span>\${(x.user_agent || '').slice(0,46) || 'unknown'}</span>
                    </div>
                  </li>
                \`).join('');
              } catch(e) {
                l.innerHTML = '<li style="padding:20px;text-align:center;color:#f87171">加载失败</li>';
                console.error(e);
              }
            }

            function openSettings() {
              document.getElementById('s_pass').value = SYS_SET.admin_pass || '';
              document.getElementById('s_title').value = SYS_SET.title || '';
              document.getElementById('s_sub').value = SYS_SET.subtitle || '';
              document.getElementById('s_img').value = SYS_SET.img || '';
              document.getElementById('s_tg').value = SYS_SET.contact_url || '';
              document.getElementById('s_mail').value = SYS_SET.mail || '';
              document.getElementById('s_push').value = SYS_SET.push || '';
              document.getElementById('s_host').value = SYS_SET.host || '';
              document.getElementById('s_notice').value = SYS_SET.notice || '';
              document.getElementById('s_links').value = SYS_SET.links || '[]';
              document.getElementById('s_friends').value = SYS_SET.friends || '[]';

              document.getElementById('set-fs').classList.add('open');
              document.getElementById('mask').classList.add('show');
              document.body.style.overflow = 'hidden';
            }

            async function saveSettings(btn) {
              try {
                JSON.parse(document.getElementById('s_links').value);
                JSON.parse(document.getElementById('s_friends').value);
              } catch(e) {
                alert("⚠️ JSON 格式解析错误！请检查是否有遗漏的逗号、引号或括号。");
                return;
              }

              const data = {
                admin_pass: document.getElementById('s_pass').value,
                title: document.getElementById('s_title').value,
                subtitle: document.getElementById('s_sub').value,
                img: document.getElementById('s_img').value,
                contact_url: document.getElementById('s_tg').value,
                mail: document.getElementById('s_mail').value,
                push: document.getElementById('s_push').value,
                host: document.getElementById('s_host').value,
                notice: document.getElementById('s_notice').value,
                links: document.getElementById('s_links').value,
                friends: document.getElementById('s_friends').value
              };

              const originalText = btn.innerText;
              btn.innerText = "保存中...";
              btn.disabled = true;

              try {
                const res = await fetch(\`\${ADMIN_PATH}/api/settings\`, {
                  method: 'POST',
                  body: JSON.stringify(data)
                });
                if(res.ok) {
                  alert('✅ 配置已保存并生效！');
                  location.reload();
                } else {
                  alert('❌ 保存失败');
                }
              } catch(e) {
                alert('❌ 网络错误');
              }

              btn.innerText = originalText;
              btn.disabled = false;
            }

            function cls() {
              document.getElementById('dr').classList.remove('open');
              document.getElementById('set-fs').classList.remove('open');
              document.getElementById('mask').classList.remove('show');
              document.body.style.overflow = '';
            }

            document.addEventListener('keydown', (e) => {
              if(e.key === 'Escape') cls();
            });
          </script>
        </body></html>`;
    }
}
