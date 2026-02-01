/**
 * FlarePortal - Cloudflare Pages (V9.0 终极精修版)
 * 1. 字体颜色：全面提亮，高对比度，清晰护眼
 * 2. 顶部看板：中间卡片固定显示"当月总点击"
 * 3. 导航栏：增加显眼的日期文字显示，明确当前查看的日期
 * 4. 细节修复：输入框对齐、友链布局防挤压
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const COOKIE_NAME = "nav_session_v9_final";

  // =================================================================
  // 1. 配置区域
  // =================================================================
  
  const TITLE = env.TITLE || "云端加速 · 精选导航";
  const SUBTITLE = env.SUBTITLE || "优质资源推荐 · 随时畅联";
  const ADMIN_PASS = env.admin || "123456"; 
  const CONTACT_URL = env.CONTACT_URL || "https://t.me/Fuzzy_Fbot";

  const DEFAULT_IMG = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=2073";
  const IMG_LIST = (env.img || DEFAULT_IMG).split(',').map(i => i.trim()).filter(i => i);
  const RAW_IMG = IMG_LIST[Math.floor(Math.random() * IMG_LIST.length)];
  
  const getJson = (k) => { try { return env[k] ? JSON.parse(env[k]) : []; } catch(e) { return []; } };
  const LINKS_DATA = getJson('LINKS');
  const FRIENDS_DATA = getJson('FRIENDS');

  // =================================================================
  // 2. 时间工具
  // =================================================================

  const getNow = () => new Date(new Date().getTime() + 8 * 3600000); 
  const now = getNow();
  const currYear = now.getFullYear().toString();
  const currMonth = (now.getMonth() + 1).toString().padStart(2, '0');
  const currDay = now.getDate().toString().padStart(2, '0');
  
  const currDateKey = `${currYear}_${currMonth}`; 
  const todayStr = `${currYear}-${currMonth}-${currDay}`; 
  const fullTimeStr = now.toISOString().replace('T', ' ').substring(0, 19);

  const FONT_STACK = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

  try {
    // API: 获取日志
    if (url.pathname === "/admin/api/logs") {
      const id = url.searchParams.get('id');
      const d = url.searchParams.get('d') || todayStr;
      if (!env.db) return new Response(JSON.stringify({ error: 'DB Error' }), { status: 500 });
      try {
        const queryTime = d.replace('_', '-'); 
        const { results } = await env.db.prepare(
          "SELECT click_time, ip_address, user_agent FROM logs WHERE link_id = ? AND click_time LIKE ? || '%' ORDER BY id DESC LIMIT 50"
        ).bind(id, queryTime).all();
        return new Response(JSON.stringify(results || []), { headers: { "content-type": "application/json" } });
      } catch (dbErr) { return new Response(JSON.stringify({ error: 'Log Error' }), { status: 500 }); }
    }

    // --- 后台管理 (/admin) ---
    if (url.pathname === "/admin") {
      const cookie = request.headers.get('Cookie') || '';
      
      if (request.method === 'POST') {
        const formData = await request.formData();
        if (formData.get('password') === ADMIN_PASS) {
          return new Response(null, { status: 302, headers: { 'Location': '/admin', 'Set-Cookie': `${COOKIE_NAME}=true; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict` } });
        } else {
          return new Response(renderLoginPage(TITLE, RAW_IMG, FONT_STACK, '密码错误'), { headers: { "content-type": "text/html;charset=UTF-8" } });
        }
      }
      if (!cookie.includes(`${COOKIE_NAME}=true`)) {
        return new Response(renderLoginPage(TITLE, RAW_IMG, FONT_STACK, ''), { headers: { "content-type": "text/html;charset=UTF-8" } });
      }

      // 获取选定日期 (默认今天)
      const selectedDate = url.searchParams.get('d') || todayStr;
      
      // 计算选定日期所属的月份 Key (用于查询当月总数)
      // 例如：2026-02-01 -> 2026_02
      let selMonthKey = selectedDate.substring(0, 7).replace('-', '_'); 

      try {
        if (!env.db) throw new Error("D1 Database Not Bound");

        // 并行查询数据
        const [statsResult, dailyResult, periodResult, monthTotalResult] = await Promise.all([
          // 1. 历史总表
          env.db.prepare("SELECT * FROM stats").all(),
          
          // 2. 今日实时点击
          env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE click_time LIKE ? || '%' GROUP BY link_id").bind(todayStr).all(),
          
          // 3. 选定日期/期间点击 (列表用)
          env.db.prepare("SELECT link_id, COUNT(*) as count FROM logs WHERE click_time LIKE ? || '%' GROUP BY link_id").bind(selectedDate).all(),

          // 4. 看板中间卡片数据：选定月份的总点击数
          env.db.prepare("SELECT COUNT(*) as total FROM logs WHERE month_key = ?").bind(selMonthKey).all()
        ]);

        const statsMap = new Map();
        if(statsResult.results) statsResult.results.forEach(r => statsMap.set(r.id, r));
        
        const dailyMap = new Map();
        if(dailyResult.results) dailyResult.results.forEach(r => dailyMap.set(r.link_id, r.count));
        
        const periodMap = new Map();
        if(periodResult.results) periodResult.results.forEach(r => periodMap.set(r.link_id, r.count));

        // 获取该月总点击数
        const monthTotalClicks = monthTotalResult.results[0]?.total || 0;

        return new Response(
          renderAdminDashboard(LINKS_DATA, FRIENDS_DATA, statsMap, dailyMap, periodMap, monthTotalClicks, TITLE, selectedDate, todayStr, FONT_STACK, RAW_IMG), 
          { headers: { "content-type": "text/html;charset=UTF-8" } }
        );
      } catch (dbErr) { return new Response(`DB Error: ${dbErr.message}`, { status: 500 }); }
    }

    if (url.pathname === "/admin/logout") {
      return new Response(null, { status: 302, headers: { 'Location': '/admin', 'Set-Cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0` } });
    }

    // --- 跳转逻辑 ---
    const handleRedirect = async (id, isBackup, targetUrl, type) => {
        if (env.db) context.waitUntil(recordClick(env.db, isBackup ? `${id}_backup` : id, isBackup ? "(备用)" : "", type, currYear, currDateKey, fullTimeStr, request));
        return Response.redirect(targetUrl, 302);
    };

    if (url.pathname.startsWith("/go/")) {
      const parts = url.pathname.split("/");
      const id = parts[2];
      const isBackup = parts[3] === "backup";
      const item = LINKS_DATA.find(l => l.id === id);
      if (item && (item.url || (isBackup && item.backup_url))) {
        return handleRedirect(id, isBackup, isBackup && item.backup_url ? item.backup_url : item.url, 'link');
      }
      return new Response('Link not found', { status: 404 });
    }

    if (url.pathname.startsWith("/fgo/")) {
      const parts = url.pathname.split("/");
      const fid = parts[2];
      const friend = FRIENDS_DATA.find(f => f.id === fid);
      if (friend && friend.url) return handleRedirect(friend.id, false, friend.url, 'friend');
      return new Response('Friend not found', { status: 404 });
    }

    return new Response(renderFrontPage(TITLE, SUBTITLE, RAW_IMG, CONTACT_URL, LINKS_DATA, FRIENDS_DATA, FONT_STACK), { headers: { "content-type": "text/html;charset=UTF-8" } });

  } catch (err) { return new Response(`Error: ${err.message}`, { status: 500 }); }
}

// 记录数据
async function recordClick(db, id, nameSuffix, type, y, m, timeStr, req) {
  try {
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown'; 
    const ua = req.headers.get('User-Agent') || 'unknown';
    await db.prepare("INSERT INTO logs (link_id, click_time, month_key, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)").bind(id, timeStr, m, ip, ua).run();
    const day = timeStr.substring(0, 10);
    await db.prepare(`INSERT INTO stats (id, name, type, total_clicks, year_clicks, month_clicks, day_clicks, last_year, last_month, last_day, last_time) VALUES (?1, ?2, ?3, 1, 1, 1, 1, ?4, ?5, ?7, ?6) ON CONFLICT(id) DO UPDATE SET total_clicks = total_clicks + 1, year_clicks = CASE WHEN last_year = ?4 THEN year_clicks + 1 ELSE 1 END, month_clicks = CASE WHEN last_month = ?5 THEN month_clicks + 1 ELSE 1 END, day_clicks = CASE WHEN last_day = ?7 THEN day_clicks + 1 ELSE 1 END, last_year = ?4, last_month = ?5, last_day = ?7, last_time = ?6, name = name || ?8`).bind(id, "name_placeholder", type, y, m, timeStr, day, nameSuffix).run();
  } catch (e) { console.error("Rec Err", e); }
}

// =================================================================
// UI 渲染函数群 (V9.0 高对比度版)
// =================================================================

// 1. 前台主页
function renderFrontPage(TITLE, SUBTITLE, BG, CONTACT, LINKS, FRIENDS, FS) {
  const cards = LINKS.map(i => {
    const url = `/go/${i.id}`;
    const bk = i.backup_url ? `<a href="/go/${i.id}/backup" class="tag-bk" title="备用线路">备用</a>` : '';
    return `<div class="card-wrap"><a href="${url}" class="main-link"><div class="icon">${i.emoji}</div><div class="info"><h3>${i.name}</h3><p>${i.note||''}</p></div></a>${bk}</div>`;
  }).join('');
  const frs = FRIENDS.map(f => `<a href="/fgo/${f.id}" target="_blank" class="fr-card">${f.name}</a>`).join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${TITLE}</title><style>
    :root { --glass-bg: rgba(30, 41, 59, 0.6); --glass-border: rgba(255,255,255,0.1); }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${FS}; color: #e2e8f0; background: url('${BG}') center/cover fixed; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 40px 20px; }
    .container { width: 100%; max-width: 1200px; }
    .glass { background: var(--glass-bg); backdrop-filter: blur(20px); border: 1px solid var(--glass-border); border-radius: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
    .header { text-align: center; padding: 50px 20px; margin-bottom: 40px; }
    h1 { font-size: 2.8rem; margin-bottom: 15px; color: #fff; text-shadow: 0 4px 12px rgba(0,0,0,0.5); font-weight: 800; }
    .header p { font-size: 1.1rem; color: #cbd5e1; }
    .sec-title { color: #38bdf8; font-weight: 800; margin: 30px 0 15px 5px; text-transform: uppercase; letter-spacing: 1px; font-size: 0.9rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 40px; }
    .card-wrap { display: flex; position: relative; height: 100px; border-radius: 16px; background: rgba(30, 41, 59, 0.6); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); transition: 0.3s; overflow: hidden; }
    .card-wrap:hover { transform: translateY(-5px); background: rgba(30, 41, 59, 0.85); border-color: #38bdf8; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
    .main-link { flex: 1; display: flex; align-items: center; text-decoration: none; color: #fff; padding: 0 25px; }
    .icon { font-size: 2.5rem; margin-right: 20px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3)); }
    .info h3 { font-size: 1.1rem; margin-bottom: 5px; font-weight: 700; }
    .info p { font-size: 0.8rem; color: #94a3b8; }
    .tag-bk { width: 32px; background: rgba(0,0,0,0.4); border-left: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; color: #94a3b8; writing-mode: vertical-rl; text-decoration: none; transition: 0.2s; font-size: 0.75rem; letter-spacing: 2px; }
    .tag-bk:hover { background: #6366f1; color: #fff; }
    .fr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 15px; }
    .fr-card { text-decoration: none; color: #cbd5e1; text-align: center; padding: 12px; border-radius: 12px; background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255,255,255,0.05); transition: 0.3s; font-size: 0.9rem; }
    .fr-card:hover { background: rgba(30, 41, 59, 0.8); color: #38bdf8; border-color: #38bdf8; }
    .fab { position: fixed; bottom: 30px; padding: 12px 30px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; border-radius: 50px; text-decoration: none; font-weight: bold; box-shadow: 0 10px 30px rgba(99, 102, 241, 0.4); transition: 0.3s; z-index: 100; }
    .fab:hover { transform: translateY(-2px); box-shadow: 0 15px 40px rgba(99, 102, 241, 0.6); }
  </style></head><body>
  <div class="container">
    <div class="header glass"><h1>${TITLE}</h1><p>${SUBTITLE}</p></div>
    <div class="sec-title">💎 精选资源</div><div class="grid">${cards}</div>
    <div class="sec-title">🔗 合作伙伴</div><div class="fr-grid">${frs}</div>
  </div>
  <a href="${CONTACT}" class="fab">💬 客服支持</a>
  </body></html>`;
}

// 2. 后台看板 (V9 修复：高对比度、布局对齐、日期显眼)
function renderAdminDashboard(LINKS, FRIENDS, statsMap, dailyMap, periodMap, monthTotalClicks, T, selDate, todayStr, FS, IMG) {
  const safeLinks = Array.isArray(LINKS) ? LINKS : [];
  const safeFriends = Array.isArray(FRIENDS) ? FRIENDS : [];
  
  let histTotal = 0; for(let v of statsMap.values()) histTotal += (v.total_clicks || 0);
  
  // 选定期间总点击
  let periodTotal = 0; for(let c of periodMap.values()) periodTotal += c;

  const isDayMode = selDate.length > 7; 
  const thirdColLabel = isDayMode ? "当日" : "该月"; 

  const buildCard = (id, name, emoji, isMini) => {
    const stat = statsMap.get(id) || {};
    const dayCount = dailyMap.get(id) || 0; 
    const periodCount = periodMap.get(id) || 0;
    
    const p = periodTotal > 0 ? ((periodCount / periodTotal) * 100).toFixed(1) : 0;
    const timeDisplay = stat.last_time || '暂无';

    // 🟢 友链卡片：Flex布局修复，防止计数挤压
    if(isMini) {
      return `<div class="g-panel mini" onclick="openLog('${id}','${selDate}','${name}')">
        <div class="mini-main">
            <span class="mini-name" title="${name}">${name}</span>
            <span class="mini-tag">${periodCount}</span>
        </div>
        <div class="mini-sub">
            <span class="mini-time">${timeDisplay.split(' ')[1]||'-'}</span>
        </div>
      </div>`;
    }

    // 🔗 主链接卡片
    return `
    <div class="g-panel card" onclick="openLog('${id}','${selDate}','${name}')">
      <div class="row top">
        <div style="display:flex;align-items:center;gap:12px;overflow:hidden">
            <span style="font-size:1.6em;flex-shrink:0">${emoji}</span>
            <span class="card-title">${name}</span>
        </div>
        <div class="pct">${p}%</div>
      </div>
      <div class="row data">
        <div class="col left"><span class="lbl">历史</span><span class="val grad-white">${stat.total_clicks||0}</span></div>
        <div class="col mid"><span class="lbl">今日</span><span class="val grad-gold">${dayCount}</span></div>
        <div class="col right"><span class="lbl">${thirdColLabel}</span><span class="val grad-blue">${periodCount}</span></div>
      </div>
      <div class="bar"><div style="width:${p}%"></div></div>
      <div class="time">🕒 ${timeDisplay}</div>
    </div>`;
  };

  const linkHtml = safeLinks.map(i => buildCard(i.id, i.name, i.emoji, false)).join('');
  const friendHtml = safeFriends.map(i => buildCard(i.id, i.name, '', true)).join('');

  // 导航逻辑
  let prevDay = selDate, nextDay = selDate;
  if(isDayMode) {
      const d = new Date(selDate);
      d.setDate(d.getDate()-1); prevDay = d.toISOString().split('T')[0];
      d.setDate(d.getDate()+2); nextDay = d.toISOString().split('T')[0];
  }
  const currentY = todayStr.split('-')[0];
  const currentM = todayStr.substring(0, 7);
  
  // 月份计算
  const currentY_int = parseInt(selDate.substring(0, 4));
  const currentM_int = parseInt(selDate.substring(5, 7));
  let prevM_Y = currentY_int, prevM_M = currentM_int - 1;
  if(prevM_M === 0) { prevM_Y -= 1; prevM_M = 12; }
  const prevMonthStr = `${prevM_Y}-${String(prevM_M).padStart(2,'0')}`;
  let nextM_Y = currentY_int, nextM_M = currentM_int + 1;
  if(nextM_M === 13) { nextM_Y += 1; nextM_M = 1; }
  const nextMonthStr = `${nextM_Y}-${String(nextM_M).padStart(2,'0')}`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${T} - 统计</title><style>
    /* 1. 基础颜色提亮，背景通透 */
    :root { --glass: rgba(30, 41, 59, 0.75); --border: rgba(255, 255, 255, 0.15); --text-main: #f1f5f9; --text-sub: #cbd5e1; }
    body { margin:0; font-family:${FS}; color:var(--text-main); background:url('${IMG}') center/cover fixed; min-height:100vh; display:flex; justify-content:center; }
    .main { width:94%; max-width:1200px; padding:20px 0 60px; }
    
    .header { padding:30px; text-align:center; background:var(--glass); backdrop-filter:blur(20px); border:1px solid var(--border); border-radius:16px; margin-bottom:20px; display:flex; flex-direction:column; align-items:center; gap:10px; }
    .head-title { font-size:2rem; margin:0; color:#fff; font-weight:800; text-shadow:0 2px 10px rgba(0,0,0,0.3); }
    .badge { background:#38bdf8; color:#0f172a; padding:4px 12px; border-radius:20px; font-weight:800; font-size:0.85rem; }
    
    .stats-grp { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:15px; margin-bottom:25px; }
    .s-card { background:var(--glass); border:1px solid var(--border); border-radius:16px; padding:20px; text-align:center; backdrop-filter:blur(10px); }
    .s-val { font-size:2rem; font-weight:700; margin:5px 0; color:#fff; text-shadow:0 0 10px rgba(255,255,255,0.2); }
    .s-lbl { font-size:0.85rem; color:var(--text-sub); text-transform:uppercase; letter-spacing:1px; font-weight:600; }

    /* 🟢 修复的导航栏：清晰显示当前日期 */
    .date-bar { display:flex; justify-content:center; gap:10px; margin:20px 0; flex-wrap:wrap; align-items:center; background:rgba(15, 23, 42, 0.85); padding:12px 20px; border-radius:50px; border:1px solid var(--border); backdrop-filter:blur(10px); box-shadow:0 10px 25px rgba(0,0,0,0.3); }
    .btn { background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.1); color:var(--text-sub); padding:8px 16px; border-radius:20px; text-decoration:none; transition:0.2s; font-size:0.9rem; display:flex; align-items:center; }
    .btn:hover { background:#38bdf8; color:#fff; border-color:#38bdf8; }
    .btn.active { background:#38bdf8; color:#0f172a; font-weight:bold; }
    
    /* 日期显示区域 - 显眼 */
    .date-display { display:flex; align-items:center; gap:8px; margin:0 15px; position:relative; }
    .date-val { color:#fff; font-family:monospace; font-size:1.4rem; font-weight:800; text-shadow: 0 0 10px rgba(56,189,248,0.5); }
    
    /* 隐藏原生日历控件但保留点击区域 */
    input[type="date"] { position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%; }

    .g-panel { background:var(--glass); border:1px solid var(--border); border-radius:16px; padding:20px; transition:0.2s; cursor:pointer; display:flex; flex-direction:column; justify-content:space-between; }
    .g-panel:hover { transform: translateY(-3px); border-color: #38bdf8; background: rgba(30, 41, 59, 0.9); box-shadow: 0 5px 15px rgba(0,0,0,0.2); }
    
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:15px; }
    .mini-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px; }
    .lbl-sec { color:#38bdf8; font-weight:800; margin:30px 0 10px 5px; text-transform:uppercase; letter-spacing:1px; }

    .row { display:flex; justify-content:space-between; align-items:center; }
    .top { margin-bottom:15px; }
    .card-title { font-weight:700; font-size:1.05rem; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pct { background:rgba(56, 189, 248, 0.2); color:#38bdf8; padding:3px 8px; border-radius:6px; font-weight:800; font-size:0.85rem; flex-shrink:0; }
    
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
    
    /* 🟢 友链卡片 - 布局修复 */
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
  </style></head><body>
    <div class="main">
      <div class="header">
        <h1 class="head-title">📊 数据看板</h1>
        <div style="display:flex;align-items:center;gap:15px">
            <span style="font-family:monospace;opacity:0.8;color:var(--text-sub)">Today: ${todayStr}</span>
            <span class="badge">历史总计 ${histTotal}</span>
        </div>
        <a href="/admin/logout" style="color:#f87171;text-decoration:none;font-size:0.85rem;margin-top:5px">安全退出</a>
      </div>

      <div class="stats-grp">
        <div class="s-card"><div class="s-lbl">总项目</div><div class="s-val">${safeLinks.length}</div></div>
        <div class="s-card"><div class="s-lbl">本月总点击</div><div class="s-val" style="color:#38bdf8">${monthTotalClicks}</div></div>
        <div class="s-card"><div class="s-lbl">活跃项目</div><div class="s-val">${Array.from(periodMap.values()).filter(c=>c>0).length}</div></div>
      </div>

      <div class="date-bar">
        <a href="/admin?d=${prevMonthStr}" class="btn" title="上个月">⏪</a>
        <a href="/admin?d=${prevDay}" class="btn">◀</a>
        
        <div class="date-display" title="点击切换日期">
            <span class="date-val">${selDate}</span>
            <input type="date" value="${selDate.length > 7 ? selDate : ''}" onchange="location.href='/admin?d='+this.value">
        </div>
        
        <a href="/admin?d=${nextDay}" class="btn">▶</a>
        <a href="/admin?d=${nextMonthStr}" class="btn" title="下个月">⏩</a>
        
        <div style="width:1px;height:15px;background:rgba(255,255,255,0.2);margin:0 8px"></div>
        <a href="/admin?d=${todayStr}" class="btn ${selDate===todayStr?'active':''}">今日</a>
        <a href="/admin?d=${currentM}" class="btn ${selDate===currentM?'active':''}">本月</a>
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
      async function openLog(id,d,n){
        document.getElementById('dr').classList.add('open');
        document.getElementById('mask').classList.add('show');
        document.getElementById('dt').innerText = n + ' 记录';
        const l=document.getElementById('dl');
        l.innerHTML='<li style="padding:20px;text-align:center;color:#cbd5e1">加载中...</li>';
        try{
          const r=await fetch(\`/admin/api/logs?id=\${id}&d=\${d}\`);
          const data=await r.json();
          if(!data.length){l.innerHTML='<li style="padding:20px;text-align:center;opacity:0.5;color:#cbd5e1">该时段无记录</li>';return;}
          l.innerHTML=data.map((x,i)=>\`<li style="padding:12px 20px;border-bottom:1px solid rgba(255,255,255,0.1);font-size:0.85rem">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="color:#38bdf8">#\${i+1}</span>
              <span style="opacity:0.9;color:#e2e8f0">\${x.click_time.split(' ')[1]}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-family:monospace;font-size:0.75rem;color:#94a3b8">
              <span>\${x.ip_address}</span><span>\${x.click_time.split(' ')[0]}</span>
            </div>
          </li>\`).join('');
        }catch(e){l.innerHTML='<li style="padding:20px;text-align:center;color:#f87171">加载失败</li>';}
      }
      function cls(){document.getElementById('dr').classList.remove('open');document.getElementById('mask').classList.remove('show');}
    </script>
  </body></html>`;
}

// 3. 登录页面 (🟢 修复输入框居中对齐、背景更通透)
function renderLoginPage(T, IMG, FS, msg) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${T}</title><style>
    body { margin:0; font-family:${FS}; background:url('${IMG}') center/cover; min-height:100vh; display:flex; justify-content:center; align-items:center; }
    
    .box { 
        background: rgba(15, 23, 42, 0.75); 
        backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        padding: 40px; border-radius: 24px; 
        width: 320px; text-align: center; 
        border: 1px solid rgba(255, 255, 255, 0.1); 
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        color: #fff;
    }
    
    h1 { font-size: 1.6rem; margin-bottom: 25px; font-weight: 800; letter-spacing: -0.5px; }
    
    /* 🟢 修复输入框对齐 */
    form { display: flex; flex-direction: column; width: 100%; align-items: center; box-sizing: border-box; }
    
    input { 
        width: 100%; box-sizing: border-box; 
        padding: 14px; margin-bottom: 20px; 
        background: rgba(255, 255, 255, 0.1); 
        border: 1px solid rgba(255, 255, 255, 0.2); 
        color: #fff; border-radius: 12px; text-align: center; 
        font-size: 1rem; outline: none; transition: 0.3s;
    }
    input::placeholder { color: #cbd5e1; }
    input:focus { border-color: #38bdf8; background: rgba(0, 0, 0, 0.4); box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2); }
    
    button { 
        width: 100%; box-sizing: border-box;
        padding: 14px; 
        background: #fff; color: #0f172a; 
        border: none; border-radius: 12px; 
        font-weight: 800; font-size: 1rem; cursor: pointer; 
        transition: 0.3s; 
    }
    button:hover { background: #38bdf8; transform: translateY(-2px); box-shadow: 0 10px 20px rgba(56, 189, 248, 0.3); }
    
    .error { color: #f87171; font-size: 0.9rem; margin-top: 15px; min-height: 20px; font-weight: 600; }
  </style></head><body>
    <div class="box">
        <h1>🔐 验证身份</h1>
        <form method="POST">
            <input type="password" name="password" required placeholder="请输入管理员口令" autofocus>
            <button>立即登录</button>
        </form>
        <div class="error">${msg}</div>
    </div>
  </body></html>`;
}
