/* 登录页水面：鼠标移动扰动高度场，波纹传播、衰减后恢复平静。 */
(function () {
  var wrap = document.querySelector('.auth-wrap');
  var canvas = document.getElementById('authRipple');
  if (!wrap || !canvas || !canvas.getContext) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var ctx = canvas.getContext('2d');
  var sim = document.createElement('canvas');
  var simCtx = sim.getContext('2d');
  if (!ctx || !simCtx) return;

  var width = 0, height = 0, scale = 1, sw = 0, sh = 0;
  var current, previous, pixels;
  var lastPoint = null, frame = 0, lastFrame = 0, stepTime = 0, activeUntil = 0;

  function resize() {
    var rect = wrap.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    if (width < 2 || height < 2) return;
    scale = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // 低分辨率计算波面，再平滑放大，避免在整屏逐像素计算。
    sw = Math.min(320, Math.max(160, Math.round(width / 5)));
    sh = Math.max(90, Math.round(sw * height / width));
    sim.width = sw;
    sim.height = sh;
    current = new Float32Array(sw * sh);
    previous = new Float32Array(sw * sh);
    pixels = simCtx.createImageData(sw, sh);
    lastPoint = null;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
  }

  function disturb(x, y, force) {
    var cx = Math.round(x / width * sw);
    var cy = Math.round(y / height * sh);
    var radius = 2;
    for (var dy = -radius; dy <= radius; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        var px = cx + dx, py = cy + dy;
        var d2 = dx * dx + dy * dy;
        if (px < 1 || py < 1 || px >= sw - 1 || py >= sh - 1 || d2 > radius * radius) continue;
        var falloff = 1 - d2 / (radius * radius);
        current[py * sw + px] += force * falloff * falloff;
      }
    }
  }

  function step() {
    for (var y = 1; y < sh - 1; y++) {
      for (var x = 1; x < sw - 1; x++) {
        var i = y * sw + x;
        previous[i] = ((current[i - 1] + current[i + 1] + current[i - sw] + current[i + sw]) * 0.5 - previous[i]) * 0.955;
      }
    }
    var old = current;
    current = previous;
    previous = old;
  }

  function render() {
    var dst = pixels.data;
    for (var y = 1; y < sh - 1; y++) {
      for (var x = 1; x < sw - 1; x++) {
        var i = y * sw + x;
        var gx = current[i - 1] - current[i + 1];
        var gy = current[i - sw] - current[i + sw];
        var shade = (gx * 0.35 + gy * 0.65) * 175;
        var di = i * 4;
        if (shade >= 0) {
          dst[di] = 228; dst[di + 1] = 243; dst[di + 2] = 255;
          dst[di + 3] = Math.min(85, shade);
        } else {
          dst[di] = 11; dst[di + 1] = 34; dst[di + 2] = 76;
          dst[di + 3] = Math.min(85, -shade);
        }
      }
    }
    simCtx.putImageData(pixels, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sim, 0, 0, width, height);
  }

  function animate(now) {
    frame = 0;
    if (document.hidden || now > activeUntil) {
      ctx.clearRect(0, 0, width, height);
      current.fill(0);
      previous.fill(0);
      lastFrame = 0;
      stepTime = 0;
      return;
    }
    stepTime += lastFrame ? Math.min(60, now - lastFrame) : 33;
    lastFrame = now;
    var steps = 0;
    while (stepTime >= 33 && steps < 2) { step(); stepTime -= 33; steps++; }
    render();
    frame = window.requestAnimationFrame(animate);
  }

  function onMove(event) {
    if (event.pointerType === 'touch' && !event.buttons) return;
    if (!current) return;
    var rect = wrap.getBoundingClientRect();
    var point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (!lastPoint) { lastPoint = point; return; }
    var dx = point.x - lastPoint.x, dy = point.y - lastPoint.y;
    var distance = Math.hypot(dx, dy);
    if (distance < 24) return;
    if (distance < 180) {
      var count = Math.min(5, Math.ceil(distance / 28));
      var force = Math.min(0.58, 0.2 + distance * 0.004);
      for (var i = 1; i <= count; i++) {
        var t = i / count;
        disturb(lastPoint.x + dx * t, lastPoint.y + dy * t, force);
      }
      activeUntil = window.performance.now() + 1900;
      if (!frame) frame = window.requestAnimationFrame(animate);
    }
    lastPoint = point;
  }

  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerleave', function () { lastPoint = null; });
  if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);
  else window.addEventListener('resize', resize);
  resize();
})();
