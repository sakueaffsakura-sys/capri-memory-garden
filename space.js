/* Cérebro da Capri em 3D: uma constelação de memórias que gira em volta de si. WebGL puro, sem bibliotecas.
   Cada memória é uma estrela única: cor da categoria com um tom só dela, tamanho pela importância e pelas ligações,
   número de pontas, giro e cintilar tirados do próprio id, anéis no conhecimento avançado e halo nas mais lembradas.
   Dois fundos: Noite (como o mapa da internet: preto, linhas coloridas somando luz, estrelas brancas nos centros) e
   Claro (como os grafos em papel branco: bolinhas chapadas e linhas finas). */
"use strict";
(() => {
  const TAU = Math.PI * 2;
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rgbOf = (hex) => { const v = parseInt(hex.slice(1), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
  const mixc = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  // Um tom só da estrela: a cor da categoria girada um pouquinho no círculo das cores.
  function tint(c, seed) {
    const [r, g, b] = c, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < 1e-4) return [r, g, b];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + (seed - 0.5) * 22 + 360) % 360;
    const C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - C / 2;
    const [rr, gg, bb] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
    return [rr + m, gg + m, bb + m];
  }

  // ---------------- matemática da câmera ----------------
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function lookAt(e, t, up) {
    let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2], l = Math.hypot(zx, zy, zz) || 1;
    zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  }
  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }

  // ---------------- simulação de forças em 3D (Barnes-Hut com octree) ----------------
  class Oct { constructor(x, y, z, s) { this.x = x; this.y = y; this.z = z; this.s = s; this.m = 0; this.sx = 0; this.sy = 0; this.sz = 0; this.body = null; this.kids = null; } }
  function octAdd(q, n, depth) {
    q.m += n.w; q.sx += n.x * n.w; q.sy += n.y * n.w; q.sz += n.z * n.w;
    if (!q.kids) {
      if (!q.body) { q.body = n; return; }
      if (depth > 24) return;
      const old = q.body;
      q.body = null; q.kids = [null, null, null, null, null, null, null, null];
      octChild(q, old, depth);
    }
    octChild(q, n, depth);
  }
  function octChild(q, n, depth) {
    const h = q.s / 2, i = (n.x >= q.x + h ? 1 : 0) + (n.y >= q.y + h ? 2 : 0) + (n.z >= q.z + h ? 4 : 0);
    let c = q.kids[i];
    if (!c) c = q.kids[i] = new Oct(q.x + (i & 1 ? h : 0), q.y + (i & 2 ? h : 0), q.z + (i & 4 ? h : 0), h);
    octAdd(c, n, depth + 1);
  }
  function octTree(ns) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const n of ns) { if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x; if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y; if (n.z < z0) z0 = n.z; if (n.z > z1) z1 = n.z; }
    const root = new Oct(x0 - 1, y0 - 1, z0 - 1, Math.max(x1 - x0, y1 - y0, z1 - z0) + 2);
    for (const n of ns) octAdd(root, n, 0);
    return root;
  }
  function octRepel(q, n, k) {
    if (!q.m) return;
    let dx = q.sx / q.m - n.x, dy = q.sy / q.m - n.y, dz = q.sz / q.m - n.z, d2 = dx * dx + dy * dy + dz * dz;
    if (q.kids) {
      if ((q.s * q.s) / (d2 || 1e-9) >= 0.8) { for (const c of q.kids) if (c) octRepel(c, n, k); return; }
    } else if (q.body === n) return;
    if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dz = Math.random() - 0.5; d2 = 1 + dx * dx + dy * dy + dz * dz; }
    if (d2 > 1.2e6) return;
    const f = (k * q.m) / d2;
    n.vx -= dx * f; n.vy -= dy * f; n.vz -= dz * f;
  }
  // Direções bem espalhadas numa esfera (espiral de Fibonacci), uma por categoria na vista em níveis.
  function sphereDirs(n) {
    const out = [], g = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), t = g * i;
      out.push([Math.cos(t) * r, y * 0.9, Math.sin(t) * r]);
    }
    return out.map((d) => { const l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; });
  }

  // ---------------- shaders ----------------
  const VS_POINT = `
    attribute vec3 aPos; attribute vec3 aColor; attribute vec4 aInfo;
    uniform mat4 uVP; uniform float uScale; uniform float uMax; uniform float uLightV; uniform vec2 uFade;
    varying vec3 vColor; varying vec4 vInfo; varying float vCore; varying float vSize;
    void main() {
      vec4 clip = uVP * vec4(aPos, 1.0);
      gl_Position = clip;
      float w = max(clip.w, 0.001);
      float px = max(aInfo.x * uScale / w, 0.7);
      float glow = uLightV > 0.5 ? 1.0 : (mod(floor(aInfo.w / 16.0), 2.0) > 0.5 ? 3.0 : 4.6);
      float size = clamp(px * 2.0 * glow + 2.0, 2.0, uMax);
      gl_PointSize = size; vSize = size;
      vCore = min(0.96, (px * 2.0) / size);
      float fade = clamp(1.0 - (w - uFade.x) / max(uFade.y - uFade.x, 1.0), 0.3, 1.0);
      vColor = aColor; vInfo = vec4(aInfo.y, aInfo.z, aInfo.w, fade);
    }`;
  const FS_POINT = `
    precision mediump float;
    varying vec3 vColor; varying vec4 vInfo; varying float vCore; varying float vSize;
    uniform float uTime; uniform float uLight; uniform float uG; uniform float uBright;
    float bit(float f, float b) { return mod(floor(f / b), 2.0); }
    void main() {
      vec2 c = gl_PointCoord * 2.0 - 1.0;
      float r = length(c);
      if (r > 1.0) discard;
      float seed = vInfo.x, level = vInfo.y, flags = vInfo.z, fade = vInfo.w;
      float hub = bit(flags, 1.0), dim = bit(flags, 2.0), lit = bit(flags, 4.0), act = bit(flags, 8.0), spark = bit(flags, 16.0), flash = bit(flags, 32.0);
      vec3 col = vColor;
      if (act > 0.5) col = vec3(0.77, 0.71, 0.99);
      else if (lit > 0.5) col = mix(col, vec3(0.93, 0.91, 1.0), 0.35);
      if (uLight > 0.5) {
        // Papel: uma bolinha chapada com a borda um pouco mais escura, como nos modelos.
        float aa = 2.4 / max(2.0, vSize);
        float a = 1.0 - smoothstep(vCore - aa, vCore, r);
        if (a < 0.02) discard;
        vec3 body = mix(col * 0.72, col, smoothstep(vCore, vCore * 0.62, r));
        if (level > 2.5 && r > vCore * 0.62 && r < vCore * 0.78) body = mix(body, vec3(1.0), 0.65);
        float alpha = a * (dim > 0.5 ? 0.16 : 1.0);
        gl_FragColor = vec4(dim > 0.5 ? mix(body, vec3(0.85), 0.6) : body, alpha);
        return;
      }
      // Noite: um miolo quase branco, brilho em volta, pontas de estrela e anéis no conhecimento avançado.
      float tw = 0.78 + 0.22 * sin(uTime * (0.7 + seed * 2.3) + seed * 61.0);
      float core = 1.0 - smoothstep(vCore * 0.45, vCore, r);
      float glow = exp(-r * r / (vCore * vCore * 2.6)) * 0.55 + exp(-r * 3.4) * (0.18 + 0.3 * uG);
      float n = seed < 0.25 ? 4.0 : seed < 0.5 ? 5.0 : seed < 0.8 ? 6.0 : 8.0;
      float ang = atan(c.y, c.x) + seed * 6.2831 + uTime * 0.04 * (seed - 0.5);
      float rays = pow(abs(cos(ang * n * 0.5)), 48.0) * (1.0 - smoothstep(vCore, 1.0, r)) * smoothstep(vCore * 0.4, vCore * 1.2, r);
      float strength = 0.25 + 0.08 * level + 0.45 * hub + 0.2 * uG;
      float ring = 0.0;
      if (level > 2.5) ring += exp(-pow((r - min(0.92, vCore * 1.85)) / (0.035 + vCore * 0.1), 2.0)) * 0.55;
      if (level > 3.5) ring += exp(-pow((r - min(0.97, vCore * 2.45)) / (0.03 + vCore * 0.08), 2.0)) * 0.4;
      if (spark > 0.5) { core = 1.0 - smoothstep(0.0, 0.5, r); glow = exp(-r * r * 6.0) * 0.8; rays = 0.0; ring = 0.0; }
      float halo = flash > 0.5 ? exp(-pow((r - 0.7) / 0.12, 2.0)) * 0.9 : 0.0;
      vec3 hot = mix(col, vec3(1.0), 0.7);
      vec3 outc = hot * core * 1.15 + col * (glow * tw + rays * strength) * uBright + mix(col, vec3(1.0), 0.4) * ring * uBright + vec3(0.93, 0.91, 1.0) * halo;
      outc *= fade * (dim > 0.5 ? 0.13 : 1.0);
      gl_FragColor = vec4(outc, 1.0);
    }`;
  const VS_LINE = `
    attribute vec3 aPos; attribute vec4 aColor;
    uniform mat4 uVP; uniform vec2 uFade;
    varying vec4 vColor;
    void main() {
      vec4 clip = uVP * vec4(aPos, 1.0);
      gl_Position = clip;
      float f = clamp(1.0 - (clip.w - uFade.x) / max(uFade.y - uFade.x, 1.0), 0.25, 1.0);
      vColor = vec4(aColor.rgb, aColor.a * f);
    }`;
  const FS_LINE = `
    precision mediump float;
    varying vec4 vColor; uniform float uLight;
    void main() { gl_FragColor = uLight > 0.5 ? vColor : vec4(vColor.rgb * vColor.a, 1.0); }`;
  const VS_QUAD = `
    attribute vec2 aXY; varying vec2 vUV;
    void main() { vUV = aXY * 0.5 + 0.5; gl_Position = vec4(aXY, 0.0, 1.0); }`;
  const FS_QUAD = `
    precision mediump float; varying vec2 vUV; uniform sampler2D uTex; uniform float uAlpha;
    void main() { vec4 t = texture2D(uTex, vec2(vUV.x, 1.0 - vUV.y)); gl_FragColor = vec4(t.rgb * uAlpha, 1.0); }`;
  // Nuvens das categorias: um véu redondo virado sempre para a câmera.
  const VS_CLOUD = `
    attribute vec3 aCenter; attribute vec2 aCorner; attribute vec4 aColor; attribute float aSize;
    uniform mat4 uVP; uniform vec2 uF;
    varying vec2 vUV; varying vec4 vColor;
    void main() {
      vec4 clip = uVP * vec4(aCenter, 1.0);
      clip.xy += aCorner * aSize * uF;
      gl_Position = clip; vUV = aCorner; vColor = aColor;
    }`;
  const FS_CLOUD = `
    precision mediump float; varying vec2 vUV; varying vec4 vColor;
    void main() { float r2 = dot(vUV, vUV); if (r2 > 1.0) discard; float a = exp(-r2 * 3.2) * (1.0 - r2) * vColor.a; gl_FragColor = vec4(vColor.rgb * a, 1.0); }`;

  function program(gl, vs, fs) {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, vs)); gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = { p, a: {}, u: {} };
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i < n; i++) { const a = gl.getActiveAttrib(p, i); loc.a[a.name] = gl.getAttribLocation(p, a.name); }
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const u = gl.getActiveUniform(p, i); loc.u[u.name] = gl.getUniformLocation(p, u.name); }
    return loc;
  }

  // Nomes de estrela: cada memória ganha o seu, tirado do id.
  const SYL1 = ["Al", "Be", "Ca", "Dra", "El", "Fe", "Ga", "Hy", "Ix", "Ju", "Ka", "Ly", "Mi", "No", "Or", "Pe", "Qui", "Ri", "Sa", "Te", "Ul", "Ve", "Xa", "Ze", "Ar", "Si", "Lu", "Vi"];
  const SYL2 = ["ra", "nis", "lia", "tor", "mir", "dra", "phe", "sa", "ron", "lux", "ten", "via", "nar", "ce", "ris", "do", "ka", "le"];
  const SYL3 = ["", "", "a", "is", "on", "ar", "e", "ia"];
  const CLASSES = ["M", "K", "G", "F", "A", "B", "O"];
  function starOf(id, importance, recalls, level) {
    const h = hash(id), seed = (h % 100000) / 100000;
    const name = SYL1[h % SYL1.length] + SYL2[(h >>> 5) % SYL2.length] + SYL3[(h >>> 11) % SYL3.length];
    const points = seed < 0.25 ? 4 : seed < 0.5 ? 5 : seed < 0.8 ? 6 : 8;
    const glow = (importance || 3) + Math.log2(1 + (recalls || 0)) + (level || 0) * 0.3;
    const cls = CLASSES[Math.max(0, Math.min(6, Math.round(glow - 1)))];
    return { name: name.charAt(0).toUpperCase() + name.slice(1), points, cls, mag: Math.round(glow * 10) / 10, code: ((h >>> 3) % 900 + 100).toString(36).toUpperCase() };
  }

  class Space {
    static ok() {
      try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl"))); }
      catch { return false; }
    }
    constructor(canvas, opt = {}) {
      this.c = canvas; this.opt = opt; this.demo = !!opt.demo;
      const gl = canvas.getContext("webgl", { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: !!opt.keep }) || canvas.getContext("experimental-webgl");
      if (!gl) throw new Error("sem WebGL");
      this.gl = gl;
      this.P = program(gl, VS_POINT, FS_POINT); this.L = program(gl, VS_LINE, FS_LINE); this.Q = program(gl, VS_QUAD, FS_QUAD); this.C = program(gl, VS_CLOUD, FS_CLOUD);
      this.maxPoint = Math.min(256, (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1]);
      this.buf = {}; for (const k of ["pos", "col", "info", "lpos", "lcol", "spos", "scol", "sinfo", "bpos", "bcol", "binfo", "quad", "cloud"]) this.buf[k] = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      this.tex = gl.createTexture();
      // Os nomes e o "Dia N" vão numa tela 2D por cima.
      this.o = document.createElement("canvas");
      this.o.className = "graph-labels";
      this.o.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
      canvas.parentNode.insertBefore(this.o, canvas.nextSibling);
      this.octx = this.o.getContext("2d");
      this.nodes = []; this.byId = new Map(); this.edges = []; this.near = new Map(); this.adj = new Map();
      this.colors = opt.colors !== false; this.caption = opt.caption || null; this.mode = opt.mode || "web"; this.theme = opt.theme === "light" ? "light" : "dark";
      this.cam = { yaw: 0.6, pitch: 0.28, dist: 600, tx: 0, ty: 0, tz: 0 }; this.vel = { yaw: 0, pitch: 0 };
      this.spin = this.demo || opt.spin !== false; this.idleAt = 0; this.anim = null; this.fitted = false; this.touched = false;
      this.alpha = 1; this.target = this.demo ? 0.02 : 0; this.cloud = 100; this.g = 0; this.pulses = []; this.pAcc = 0;
      this.hover = null; this.selected = null; this.matches = null; this.dirty = true; this.attrDirty = true; this.ptrs = new Map();
      this.effects = !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
      this.bg = this.makeSky();
      this.frame = this.frame.bind(this);
      this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
      // Só é problema se o navegador derrubou o 3D com a página aberta; ao sair da página é a própria vista que solta o 3D.
      canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); if (this.dead) return; this.lost = true; if (opt.onLost) opt.onLost(); });
      this.bind(); this.resize();
      this.raf = requestAnimationFrame(this.frame);
    }
    destroy() {
      this.dead = true; cancelAnimationFrame(this.raf); this.ro.disconnect(); this.o.remove();
      const ext = this.gl.getExtension("WEBGL_lose_context");
      if (ext && !this.opt.keep) try { ext.loseContext(); } catch {}
    }
    resize() {
      const r = this.c.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
      this.W = Math.max(1, r.width); this.H = Math.max(1, r.height); this.dpr = d;
      this.c.width = Math.round(this.W * d); this.c.height = Math.round(this.H * d);
      this.o.width = this.c.width; this.o.height = this.c.height;
      this.uploadNebula();
      this.dirty = true;
    }
    // A névoa do fundo (violeta, verde-água, um toque rosa), pintada uma vez numa tela pequena e esticada.
    uploadNebula() {
      const W = 512, H = Math.max(64, Math.round(512 * this.H / this.W)), cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const g = cv.getContext("2d");
      g.fillStyle = "#040409"; g.fillRect(0, 0, W, H);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (const [x, y, c, a] of [[0.2, 0.3, "139,92,246", 0.16], [0.8, 0.22, "45,212,191", 0.08], [0.62, 0.8, "99,102,241", 0.12], [0.28, 0.85, "45,212,191", 0.06], [0.5, 0.5, "139,92,246", 0.07], [0.9, 0.65, "236,72,153", 0.05]]) {
        const R = Math.max(W, H) * (0.35 + rnd() * 0.2), gr = g.createRadialGradient(x * W, y * H, 0, x * W, y * H, R);
        gr.addColorStop(0, `rgba(${c},${a})`); gr.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    // O céu de fundo: estrelas bem longe, numa esfera em volta de tudo. Giram junto quando a câmera gira.
    makeSky() {
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647), n = 2400;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), info = new Float32Array(n * 4);
      const tints = [[1, 1, 1], [0.99, 0.9, 0.54], [0.77, 0.71, 0.99], [0.65, 0.95, 0.99], [1, 0.8, 0.85]];
      for (let i = 0; i < n; i++) {
        const u = rnd() * 2 - 1, t = rnd() * TAU, r = Math.sqrt(1 - u * u);
        pos[i * 3] = Math.cos(t) * r; pos[i * 3 + 1] = u; pos[i * 3 + 2] = Math.sin(t) * r;
        const tc = tints[rnd() < 0.55 ? 0 : 1 + Math.floor(rnd() * 4)], b = 0.25 + rnd() * rnd() * 0.75;
        col[i * 3] = tc[0] * b; col[i * 3 + 1] = tc[1] * b; col[i * 3 + 2] = tc[2] * b;
        info[i * 4] = 0.0; info[i * 4 + 1] = rnd(); info[i * 4 + 2] = 0; info[i * 4 + 3] = 16;
      }
      return { pos, col, info, n, sizes: Array.from({ length: n }, () => (rnd() < 0.93 ? 0.55 : 1.1)) };
    }
    // Quem mexe no "dirty" de fora (busca, seleção, cores) também quer as estrelas pintadas de novo.
    get dirty() { return this._dirty; }
    set dirty(v) { this._dirty = v; if (v) this.attrDirty = true; }
    setTheme(theme) { this.theme = theme === "light" ? "light" : "dark"; this.attrDirty = true; this.dirty = true; }
    setData(nodes, edges, reheat) {
      const old = this.byId, by = new Map(), first = old.size === 0, spread = Math.cbrt(nodes.length + 1) * 22;
      for (const n of nodes) {
        const o = old.get(n.id);
        if (o) { Object.assign(o, { label: n.label, kind: n.kind, cat: n.cat, imp: n.imp, deg: n.deg, level: n.level || 0, know: !!n.know, recalls: n.recalls || 0, ret: n.ret, ep: !!n.ep, born: n.born || o.born }); by.set(n.id, o); continue; }
        const near = n.near && (old.get(n.near) || by.get(n.near)), hub = near || old.get("hub:" + n.cat) || by.get("hub:" + n.cat);
        const u = Math.random() * 2 - 1, t = Math.random() * TAU, rr = Math.sqrt(1 - u * u), d = 6 + Math.random() * (first ? spread : 26);
        const bx = hub && !first ? hub.x : 0, byy = hub && !first ? hub.y : 0, bz = hub && !first ? hub.z : 0;
        n.x = bx + Math.cos(t) * rr * d; n.y = byy + u * d; n.z = bz + Math.sin(t) * rr * d; n.vx = n.vy = n.vz = 0;
        n.level = n.level || 0; n.know = !!n.know; n.recalls = n.recalls || 0;
        by.set(n.id, n);
      }
      this.byId = by; this.nodes = [...by.values()];
      const count = new Map();
      this.edges = [];
      for (const e of edges) {
        const a = by.get(e.a), b = by.get(e.b);
        if (!a || !b || a === b) continue;
        this.edges.push({ a, b, hub: !!e.hub, trail: !!e.trail });
        count.set(a, (count.get(a) || 0) + 1); count.set(b, (count.get(b) || 0) + 1);
      }
      this.near = new Map(); this.adj = new Map();
      for (const e of this.edges) {
        const ca = count.get(e.a), cb = count.get(e.b);
        e.str = 1 / Math.min(ca, cb); e.bias = ca / (ca + cb); e.len = e.hub ? 30 : e.trail ? 32 : 40;
        for (const [p, q] of [[e.a, e.b], [e.b, e.a]]) {
          if (!this.near.has(p)) this.near.set(p, new Set());
          this.near.get(p).add(q);
          if (!this.adj.has(p)) this.adj.set(p, []);
          this.adj.get(p).push(e);
        }
      }
      let mems = 0;
      for (const n of this.nodes) {
        n.w = n.kind === "hub" ? 2.5 : 1; n.lone = !count.get(n);
        n.r = n.kind === "hub" ? 4.2 + Math.min(10, Math.sqrt(n.deg) * 0.85) : 1.5 + n.imp * 0.34 + (n.level ? n.level * 0.25 : 0) + Math.min(4.5, Math.sqrt(count.get(n) || 0) * 0.6) + Math.min(1.5, Math.log2(1 + n.recalls) * 0.4);
        // Memória fraca é estrela menor; episódio do diário é poeira de estrela.
        if (n.kind !== "hub") n.r *= (0.72 + 0.28 * (n.ret == null ? 1 : n.ret)) * (n.ep ? 0.82 : 1);
        n.seed = (hash(n.id) % 100000) / 100000;
        n.ring = n.kind === "hub" ? -1 : n.know ? Math.max(1, n.level || 1) : 0;
        if (n.kind !== "hub") mems++;
      }
      this.g = Math.max(0, Math.min(1, Math.log(1 + (this.opt.size ? this.opt.size() : mems)) / Math.log(1 + 3000)));
      this.layout(mems);
      this.density = Math.max(0.5, Math.min(1.4, 34 / Math.sqrt(this.edges.length + 1)));
      if (this.selected && !by.has(this.selected.id)) this.selected = null;
      if (this.hover && !by.has(this.hover.id)) this.hover = null;
      this.alpha = Math.max(this.alpha, reheat == null ? 0.3 : reheat);
      this.attrDirty = true; this.dirty = true;
    }
    layout(mems) {
      const cats = this.opt.cats || [], pc = [], kc = [];
      const order = cats.length ? cats : [...new Set(this.nodes.map((n) => n.cat))];
      for (const c of order) {
        if (!this.nodes.some((n) => n.kind !== "hub" && n.cat === c)) continue;
        (this.nodes.some((n) => n.kind !== "hub" && n.cat === c && n.know) ? kc : pc).push(c);
      }
      let mine = 0;
      for (const n of this.nodes) if (n.kind !== "hub" && !n.know) mine++;
      const base = Math.max(50, Math.cbrt(mems + 1) * 26), core = Math.max(base * 0.9, Math.cbrt(mine + 1) * 26);
      const kd = sphereDirs(Math.max(1, kc.length)), pd = sphereDirs(Math.max(1, pc.length));
      this.lay = { base, pc, kc, R: [core, core + base * 0.8, core + base * 1.4, core + base * 2.0, core + base * 2.6, core + base * 3.2, core + base * 3.9],
        dir: (n) => { const k = kc.indexOf(n.cat); return (n.know || (n.kind === "hub" && k >= 0)) && k >= 0 ? kd[k] : pd[Math.max(0, pc.indexOf(n.cat))]; },
        hw: (n) => Math.min(0.9, 2.2 / Math.sqrt(Math.max(1, n.ring === 0 ? pc.length : kc.length))) };
    }
    setMode(mode) { if (mode === this.mode) return; this.mode = mode; this.alpha = 1; this.fitted = 1; this.touched = false; this.dirty = true; }
    tick() {
      const ns = this.nodes, a = this.alpha, levels = this.mode === "levels";
      for (const e of this.edges) {
        if (levels && e.hub) continue;
        const p = e.a, q = e.b;
        let dx = q.x + q.vx - p.x - p.vx, dy = q.y + q.vy - p.y - p.vy, dz = q.z + q.vz - p.z - p.vz, l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        l = ((l - e.len) / l) * a * e.str * (e.hub ? 0.8 : 0.6) * (levels ? (e.trail ? 0.35 : 0.1) : 1);
        dx *= l; dy *= l; dz *= l;
        q.vx -= dx * e.bias; q.vy -= dy * e.bias; q.vz -= dz * e.bias; p.vx += dx * (1 - e.bias); p.vy += dy * (1 - e.bias); p.vz += dz * (1 - e.bias);
      }
      const root = octTree(ns), k = (levels ? 20 : 34) * a;
      for (const n of ns) octRepel(root, n, k);
      let far = 0, linked = 0;
      for (const n of ns) if (!n.lone) { const d = n.x * n.x + n.y * n.y + n.z * n.z; if (d > far) far = d; linked++; }
      this.cloud = linked ? Math.sqrt(far) : Math.cbrt(ns.length + 1) * 22;
      if (levels) this.placeLevels();
      else {
        // Uma esfera de memórias ligadas; as soltas numa casca em volta, como o anel dos modelos.
        const shell = this.cloud * 1.12 + 30, g = 0.06 * a;
        for (const n of ns) {
          if (n.lone) {
            const r = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z) || 1, f = ((shell - r) / r) * 0.06;
            n.vx += n.x * f; n.vy += n.y * f; n.vz += n.z * f;
          } else { n.vx -= n.x * g; n.vy -= n.y * g; n.vz -= n.z * g; }
        }
      }
      for (const n of ns) {
        n.vx *= 0.6; n.vy *= 0.6; n.vz *= 0.6; n.x += n.vx; n.y += n.vy; n.z += n.vz;
        if (!Number.isFinite(n.x + n.y + n.z)) { n.x = Math.random() * 20 - 10; n.y = Math.random() * 20 - 10; n.z = Math.random() * 20 - 10; n.vx = n.vy = n.vz = 0; }
      }
      this.alpha += (this.target - this.alpha) * 0.0228;
    }
    // Níveis: o que ela sabe de vocês no núcleo; o conhecimento em cascas, do básico (perto) ao especialista (longe),
    // cada área numa direção do espaço.
    placeLevels() {
      const L = this.lay;
      for (const n of this.nodes) {
        const hub = n.kind === "hub", ring = hub ? (L.kc.includes(n.cat) ? 6 : 0) : n.ring, R = L.R[ring], d = L.dir(n), hw = hub ? 0 : L.hw(n);
        const cr = Math.hypot(n.x, n.y, n.z) || 1;
        let ux = n.x / cr, uy = n.y / cr, uz = n.z / cr;
        const dot = Math.max(-1, Math.min(1, ux * d[0] + uy * d[1] + uz * d[2])), ang = Math.acos(dot);
        if (ang > hw) {
          let px = ux - d[0] * dot, py = uy - d[1] * dot, pz = uz - d[2] * dot;
          const pl = Math.hypot(px, py, pz) || 1;
          px /= pl; py /= pl; pz /= pl;
          ux = d[0] * Math.cos(hw) + px * Math.sin(hw); uy = d[1] * Math.cos(hw) + py * Math.sin(hw); uz = d[2] * Math.cos(hw) + pz * Math.sin(hw);
        }
        const r = hub ? R : ring === 0 ? Math.min(cr, R * 0.92) : Math.max(R - L.base * 0.22, Math.min(R + L.base * 0.22, cr)), s = hub ? 0.2 : 0.09;
        n.vx += (ux * r - n.x) * s; n.vy += (uy * r - n.y) * s; n.vz += (uz * r - n.z) * s;
      }
    }
    lit() {
      const act = this.hover || this.selected;
      if (act) { const s = new Set([act]); const nb = this.near.get(act); if (nb) for (const x of nb) s.add(x); return s; }
      if (this.matches) { const s = new Set(); for (const id of this.matches) { const n = this.byId.get(id); if (n) s.add(n); } return s; }
      return null;
    }
    // ---------- câmera ----------
    eye() {
      const c = this.cam, cp = Math.cos(c.pitch);
      return [c.tx + c.dist * cp * Math.sin(c.yaw), c.ty + c.dist * Math.sin(c.pitch), c.tz + c.dist * cp * Math.cos(c.yaw)];
    }
    matrices() {
      const e = this.eye(), c = this.cam, aspect = this.W / this.H, fov = 0.9;
      const far = this.theme === "light" ? c.dist + (this.cloud + 200) * 3 : 60000;
      const P = perspective(fov, aspect, Math.max(0.5, c.dist * 0.01), far), V = lookAt(e, [c.tx, c.ty, c.tz], [0, 1, 0]);
      let VP = mul(P, V);
      if (this.off) { const T = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, this.off, 0, 0, 1]); VP = mul(T, VP); }
      this.VP = VP; this.F = [P[0], P[5]]; this.E = e; this.fov = fov;
      return VP;
    }
    project(x, y, z) {
      const m = this.VP, cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cw <= 0.01) return null;
      return { x: (cx / cw * 0.5 + 0.5) * this.W, y: (0.5 - cy / cw * 0.5) * this.H, w: cw };
    }
    pick(sx, sy) {
      if (!this.VP) return null;
      let best = null, bd = Infinity;
      const scale = this.H / 2 * this.F[1];
      for (const n of this.nodes) {
        const s = this.project(n.x, n.y, n.z);
        if (!s) continue;
        const rr = Math.max(6, n.r * scale / s.w + 4), dx = s.x - sx, dy = s.y - sy, d = dx * dx + dy * dy;
        if (d < rr * rr && s.w < bd) { bd = s.w; best = n; }
      }
      return best;
    }
    fit(ids, ms = 800) {
      if (ids && ids.length) this.touched = true;
      const list = ids && ids.length ? ids.map((id) => this.byId.get(id)).filter(Boolean) : this.nodes;
      if (!list.length) return;
      let cx = 0, cy = 0, cz = 0;
      if (ids && ids.length) { for (const n of list) { cx += n.x; cy += n.y; cz += n.z; } cx /= list.length; cy /= list.length; cz /= list.length; }
      let R = 0;
      for (const n of list) R = Math.max(R, Math.hypot(n.x - cx, n.y - cy, n.z - cz) + n.r);
      if (!ids && this.mode === "levels" && this.lay) R = Math.max(R * 0.6, this.lay.R[this.lay.kc.length ? 6 : 0] + 40);
      const half = Math.min(0.45, 0.45 * Math.min(1, this.W / this.H)), dist = Math.max(40, (R + (list.length === 1 ? 30 : 20)) / Math.tan(half)) * (list.length === 1 ? 1.6 : 1.05);
      this.anim = { from: { ...this.cam }, to: { ...this.cam, tx: cx, ty: cy, tz: cz, dist }, t0: performance.now(), ms };
    }
    spark(e, from, bright) {
      if (this.pulses.length > 140) return;
      this.pulses.push({ e, rev: from === e.b, t0: performance.now(), dur: 700 + Math.random() * 900 + (bright ? 0 : 600), bright: bright ? 1 : 0 });
    }
    fire(id) {
      const n = this.byId.get(id);
      if (!n) return;
      n.flash = performance.now(); this.attrDirty = true;
      if (this.effects) for (const e of (this.adj.get(n) || []).slice(0, 30)) this.spark(e, n, true);
    }
    celebrate() { this.wave = performance.now(); for (const n of this.nodes) if (n.kind === "hub" || n.r > 6.5) this.fire(n.id); }
    // ---------- quadro a quadro ----------
    frame(t) {
      if (this.dead) return;
      this.raf = requestAnimationFrame(this.frame);
      if (document.hidden || !this.W || this.lost) return;
      if (this.nodes.length && (this.alpha > 0.004 || this.target > 0)) {
        const until = performance.now() + 7;
        let steps = 0;
        do { this.tick(); steps++; } while (steps < 3 && this.alpha > 0.03 && !this.demo && performance.now() < until);
        this.moved = true;
      }
      if (this.demo && this.opt.onFrame) this.opt.onFrame(t);
      const c = this.cam;
      // Girando: devagar sozinha quando ninguém mexe; com embalo depois de soltar o arrasto.
      if (!this.drag) {
        c.yaw += this.vel.yaw; c.pitch = Math.max(-1.45, Math.min(1.45, c.pitch + this.vel.pitch));
        this.vel.yaw *= 0.93; this.vel.pitch *= 0.93;
        if (this.spin && (this.demo || t - this.idleAt > 3500) && !this.hover) c.yaw += 0.0016;
      }
      if (this.demo) {
        const want = (this.cloud * 1.4 + 60) / Math.tan(0.42) * (this.W > 720 ? 1.15 : 1);
        c.dist += (want - c.dist) * 0.04; c.tx = c.ty = c.tz = 0;
        this.off = this.W > 720 ? 0.34 : 0;
        if (this.W <= 720) c.ty = -this.cloud * 0.25;
      }
      if (this.anim) {
        const p = Math.min(1, (t - this.anim.t0) / this.anim.ms), e = 1 - Math.pow(1 - p, 3), f = this.anim.from, to = this.anim.to;
        c.tx = f.tx + (to.tx - f.tx) * e; c.ty = f.ty + (to.ty - f.ty) * e; c.tz = f.tz + (to.tz - f.tz) * e; c.dist = f.dist * Math.pow(to.dist / f.dist, e);
        if (p >= 1) this.anim = null;
      }
      // Enquanto a rede se arruma (e ninguém mexeu na câmera), a câmera vai se afastando junto para caber tudo.
      if (!this.demo && !this.touched && this.fitted !== 2 && !this.anim && this.nodes.length) {
        const R = this.mode === "levels" && this.lay ? this.lay.R[this.lay.kc.length ? 6 : 0] + 40 : this.cloud * 1.15 + 30;
        const half = Math.min(0.45, 0.45 * Math.min(1, this.W / this.H)), want = R / Math.tan(half) * 1.05;
        c.dist += (want - c.dist) * 0.08; c.tx *= 0.9; c.ty *= 0.9; c.tz *= 0.9;
      }
      if (this.fitted === 1 && !this.touched && this.alpha < 0.02 && !this.demo) { this.fitted = 2; this.fit(null, 900); }
      if (!this.fitted && this.nodes.length && (this.alpha < 0.15 || this.demo)) {
        this.fitted = 1;
        if (this.demo) c.dist = (this.cloud * 1.18 + 60) / Math.tan(0.42);
      }
      const moving = this.moved || this.anim || this.drag || Math.abs(this.vel.yaw) > 1e-5 || Math.abs(this.vel.pitch) > 1e-5 || (this.spin && (this.demo || t - this.idleAt > 3500));
      if (moving || this.dirty || this.attrDirty || this.pulses.length || this.wave || (this.effects && t - (this.lastDraw || 0) > (this.slow ? 80 : 33))) {
        const t0 = performance.now();
        this.draw(t);
        this.cost = (this.cost || 0) * 0.9 + (performance.now() - t0) * 0.1;
        this.slow = this.cost > 22;
        this.lastDraw = t; this._dirty = false; this.moved = false;
      }
    }
    colorOf(n) {
      const base = this.colors ? this.opt.color(n.cat) : [0.85, 0.85, 0.88];
      if (n.kind === "hub") return this.theme === "light" ? base : mixc(base, [1, 1, 1], 0.55);
      return tint(base, n.seed);
    }
    buildAttrs(t) {
      const ns = this.nodes, N = ns.length, light = this.theme === "light";
      if (!this.pos || this.pos.length !== N * 3) { this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3); this.info = new Float32Array(N * 4); }
      const lit = this.lit(), act = this.hover || this.selected;
      for (let i = 0; i < N; i++) {
        const n = ns[i], on = lit ? lit.has(n) : true;
        let c = this.colorOf(n);
        // O tempo apaga a estrela; lembrar e revisar acendem de novo.
        if (n.kind !== "hub" && n.ret != null && n.ret < 0.999) {
          const f = 0.3 + 0.7 * n.ret;
          c = light ? c.map((v) => v + (1 - v) * (1 - f) * 0.75) : c.map((v) => v * f);
        }
        this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
        let flags = (n.kind === "hub" ? 1 : 0) + (lit && !on ? 2 : 0) + (lit && on && n !== act ? 4 : 0) + (n === act ? 8 : 0) + (n.flash && t - n.flash < 1600 ? 32 : 0);
        this.info[i * 4] = n.r * (light ? 1.0 : 0.9); this.info[i * 4 + 1] = n.seed; this.info[i * 4 + 2] = n.kind === "hub" ? 0 : n.level; this.info[i * 4 + 3] = flags;
      }
      // As linhas: cor da estrela de onde saem; raios esbranquiçados nos centros, como no mapa da internet.
      const E = this.edges.length, levels = this.mode === "levels";
      if (!this.lcol || this.lcol.length !== E * 8) { this.lcol = new Float32Array(E * 8); this.lpos = new Float32Array(E * 6); }
      const pinkish = E < 1500, base = (lit ? 0.06 : light ? (pinkish ? 0.34 : 0.22) : 0.46) * (light ? 1 : this.density);
      for (let i = 0; i < E; i++) {
        const e = this.edges[i], mine = act && (e.a === act || e.b === act);
        let c, a;
        if (mine) { c = [0.55, 0.36, 0.96]; a = 0.95; }
        else if (light) {
          c = e.trail ? this.colorOf(e.a) : pinkish ? [0.93, 0.47, 0.7] : [0.38, 0.38, 0.42];
          a = e.trail ? 0.75 : base * (e.hub ? 0.7 : 1);
        } else {
          const src = e.hub ? e.a : e.a;
          c = this.colorOf(src);
          if (e.hub) c = mixc(c, [1, 1, 1], 0.45);
          a = Math.min(0.75, base * (e.trail ? 2.4 : e.hub ? 0.75 : 1));
        }
        if (levels && e.hub && !mine) a = 0;
        for (let k = 0; k < 2; k++) { this.lcol[i * 8 + k * 4] = c[0]; this.lcol[i * 8 + k * 4 + 1] = c[1]; this.lcol[i * 8 + k * 4 + 2] = c[2]; this.lcol[i * 8 + k * 4 + 3] = a; }
      }
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.col); gl.bufferData(gl.ARRAY_BUFFER, this.col, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.info); gl.bufferData(gl.ARRAY_BUFFER, this.info, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.lcol); gl.bufferData(gl.ARRAY_BUFFER, this.lcol, gl.DYNAMIC_DRAW);
      this.lastAttr = t;
    }
    attrib(loc, buf, size) {
      const gl = this.gl;
      if (loc == null || loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    draw(t) {
      const gl = this.gl, light = this.theme === "light", G = this.g, now = performance.now();
      const VP = this.matrices(), c = this.cam;
      gl.viewport(0, 0, this.c.width, this.c.height);
      gl.clearColor(light ? 1 : 0.016, light ? 1 : 0.016, light ? 1 : 0.035, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.BLEND);
      const N = this.nodes.length;
      const flashing = this.nodes.some((n) => n.flash && now - n.flash < 1600);
      if (this.attrDirty || flashing || (this.flashWas && !flashing)) { this.buildAttrs(now); this.attrDirty = false; }
      this.flashWas = flashing;
      // posições
      if (!this.pos || this.pos.length !== N * 3) this.buildAttrs(now);
      for (let i = 0; i < N; i++) { const n = this.nodes[i]; this.pos[i * 3] = n.x; this.pos[i * 3 + 1] = n.y; this.pos[i * 3 + 2] = n.z; }
      for (let i = 0; i < this.edges.length; i++) {
        const e = this.edges[i];
        this.lpos[i * 6] = e.a.x; this.lpos[i * 6 + 1] = e.a.y; this.lpos[i * 6 + 2] = e.a.z; this.lpos[i * 6 + 3] = e.b.x; this.lpos[i * 6 + 4] = e.b.y; this.lpos[i * 6 + 5] = e.b.z;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.pos); gl.bufferData(gl.ARRAY_BUFFER, this.pos, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.lpos); gl.bufferData(gl.ARRAY_BUFFER, this.lpos, gl.DYNAMIC_DRAW);
      const fade = [c.dist - this.cloud * 0.6, c.dist + this.cloud * 1.6];
      const scale = this.c.height / 2 * this.F[1];

      if (!light) {
        // fundo: névoa e céu de estrelas
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(this.Q.p);
        gl.blendFunc(gl.ONE, gl.ZERO);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.uniform1i(this.Q.u.uTex, 0); gl.uniform1f(this.Q.u.uAlpha, Math.min(1.25, 0.8 + G * 0.6));
        this.attrib(this.Q.a.aXY, this.buf.quad, 2);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.blendFunc(gl.ONE, gl.ONE);
        const sky = this.bg, R = 30000, k = Math.floor((500 + G * 1900) * (this.slow ? 0.5 : 1));
        if (!this.skyBuilt) {
          const p = new Float32Array(sky.n * 3), inf = new Float32Array(sky.info);
          for (let i = 0; i < sky.n; i++) { p[i * 3] = sky.pos[i * 3] * R; p[i * 3 + 1] = sky.pos[i * 3 + 1] * R; p[i * 3 + 2] = sky.pos[i * 3 + 2] * R; inf[i * 4] = sky.sizes[i]; }
          this.skyPos = p; this.skyInfo = inf; this.skyBuilt = true;
        }
        // O céu acompanha a câmera (só gira, não se aproxima).
        const e = this.E, sp = new Float32Array(this.skyPos.length);
        for (let i = 0; i < sp.length; i += 3) { sp[i] = this.skyPos[i] + e[0]; sp[i + 1] = this.skyPos[i + 1] + e[1]; sp[i + 2] = this.skyPos[i + 2] + e[2]; }
        this.drawPoints(sp, sky.col, this.skyInfo, Math.min(k, sky.n), VP, R / 1.4, t, [0, 1e9]);
        // nuvens das categorias
        this.drawClouds(VP, G);
      } else {
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      }

      // linhas
      gl.useProgram(this.L.p);
      if (light) { gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); } else gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniformMatrix4fv(this.L.u.uVP, false, VP); gl.uniform2f(this.L.u.uFade, fade[0], fade[1]); gl.uniform1f(this.L.u.uLight, light ? 1 : 0);
      this.attrib(this.L.a.aPos, this.buf.lpos, 3); this.attrib(this.L.a.aColor, this.buf.lcol, 4);
      if (this.edges.length) gl.drawArrays(gl.LINES, 0, this.edges.length * 2);
      if (light) gl.depthMask(true);
      // cascas da vista em níveis
      if (this.mode === "levels" && this.lay) this.drawShells(VP, light);

      // estrelas (memórias)
      gl.useProgram(this.P.p);
      if (light) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.ONE, gl.ONE);
      this.setPointUniforms(VP, scale, t, fade, G, light);
      this.attrib(this.P.a.aPos, this.buf.pos, 3); this.attrib(this.P.a.aColor, this.buf.col, 3); this.attrib(this.P.a.aInfo, this.buf.info, 4);
      if (N) gl.drawArrays(gl.POINTS, 0, N);

      // faíscas
      if (this.effects && this.edges.length) {
        const dt = Math.min(80, t - (this.lastT || t));
        this.pAcc += (dt / 1000) * (0.6 + G * 22) * (this.slow ? 0.4 : 1);
        while (this.pAcc >= 1) { this.pAcc -= 1; const e = this.edges[Math.floor(Math.random() * this.edges.length)]; if (!e.hub || Math.random() < 0.3) this.spark(e, Math.random() < 0.5 ? e.a : e.b, false); }
      }
      this.lastT = t;
      this.pulses = this.pulses.filter((p) => now - p.t0 < p.dur && this.byId.get(p.e.a.id) === p.e.a && this.byId.get(p.e.b.id) === p.e.b);
      if (this.pulses.length && !light) {
        const M = this.pulses.length, sp = new Float32Array(M * 3), sc = new Float32Array(M * 3), si = new Float32Array(M * 4);
        this.pulses.forEach((p, i) => {
          const f = (now - p.t0) / p.dur, u = p.rev ? 1 - f : f, a = p.e.a, b = p.e.b, k = Math.sin(f * Math.PI);
          sp[i * 3] = a.x + (b.x - a.x) * u; sp[i * 3 + 1] = a.y + (b.y - a.y) * u; sp[i * 3 + 2] = a.z + (b.z - a.z) * u;
          const col = p.bright ? [0.8, 0.72, 1] : mixc(this.colorOf(p.e.a), [1, 1, 1], 0.4);
          sc[i * 3] = col[0] * k; sc[i * 3 + 1] = col[1] * k; sc[i * 3 + 2] = col[2] * k;
          si[i * 4] = p.bright ? 2.6 : 1.7; si[i * 4 + 1] = 0.5; si[i * 4 + 2] = 0; si[i * 4 + 3] = 16;
        });
        this.drawPoints(sp, sc, si, M, VP, scale, t, fade);
      }
      // onda de luz quando muda de estágio
      if (this.wave && !light) {
        const p = (now - this.wave) / 2600;
        if (p >= 1) this.wave = null;
        else this.drawCircle(VP, (this.cloud * 1.3 + 60) * p, [0.65, 0.55, 0.98], 0.7 * (1 - p), false);
      }
      this.drawLabels(t);
    }
    setPointUniforms(VP, scale, t, fade, G, light) {
      const gl = this.gl, u = this.P.u;
      gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniform1f(u.uScale, scale); gl.uniform1f(u.uMax, this.maxPoint);
      gl.uniform1f(u.uTime, t / 1000); gl.uniform1f(u.uLight, light ? 1 : 0); gl.uniform1f(u.uLightV, light ? 1 : 0);
      // Muitas estrelas juntas somam luz demais: o brilho de cada uma baixa um pouco quando o cérebro fica enorme.
      gl.uniform1f(u.uBright, Math.max(0.5, Math.min(1, 1.1 - Math.max(0, Math.log10(this.nodes.length + 1) - 2.3) * 0.45))); gl.uniform1f(u.uG, G); gl.uniform2f(u.uFade, fade[0], fade[1]);
    }
    drawPoints(pos, col, info, n, VP, scale, t, fade) {
      const gl = this.gl;
      gl.useProgram(this.P.p);
      this.setPointUniforms(VP, scale, t, fade, this.g, false);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.spos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.scol); gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.sinfo); gl.bufferData(gl.ARRAY_BUFFER, info, gl.DYNAMIC_DRAW);
      this.attrib(this.P.a.aPos, this.buf.spos, 3); this.attrib(this.P.a.aColor, this.buf.scol, 3); this.attrib(this.P.a.aInfo, this.buf.sinfo, 4);
      gl.drawArrays(gl.POINTS, 0, n);
    }
    drawClouds(VP, G) {
      const acc = new Map();
      for (const n of this.nodes) {
        if (n.lone) continue;
        let s = acc.get(n.cat);
        if (!s) acc.set(n.cat, (s = { x: 0, y: 0, z: 0, q: 0, n: 0 }));
        s.x += n.x; s.y += n.y; s.z += n.z; s.q += n.x * n.x + n.y * n.y + n.z * n.z; s.n++;
      }
      const list = [...acc].filter(([, s]) => s.n >= 3);
      if (!list.length) return;
      const lit = !!this.lit(), data = new Float32Array(list.length * 6 * 10), corners = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]];
      list.forEach(([cat, s], i) => {
        const x = s.x / s.n, y = s.y / s.n, z = s.z / s.n, r = Math.sqrt(Math.max(30, s.q / s.n - (x * x + y * y + z * z)));
        const c = this.colors ? this.opt.color(cat) : [0.55, 0.36, 0.96], a = (0.035 + 0.16 * G) * Math.min(1, s.n / 14) * (lit ? 0.35 : 1);
        corners.forEach((k, j) => { data.set([x, y, z, k[0], k[1], c[0], c[1], c[2], a, r * 1.9 + 30], (i * 6 + j) * 10); });
      });
      const gl = this.gl, C = this.C;
      gl.useProgram(C.p); gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniformMatrix4fv(C.u.uVP, false, VP); gl.uniform2f(C.u.uF, this.F[0], this.F[1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.cloud); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      const st = 40, set = (loc, size, off) => { if (loc == null || loc < 0) return; gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, off); };
      set(C.a.aCenter, 3, 0); set(C.a.aCorner, 2, 12); set(C.a.aColor, 4, 20); set(C.a.aSize, 1, 36);
      gl.drawArrays(gl.TRIANGLES, 0, list.length * 6);
    }
    // Um círculo sempre de frente para a câmera (a "casca" de um nível ou a onda de luz).
    drawCircle(VP, R, col, a, dashed) {
      const gl = this.gl, e = this.E, c = this.cam;
      let fx = c.tx - e[0], fy = c.ty - e[1], fz = c.tz - e[2];
      const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      let rx = fz, ry = 0, rz = -fx;
      const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; rz /= rl;
      const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx, S = 120, pos = [], colr = [];
      for (let i = 0; i < S; i++) {
        if (dashed && i % 2) continue;
        for (const j of [i, i + 1]) {
          const t = (j / S) * TAU, ct = Math.cos(t), st = Math.sin(t);
          pos.push(c.tx + (rx * ct + ux * st) * R, c.ty + (ry * ct + uy * st) * R, c.tz + (rz * ct + uz * st) * R);
          colr.push(col[0], col[1], col[2], a);
        }
      }
      gl.useProgram(this.L.p);
      gl.uniformMatrix4fv(this.L.u.uVP, false, VP); gl.uniform2f(this.L.u.uFade, 0, 1e9); gl.uniform1f(this.L.u.uLight, this.theme === "light" ? 1 : 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.spos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.scol); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colr), gl.DYNAMIC_DRAW);
      this.attrib(this.L.a.aPos, this.buf.spos, 3); this.attrib(this.L.a.aColor, this.buf.scol, 4);
      gl.drawArrays(gl.LINES, 0, pos.length / 3);
    }
    drawShells(VP, light) {
      const L = this.lay, cols = this.opt.levelColors || [];
      const saved = [this.cam.tx, this.cam.ty, this.cam.tz];
      this.cam.tx = this.cam.ty = this.cam.tz = 0;
      if (L.pc.length) this.drawCircle(VP, L.R[0], light ? [0.93, 0.36, 0.6] : [0.96, 0.45, 0.71], light ? 0.35 : 0.25, false);
      for (let i = 1; i <= 5; i++) if (L.kc.length) this.drawCircle(VP, L.R[i], cols[i] || [0.6, 0.6, 0.7], light ? 0.5 : 0.35, true);
      [this.cam.tx, this.cam.ty, this.cam.tz] = saved;
    }
    drawLabels(t) {
      const ctx = this.octx, d = this.dpr, W = this.W, H = this.H, light = this.theme === "light";
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.o.width, this.o.height);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const lit = this.lit(), act = this.hover || this.selected, scale = H / 2 * this.F[1];
      // "Dia N" bem apagado no meio
      const cap = this.caption && this.mode !== "levels" && this.caption();
      if (cap) {
        const o = this.project(0, 0, 0);
        if (o) {
          const size = Math.max(24, Math.min(78, this.cloud * scale / o.w * 0.3));
          ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.globalAlpha = lit ? 0.3 : 1;
          ctx.font = `600 ${size}px "IBM Plex Sans", system-ui, sans-serif`;
          ctx.fillStyle = light ? "rgba(63,63,70,0.16)" : "rgba(186,230,253,0.26)"; ctx.fillText(cap.big, o.x, o.y - size * 0.15);
          ctx.font = `400 ${Math.max(12, size * 0.24)}px "IBM Plex Sans", system-ui, sans-serif`;
          ctx.fillStyle = light ? "rgba(63,63,70,0.4)" : "rgba(186,230,253,0.45)"; ctx.fillText(cap.small, o.x, o.y + size * 0.55);
          ctx.globalAlpha = 1;
        }
      }
      if (this.mode === "levels" && this.lay) {
        const L = this.lay, e = this.E, c = this.cam;
        let fx = -e[0], fy = -e[1], fz = -e[2];
        const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
        let rx = fz, rz = -fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
        // "Para cima" na tela, para os nomes ficarem no alto de cada casca.
        const ux = rz * fy, uy = -(rz * fx - rx * fz), uz = -rx * fy;
        ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.font = `600 11px "IBM Plex Sans", system-ui, sans-serif`;
        if ("letterSpacing" in ctx) ctx.letterSpacing = "1.5px";
        if (L.kc.length) for (let i = 1; i <= 5; i++) {
          const s = this.project(ux * L.R[i], uy * L.R[i], uz * L.R[i]);
          if (!s) continue;
          ctx.globalAlpha = lit ? 0.4 : 0.95; ctx.fillStyle = (this.opt.levelHex || [])[i] || "#a1a1aa";
          ctx.fillText((this.opt.levelNames || [])[i] ? this.opt.levelNames[i].toUpperCase() : "NÍVEL " + i, s.x, s.y - 3);
        }
        if (L.pc.length) { const s = this.project(0, 0, 0); if (s) { ctx.textBaseline = "middle"; ctx.fillStyle = light ? "rgba(190,24,93,0.55)" : "rgba(251,207,232,0.6)"; ctx.fillText("VOCÊS", s.x, s.y); } }
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
        ctx.globalAlpha = 1;
        void c;
      }
      // Os nomes: centros sempre, o que está aceso, e as estrelas que chegam perto da câmera. Sem atropelar.
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.lineJoin = "round";
      const wanted = [];
      for (const n of this.nodes) {
        const on = lit ? lit.has(n) : true, isHub = n.kind === "hub";
        const s = this.project(n.x, n.y, n.z);
        if (!s || s.x < -100 || s.x > W + 100 || s.y < -30 || s.y > H + 30) continue;
        const px = n.r * scale / s.w;
        let alpha, rank;
        if (n === act || n === this.hover) { alpha = 1; rank = 5; }
        else if (lit && on) { alpha = 0.9; rank = 4; }
        else if (isHub) { alpha = lit ? 0.3 : this.demo ? 0.7 : 0.92; rank = 3; }
        else if (!this.demo && px > 6) { alpha = lit ? 0.15 : Math.min(0.85, 0.3 + (px - 6) * 0.08); rank = 1 + Math.min(1.5, px / 12); }
        else continue;
        wanted.push({ n, s, px, alpha, rank, on, isHub });
      }
      wanted.sort((a, b) => b.rank - a.rank || a.s.w - b.s.w);
      const taken = [];
      let small = 0;
      for (const w of wanted) {
        if (taken.length > 260) break;
        if (w.rank < 3 && ++small > 45) continue;
        const n = w.n;
        let label = n.label.length > 44 ? n.label.slice(0, 42) + "…" : n.label;
        if (w.isHub) label = label.toUpperCase();
        const y = w.s.y + Math.min(30, w.px) + (w.isHub ? 6 : 4), half = label.length * (w.isHub ? 4.1 : 3.05) + 4, box = [w.s.x - half, y - 1, w.s.x + half, y + 14];
        if (w.rank < 4.5 && taken.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        taken.push(box);
        ctx.font = w.isHub ? `600 11px "IBM Plex Sans", system-ui, sans-serif` : `400 11px "IBM Plex Sans", system-ui, sans-serif`;
        if (w.isHub && "letterSpacing" in ctx) ctx.letterSpacing = "1.6px";
        ctx.globalAlpha = w.alpha;
        ctx.lineWidth = 3; ctx.strokeStyle = light ? "rgba(255,255,255,0.92)" : "rgba(4,4,9,0.85)";
        ctx.strokeText(label, w.s.x, y);
        let fill;
        if (n === act) fill = light ? "#4c1d95" : "#ffffff";
        else if (lit && w.on) fill = light ? "#5b21b6" : "#ede9fe";
        else if (w.isHub) { const c = this.colors ? this.opt.color(n.cat) : [0.6, 0.6, 0.65], m = light ? mixc(c, [0, 0, 0], 0.45) : mixc(c, [1, 1, 1], 0.55); fill = `rgb(${Math.round(m[0] * 255)},${Math.round(m[1] * 255)},${Math.round(m[2] * 255)})`; }
        else fill = light ? "#52525b" : "#a1a1aa";
        ctx.fillStyle = fill;
        ctx.fillText(label, w.s.x, y);
        if (w.isHub && "letterSpacing" in ctx) ctx.letterSpacing = "0px";
      }
      ctx.globalAlpha = 1;
    }
    // ---------- mouse e dedo ----------
    bind() {
      const c = this.c, pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      const touch = () => { this.idleAt = performance.now(); this.touched = true; this.anim = null; };
      c.addEventListener("wheel", (e) => {
        if (this.demo) return;
        e.preventDefault(); touch();
        this.cam.dist = Math.max(8, Math.min(40000, this.cam.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012))));
        this.dirty = true;
      }, { passive: false });
      c.addEventListener("contextmenu", (e) => { if (!this.demo) e.preventDefault(); });
      c.addEventListener("pointerdown", (e) => {
        const p = pos(e);
        this.ptrs.set(e.pointerId, p);
        if (this.demo) return;
        touch();
        c.setPointerCapture(e.pointerId);
        if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: this.cam.dist, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; this.drag = null; return; }
        this.drag = { start: p, last: p, moved: false, pan: e.button === 2 || e.shiftKey, t: performance.now() };
        this.vel.yaw = this.vel.pitch = 0;
      });
      const panBy = (dx, dy) => {
        const cm = this.cam, s = cm.dist * 0.0016, cy = Math.cos(cm.yaw), sy = Math.sin(cm.yaw);
        cm.tx -= cy * dx * s; cm.tz += sy * dx * s; cm.ty += dy * s;
      };
      c.addEventListener("pointermove", (e) => {
        const p = pos(e);
        if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, p);
        if (this.pinch && this.ptrs.size === 2) {
          const [a, b] = [...this.ptrs.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          this.cam.dist = Math.max(8, Math.min(40000, this.pinch.dist * this.pinch.d / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y))));
          panBy(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y); this.pinch.mid = mid;
          this.idleAt = performance.now(); this.dirty = true;
          return;
        }
        const dr = this.drag;
        if (dr) {
          const dx = p.x - dr.last.x, dy = p.y - dr.last.y;
          if (Math.hypot(p.x - dr.start.x, p.y - dr.start.y) > 4) dr.moved = true;
          if (dr.moved) {
            if (dr.pan) panBy(dx, dy);
            else {
              this.cam.yaw -= dx * 0.006; this.cam.pitch = Math.max(-1.45, Math.min(1.45, this.cam.pitch + dy * 0.006));
              this.vel.yaw = -dx * 0.006; this.vel.pitch = dy * 0.006;
            }
            this.idleAt = performance.now(); this.dirty = true;
            if (this.hover) { this.hover = null; this.attrDirty = true; if (this.opt.onHover) this.opt.onHover(null); }
          }
          dr.last = p;
          return;
        }
        const n = this.pick(p.x, p.y);
        if (n !== this.hover) { this.hover = n; this.attrDirty = true; c.style.cursor = n ? "pointer" : this.demo ? "default" : "grab"; }
        if (n) this.idleAt = performance.now();
        if (this.opt.onHover) this.opt.onHover(n, p);
      });
      const end = (e) => {
        this.ptrs.delete(e.pointerId);
        if (this.pinch) { if (this.ptrs.size < 2) this.pinch = null; return; }
        const dr = this.drag;
        this.drag = null;
        if (!dr) return;
        if (!dr.moved) {
          const p = pos(e), n = this.pick(p.x, p.y);
          if (this.opt.onSelect) this.opt.onSelect(n);
          // Duas vezes no vazio: volta a ver tudo.
          if (!n) { const now = performance.now(); if (now - (this.lastEmpty || 0) < 400) { this.touched = false; this.fit(null, 800); } this.lastEmpty = now; }
        } else if (performance.now() - dr.t > 30) { /* embalo já em vel */ }
      };
      c.addEventListener("pointerup", end);
      c.addEventListener("pointercancel", end);
      c.addEventListener("pointerleave", () => { if (!this.drag && this.hover) { this.hover = null; this.attrDirty = true; if (this.opt.onHover) this.opt.onHover(null); } });
    }
  }
  Space.starOf = starOf;
  window.Space = Space;
})();
