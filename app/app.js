/* TradeFlow mobile — offline-first PWA.
   Everything lives in localStorage on this phone. Nothing is uploaded anywhere.
   GST is rounded to cents PER LINE and then summed — never 10% of the total. */

const DB_KEY = 'tradeflow.v1';
const money  = c => '$' + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const today  = () => new Date().toISOString().slice(0, 10);
const uid    = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc    = s => String(s == null ? '' : s).replace(/[&<>"']/g,
                 c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let D = load();
let tab = 'home';
let sheet = null;

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(DB_KEY));
    if (d && d.v === 1) return d;
  } catch (e) {}
  return { v: 1, biz: { name: '', abn: '', phone: '', email: '', gst: true, terms: 14 },
           customers: [], quotes: [], jobs: [], invoices: [], seq: { q: 1, j: 1, i: 1 } };
}
function save() { try { localStorage.setItem(DB_KEY, JSON.stringify(D)); } catch (e) { alert('Could not save — phone storage may be full.'); } }

/* ── GST: round per line, then sum. This is the whole point. ───────────────── */
function totals(lines, gstOn) {
  let sub = 0, gst = 0;
  for (const l of (lines || [])) {
    const qty  = Number(l.qty || 0);
    const rate = Math.round(Number(l.rate || 0) * 100);      // cents
    const line = Math.round(qty * rate);                     // cents, rounded at the line
    sub += line;
    if (gstOn && l.gst !== false) gst += Math.round(line * 0.1);   // 10% of THIS line, to cents
  }
  return { sub, gst, total: sub + gst };
}
const paidOf = inv => (inv.payments || []).reduce((a, p) => a + Number(p.cents || 0), 0);
function invStatus(inv) {
  const t = totals(inv.lines, inv.gst).total, p = paidOf(inv);
  if (p >= t && t > 0) return 'paid';
  if (p > 0) return 'part';
  if (inv.due && inv.due < today()) return 'overdue';
  return inv.sent ? 'sent' : 'draft';
}

/* ── navigation ───────────────────────────────────────────────────────────── */
function go(t) { tab = t; sheet = null; render(); window.scrollTo(0, 0); }
function fabAction() {
  if (tab === 'customers') return openCustomer();
  if (tab === 'invoices')  return openInvoice();
  if (tab === 'jobs')      return openJob();
  return openQuote();
}

function render() {
  document.getElementById('bizline').textContent =
    D.biz.name ? (D.biz.name + (D.biz.abn ? ' · ABN ' + D.biz.abn : '')) : 'Tap ⚙ to set up your business';
  for (const k of ['home', 'quotes', 'jobs', 'invoices', 'customers']) {
    const el = document.getElementById('n-' + k);
    if (el) el.className = (tab === k ? 'on' : '');
  }
  document.getElementById('fab').style.display = (tab === 'home' || tab === 'more') ? 'none' : 'block';
  const v = document.getElementById('view');
  v.innerHTML = ({ home: vHome, quotes: vQuotes, jobs: vJobs,
                   invoices: vInvoices, customers: vCustomers, more: vMore }[tab] || vHome)();
  const old = document.querySelector('.sheet'); if (old) old.remove();
  if (sheet) { const d = document.createElement('div'); d.className = 'sheet';
    d.innerHTML = '<div class="inner">' + sheet() + '</div>';
    d.onclick = e => { if (e.target === d) { sheet = null; render(); } };
    document.body.appendChild(d); }
}

