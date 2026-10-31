export function drawChart(canvas, series, options = {}) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth || 320;
  const height = canvas.clientHeight || 150;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { l: 36, r: 12, t: 16, b: 22 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const lists = series.map((item) => item.data || []);
  const longest = lists.reduce((n, data) => Math.max(n, data.length), 0);

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "12px 'Inter Tight', 'IBM Plex Sans KR', sans-serif";
  if (longest < 2) {
    ctx.fillText(options.empty || "아직 데이터가 없습니다", pad.l, pad.t + 18);
    return;
  }

  let min = Infinity;
  let max = -Infinity;
  for (const data of lists) {
    for (const value of data) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (options.zero !== false) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const yOf = (value) => pad.t + ((max - value) / span) * plotH;
  const xOf = (index, length) => pad.l + (index / (length - 1)) * plotW;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + plotH);
  ctx.lineTo(pad.l + plotW, pad.t + plotH);
  ctx.stroke();

  if (min <= 0 && max >= 0) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.beginPath();
    ctx.moveTo(pad.l, yOf(0));
    ctx.lineTo(pad.l + plotW, yOf(0));
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "11px 'Inter Tight', 'IBM Plex Sans KR', sans-serif";
  ctx.fillText(formatTick(max), 4, pad.t + 10);
  ctx.fillText(formatTick(min), 4, pad.t + plotH);

  series.forEach((item) => {
    if (!item.data || item.data.length < 2) return;
    ctx.beginPath();
    item.data.forEach((value, index) => {
      const x = xOf(index, item.data.length);
      const y = yOf(value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  let legendX = pad.l;
  series.forEach((item) => {
    if (!item.name) return;
    ctx.fillStyle = item.color;
    ctx.fillRect(legendX, height - 12, 10, 3);
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    ctx.fillText(item.name, legendX + 14, height - 8);
    legendX += ctx.measureText(item.name).width + 28;
  });
}

function formatTick(value) {
  const abs = Math.abs(value);
  if (abs >= 100) return Math.round(value).toString();
  if (abs >= 10) return value.toFixed(0);
  return value.toFixed(1);
}
