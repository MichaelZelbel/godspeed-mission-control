#!/usr/bin/env node


'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const GODSPEED = process.env.GODSPEED_WORKSPACE;
if (!GODSPEED || !path.isAbsolute(GODSPEED)) throw Error('Choose the isolated workspace');
const REGISTER = path.join(GODSPEED, 'profile', 'subscriptions.md');
const PRICE_OVERRIDES = path.join(GODSPEED, 'profile', 'subscription-model-prices.json');
let receipts = {};
try { receipts = JSON.parse(fs.readFileSync(path.join(GODSPEED, '.godspeed', 'subscription-receipts.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw Error('Subscription receipt configuration is not readable JSON'); }
const cache = path.join(GODSPEED, '.godspeed', 'subscription-price-cache');
fs.mkdirSync(cache, {recursive:true});
const PRICE_CACHE = path.join(cache, 'model-prices-openrouter.json');
function claudeProjectDirs() {
 return (Array.isArray(receipts.claude_projects) ? receipts.claude_projects : []).filter(p => typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p) && fs.statSync(p).isDirectory());
}
const OPENROUTER_LEDGER = typeof receipts.openrouter_ledger === 'string' ? receipts.openrouter_ledger : path.join(GODSPEED,'.godspeed','usage','openrouter.jsonl');
const HERMES_LEDGER = typeof receipts.hermes_ledger === 'string' ? receipts.hermes_ledger : path.join(GODSPEED,'.godspeed','usage','hermes.jsonl');

function readRegister(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { path: file, exists: false, subs: [] }; }
  text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

  const subs = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^##\s+(.*\S)\s*$/);
    if (h) {
      if (cur) subs.push(cur);
      cur = { name: h[1], fields: {}, notes: [] };
      continue;
    }
    if (!cur || !line || line.startsWith('#') || line.startsWith('>')) continue;
    const parts = line.split(/\s{2,}|\s+·\s+/);
    let matchedAny = false;
    for (const part of parts) {
      const kv = part.match(/^\*{0,2}([A-Za-z][A-Za-z ]{1,20}?)\*{0,2}\s*:\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1].trim().toLowerCase();
      const val = kv[2].trim().replace(/\.$/, '').trim();
      if (val) { cur.fields[key] = val; matchedAny = true; }
    }
    if (!matchedAny) cur.notes.push(line);
  }
  if (cur) subs.push(cur);

  return { path: file, exists: true, subs: subs.map(normaliseSub) };
}

function normaliseSub(s) {
  const f = s.fields;
  const list = (v) => (v ? v.split(',').map((x) => x.trim()).filter((x) => x && x !== '-') : []);
  return {
    name: s.name,
    costs: f['costs'] || f['cost'] || null,
    costUsd: parseMonthlyUsd(f['costs'] || f['cost'] || ''),
    renews: f['renews'] || null,
    covers: list(f['covers']),
    receipts: (f['receipts'] || 'none').toLowerCase(),
    status: (f['status'] || 'active').toLowerCase(),
    lastChecked: f['last checked'] || null,
    notes: s.notes,
  };
}


function parseMonthlyUsd(v) {
  const m = String(v).match(/\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!isFinite(n)) return null;
  if (/per\s*year|\/\s*(yr|year)|annual/i.test(v)) return n / 12;
  return n;
}

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'mc-subs' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.setTimeout(timeoutMs || 20000, () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}


async function loadPrices(opts) {
  const overrides = readJsonOr(PRICE_OVERRIDES, { models: {} });
  let table = null;
  let source = 'unavailable';

  if (!opts.noNetwork) {
    try {
      const data = await httpGetJson('https://openrouter.ai/api/v1/models', 20000);
      table = {};
      for (const m of data.data || []) {
        const p = m.pricing || {};
        const num = (x) => { const n = Number(x); return isFinite(n) ? n * 1e6 : null; };
        const inp = num(p.prompt);
        if (inp === null) continue;
        table[m.id] = {
          in: inp,
          out: num(p.completion),
          cacheRead: num(p.input_cache_read),
          cacheWrite: num(p.input_cache_write),
        };
      }
      source = 'openrouter (live)';
      try { fs.writeFileSync(PRICE_CACHE, JSON.stringify({ fetched: new Date().toISOString(), table }), 'utf8'); }
      catch (e) { /* a cache we cannot write is not a reason to fail */ }
    } catch (e) { table = null; }
  }

  if (!table) {
    const cached = readJsonOr(PRICE_CACHE, null);
    if (cached && cached.table) { table = cached.table; source = 'openrouter (cached ' + String(cached.fetched).slice(0, 10) + ')'; }
  }
  if (!table) table = {};

  return { table, overrides: overrides.models || {}, source };
}

function readJsonOr(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}


function priceFor(modelId, prices) {
  if (prices.overrides[modelId]) return { price: prices.overrides[modelId], via: 'override' };
  const bare = modelId.replace(/-\d{8}$/, '');
  const dotted = bare.replace(/-(\d+)-(\d+)$/, '-$1.$2');
  if (prices.overrides[bare]) return { price: prices.overrides[bare], via: 'override' };
  if (prices.overrides[dotted]) return { price: prices.overrides[dotted], via: 'override' };

  const vendors = { claude: 'anthropic', gpt: 'openai', o1: 'openai', o3: 'openai', kimi: 'moonshotai', k3: 'moonshotai', deepseek: 'deepseek', glm: 'z-ai', grok: 'x-ai', gemini: 'google' };
  const stem = (bare.split(/[-\/.]/)[0] || '').toLowerCase();
  const vendor = vendors[stem];

  const candidates = [modelId, bare, dotted];
  if (vendor) for (const n of [modelId, bare, dotted]) candidates.push(vendor + '/' + n);

  for (const c of candidates) {
    if (prices.table[c]) return { price: prices.table[c], via: 'openrouter:' + c };
  }
  return { price: null, via: null };
}


function valueOf(u, price) {
  const cacheRead = price.cacheRead !== null && price.cacheRead !== undefined ? price.cacheRead : price.in * 0.1;
  const cacheWrite = price.cacheWrite !== null && price.cacheWrite !== undefined ? price.cacheWrite : price.in * 1.25;
  const out = price.out !== null && price.out !== undefined ? price.out : 0;
  const assumed = !(price.cacheRead !== null && price.cacheRead !== undefined);
  return {
    usd: (u.in / 1e6) * price.in + (u.cacheRead / 1e6) * cacheRead + (u.cacheWrite / 1e6) * cacheWrite + (u.out / 1e6) * out,
    assumedCacheRates: assumed,
  };
}

function emptyUsage() { return { in: 0, cacheRead: 0, cacheWrite: 0, out: 0, messages: 0 }; }

function addUsage(a, b) {
  a.in += b.in; a.cacheRead += b.cacheRead; a.cacheWrite += b.cacheWrite; a.out += b.out; a.messages += b.messages;
  return a;
}

function walkJsonl(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(p, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}


function meterClaudeCode(days) {
  const dirs = claudeProjectDirs();
  if (!dirs.length) return { available: false, why: 'no Claude Code transcript folder on this machine', byModel: {}, files: 0, activeDays: 0 };

  const cut = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const byModel = {};
  const activeDays = new Set();
  let files = 0, receipts = 0, unreadable = 0;

  for (const d of dirs) {
    for (const f of walkJsonl(d, [])) {
      files++;
      let text;
      try { text = fs.readFileSync(f, 'utf8'); } catch (e) { unreadable++; continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        let rec;
        try { rec = JSON.parse(line); } catch (e) { unreadable++; continue; }
        const msg = rec.message;
        if (!msg || !msg.usage) continue;
        const model = msg.model || 'unknown';
        if (model === '<synthetic>') continue;
        const u = msg.usage;
        const day = String(rec.timestamp || '').slice(0, 10);
        const counts = ['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !counts.some(k => u[k] !== undefined) || counts.some(k => u[k] !== undefined && (!Number.isFinite(u[k]) || u[k] < 0))) { unreadable++; continue; }
        receipts++;
        if (day < cut) continue;
        byModel[model] = byModel[model] || emptyUsage();
        addUsage(byModel[model], {
          in: u.input_tokens || 0,
          cacheRead: u.cache_read_input_tokens || 0,
          cacheWrite: u.cache_creation_input_tokens || 0,
          out: u.output_tokens || 0,
          messages: 1,
        });
        if (day) activeDays.add(day);
      }
    }
  }
  if (unreadable || !receipts) return { available: false, why: unreadable ? 'selected transcript files contain unreadable usage receipts' : 'selected transcript folders contain no readable usage receipts', byModel: {}, files, activeDays: 0 };
  return { available: true, byModel, files, activeDays: activeDays.size };
}


function meterOpenRouter(days) {
  let text;
  try { text = fs.readFileSync(OPENROUTER_LEDGER, 'utf8'); } catch (e) {
    return { available: false, why: 'no OpenRouter ledger on this machine (' + OPENROUTER_LEDGER + ')' };
  }
  const cut = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  let first = null, last = null, rows = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch (e) { continue; }
    const day = String(r.at || r.timestamp || '').slice(0, 10);
    if (day && day < cut) continue;
    const total = Number(r.usage_total_usd !== undefined ? r.usage_total_usd : r.total_usd);
    if (!isFinite(total)) continue;
    if (first === null) first = total;
    last = total;
    rows++;
  }
  if (first === null) return { available: false, why: 'OpenRouter ledger has no readings inside the window' };
  return { available: true, usd: Math.max(0, last - first), rows };
}


function meterHermes(days) {
  let text;
  try { text = fs.readFileSync(HERMES_LEDGER, 'utf8'); } catch (e) {
    return { available: false, why: 'no Hermes token ledger on this machine (' + HERMES_LEDGER + ')' };
  }
  const cut = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const byModel = {};
  const profiles = new Set();
  const days_ = new Set();
  let split = false;

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch (e) { continue; }
    const day = String(r.date || r.at || '').slice(0, 10);
    if (day && day < cut) continue;
    const inTok = Number(r.in_tokens !== undefined ? r.in_tokens : r.input_tokens) || 0;
    const outTok = Number(r.out_tokens !== undefined ? r.out_tokens : r.output_tokens) || 0;
    const calls = Number(r.calls) || 0;
    if (!inTok && !outTok && !calls) continue;
    profiles.add(r.profile || 'unknown');
    if (day) days_.add(day);

    const models = r.models && typeof r.models === 'object' ? r.models : null;
    const names = models ? Object.keys(models) : [];
    if (names.length > 1) split = true;
    const total = names.reduce((a, n) => a + (Number(models[n]) || 0), 0);
    const shares = names.length && total
      ? names.map((n) => [n, (Number(models[n]) || 0) / total])
      : [[names[0] || 'unknown', 1]];

    for (const [name, share] of shares) {
      byModel[name] = byModel[name] || emptyUsage();
      byModel[name].in += inTok * share;
      byModel[name].out += outTok * share;
      byModel[name].messages += calls * share;
    }
  }

  if (!profiles.size) return { available: false, why: 'Hermes ledger has no rows inside the window' };
  for (const u of Object.values(byModel)) { u.in = Math.round(u.in); u.out = Math.round(u.out); u.messages = Math.round(u.messages); }
  return { available: true, byModel, profiles: [...profiles].sort(), activeDays: days_.size, split };
}

async function build(days, opts) {
  const reg = readRegister(REGISTER);
  const prices = await loadPrices(opts || {});
  const cc = meterClaudeCode(days);
  const or = meterOpenRouter(days);
  const hz = meterHermes(days);
  const claim = {};
  const doubleClaimed = [];
  for (const s of reg.subs) {
    for (const m of s.covers) {
      if (claim[m] && claim[m] !== s.name) doubleClaimed.push({ model: m, subs: [claim[m], s.name] });
      else claim[m] = s.name;
    }
  }

  const rows = [];
  let assumedCacheAnywhere = false;
  const unpriced = [];
  const catchAll = {};
  for (const s of reg.subs) {
    if (s.status === 'cancelled' || s.covers.length) continue;
    if (!catchAll[s.receipts]) catchAll[s.receipts] = s.name;
  }

  for (const s of reg.subs) {
    const row = {
      name: s.name,
      costs: s.costs,
      costUsd: s.costUsd,
      renews: s.renews,
      status: s.status,
      receipts: s.receipts,
      seen: false,
      why: null,
      usage: emptyUsage(),
      valueUsd: 0,
      meteredUsd: null,
      models: [],
    };

    if (s.receipts === 'claude-code') {
      if (!cc.available) { row.why = cc.why; }
      else {
        row.seen = true;
        for (const [model, u] of Object.entries(cc.byModel)) {
          const owner = claim[model];
          if (owner && owner !== s.name) continue;
          if (!owner && catchAll[s.receipts] !== s.name) continue;
          const { price, via } = priceFor(model, prices);
          const m = { model, usage: u, priced: !!price, via };
          if (price) {
            const v = valueOf(u, price);
            m.valueUsd = v.usd;
            row.valueUsd += v.usd;
            if (v.assumedCacheRates) assumedCacheAnywhere = true;
          } else { unpriced.push(model); }
          addUsage(row.usage, u);
          row.models.push(m);
        }
        row.models.sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));
      }
    } else if (s.receipts === 'openrouter') {
      if (!or.available) row.why = or.why;
      else { row.seen = true; row.meteredUsd = or.usd; }
    } else if (s.receipts === 'hermes') {
      if (!hz.available) row.why = hz.why;
      else {
        row.seen = true;
        row.profiles = hz.profiles;
        for (const [model, u] of Object.entries(hz.byModel)) {
          const owner = claim[model];
          if (owner && owner !== s.name) continue;
          if (!owner && catchAll[s.receipts] !== s.name) continue;
          const { price, via } = priceFor(model, prices);
          const mm = { model, usage: u, priced: !!price, via };
          if (price) {
            const v = valueOf(u, price);
            mm.valueUsd = v.usd;
            row.valueUsd += v.usd;
            if (v.assumedCacheRates) assumedCacheAnywhere = true;
          } else { unpriced.push(model); }
          addUsage(row.usage, u);
          row.models.push(mm);
        }
        row.models.sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));
      }
    } else {
      row.why = 'no machine-readable receipts exist for this one, so usage has to be asked';
    }
    rows.push(row);
  }
  const claimedElsewhere = new Set(rows.filter((r) => r.seen).flatMap((r) => r.models.map((m) => m.model)));
  const unclaimed = cc.available ? Object.keys(cc.byModel).filter((m) => !claimedElsewhere.has(m)) : [];

  return { days, register: reg, rows, prices, cc, or, hz, unclaimed, doubleClaimed, assumedCacheAnywhere, unpriced: [...new Set(unpriced)] };
}