/* ── TODAY ────────────────────────────────────────────────────────────────── */
function vHome() {
  const inv = D.invoices;
  const out = inv.filter(i => ['sent', 'part', 'overdue'].includes(invStatus(i)))
                 .reduce((a, i) => a + (totals(i.lines, i.gst).total - paidOf(i)), 0);
  const over = inv.filter(i => invStatus(i) === 'overdue')
                  .reduce((a, i) => a + (totals(i.lines, i.gst).total - paidOf(i)), 0);
  const y = new Date(); y.setDate(y.getDate() - 30);
  const rec = inv.reduce((a, i) => a + (i.payments || [])
      .filter(p => p.date >= y.toISOString().slice(0, 10))
      .reduce((b, p) => b + Number(p.cents || 0), 0), 0);
  const qOut = D.quotes.filter(q => q.status === 'sent')
                       .reduce((a, q) => a + totals(q.lines, q.gst).total, 0);

  let h = '';
  if (!D.biz.name) h += `<div class="note"><b>Start here.</b> Add your business name and ABN so your
      invoices are valid tax invoices. Takes 30 seconds.
      <button class="btn sm full" onclick="go('more')">Set up business</button></div>`;

  h += `<div class="tiles">
    <div class="tile ${out ? 'warn' : ''}"><span class="dim">Owed to you</span><b>${money(out)}</b></div>
    <div class="tile ${over ? 'bad' : ''}"><span class="dim">Overdue</span><b>${money(over)}</b></div>
    <div class="tile good"><span class="dim">Paid, 30 days</span><b>${money(rec)}</b></div>
    <div class="tile"><span class="dim">Quotes out</span><b>${money(qOut)}</b></div>
  </div>`;

  const due = D.invoices.filter(i => ['overdue', 'sent', 'part'].includes(invStatus(i)))
                        .sort((a, b) => (a.due || '') < (b.due || '') ? -1 : 1).slice(0, 6);
  h += `<div class="card"><div class="row"><h3 class="grow">Chase these</h3></div>`;
  h += due.length ? due.map(i => itemInvoice(i)).join('')
                  : `<div class="empty">Nothing owing. Send a quote.</div>`;
  h += `</div>`;

  h += `<div class="card"><h3>Today</h3>
    ${D.jobs.filter(j => j.date === today() && j.status !== 'invoiced').map(j => itemJob(j)).join('')
      || '<div class="empty">No jobs booked today.</div>'}</div>`;
  return h;
}

/* ── list rows ────────────────────────────────────────────────────────────── */
const custName = id => (D.customers.find(c => c.id === id) || {}).name || 'No customer';

function itemInvoice(i) {
  const t = totals(i.lines, i.gst).total, p = paidOf(i), s = invStatus(i);
  return `<div class="item" onclick="openInvoice('${i.id}')">
    <div class="grow"><div class="trunc">${esc(i.no)} · ${esc(custName(i.customer))}</div>
      <div class="dim2">${i.due ? 'due ' + i.due : 'no due date'}${p ? ' · paid ' + money(p) : ''}</div></div>
    <div class="right"><div class="mono">${money(t - p)}</div>
      <span class="pill ${s}">${s}</span></div></div>`;
}
function itemQuote(q) {
  return `<div class="item" onclick="openQuote('${q.id}')">
    <div class="grow"><div class="trunc">${esc(q.no)} · ${esc(custName(q.customer))}</div>
      <div class="dim2">${esc(q.title || '')}</div></div>
    <div class="right"><div class="mono">${money(totals(q.lines, q.gst).total)}</div>
      <span class="pill ${q.status || 'draft'}">${q.status || 'draft'}</span></div></div>`;
}
function itemJob(j) {
  return `<div class="item" onclick="openJob('${j.id}')">
    <div class="grow"><div class="trunc">${esc(j.no)} · ${esc(custName(j.customer))}</div>
      <div class="dim2">${esc(j.title || '')}${j.date ? ' · ' + j.date : ''}</div></div>
    <span class="pill ${j.status === 'invoiced' ? 'paid' : j.status === 'done' ? 'accepted' : 'sent'}">${esc(j.status || 'booked')}</span></div>`;
}

