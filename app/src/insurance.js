/* insurance.js — family insurance register: policies per family member, premiums, who pays.
   Policy types follow MoneySense's life / health / general insurance groupings. */
const COMPANY = 'Ong & Kim Family Trust Pte Ltd';
const POLICY_TYPES = [
  { group: 'Life', options: ['Term life', 'Whole life', 'Endowment', 'Investment-linked (ILP)', 'Universal life', 'Annuity / retirement', 'Mortgage reducing term'] },
  { group: 'Health', options: ['MediShield Life', 'Integrated Shield Plan', 'Shield rider', 'Critical illness', 'Early critical illness', 'Hospital cash', 'Disability income', 'CareShield Life / long-term care supplement'] },
  { group: 'Accident', options: ['Personal accident'] },
  { group: 'General', options: ['Travel', 'Home / fire', 'Home contents', 'Motor', 'Maid (FDW)', 'Pet'] },
  { group: 'Business & other', options: ['Keyman / business', 'Other'] }
];
const INSURERS = ['AIA', 'Great Eastern', 'Prudential', 'Income Insurance', 'Manulife', 'Singlife', 'HSBC Life', 'FWD', 'Tokio Marine', 'China Taiping', 'Etiqa', 'Raffles Health Insurance'];
const PREMIUM_FREQ = [{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'half-yearly', label: 'Half-yearly' }, { value: 'annual', label: 'Annual' }, { value: 'single', label: 'Single premium' }];
const FREQ_LABEL = { monthly: 'Monthly', quarterly: 'Quarterly', 'half-yearly': 'Half-yearly', annual: 'Annual', single: 'Single' };

function insPeople(){ return Object.values(DOC.stores.people || {}).sort((a, b) => (a.id || 0) - (b.id || 0)); }
function insPolicies(){ return Object.values(DOC.stores.policies || {}); }
function personNames(){
  const names = insPeople().map(p => p.name);
  insPolicies().forEach(p => { if (p.insured && !names.includes(p.insured)) names.push(p.insured); });
  return names;
}
function policyFields(){
  const people = personNames();
  return [
    { heading: 'Policy' },
    { id: 'i_insured', key: 'insured', label: 'Insured person', type: 'select', options: people, required: true },
    { id: 'i_insurer', key: 'insurer', label: 'Insurance agency / insurer', list: INSURERS, required: true },
    { id: 'i_type', key: 'type', label: 'Policy type', type: 'select', options: POLICY_TYPES, required: true },
    { id: 'i_policyNo', key: 'policyNo', label: 'Policy number' },
    { id: 'i_owner', key: 'owner', label: 'Policy owner', type: 'select', options: people.concat([COMPANY]) },
    { id: 'i_status', key: 'status', label: 'Status', type: 'select', value: 'In force', options: ['In force', 'Lapsed', 'Matured', 'Surrendered', 'Claimed'] },
    { heading: 'Cover & premium' },
    { id: 'i_sum', key: 'sumAssured', label: 'Insured amount (S$)', type: 'number', min: 0 },
    { id: 'i_premium', key: 'premium', label: 'Annual premium (S$)', type: 'number', min: 0, required: true },
    { id: 'i_freq', key: 'freq', label: 'Premium frequency', type: 'select', value: 'annual', options: PREMIUM_FREQ },
    { id: 'i_due', key: 'due', label: 'Payment due date', type: 'date', required: true, hint: 'the next (or any past) due date — later dates roll forward by the frequency' },
    { id: 'i_paidBy', key: 'paidBy', label: 'Payment by', type: 'select', options: people.concat([COMPANY]), required: true },
    { id: 'i_method', key: 'method', label: 'Payment method', type: 'select', options: ['GIRO', 'Credit card', 'Bank transfer', 'Cheque', 'CPF MediSave', 'Cash'] },
    { heading: 'Dates & values' },
    { id: 'i_start', key: 'start', label: 'Policy start date', type: 'date' },
    { id: 'i_maturity', key: 'maturity', label: 'Maturity / expiry date', type: 'date', after: 'i_start' },
    { id: 'i_cashValue', key: 'cashValue', label: 'Cash / surrender value (S$)', type: 'number', min: 0 },
    { id: 'i_beneficiary', key: 'beneficiary', label: 'Beneficiary / nominee' },
    { id: 'i_riders', key: 'riders', label: 'Riders', span: true },
    { heading: 'Agent' },
    { id: 'i_agent', key: 'agent', label: 'Insurance agent name' },
    { id: 'i_agentContact', key: 'agentContact', label: 'Insurance agent number', type: 'tel' },
    { id: 'i_notes', key: 'notes', label: 'Notes', type: 'textarea', span: true }
  ];
}
function _inForce(p){ return !p.status || p.status === 'In force'; }
function _next(p, today){ const d = nextDue(p.due, p.freq, today); return (p.freq === 'single' && d && d < today) ? null : d; }

