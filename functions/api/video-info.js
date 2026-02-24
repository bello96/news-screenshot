function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const date = url.searchParams.get('date');
  if (!date || !/^\d{8}$/.test(date)) {
    return jsonResp({ error: '请提供日期参数，格式：YYYYMMDD' }, 400);
  }

  try {
    const dayUrl = `https://tv.cctv.com/lm/xwlb/day/${date}.shtml`;
    const dayResp = await fetch(dayUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!dayResp.ok) {
      return jsonResp({ error: `该日期无数据: ${date}` }, 404);
    }
    const dayHtml = await dayResp.text();

    const videoLinkMatch = dayHtml.match(/href="(https:\/\/tv\.cctv\.com\/\d{4}\/\d{2}\/\d{2}\/VIDE[^"]+\.shtml)"/);
    if (!videoLinkMatch) {
      return jsonResp({ error: '未找到该日期的新闻联播视频' }, 404);
    }
    const videoPageUrl = videoLinkMatch[1];

    const videoResp = await fetch(videoPageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const videoHtml = await videoResp.text();
    const guidMatch = videoHtml.match(/var\s+guid\s*=\s*"([a-f0-9]+)"/);
    if (!guidMatch) {
      return jsonResp({ error: '无法解析视频信息' }, 500);
    }
    const guid = guidMatch[1];

    const infoUrl = `https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${guid}`;
    const infoResp = await fetch(infoUrl);
    const info = await infoResp.json();

    const hlsUrl = info.hls_url || '';
    const title = info.title || '';
    const thumbnail = info.video?.chapters?.[0]?.image || '';

    return jsonResp({ guid, hlsUrl, title, thumbnail, videoPageUrl });
  } catch (e) {
    return jsonResp({ error: '获取视频信息失败: ' + e.message }, 500);
  }
}
