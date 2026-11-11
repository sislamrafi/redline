// Redline — redlinez.org
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ── clipboard helper ── */
  async function copy(text, btn, label = btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch {}
      t.remove();
    }
    const old = label.textContent;
    label.textContent = 'Copied ✓';
    btn.classList.add('copied');
    setTimeout(() => { label.textContent = old; btn.classList.remove('copied'); }, 1800);
  }

  /* ── mobile menu ── */
  const toggle = $('.menu-toggle');
  const menu = $('#site-menu');
  if (toggle && menu) {
    const set = (open) => { menu.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); };
    toggle.addEventListener('click', () => set(menu.hidden));
    $$('a', menu).forEach((a) => a.addEventListener('click', () => set(false)));
    addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  }

  /* ── hero: copy a setup prompt for the user's agent ── */
  const SETUP_PROMPT = `Set up Redline (https://github.com/sislamrafi/redline) for me:
1. Clone it and run \`npm install\` inside redline/desktop-app.
2. Add its MCP server to this agent: command \`node\`, args ["<absolute path>/redline/desktop-app/mcp/server.js"].
3. Start the desktop app with \`npm run app\` from redline/desktop-app.
Then tell me the hotkey to mark up my screen (Alt+Shift+M / ⌥⇧M). When I say "apply my latest redline",
call get_edit_request, fix each mark in this codebase, and set each one to "review" with update_edit_request_status.`;
  const copyBtn = $('#copyPrompt');
  if (copyBtn) copyBtn.addEventListener('click', () => copy(SETUP_PROMPT, copyBtn, $('.label', copyBtn)));

  /* ── hero scene: mark → mascot fixes → done, looped ── */
  const art = $('.hero-art');
  if (art) {
    const mascot = $('.mascot', art);
    const STAGES = reduced ? [] : [
      [600, 's1'], [1700, 's2'], [3000, 's3'], [4300, 's4'], [5900, 's5'], [7600, 's6'],
    ];
    const FIX_AT = [4300 - 200, 5900 + 1000];
    let timers = [];
    const clear = () => { timers.forEach(clearTimeout); timers = []; };
    const run = () => {
      clear();
      art.classList.remove('s1', 's2', 's3', 's4', 's5', 's6');
      mascot.classList.remove('fixing');
      STAGES.forEach(([t, c]) => timers.push(setTimeout(() => art.classList.add(c), t)));
      FIX_AT.forEach((t) => {
        timers.push(setTimeout(() => {
          mascot.classList.remove('fixing'); void mascot.offsetWidth; mascot.classList.add('fixing');
        }, t));
        timers.push(setTimeout(() => mascot.classList.remove('fixing'), t + 1800));
      });
      timers.push(setTimeout(run, 11500));
    };
    if (reduced) {
      art.classList.add('s1', 's2', 's4', 's5', 's6');
    } else {
      // only animate while visible
      new IntersectionObserver(([e]) => { if (!e.isIntersecting) clear(); else if (!timers.length) run(); }, { threshold: .2 }).observe(art);
      document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); else if (!timers.length) run(); });
    }
  }

  /* ── demo: scripted motion of the whole Redline loop ── */
  const wrap = $('.stage-wrap');
  const stage = $('.stage', wrap || document);
  if (wrap && stage) {
    const W = 1000;
    const fit = () => stage.style.setProperty('--s', String(wrap.clientWidth / W));
    fit();
    new ResizeObserver(fit).observe(wrap);

    const q = (sel) => $(sel, stage);
    const ptr = q('.cursor-ptr'), ring = q('.click-ring'), key = q('.keycap');
    const box = q('.rl-box'), pin = q('.rl-pin'), pop = q('.rl-pop'), popText = q('.pop-text');
    const chip1 = q('.chip1'), chip2 = q('.chip2'), count = q('.rl-count');
    const term = q('.term'), m1 = q('.req-mark.m1'), m2 = q('.req-mark.m2');
    const steps = $$('.demo-steps li');

    // position of an element inside the unscaled 1000×620 stage
    const pos = (el) => {
      const s = stage.getBoundingClientRect(), r = el.getBoundingClientRect(), k = s.width / W;
      return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k };
    };
    // place an absolutely-positioned element at stage coordinates, whatever its containing block
    const place = (el, x, y) => {
      const o = el.offsetParent && el.offsetParent !== stage ? pos(el.offsetParent) : { x: 0, y: 0 };
      el.style.left = (x - o.x) + 'px'; el.style.top = (y - o.y) + 'px';
    };
    const moveTo = (x, y) => { ptr.style.transform = `translate(${x - 2}px, ${y - 2}px)`; };
    const click = (x, y) => { place(ring, x, y); ring.classList.toggle('go', false); void ring.offsetWidth; ring.classList.add('go'); };
    const setStep = (n) => steps.forEach((li) => li.classList.toggle('on', +li.dataset.step === n));
    const status = (el, cls, label) => {
      ['prog', 'review', 'done'].forEach((c) => el.classList.toggle(c, c === cls));
      $('.st', el).textContent = label;
    };
    const counts = (todo, review, done) => { q('.n-todo').textContent = todo; q('.n-review').textContent = review; q('.n-done').textContent = done; };
    const showKey = (txt) => { key.textContent = txt; key.classList.add('show'); };
    const line = (html) => {
      const p = document.createElement('p'); p.innerHTML = html; term.appendChild(p);
      while (term.children.length > 9) term.firstChild.replaceWith();
    };

    let timers = [];
    const at = (t, fn) => timers.push(setTimeout(fn, t));
    const typeInto = (t0, el, text, speed = 38) => {
      for (let i = 1; i <= text.length; i++) at(t0 + i * speed, () => { el.textContent = text.slice(0, i); });
      return t0 + text.length * speed;
    };
    const press = (el) => { el.classList.add('press'); setTimeout(() => el.classList.toggle('press', false), 250); };

    const reset = () => {
      stage.className = 'stage';
      [box, pin, pop, chip1, chip2].forEach((e) => e.classList.toggle('on', false));
      box.classList.toggle('badged', false);
      box.style.width = box.style.height = '0px';
      popText.textContent = ''; count.textContent = '0'; term.innerHTML = '';
      status(m1, '', 'open'); status(m2, '', 'open'); counts(0, 0, 0);
      key.classList.toggle('show', false); setStep(0);
      moveTo(560, 580);
    };

    const play = () => {
      timers.forEach(clearTimeout); timers = [];
      reset();
      line('<span class="dim">~/acme $</span> claude');
      const pay = q('.pay'), price = q('.total-price');

      // 1 · capture
      at(500, () => { setStep(1); showKey('⌥ ⇧ M'); });
      at(1300, () => { key.classList.toggle('show', false); stage.classList.add('freeze'); });

      // 2 · box around the small Pay button
      let b;
      at(1900, () => { setStep(2); b = pos(pay); moveTo(b.x - 12, b.y - 10); });
      at(2800, () => {
        place(box, b.x - 12, b.y - 10); box.classList.add('on');
        box.style.width = (b.w + 24) + 'px'; box.style.height = (b.h + 20) + 'px';
        moveTo(b.x + b.w + 12, b.y + b.h + 10);
      });
      at(3550, () => {
        box.classList.add('badged'); count.textContent = '1';
        $('.rl-badge', pop).textContent = '1'; $('.pop-kind', pop).textContent = 'red box';
        popText.textContent = ''; place(pop, b.x + b.w + 30, b.y - 6); pop.classList.add('on');
      });
      let t = typeInto(3800, popText, 'make the button full width');
      at(t + 450, () => { pop.classList.toggle('on', false); place(chip1, b.x - 12, b.y - 40); chip1.classList.add('on'); });

      // pin on the total price
      let p;
      at(t + 700, () => { p = pos(price); moveTo(p.x + p.w + 14, p.y + p.h / 2); });
      at(t + 1550, () => {
        click(p.x + p.w + 14, p.y + p.h / 2);
        place(pin, p.x + p.w + 14, p.y + p.h / 2); pin.classList.add('on'); count.textContent = '2';
        $('.rl-badge', pop).textContent = '2'; $('.pop-kind', pop).textContent = 'red pin';
        popText.textContent = ''; place(pop, p.x - 150, p.y + p.h + 16); pop.classList.add('on');
      });
      t = typeInto(t + 1800, popText, 'total should be bold');
      at(t + 450, () => { pop.classList.toggle('on', false); place(chip2, p.x - 110, p.y - 34); chip2.classList.add('on'); });

      // 3 · save → history
      const save = q('.t-save');
      at(t + 800, () => { setStep(3); const s = pos(save); moveTo(s.x + s.w / 2, s.y + s.h / 2); });
      at(t + 1650, () => { const s = pos(save); click(s.x + s.w / 2, s.y + s.h / 2); press(save); showKey('⌘ ↵'); });
      at(t + 2000, () => { stage.classList.toggle('freeze', false); stage.classList.add('saved'); counts(1, 0, 0); });
      at(t + 2500, () => { key.classList.toggle('show', false); moveTo(560, 590); });

      // 4 · the agent works and leaves a note on each mark
      at(t + 2900, () => { setStep(4); line('<span class="prompt"></span>'); });
      const cmd = 'apply my latest redline';
      for (let i = 1; i <= cmd.length; i++) at(t + 3000 + i * 40, () => { term.lastChild.querySelector('.prompt').textContent = cmd.slice(0, i); });
      t = t + 3000 + cmd.length * 40;
      at(t + 500, () => { line('<span class="tool">● redline</span> get_edit_request <span class="dim">→ 2 marks</span>'); status(m1, 'prog', 'in progress'); status(m2, 'prog', 'in progress'); });
      at(t + 1200, () => line('<span class="tool">● Read</span> src/Checkout.tsx'));
      at(t + 1900, () => { line('<span class="tool">● Edit</span> src/Checkout.tsx <span class="ok">+3</span> <span class="dim">−2</span>'); stage.classList.add('fixed'); });
      at(t + 2900, () => { line('<span class="tool">● redline</span> update_status <span class="dim">#1 #2 →</span> review'); status(m1, 'review', 'review'); status(m2, 'review', 'review'); counts(0, 1, 0); stage.classList.add('reviewing'); });
      at(t + 3400, () => line('<span class="ok">✓</span> Both marks fixed. Notes left in Redline.'));

      // 5 · you confirm
      const ok = q('.req-actions .ok');
      at(t + 4000, () => { setStep(5); const o = pos(ok); moveTo(o.x + o.w / 2, o.y + o.h / 2); });
      at(t + 4900, () => { const o = pos(ok); click(o.x + o.w / 2, o.y + o.h / 2); press(ok); });
      at(t + 5200, () => { status(m1, 'done', 'done'); status(m2, 'done', 'done'); counts(0, 0, 1); stage.classList.add('confirmed'); });
      at(t + 5600, () => moveTo(560, 590));
      at(t + 9000, play);
    };

    const showFinal = () => {
      reset(); stage.classList.add('saved', 'fixed', 'confirmed');
      status(m1, 'done', 'done'); status(m2, 'done', 'done'); counts(0, 0, 1);
      line('<span class="prompt">apply my latest redline</span>');
      line('<span class="ok">✓</span> Both marks fixed. Notes left in Redline.');
      steps.forEach((li) => li.classList.add('on'));
    };

    if (reduced) showFinal();
    else {
      new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) { timers.forEach(clearTimeout); timers = []; }
        else if (!timers.length) play();
      }, { threshold: .3 }).observe(wrap);
    }
  }

  /* ── agent config tabs ── */
  $$('[data-tabs]').forEach((box) => {
    const tabs = $$('[role="tab"]', box);
    const panels = $$('[data-panel]', box);
    const select = (tab) => {
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      panels.forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        const n = tabs[(i + d + tabs.length) % tabs.length];
        n.focus(); select(n);
      });
    });
    const btn = $('.copy-code', box);
    btn?.addEventListener('click', () => {
      const code = $('[data-panel]:not([hidden]) code', box).cloneNode(true);
      $$('.c', code).forEach((c) => c.remove());
      copy(code.textContent.trim(), btn);
    });
  });

  /* ── pixel dither band into the dark section ── */
  const canvas = $('.dither');
  if (canvas) {
    const draw = () => {
      const cell = innerWidth < 640 ? 6 : 8;
      const w = Math.ceil(canvas.clientWidth / cell);
      const h = Math.ceil(canvas.clientHeight / cell);
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--dark').trim() || '#171815';
      // deterministic noise so it doesn't flicker on resize
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let x = 0; x < w; x++) {
        const wave = .5 + .28 * Math.sin(x / w * Math.PI * 2.2 + .6) + .12 * Math.sin(x / w * Math.PI * 7.3);
        for (let y = 0; y < h; y++) {
          const t = y / h;
          const p = Math.min(1, Math.max(0, (t - (1 - wave) * .9) * 2.4));
          if (rnd() < p * p) ctx.fillRect(x, y, 1, 1);
        }
      }
    };
    draw();
    let raf;
    addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
  }
})();

// Highlight the visitor's OS in the download section and point the Mac button at the right chip.
(() => {
  const ua = navigator.userAgent, plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  const os = /Win/i.test(plat + ua) ? 'win' : /Mac/i.test(plat + ua) ? 'mac' : /Linux|X11/i.test(plat + ua) && !/Android/i.test(ua) ? 'linux' : null;
  const card = os && document.querySelector(`.platform[data-os="${os}"]`);
  if (card) card.classList.add('recommended');
  if (os !== 'mac' || !navigator.userAgentData || !navigator.userAgentData.getHighEntropyValues) return;
  navigator.userAgentData.getHighEntropyValues(['architecture']).then(({ architecture }) => {
    const btn = document.querySelector('.platform[data-os="mac"] .btn[data-dl-intel]');
    if (btn && architecture === 'x86') btn.href = btn.dataset.dlIntel;
  }).catch(() => {});
})();
