export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const COOKIE_NAME = "nav_session_v99_rotate_fix";

  // --- 1. 配置区域 ---
  const TITLE = env.TITLE || "云端加速 · 精选导航";
  const SUBTITLE = env.SUBTITLE || "优质资源推荐 · 随时畅联";
  const ADMIN_PASS = env.admin || "123456";
  const CONTACT_URL = env.CONTACT_URL || "https://t.me/Fuzzy_Fbot";

  // 🖼️ 图像配置 (修复多图轮换 + Base64支持)
  const DEFAULT_IMG = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=2073";
  
  let RAW_IMG = DEFAULT_IMG;
  
  if (env.img) {
      const imgStr = env.img.trim();
      // 智能判断：如果是 Base64 (data:开头)，则视为单张图片，不分割
      if (imgStr.startsWith('data:')) {
          RAW_IMG = imgStr;
      } else {
          // 否则按逗号分割，支持多图轮换
          const list = imgStr.split(',').map(s => s.trim()).filter(s => s);
          if (list.length > 0) {
              // 🟢 修改点：改为每天轮换一次 (基于 UTC+8 时间)
              // 计算当前时间相对于 Epoch 的天数，保证同一天内 index 不变
              const dayIndex = Math.floor((new Date().getTime() + 8 * 3600000) / 86400000);
              RAW_IMG = list[dayIndex % list.length];
          }
      }
  }

  const getJson = (k) => { try { return env[k] ? JSON.parse(env[k]) : []; } catch(e) { return []; } };
  const LINKS_DATA = getJson('LINKS');
  const FRIENDS_DATA = getJson('FRIENDS');

  // 时间工具 (UTC+8)
  const getNow = () => new Date(new Date().getTime() + 8 * 3600000);
  const now = getNow();
  const currYear = now.getFullYear().toString();
  const currMonth = (now.getMonth() + 1).toString().padStart(2, '0');
  const dateKey = `${currYear}_${currMonth}`;
  const fullTimeStr = now.toISOString().replace('T', ' ').substring(0, 19);
  const todayStr = now.toISOString().split('T')[0];

  // 字体栈
  const FONT_STACK = `'SF Pro Display', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

  // 工具函数
  const toValidQueryParam = (str) => {
    if (!str) return dateKey.replace('_', '-');
    const normalized = str.replace('_', '-').substring(0, 7);
    return /^\d{4}-\d{2}$/.test(normalized) ? normalized : dateKey.replace('_', '-');
  };
  const getSafeParam = (sp, key, def = '') => sp.get(key)?.trim() || def;

  try {
    // API: 日志查询
    if (url.pathname === "/admin/api/logs") {
      if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
      const cookie = request.headers.get('Cookie') || '';
      if (!cookie.includes(`${COOKIE_NAME}=true`)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      
      const id = getSafeParam(url.searchParams, 'id');
      const m = getSafeParam(url.searchParams, 'm', dateKey);
      
      if (!env.db) return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
      try {
        const queryParam = toValidQueryParam(m);
        const { results } = await env.db.prepare(
          "SELECT click_time, ip_address, user_agent FROM logs WHERE link_id = ? AND click_time LIKE ? || '%' ORDER BY id DESC LIMIT 50"
        ).bind(id, queryParam).all();
        return new Response(JSON.stringify(results || []), { headers: { "content-type": "application/json" } });
      } catch (dbErr) {
        return new Response(JSON.stringify({ error: 'Failed to fetch logs' }), { status: 500 });
      }
    }

    // --- 后台管理页面 ---
    if (url.pathname === "/admin") {
      const cookie = request.headers.get('Cookie') || '';
      // 登录处理
      if (request.method === 'POST') {
        const formData = await request.formData();
        const password = formData.get('password') || '';
        
        if (password.length > 100) return new Response(renderLoginPageV10(TITLE, FONT_STACK, RAW_IMG, DEFAULT_IMG, '密码长度异常'), { headers: { "content-type": "text/html;charset=UTF-8" } });
        
        if (password === ADMIN_PASS) {
          return new Response(null, { status: 302, headers: { 'Location': '/admin', 'Set-Cookie': `${COOKIE_NAME}=true; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict` } });
        } else {
          return new Response(renderLoginPageV10(TITLE, FONT_STACK, RAW_IMG, DEFAULT_IMG, '密码错误'), { headers: { "content-type": "text/html;charset=UTF-8" } });
        }
      }
      // 未登录
      if (!cookie.includes(`${COOKIE_NAME}=true`)) {
        return new Response(renderLoginPageV10(TITLE, FONT_STACK, RAW_IMG, DEFAULT_IMG, ''), { headers: { "content-type": "text/html;charset=UTF-8" } });
      }

      // -------------------------------------------------------------
      // 后台数据查询
      // -------------------------------------------------------------
      const selectedDateOrMonth = getSafeParam(url.searchParams, 'm', dateKey);
      const currentMonthKey = selectedDateOrMonth.replace('-', '_').substring(0, 7); 
      const queryParam = selectedDateOrMonth.replace('_', '-'); 
      const isDayMode = selectedDateOrMonth.length > 7 && /^\d{4}-\d{2}-\d{2}$/.test(selectedDateOrMonth);

      try {
        if (!env.db) throw new Error('Database not available');

        const queries = [
            env.db.prepare("SELECT * FROM stats").all().catch(() => ({ results: [] })),
            env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE click_time LIKE ? || '%' GROUP BY link_id").bind(todayStr).all().catch(() => ({ results: [] })),
            env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE click_time LIKE ? || '%' GROUP BY link_id").bind(queryParam).all().catch(() => ({ results: [] }))
        ];

        if (isDayMode) {
            queries.push(env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE month_key = ? GROUP BY link_id").bind(currentMonthKey).all().catch(() => ({ results: [] })));
        } else {
            queries.push(Promise.resolve({ results: [] })); 
        }

        queries.push(env.db.prepare("SELECT COUNT(*) as total FROM logs WHERE month_key = ?").bind(currentMonthKey).all().catch(() => ({ results: [{ total: 0 }] })));

        const [statsResult, dailyResult, periodResult, monthContextResult, monthTotalResult] = await Promise.all(queries);

        const statsMap = new Map();
        if (statsResult?.results) statsResult.results.forEach(r => statsMap.set(r.id, r));
        
        const dailyMap = new Map(); 
        if (dailyResult?.results) dailyResult.results.forEach(r => dailyMap.set(r.link_id, r.count));

        const periodMap = new Map(); 
        if (periodResult?.results) periodResult.results.forEach(r => periodMap.set(r.link_id, r.count));

        const monthContextMap = new Map(); 
        if (monthContextResult?.results) monthContextResult.results.forEach(r => monthContextMap.set(r.link_id, r.count));

        const monthTotalClicks = monthTotalResult?.results?.[0]?.total || 0;
        
        return new Response(
            renderAdminDashboard(LINKS_DATA, FRIENDS_DATA, statsMap, dailyMap, periodMap, monthContextMap, monthTotalClicks, TITLE, selectedDateOrMonth, isDayMode, FONT_STACK, RAW_IMG, DEFAULT_IMG, dateKey, todayStr), 
            { headers: { "content-type": "text/html;charset=UTF-8" } }
        );

      } catch (dbErr) {
        return new Response(`Data Error: ${dbErr.message}`, { status: 500 });
      }
    }

    if (url.pathname === "/admin/logout") return new Response(null, { status: 302, headers: { 'Location': '/admin', 'Set-Cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` } });

    // --- 跳转逻辑 ---
    if (url.pathname.startsWith("/go/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return new Response('Invalid URL', { status: 400 });
      const id = parts[1];
      const isBackup = parts[2] === "backup";
      const item = LINKS_DATA.find(l => l.id === id);
      if (!item) return new Response('Link not found', { status: 404 });
      const targetUrl = isBackup && item.backup_url ? item.backup_url : item.url;
      if (!targetUrl) return new Response('No valid URL available', { status: 400 });
      if (env.db) context.waitUntil(recordClick(env.db, isBackup ? `${id}_backup` : id, `${item.name}${isBackup ? "(备用)" : ""}`, 'link', currYear, dateKey, fullTimeStr, request));
      return Response.redirect(targetUrl, 302);
    }

    if (url.pathname.startsWith("/fgo/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return new Response('Invalid URL', { status: 400 });
      const fid = parts[1];
      const friend = FRIENDS_DATA.find(f => f.id === fid);
      if (!friend) return new Response('Friend link not found', { status: 404 });
      if (!friend.url) return new Response('No valid URL available', { status: 400 });
      if (env.db) context.waitUntil(recordClick(env.db, friend.id, friend.name, 'friend', currYear, dateKey, fullTimeStr, request));
      return Response.redirect(friend.url, 302);
    }

    // --- 前台主页 ---
    return new Response(renderNewNavHTML(TITLE, SUBTITLE, RAW_IMG, DEFAULT_IMG, CONTACT_URL, LINKS_DATA, FRIENDS_DATA, FONT_STACK), { headers: { "content-type": "text/html;charset=UTF-8" } });

  } catch (err) {
    return new Response(`🚨 System Error: ${err.message}`, { status: 500 });
  }
}