function vQuotes() {
  return `<div class="card"><h3>Quotes</h3>${D.quotes.length
    ? D.quotes.slice().reverse().map(itemQuote).join('')
    : '<div class="empty">No quotes yet.<br>Tap + to write one.</div>'}</div>`;
}
function vJobs() {
  return `<div class="card"><h3>Jobs</h3>${D.jobs.length
    ? D.jobs.slice().reverse().map(itemJob).join('')
    : '<div class="empty">No jobs yet.<br>Accept a quote, or tap + .</div>'}</div>`;
}
function vInvoices() {
  return `<div class="card"><h3>Invoices</h3>${D.invoices.length
    ? D.invoices.slice().reverse().map(itemInvoice).join('')
    : '<div class="empty">No invoices yet.<br>Finish a job, or tap + .</div>'}</div>`;
}
function vCustomers() {
  return `<div class="card"><h3>Customers</h3>${D.customers.length
    ? D.customers.map(c => `<div class="item" onclick="openCustomer('${c.id}')">
        <div class="grow"><div class="trunc">${esc(c.name)}</div>
        <div class="dim2">${esc(c.phone || '')}${c.email ? ' · ' + esc(c.email) : ''}</div></div>
        <span class="dim2">›</span></div>`).join('')
    : '<div class="empty">No customers yet.<br>Tap + to add one.</div>'}</div>`;
}
/* ── editors: customer, quote, job, invoice ───────────────────────────────── */

let E = null;   // the record being edited

function openCustomer(id) {
  E = id ? { ...D.customers.find(c => c.id === id) } : { id: uid(), name: '', phone: '', email: '', address: '' };
  sheet = () => `<h2>${E.name ? 'Customer' : 'New customer'}</h2>
    <label>Name</label><input id="f-name" value="${esc(E.name)}" placeholder="Name or business">
    <label>Phone</label><input id="f-phone" type="tel" inputmode="tel" value="${esc(E.phone)}">
    <label>Email</label><input id="f-email" type="email" inputmode="email" value="${esc(E.email)}">
    <label>Site address</label><textarea id="f-address">${esc(E.address)}</textarea>
    <button class="btn full" onclick="saveCustomer()">Save</button>
    ${D.customers.find(c => c.id === E.id) ? `<button class="btn bad full" onclick="delRec('customers','${E.id}')">Delete</button>` : ''}
    <button class="btn ghost full" onclick="sheet=null;render()">Close</button>`;
  render();
}
function saveCustomer() {
  const g = i => (document.getElementById(i) || {}).value || '';
  E.name = g('f-name').trim(); E.phone = g('f-phone').trim();
  E.email = g('f-email').trim(); E.address = g('f-address').trim();
  if (!E.name) return alert('Name is required.');
  const i = D.customers.findIndex(c => c.id === E.id);
  if (i >= 0) D.customers[i] = E; else D.customers.push(E);
  save(); sheet = null; render();
}
function delRec(coll, id) {
  if (!confirm('Delete this? It cannot be undone.')) return;
  D[coll] = D[coll].filter(r => r.id !== id); save(); sheet = null; render();
}