function modelWords(id) {
  let s = String(id || '').trim();
  if (!s || s === 'unknown') return '';
  s = s.replace(/^.*\//, '').replace(/\[[^\]]*\]$/, '').replace(/[-_]\d{8}$/, '');
  const out = [];
  for (const p of s.split(/[-_\s]+/).filter(Boolean)) {
    const last = out[out.length - 1];
    if (/^\d+$/.test(p) && last && /^\d+(\.\d+)*$/.test(last)) { out[out.length - 1] = last + '.' + p; continue; }
    if (/^\d/.test(p)) { out.push(p); continue; }
    if (/^(gpt|glm|qwq)$/i.test(p)) { out.push(p.toUpperCase()); continue; }
    out.push(p[0].toUpperCase() + p.slice(1));
  }
  return out.join(' ');
}
const modelPhrase = (id) => (modelWords(id) ? 'the AI model called ' + modelWords(id) : 'an AI model the records do not name');


function nextQuestion(m) {
  if (!m.register.exists) {
    return {
      kind: 'start',
      ask: 'Which AI subscriptions do you pay for right now? Name them and roughly what each costs a month. I will keep the list and check it against what you actually use.',
      why: 'there is no register yet, so nothing can be checked against anything',
    };
  }
  if (!m.register.subs.length) {
    return {
      kind: 'start',
      ask: 'Which AI subscriptions do you pay for right now? Just the names is enough to begin.',
      why: 'the register file exists but lists nothing',
    };
  }
  for (const d of m.doubleClaimed) {
    return {
      kind: 'double-claim',
      ask: 'Two of your subscriptions, ' + d.subs[0] + ' and ' + d.subs[1] + ', are both listed as paying for '
        + modelPhrase(d.model) + '. Which one actually pays for it? Name that one and I will count the '
        + 'model\'s use under it alone. Until you answer, its use is counted under ' + d.subs[0] + ', the one listed first.',
      why: 'a model claimed twice double-counts on the page',
    };
  }
  if (m.unclaimed.length) {
    const model = m.unclaimed[0];
    return {
      kind: 'unclaimed',
      ask: 'Claude Code\'s own usage records show work done with ' + modelPhrase(model) + ' in the last ' + m.days
        + ' days, and no subscription on your list covers that model. What pays for that one? Name the subscription, '
        + 'or say it is paid per use, and I write that into your subscription list. Until then that work is left out '
        + 'of every subscription\'s total.',
      why: 'usage with no subscription behind it is the gap most likely to be a forgotten bill',
    };
  }
  const noCost = m.rows.find((r) => r.status === 'active' && r.costUsd === null);
  if (noCost) return { kind: 'cost', ask: 'What does ' + noCost.name + ' cost you a month?', why: 'without a price its value cannot be compared to anything' };

  const noRenew = m.rows.find((r) => r.status === 'active' && !r.renews);
  if (noRenew) return { kind: 'renews', ask: 'When does ' + noRenew.name + ' renew? Roughly is fine, a day of the month.', why: 'a renewal date is the only warning before a plan you meant to drop takes another month' };

  const blind = m.rows.find((r) => r.status === 'active' && !r.seen && r.receipts === 'none');
  if (blind) {
    return {
      kind: 'usage',
      ask: 'Nothing I can read records how much you use ' + blind.name + ', so I have to ask: roughly how often did '
        + 'you use it this month? Most days, a few times, or not at all is enough. Your answer goes into your '
        + 'subscription list next to it; without one it stays marked as not measured, never as unused.',
      why: 'a subscription nothing can measure is the one most likely to be paid for and unused',
    };
  }

  return null;
}

const fmtUsd = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n) => Number(n).toLocaleString('en-US');

