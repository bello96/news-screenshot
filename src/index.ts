export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/video-info') {
      return handleVideoInfo(url);
    }
    if (url.pathname === '/api/proxy') {
      return handleProxy(url);
    }
    return serveHTML();
  },
};

async function handleVideoInfo(url: URL): Promise<Response> {
  const date = url.searchParams.get('date');
  if (!date || !/^\d{8}$/.test(date)) {
    return json({ error: '请提供日期参数，格式：YYYYMMDD' }, 400);
  }

  try {
    // Step 1: Fetch day listing page
    const dayUrl = `https://tv.cctv.com/lm/xwlb/day/${date}.shtml`;
    const dayResp = await fetch(dayUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!dayResp.ok) {
      return json({ error: `该日期无数据: ${date}` }, 404);
    }
    const dayHtml = await dayResp.text();

    // Step 2: Find the complete version video link (first one with sql0 class)
    const videoLinkMatch = dayHtml.match(/href="(https:\/\/tv\.cctv\.com\/\d{4}\/\d{2}\/\d{2}\/VIDE[^"]+\.shtml)"/);
    if (!videoLinkMatch) {
      return json({ error: '未找到该日期的新闻联播视频' }, 404);
    }
    const videoPageUrl = videoLinkMatch[1];

    // Step 3: Fetch video page to get GUID
    const videoResp = await fetch(videoPageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const videoHtml = await videoResp.text();
    const guidMatch = videoHtml.match(/var\s+guid\s*=\s*"([a-f0-9]+)"/);
    if (!guidMatch) {
      return json({ error: '无法解析视频信息' }, 500);
    }
    const guid = guidMatch[1];

    // Step 4: Get video info from CNTV API
    const infoUrl = `https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${guid}`;
    const infoResp = await fetch(infoUrl);
    const info: any = await infoResp.json();

    const hlsUrl = info.hls_url || '';
    const title = info.title || '';
    const thumbnail = info.video?.chapters?.[0]?.image || '';

    return json({ guid, hlsUrl, title, thumbnail, videoPageUrl });
  } catch (e: any) {
    return json({ error: '获取视频信息失败: ' + e.message }, 500);
  }
}