async function recordClick(db, id, name, type, y, m, timeStr, request) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    await db.prepare("INSERT INTO logs (link_id, click_time, month_key, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)").bind(id, timeStr, m, ip, userAgent).run();
    await db.prepare(`INSERT INTO stats (id, name, type, total_clicks, year_clicks, month_clicks, day_clicks, last_year, last_month, last_day, last_time) 
      VALUES (?1, ?2, ?3, 1, 1, 1, 1, ?4, ?5, ?7, ?6) 
      ON CONFLICT(id) DO UPDATE SET 
        total_clicks = total_clicks + 1, 
        year_clicks = CASE WHEN last_year = ?4 THEN year_clicks + 1 ELSE 1 END, 
        month_clicks = CASE WHEN last_month = ?5 THEN month_clicks + 1 ELSE 1 END, 
        day_clicks = CASE WHEN last_day = ?7 THEN day_clicks + 1 ELSE 1 END, 
        last_year = ?4, last_month = ?5, last_day = ?7, last_time = ?6, 
        name = ?2, type = ?3`).bind(id, name, type, y, m, timeStr, timeStr.substring(0, 10)).run();
  } catch (e) { console.error("Record click err:", e); }
}

// 辅助函数: 生成 Head
function getHead(t, fs) {
  return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title><style>:root{--glass:rgba(15,23,42,0.6);--border:rgba(255,255,255,0.15);--text-shadow:0 2px 4px rgba(0,0,0,0.8)}body{margin:0;min-height:100vh;font-family:${fs};color:#fff;display:flex;justify-content:center;align-items:center}.glass-panel{background:var(--glass);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,0.2);border-radius:16px}h1,div,span,a{text-shadow:var(--text-shadow)}</style>`;
}

// 🟢 样式生成函数：处理多重背景
function getBgStyle(userImg, defaultImg) {
  return `background-image: url('${userImg}'), url('${defaultImg}'); background-size: cover; background-position: center; background-attachment: fixed; background-repeat: no-repeat;`;
}

// --- 后台仪表盘渲染 ---
function renderAdminDashboard(LINKS, FRIENDS, statsMap, dailyMap, periodMap, monthContextMap, monthTotalClicks, T, m, isDayMode, FS, IMG, DEF_IMG, dateKey, todayStr) {
  // ... (数据计算逻辑保持 V9.6 不变) ...
  const safeLinks = Array.isArray(LINKS) ? LINKS : [];
  const safeFriends = Array.isArray(FRIENDS) ? FRIENDS : [];
  const activeIds = new Set([ ...safeLinks.map(i => i.id), ...safeFriends.map(i => i.id) ]);
  let historyTotal = 0;
  for (let v of statsMap.values()) { if (activeIds.has(v.id)) historyTotal += (v.total_clicks || 0); }
  let viewTotalDenominator = 0;
  if (isDayMode) { for(let c of monthContextMap.values()) viewTotalDenominator += c; } else { for(let c of periodMap.values()) viewTotalDenominator += c; }
  let prevDay = m, nextDay = m;
  let prevMonthStr = "", nextMonthStr = "";
  try {
      if (isDayMode) {
        const d = new Date(m);
        d.setDate(d.getDate()-1); prevDay = d.toISOString().split('T')[0];
        d.setDate(d.getDate()+2); nextDay = d.toISOString().split('T')[0];
      }
      const currentY_int = parseInt(m.substring(0, 4));
      const currentM_int = parseInt(m.substring(5, 7));
      let prevM_Y = currentY_int, prevM_M = currentM_int - 1;
      if (prevM_M === 0) { prevM_Y -= 1; prevM_M = 12; }
      prevMonthStr = `${prevM_Y}_${String(prevM_M).padStart(2,'0')}`;
      let nextM_Y = currentY_int, nextM_M = currentM_int + 1;
      if (nextM_M === 13) { nextM_Y += 1; nextM_M = 1; }
      nextMonthStr = `${nextM_Y}_${String(nextM_M).padStart(2,'0')}`;
  } catch(e) {}

  const buildCard = (id, name, emoji, isMini) => {
    const stat = statsMap.get(id) || { total_clicks: 0, last_time: '' };
    const realTodayVal = dailyMap.get(id) || 0; 
    const selectedTargetVal = periodMap.get(id) || 0; 
    const monthContextVal = monthContextMap.get(id) || 0; 
    let col2Label, col2Val, col3Label, col3Val, progressVal = 0;
    if (isDayMode) {
        col2Label = (m === todayStr) ? "今日" : "当日"; 
        col2Val = selectedTargetVal;
        col3Label = "当月";
        col3Val = monthContextVal;
        progressVal = viewTotalDenominator > 0 ? ((monthContextVal / viewTotalDenominator) * 100).toFixed(1) : 0;
    } else {
        col2Label = "今日"; 
        col2Val = realTodayVal;
        col3Label = (m === dateKey) ? "本月" : "当月";
        col3Val = selectedTargetVal;
        progressVal = viewTotalDenominator > 0 ? ((selectedTargetVal / viewTotalDenominator) * 100).toFixed(1) : 0;
    }
    let timeDisplay = stat.last_time || '暂无';
    let timeIcon = '🕒';
    if (timeDisplay !== '暂无') {
        if(isDayMode) { timeDisplay = timeDisplay.split(' ')[1] || timeDisplay; } 
        else { timeDisplay = timeDisplay.split(' ')[0].substring(5); timeIcon = '📅'; }
    }
    if (isMini) {
      return `<div class="g-panel mini" onclick="openLog('${id}','${m}','${name}')">
        <div class="mini-main"><span class="mini-name" title="${name}">${name}</span><span class="mini-tag" style="color:${isDayMode?'#fbbf24':'#38bdf8'}">${isDayMode ? selectedTargetVal : selectedTargetVal}</span></div>
        <div class="mini-sub"><span class="mini-time">${timeDisplay}</span></div></div>`;
    }
    return `<div class="g-panel card" onclick="openLog('${id}','${m}','${name}')">
      <div class="row top"><div style="display:flex;align-items:center;gap:12px;overflow:hidden;flex:1"><span style="font-size:1.6em;flex-shrink:0">${emoji || '🔗'}</span><span class="card-title">${name}</span></div><div class="pct">${progressVal}%</div></div>
      <div class="row data"><div class="col left"><span class="lbl">历史</span><span class="val grad-white">${stat.total_clicks||0}</span></div><div class="col mid"><span class="lbl">${col2Label}</span><span class="val grad-gold">${col2Val}</span></div><div class="col right"><span class="lbl">${col3Label}</span><span class="val grad-blue">${col3Val}</span></div></div>
      <div class="bar"><div style="width:${progressVal}%"></div></div><div class="time">${timeIcon} ${timeDisplay}</div></div>`;
  };

  const linkHtml = safeLinks.map(i => buildCard(i.id, i.name, i.emoji, false)).join('');
  const friendHtml = safeFriends.map(i => buildCard(i.id, i.name, '', true)).join('');

  return `<!DOCTYPE html><html><head>${getHead(T, FS)}<style>
    :root { --glass: rgba(30,41,59,0.75); --border: rgba(255,255,255,0.15); --text-main: #f1f5f9; --text-sub: #cbd5e1; }
    .main { width:94%; max-width:1200px; padding:20px 0 60px; }
    .header { padding:30px; text-align:center; background:var(--glass); backdrop-filter:blur(20px); border:1px solid var(--border); border-radius:16px; margin-bottom:20px; display:flex; flex-direction:column; align-items:center; gap:10px; }
    .head-title { font-size:2rem; margin:0; color:#fff; font-weight:800; text-shadow:0 2px 10px rgba(0,0,0,0.3); }
    .badge { background:#38bdf8; color:#0f172a; padding:4px 12px; border-radius:20px; font-weight:800; font-size:0.85rem; }
    .stats-grp { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:15px; margin-bottom:25px; }
    .s-card { background:var(--glass); border:1px solid var(--border); border-radius:16px; padding:20px; text-align:center; backdrop-filter:blur(10px); }
    .s-val { font-size:2rem; font-weight:700; margin:5px 0; color:#fff; text-shadow:0 0 10px rgba(255,255,255,0.2); }
    .s-lbl { font-size:0.85rem; color:var(--text-sub); text-transform:uppercase; letter-spacing:1px; font-weight:600; }
    .date-bar { display:flex; justify-content:center; gap:10px; margin:20px 0; flex-wrap:wrap; align-items:center; background:rgba(15,23,42,0.85); padding:12px 20px; border-radius:50px; border:1px solid var(--border); backdrop-filter:blur(10px); box-shadow:0 10px 25px rgba(0,0,0,0.3); }
    .btn { background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.1); color:var(--text-sub); padding:8px 16px; border-radius:20px; text-decoration:none; transition:0.2s; font-size:0.9rem; display:flex; align-items:center; }
    .btn:hover { background:#38bdf8; color:#fff; border-color:#38bdf8; }
    .btn.active { background:#38bdf8; color:#0f172a; font-weight:bold; }
    .date-display { display:flex; align-items:center; gap:8px; margin:0 15px; position:relative; }
    .date-val { color:#fff; font-family:monospace; font-size:1.4rem; font-weight:800; text-shadow: 0 0 10px rgba(56,189,248,0.5); }
    input[type="date"] { position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%; }
    .g-panel { background:var(--glass); border:1px solid var(--border); border-radius:16px; padding:20px; transition:0.2s; cursor:pointer; display:flex; flex-direction:column; justify-content:space-between; }
    .g-panel:hover { transform: translateY(-3px); border-color: #38bdf8; background: rgba(30,41,59,0.9); box-shadow:0 5px 15px rgba(0,0,0,0.2); }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:15px; }
    .mini-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px; }
    .lbl-sec { color:#38bdf8; font-weight:800; margin:30px 0 10px 5px; text-transform:uppercase; letter-spacing:1px; }
    .row { display:flex; justify-content:space-between; align-items:center; }
    .top { margin-bottom:15px; }
    .card-title { font-weight:700; font-size:1.05rem; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pct { background:rgba(56,189,248,0.2); color:#38bdf8; padding:3px 8px; border-radius:6px; font-weight:800; font-size:0.85rem; flex-shrink:0; }
    .data { margin-bottom:12px; font-size:0.9rem; color:var(--text-sub); }
    .col { display:flex; flex-direction:column; align-items:center; }
    .col.left { align-items:flex-start; } .col.right { align-items:flex-end; }
    .lbl { font-size:0.75rem; color:var(--text-sub); margin-bottom:2px; opacity:0.8; }
    .val { font-weight:700; font-size:1.1rem; }
    .grad-white { color:#fff; }
    .grad-gold { color:#fbbf24; text-shadow:0 0 8px rgba(251,191,36,0.4); }
    .grad-blue { color:#38bdf8; text-shadow:0 0 8px rgba(56,189,248,0.4); }
    .bar { height:4px; background:rgba(255,255,255,0.1); border-radius:2px; overflow:hidden; margin-bottom:8px; }
    .bar div { height:100%; background:linear-gradient(90deg, #fbbf24, #38bdf8); }
    .time { font-size:0.8rem; color:#94a3b8; text-align:right; font-family:monospace; }
    .mini { padding:15px; height:80px; }
    .mini-main { display:flex; align-items:center; margin-bottom:5px; gap:8px; width:100%; }
    .mini-name { font-weight:600; font-size:0.95rem; color:#fff; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .mini-tag { background:#38bdf8; color:#0f172a; padding:2px 8px; border-radius:10px; font-size:0.8rem; font-weight:800; flex-shrink:0; }
    .mini-sub { text-align:right; margin-top:auto; }
    .mini-time { font-size:0.75rem; color:var(--text-sub); font-family:monospace; }
    .drawer { position:fixed; top:0; right:-400px; width:360px; height:100vh; background:#0f172a; border-left:1px solid #333; transition:0.3s; z-index:99; display:flex; flex-direction:column; box-shadow: -10px 0 30px rgba(0,0,0,0.5); }
    .drawer.open { right:0; }
    .mask { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:90; opacity:0; pointer-events:none; transition:0.3s; }
    .mask.show { opacity:1; pointer-events:auto; }
    @media (max-width:768px) {
      .stats-grp { grid-template-columns:1fr; }
      .grid { grid-template-columns:1fr; }
      .date-val { font-size:1.2rem; }
      .date-bar { padding:10px 15px; }
      .btn { padding:6px 12px; font-size:0.85rem; }
    }
  </style></head>
  <body style="${getBgStyle(IMG, DEF_IMG)} display:flex; justify-content:center; margin:0; min-height: 100vh;">
    <div class="main">
      <div class="header">
        <h1 class="head-title">📊 数据看板</h1>
        <div style="display:flex;align-items:center;gap:15px;flex-wrap:wrap;justify-content:center">
            <span style="font-family:monospace;opacity:0.8;color:var(--text-sub)">${m}</span>
            <span class="badge">历史总计 ${historyTotal}</span>
        </div>
        <a href="/admin/logout" style="color:#f87171;text-decoration:none;font-size:0.85rem;margin-top:5px">安全退出</a>
      </div>

      <div class="stats-grp">
        <div class="s-card"><div class="s-lbl">总项目</div><div class="s-val">${safeLinks.length}</div></div>
        <div class="s-card"><div class="s-lbl">本月总点击</div><div class="s-val" style="color:#38bdf8">${monthTotalClicks}</div></div>
        <div class="s-card"><div class="s-lbl">活跃项目</div><div class="s-val">${Array.from(statsMap.values()).filter(c=>c.total_clicks>0).length}</div></div>
      </div>

      <div class="date-bar">
        <a href="/admin?m=${prevMonthStr}" class="btn" title="上个月">⏪</a>
        <a href="/admin?m=${prevDay}" class="btn">◀</a>
        <div class="date-display" title="点击切换日期">
            <span class="date-val">${m}</span>
            <input type="date" value="${isDayMode ? m : ''}" onchange="if(this.value) location.href='/admin?m='+this.value">
        </div>
        <a href="/admin?m=${nextDay}" class="btn">▶</a>
        <a href="/admin?m=${nextMonthStr}" class="btn" title="下个月">⏩</a>
        <div style="width:1px;height:15px;background:rgba(255,255,255,0.2);margin:0 8px"></div>
        <a href="/admin?m=${todayStr}" class="btn ${m===todayStr?'active':''}">今日</a>
        <a href="/admin?m=${dateKey}" class="btn ${m===dateKey?'active':''}">本月</a>
      </div>

      <div class="lbl-sec">💎 精选数据</div>
      <div class="grid">${linkHtml}</div>
      <div class="lbl-sec">🔗 友链数据</div>
      <div class="mini-grid">${friendHtml}</div>
    </div>

    <div class="mask" id="mask" onclick="cls()"></div>
    <div class="drawer" id="dr">
      <div style="padding:20px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;justify-content:space-between">
        <h3 style="margin:0;color:#fff" id="dt">详情</h3><button onclick="cls()" style="background:none;border:none;color:#fff;font-size:1.2rem;cursor:pointer">×</button>
      </div>
      <ul id="dl" style="flex:1;overflow-y:auto;padding:0;margin:0;list-style:none"></ul>
    </div>

    <script>
      async function openLog(id,m,n){
        document.getElementById('dr').classList.add('open');
        document.getElementById('mask').classList.add('show');
        document.getElementById('dt').innerText = n + ' 记录';
        const l=document.getElementById('dl');
        l.innerHTML='<li style="padding:20px;text-align:center;color:#cbd5e1">加载中...</li>';
        try{
          const r=await fetch(\`/admin/api/logs?id=\${id}&m=\${m}\`);
          const data=await r.json();
          if(!data.length){l.innerHTML='<li style="padding:20px;text-align:center;opacity:0.5;color:#cbd5e1">该时段无记录</li>';return;}
          l.innerHTML=data.map((x,i)=>\`<li style="padding:12px 20px;border-bottom:1px solid rgba(255,255,255,0.1);font-size:0.85rem">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="color:#38bdf8">#\${i+1}</span>
              <span style="opacity:0.9;color:#e2e8f0">\${x.click_time.split(' ')[1]}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-family:monospace;font-size:0.75rem;color:#94a3b8;flex-wrap:wrap;gap:8px">
              <span>\${x.ip_address}</span><span>\${x.click_time.split(' ')[0]}</span>
            </div>
          </li>\`).join('');
        }catch(e){l.innerHTML='<li style="padding:20px;text-align:center;color:#f87171">加载失败</li>';console.error(e);}
      }
      function cls(){document.getElementById('dr').classList.remove('open');document.getElementById('mask').classList.remove('show');}
    </script>
  </body></html>`;
}

// --- 后台登录页 ---
function renderLoginPageV10(T, FS, IMG, DEF_IMG, errorMsg = '') {
  return `<!DOCTYPE html><html><head>${getHead(T, FS)}<style>
    .box { padding: 50px 40px; text-align: center; width: 340px; display: flex; flex-direction: column; align-items: center; }
    h1 { font-size: 1.8rem; margin-bottom: 30px; }
    form { width: 100%; display: flex; flex-direction: column; align-items: center; }
    input { width: 100%; padding: 16px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; color: #fff; margin-bottom: 20px; outline: none; transition: 0.3s; font-size: 1rem; box-sizing: border-box; text-align: center; }
    input:focus { border-color: #a78bfa; background: rgba(0,0,0,0.5); transform: scale(1.02); }
    input::placeholder { color: rgba(255,255,255,0.5); }
    button { width: 100%; padding: 16px; background: #fff; color: #000; border: none; border-radius: 12px; font-weight: 800; cursor: pointer; font-size: 1rem; transition: 0.3s; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
    button:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.3); }
    .error-msg { color: #f87171; margin-bottom: 15px; font-size: 0.9rem; min-height: 20px; }
  </style></head>
  <body style="${getBgStyle(IMG, DEF_IMG)} display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;">
    <div class="glass-panel box">
        <h1>🔐 管理后台</h1>
        ${errorMsg ? `<div class="error-msg">❌ ${errorMsg}</div>` : ''}
        <form method="POST">
            <input type="password" name="password" placeholder="请输入访问口令" required autofocus>
            <button type="submit">立即登录</button>
        </form>
    </div>
  </body></html>`;
}

// 前台渲染 (复原：移除纯色背景)
function renderNewNavHTML(TITLE, SUBTITLE, BG_IMG_URL, DEF_IMG, CONTACT, LINKS, FRIENDS, FONT_STACK) {
  const safeLinks = Array.isArray(LINKS) ? LINKS : [];
  const safeFriends = Array.isArray(FRIENDS) ? FRIENDS : [];
  const cardsHtml = safeLinks.map(item => {
    const mainUrl = `/go/${item.id}`;
    const backupHtml = item.backup_url ? `<a href="/go/${item.id}/backup" class="tag-backup" title="备用线路">备用</a>` : '';
    return `<div class="glass-card resource-card-wrap"><a href="${mainUrl}" class="resource-main-link"><div class="card-icon">${item.emoji || '🔗'}</div><div class="card-info"><h3>${item.name}</h3><p>⚠️ ${item.note || '无说明'}</p></div></a>${backupHtml}</div>`;
  }).join('');
  const friendsHtml = safeFriends.map((f) => `<a href="/fgo/${f.id}" target="_blank" class="glass-card partner-card">${f.name}</a>`).join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${TITLE}</title><style>
    :root { --glass: rgba(255,255,255,0.15); --border: rgba(255,255,255,0.2); --text-main: #f1f5f9; --text-sub: #e2e8f0; --warning: #fcd34d; --primary: #8b5cf6; --backdrop-blur: 16px; --transition: 0.3s ease; }
    .dark-theme { --glass: rgba(15,23,42,0.8); --border: rgba(255,255,255,0.1); }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body { 
      font-family: ${FONT_STACK}; color: var(--text-main); 
      ${getBgStyle(BG_IMG_URL, DEF_IMG)}
      min-height: 100vh; display: flex; flex-direction: column; align-items: center; 
      padding: 40px 20px 100px; position: relative; transition: var(--transition);
    }
    /* 移除 .dark-theme 的 background-color 覆盖，以保持背景图可见 */
    .container { width: 100%; max-width: 1200px; }
    .glass-card { background: var(--glass); backdrop-filter: blur(var(--backdrop-blur)); -webkit-backdrop-filter: blur(var(--backdrop-blur)); border: 1px solid var(--border); border-radius: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.15); transition: var(--transition); }
    .header { text-align: center; padding: 40px 20px; margin-bottom: 30px; }
    .header h1 { font-size: 3rem; font-weight: 800; margin-bottom: 10px; text-shadow: 0 4px 15px rgba(0,0,0,0.4); }
    .header p { font-size: 1.1rem; opacity: 0.9; color: var(--text-sub); }
    .section-title { font-size: 1rem; font-weight: 800; color: #7dd3fc; margin-bottom: 15px; margin-left: 5px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.6); }
    .grid-resources { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 40px; }
    .resource-card-wrap { display: flex; position: relative; overflow: hidden; height: 100px; opacity: 0; transform: translateY(20px); animation: fadeInUp 0.6s forwards; }
    .partner-card { text-decoration: none; color: #fff; text-align: center; padding: 15px 10px; font-size: 0.9rem; border-radius: 12px; text-shadow: 0 1px 3px rgba(0,0,0,0.6); transition: var(--transition); height: 60px; display: flex; align-items: center; justify-content: center; opacity: 0; transform: translateY(20px); animation: fadeInUp 0.6s forwards; }
    .resource-card-wrap:hover, .partner-card:hover { background: rgba(255,255,255,0.25); transform: translateY(-5px); box-shadow: 0 12px 40px rgba(0,0,0,0.25); }
    .resource-main-link { flex: 1; display: flex; align-items: center; text-decoration: none; color: white; padding: 20px; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
    .card-icon { font-size: 2.5rem; margin-right: 15px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); }
    .card-info h3 { font-size: 1.2rem; font-weight: 700; margin-bottom: 4px; }
    .card-info p { font-size: 0.85rem; color: var(--warning); font-weight: 500; }
    .tag-backup { width: 36px; background: rgba(0,0,0,0.3); border-left: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #e2e8f0; writing-mode: vertical-rl; letter-spacing: 2px; text-decoration: none; transition: 0.3s; }
    .tag-backup:hover { background: var(--primary); color: white; }
    .grid-partners { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 15px; margin-bottom: 40px; }
    .fab-support { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: linear-gradient(135deg, #8b5cf6, #a855f7); color: white; padding: 12px 30px; border-radius: 50px; text-decoration: none; font-weight: bold; box-shadow: 0 10px 25px rgba(139,92,246,0.5); z-index: 100; transition: var(--transition); }
    .fab-support:hover { transform: translateX(-50%) scale(1.05); box-shadow: 0 12px 30px rgba(139,92,246,0.7); }
    .search-container { margin-bottom: 30px; text-align: center; width: 100%; }
    .search-box { width: 100%; max-width: 500px; padding: 15px 20px; border-radius: 50px; border: none; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); color: white; font-size: 1rem; box-shadow: 0 4px 20px rgba(0,0,0,0.1); transition: var(--transition); }
    .search-box::placeholder { color: rgba(255,255,255,0.7); }
    .search-box:focus { outline: none; background: rgba(255,255,255,0.3); }
    .theme-toggle { position: fixed; top: 20px; right: 20px; width: 50px; height: 50px; border-radius: 50%; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 100; color: white; font-size: 1.2rem; }
    .no-result { text-align: center; padding: 40px 0; color: var(--text-sub); font-size: 1.2rem; display: none; }
    @keyframes fadeInUp { to { opacity: 1; transform: translateY(0); } }
    @media (max-width: 768px) { 
      .header h1 { font-size: 2.2rem; }
      .container { padding: 0 10px; }
      .grid-resources { grid-template-columns: 1fr; gap: 15px; }
      .resource-card-wrap { height: auto; min-height: 100px; }
      .grid-partners { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
      .fab-support { padding: 10px 25px; font-size: 0.9rem; }
    }
  </style>
  <script>
    function initSearch() {
      const searchBox = document.querySelector('.search-box');
      const noResult = document.createElement('div');
      noResult.className = 'no-result';
      noResult.innerHTML = '😕 暂无匹配结果';
      document.querySelector('.grid-resources').after(noResult);
      if (!searchBox) return;
      searchBox.addEventListener('keydown', e => e.key === 'Enter' && e.preventDefault());
      searchBox.addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase().trim();
        const cards = document.querySelectorAll('.resource-card-wrap, .partner-card');
        let hasMatch = false;
        cards.forEach(card => {
          const isMatch = !searchTerm || card.textContent.toLowerCase().includes(searchTerm);
          card.style.display = isMatch ? 'flex' : 'none';
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
      const baseDelay = 0.1;
      const resources = document.querySelectorAll('.resource-card-wrap');
      resources.forEach((card, i) => card.style.animationDelay = \`\${i * baseDelay}s\`);
      const friends = document.querySelectorAll('.partner-card');
      friends.forEach((card, i) => card.style.animationDelay = \`\${(resources.length + i) * baseDelay}s\`);
    }
    document.addEventListener('DOMContentLoaded', () => { initSearch(); initThemeToggle(); initAnimation(); });
  </script></head><body>
  <button class="theme-toggle" title="切换主题">🌙</button>
  <div class="container">
    <div class="header glass-card"><h1>${TITLE}</h1><p>${SUBTITLE}</p></div>
    <div class="search-container"><input type="text" class="search-box" placeholder="搜索导航项目..." /></div>
    <div class="section-title">💎 精选</div>
    <div class="grid-resources">${cardsHtml}</div>
    <div class="section-title">🔗 友链</div>
    <div class="grid-partners">${friendsHtml}</div>
  </div>
  <a href="${CONTACT}" class="fab-support">💬 获取支持</a>
  </body></html>`;
}