function custOptions(sel) {
  return '<option value="">— choose —</option>' + D.customers.map(c =>
    `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

/* lines editor shared by quote + invoice */
function linesHtml(lines, gstOn) {
  const t = totals(lines, gstOn);
  return (lines || []).map((l, n) => `<div class="lineitem">
      <input id="l-desc-${n}" value="${esc(l.desc)}" placeholder="Description" oninput="lineEdit(${n},'desc',this.value)">
      <div class="row" style="margin-top:7px;gap:7px">
        <input id="l-qty-${n}" class="grow" type="number" inputmode="decimal" step="0.01" value="${l.qty}"
               placeholder="Qty" oninput="lineEdit(${n},'qty',this.value)">
        <input id="l-rate-${n}" class="grow" type="number" inputmode="decimal" step="0.01" value="${l.rate}"
               placeholder="Rate $" oninput="lineEdit(${n},'rate',this.value)">
        <button class="btn ghost sm" onclick="lineDel(${n})">✕</button>
      </div>
      <div class="dim2" style="margin-top:5px">line ${money(Math.round(Number(l.qty || 0) * Math.round(Number(l.rate || 0) * 100)))}${
        gstOn && l.gst !== false ? ' + GST ' + money(Math.round(Math.round(Number(l.qty || 0) * Math.round(Number(l.rate || 0) * 100)) * 0.1)) : ' · no GST'}
        <label style="display:inline;margin-left:8px;color:var(--dim)">
          <input type="checkbox" style="width:auto;margin-right:4px" ${l.gst !== false ? 'checked' : ''}
                 onchange="lineEdit(${n},'gst',this.checked)">GST</label></div>
    </div>`).join('') +
    `<button class="btn ghost sm" onclick="lineAdd()">+ Add line</button>
     <div class="totals">
       <div class="row"><span class="dim">Subtotal</span><span class="mono">${money(t.sub)}</span></div>
       <div class="row"><span class="dim">GST (per line, rounded)</span><span class="mono">${money(t.gst)}</span></div>
       <div class="row big"><span>Total</span><span class="mono">${money(t.total)}</span></div>
     </div>`;
}
function lineEdit(n, k, v) { E.lines[n][k] = (k === 'gst') ? v : v; if (k === 'gst' || k === 'qty' || k === 'rate') render(); }
function lineAdd() { E.lines.push({ desc: '', qty: 1, rate: 0, gst: true }); render(); }
function lineDel(n) { E.lines.splice(n, 1); render(); }

/* ── QUOTE ────────────────────────────────────────────────────────────────── */
function openQuote(id) {
  E = id ? JSON.parse(JSON.stringify(D.quotes.find(q => q.id === id)))
         : { id: uid(), no: 'Q' + String(D.seq.q).padStart(4, '0'), customer: '', title: '',
             date: today(), status: 'draft', gst: D.biz.gst !== false,
             lines: [{ desc: '', qty: 1, rate: 0, gst: true }], notes: '' };
  sheet = () => `<h2>${esc(E.no)}</h2><div class="dim" style="margin-bottom:6px">Quote</div>
    <label>Customer</label><select id="f-cust" onchange="E.customer=this.value">${custOptions(E.customer)}</select>
    <label>Job title</label><input id="f-title" value="${esc(E.title)}" placeholder="e.g. 40m temp fence, Tarneit"
      oninput="E.title=this.value">
    <label>Date</label><input id="f-date" type="date" value="${E.date}" oninput="E.date=this.value">
    <label>Lines</label>${linesHtml(E.lines, E.gst)}
    <label>Notes for the customer</label><textarea oninput="E.notes=this.value">${esc(E.notes)}</textarea>
    <button class="btn full" onclick="saveQuote()">Save quote</button>
    ${D.quotes.find(q => q.id === E.id) ? `
      <button class="btn ghost full" onclick="shareDoc('quote')">Send / share</button>
      <button class="btn ghost full" onclick="quoteToJob('${E.id}')">Accepted → make it a job</button>
      <button class="btn bad full" onclick="delRec('quotes','${E.id}')">Delete</button>` : ''}
    <button class="btn ghost full" onclick="sheet=null;render()">Close</button>`;
  render();
}
function saveQuote() {
  if (!E.customer) return alert('Pick a customer first.');
  const i = D.quotes.findIndex(q => q.id === E.id);
  if (i >= 0) D.quotes[i] = E; else { D.quotes.push(E); D.seq.q++; }
  save(); sheet = null; render();
}
function quoteToJob(qid) {
  const q = D.quotes.find(x => x.id === qid); if (!q) return;
  if (D.jobs.some(j => j.fromQuote === qid)) return alert('That quote is already a job.');
  const j = { id: uid(), no: 'J' + String(D.seq.j).padStart(4, '0'), customer: q.customer,
              title: q.title, date: today(), status: 'booked', fromQuote: qid,
              gst: q.gst, lines: JSON.parse(JSON.stringify(q.lines)) };
  D.jobs.push(j); D.seq.j++;
  q.status = 'accepted'; save(); tab = 'jobs'; sheet = null; render();
}

/* ── JOB ──────────────────────────────────────────────────────────────────── */
function openJob(id) {
  E = id ? JSON.parse(JSON.stringify(D.jobs.find(j => j.id === id)))
         : { id: uid(), no: 'J' + String(D.seq.j).padStart(4, '0'), customer: '', title: '',
             date: today(), status: 'booked', gst: D.biz.gst !== false,
             lines: [{ desc: '', qty: 1, rate: 0, gst: true }] };
  sheet = () => `<h2>${esc(E.no)}</h2><div class="dim" style="margin-bottom:6px">Job</div>
    <label>Customer</label><select onchange="E.customer=this.value">${custOptions(E.customer)}</select>
    <label>Title</label><input value="${esc(E.title)}" oninput="E.title=this.value">
    <label>Scheduled</label><input type="date" value="${E.date}" oninput="E.date=this.value">
    <label>Status</label><select onchange="E.status=this.value">
      ${['booked', 'in progress', 'done', 'invoiced'].map(s =>
        `<option ${E.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <label>Lines</label>${linesHtml(E.lines, E.gst)}
    <button class="btn full" onclick="saveJob()">Save job</button>
    ${D.jobs.find(j => j.id === E.id) && E.status !== 'invoiced' ? `
      <button class="btn ghost full" onclick="jobToInvoice('${E.id}')">Done → raise the invoice</button>` : ''}
    ${D.jobs.find(j => j.id === E.id) ? `<button class="btn bad full" onclick="delRec('jobs','${E.id}')">Delete</button>` : ''}
    <button class="btn ghost full" onclick="sheet=null;render()">Close</button>`;
  render();
}
function saveJob() {
  if (!E.customer) return alert('Pick a customer first.');
  const i = D.jobs.findIndex(j => j.id === E.id);
  if (i >= 0) D.jobs[i] = E; else { D.jobs.push(E); D.seq.j++; }
  save(); sheet = null; render();
}
function jobToInvoice(jid) {
  const j = D.jobs.find(x => x.id === jid); if (!j) return;
  if (D.invoices.some(i => i.fromJob === jid)) return alert('That job is already invoiced.');
  const due = new Date(); due.setDate(due.getDate() + Number(D.biz.terms || 14));
  const inv = { id: uid(), no: 'INV' + String(D.seq.i).padStart(4, '0'), customer: j.customer,
                title: j.title, date: today(), due: due.toISOString().slice(0, 10),
                fromJob: jid, gst: j.gst, lines: JSON.parse(JSON.stringify(j.lines)),
                payments: [], sent: false,
                abnAtIssue: D.biz.abn, bizAtIssue: D.biz.name };
  D.invoices.push(inv); D.seq.i++;
  j.status = 'invoiced'; save(); tab = 'invoices'; sheet = null; render();
}
/* ── INVOICE ──────────────────────────────────────────────────────────────── */
function openInvoice(id) {
  E = id ? JSON.parse(JSON.stringify(D.invoices.find(i => i.id === id)))
         : { id: uid(), no: 'INV' + String(D.seq.i).padStart(4, '0'), customer: '', title: '',
             date: today(), due: (() => { const d = new Date();
               d.setDate(d.getDate() + Number(D.biz.terms || 14)); return d.toISOString().slice(0, 10); })(),
             gst: D.biz.gst !== false, lines: [{ desc: '', qty: 1, rate: 0, gst: true }],
             payments: [], sent: false, abnAtIssue: D.biz.abn, bizAtIssue: D.biz.name };
  const exists = !!D.invoices.find(i => i.id === E.id);
  const t = totals(E.lines, E.gst).total, p = paidOf(E);
  sheet = () => `<h2>${esc(E.no)}</h2>
    <div class="dim" style="margin-bottom:6px">Tax invoice · <span class="pill ${invStatus(E)}">${invStatus(E)}</span></div>
    <label>Customer</label><select onchange="E.customer=this.value">${custOptions(E.customer)}</select>
    <label>Title</label><input value="${esc(E.title)}" oninput="E.title=this.value">
    <div class="row" style="gap:8px">
      <div class="grow"><label>Issued</label><input type="date" value="${E.date}" oninput="E.date=this.value"></div>
      <div class="grow"><label>Due</label><input type="date" value="${E.due}" oninput="E.due=this.value"></div>
    </div>
    <label>Lines</label>${linesHtml(E.lines, E.gst)}
    ${exists ? `
      <label>Payments received</label>
      ${(E.payments || []).map((pm, n) => `<div class="row" style="padding:6px 0;border-top:1px solid var(--line)">
          <span class="grow dim">${pm.date}</span><span class="mono">${money(pm.cents)}</span>
          <button class="btn ghost sm" onclick="payDel(${n})">✕</button></div>`).join('')}
      <div class="row" style="gap:7px;margin-top:7px">
        <input id="pay-amt" class="grow" type="number" inputmode="decimal" step="0.01"
               placeholder="Amount received $" value="${((t - p) / 100).toFixed(2)}">
        <button class="btn sm" onclick="payAdd()">Record</button>
      </div>
      <div class="totals"><div class="row"><span class="dim">Paid</span><span class="mono">${money(p)}</span></div>
        <div class="row big"><span>Still owing</span><span class="mono">${money(t - p)}</span></div></div>` : ''}
    <button class="btn full" onclick="saveInvoice()">Save invoice</button>
    ${exists ? `<button class="btn ghost full" onclick="shareDoc('invoice')">Send / share</button>
      <button class="btn bad full" onclick="delRec('invoices','${E.id}')">Delete</button>` : ''}
    <button class="btn ghost full" onclick="sheet=null;render()">Close</button>`;
  render();
}
function saveInvoice() {
  if (!E.customer) return alert('Pick a customer first.');
  const i = D.invoices.findIndex(x => x.id === E.id);
  if (i >= 0) D.invoices[i] = E; else { D.invoices.push(E); D.seq.i++; }
  save(); sheet = null; render();
}
function payAdd() {
  const v = Number((document.getElementById('pay-amt') || {}).value || 0);
  if (!v) return;
  E.payments = E.payments || [];
  E.payments.push({ date: today(), cents: Math.round(v * 100) });
  const i = D.invoices.findIndex(x => x.id === E.id);
  if (i >= 0) { D.invoices[i] = E; save(); }
  render();
}
function payDel(n) {
  E.payments.splice(n, 1);
  const i = D.invoices.findIndex(x => x.id === E.id);
  if (i >= 0) { D.invoices[i] = E; save(); }
  render();
}

/* ── share: plain text an AU tax invoice needs, via the phone's share sheet ── */
function docText(kind) {
  const c = D.customers.find(x => x.id === E.customer) || {};
  const t = totals(E.lines, E.gst);
  const head = kind === 'invoice' ? 'TAX INVOICE' : 'QUOTE';
  const L = [];
  L.push(head + '  ' + E.no);
  L.push((E.bizAtIssue || D.biz.name || '').toUpperCase());
  if (E.abnAtIssue || D.biz.abn) L.push('ABN ' + (E.abnAtIssue || D.biz.abn));
  if (D.biz.phone) L.push(D.biz.phone);
  L.push('');
  L.push('To: ' + (c.name || ''));
  if (E.title) L.push('Re: ' + E.title);
  L.push('Date: ' + E.date);
  if (kind === 'invoice' && E.due) L.push('Due: ' + E.due);
  L.push('');
  for (const l of E.lines) {
    const cents = Math.round(Number(l.qty || 0) * Math.round(Number(l.rate || 0) * 100));
    L.push(`${l.desc || ''}  ${l.qty} x $${Number(l.rate || 0).toFixed(2)}   ${money(cents)}`);
  }
  L.push('');
  L.push('Subtotal  ' + money(t.sub));
  if (E.gst) L.push('GST       ' + money(t.gst));
  L.push('TOTAL     ' + money(t.total));
  if (kind === 'invoice') {
    const p = paidOf(E);
    if (p) { L.push('Paid      ' + money(p)); L.push('OWING     ' + money(t.total - p)); }
    if (D.biz.payid) { L.push(''); L.push('Pay by PayID: ' + D.biz.payid); L.push('Reference: ' + E.no); }
  }
  if (E.notes) { L.push(''); L.push(E.notes); }
  return L.join('\n');
}
async function shareDoc(kind) {
  const text = docText(kind);
  if (kind === 'invoice' && !E.sent) {
    E.sent = true;
    const i = D.invoices.findIndex(x => x.id === E.id); if (i >= 0) { D.invoices[i] = E; save(); }
  }
  if (kind === 'quote') {
    E.status = 'sent';
    const i = D.quotes.findIndex(x => x.id === E.id); if (i >= 0) { D.quotes[i] = E; save(); }
  }
  try {
    if (navigator.share) await navigator.share({ title: E.no, text });
    else { await navigator.clipboard.writeText(text); alert('Copied. Paste it into a text or email.'); }
  } catch (e) { /* user cancelled */ }
  render();
}

/* ── SETTINGS ─────────────────────────────────────────────────────────────── */
function vMore() {
  const b = D.biz;
  return `<div class="card"><h3>Your business</h3>
    <div class="dim2" style="margin-top:4px">This is what prints on every quote and invoice.
      An Australian tax invoice needs your business name and ABN.</div>
    <label>Business name</label><input id="b-name" value="${esc(b.name)}">
    <label>ABN</label><input id="b-abn" inputmode="numeric" value="${esc(b.abn)}">
    <label>Phone</label><input id="b-phone" type="tel" inputmode="tel" value="${esc(b.phone)}">
    <label>Email</label><input id="b-email" type="email" inputmode="email" value="${esc(b.email)}">
    <label>PayID for getting paid</label><input id="b-payid" value="${esc(b.payid || '')}"
      placeholder="mobile or email registered at your bank">
    <label>Payment terms (days)</label><input id="b-terms" type="number" inputmode="numeric" value="${b.terms || 14}">
    <label style="display:flex;align-items:center;gap:8px;margin-top:14px">
      <input type="checkbox" id="b-gst" style="width:auto" ${b.gst !== false ? 'checked' : ''}>
      <span style="color:var(--ink);font-size:15px">Registered for GST</span></label>
    <button class="btn full" onclick="saveBiz()">Save</button></div>

  <div class="card"><h3>Your data</h3>
    <div class="dim2" style="margin-top:4px">Everything is stored on this phone only. Nothing is
      uploaded anywhere. Back it up now and then — if you lose the phone, you lose the lot.</div>
    <button class="btn ghost full" onclick="backup()">Back up to a file</button>
    <label>Restore from a backup</label>
    <input type="file" accept="application/json" onchange="restore(this)">
    <div class="dim2" style="margin-top:14px">
      ${D.customers.length} customers · ${D.quotes.length} quotes ·
      ${D.jobs.length} jobs · ${D.invoices.length} invoices</div></div>

  <div class="card"><h3>GST, done properly</h3>
    <div class="dim2" style="margin-top:4px;line-height:1.6">GST is rounded to cents on each line
      and then added up — not worked out as 10% of the total. Those two disagree often enough to
      start an argument with your accountant. This does it the first way.</div></div>`;
}
function saveBiz() {
  const g = i => (document.getElementById(i) || {}).value || '';
  D.biz = { name: g('b-name').trim(), abn: g('b-abn').trim(), phone: g('b-phone').trim(),
            email: g('b-email').trim(), payid: g('b-payid').trim(),
            terms: Number(g('b-terms')) || 14,
            gst: (document.getElementById('b-gst') || {}).checked !== false };
  save(); alert('Saved.'); render();
}
function backup() {
  const blob = new Blob([JSON.stringify(D, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tradeflow-backup-' + today() + '.json';
  a.click();
}
function restore(inp) {
  const f = inp.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || d.v !== 1) throw new Error('not a TradeFlow backup');
      if (!confirm('Replace everything on this phone with the backup?')) return;
      D = d; save(); render(); alert('Restored.');
    } catch (e) { alert('That file is not a TradeFlow backup.'); }
  };
  r.readAsText(f);
}

/* boot */
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
