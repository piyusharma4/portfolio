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
       HERO — reverse diffusion
       x_t = √ᾱ_t · x₀ + √(1 − ᾱ_t) · ε     (cosine schedule, T = 1000)
       The name is x₀. Load runs t: 1000 → 0. Scrolling away runs it back.
       The cursor injects local noise that decays — the model re-denoises.
       =============================================================== */
    const field = (function createField() {
        const host = $('[data-field]');
        const canvas = $('canvas', host);
        const ctx = canvas.getContext('2d');
        const T = 1000;
        const readT = $('[data-t]');
        const readS = $('[data-sigma]');
        const readN = $('[data-points]');
        if (!finePointer) $('.hero__hint').textContent = 'Touch the name to add noise.';

        let W = 0, H = 0, dpr = 1, n = 0, cell = 4;
        let x0, y0, ex, ey, loc, cx = 0, cy = 0, spread = 1;
        let introT = T, scrollT = 0, t = T;
        let visible = true, dirty = true, lastW = 0, lastH = 0;
        const ptr = { x: -9999, y: -9999, px: -9999, py: -9999, active: false };
        let lastPoke = 0, nextBand = performance.now() + 4500;

        const css = getComputedStyle(root);
        const INK = css.getPropertyValue('--ink').trim() || '#131211';
        const SIGNAL = css.getPropertyValue('--signal').trim() || '#ff4f1f';

        const abar = (tt) => {
            const c = Math.cos((tt / T) * Math.PI * 0.5);
            return c * c;
        };
        const gauss = () => {
            let u = 0, v = 0;
            while (u === 0) u = Math.random();
            v = Math.random();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v);
        };

        function build() {
            const r = host.getBoundingClientRect();
            W = Math.round(r.width);
            H = Math.round(r.height);
            if (!W || !H) return;
            lastW = W; lastH = H;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = W * dpr;
            canvas.height = H * dpr;

            // Rasterise the name offscreen and sample it on a grid.
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

            let size = 100;
            setFont(size);
            const widest = Math.max(...lines.map((l) => o.measureText(l).width));
            const lineH = 0.86;
            size = Math.min(((W - pad * 2) / widest) * 100, H / (lines.length * lineH + 0.06));
            size = Math.floor(size);
            setFont(size);
            o.fillStyle = '#000';
            const capH = size * 0.72;
            const blockH = capH + (lines.length - 1) * size * lineH;
            const top = (H - blockH) / 2 + capH;
            lines.forEach((l, i) => {
                const w = o.measureText(l).width;
                const x = i === 0 ? pad : W - pad - w;
                o.fillText(l, x, top + i * size * lineH);
            });

            const data = o.getImageData(0, 0, W, H).data;
            const target = W < 700 ? 2400 : 5200;
            const sample = (step) => {
                const pts = [];
                for (let y = Math.floor(step / 2); y < H; y += step) {
                    for (let x = Math.floor(step / 2); x < W; x += step) {
                        if (data[(y * W + x) * 4 + 3] > 128) pts.push(x, y);
                    }
                }
                return pts;
            };
            cell = 3;
            let pts = sample(cell);
            while (pts.length / 2 > target && cell < 24) pts = sample(++cell);

            n = pts.length / 2;
            x0 = new Float32Array(n); y0 = new Float32Array(n);
            ex = new Float32Array(n); ey = new Float32Array(n);
            loc = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                x0[i] = pts[i * 2];
                y0[i] = pts[i * 2 + 1];
                ex[i] = gauss();
                ey[i] = gauss();
            }
            cx = W / 2; cy = H / 2;
            spread = Math.max(W, H) * 0.42;
            readN.textContent = n.toLocaleString('en-US');
            dirty = true;
            root.classList.add('field-ready');
        }

        function poke(px, py, radius, strength) {
            const r2 = radius * radius;
            for (let i = 0; i < n; i++) {
                const dx = x0[i] - px, dy = y0[i] - py;
                const d2 = dx * dx + dy * dy;
                if (d2 < r2) {
                    const f = (1 - d2 / r2) * strength;
                    if (f > loc[i]) loc[i] = f;
                }
            }
            dirty = true;
        }

        function band() {
            // An occasional horizontal band of noise — the field never quite sits still.
            const y = H * (0.15 + Math.random() * 0.7);
            const h = 6 + Math.random() * 26;
            for (let i = 0; i < n; i++) {
                if (Math.abs(y0[i] - y) < h) loc[i] = Math.max(loc[i], 0.38 + Math.random() * 0.2);
            }
            dirty = true;
        }

        let last = performance.now();
        function frame(now) {
            requestAnimationFrame(frame);
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            if (!visible || !n) return;

            t = reduced ? 0 : Math.max(introT, scrollT);

            if (!reduced && finePointer && now > nextBand && now - lastPoke > 2500 && t < 5) {
                band();
                nextBand = now + 4500 + Math.random() * 4000;
            }

            if (ptr.active) {
                const vx = ptr.x - ptr.px, vy = ptr.y - ptr.py;
                const speed = Math.min(1, Math.hypot(vx, vy) / 40);
                poke(ptr.x, ptr.y, 70 + speed * 70, 0.45 + speed * 0.5);
                ptr.px = ptr.x; ptr.py = ptr.y;
            }

            const g = abar(t);
            const sg = Math.sqrt(g);
            const ng = Math.sqrt(1 - g);
            let anyLocal = false;
            const decay = Math.pow(0.935, dt * 60);
            const rho = 0.97;
            const kick = Math.sqrt(1 - rho * rho);
            const moving = ng > 0.002;

            if (!dirty && !moving) {
                for (let i = 0; i < n; i++) if (loc[i] > 0.002) { anyLocal = true; break; }
                if (!anyLocal) return;
            }

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            const s = Math.max(1.6, cell * 0.66);
            const half = s / 2;
            const local = 90;

            ctx.fillStyle = INK;
            const hot = [];
            for (let i = 0; i < n; i++) {
                const l = loc[i];
                if (moving || l > 0.002) {
                    ex[i] = ex[i] * rho + kick * gauss();
                    ey[i] = ey[i] * rho + kick * gauss();
                }
                const amp = ng * spread + l * local;
                const x = cx + sg * (x0[i] - cx) + ex[i] * amp;
                const y = cy + sg * (y0[i] - cy) + ey[i] * amp;
                if (l > 0.18) hot.push(x, y);
                else ctx.fillRect(x - half, y - half, s, s);
                if (l > 0.002) { loc[i] = l * decay; anyLocal = true; }
                else loc[i] = 0;
            }
            ctx.fillStyle = SIGNAL;
            for (let i = 0; i < hot.length; i += 2) ctx.fillRect(hot[i] - half, hot[i + 1] - half, s, s);

            readT.textContent = String(Math.round(t)).padStart(4, '0');
            readS.textContent = ng.toFixed(3);
            dirty = anyLocal;
        }

        // Pointer — mouse or finger
        host.addEventListener('pointermove', (e) => {
            const r = canvas.getBoundingClientRect();
            ptr.x = e.clientX - r.left;
            ptr.y = e.clientY - r.top;
            if (!ptr.active) { ptr.px = ptr.x; ptr.py = ptr.y; }
            ptr.active = !reduced;
            lastPoke = performance.now();
        }, { passive: true });
        host.addEventListener('pointerleave', () => (ptr.active = false));
        host.addEventListener('pointerdown', (e) => {
            if (reduced) return;
            const r = canvas.getBoundingClientRect();
            poke(e.clientX - r.left, e.clientY - r.top, 180, 1);
            lastPoke = performance.now();
        });
        host.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') ptr.active = false; });

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
            setIntro(v) { introT = v; },
            setScroll(v) { scrollT = v; },
        };
    })();

    /* ---------------------------------------------------------------
       Statement — words resolve from noise as you read
       --------------------------------------------------------------- */
    function resolveText(el) {
        const GLYPHS = 'abcdefghijklmnopqrstuvwxyz#%&*+=/<>';
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
        el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
        wrap(el);
        words.forEach((w) => {
            w.setAttribute('aria-hidden', 'true');
            w._final = w.textContent;
            w._seed = Array.from(w._final, () => Math.random());
            w._state = -1;
        });

        const fixWidths = () => words.forEach((w) => {
            w.style.width = '';
            w.textContent = w._final;
            w.style.width = w.getBoundingClientRect().width + 'px';
            w._state = -1;
        });
        fixWidths();
        addEventListener('resize', () => { clearTimeout(fixWidths._t); fixWidths._t = setTimeout(fixWidths, 200); });

        const N = words.length;
        const K = 7;
        const render = (p) => {
            for (let i = 0; i < N; i++) {
                const w = words[i];
                const lp = clamp((p * (N + K) - i) / K, 0, 1);
                const q = Math.round(lp * 24);
                if (q === w._state && q !== 0 && q !== 24) continue;
                w._state = q;
                w.style.opacity = (0.14 + 0.86 * lp).toFixed(3);
                if (lp >= 1) { w.textContent = w._final; continue; }
                let out = '';
                for (let j = 0; j < w._final.length; j++) {
                    const ch = w._final[j];
                    out += w._seed[j] < lp || /[—,.\-]/.test(ch)
                        ? ch
                        : GLYPHS[(Math.random() * GLYPHS.length) | 0];
                }
                w.textContent = out;
            }
        };
        return render;
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
            field.setIntro(0);
            resolve(1);
            odos.forEach(({ el, cols }) => cols.forEach((c) => {
                c.style.transform = `translateY(${-(c.children.length - 1) * 0.8}em)`;
            }));
            return;
        }

        gsap.registerPlugin(ScrollTrigger, SplitText);
        root.classList.add('theme-js');

        /* Intro: denoise the name, then bring in the furniture */
        const intro = { t: 1000 };
        const tl = gsap.timeline({ delay: 0.15 });
        tl.to(intro, {
            t: 0, duration: 2.8, ease: 'power2.inOut',
            onUpdate: () => field.setIntro(intro.t),
        }, 0)
            .to('.nav', { opacity: 1, duration: 1, ease: 'power2.out' }, 0.4)
            .fromTo('[data-intro]', { opacity: 0, y: 18 }, {
                opacity: 1, y: 0, duration: 1.2, stagger: 0.12, ease: 'expo.out',
            }, 1.4);

        /* Leaving the hero re-noises the name */
        ScrollTrigger.create({
            trigger: '.hero',
            start: 'top top',
            end: 'bottom top',
            onUpdate: (self) => field.setScroll(Math.pow(self.progress, 1.4) * 1000),
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