function renderDashboard(m) {
  const L = [];
  const today = new Date().toISOString().slice(0, 10);
  L.push('# What your AI subscriptions are carrying');
  L.push('');
  L.push('_Last ' + m.days + ' days, measured ' + today + ' on **' + os.hostname() + '**. Written by `mc-subs dashboard`; every number below comes from a receipt, none of it is an estimate._');
  L.push('');
  if (m.cc.available) L.push('_Claude Code receipts are written on the machine the work ran on, so this page covers **' + os.hostname() + '** only. Other machines have their own, and they are not in these totals._');
  L.push('');

  const active = m.rows.filter((r) => r.status !== 'cancelled');
  const knownCost = active.filter((r) => r.costUsd !== null).reduce((a, r) => a + r.costUsd, 0);
  const totalValue = active.reduce((a, r) => a + (r.valueUsd || 0), 0);

  L.push('## The short version');
  L.push('');
  L.push('- You pay about **' + fmtUsd(knownCost) + ' a month** across ' + active.length + ' subscription(s) whose price I know.');
  if (totalValue > 0) {
    L.push('- The work that actually ran through them would have cost about **' + fmtUsd(totalValue) + '** if you had bought it per use.');
  }
  const blind = active.filter((r) => !r.seen);
  if (blind.length) L.push('- I cannot see usage for ' + blind.length + ' of them, and they are listed below as unmeasured rather than as zero.');
  L.push('');

  L.push('## One subscription at a time');
  L.push('');
  for (const r of m.rows) {
    L.push('### ' + r.name + (r.status === 'cancelled' ? ' (cancelled)' : ''));
    L.push('');
    L.push('- Costs: ' + (r.costs || '**not answered yet**') + (r.renews ? ' · Renews: ' + r.renews : ''));
    if (!r.seen) {
      L.push('- Usage: **not measured.** ' + (r.why || 'no receipts'));
    } else if (r.meteredUsd !== null) {
      L.push('- Actually billed in the window: **' + fmtUsd(r.meteredUsd) + '** (real money, metered by the provider).');
    } else {
      L.push('- Work carried: ' + fmtNum(r.usage.messages) + ' messages, ' + fmtNum(r.usage.cacheRead + r.usage.in) + ' tokens read, ' + fmtNum(r.usage.out) + ' tokens written.');
      if (r.profiles && r.profiles.length) L.push('- Agents running on it: ' + r.profiles.join(', ') + '.');
      if (r.valueUsd > 0) {
        L.push('- Worth about **' + fmtUsd(r.valueUsd) + '** at per-use prices.');
        if (r.costUsd) {
          const ratio = r.valueUsd / r.costUsd;
          L.push('- That is **' + (ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)) + 'x** what you pay for it.');
        }
      }
      if (r.models.length) {
        L.push('');
        L.push('  | model | messages | tokens read | tokens written | worth |');
        L.push('  | --- | ---: | ---: | ---: | ---: |');
        for (const mm of r.models.slice(0, 8)) {
          L.push('  | ' + mm.model + ' | ' + fmtNum(mm.usage.messages) + ' | ' + fmtNum(mm.usage.cacheRead + mm.usage.in) + ' | ' + fmtNum(mm.usage.out) + ' | ' + (mm.priced ? fmtUsd(mm.valueUsd) : 'UNPRICED') + ' |');
        }
      }
    }
    L.push('');
  }

  const q = nextQuestion(m);
  if (q) {
    L.push('## The one thing I still need from you');
    L.push('');
    L.push('> ' + q.ask);
    L.push('');
    L.push('_Why it matters: ' + q.why + '._');
    L.push('');
  }

  L.push('## How to read this, and what it is not');
  L.push('');
  L.push('**"Worth" is not a bill.** It is what the same work would have cost if you bought it by the token instead of by the month. On a flat plan you did not pay it. It is here because it is the only way to compare a $20 plan you barely touch with a $200 plan carrying most of your work.');
  L.push('');
  L.push('**Nothing here tells you which AI is better.** That changes month to month, and a machine guessing at it would sometimes be confidently wrong. This page reports what you paid and what you used. The choice stays yours.');
  L.push('');
  L.push('Prices from ' + m.prices.source + '.');
  if (m.assumedCacheAnywhere) L.push('Some cache prices were not published, so the documented ratios (read 0.1x, write 1.25x of input) were assumed. Those rows are approximate.');
  if (m.unpriced.length) L.push('No price found for: ' + m.unpriced.join(', ') + '. Their tokens are counted, their value is not.');
  L.push('');
  return L.join('\n');
}

