/* property.js — register of properties owned: purchase, loan, MCST, tax, tenancy, agent, yields. */
const PROPERTY_OWNERS_BASE = ['Ong & Kim Family Trust Pte Ltd', 'Ong Ah Whatt', 'Ngiow Lee Kim', 'Joint', 'Other'];
// Owner choices: the company, every family member on the Insurance tab, then Joint / Other.
function propertyOwners(){
  const names = Object.values((DOC && DOC.stores.people) || {}).map(p => p.name).filter(Boolean);
  return [...new Set(['Ong & Kim Family Trust Pte Ltd'].concat(names, ['Ong Ah Whatt', 'Ngiow Lee Kim', 'Joint', 'Other']))];
}
const PROPERTY_OWNERS = PROPERTY_OWNERS_BASE;
const PROP_FIELDS = [
  { heading: 'Property' },
  { id: 'p_name', key: 'name', label: 'Property name', required: true, placeholder: 'e.g. The Sail #32-05' },
  { id: 'p_owner', key: 'owner', label: 'Owner', type: 'select', options: PROPERTY_OWNERS, required: true, hint: 'company, a family member, Joint or Other' },
  { id: 'p_address', key: 'address', label: 'Address', required: true, span: true, placeholder: 'Street, unit, postal code' },
  { id: 'p_price', key: 'purchasePrice', label: 'Purchase price (S$)', type: 'number', gt: 0, hint: 'leave blank if bought in another currency — put it in the notes' },
  { id: 'p_date', key: 'purchaseDate', label: 'Purchase date', type: 'date' },
  { heading: 'Financing & outgoings' },
  { id: 'p_loan', key: 'loan', label: 'Loan outstanding (S$)', type: 'number', min: 0 },
  { id: 'p_instalment', key: 'instalment', label: 'Monthly instalment (S$)', type: 'number', min: 0 },
  { id: 'p_mcst', key: 'mcst', label: 'MCST (S$ per period)', type: 'number', min: 0 },
  { id: 'p_mcstFreq', key: 'mcstFreq', label: 'MCST billed', type: 'select', value: 'quarterly',
    options: [{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'annual', label: 'Annually' }] },
  { id: 'p_tax', key: 'propertyTax', label: 'Property tax (S$ / year)', type: 'number', min: 0 },
  { heading: 'Tenancy' },
  { id: 'p_tenant', key: 'tenant', label: 'Tenant name' },
  { id: 'p_tenantContact', key: 'tenantContact', label: 'Tenant contact number', type: 'tel' },
  { id: 'p_rent', key: 'rent', label: 'Rental per month (S$)', type: 'number', min: 0 },
  { id: 'p_leaseEnd', key: 'leaseEnd', label: 'Lease end date', type: 'date', after: 'p_date' },
  { heading: 'Property agent' },
  { id: 'p_agent', key: 'agent', label: 'Agent name' },
  { id: 'p_agentContact', key: 'agentContact', label: 'Agent contact number', type: 'tel' },
  { id: 'p_notes', key: 'notes', label: 'Notes', type: 'textarea', span: true }
];
function propFields(){ return PROP_FIELDS.map(f => f.id === 'p_owner' ? Object.assign({}, f, { options: propertyOwners() }) : f); }
function _props(){ return Object.values(DOC.stores.properties || {}).sort((a, b) => String(a.name).localeCompare(String(b.name))); }
function _pct(x){ return x == null ? '—' : fmtPct(x); }
function renderProperties(){
  const list = _props(), py = portfolioYields(list);
  const loans = list.reduce((s, p) => s + toNum(p.loan), 0), rentRoll = list.reduce((s, p) => s + toNum(p.rent), 0);
  document.getElementById('propKpis').innerHTML = kpiHtml([
    { label: 'Properties', value: String(list.length), sub: list.filter(p => toNum(p.rent) > 0).length + ' tenanted' },
    { label: 'Purchase value', value: fmtSGD(py.price), sub: 'at cost' },
    { label: 'Loans outstanding', value: fmtSGD(loans), sub: py.price > 0 ? 'LTV ' + fmtPct(loans / py.price) : '' },
    { label: 'Rent roll / month', value: fmtSGD(rentRoll), sub: fmtSGD(rentRoll * 12) + ' a year' },
    { label: 'Portfolio yield', value: _pct(py.gross) + ' gross', sub: _pct(py.net) + ' net of MCST & tax' }
  ]);
  const host = document.getElementById('propGrid');
  if (!list.length){
    host.innerHTML = '<div class="empty-card">No properties yet. <button type="button" class="primary" data-newprop>Add the first property</button></div>';
    host.querySelector('[data-newprop]').addEventListener('click', () => openPropertyDrawer());
    return;
  }
  const row = (k, v) => v === '' || v == null ? '' : `<dt>${k}</dt><dd>${v}</dd>`;
  host.innerHTML = list.map(p => {
    const y = propertyYields(p);
    const mcstLbl = toNum(p.mcst) > 0 ? fmtSGD(toNum(p.mcst)) + ' / ' + ({ monthly: 'month', quarterly: 'quarter', annual: 'year' }[p.mcstFreq] || 'quarter') : '';
    return `<article class="prop-card" data-id="${esc(p.id)}">
      <div><h3>${esc(p.name)}</h3><div class="addr">${esc(p.address)}</div><div class="addr">${esc(p.owner)}</div></div>
      <div class="prop-yields">
        <div><b class="${y.gross != null ? 'pos' : 'muted'}">${_pct(y.gross)}</b><span>Gross yield</span></div>
        <div><b class="${y.net == null ? 'muted' : signClass(y.net)}">${_pct(y.net)}</b><span>Net yield</span></div>
        <div><b>${toNum(p.rent) > 0 ? fmtSGD(toNum(p.rent)) : '—'}</b><span>Rent / month</span></div>
      </div>
      <dl class="dl">
        ${row('Purchase price', toNum(p.purchasePrice) > 0 ? fmtSGD(toNum(p.purchasePrice)) + (p.purchaseDate ? ' · ' + esc(p.purchaseDate) : '') : (p.purchaseDate ? esc(p.purchaseDate) : ''))}
        ${row('Loan', toNum(p.loan) > 0 ? fmtSGD(toNum(p.loan)) + (y.ltv != null ? ' · LTV ' + fmtPct(y.ltv) : '') : '')}
        ${row('Instalment', toNum(p.instalment) > 0 ? fmtSGD(toNum(p.instalment)) + ' / month' : '')}
        ${row('MCST', mcstLbl)}
        ${row('Property tax', toNum(p.propertyTax) > 0 ? fmtSGD(toNum(p.propertyTax)) + ' / year' : '')}
        ${row('Tenant', esc([p.tenant, p.tenantContact].filter(Boolean).join(' · ')))}
        ${row('Lease ends', esc(p.leaseEnd || ''))}
        ${row('Agent', esc([p.agent, p.agentContact].filter(Boolean).join(' · ')))}
      </dl>
      ${p.notes ? `<div class="hint">${esc(p.notes)}</div>` : ''}
      <div class="card-actions"><button type="button" class="ghost" data-edit>Edit</button><button type="button" class="danger" data-del>Delete</button></div>
    </article>`;
  }).join('');
  host.querySelectorAll('.prop-card').forEach(c => {
    const p = DOC.stores.properties[c.dataset.id];
    c.querySelector('[data-edit]').addEventListener('click', () => openPropertyDrawer(p));
    c.querySelector('[data-del]').addEventListener('click', e => deleteProperty(p, e.currentTarget));
  });
}
async function deleteProperty(p, anchor){
  if (!p || !(await askConfirm(anchor, 'Delete ' + p.name + '?'))) return false;
  await sDel('properties', p.id); markDirty(); renderProperties(); toast('Property deleted');
}
function openPropertyDrawer(p){
  openDrawer({
    title: p ? 'Edit property' : 'New property', html: fieldsHtml(propFields(), p || {}),
    saveLabel: p ? 'Save changes' : 'Add property',
    onDelete: p ? btn => deleteProperty(p, btn) : null,
    onSave: () => {
      const { values, errors } = readFields(propFields());
      if (Object.keys(errors).length) return false;
      const rec = Object.assign({}, p || {}, values, { updatedAt: new Date().toISOString() });
      if (!p) rec.createdAt = rec.updatedAt;
      sPut('properties', rec); markDirty(); renderProperties();
      toast(p ? 'Property updated' : 'Property added');
    }
  });
}
document.getElementById('newPropBtn').addEventListener('click', () => openPropertyDrawer());