function renderInsurance(){
  const today = todayISO(), list = insPolicies(), live = list.filter(_inForce);
  const sum = live.reduce((s, p) => s + toNum(p.sumAssured), 0), prem = live.reduce((s, p) => s + (p.freq === 'single' ? 0 : toNum(p.premium)), 0);
  const company = live.filter(p => p.paidBy === COMPANY).reduce((s, p) => s + (p.freq === 'single' ? 0 : toNum(p.premium)), 0);
  const dues = live.map(p => ({ p, d: _next(p, today) })).filter(x => x.d).sort((a, b) => (a.d < b.d ? -1 : 1));
  const incomplete = list.filter(p => p.needsDetails).length;
  document.getElementById('insKpis').innerHTML = kpiHtml([
    { label: 'Policies in force', value: String(live.length), sub: incomplete ? incomplete + ' need details completed' : 'all complete', cls: '' },
    { label: 'Total sum assured', value: fmtSGD(sum), sub: 'policies in force' },
    { label: 'Annual premiums', value: fmtSGD(prem), sub: 'regular premiums' },
    { label: 'Company-paid / year', value: fmtSGD(company), sub: 'expensed under the family mandate' },
    { label: 'Next premium due', value: dues.length ? dues[0].d : '—', sub: dues.length ? dues[0].p.insured + ' · ' + (dues[0].p.insurer || dues[0].p.policyNo || '') : 'no due dates entered' }
  ]);

  // one card per family member
  const names = personNames();
  document.getElementById('insPeople').innerHTML = names.map(n => {
    const mine = live.filter(p => p.insured === n);
    const nd = mine.map(p => _next(p, today)).filter(Boolean).sort()[0];
    return `<div class="person-card"><h3>${esc(n)}</h3><dl class="dl">
      <dt>Policies</dt><dd>${mine.length}</dd>
      <dt>Sum assured</dt><dd>${fmtSGD(mine.reduce((s, p) => s + toNum(p.sumAssured), 0))}</dd>
      <dt>Annual premium</dt><dd>${fmtSGD(mine.reduce((s, p) => s + (p.freq === 'single' ? 0 : toNum(p.premium)), 0))}</dd>
      <dt>Next due</dt><dd>${nd ? esc(nd) : '—'}</dd></dl></div>`;
  }).join('') || '<div class="empty-card">Add a family member to start.</div>';

  // premiums falling due in the next 60 days
  const horizon = addMonths(today, 2);
  const soon = dues.filter(x => x.d <= horizon);
  document.getElementById('insUpcoming').innerHTML = soon.length
    ? '<div class="scroll"><table class="tbl"><thead><tr><th>Due</th><th>Insured</th><th>Policy</th><th>Paid by</th><th class="num">Instalment</th></tr></thead><tbody>'
      + soon.map(x => `<tr><td>${esc(x.d)}</td><td>${esc(x.p.insured)}</td><td>${esc([x.p.type, x.p.insurer, x.p.policyNo].filter(Boolean).join(' · '))}</td><td>${esc(x.p.paidBy || '')}</td><td class="num">${x.p.premium != null && x.p.premium !== '' ? fmtSGD(instalment(x.p.premium, x.p.freq)) : '—'}</td></tr>`).join('')
      + '</tbody></table></div>'
    : '<div class="hint">Nothing due in the next 60 days' + (list.some(p => !p.due) ? ' — some policies have no due date yet.' : '.') + '</div>';

  // all policies
  const rows = [...list].sort((a, b) => String(a.insured).localeCompare(String(b.insured)) || String(a.type).localeCompare(String(b.type)));
  const body = document.getElementById('insBody');
  body.innerHTML = rows.length ? rows.map(p => {
    const nd = _next(p, today);
    return `<tr data-id="${esc(p.id)}"><td>${esc(p.insured)}</td><td>${esc(p.type || '—')}${p.needsDetails ? '<span class="badge warn">Complete details</span>' : ''}</td>
      <td>${esc(p.insurer || '')}</td><td class="mono">${esc(p.policyNo || '')}</td>
      <td class="num">${p.sumAssured != null && p.sumAssured !== '' ? fmtSGD(toNum(p.sumAssured)) : '—'}</td>
      <td class="num">${p.premium != null && p.premium !== '' ? fmtSGD(toNum(p.premium)) : '—'}</td>
      <td>${esc(FREQ_LABEL[p.freq] || '')}</td><td>${esc(nd || '—')}</td><td>${esc(p.paidBy || '')}</td>
      <td>${esc([p.agent, p.agentContact].filter(Boolean).join(' · '))}</td>
      <td><span class="status ${_inForce(p) ? 'ok' : ''}">${esc(p.status || 'In force')}</span></td>
      <td class="row-actions"><button type="button" class="ghost" data-edit>Edit</button> <button type="button" class="danger" data-del>Delete</button></td></tr>`;
  }).join('') : '<tr><td colspan="12" class="empty">No policies yet.</td></tr>';
  body.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.querySelector('[data-edit]').addEventListener('click', () => openPolicyDrawer(DOC.stores.policies[tr.dataset.id]));
    tr.querySelector('[data-del]').addEventListener('click', e => deletePolicy(DOC.stores.policies[tr.dataset.id], e.currentTarget));
  });
}
async function deletePolicy(p, anchor){
  if (!p || !(await askConfirm(anchor, 'Delete ' + [p.type, p.policyNo].filter(Boolean).join(' ') + ' for ' + p.insured + '?'))) return false;
  await sDel('policies', p.id); markDirty(); renderInsurance(); toast('Policy deleted');
}
function openPolicyDrawer(p){
  const defs = policyFields();
  openDrawer({
    title: p ? 'Edit policy' : 'New policy', wide: true, html: fieldsHtml(defs, p || {}),
    saveLabel: p ? 'Save changes' : 'Add policy',
    onDelete: p ? btn => deletePolicy(p, btn) : null,
    onSave: () => {
      const { values, errors } = readFields(defs);
      if (Object.keys(errors).length) return false;
      const rec = Object.assign({}, p || {}, values, { updatedAt: new Date().toISOString() });
      if (!p) rec.createdAt = rec.updatedAt;
      rec.needsDetails = !(rec.type && rec.sumAssured != null && rec.sumAssured !== '' && rec.premium != null && rec.premium !== '');
      sPut('policies', rec); markDirty(); renderInsurance();
      toast(p ? 'Policy updated' : 'Policy added');
    }
  });
}
const PERSON_FIELDS = [
  { id: 'person_name', key: 'name', label: 'Name', required: true },
  { id: 'person_relation', key: 'relation', label: 'Relationship', placeholder: 'e.g. son' },
  { id: 'person_dob', key: 'dob', label: 'Date of birth', type: 'date' }
];
function openPersonDrawer(){
  openDrawer({
    title: 'Add family member', html: fieldsHtml(PERSON_FIELDS, {}), saveLabel: 'Add',
    onSave: () => {
      const { values, errors } = readFields(PERSON_FIELDS);
      if (!errors.person_name && personNames().some(n => n.toLowerCase() === String(values.name).toLowerCase())){ markFieldError('person_name', 'Already listed'); return false; }
      if (Object.keys(errors).length) return false;
      sAdd('people', values); markDirty(); renderInsurance(); toast(values.name + ' added');
    }
  });
}
document.getElementById('newPolicyBtn').addEventListener('click', () => openPolicyDrawer());
document.getElementById('newPersonBtn').addEventListener('click', openPersonDrawer);