function renderMeter(m) {
  const L = [];
  L.push('Window: last ' + m.days + ' days.  Prices: ' + m.prices.source);
  L.push('Register: ' + m.register.path + (m.register.exists ? '' : '  (MISSING)'));
  if (m.cc.available) L.push('Claude Code receipts: ' + m.cc.files + ' transcript files, ' + m.cc.activeDays + ' active days.');
  else L.push('Claude Code receipts: NOT READ - ' + m.cc.why);
  L.push('');
  for (const r of m.rows) {
    const head = r.name + '  [' + r.status + ']  ' + (r.costs || 'cost unknown');
    L.push(head);
    if (!r.seen) { L.push('    usage: NOT MEASURED - ' + (r.why || 'no receipts')); }
    else if (r.meteredUsd !== null) { L.push('    billed: ' + fmtUsd(r.meteredUsd) + ' (metered)'); }
    else {
      L.push('    carried: ' + fmtNum(r.usage.messages) + ' msgs, ' + fmtNum(r.usage.cacheRead + r.usage.in) + ' in, ' + fmtNum(r.usage.out) + ' out'
        + (r.valueUsd ? '  worth ' + fmtUsd(r.valueUsd) : ''));
      if (r.profiles && r.profiles.length) L.push('    agents: ' + r.profiles.join(', '));
      for (const mm of r.models.slice(0, 6)) {
        L.push('      ' + mm.model.padEnd(28) + (mm.priced ? fmtUsd(mm.valueUsd).padStart(12) : '    UNPRICED'));
      }
    }
    L.push('');
  }
  if (m.unclaimed.length) L.push('Models in your receipts that no subscription claims: ' + m.unclaimed.join(', '));
  if (m.doubleClaimed.length) L.push('Claimed twice: ' + m.doubleClaimed.map((d) => d.model).join(', '));
  const q = nextQuestion(m);
  L.push('');
  L.push(q ? 'NEXT QUESTION: ' + q.ask : 'NEXT QUESTION: none, the register answers everything the receipts raise.');
  return L.join('\n');
}

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