async function handleProxy(url: URL): Promise<Response> {
  const target = url.searchParams.get('url');
  if (!target) {
    return new Response('Missing url param', { status: 400 });
  }

  // Only allow proxying to known CCTV/CNTV domains
  const allowed = ['cctv.com', 'cntv.cn', 'cctvpic.com', 'lxdns.com', 'cdn20.com', 'chinanetcenter.com', 'cntv.cloudcdn.net', 'cntv.myalicdn.com', 'cntv.cdn20.com', 'myqcloud.com', 'cdnpe.com'];
  let targetFixed = target;
  // Ensure https
  if (targetFixed.startsWith('http://')) {
    targetFixed = 'https://' + targetFixed.slice(7);
  }
  const targetUrl = new URL(targetFixed);
  const hostname = targetUrl.hostname;
  if (!allowed.some(d => hostname.endsWith(d) || hostname.includes('cntv') || hostname.includes('cctv'))) {
    return new Response('Domain not allowed: ' + hostname, { status: 403 });
  }

  const resp = await fetch(targetFixed, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://tv.cctv.com/',
      'Origin': 'https://tv.cctv.com',
    },
  });

  if (!resp.ok) {
    return new Response(`Upstream returned ${resp.status}`, { status: resp.status, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'public, max-age=3600');

  // For m3u8 files, rewrite internal URLs to go through proxy
  const ct = resp.headers.get('content-type') || '';
  if (targetFixed.includes('.m3u8') || ct.includes('mpegurl')) {
    let body = await resp.text();
    // Rewrite all non-comment, non-empty lines (URLs) to go through proxy
    body = body.replace(/^(?!#)(\S+)$/gm, (match) => {
      const absUrl = new URL(match, targetFixed).href;
      return `/api/proxy?url=${encodeURIComponent(absUrl)}`;
    });
    headers.set('Content-Type', 'application/vnd.apple.mpegurl');
    return new Response(body, { status: 200, headers });
  }

  // For TS segments, pass through with correct content type
  const respCt = resp.headers.get('content-type');
  if (respCt) headers.set('Content-Type', respCt);
  return new Response(resp.body, { status: 200, headers });
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function serveHTML(): Response {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>新闻联播封面截图</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
}
h1 {
  font-size: 28px;
  margin-bottom: 8px;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.subtitle { color: #94a3b8; margin-bottom: 32px; font-size: 14px; }
.controls {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  justify-content: center;
}
input[type="date"] {
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid #334155;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 16px;
  outline: none;
}
input[type="date"]:focus { border-color: #f59e0b; }
button {
  padding: 10px 24px;
  border-radius: 8px;
  border: none;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
}
.btn-primary {
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  color: white;
}
.btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(245,158,11,0.4); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
.btn-download {
  background: #10b981;
  color: white;
  display: none;
}
.btn-download:hover { background: #059669; }
.status {
  color: #94a3b8;
  margin-bottom: 16px;
  font-size: 14px;
  min-height: 20px;
  text-align: center;
}
.status.error { color: #ef4444; }
.result-area {
  max-width: 960px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
video {
  width: 100%;
  max-width: 960px;
  border-radius: 12px;
  background: #000;
  display: none;
}
canvas { display: none; }
.screenshot-preview {
  display: none;
  width: 100%;
  max-width: 960px;
  border-radius: 12px;
  border: 2px solid #334155;
}
.seek-controls {
  display: none;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
}
.seek-controls button {
  padding: 6px 14px;
  font-size: 13px;
  background: #1e293b;
  color: #e2e8f0;
  border: 1px solid #334155;
}
.seek-controls button:hover { border-color: #f59e0b; }
.seek-controls span { color: #94a3b8; font-size: 13px; }
.time-display { color: #f59e0b; font-weight: bold; font-size: 14px; min-width: 60px; text-align: center; }
.tip { color: #64748b; font-size: 12px; margin-top: 16px; text-align: center; max-width: 600px; line-height: 1.6; }
</style>
</head>
<body>
<h1>新闻联播封面截图工具</h1>
<p class="subtitle">获取任意日期新闻联播开场主播画面</p>

<div class="controls">
  <input type="date" id="datePicker">
  <button class="btn-primary" id="fetchBtn" onclick="fetchVideo()">获取封面截图</button>
  <button class="btn-primary" id="captureBtn" style="display:none;background:linear-gradient(135deg,#3b82f6,#8b5cf6)" onclick="captureFrame()">截取当前画面</button>
  <button class="btn-download" id="downloadBtn" onclick="downloadImage()">下载截图</button>
</div>

<p class="status" id="status"></p>

<div class="seek-controls" id="seekControls">
  <button onclick="seekBy(-1)">-1s</button>
  <button onclick="seekBy(-0.1)">-0.1s</button>
  <span class="time-display" id="timeDisplay">0.0s</span>
  <button onclick="seekBy(0.1)">+0.1s</button>
  <button onclick="seekBy(1)">+1s</button>
  <button onclick="seekTo(0)">回到开头</button>
</div>

<div class="result-area">
  <video id="player" crossorigin="anonymous" muted></video>
  <canvas id="canvas"></canvas>
  <img class="screenshot-preview" id="preview" alt="截图预览">
</div>

<p class="tip">使用说明：选择日期后点击"获取封面截图"，视频会自动定位到开场画面附近。<br>可用微调按钮精确定位到主播出镜画面，然后点击"截取当前画面"保存截图。</p>

<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>
const datePicker = document.getElementById('datePicker');
const fetchBtn = document.getElementById('fetchBtn');
const captureBtn = document.getElementById('captureBtn');
const downloadBtn = document.getElementById('downloadBtn');
const status = document.getElementById('status');
const player = document.getElementById('player');
const canvas = document.getElementById('canvas');
const preview = document.getElementById('preview');
const seekControls = document.getElementById('seekControls');
const timeDisplay = document.getElementById('timeDisplay');

let hls = null;
let currentTitle = '';

// Default to yesterday
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
datePicker.value = yesterday.toISOString().split('T')[0];
datePicker.max = new Date().toISOString().split('T')[0];

player.addEventListener('timeupdate', () => {
  timeDisplay.textContent = player.currentTime.toFixed(1) + 's';
});

async function fetchVideo() {
  const dateStr = datePicker.value.replace(/-/g, '');
  if (!dateStr) { setStatus('请选择日期', true); return; }

  fetchBtn.disabled = true;
  setStatus('正在获取视频信息...');
  captureBtn.style.display = 'none';
  downloadBtn.style.display = 'none';
  preview.style.display = 'none';
  seekControls.style.display = 'none';

  try {
    const resp = await fetch('/api/video-info?date=' + dateStr);
    const data = await resp.json();
    if (data.error) { setStatus(data.error, true); fetchBtn.disabled = false; return; }

    currentTitle = data.title || '新闻联播_' + dateStr;
    setStatus('正在加载视频流，请稍候...');

    const proxyUrl = '/api/proxy?url=' + encodeURIComponent(data.hlsUrl);

    if (hls) { hls.destroy(); }

    if (Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 10,
        maxMaxBufferLength: 15,
      });
      hls.loadSource(proxyUrl);
      hls.attachMedia(player);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        player.style.display = 'block';
        player.currentTime = 5;
        player.play().catch(() => {});
        setTimeout(() => {
          player.pause();
          player.currentTime = 5;
          setStatus('视频已加载！使用微调按钮找到主播开场画面，然后点击"截取当前画面"');
          captureBtn.style.display = 'inline-block';
          seekControls.style.display = 'flex';
          fetchBtn.disabled = false;
        }, 2000);
      });
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (d.fatal) { setStatus('视频加载失败: ' + d.type, true); fetchBtn.disabled = false; }
      });
    } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
      player.src = proxyUrl;
      player.addEventListener('loadedmetadata', () => {
        player.style.display = 'block';
        player.currentTime = 5;
        setTimeout(() => {
          player.pause();
          setStatus('视频已加载！使用微调按钮找到主播开场画面，然后点击"截取当前画面"');
          captureBtn.style.display = 'inline-block';
          seekControls.style.display = 'flex';
          fetchBtn.disabled = false;
        }, 2000);
      }, { once: true });
      player.play().catch(() => {});
    }
  } catch (e) {
    setStatus('请求失败: ' + e.message, true);
    fetchBtn.disabled = false;
  }
}

function seekBy(delta) {
  player.currentTime = Math.max(0, player.currentTime + delta);
}

function seekTo(t) {
  player.currentTime = t;
}

function captureFrame() {
  canvas.width = player.videoWidth;
  canvas.height = player.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(player, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  preview.src = dataUrl;
  preview.style.display = 'block';
  downloadBtn.style.display = 'inline-block';
  setStatus('截图已生成！点击"下载截图"保存到本地');
}

function downloadImage() {
  const a = document.createElement('a');
  a.href = preview.src;
  const safeName = currentTitle.replace(/[^\\w\\u4e00-\\u9fff]/g, '_');
  a.download = safeName + '_封面.png';
  a.click();
}

function setStatus(msg, isError = false) {
  status.textContent = msg;
  status.className = 'status' + (isError ? ' error' : '');
}
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
