/* Open Problems prototype: force-layout problem map with lens switching and essay overlay.
   Vanilla JS + d3 (layout) + marked (markdown). Data comes from data.json, built from content/. */
(async function main() {
  const data = await (await fetch('data.json', { cache: 'no-store' })).json();

  const nodes = data.nodes.map((n) => ({ ...n, lenses: n.lenses || {}, restate: n.restate || {} }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = data.edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ ...e }));
  const lenses = data.lenses.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const lensById = new Map(lenses.map((l) => [l.id, l]));
  const essays = data.essays.map((e) => ({ ...e }));

  const sid = (e) => (typeof e.source === 'object' ? e.source.id : e.source);
  const tid = (e) => (typeof e.target === 'object' ? e.target.id : e.target);
  const adj = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const e of links) { adj.get(sid(e)).add(tid(e)); adj.get(tid(e)).add(sid(e)); }

  const state = { lenses: [], focus: null, essay: null, essayHover: null, hover: null, hike: false, tab: 'node' };
  let hopMap = new Map();

  const BASE_R = { problem: 26, subproblem: 15, concept: 11 };
  const NEUTRAL = { problem: 'var(--fill-problem)', subproblem: 'var(--fill-sub)', concept: 'var(--fill-concept)' };
  const OFF = 'var(--fill-off)';
  const DEFAULT_W = 0.12;
  const HOP_FACTOR = [1, 1, 0.55, 0.25];

  // ---------- scoring & weights
  function bfs(start) {
    const dist = new Map([[start, 0]]);
    const q = [start];
    while (q.length) {
      const cur = q.shift();
      for (const nb of adj.get(cur)) if (!dist.has(nb)) { dist.set(nb, dist.get(cur) + 1); q.push(nb); }
    }
    return dist;
  }
  const lensWeight = (n) => (state.lenses.length ? Math.min(...state.lenses.map((l) => n.lenses[l] ?? DEFAULT_W)) : 1);
  function weight(n) {
    let w = lensWeight(n);
    if (state.essay) {
      const onPath = state.essay.path.includes(n.id);
      w = onPath ? Math.max(w, 0.9) : Math.min(w, 0.15);
      if (state.essayHover) w = state.essayHover.includes(n.id) ? 1 : Math.min(w, 0.25);
      return w;
    }
    if (state.focus) {
      const h = hopMap.get(n.id);
      w *= h === undefined ? 0.15 : HOP_FACTOR[Math.min(h, 3)];
      if (n.id === state.focus) w = Math.max(w, 0.9);
    }
    return w;
  }
  function dominantLens(n) {
    let best = null, bw = -1;
    for (const l of state.lenses) { const w = n.lenses[l] ?? DEFAULT_W; if (w > bw) { bw = w; best = l; } }
    return bw >= 0.3 ? best : null;
  }
  function fill(n) {
    if (state.essay) return state.essay.path.includes(n.id) ? (lensById.get(state.essay.lens)?.color || 'var(--accent)') : OFF;
    if (!state.lenses.length) return NEUTRAL[n.type] || NEUTRAL.concept;
    const l = dominantLens(n);
    return l ? lensById.get(l).color : OFF;
  }
  const ucb = (n) => (n.value ?? 2) + 1.0 * (n.uncertainty ?? 2);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function wrap(text, max) {
    const words = text.split(/\s+/); const lines = []; let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    }
    if (cur) lines.push(cur);
    if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].replace(/\s*\S*$/, '') + '…'; }
    return lines;
  }

  // ---------- svg
  const mapEl = document.getElementById('map');
  const svg = d3.select('#svg');
  const root = svg.append('g');
  const linkG = root.append('g').attr('class', 'links');
  const pathG = root.append('g').attr('class', 'essay-path');
  const nodeG = root.append('g').attr('class', 'nodes');
  const zoom = d3.zoom().scaleExtent([0.35, 3]).on('zoom', (ev) => root.attr('transform', ev.transform));
  svg.call(zoom).on('dblclick.zoom', null).on('dblclick', () => fitToView());
  svg.on('click', () => { if (state.essay) closeEssay(); else setFocus(null); });

  let W = mapEl.clientWidth || 800, H = mapEl.clientHeight || 600;

  const link = linkG.selectAll('line').data(links).join('line').attr('class', (d) => `edge ${d.type}`);

  const node = nodeG.selectAll('g.node').data(nodes, (d) => d.id).join((enter) => {
    const g = enter.append('g').attr('class', (d) => `node ${d.type}`);
    g.append('circle').attr('class', 'halo');
    g.append('circle').attr('class', 'dot');
    const t = g.append('text').attr('class', 'label').attr('text-anchor', 'middle');
    t.each(function (d) {
      d3.select(this).selectAll('tspan').data(wrap(d.title, d.type === 'problem' ? 22 : 19)).join('tspan')
        .attr('x', 0).attr('dy', (l, i) => (i === 0 ? 0 : '1.15em')).text((l) => l);
    });
    const b = g.append('g').attr('class', 'badge').style('display', 'none');
    b.append('circle').attr('r', 9);
    b.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em');
    return g;
  });

  node.on('click', (ev, d) => { ev.stopPropagation(); setFocus(d.id); })
    .on('mouseenter', (ev, d) => { state.hover = d.id; paint(false); })
    .on('mouseleave', () => { state.hover = null; paint(false); })
    .call(d3.drag()
      .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance((l) => (l.type === 'decomposes-into' ? 95 : 135)).strength(0.5))
    .force('charge', d3.forceManyBody().strength(-520))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collide', d3.forceCollide().radius((d) => BASE_R[d.type] + 30).strength(0.8))
    .on('tick', tick)
    .on('end', () => { if (!fitted) { fitted = true; fitToView(); } });
  let fitted = false;

  function fitToView(dur = 700) {
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 80, maxX = Math.max(...xs) + 80, minY = Math.min(...ys) - 50, maxY = Math.max(...ys) + 70;
    const k = Math.min(1.3, 0.96 * Math.min(W / (maxX - minX), H / (maxY - minY)));
    const t = d3.zoomIdentity.translate(W / 2 - k * (minX + maxX) / 2, H / 2 - k * (minY + maxY) / 2).scale(k);
    svg.transition().duration(dur).call(zoom.transform, t);
  }

  function tick() {
    link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    drawEssayPath();
  }

  const lineGen = d3.line().x((d) => d.x).y((d) => d.y).curve(d3.curveCatmullRom.alpha(0.6));
  function drawEssayPath() {
    const pts = state.essay ? state.essay.path.map((id) => byId.get(id)).filter(Boolean) : [];
    pathG.selectAll('path').data(pts.length > 1 ? [pts] : []).join('path')
      .attr('class', 'essay-line').attr('d', lineGen)
      .style('stroke', state.essay ? (lensById.get(state.essay.lens)?.color || 'var(--accent)') : null);
  }

  function paint(animated = true) {
    const dur = animated ? 650 : 120;
    const wOf = new Map(nodes.map((n) => [n.id, weight(n)]));
    node.each(function (d) {
      const w = wOf.get(d.id);
      const r = BASE_R[d.type] * (0.6 + 0.4 * w);
      const g = d3.select(this);
      const hovered = state.hover === d.id, focused = state.focus === d.id;
      g.select('circle.dot').transition().duration(dur).ease(d3.easeCubicOut).attr('r', r).style('fill', fill(d));
      g.select('circle.halo').transition().duration(dur).attr('r', r + 7).style('opacity', focused ? 1 : 0);
      g.transition().duration(dur).style('opacity', 0.18 + 0.82 * w);
      g.select('text.label').transition().duration(dur).attr('y', r + 15).style('opacity', w >= 0.45 || hovered || focused ? 1 : 0);
      const idx = state.essay ? state.essay.path.indexOf(d.id) : -1;
      const badge = g.select('g.badge').style('display', idx >= 0 ? null : 'none').attr('transform', `translate(${-r * 0.75},${-r * 0.75})`);
      badge.select('text').text(idx >= 0 ? idx + 1 : '');
      badge.select('circle').style('fill', idx >= 0 ? fill(d) : null);
    });
    link.transition().duration(dur).style('opacity', (d) => 0.85 * Math.min(wOf.get(sid(d)), wOf.get(tid(d))));
    drawEssayPath();
  }

  // ---------- state changes
  function setLenses(next) {
    state.lenses = next;
    mapEl.classList.add('switching');
    setTimeout(() => mapEl.classList.remove('switching'), 320);
    renderLensBar(); paint(true); renderPanel();
  }
  function toggleLens(id, combine) {
    if (id === null) return setLenses([]);
    if (combine) {
      const s = state.lenses.includes(id) ? state.lenses.filter((l) => l !== id) : [...state.lenses, id].slice(-2);
      return setLenses(s);
    }
    setLenses(state.lenses.length === 1 && state.lenses[0] === id ? [] : [id]);
  }
  function setFocus(id) {
    state.focus = id;
    hopMap = id ? bfs(id) : new Map();
    history.replaceState(null, '', id ? `#node/${id}` : location.pathname);
    if (id) setTab('node'); else renderPanel();
    paint(true);
  }
  function openEssay(id) {
    state.essay = essays.find((e) => e.id === id) || null;
    state.essayHover = null;
    if (state.essay) history.replaceState(null, '', `#essay/${id}`);
    setTab('essays'); paint(true);
  }
  function closeEssay() {
    state.essay = null; state.essayHover = null;
    history.replaceState(null, '', state.focus ? `#node/${state.focus}` : location.pathname);
    paint(true); renderPanel();
  }
  function setTab(t) {
    state.tab = t;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('hidden', x.id !== 'tab-' + t));
    renderPanel();
  }

  // ---------- panel
  function renderLensBar() {
    const el = document.getElementById('lenses');
    el.innerHTML = `<button class="lens all ${state.lenses.length ? '' : 'on'}" data-lens="">All</button>` +
      lenses.map((l) => `<button class="lens ${state.lenses.includes(l.id) ? 'on' : ''}" data-lens="${l.id}" style="--c:${l.color}" title="${esc(l.question)}"><span class="dot"></span>${esc(l.name)}</button>`).join('');
  }
  document.getElementById('lenses').addEventListener('click', (ev) => {
    const b = ev.target.closest('button.lens'); if (!b) return;
    toggleLens(b.dataset.lens || null, ev.shiftKey);
  });

  function renderPanel() {
    if (state.tab === 'node') renderNodeTab();
    else if (state.tab === 'wander') renderWanderTab();
    else renderEssaysTab();
  }

  function bodyHtml(n) {
    const tmp = document.createElement('div');
    tmp.innerHTML = marked.parse(n.body || '');
    if (!state.hike) return tmp.innerHTML;
    // Hike mode: fold the "answer" sections so you can work the node before reading what is known.
    const HIDE = /progress|scor|baseline|gamed|known|per platt|predict|argument|borrowed/i;
    const out = document.createElement('div');
    let section = null;
    for (const child of [...tmp.childNodes]) {
      if (child.nodeName === 'H2') {
        section = document.createElement('div');
        if (HIDE.test(child.textContent)) {
          section.className = 'hidden-section';
          section.appendChild(child);
          const btn = document.createElement('button'); btn.className = 'reveal'; btn.textContent = 'Reveal';
          section.appendChild(btn);
        } else section.appendChild(child);
        out.appendChild(section);
      } else if (section) section.appendChild(child);
      else out.appendChild(child);
    }
    return out.innerHTML;
  }

  function renderNodeTab() {
    const el = document.getElementById('tab-node');
    const n = state.focus ? byId.get(state.focus) : null;
    if (!n) {
      const l = state.lenses.length === 1 ? lensById.get(state.lenses[0]) : null;
      el.innerHTML = `<div class="empty">
        <h2>${l ? esc(l.name) + ' lens' : 'A neighborhood'}</h2>
        ${l ? `<p class="q">${esc(l.question)}</p><div>${marked.parse(l.body || '')}</div>` :
          state.lenses.length === 2 ? `<p class="q">Two lenses combined. Only nodes both lenses see stay in focus. Those are the cross-disciplinary essay topics.</p>` :
          `<p>Click a node to read it. Switch a lens to restate every node from that discipline. Open an essay to see the path it walks.</p>
           <p>Bigger circles matter more under the current lens. Two hops from the focused node stay lit; the rest fade.</p>`}
      </div>`;
      return;
    }
    const lensForText = state.lenses.find((l) => n.restate[l]) || null;
    const restate = lensForText ? n.restate[lensForText] : n.statement;
    const lensName = lensForText ? lensById.get(lensForText).name + ' lens' : 'Plain statement';
    const outE = links.filter((e) => sid(e) === n.id), inE = links.filter((e) => tid(e) === n.id);
    const through = essays.filter((e) => e.path.includes(n.id));
    el.innerHTML = `
      <div class="kicker">${esc(n.type)} · <span style="color:${lensForText ? lensById.get(lensForText).color : 'inherit'}">${esc(lensName)}</span></div>
      <h2>${esc(n.title)}</h2>
      <p class="restate">${esc(restate)}</p>
      <div class="scores">
        <div><span class="k">Value if solved</span><span class="v">${n.value ?? '–'}<small>/5</small></span></div>
        <div><span class="k">Uncertainty</span><span class="v">${n.uncertainty ?? '–'}<small>/5</small></span></div>
        <div><span class="k">Worth wandering</span><span class="v">${ucb(n).toFixed(0)}</span></div>
      </div>
      <div class="lensweights">${lenses.map((l) => { const w = n.lenses[l.id] ?? DEFAULT_W; return `<span class="lw" style="--c:${l.color};--w:${w}" title="${esc(l.name)}: ${w}">${esc(l.name)}</span>`; }).join('')}</div>
      <div class="body">${bodyHtml(n)}</div>
      <h3>Edges</h3>
      <ul class="edges">
        ${outE.map((e) => `<li><span class="etype">${e.type} →</span> <a href="#node/${tid(e)}">${esc(byId.get(tid(e)).title)}</a></li>`).join('')}
        ${inE.map((e) => `<li><span class="etype">← ${e.type}</span> <a href="#node/${sid(e)}">${esc(byId.get(sid(e)).title)}</a></li>`).join('')}
      </ul>
      ${through.length ? `<h3>Essays through here</h3><ul class="edges">${through.map((e) => `<li><a href="#essay/${e.id}">${esc(e.title)}</a></li>`).join('')}</ul>` : ''}
      ${n.source ? `<p class="source">Source: ${esc(n.source)}</p>` : ''}
    `;
  }

  function renderWanderTab() {
    const el = document.getElementById('tab-wander');
    const rows = nodes.map((n) => ({ n, s: ucb(n) * (state.lenses.length ? 0.35 + 0.65 * lensWeight(n) : 1) }))
      .sort((a, b) => b.s - a.s).slice(0, 8);
    el.innerHTML = `<p class="empty">Ranked by value plus uncertainty, an optimistic bound rather than a best score. High value and unexplored beats high value and crowded.${state.lenses.length ? ' Weighted by the active lens.' : ''}</p>` +
      rows.map((r) => `<a class="row" href="#node/${r.n.id}"><span class="rank">${r.s.toFixed(1)}</span><span><b>${esc(r.n.title)}</b><small>${esc(r.n.type)} · value ${r.n.value ?? '–'}/5 · uncertainty ${r.n.uncertainty ?? '–'}/5</small></span></a>`).join('');
  }

  function renderEssaysTab() {
    const el = document.getElementById('tab-essays');
    if (!state.essay) {
      el.innerHTML = `<p class="empty">An essay is markdown with links to nodes. Opening one superimposes its path on the map. Hover a paragraph to light up the nodes it touches.</p>` +
        essays.map((e) => `<a class="row" href="#essay/${e.id}"><span class="rank" style="color:${lensById.get(e.lens)?.color || 'var(--accent)'}">${e.path.length}</span><span><b>${esc(e.title)}</b><small>${esc(e.summary)}</small></span></a>`).join('');
      return;
    }
    const e = state.essay;
    const l = lensById.get(e.lens);
    el.innerHTML = `
      <div class="essay-head"><div class="kicker">essay${l ? ` · <span style="color:${l.color}">${esc(l.name)} lens</span>` : ''}</div><button class="linkbtn" id="closeEssay">Close overlay</button></div>
      <h2>${esc(e.title)}</h2>
      <div class="essay-meta">${esc(e.author)}${e.date ? ' · ' + esc(e.date) : ''} · walks ${e.path.length} nodes</div>
      <div class="essay-body">${marked.parse(e.body)}</div>`;
    el.querySelector('#closeEssay').onclick = closeEssay;
    el.querySelectorAll('.essay-body p, .essay-body li').forEach((p) => {
      const refs = [...p.querySelectorAll('a[href^="#node/"]')].map((a) => a.getAttribute('href').slice(6));
      if (!refs.length) return;
      p.classList.add('has-refs');
      p.addEventListener('mouseenter', () => { state.essayHover = refs; paint(false); });
      p.addEventListener('mouseleave', () => { state.essayHover = null; paint(false); });
    });
  }

  document.getElementById('panel').addEventListener('click', (ev) => {
    const a = ev.target.closest('a[href^="#node/"], a[href^="#essay/"]');
    if (a) {
      ev.preventDefault();
      const [kind, id] = a.getAttribute('href').slice(1).split('/');
      if (kind === 'node') { state.focus = id; hopMap = bfs(id); history.replaceState(null, '', `#node/${id}`); setTab('node'); paint(true); }
      else openEssay(id);
      return;
    }
    const btn = ev.target.closest('button.reveal');
    if (btn) { btn.parentElement.classList.remove('hidden-section'); btn.remove(); }
  });
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.getElementById('hike').addEventListener('change', (ev) => { state.hike = ev.target.checked; renderPanel(); });

  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches('input, textarea')) return;
    if (ev.key === 'Escape') { if (state.essay) closeEssay(); else setFocus(null); }
    else if (ev.key === '0') toggleLens(null);
    else if (/^[1-9]$/.test(ev.key)) { const l = lenses[Number(ev.key) - 1]; if (l) toggleLens(l.id, ev.shiftKey); }
  });

  // ---------- legend
  document.getElementById('legend').innerHTML = [
    ['<line x1="0" y1="6" x2="28" y2="6" class="edge"/>', 'decomposes into'],
    ['<line x1="0" y1="6" x2="28" y2="6" class="edge requires"/>', 'requires'],
    ['<line x1="0" y1="6" x2="28" y2="6" class="edge instance-of"/>', 'instance of a concept'],
    ['<circle cx="14" cy="6" r="6" style="fill:var(--fill-problem)"/>', 'problem'],
    ['<circle cx="14" cy="6" r="4" style="fill:var(--fill-sub)"/>', 'sub-problem'],
    ['<circle cx="14" cy="6" r="3" style="fill:var(--fill-concept)"/>', 'concept'],
  ].map(([s, t]) => `<svg viewBox="0 0 28 12">${s}</svg><span>${t}</span>`).join('');

  let resizeTimer = null;
  new ResizeObserver(() => {
    W = mapEl.clientWidth; H = mapEl.clientHeight;
    sim.force('center', d3.forceCenter(W / 2, H / 2));
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (fitted) fitToView(400); }, 250);
  }).observe(mapEl);

  // ---------- init
  renderLensBar();
  const hash = location.hash.slice(1);
  if (hash.startsWith('node/') && byId.has(hash.slice(5))) setFocus(hash.slice(5));
  else if (hash.startsWith('essay/')) openEssay(hash.slice(6));
  else renderPanel();
  paint(false);
})();
