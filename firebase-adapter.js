/* Panel de la comisión CAPSTONE · versión web
   Acceso con Google, datos en Firestore y servicios del navegador (dictado, descargas).
   Este archivo no contiene datos de estudiantes: todo se lee de Firestore después de iniciar sesión. */
(function () {
  'use strict';
  const CFG = window.PANEL_CONFIG || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gate = $('#gate'), gateBody = $('#gateBody'), modal = $('#modal');
  const SEATS = [['doc', 'Docente de la asignatura'], ['c1', 'Comisión 1'], ['c2', 'Comisión 2'], ['c3', 'Comisión 3'], ['c4', 'Comisión 4']];
  let auth = null, db = null, me = null, started = false;

  /* ---------- pantalla de entrada ---------- */
  function gateShow(html) { gate.hidden = false; gateBody.innerHTML = html; }
  const gateBusy = t => gateShow(`<p class="gate-busy">${esc(t)}</p>`);
  function gateError(e, retry) {
    const off = e && (e.code === 'unavailable' || e.code === 'auth/network-request-failed');
    gateShow(`<p><b>${off ? 'No hay conexión con el servidor.' : 'No se pudo abrir el panel.'}</b></p><p class="hint">${esc(off ? 'Revisa tu conexión a internet y vuelve a intentarlo.' : ((e && (e.message || e.code)) || 'Error desconocido'))}</p><div class="row"><button class="btn primary" id="gRetry">Reintentar</button>${me ? '<button class="btn" id="gOut">Usar otra cuenta</button>' : ''}</div>`);
    $('#gRetry').onclick = retry || (() => location.reload());
    if ($('#gOut')) $('#gOut').onclick = signOut;
  }
  function gateSignIn(msg) {
    gateShow(`<p>Entra con tu cuenta de Google institucional para evaluar.</p>${msg ? `<div class="banner">${esc(msg)}</div>` : ''}<div class="row"><button class="btn primary" id="gIn">Entrar con Google</button></div><p class="hint">Solo pueden entrar la docente de la asignatura y los integrantes de la comisión que ella haya agregado.</p>`);
    $('#gIn').onclick = () => {
      const p = new firebase.auth.GoogleAuthProvider();
      const params = { prompt: 'select_account' };
      if (CFG.dominio) params.hd = CFG.dominio;
      p.setCustomParameters(params);
      $('#gIn').disabled = true;
      auth.signInWithPopup(p).catch(e => {
        const c = e && e.code;
        if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return gateSignIn();
        if (c === 'auth/popup-blocked') return gateSignIn('El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para este sitio y vuelve a intentarlo.');
        if (c === 'auth/unauthorized-domain') return gateSignIn('Este dominio no está autorizado en Firebase. En la consola de Firebase, en Authentication > Configuración > Dominios autorizados, agrega ' + location.hostname + '.');
        gateSignIn('No se pudo iniciar sesión (' + (c || 'error') + ').');
      });
    };
  }
  function signOut() { return auth.signOut().then(() => location.reload()); }

  /* ---------- carga y respaldo de datos (solo docente) ---------- */
  async function importSeed(file, onStep) {
    let j;
    try { j = JSON.parse(await file.text()); } catch (e) { throw new Error('El archivo no es un JSON válido.'); }
    if (!j || j.format !== 'capstone-panel-datos') throw new Error('Este archivo no es un archivo de datos del panel.');
    const ops = [];
    const c = j.config || {};
    if (c.rubrics) ops.push(['Rúbricas', () => db.doc('config/rubrics').set(c.rubrics)]);
    if (c.tpl_f2) ops.push(['Plantilla de planilla', () => db.doc('config/tpl_f2').set(c.tpl_f2)]);
    if (c.seats) ops.push(['Evaluadores', async () => { const d = await db.doc('config/seats').get(); if (!d.exists) await db.doc('config/seats').set(c.seats); }]);
    for (const [id, d] of Object.entries(j.teams || {})) ops.push(['Equipo ' + id, () => db.doc('teams/' + id).set(d, { merge: true })]);
    for (const [id, d] of Object.entries(j.dossiers || {})) ops.push(['Expediente ' + id, () => db.doc('dossiers/' + id).set(d)]);
    for (const col of ['evals', 'notes', 'saved']) for (const [id, d] of Object.entries(j[col] || {})) ops.push([col + ' ' + id, () => db.doc(col + '/' + id).set(d)]);
    let i = 0;
    for (const [label, run] of ops) { onStep && onStep(++i, ops.length, label); await run(); }
    return ops.length;
  }
  async function exportBackup() {
    const out = { format: 'capstone-panel-datos', tipo: 'respaldo', generado: new Date().toISOString() };
    for (const col of ['teams', 'evals', 'notes', 'saved', 'access']) {
      const sn = await db.collection(col).get(); out[col] = {}; sn.docs.forEach(d => { out[col][d.id] = d.data(); });
    }
    const s = await db.doc('config/seats').get(); out.config = { seats: s.exists ? s.data() : null };
    const day = new Date().toISOString().slice(0, 10);
    await downloads.save({ filename: `respaldo-panel-capstone-${day}.json`, data: JSON.stringify(out, null, 1) });
  }
  function gateSetup() {
    gateShow(`<p><b>El panel todavía no tiene datos.</b></p><p>Elige el archivo de datos del panel (<code>datos-panel-capstone.json</code>) para cargar los equipos, los expedientes y las rúbricas. Se guardan en tu proyecto de Firebase, no en el sitio público.</p><div class="row"><input type="file" id="gSeed" accept=".json,application/json"></div><p class="hint" id="gProg"></p><div class="row"><button class="btn" id="gOut">Usar otra cuenta</button></div>`);
    $('#gOut').onclick = signOut;
    $('#gSeed').onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return;
      ev.target.disabled = true;
      try { await importSeed(f, (i, n, l) => { $('#gProg').textContent = `Cargando ${i} de ${n}: ${l}`; }); enter(me); }
      catch (e) { $('#gProg').textContent = 'No se pudo cargar: ' + (e.message || e.code); ev.target.disabled = false; }
    };
  }

  /* ---------- entrada: quién es y qué puede hacer ---------- */
  async function enter(user) {
    me = user;
    const email = String(user.email || '').toLowerCase();
    gateBusy('Comprobando tu acceso…');
    let owner = false, seat = null;
    try { await db.doc('private/owner').get(); owner = true; }
    catch (e) { if (e.code !== 'permission-denied') return gateError(e, () => enter(user)); }
    if (!owner) {
      try { const d = await db.doc('access/' + email).get(); if (d.exists) seat = d.data().seat || null; }
      catch (e) { if (e.code !== 'permission-denied') return gateError(e, () => enter(user)); }
    }
    if (!owner && !seat) {
      gateShow(`<p><b>La cuenta ${esc(email)} no tiene acceso a este panel.</b></p><p class="hint">Pídele a la docente de la asignatura que agregue este correo a la comisión. Si eres la docente, revisa que tu correo esté escrito en las reglas de Firestore.</p><div class="row"><button class="btn primary" id="gOut">Usar otra cuenta</button></div>`);
      $('#gOut').onclick = signOut; return;
    }
    let rub, tpl;
    try { [rub, tpl] = await Promise.all([db.doc('config/rubrics').get(), db.doc('config/tpl_f2').get()]); }
    catch (e) { return gateError(e, () => enter(user)); }
    if (!rub.exists) {
      if (owner) return gateSetup();
      gateShow(`<p><b>El panel todavía no tiene datos cargados.</b></p><p class="hint">Vuelve a entrar cuando la docente de la asignatura los haya cargado.</p><div class="row"><button class="btn" id="gOut">Salir</button></div>`);
      $('#gOut').onclick = signOut; return;
    }
    let RUB, LVIDX;
    try { RUB = JSON.parse(rub.data().json); LVIDX = JSON.parse(rub.data().lvidx); }
    catch (e) { return gateError({ message: 'Las rúbricas guardadas no se pueden leer. Vuelve a cargar el archivo de datos.' }); }
    let apiKey = '', scope = 'asks';
    if (owner) { try { const c = await db.doc('private/claude').get(); if (c.exists && c.data().key) { apiKey = String(c.data().key); scope = c.data().scope === 'all' ? 'all' : 'asks'; } } catch (e) { /* sin clave: copiar y pegar */ } }
    /* motor: 'manual' = todo por copiar y pegar; 'mixed' = la clave responde solo las consultas de la comisión; 'api' = la clave responde todo */
    const engine = owner ? (apiKey ? (scope === 'all' ? 'api' : 'mixed') : 'manual') : 'none';
    window.PANEL = { mode: 'web', owner, seat: owner ? 'doc' : seat, email, name: user.displayName || email, engine, askEngine: apiKey ? 'api' : 'manual', tab: Math.random().toString(36).slice(2, 10) };
    window.PANEL_DATA = { RUB, LVIDX, TPL_F2: tpl.exists ? tpl.data().b64 : '' };
    const services = { db, user: userSvc(user, owner), sample: owner ? pickSample(apiKey, scope) : null, dictation: makeDictation(), downloads };
    window.claude = { use: n => Promise.resolve(services[n] || null) };
    if (started) return; started = true;
    const s = document.createElement('script'); s.src = 'app.js';
    s.onload = () => { gate.hidden = true; $('#app').hidden = false; document.body.classList.add('web', owner ? 'is-owner' : 'is-member', 'eng-' + window.PANEL.engine); topButton(); };
    s.onerror = () => gateError({ message: 'No se pudo cargar app.js.' });
    document.body.appendChild(s);
  }
  const userSvc = (u, owner) => ({ can: async () => true, isOwner: async () => owner, canEdit: async () => owner, id: async () => u.uid, me: async () => ({ id: u.uid, name: u.displayName || '' }) });

  /* ---------- ventana modal ---------- */
  let onClose = null;
  function openModal(html, closer) { if (onClose) { const f = onClose; onClose = null; f(); } modal.innerHTML = `<div class="modal-card card pad stack" role="dialog" aria-modal="true">${html}</div>`; modal.hidden = false; onClose = closer || null; }
  function closeModal(silent) { modal.hidden = true; modal.innerHTML = ''; const f = onClose; onClose = null; if (f && !silent) f(); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  modal.addEventListener('mousedown', e => { if (e.target === modal && !modal.querySelector('#manualAnswer')) closeModal(); });

  /* ---------- administración (docente) y cuenta ---------- */
  function topButton() {
    const b = document.createElement('button'); b.className = 'btn sm'; b.id = 'webAcct';
    b.textContent = window.PANEL.owner ? 'Comisión y datos' : String(window.PANEL.name).split(' ')[0];
    b.title = window.PANEL.email;
    b.onclick = () => window.PANEL.owner ? adminModal() : accountModal();
    $('.top-in').appendChild(b);
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-web]'); if (b && b.dataset.web === 'admin' && window.PANEL && window.PANEL.owner) adminModal(); });
  function accountModal() {
    openModal(`<h2>Tu cuenta</h2><p>Entraste como <b>${esc(window.PANEL.name)}</b> (${esc(window.PANEL.email)}).</p><div class="row"><button class="btn" id="mOut">Cerrar sesión</button><button class="btn primary" id="mX">Volver al panel</button></div>`);
    $('#mOut').onclick = signOut; $('#mX').onclick = () => closeModal();
  }
  async function adminModal() {
    openModal(`<h2>Comisión y datos</h2><p class="hint">Cargando…</p>`);
    let seats = [], acc = {};
    try {
      const [s, a] = await Promise.all([db.doc('config/seats').get(), db.collection('access').get()]);
      seats = (s.exists && s.data().seats) || []; a.docs.forEach(d => { acc[d.data().seat] = d.id; });
    } catch (e) { openModal(`<h2>Comisión y datos</h2><div class="banner">No se pudo leer la configuración (${esc(e.code || e.message)}).</div><div class="row"><button class="btn" id="mX">Cerrar</button></div>`); $('#mX').onclick = () => closeModal(); return; }
    const nm = id => (seats.find(x => x.id === id) || {}).name || '';
    openModal(`<h2>Comisión y datos</h2>
      <div class="stack" style="gap:8px"><b>Quién evalúa la Fase 3</b>
        <span class="hint">Cada integrante de la comisión entra con su cuenta de Google y queda fijo en su puesto. La Fase 2 no tiene comisión: solo la ves tú.</span>
        ${SEATS.map(([id, label]) => `<div class="acc-row" data-seat="${id}"><span>${label}</span><input type="text" data-k="name" value="${esc(nm(id))}" placeholder="Nombre" aria-label="Nombre de ${label}">${id === 'doc' ? `<span class="hint">${esc(window.PANEL.email)}</span>` : `<input type="text" inputmode="email" autocapitalize="off" spellcheck="false" data-k="mail" value="${esc(acc[id] || '')}" placeholder="correo@duoc.cl" aria-label="Correo de ${label}">`}</div>`).join('')}
        <div class="row"><button class="btn primary" id="mSave">Guardar evaluadores</button><span class="hint" id="mMsg" aria-live="polite"></span></div></div>
      <div class="stack" style="gap:8px"><b>Datos del panel</b>
        <label class="field" style="flex-wrap:wrap">Cargar o actualizar equipos y expedientes <input type="file" id="mSeed" accept=".json,application/json"></label>
        <span class="hint" id="mProg">Usa el archivo de datos que te entrega Claude. No borra evaluaciones, apuntes ni horarios.</span>
        <div class="row"><button class="btn" id="mBackup">Descargar respaldo de las evaluaciones</button></div></div>
      <div class="stack" style="gap:8px"><b>Consultas a Claude</b>
        <span class="hint">${window.PANEL.engine === 'manual' ? 'Ahora todo se copia y se pega en tu sesión de Claude. Con una clave de la API de Anthropic (se crea en console.anthropic.com y se paga por uso: centavos por consulta) las consultas se responden solas. La clave se guarda en tu proyecto de Firebase y solo tú puedes leerla.' : window.PANEL.engine === 'mixed' ? 'Activo: la clave responde sola las consultas de la comisión. Lo tuyo (briefing, preguntas, niveles, feedback) sigue con tu sesión de Claude.' : 'Activo: la clave responde todas las consultas, también las tuyas.'}</span>
        <label class="field"><input type="radio" name="mScope" value="asks" ${window.PANEL.engine !== 'api' ? 'checked' : ''}> Usar la clave solo para las consultas de la comisión</label>
        <label class="field"><input type="radio" name="mScope" value="all" ${window.PANEL.engine === 'api' ? 'checked' : ''}> Usar la clave para todo</label>
        <div class="row"><input type="password" id="mKey" placeholder="sk-ant-…" autocomplete="off" aria-label="Clave de la API de Anthropic" style="flex:1 1 220px"><button class="btn" id="mKeySave">Guardar</button>${window.PANEL.engine !== 'manual' ? '<button class="btn ghost" id="mKeyDel">Quitar clave</button>' : ''}</div>
        <span class="hint" id="mKeyMsg" aria-live="polite"></span></div>
      <div class="row" style="justify-content:space-between"><span class="hint">${esc(window.PANEL.email)}</span><span class="row"><button class="btn" id="mOut">Cerrar sesión</button><button class="btn" id="mX">Volver al panel</button></span></div>`);
    $('#mX').onclick = () => closeModal(); $('#mOut').onclick = signOut;
    $('#mKeySave').onclick = async () => {
      const k = $('#mKey').value.trim(), m = $('#mKeyMsg'), sc = (modal.querySelector('[name="mScope"]:checked') || {}).value === 'all' ? 'all' : 'asks';
      const has = window.PANEL.engine !== 'manual';
      if (!k && !has) { m.textContent = 'Pega primero la clave.'; return; }
      if (k && !/^sk-ant-[\w-]{20,}$/.test(k)) { m.textContent = 'Esa no parece una clave de la API de Anthropic (empiezan con sk-ant-).'; return; }
      try { await db.doc('private/claude').set(k ? { key: k, scope: sc, at: Date.now() } : { scope: sc }, { merge: true }); m.textContent = 'Guardado. Recargando…'; setTimeout(() => location.reload(), 600); }
      catch (e) { m.textContent = 'No se pudo guardar (' + (e.code || e.message) + ').'; }
    };
    if ($('#mKeyDel')) $('#mKeyDel').onclick = async () => { try { await db.doc('private/claude').delete(); location.reload(); } catch (e) { $('#mKeyMsg').textContent = 'No se pudo quitar (' + (e.code || e.message) + ').'; } };
    $('#mSave').onclick = async () => {
      const msg = $('#mMsg'), rows = [...modal.querySelectorAll('.acc-row')];
      const newSeats = [], want = new Map();
      for (const r of rows) {
        const id = r.dataset.seat, name = $('[data-k="name"]', r).value.trim(), mi = $('[data-k="mail"]', r);
        newSeats.push({ id, name });
        if (!mi) continue;
        const mail = mi.value.trim().toLowerCase(); if (!mail) continue;
        if (!/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]+$/.test(mail)) { msg.textContent = `El correo "${mail}" no es válido.`; mi.focus(); return; }
        if (mail === window.PANEL.email) { msg.textContent = 'Tu propio correo ya tiene acceso como docente.'; mi.focus(); return; }
        if (want.has(mail)) { msg.textContent = `El correo ${mail} está repetido.`; mi.focus(); return; }
        want.set(mail, { seat: id, name });
      }
      $('#mSave').disabled = true; msg.textContent = 'Guardando…';
      try {
        await db.doc('config/seats').set({ seats: newSeats });
        const cur = await db.collection('access').get();
        for (const d of cur.docs) if (!want.has(d.id)) await db.doc('access/' + d.id).delete();
        for (const [mail, v] of want) await db.doc('access/' + mail).set(v);
        msg.textContent = want.size ? `Guardado. ${want.size} ${want.size === 1 ? 'persona puede' : 'personas pueden'} entrar además de ti.` : 'Guardado. Nadie más tiene acceso por ahora.';
      } catch (e) { msg.textContent = 'No se pudo guardar (' + (e.code || e.message) + ').'; }
      $('#mSave').disabled = false;
    };
    $('#mSeed').onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return; const p = $('#mProg'); ev.target.disabled = true;
      try { const n = await importSeed(f, (i, t, l) => { p.textContent = `Cargando ${i} de ${t}: ${l}`; }); p.textContent = `Listo: ${n} documentos actualizados. Si cambiaron las rúbricas, recarga la página.`; }
      catch (e) { p.textContent = 'No se pudo cargar: ' + (e.message || e.code); }
      ev.target.disabled = false; ev.target.value = '';
    };
    $('#mBackup').onclick = async ev => { ev.target.disabled = true; try { await exportBackup(); } catch (e) { $('#mProg').textContent = 'No se pudo generar el respaldo (' + (e.code || e.message) + ').'; } ev.target.disabled = false; };
  }

  /* ---------- consultas a Claude: las ejecuta la docente en su propia sesión ---------- */
  function turnsText(input) {
    if (typeof input === 'string') return input;
    const t = input.slice(); const head = t.shift().content;
    if (t.length && t[0].role === 'assistant') t.shift();
    return head + '\n\n# CONVERSACIÓN\n' + t.map(m => (m.role === 'user' ? 'Docente: ' : 'Claude: ') + m.content).join('\n\n') + '\n\nResponde la última consulta de la docente.';
  }
  function parseLoose(text) {
    let s = String(text).trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch (e) { /* busca el bloque JSON dentro del texto */ }
    const a = s.search(/[\[{]/); if (a < 0) throw new Error('sin JSON');
    const close = s[a] === '[' ? ']' : '}'; const b = s.lastIndexOf(close); if (b <= a) throw new Error('sin JSON');
    return JSON.parse(s.slice(a, b + 1));
  }
  function manualSample() {
    const mk = json => (input, opts) => new Promise((resolve, reject) => {
      const prompt = turnsText(input); let done = false;
      const cancel = () => { if (done) return; done = true; reject({ code: 'cancelled', message: 'Consulta cancelada' }); };
      openModal(`<h2>Consulta para Claude</h2>
        <ol class="steps">
          <li><b>Copia la consulta.</b> Incluye el expediente del equipo, los apuntes de todos los evaluadores y la tarea (${prompt.length.toLocaleString('es-CL')} caracteres).
            <div class="row"><button class="btn primary" id="manualCopy">Copiar consulta</button><a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Abrir Claude ↗</a></div>
            <details><summary>Ver la consulta</summary><textarea id="manualPrompt" readonly rows="8"></textarea></details></li>
          <li><b>Pégala en tu sesión de Claude</b> y espera la respuesta.</li>
          <li><b>Pega aquí la respuesta${json ? ' completa, tal como la entrega Claude' : ''}.</b>
            <textarea id="manualAnswer" rows="7" placeholder="Respuesta de Claude"></textarea></li>
        </ol>
        <div class="banner" id="manualErr" hidden></div>
        <div class="row" style="justify-content:flex-end"><button class="btn" id="manualCancel">Cancelar</button><button class="btn primary" id="manualUse">Usar respuesta</button></div>`, cancel);
      $('#manualPrompt').value = prompt;
      const err = t => { const e = $('#manualErr'); e.textContent = t; e.hidden = !t; };
      $('#manualCopy').onclick = async ev => {
        try { await navigator.clipboard.writeText(prompt); ev.target.textContent = 'Copiada'; }
        catch (e) { const d = modal.querySelector('details'); d.open = true; const p = $('#manualPrompt'); p.focus(); p.select(); err('El navegador no permitió copiar. El texto quedó seleccionado: cópialo con Ctrl+C.'); }
      };
      $('#manualCancel').onclick = () => closeModal();
      $('#manualUse').onclick = () => {
        const text = $('#manualAnswer').value.trim();
        if (!text) return err('Pega primero la respuesta de Claude.');
        let val;
        if (json) { try { val = parseLoose(text); } catch (e) { return err('La respuesta no trae los datos completos. Copia el mensaje entero de Claude (con el botón de copiar del mensaje) y pégalo de nuevo.'); } }
        else val = { text, truncated: false };
        done = true; closeModal(true); resolve(val);
      };
      if (opts && opts.signal) opts.signal.addEventListener('abort', () => { if (!done) closeModal(); });
      $('#manualCopy').focus();
      navigator.clipboard && navigator.clipboard.writeText(prompt).then(() => { const b = $('#manualCopy'); if (b) b.textContent = 'Copiada: pégala en Claude'; }).catch(() => { });
      const onFocus = async () => {
        const ta = $('#manualAnswer'); if (done || !ta) { window.removeEventListener('focus', onFocus); return; }
        if (ta.value.trim()) return;
        try { const t = (await navigator.clipboard.readText()).trim(); if (t && t !== prompt.trim() && $('#manualAnswer') && !$('#manualAnswer').value.trim()) { $('#manualAnswer').value = t; err(''); $('#manualUse').focus(); } } catch (e) { /* sin permiso para leer el portapapeles: se pega a mano */ }
      };
      window.addEventListener('focus', onFocus);
    });
    const s = mk(false); s.json = mk(true); s.limits = async () => ({}); return s;
  }

  function pickSample(key, scope) {
    const man = manualSample(); if (!key) return man;
    const api = apiSample(key); if (scope === 'all') return api;
    const pick = o => (o && o.kind === 'ask') ? api : man;
    const s = (i, o) => pick(o)(i, o); s.json = (i, o) => pick(o).json(i, o); s.limits = async () => ({}); return s;
  }
  function apiSample(key) {
    const MODELS = { quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', complex: 'claude-opus-5-5' };
    const fail = (code, userMessage) => ({ code, message: userMessage, userMessage });
    async function run(input, opts, json) {
      opts = opts || {};
      const turns = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map(t => ({ role: t.role, content: t.content }));
      const first = turns[0].content, cut = turns.length === 1 ? first.lastIndexOf('\n\n# TAREA') : -1;
      /* el expediente va primero y se marca para caché: las consultas siguientes sobre el mismo equipo cuestan menos */
      turns[0] = { role: 'user', content: cut > 0 ? [{ type: 'text', text: first.slice(0, cut), cache_control: { type: 'ephemeral' } }, { type: 'text', text: first.slice(cut + 2) }] : [{ type: 'text', text: first, cache_control: { type: 'ephemeral' } }] };
      let r;
      try {
        r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: opts.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: MODELS[opts.modelTier] || MODELS.default, max_tokens: json ? 8000 : 3000, stream: true, messages: turns })
        });
      } catch (e) { throw e && e.name === 'AbortError' ? { code: 'cancelled', message: 'cancelada' } : fail('network', 'No se pudo conectar con Claude. Revisa tu conexión.'); }
      if (!r.ok) {
        let msg = ''; try { msg = ((await r.json()).error || {}).message || ''; } catch (e) { /* sin detalle */ }
        if (r.status === 401) throw fail('api_key', 'La clave de la API no es válida. Revísala en "Comisión y datos".');
        if (r.status === 429) throw { code: 'rate_limited', message: msg };
        if (r.status === 413 || /too long|too large/i.test(msg)) throw { code: 'prompt_too_large', message: msg };
        if (/credit balance/i.test(msg)) throw fail('credit', 'La cuenta de la API no tiene saldo. Agrégalo en console.anthropic.com.');
        throw fail('api', 'Claude no pudo responder (' + r.status + (msg ? ': ' + msg.slice(0, 140) : '') + ').');
      }
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', text = '', truncated = false;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
            if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { text += ev.delta.text; if (opts.onText) opts.onText({ text, delta: ev.delta.text }); }
            else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason === 'max_tokens') truncated = true;
            else if (ev.type === 'error') throw fail('api', 'Claude interrumpió la respuesta' + (ev.error && ev.error.message ? ': ' + ev.error.message.slice(0, 140) : '.'));
          }
        }
      } catch (e) { if (e && e.name === 'AbortError') throw { code: 'cancelled', message: 'cancelada', text }; if (e && e.code) { e.text = text; throw e; } throw Object.assign(fail('network', 'Se cortó la conexión con Claude.'), { text }); }
      if (!json) return { text, truncated };
      try { return parseLoose(text); } catch (e) { throw { code: 'invalid_json', message: 'respuesta incompleta' }; }
    }
    const s = (i, o) => run(i, o, false); s.json = (i, o) => run(i, o, true); s.limits = async () => ({}); return s;
  }

  /* ---------- dictado con el reconocimiento de voz del navegador ---------- */
  function makeDictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return null;
    let rec = null, want = false, state = 'idle', restarts = [];
    const hF = [], hP = [], hS = [];
    const sub = (arr, h) => { arr.push(h); return () => { const i = arr.indexOf(h); if (i >= 0) arr.splice(i, 1); }; };
    const set = (s, reason) => { state = s; hS.forEach(h => h({ state: s, reason })); };
    function start(opts) {
      return new Promise((res, rej) => {
        if (state === 'listening') return res();
        want = true; restarts = []; set('starting');
        rec = new SR(); const lang = opts && opts.language;
        rec.lang = lang === 'es' ? 'es-CL' : (lang || navigator.language || 'es-CL'); rec.continuous = true; rec.interimResults = true;
        let begun = false, denied = false;
        rec.onstart = () => { if (!begun) { begun = true; set('listening'); res(); } };
        rec.onresult = e => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) { const t = r[0].transcript.trim(); if (t) hF.forEach(h => h({ text: ' ' + t })); } else interim += r[0].transcript;
          }
          hP.forEach(h => h({ text: interim }));
        };
        rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { denied = true; want = false; } };
        rec.onend = () => {
          hP.forEach(h => h({ text: '' }));
          if (want) { /* el navegador corta tras un silencio: se retoma solo */
            const now = Date.now(); restarts = restarts.filter(t => now - t < 10000); restarts.push(now);
            if (restarts.length <= 5) { try { rec.start(); return; } catch (e) { /* cae al cierre */ } }
          }
          const failed = want; want = false;
          set('idle', denied ? 'not_granted' : failed ? 'upstream_error' : 'stopped');
          if (!begun) rej({ code: denied ? 'not_granted' : 'upstream_error', message: 'No se pudo abrir el micrófono' });
        };
        try { rec.start(); } catch (e) { want = false; set('idle', 'upstream_error'); rej({ code: 'upstream_error', message: String(e) }); }
      });
    }
    function stop() {
      return new Promise(res => {
        if (state === 'idle' || !rec) return res();
        want = false; set('finishing'); rec.addEventListener('end', () => res(), { once: true });
        try { rec.stop(); } catch (e) { res(); }
      });
    }
    return { start, stop, active: () => state !== 'idle', onFinal: h => sub(hF, h), onPartial: h => sub(hP, h), onState: h => sub(hS, h) };
  }

  /* ---------- descargas ---------- */
  const downloads = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data], { type: /\.csv$/i.test(filename) ? 'text/csv;charset=utf-8' : /\.json$/i.test(filename) ? 'application/json' : 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }
  };

  /* ---------- arranque ---------- */
  const fb = CFG.firebase || {};
  if (!fb.apiKey || /PEGA|TU_|REEMPLAZA/i.test(fb.apiKey) || !fb.projectId) {
    gateShow(`<p><b>Falta conectar el panel con Firebase.</b></p><p class="hint">Abre el archivo <code>config.js</code> y pega la configuración de tu proyecto de Firebase, como indica el archivo LEEME.</p>`);
    return;
  }
  if (!window.firebase || !firebase.auth || !firebase.firestore) { gateShow(`<p><b>No se pudieron cargar los archivos de Firebase.</b></p><p class="hint">Revisa que la carpeta <code>vendor</code> esté publicada junto a esta página.</p>`); return; }
  try {
    firebase.initializeApp(fb); auth = firebase.auth(); db = firebase.firestore();
    try { db.settings({ ignoreUndefinedProperties: true, merge: true }); } catch (e) { /* ajustes opcionales */ }
  } catch (e) { gateError(e); return; }
  gateBusy('Conectando…');
  auth.onAuthStateChanged(u => { if (started) { if (!u) location.reload(); return; } if (u) enter(u); else gateSignIn(); }, e => gateError(e));
})();