async function main() {
  const cmd = (process.argv[2] || 'meter').replace(/^--/, '');
  const days = Number(arg('days', 30)) || 30;
  const json = process.argv.includes('--json');
  const noNetwork = process.argv.includes('--no-network');
  if(cmd==='set'){
    const name=process.argv[3],field=String(arg('field','')).toLowerCase(),value=arg('value','');
    if(!name||name.length>120||/[\r\n\t]/.test(name)||!['costs','renews','covers','receipts','status','last checked'].includes(field)||typeof value!=='string'||!value.trim()||value.length>500||/[\r\n]/.test(value))throw Error('Set one named plan field and its exact single-line answer');
    const before=fs.existsSync(REGISTER)?fs.readFileSync(REGISTER,'utf8'):'';
    const blocks=before.split(/(?=^##\s+)/m),matches=blocks.map((block,index)=>({block,index,name:block.match(/^##\s+(.+)$/m)?.[1].trim()})).filter(row=>row.name?.toLowerCase()===name.toLowerCase());
    if(matches.length>1)throw Error('Multiple plans have that name; resolve the register first');
    const chosen=matches[0],label=field[0].toUpperCase()+field.slice(1);let found=false;
    let block=chosen?.block||'## '+name+'\n';
    block=block.split('\n').map(line=>line.split(/(\s{2,}|\s+·\s+)/).map(part=>{
      const pair=part.match(/^\s*\*{0,2}([A-Za-z][A-Za-z ]{1,20}?)\*{0,2}\s*:/);
      if(pair&&pair[1].trim().toLowerCase().replace(/^cost$/,'costs')===field){found=true;return label+': '+value.trim();}return part;
    }).join('')).join('\n');
    if(!found)block=block.trimEnd()+'\n'+label+': '+value.trim()+'\n\n';
    if(chosen)blocks[chosen.index]=block;else blocks.push(block);
    const after=blocks.join('');
    if(after!==before){
      fs.mkdirSync(path.dirname(REGISTER),{recursive:true});
      if(before){const digest=require('crypto').createHash('sha256').update(before).digest('hex'),history=path.join(GODSPEED,'profile','subscription-history',digest+'.md');fs.mkdirSync(path.dirname(history),{recursive:true});if(!fs.existsSync(history))fs.writeFileSync(history,before,{flag:'wx'});}
      const temporary=REGISTER+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,after,'utf8');fs.renameSync(temporary,REGISTER);
    }
    process.stdout.write('Saved '+field+' for '+name+'.\n');return 0;
  }

  if (cmd === 'help' || cmd === '-h') {
    process.stdout.write('mc-subs meter [--days N] [--json] [--no-network]\nmc-subs dashboard [--out observations/subscription-reviews/FILE.md]\nmc-subs ask [--json]\nmc-subs register [--json]\nmc-subs set "PLAN" --field costs|renews|covers|receipts|status|"last checked" --value "EXACT ANSWER"\nmc-subs prices [--json] [--no-network]\nReceipt sources are selected in device-private .godspeed/subscription-receipts.json. Unreadable and unpriced plans are never zero.\n');
    return 0;
  }

  if (cmd === 'register') {
    const reg = readRegister(REGISTER);
    if (json) { process.stdout.write(JSON.stringify(reg, null, 2) + '\n'); return 0; }
    if (!reg.exists) { process.stdout.write('No register yet at ' + reg.path + '\n'); return 0; }
    for (const s of reg.subs) {
      process.stdout.write(s.name + '\n');
      process.stdout.write('    costs=' + (s.costs || '?') + '  renews=' + (s.renews || '?') + '  receipts=' + s.receipts + '  status=' + s.status + '\n');
      if (s.covers.length) process.stdout.write('    covers=' + s.covers.join(', ') + '\n');
    }
    return 0;
  }

  if (cmd === 'prices') {
    const p = await loadPrices({ noNetwork });
    if (json) { process.stdout.write(JSON.stringify({ source: p.source, count: Object.keys(p.table).length, overrides: Object.keys(p.overrides) }, null, 2) + '\n'); return 0; }
    process.stdout.write('source: ' + p.source + '\n');
    process.stdout.write('models priced: ' + Object.keys(p.table).length + '\n');
    process.stdout.write('local overrides: ' + (Object.keys(p.overrides).join(', ') || 'none') + '\n');
    return 0;
  }

  const m = await build(days, { noNetwork });
  if (cmd === 'review') {
    process.stdout.write(JSON.stringify({measurement:m,content:renderDashboard(m)})+'\n');
    return 0;
  }

  if (cmd === 'ask') {
    const q = nextQuestion(m);
    if (!q) return 0;
    if (json) { process.stdout.write(JSON.stringify(q, null, 2) + '\n'); return 0; }
    process.stdout.write(q.ask + '\n');
    return 0;
  }

  if (cmd === 'dashboard') {
    const text = renderDashboard(m);
    const supplied = arg('out', null);
    const out = supplied && supplied !== true ? path.resolve(GODSPEED, supplied) : null;
    if(out){
      const allowed=path.join(GODSPEED,'observations','subscription-reviews')+path.sep;
      if(!out.startsWith(allowed)||!out.endsWith('.md'))throw Error('Save the review inside observations/subscription-reviews');
      let cursor=GODSPEED;
      for(const part of path.relative(GODSPEED,out).split(path.sep)){cursor=path.join(cursor,part);if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw Error('Review files must not follow symbolic links');}
    }
    if (out && out !== true) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      if(fs.existsSync(out)){
        const previous=fs.readFileSync(out),digest=require('crypto').createHash('sha256').update(previous).digest('hex');
        const history=path.join(GODSPEED,'observations','subscription-reviews','history',path.basename(out,'.md')+'-'+digest+'.md');
        fs.mkdirSync(path.dirname(history),{recursive:true});if(!fs.existsSync(history))fs.writeFileSync(history,previous,{flag:'wx'});
      }
      const temporary=out+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,text,'utf8');fs.renameSync(temporary,out);
      process.stdout.write(out + '\n');
    } else {
      process.stdout.write(text + '\n');
    }
    return 0;
  }

  if (cmd === 'meter') {
    if (json) {
      process.stdout.write(JSON.stringify({
        days: m.days, prices: m.prices.source, unclaimed: m.unclaimed, unpriced: m.unpriced,
        subscriptions: m.rows.map((r) => ({
          name: r.name, costs: r.costs, costUsd: r.costUsd, renews: r.renews, status: r.status,
          receipts: r.receipts, measured: r.seen, why: r.why, usage: r.usage,
          valueUsd: r.seen && r.receipts !== 'openrouter' && r.models.every(x => x.priced) ? r.valueUsd : null, meteredUsd: r.meteredUsd,
          models: r.models.map((x) => ({ model: x.model, priced: x.priced, valueUsd: x.priced ? x.valueUsd : null, usage: x.usage })),
        })),
        nextQuestion: nextQuestion(m),
      }, null, 2) + '\n');
      return 0;
    }
    process.stdout.write(renderMeter(m) + '\n');
    return 0;
  }

  process.stderr.write('mc-subs: unknown command "' + cmd + '". Try: meter | dashboard | ask | register | prices\n');
  return 2;
}

if (require.main === module) {
  main().then((c) => process.exit(c || 0)).catch((e) => {
    process.stderr.write('mc-subs: ' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(1);
  });
}

module.exports = { readRegister, parseMonthlyUsd, priceFor, valueOf, nextQuestion, modelWords, meterClaudeCode, build, renderDashboard };
