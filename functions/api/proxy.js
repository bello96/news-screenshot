export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const target = url.searchParams.get('url');
  if (!target) {
    return new Response('Missing url param', { status: 400 });
  }

  const allowed = ['cctv.com', 'cntv.cn', 'cctvpic.com', 'lxdns.com', 'cdn20.com', 'chinanetcenter.com', 'cloudcdn.net', 'myalicdn.com', 'myqcloud.com', 'cdnpe.com'];
  let targetFixed = target;
  if (targetFixed.startsWith('http://')) {
    targetFixed = 'https://' + targetFixed.slice(7);
  }

  let hostname;
  try {
    hostname = new URL(targetFixed).hostname;
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }

  if (!allowed.some(d => hostname.endsWith(d)) && !hostname.includes('cntv') && !hostname.includes('cctv')) {
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
    return new Response(`Upstream returned ${resp.status}`, {
      status: resp.status,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'public, max-age=3600');

  const ct = resp.headers.get('content-type') || '';
  if (targetFixed.includes('.m3u8') || ct.includes('mpegurl')) {
    let body = await resp.text();
    body = body.replace(/^(?!#)(\S+)$/gm, (match) => {
      const absUrl = new URL(match, targetFixed).href;
      return `/api/proxy?url=${encodeURIComponent(absUrl)}`;
    });
    headers.set('Content-Type', 'application/vnd.apple.mpegurl');
    return new Response(body, { status: 200, headers });
  }

  const respCt = resp.headers.get('content-type');
  if (respCt) headers.set('Content-Type', respCt);
  return new Response(resp.body, { status: 200, headers });
}
