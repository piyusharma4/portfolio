/* ==========================================================================
   Piyush Sharma — portfolio
   Everything degrades: no GSAP → static page; reduced motion → final states.
   ========================================================================== */
(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const hasGsap = !!(window.gsap && window.ScrollTrigger && window.SplitText);
    const animate = hasGsap && !reduced;

    if (!animate) root.classList.remove('anim');

    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;

    let lenis = null;

    /* ---------------------------------------------------------------
       Grain — a tiny tile of noise, generated rather than downloaded
       --------------------------------------------------------------- */
    (function grain() {
        const c = document.createElement('canvas');
        c.width = c.height = 160;
        const x = c.getContext('2d');
        const img = x.createImageData(160, 160);
        for (let i = 0; i < img.data.length; i += 4) {
            const v = Math.random() * 255;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
            img.data[i + 3] = Math.random() < 0.5 ? 10 : 0;
        }
        x.putImageData(img, 0, 0);
        $('.grain').style.backgroundImage = `url(${c.toDataURL()})`;
    })();

    /* ---------------------------------------------------------------
       Clock — local time in Noida
       --------------------------------------------------------------- */
    (function clock() {
        const fmt = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata', hour12: false,
        });
        const els = $$('[data-clock]');
        const tick = () => {
            const t = fmt.format(new Date()) + ' IST';
            els.forEach((el) => (el.textContent = t));
        };
        tick();
        setInterval(tick, 15000);
        $$('[data-year]').forEach((el) => (el.textContent = new Date().getFullYear()));
    })();

    /* ---------------------------------------------------------------
       Smooth scroll + anchors
       --------------------------------------------------------------- */
    if (animate && window.Lenis) {
        lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.95 });
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add((t) => lenis.raf(t * 1000));
        gsap.ticker.lagSmoothing(0);
    }

    const menu = $('#menu');
    const toggle = $('.nav__toggle');
    const setMenu = (open) => {
        menu.classList.toggle('is-open', open);
        menu.setAttribute('aria-hidden', String(!open));
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Close' : 'Menu';
        if (lenis) open ? lenis.stop() : lenis.start();
    };
    toggle.addEventListener('click', () => setMenu(!menu.classList.contains('is-open')));

    $$('[data-scroll-to]').forEach((a) => {
        a.addEventListener('click', (e) => {
            const id = a.getAttribute('href');
            const target = id === '#top' ? 0 : $(id);
            if (target === null) return;
            e.preventDefault();
            setMenu(false);
            if (lenis) {
                lenis.scrollTo(target, { duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
            } else {
                const top = target === 0 ? 0 : target.getBoundingClientRect().top + scrollY;
                window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
            }
        });
    });

    /* ---------------------------------------------------------------
       Contextual cursor label
       --------------------------------------------------------------- */
    const cursor = { x: innerWidth / 2, y: innerHeight / 2, cx: innerWidth / 2, cy: innerHeight / 2 };
    const cursorEl = $('.cursor');
    const cursorLabel = $('.cursor__label');
    if (finePointer) {
        addEventListener('pointermove', (e) => { cursor.x = e.clientX; cursor.y = e.clientY; }, { passive: true });
        $$('[data-cursor]').forEach((el) => {
            el.addEventListener('pointerenter', () => {
                cursorLabel.textContent = el.dataset.cursor;
                cursorEl.classList.add('is-on');
            });
            el.addEventListener('pointerleave', () => cursorEl.classList.remove('is-on'));
        });
        (function loop() {
            cursor.cx = lerp(cursor.cx, cursor.x, 0.22);
            cursor.cy = lerp(cursor.cy, cursor.y, 0.22);
            cursorEl.style.transform = `translate3d(${cursor.cx}px, ${cursor.cy}px, 0)`;
            requestAnimationFrame(loop);
        })();
    }

    /* ===============================================================
       HERO — kinetic type
       The name is set in a few thousand tiles floating on a water surface
       (a damped 2D wave equation on the tile grid). The cursor makes
       ripples; each tile tilts with the slope beneath it, catches the light,
       and flips to its orange back on a steep crest.
       Load: tiles flip in left → right. Scroll: rows fold shut like blinds.
       =============================================================== */
    const field = (function createField() {
        const host = $('[data-field]');
        const canvas = $('canvas', host);
        const ctx = canvas.getContext('2d');
        const readN = $('[data-points]');
        if (!finePointer) $('.hero__hint').textContent = 'Drag across the name to make it ripple.';

        const DAMP = 0.968;      // how quickly ripples die out
        const GAIN = 0.85;       // slope → tilt angle
        
        let W = 0, H = 0, dpr = 1, cell = 9, cols = 0, rows = 0, N = 0, ox = 0, oy = 0;
        let ink, delay, a, b;
        let introP = 0, foldP = 0, introDone = false;
        let visible = true, dirty = true, energy = 0, lastW = 0, lastH = 0;
        const ptr = { x: 0, y: 0, has: false };
        let lastTouch = 0, nextDrop = performance.now() + 7000;

        // Colour ramps — index 0 faces away from the light, LV faces into it.
        const LV = 16;
        const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
        const mix = (p, q, t) => {
            const A = hex(p), B = hex(q);
            return `rgb(${A.map((v, k) => Math.round(v + (B[k] - v) * t)).join(',')})`;
        };
        const ramp = (dark, mid, light) => Array.from({ length: LV + 1 }, (_, i) => {
            const s = (i / LV) * 2 - 1;
            return s < 0 ? mix(mid, dark, -s) : mix(mid, light, s);
        });
        const COLORS = [
            ramp('#000000', '#131211', '#857d73'), // 0: ink face
            ramp('#9c2a08', '#ff4f1f', '#ffb497'), // 1: orange back
            ramp('#cdc6ba', '#ece8e1', '#fdfcf9'), // 2: paper relief
        ];
        const buckets = COLORS.map((r) => r.map(() => []));

        function build() {
            const r = host.getBoundingClientRect();
            W = Math.round(r.width);
            H = Math.round(r.height);
            if (!W || !H) return;
            lastW = W; lastH = H;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = W * dpr;
            canvas.height = H * dpr;

            // Rasterise the name offscreen
            const off = document.createElement('canvas');
            off.width = W; off.height = H;
            const o = off.getContext('2d', { willReadFrequently: true });
            const pad = parseFloat(getComputedStyle($('.hero')).paddingLeft) || 24;
            const lines = ['PIYUSH', 'SHARMA'];
            // Portrait screens get the condensed cut so the name can stand taller.
            // (Assigning ctx.font resets fontStretch, so set it after every font change.)
            const stretch = W < H * 1.2 ? 'extra-condensed' : 'normal';
            const setFont = (px) => {
                o.font = `800 ${px}px Archivo, "Helvetica Neue", Arial, sans-serif`;
                if ('fontStretch' in o) o.fontStretch = stretch;
            };
            o.textBaseline = 'alphabetic';
            setFont(100);
            const widest = Math.max(...lines.map((l) => o.measureText(l).width));
            const lineH = 0.86;
            const size = Math.floor(Math.min(((W - pad * 2) / widest) * 100, H / (lines.length * lineH + 0.08)));
            setFont(size);
            o.fillStyle = '#000';
            const capH = size * 0.72;
            const top = (H - (capH + (lines.length - 1) * size * lineH)) / 2 + capH;
            lines.forEach((l, i) => {
                const w = o.measureText(l).width;
                o.fillText(l, i === 0 ? pad : W - pad - w, top + i * size * lineH);
            });
            const data = o.getImageData(0, 0, W, H).data;

            // Tile grid covering the whole field
            cell = W < 700 ? 5 : Math.round(clamp(W / 160, 7, 11));
            cols = Math.ceil(W / cell) + 2;
            rows = Math.ceil(H / cell) + 2;
            ox = (W - cols * cell) / 2;
            oy = (H - rows * cell) / 2;
            N = cols * rows;
            ink = new Uint8Array(N);
            delay = new Float32Array(N);
            a = new Float32Array(N);
            b = new Float32Array(N);
            let count = 0;
            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const px = Math.round(ox + (x + 0.5) * cell);
                    const py = Math.round(oy + (y + 0.5) * cell);
                    const i = y * cols + x;
                    if (px >= 0 && py >= 0 && px < W && py < H && data[(py * W + px) * 4 + 3] > 128) {
                        ink[i] = 1;
                        count++;
                    }
                    delay[i] = (x / cols) * 0.62 + (y / rows) * 0.1 + Math.random() * 0.06;
                }
            }
            readN.textContent = count.toLocaleString('en-US');
            dirty = true;
            root.classList.add('field-ready');
        }

        // Push the water surface down around (px, py), in CSS pixels
        function drop(px, py, amp, radius) {
            const cx = (px - ox) / cell, cy = (py - oy) / cell;
            const R = Math.ceil(radius);
            const x0 = Math.max(1, Math.floor(cx - R)), x1 = Math.min(cols - 2, Math.ceil(cx + R));
            const y0 = Math.max(1, Math.floor(cy - R)), y1 = Math.min(rows - 2, Math.ceil(cy + R));
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const d = Math.hypot(x - cx, y - cy) / radius;
                    if (d < 1) a[y * cols + x] -= amp * (0.5 + 0.5 * Math.cos(Math.PI * d));
                }
            }
            energy = 1;
        }

        function step() {
            let e = 0;
            for (let y = 1; y < rows - 1; y++) {
                const row = y * cols;
                for (let x = 1; x < cols - 1; x++) {
                    const i = row + x;
                    let v = (a[i - 1] + a[i + 1] + a[i - cols] + a[i + cols]) * 0.5 - b[i];
                    v *= DAMP;
                    b[i] = v;
                    const m = v < 0 ? -v : v;
                    if (m > e) e = m;
                }
            }
            const t = a; a = b; b = t;
            energy = e;
        }

        const easeBack = (t) => {
            const c1 = 1.3, c3 = c1 + 1;
            return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        };

        function draw() {
            for (const set of buckets) for (const bk of set) bk.length = 0;
            const s = cell * 0.82;
            const half = s / 2;
            const intro = introP < 1;
            const folding = foldP > 0;

            for (let y = 1; y < rows - 1; y++) {
                const fold = folding ? clamp(foldP * 1.7 - (y / rows) * 0.7, 0, 1) * Math.PI * 0.5 : 0;
                const cy = oy + (y + 0.5) * cell;
                for (let x = 1; x < cols - 1; x++) {
                    const i = y * cols + x;
                    const isInk = ink[i] === 1;
                    let th = ((a[i + cols] - a[i - cols]) + (a[i + 1] - a[i - 1]) * 0.5) * GAIN;
                    if (!isInk) {
                        th *= 0.55;
                        if (th < 0.035 && th > -0.035) continue;
                    } else if (intro) {
                        const l = clamp((introP - delay[i]) / 0.34, 0, 1);
                        if (l <= 0) continue;
                        th += (1 - easeBack(l)) * Math.PI * 1.5;
                    }
                    th += fold;
                    const c = Math.cos(th);
                    const h = s * (c < 0 ? -c : c);
                    if (h < 0.6) continue;
                    const sn = Math.sin(th);
                    const lv = Math.round((clamp(sn, -1, 1) * 0.5 + 0.5) * LV);
                    const set = isInk ? (c >= 0 ? 0 : 1) : 2;
                    buckets[set][lv].push(ox + (x + 0.5) * cell - half, cy - h / 2 + sn * s * 0.18, h);
                }
            }

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            // paper relief first, then ink, then the orange backs on top
            for (const set of [2, 0, 1]) {
                const lvls = buckets[set];
                for (let lv = 0; lv <= LV; lv++) {
                    const bk = lvls[lv];
                    if (!bk.length) continue;
                    ctx.fillStyle = COLORS[set][lv];
                    for (let k = 0; k < bk.length; k += 3) ctx.fillRect(bk[k], bk[k + 1], s, bk[k + 2]);
                }
            }
        }

        function frame(now) {
            requestAnimationFrame(frame);
            if (!visible || !N) return;

            // A slow raindrop now and then, so the surface invites a touch
            if (!reduced && introDone && foldP === 0 && now > nextDrop && now - lastTouch > 4000) {
                const pick = Math.floor(Math.random() * N);
                for (let k = 0; k < N; k++) {
                    const i = (pick + k * 7919) % N;
                    if (ink[i]) {
                        drop(ox + ((i % cols) + 0.5) * cell, oy + (Math.floor(i / cols) + 0.5) * cell, 7, 3.2);
                        break;
                    }
                }
                nextDrop = now + 6500 + Math.random() * 4000;
            }

            const moving = energy > 0.004;
            if (moving) step();
            if (!moving && !dirty) return;
            draw();
            dirty = moving;
        }

        // Pointer — trace the path so fast strokes leave a continuous wake
        host.addEventListener('pointermove', (e) => {
            if (reduced) return;
            const r = canvas.getBoundingClientRect();
            const x = e.clientX - r.left, y = e.clientY - r.top;
            if (ptr.has) {
                const dist = Math.hypot(x - ptr.x, y - ptr.y);
                const n = Math.max(1, Math.ceil(dist / cell));
                const amp = clamp(dist / 10, 0.8, 6);
                for (let k = 1; k <= n; k++) {
                    drop(ptr.x + ((x - ptr.x) * k) / n, ptr.y + ((y - ptr.y) * k) / n, amp / Math.sqrt(n), 2.4);
                }
            }
            ptr.x = x; ptr.y = y; ptr.has = true;
            lastTouch = performance.now();
        }, { passive: true });
        host.addEventListener('pointerleave', () => (ptr.has = false));
        host.addEventListener('pointerdown', (e) => {
            if (reduced) return;
            const r = canvas.getBoundingClientRect();
            drop(e.clientX - r.left, e.clientY - r.top, 14, 4);
            lastTouch = performance.now();
        });
        host.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') ptr.has = false; });

        new IntersectionObserver(([e]) => { visible = e.isIntersecting; dirty = true; }).observe(host);

        let rt;
        addEventListener('resize', () => {
            clearTimeout(rt);
            rt = setTimeout(() => {
                const r = host.getBoundingClientRect();
                // Ignore mobile URL-bar jitter.
                if (Math.abs(r.width - lastW) > 2 || Math.abs(r.height - lastH) > 120) build();
            }, 180);
        });

        return {
            start() {
                build();
                requestAnimationFrame(frame);
            },
            setIntro(p) {
                introP = p;
                dirty = true;
                if (p >= 1 && !introDone) {
                    introDone = true;
                    if (!reduced) drop(W * 0.3, H * 0.5, 16, 4.5);
                }
            },
            setScroll(p) {
                if (p !== foldP) { foldP = p; dirty = true; }
            },
        };
    })();

    /* ---------------------------------------------------------------
       Statement — words brighten in reading order as you scroll
       --------------------------------------------------------------- */
    function resolveText(el) {
        const words = [];
        const wrap = (node) => {
            Array.from(node.childNodes).forEach((child) => {
                if (child.nodeType === 3) {
                    const frag = document.createDocumentFragment();
                    child.textContent.split(/(\s+)/).forEach((part) => {
                        if (!part) return;
                        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
                        const w = document.createElement('span');
                        w.className = 'w';
                        w.textContent = part;
                        frag.appendChild(w);
                        words.push(w);
                    });
                    child.replaceWith(frag);
                } else if (child.nodeType === 1) wrap(child);
            });
        };
        wrap(el);

        const N = words.length;
        const K = 5;
        return (p) => {
            for (let i = 0; i < N; i++) {
                const lp = clamp((p * (N + K) - i) / K, 0, 1);
                words[i].style.opacity = (0.12 + 0.88 * lp).toFixed(3);
            }
        };
    }

    /* ---------------------------------------------------------------
       Odometer stats
       --------------------------------------------------------------- */
    function buildOdometers() {
        return $$('[data-count]').map((el) => {
            const digits = el.dataset.count.split('');
            el.textContent = '';
            el.classList.add('odo');
            el.setAttribute('aria-label', el.dataset.count);
            const cols = digits.map((d) => {
                const col = document.createElement('span');
                col.className = 'odo__col';
                col.setAttribute('aria-hidden', 'true');
                for (let r = 0; r < 2; r++) for (let k = 0; k < 10; k++) {
                    const s = document.createElement('span');
                    s.textContent = k;
                    col.appendChild(s);
                }
                const s = document.createElement('span');
                s.textContent = d;
                col.appendChild(s);
                el.appendChild(col);
                return col;
            });
            return { el, cols };
        });
    }

    /* ---------------------------------------------------------------
       RAG pipeline — steps light in sequence while a query types
       --------------------------------------------------------------- */
    function pipeline() {
        const fig = $('[data-pipeline]');
        const steps = $$('li', fig);
        const typed = $('[data-typed]', fig);
        const queries = [
            'how do I deal with fear?',
            'what does real freedom mean?',
            'why do we seek validation?',
        ];
        if (reduced) {
            steps.forEach((s) => s.classList.add('is-on'));
            typed.textContent = queries[0];
            return;
        }
        let running = false, timer = null, qi = 0;
        const wait = (ms) => new Promise((r) => (timer = setTimeout(r, ms)));
        async function cycle() {
            while (running) {
                const q = queries[qi++ % queries.length];
                steps.forEach((s) => s.classList.remove('is-on'));
                typed.textContent = '';
                for (let i = 0; i <= q.length && running; i++) {
                    typed.textContent = q.slice(0, i);
                    await wait(38 + Math.random() * 50);
                }
                for (let i = 0; i < steps.length && running; i++) {
                    steps[i].classList.add('is-on');
                    await wait(520);
                }
                await wait(2200);
            }
        }
        new IntersectionObserver(([e]) => {
            if (e.isIntersecting && !running) { running = true; cycle(); }
            else if (!e.isIntersecting) { running = false; clearTimeout(timer); }
        }, { threshold: 0.35 }).observe(fig);
    }

    /* ---------------------------------------------------------------
       Before / after
       --------------------------------------------------------------- */
    function compare() {
        const fig = $('[data-compare]');
        const range = $('.compare__range', fig);
        const set = (v) => fig.style.setProperty('--pos', v + '%');
        range.addEventListener('input', () => set(range.value));
        if (!animate) return;
        const o = { v: 50 };
        ScrollTrigger.create({
            trigger: fig,
            start: 'top 65%',
            once: true,
            onEnter: () => {
                gsap.timeline({ onUpdate: () => { set(o.v); range.value = o.v; } })
                    .to(o, { v: 14, duration: 1.1, ease: 'power3.inOut' })
                    .to(o, { v: 84, duration: 1.4, ease: 'power3.inOut' })
                    .to(o, { v: 50, duration: 1.0, ease: 'power3.inOut' });
            },
        });
    }

    /* ---------------------------------------------------------------
       Project index — floating duotone preview / inline thumbs
       --------------------------------------------------------------- */
    function projectIndex() {
        const rows = $$('.row');
        // Inline thumbnails for touch / narrow screens
        rows.forEach((row) => {
            const th = document.createElement('div');
            th.className = 'row__thumb';
            th.innerHTML = `<img src="${row.dataset.img}" alt="" loading="lazy">`;
            row.insertBefore(th, row.firstChild.nextSibling);
        });
        if (!finePointer) return;

        const pv = $('.preview');
        const inner = $('.preview__inner', pv);
        const imgs = new Map();
        rows.forEach((row) => {
            const img = new Image();
            img.src = row.dataset.img;
            img.alt = '';
            img.style.opacity = '0';
            inner.appendChild(img);
            imgs.set(row, img);
        });

        const st = { x: 0, y: 0, tx: 0, ty: 0, rot: 0, on: false };
        let current = null;
        const list = $('.index__list');
        list.addEventListener('pointermove', (e) => { st.tx = e.clientX; st.ty = e.clientY; });
        rows.forEach((row) => {
            row.addEventListener('pointerenter', (e) => {
                if (!st.on) { st.x = st.tx = e.clientX; st.y = st.ty = e.clientY; }
                if (current) imgs.get(current).style.opacity = '0';
                current = row;
                imgs.get(row).style.opacity = '1';
                st.on = true;
                pv.style.visibility = 'visible';
                pv.classList.add('is-on');
            });
        });
        list.addEventListener('pointerleave', () => {
            st.on = false;
            pv.classList.remove('is-on');
        });

        const w = () => pv.offsetWidth, h = () => pv.offsetHeight;
        (function loop() {
            const px = st.x;
            st.x = lerp(st.x, st.tx, 0.14);
            st.y = lerp(st.y, st.ty, 0.14);
            st.rot = lerp(st.rot, clamp((st.x - px) * 0.35, -9, 9), 0.12);
            // Keep it beside the cursor, flipping sides near the right edge
            const side = st.x > innerWidth * 0.62 ? -w() - 40 : 40;
            pv.style.transform = `translate3d(${st.x + side}px, ${st.y - h() / 2}px, 0) rotate(${st.rot}deg)`;
            requestAnimationFrame(loop);
        })();
    }

    /* ---------------------------------------------------------------
       Marquee — speed follows scroll velocity
       --------------------------------------------------------------- */
    function marquee() {
        const wrap = $('[data-marquee]');
        const track = $('.marquee__track', wrap);
        const copy = track.cloneNode(true);
        copy.setAttribute('aria-hidden', 'true');
        wrap.appendChild(copy);
        if (reduced) return;
        let x = 0, dir = -1, boost = 0, vis = false;
        new IntersectionObserver(([e]) => (vis = e.isIntersecting)).observe(wrap);
        let last = performance.now();
        (function loop(now) {
            requestAnimationFrame(loop);
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            if (!vis) return;
            const v = lenis ? lenis.velocity : 0;
            if (Math.abs(v) > 0.5) dir = v > 0 ? -1 : 1;
            boost = lerp(boost, Math.min(Math.abs(v) * 6, 600), 0.1);
            const width = track.offsetWidth;
            x += dir * (60 + boost) * dt;
            if (x <= -width) x += width;
            if (x > 0) x -= width;
            const skew = clamp(-v * 0.25, -8, 8);
            track.style.transform = copy.style.transform = `translate3d(${x}px,0,0) skewX(${skew}deg)`;
        })(last);
    }

    /* ---------------------------------------------------------------
       Email — letters roll on hover
       --------------------------------------------------------------- */
    function rollLink() {
        const a = $('[data-roll]');
        const text = a.textContent.trim();
        a.setAttribute('aria-label', text);
        a.textContent = '';
        Array.from(text).forEach((c, i) => {
            const s = document.createElement('span');
            s.className = 'roll__c';
            s.dataset.c = c;
            s.textContent = c;
            s.setAttribute('aria-hidden', 'true');
            s.style.transitionDelay = `${i * 12}ms`;
            a.appendChild(s);
        });
    }

    /* ===============================================================
       Boot
       =============================================================== */
    function boot() {
        pipeline();
        compare();
        projectIndex();
        marquee();
        rollLink();
        const odos = buildOdometers();
        const resolve = resolveText($('[data-resolve]'));

        field.start();

        if (!animate) {
            field.setIntro(1);
            resolve(1);
            odos.forEach(({ el, cols }) => cols.forEach((c) => {
                c.style.transform = `translateY(${-(c.children.length - 1) * 0.8}em)`;
            }));
            return;
        }

        gsap.registerPlugin(ScrollTrigger, SplitText);
        root.classList.add('theme-js');

        /* Intro: denoise the name, then bring in the furniture */
        const intro = { p: 0 };
        const tl = gsap.timeline({ delay: 0.15 });
        tl.to(intro, {
            p: 1, duration: 2.6, ease: 'power1.inOut',
            onUpdate: () => field.setIntro(intro.p),
        }, 0)
            .to('.nav', { opacity: 1, duration: 1, ease: 'power2.out' }, 0.4)
            .fromTo('[data-intro]', { opacity: 0, y: 18 }, {
                opacity: 1, y: 0, duration: 1.2, stagger: 0.12, ease: 'expo.out',
            }, 1.4);

        /* Leaving the hero folds the tiles shut, row by row */
        ScrollTrigger.create({
            trigger: '.hero',
            start: 'top top',
            end: 'bottom 15%',
            onUpdate: (self) => field.setScroll(self.progress),
        });
        gsap.to('.hero__base', {
            yPercent: -40, opacity: 0, ease: 'none',
            scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 30%', scrub: true },
        });

        /* Body theme follows the section in the middle of the viewport */
        const themeMeta = $('meta[name="theme-color"]');
        $$('section[data-theme]').forEach((sec) => {
            const apply = () => {
                const dark = sec.dataset.theme === 'dark';
                document.body.classList.toggle('is-dark', dark);
                themeMeta.setAttribute('content', dark ? '#131211' : '#ece8e1');
            };
            ScrollTrigger.create({ trigger: sec, start: 'top 55%', end: 'bottom 55%', onEnter: apply, onEnterBack: apply });
        });

        /* Active nav item */
        $$('.nav__links a').forEach((a) => {
            const sec = $(a.getAttribute('href'));
            ScrollTrigger.create({
                trigger: sec, start: 'top 50%', end: 'bottom 50%',
                onToggle: (self) => a.classList.toggle('is-active', self.isActive),
            });
        });

        /* Masked line reveals for big headings */
        document.fonts.ready.then(() => {
            $$('[data-split]').forEach((el) => {
                gsap.set(el, { visibility: 'visible' });
                SplitText.create(el, {
                    type: 'lines',
                    mask: 'lines',
                    linesClass: 'split-line',
                    autoSplit: true,
                    onSplit: (self) => gsap.from(self.lines, {
                        yPercent: 115,
                        rotate: 2.5,
                        transformOrigin: '0% 0%',
                        duration: 1.4,
                        stagger: 0.09,
                        ease: 'expo.out',
                        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
                    }),
                });
            });
            ScrollTrigger.refresh();
        });

        /* Statement: resolve words with scroll */
        ScrollTrigger.create({
            trigger: '[data-resolve]',
            start: 'top 82%',
            end: 'bottom 40%',
            scrub: true,
            onUpdate: (self) => resolve(self.progress),
            onRefresh: (self) => resolve(self.progress),
        });

        /* Stats: draw rules, roll digits */
        ScrollTrigger.create({
            trigger: '.stats',
            start: 'top 80%',
            once: true,
            onEnter: () => {
                gsap.fromTo('.stat', { '--line': 0 }, { '--line': 1, duration: 1.4, stagger: 0.12, ease: 'expo.inOut' });
                odos.forEach(({ cols }, si) => cols.forEach((c, ci) => {
                    gsap.fromTo(c, { y: 0 }, {
                        y: () => -(c.children.length - 1) * c.firstChild.offsetHeight,
                        duration: 2.2 + ci * 0.25,
                        delay: si * 0.12,
                        ease: 'expo.inOut',
                    });
                }));
            },
        });
        gsap.set('.stat', { '--line': 0 });

        /* Generic staggered reveals */
        const rise = (sel, opts = {}) => ScrollTrigger.batch(sel, {
            start: 'top 90%',
            once: true,
            onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: 40 }, {
                opacity: 1, y: 0, duration: 1.2, stagger: 0.08, ease: 'expo.out', ...opts,
            }),
        });
        gsap.set('.row, .job, .edu li, .kit div, .feature__desc, .tags, .links, .pipeline, .about__bio p, .contact__links li, .stat dt', { opacity: 0 });
        rise('.feature__desc, .tags, .links');
        rise('.row');
        rise('.job');
        rise('.edu li, .kit div');
        rise('.about__bio p');
        rise('.contact__links li');
        rise('.stat dt');
        rise('.pipeline', { y: 60 });

        /* Photo: clip open as it arrives */
        gsap.fromTo('.compare', { clipPath: 'inset(18% 12% 18% 12%)' }, {
            clipPath: 'inset(0% 0% 0% 0%)', ease: 'none',
            scrollTrigger: { trigger: '.compare', start: 'top 95%', end: 'top 45%', scrub: true },
        });
        gsap.fromTo('.compare img', { scale: 1.25 }, {
            scale: 1, ease: 'none',
            scrollTrigger: { trigger: '.compare', start: 'top bottom', end: 'bottom top', scrub: true },
        });

        /* Section titles drift a touch slower than the page */
        $$('.section-title, .contact__title').forEach((el) => {
            gsap.fromTo(el, { yPercent: 12 }, {
                yPercent: -12, ease: 'none',
                scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
            });
        });
    }

    const ready = () => (document.fonts && document.fonts.load
        ? Promise.all([
            document.fonts.load('800 100px Archivo'),
            document.fonts.load('extra-condensed 800 100px Archivo'),
        ]).catch(() => { })
        : Promise.resolve());

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ready().then(boot));
    } else {
        ready().then(boot);
    }
})();
