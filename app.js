/* =====================================================================
 * app.js — 최유라쇼 편성 스케줄러 UI (htm + React, 무빌드)
 * ===================================================================== */
(function () {
  'use strict';
  const { useState, useEffect, useMemo, useRef } = React;
  const html = htm.bind(React.createElement);
  const store = window.createDataStore();
  const U = store.util;

  /* ---------- 공용 훅 ---------- */
  function useStore() {
    const [, setTick] = useState(0);
    useEffect(() => store.subscribe(() => setTick((t) => t + 1)), []);
    return store.getState();
  }

  /* ---------- 표시 헬퍼 ---------- */
  const fmtDay = (d) => {
    const dnum = Number(d.date.slice(8));
    const m = Number(d.date.slice(5, 7));
    return `${m}/${dnum} (${U.WEEKDAY_KO[d.weekday]})`;
  };
  const teamOf = (state, id) => state.teams.find((t) => t.id === id) || { name: '', color: '#999' };

  // 같은 주(월~일)의 날들을 한 행으로 묶기
  const mondayOf = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    const off = (d.getDay() + 6) % 7; // 월요일=0
    d.setDate(d.getDate() - off);
    return d.toISOString().slice(0, 10);
  };
  // 현재 보고 있는 월(view) + 활성 프로그램 기준 헬퍼
  const monthKey = (v) => `${v.year}-${String(v.month).padStart(2, '0')}`;
  const shiftMonth = (v, delta) => {
    let y = v.year, m = v.month + delta;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return { year: y, month: m };
  };
  // 편성표 노출 범위 = 이번 달 전체 + 다음 달 첫째주(1~7일). (월간 이동이 잦아 다음달 초까지 함께 봄)
  const NEXT_MONTH_PEEK_DAYS = 7;
  const inScheduleView = (dateStr, view) => {
    const ym = dateStr.slice(0, 7);
    if (ym === monthKey(view)) return true;
    if (ym === monthKey(shiftMonth(view, 1)) && Number(dateStr.slice(8, 10)) <= NEXT_MONTH_PEEK_DAYS) return true;
    return false;
  };
  const daysInView = (state) => state.days.filter((d) =>
    d.programId === state.activeProgram && inScheduleView(d.date, state.view));
  const activeProgramObj = (state) =>
    (state.programs || []).find((p) => p.id === state.activeProgram) || { name: '', color: '#da291c' };

  // 프로그램별 입찰팀 / 작성항목 스키마 (window.PROGRAM_CONFIG)
  const PCONF = () => (typeof window !== 'undefined' && window.PROGRAM_CONFIG) || { teams: [], programs: {} };
  const programCfg = (state) => PCONF().programs[state.activeProgram] || null;
  const programTeams = (state) => {
    const pid = state.activeProgram;
    const custom = state.programTeamIds && state.programTeamIds[pid];
    const cfg = programCfg(state);
    const ids = (custom && custom.length) ? custom : (cfg ? cfg.teamIds : state.teams.map((t) => t.id));
    return ids.map((id) => state.teams.find((t) => t.id === id)).filter(Boolean);
  };
  const programSchema = (state) => (programCfg(state) || {}).schema || 'lifestyle';
  // 시간 슬롯 표시: 시간이 있으면 HH:MM~HH:MM, 순번형이면 label
  const slotName = (s) => (s.start && s.end) ? `${s.start}~${s.end}` : (s.label || '슬롯');

  // 최근 3회 달성률: 배열 또는 옛 문자열을 3칸 배열로 정규화 / 표시
  const recent3 = (v) => {
    if (Array.isArray(v)) return [v[0], v[1], v[2]].map((x) => (x == null ? '' : String(x)).replace(/[^\d.]/g, ''));
    if (typeof v === 'string' && v.trim()) { const n = v.split(/[^\d.]+/).filter(Boolean); return [n[0] || '', n[1] || '', n[2] || '']; }
    return ['', '', ''];
  };
  const recentText = (v) => recent3(v).filter(Boolean).map((x) => x + '%').join(' / ');

  function groupByWeek(days) {
    const map = new Map();
    days.forEach((d) => {
      const k = mondayOf(d.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(d);
    });
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, ds]) => [k, ds.sort((a, b) => a.date.localeCompare(b.date))]);
  }

  /* =====================================================================
   *  드래그 페이로드 헬퍼
   * ===================================================================== */
  const drag = {
    start(e, kind, id) {
      e.dataTransfer.setData('application/json', JSON.stringify({ kind, id }));
      e.dataTransfer.effectAllowed = 'move';
    },
    read(e) {
      try { return JSON.parse(e.dataTransfer.getData('application/json')); }
      catch (_) { return null; }
    },
  };

  /* =====================================================================
   *  배지 / 작은 컴포넌트
   * ===================================================================== */
  function TeamDot({ color }) {
    return html`<span class="inline-block w-2.5 h-2.5 rounded-full" style=${{ background: color }}></span>`;
  }

  function Badge({ children, color, title }) {
    return html`<span title=${title} class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
      style=${{ background: (color || '#64748b') + '22', color: color || '#475569' }}>${children}</span>`;
  }

  /* =====================================================================
   *  편성 카드 (PD 편성표 내부, 드래그 가능)
   * ===================================================================== */
  function PlacementCard({ state, p, onEdit }) {
    const team = teamOf(state, p.teamId);
    const [info, setInfo] = useState(false);
    const det = p.detail || {};
    const items = p.items || [];
    return html`
      <div draggable=${true}
        onDragStart=${(e) => drag.start(e, 'placement', p.id)}
        onClick=${() => setInfo(true)} title="클릭하면 입찰 상세 정보"
        class="card-drag group relative rounded-md border bg-white px-2 py-1.5 shadow-sm hover:shadow hover:border-brand transition"
        style=${{ borderLeft: `4px solid ${team.color}` }}>
        <div class="flex items-start justify-between gap-1">
          <div class="min-w-0">
            <div class="text-[13px] font-semibold text-ink leading-tight truncate">${p.productName}</div>
            <div class="mt-0.5 flex flex-wrap items-center gap-1">
              <${Badge} color=${team.color}>${team.name}<//>
              ${items.length > 1 && html`<${Badge} color="#7c3aed" title="동시 노출 착장 수">동시 ${items.length}착장<//>`}
              ${det.isNew && html`<${Badge} color="#0891b2">신상품<//>`}
              ${det.special && html`<${Badge} color="#da291c">특약<//>`}
              ${p.moveCount > 0 && html`<${Badge} color="#da291c" title="편성 이동 횟수">↔ ${p.moveCount}회<//>`}
              ${p.durationMin && html`<${Badge}>${p.durationMin}분<//>`}
            </div>
            ${(p.pd || p.host || p.studio) && html`
              <div class="mt-1 text-[11px] text-ink-soft leading-tight">
                ${p.pd && html`<span>PD ${p.pd}</span>`}
                ${p.host && html`<span class="ml-1.5">MC ${p.host}</span>`}
                ${p.studio && html`<span class="ml-1.5">ST ${p.studio}</span>`}
              </div>`}
          </div>
          <div class="flex flex-col items-center gap-1 opacity-0 group-hover:opacity-100 transition">
            <button title="배정 편집" onClick=${(e) => { e.stopPropagation(); onEdit(p); }}
              class="text-ink-soft hover:text-brand text-xs leading-none p-0.5">✎</button>
            <button title="편성 제외" onClick=${(e) => { e.stopPropagation(); store.removePlacement(p.id); }}
              class="text-ink-soft hover:text-brand text-xs leading-none p-0.5">✕</button>
          </div>
        </div>
        ${info && html`<${PlacementDetailModal} state=${state} p=${p} onClose=${(e) => { e && e.stopPropagation && e.stopPropagation(); setInfo(false); }} />`}
      </div>`;
  }

  /* =====================================================================
   *  편성 상세 팝업 (입찰보드에 입력한 정보)
   * ===================================================================== */
  function PlacementDetailModal({ state, p, onClose }) {
    const t = teamOf(state, p.teamId);
    const det = p.detail || {};
    const items = p.items || [];
    // 이 팝업은 PD·관리자 전용 편성표(ScheduleView)에서만 뜨므로 수정 허용
    const [edit, setEdit] = useState(false);
    if (edit) return html`<${PlacementEditForm} state=${state} p=${p} onClose=${onClose} onBack=${() => setEdit(false)} />`;
    const rows = [
      ['편성 시간', U.slotLabel(p.slotId)],
      ['그룹코드', det.groupCode],
      ['내용 / 타이틀', det.note],
      ['이슈 / 특이사항', det.issue],
      ['구성', det.comp],
      ['준비물량', det.prep],
      ['가격', det.price],
      ['마진', det.margin],
      ['최근 달성률', recentText(det.recent)],
      ['방송 분량', p.durationMin ? p.durationMin + '분' : ''],
      ['배정', [p.pd && 'PD ' + p.pd, p.host && 'MC ' + p.host, p.studio && 'ST ' + p.studio].filter(Boolean).join(' / ')],
      ['비고(PD)', p.memo],
      ['마지막 수정', p.editedBy ? `${p.editedBy}${p.editedAt ? ' · ' + fmtTs(p.editedAt) : ''}` : ''],
    ].filter((r) => r[1]);
    return html`
      <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
        onClick=${(e) => { e.stopPropagation(); onClose(); }}>
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick=${(e) => e.stopPropagation()}>
          <div class="px-4 py-3 border-b border-slate-200 flex items-start justify-between"
            style=${{ borderTop: `4px solid ${t.color}` }}>
            <div>
              <div class="text-base font-bold text-ink">${p.productName}</div>
              <div class="mt-1 flex flex-wrap gap-1">
                <${Badge} color=${t.color}>${t.name}<//>
                ${items.length > 1 && html`<${Badge} color="#7c3aed">동시 ${items.length}착장<//>`}
                ${det.isNew && html`<${Badge} color="#0891b2">신상품<//>`}
                ${det.sme && html`<${Badge} color="#16a34a">중소기업<//>`}
                ${det.special && html`<${Badge} color="#da291c">특약<//>`}
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button onClick=${(e) => { e.stopPropagation(); setEdit(true); }}
                class="text-[12px] font-semibold px-2.5 py-1 rounded-md bg-brand text-white hover:bg-brand-dark">✎ 수정</button>
              <button onClick=${(e) => { e.stopPropagation(); onClose(); }} class="text-ink-soft hover:text-brand text-lg leading-none">✕</button>
            </div>
          </div>
          <div class="px-4 py-3">
            ${items.length > 1 && html`
              <div class="mb-3">
                <div class="text-[12px] font-semibold text-violet-700 mb-1">동시 노출 착장 ${items.length}개</div>
                <ol class="list-decimal list-inside space-y-0.5 text-[13px] text-ink bg-violet-50 rounded-md p-2">
                  ${items.map((it, i) => html`<li key=${i}>${it}</li>`)}
                </ol>
              </div>`}
            <table class="w-full text-[13px]"><tbody>
              ${rows.map(([k, v]) => html`
                <tr key=${k} class="border-b border-slate-100 last:border-0">
                  <td class="py-1.5 pr-3 text-ink-soft whitespace-nowrap align-top w-24">${k}</td>
                  <td class="py-1.5 text-ink whitespace-pre-line">${v}</td>
                </tr>`)}
              ${rows.length === 0 && items.length === 0 && html`<tr><td class="py-3 text-slate-400 text-center">입력된 상세 정보가 없습니다.</td></tr>`}
            </tbody></table>
          </div>
        </div>
      </div>`;
  }

  /* =====================================================================
   *  편성 상세 통합 수정 (PD 편성표 · 상품/구성/배정 직접수정 → 최종편성안·입찰정보 동기화)
   * ===================================================================== */
  function PlacementEditForm({ state, p, onClose, onBack }) {
    const teams = programTeams(state);
    const det = p.detail || {};
    const castOpts = (window.AUTH.casting && window.AUTH.casting[p.programId]) || null;
    const [name, setName] = useState(p.productName || '');
    const [team, setTeam] = useState(p.teamId || (teams[0] && teams[0].id) || 'etc');
    const [dur, setDur] = useState(p.durationMin || '');
    const [note, setNote] = useState(det.note || '');
    const [issue, setIssue] = useState(det.issue || '');
    const [comp, setComp] = useState(det.comp || '');
    const [prep, setPrep] = useState(det.prep || '');
    const [price, setPrice] = useState(det.price || '');
    const [margin, setMargin] = useState(det.margin || '');
    const [pd, setPd] = useState(p.pd || '');
    const [host, setHost] = useState(p.host || '');
    const [studio, setStudio] = useState(p.studio || '');
    const [memo, setMemo] = useState(p.memo || '');
    function save() {
      if (!name.trim()) { alert('상품명을 입력하세요.'); return; }
      store.updatePlacementFull(p.id, {
        productName: name.trim(), teamId: team,
        durationMin: dur ? parseInt(dur, 10) : null,
        pd, host, studio, memo,
        detail: { note, issue, comp, prep, price, margin },
      });
      onClose();
    }
    const cast = (field, val, setVal, ph) => html`
      <input value=${val} onInput=${(e) => setVal(e.target.value)} list=${castOpts && castOpts[field] ? 'pe-' + field + '-dl' : undefined} class=${inputCls} placeholder=${ph} />
      ${castOpts && castOpts[field] ? html`<datalist id=${'pe-' + field + '-dl'}>${castOpts[field].map((o) => html`<option key=${o} value=${o}></option>`)}</datalist>` : ''}`;
    return html`
      <${Modal} title=${`상세 수정 · ${p.productName}`} onClose=${onBack} onSave=${save}>
        <div class="text-[12px] text-ink-soft -mt-1">여기서 수정하면 <b>최종편성안</b>과 <b>입찰정보</b>에도 함께 반영됩니다.</div>
        <${Field} label="상품명 *"><input value=${name} onInput=${(e) => setName(e.target.value)} class=${inputCls} autofocus /><//>
        <div class="grid grid-cols-2 gap-3">
          <${Field} label="팀명">
            <select value=${team} onChange=${(e) => setTeam(e.target.value)} class=${inputCls}>
              ${teams.map((t) => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
            </select>
          <//>
          <${Field} label="방송 분량(분)"><input type="number" value=${dur} onInput=${(e) => setDur(e.target.value)} class=${inputCls} placeholder="예: 30" /><//>
        </div>
        <${Field} label="내용 / 타이틀"><input value=${note} onInput=${(e) => setNote(e.target.value)} class=${inputCls} /><//>
        <${Field} label="이슈 / 특이사항"><input value=${issue} onInput=${(e) => setIssue(e.target.value)} class=${inputCls} /><//>
        <div class="grid grid-cols-2 gap-3">
          <${Field} label="구성"><input value=${comp} onInput=${(e) => setComp(e.target.value)} class=${inputCls} /><//>
          <${Field} label="준비물량"><input value=${prep} onInput=${(e) => setPrep(e.target.value)} class=${inputCls} /><//>
          <${Field} label="가격"><input value=${price} onInput=${(e) => setPrice(e.target.value)} class=${inputCls} /><//>
          <${Field} label="마진"><input value=${margin} onInput=${(e) => setMargin(e.target.value)} class=${inputCls} /><//>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <${Field} label="담당 PD">${cast('pd', pd, setPd, 'PD')}<//>
          <${Field} label="쇼호스트">${cast('host', host, setHost, 'MC')}<//>
          <${Field} label="스튜디오">${cast('studio', studio, setStudio, 'ST')}<//>
        </div>
        <${Field} label="비고(PD)"><input value=${memo} onInput=${(e) => setMemo(e.target.value)} class=${inputCls} placeholder="PD 코멘트" /><//>
      <//>`;
  }

  /* =====================================================================
   *  슬롯 시간 인라인 수정 (클릭 → 시간/순번 직접 조정)
   * ===================================================================== */
  function SlotTimeButton({ slot, className }) {
    const [open, setOpen] = useState(false);
    return html`
      <button onClick=${(e) => { e.stopPropagation(); setOpen(true); }}
        title="클릭해 시간 수정" class=${`${className || ''} hover:text-brand hover:underline decoration-dotted`}>${slotName(slot)}</button>
      ${open && html`<${EditSlotTimeModal} slot=${slot} onClose=${() => setOpen(false)} />`}`;
  }
  function EditSlotTimeModal({ slot, onClose }) {
    const isOrder = !!(slot.label && !slot.start);
    const [s, setS] = useState(slot.start || '20:45');
    const [e, setE] = useState(slot.end || '21:45');
    const [label, setLabel] = useState(slot.label || '');
    const [mode, setMode] = useState(isOrder ? 'order' : 'time');
    const dur = (mode === 'time' && s && e) ? (U.toMin(e) - U.toMin(s) + 1440) % 1440 : 0;
    function save() {
      if (mode === 'time') {
        if (!/^\d{1,2}:\d{2}$/.test(s) || !/^\d{1,2}:\d{2}$/.test(e)) { alert('시작/종료 시간을 입력하세요.'); return; }
        if (dur <= 0) { alert('종료가 시작보다 늦어야 합니다.'); return; }
        store.updateSlotTime(slot.id, { start: s, end: e });
      } else {
        if (!label.trim()) { alert('순번명을 입력하세요.'); return; }
        store.updateSlotLabel(slot.id, label.trim());
      }
      onClose();
    }
    return html`
      <${Modal} title="시간대 수정" onClose=${onClose} onSave=${save}>
        <div class="flex gap-1.5 mb-1">
          <button type="button" onClick=${() => setMode('time')}
            class=${`text-xs px-2.5 py-1 rounded-full border ${mode === 'time' ? 'bg-brand text-white border-transparent' : 'border-slate-300 text-ink-soft'}`}>시간 (HH:MM)</button>
          <button type="button" onClick=${() => setMode('order')}
            class=${`text-xs px-2.5 py-1 rounded-full border ${mode === 'order' ? 'bg-brand text-white border-transparent' : 'border-slate-300 text-ink-soft'}`}>순번 (N부)</button>
        </div>
        ${mode === 'time'
          ? html`<${Field} label=${`방송 시간 (24시간) — ${dur}분`}>
              <div class="flex items-center gap-1.5">
                <${TimeInput} value=${s} onChange=${setS} />
                <span class="text-ink-soft">~</span>
                <${TimeInput} value=${e} onChange=${setE} />
              </div>
              <div class="text-[11px] text-ink-soft mt-1">24시간제 (예: 20:45~21:05 = 20분)</div>
            <//>`
          : html`<${Field} label="순번명"><input value=${label} onInput=${(ev) => setLabel(ev.target.value)} class=${inputCls} placeholder="예: 1부" /><//>`}
      <//>`;
  }

  /* =====================================================================
   *  슬롯 셀 (드롭 타깃)
   * ===================================================================== */
  function SlotCell({ state, day, slot, onEdit }) {
    const [over, setOver] = useState(false);
    const [splitOpen, setSplitOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const dur = U.slotDuration(slot);
    const placements = state.placements.filter((p) => p.slotId === slot.id);
    const teamsIn = new Set(placements.map((p) => p.teamId));
    // 경쟁: 같은 시간대에 2팀 이상 → 노란불, 3팀+ → 빨간불
    const compete = teamsIn.size;
    const compColor = compete >= 3 ? '#dc2626' : compete === 2 ? '#f59e0b' : null;

    function onDrop(e) {
      e.preventDefault(); e.stopPropagation(); setOver(false); // 슬롯에 놓으면 여기서 처리(날짜 드롭존과 분리)
      const pl = drag.read(e);
      if (!pl) return;
      if (pl.kind === 'bid') store.assignBid(pl.id, slot.id);
      else if (pl.kind === 'placement') store.movePlacement(pl.id, slot.id);
    }

    return html`
      <div class=${`flex flex-col rounded-lg border bg-slate-50/60 ${over ? 'drop-active' : ''}`}
        style=${compColor && !over ? { borderColor: compColor, boxShadow: `0 0 0 1px ${compColor}` } : (over ? {} : { borderColor: '#e2e8f0' })}
        onDragOver=${(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave=${() => setOver(false)}
        onDrop=${onDrop}>
        <div class="flex items-center justify-between gap-1 px-2 py-1 border-b border-slate-200 bg-white rounded-t-lg">
          <div class="flex items-center gap-x-1.5 gap-y-0.5 flex-wrap min-w-0">
            <${SlotTimeButton} slot=${slot} className="text-[13px] font-bold text-ink tabular-nums whitespace-nowrap" />
            ${slot.start && slot.end && html`<span class="text-[11px] text-ink-soft whitespace-nowrap">${dur}분</span>`}
            ${compColor && html`<span class="inline-flex items-center gap-1 text-[11px] font-bold px-1.5 rounded whitespace-nowrap" style=${{ background: compColor + '22', color: compColor }}>
              <span class="w-1.5 h-1.5 rounded-full shrink-0" style=${{ background: compColor }}></span>경쟁 ${compete}팀</span>`}
          </div>
          <div class="flex items-center gap-1 shrink-0 text-ink-soft">
            ${slot.start && slot.end && html`<button title="시간 분할" onClick=${() => setSplitOpen(true)} class="hover:text-brand text-xs px-1">⊟</button>`}
            <button title="시간대 삭제" onClick=${() => confirm('이 시간대를 삭제할까요? 편성도 함께 삭제됩니다.') && store.removeSlot(slot.id)}
              class="hover:text-brand text-xs px-1">✕</button>
          </div>
        </div>
        <div class=${`flex flex-col gap-1.5 p-1.5 min-h-[52px] ${placements.length === 0 ? 'cursor-copy' : ''}`}
          onDoubleClick=${placements.length === 0 ? (() => setAddOpen(true)) : undefined} title=${placements.length === 0 ? '더블클릭하면 상품 추가' : ''}>
          ${placements.length === 0
            ? html`<div class="text-[11px] text-slate-400 text-center py-2 select-none hover:text-brand">입찰 카드를 끌어다 놓거나 더블클릭해 추가</div>`
            : placements.map((p) => html`<${PlacementCard} key=${p.id} state=${state} p=${p} onEdit=${onEdit} />`)}
        </div>
        ${splitOpen && html`<${SplitModal} slot=${slot} dur=${dur} onClose=${() => setSplitOpen(false)} />`}
        ${addOpen && html`<${SlotAddModal} state=${state} slot=${slot} onClose=${() => setAddOpen(false)} />`}
      </div>`;
  }

  // 슬롯에 상품 직접 추가 (빈 슬롯 더블클릭) — 상품명/팀명/노출분만
  function SlotAddModal({ state, slot, onClose }) {
    const teams = programTeams(state);
    const [name, setName] = useState('');
    const [dur, setDur] = useState('');
    const [team, setTeam] = useState(teams[0] ? teams[0].id : 'etc');
    function save() {
      if (!name.trim()) { alert('상품명을 입력하세요.'); return; }
      store.addPlacement(slot.id, { productName: name.trim(), teamId: team, durationMin: dur ? parseInt(dur, 10) : null });
      onClose();
    }
    return html`
      <${Modal} title=${`${slotName(slot)} · 상품 추가`} onClose=${onClose} onSave=${save}>
        <${Field} label="상품명 *"><input value=${name} onInput=${(e) => setName(e.target.value)} class=${inputCls} autofocus placeholder="예: 롯데호텔김치" /><//>
        <div class="grid grid-cols-2 gap-3">
          <${Field} label="팀명">
            <select value=${team} onChange=${(e) => setTeam(e.target.value)} class=${inputCls}>
              ${teams.map((t) => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
            </select>
          <//>
          <${Field} label="노출분"><input type="number" value=${dur} onInput=${(e) => setDur(e.target.value)} class=${inputCls} placeholder="예: 20" /><//>
        </div>
        <div class="text-[12px] text-ink-soft">이 시간대(${slotName(slot)})에 바로 편성됩니다. 구성·가격 등은 최종편성안에서 보강하세요.</div>
      <//>`;
  }

  function SplitModal({ slot, dur, onClose }) {
    const [m, setM] = useState(Math.floor(dur / 2));
    const first = Math.max(0, Math.min(dur, parseInt(m, 10) || 0));
    function save() {
      if (first <= 0 || first >= dur) { alert(`1~${dur - 1} 사이의 분을 입력하세요.`); return; }
      store.splitSlot(slot.id, first); onClose();
    }
    return html`
      <${Modal} title=${`시간 분할 · ${slot.start}~${slot.end} (${dur}분)`} onClose=${onClose} onSave=${save}>
        <${Field} label="앞 구간 분(分)">
          <input type="number" min="1" max=${dur - 1} value=${m} onInput=${(e) => setM(e.target.value)} class=${inputCls} />
        <//>
        <div class="text-[12px] text-ink-soft">
          ${slot.start} ~ <b>${U.toHHMM(U.toMin(slot.start) + first)}</b> (${first}분) /
          <b>${U.toHHMM(U.toMin(slot.start) + first)}</b> ~ ${slot.end} (${dur - first}분) 로 나눕니다.
        </div>
      <//>`;
  }

  /* =====================================================================
   *  요일 블록
   * ===================================================================== */
  // 방송 시간(패션: 날짜 옆 표기·수정) — 자유 입력
  function AirTimeButton({ day, dark }) {
    const [open, setOpen] = useState(false);
    const [v, setV] = useState(day.airTime || '');
    useEffect(() => setV(day.airTime || ''), [day.airTime]);
    function save() { store.setDayAirTime(day.id, v); setOpen(false); }
    return html`
      <button onClick=${() => setOpen(true)}
        class=${`text-[12px] font-bold tabular-nums px-1.5 py-0.5 rounded ${dark ? 'bg-white/25 hover:bg-white/40 text-white' : 'bg-slate-200 hover:bg-slate-300 text-ink'}`}
        title="방송 시간 (클릭해 수정)">${day.airTime || '+ 방송시간'}</button>
      ${open && html`<${Modal} title=${`${fmtDay(day)} · 방송 시간`} onClose=${() => setOpen(false)} onSave=${save}>
        <${Field} label="방송 시간 (자유 입력)"><input value=${v} onInput=${(e) => setV(e.target.value)} class=${inputCls} placeholder="예: 22:30~01:00" autofocus /><//>
      <//>`}`;
  }

  function DayBlock({ state, day, onEdit }) {
    const isThu = day.weekday === 4, isSat = day.weekday === 6;
    const accent = isThu ? '#da291c' : isSat ? '#2563eb' : '#7c3aed';
    const fashion = programSchema(state) === 'fashion';
    const [addOpen, setAddOpen] = useState(false);
    const [quickOpen, setQuickOpen] = useState(false);
    const [dayOver, setDayOver] = useState(false);
    const [moveTimeFor, setMoveTimeFor] = useState(null); // 같은날짜 시간대 이동 팝업(라이프스타일)
    const [bidTimeFor, setBidTimeFor] = useState(null);   // 입찰카드 편성 시간 지정 팝업(라이프스타일)
    const nextPart = () => {
      const nums = day.slots.filter((s) => s.label).map((s) => { const m = (s.label || '').match(/(\d+)\s*부/); return m ? parseInt(m[1], 10) : 0; });
      return `${Math.max(0, ...nums) + 1}부`;
    };
    // 슬롯이 아닌 날짜 영역에 카드를 놓으면:
    //  · 입찰카드(취소 후 풀 복귀 등) → 패션은 부 자동생성 후 편성 / 라이프스타일은 시간 지정 팝업
    //  · 편성카드 다른 날짜 → 시간대(또는 부) 자동생성 후 이동
    //  · 편성카드 같은 날짜 → 패션은 다음 부 자동생성 / 라이프스타일은 시간 설정 팝업
    function onDayDrop(e) {
      e.preventDefault(); setDayOver(false);
      const pl = drag.read(e);
      if (!pl) return;
      if (pl.kind === 'bid') {
        if (fashion) store.assignBidToDay(pl.id, day.id, { part: nextPart() });
        else setBidTimeFor(pl.id);
        return;
      }
      if (pl.kind !== 'placement') return;
      const p = state.placements.find((x) => x.id === pl.id);
      const curDay = p && state.days.find((d) => d.slots.some((s) => s.id === p.slotId));
      const sameDay = curDay && curDay.id === day.id;
      if (!sameDay) { store.movePlacementToDay(pl.id, day.id); return; }
      if (fashion) store.movePlacementToSlotSpec(pl.id, day.id, { part: nextPart() });
      else setMoveTimeFor(pl.id);
    }
    return html`
      <div class=${`rounded-xl border bg-white shadow-sm overflow-hidden ${dayOver ? 'ring-2 ring-brand' : 'border-slate-200'}`}
        onDragOver=${(e) => { e.preventDefault(); setDayOver(true); }}
        onDragLeave=${(e) => { if (e.currentTarget === e.target) setDayOver(false); }}
        onDrop=${onDayDrop}>
        <div class="flex items-center justify-between px-3 py-2 text-white" style=${{ background: accent }}>
          <div class="flex items-center gap-2">
            <div class="font-bold text-sm">${fmtDay(day)}</div>
            ${fashion && html`<${AirTimeButton} day=${day} dark=${true} />`}
          </div>
          <div class="flex items-center gap-2 text-[11px]">
            <button onClick=${() => setQuickOpen(true)} class="font-semibold bg-white/20 hover:bg-white/30 px-1.5 py-0.5 rounded">+ 상품</button>
            <button onClick=${() => setAddOpen(true)} class="hover:underline">+ 시간대</button>
            <button onClick=${() => store.addSlot(day.id, { order: true })} class="hover:underline">+ 순번</button>
            <button onClick=${() => confirm(`${fmtDay(day)} 편성일을 삭제할까요?`) && store.removeDay(day.id)}
              class="hover:underline opacity-80">삭제</button>
          </div>
        </div>
        <div class="p-2 grid gap-2" style=${{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          ${day.slots.length === 0
            ? html`<div class="text-[12px] text-slate-400 py-3 text-center col-span-full">시간대가 없습니다. “+ 상품” 또는 “+ 시간대”로 추가하세요.</div>`
            : day.slots.map((s) => html`<${SlotCell} key=${s.id} state=${state} day=${day} slot=${s} onEdit=${onEdit} />`)}
        </div>
        ${addOpen && html`<${AddSlotModal} day=${day} onClose=${() => setAddOpen(false)} />`}
        ${quickOpen && html`<${QuickAddModal} state=${state} day=${day} onClose=${() => setQuickOpen(false)} />`}
        ${moveTimeFor && html`<${MoveTimeModal} state=${state} day=${day} placementId=${moveTimeFor} onClose=${() => setMoveTimeFor(null)} />`}
        ${bidTimeFor && html`<${BidTimeModal} state=${state} day=${day} bidId=${bidTimeFor} onClose=${() => setBidTimeFor(null)} />`}
      </div>`;
  }

  // 입찰카드를 라이프스타일 날짜 영역에 놓았을 때 — 편성 시간 지정 팝업
  function BidTimeModal({ state, day, bidId, onClose }) {
    const b = state.bids.find((x) => x.id === bidId);
    const [start, setStart] = useState('');
    const dur = b && b.product && b.product.durationMin ? b.product.durationMin : '';
    function save() {
      if (!/^\d{1,2}:\d{2}$/.test(start)) { alert('시작 시간을 24시간 형식(예: 21:00)으로 입력하세요.'); return; }
      store.assignBidToDay(bidId, day.id, { start, durationMin: dur || null });
      onClose();
    }
    return html`
      <${Modal} title=${`${fmtDay(day)} · 편성 시간 지정${b && b.product ? ' · ' + b.product.name : ''}`} onClose=${onClose} onSave=${save}>
        <${Field} label="편성할 시작 시간 (24시간)"><${TimeInput} value=${start} onChange=${setStart} /><//>
        <div class="text-[12px] text-ink-soft">${dur ? `노출분 ${dur}분 → 시작~시작+${dur}분 시간대로 생성되어 편성됩니다.` : '입력한 시각으로 새 시간대가 생성되어 편성됩니다.'}</div>
      <//>`;
  }

  // 같은 날짜 안에서 다른 시간대로 이동 (라이프스타일) — 시간 설정 팝업
  function MoveTimeModal({ state, day, placementId, onClose }) {
    const p = state.placements.find((x) => x.id === placementId);
    const [start, setStart] = useState('');
    const dur = p && p.durationMin ? p.durationMin : '';
    function save() {
      if (!/^\d{1,2}:\d{2}$/.test(start)) { alert('시작 시간을 24시간 형식(예: 21:00)으로 입력하세요.'); return; }
      store.movePlacementToSlotSpec(placementId, day.id, { start, durationMin: dur || null });
      onClose();
    }
    return html`
      <${Modal} title=${`${fmtDay(day)} · 시간대 이동${p ? ' · ' + p.productName : ''}`} onClose=${onClose} onSave=${save}>
        <${Field} label="이동할 시작 시간 (24시간)"><${TimeInput} value=${start} onChange=${setStart} /><//>
        <div class="text-[12px] text-ink-soft">${dur ? `노출분 ${dur}분 → 시작~시작+${dur}분 시간대로 생성됩니다.` : '입력한 시각으로 새 시간대가 생성되어 이동합니다.'}</div>
      <//>`;
  }

  // 수기 상품 추가 — 날짜가 시간대형이면 시간 입력, 순번(1·2·3부)형이면 부 입력
  function QuickAddModal({ state, day, onClose }) {
    const teams = programTeams(state);
    // 순번형: 패션 프로그램이거나, 이 날짜에 순번 슬롯(1부 등)이 있으면
    const orderMode = programSchema(state) === 'fashion' || day.slots.some((s) => s.label && !s.start);
    const [name, setName] = useState('');
    const [dur, setDur] = useState('');
    const [start, setStart] = useState('');
    const [part, setPart] = useState('1부');
    const [team, setTeam] = useState(teams[0] ? teams[0].id : 'etc');
    function save() {
      if (!name.trim()) { alert('상품명을 입력하세요.'); return; }
      if (orderMode) {
        if (!part.trim()) { alert('부(순번)를 입력하세요. 예: 1부'); return; }
        store.addQuickPlacement({ dayId: day.id, part: part.trim(), durationMin: dur ? parseInt(dur, 10) : null, productName: name.trim(), teamId: team });
      } else {
        if (!/^\d{1,2}:\d{2}$/.test(start)) { alert('시간을 24시간 형식(예: 21:00)으로 입력하세요.'); return; }
        store.addQuickPlacement({ dayId: day.id, start, durationMin: dur ? parseInt(dur, 10) : null, productName: name.trim(), teamId: team });
      }
      onClose();
    }
    return html`
      <${Modal} title=${`${fmtDay(day)} · 상품 수기 추가`} onClose=${onClose} onSave=${save}>
        <${Field} label="상품명 *">
          <input value=${name} onInput=${(e) => setName(e.target.value)} class=${inputCls} autofocus placeholder="예: 롯데호텔김치" />
        <//>
        <div class="grid grid-cols-2 gap-3">
          ${orderMode
            ? html`<${Field} label="부(순번) *"><input value=${part} onInput=${(e) => setPart(e.target.value)} class=${inputCls} placeholder="예: 1부 / 2부 / 3부" list="part-list" />
                <datalist id="part-list"><option value="1부"/><option value="2부"/><option value="3부"/></datalist><//>`
            : html`<${Field} label="시작 시간 (24시간) *"><${TimeInput} value=${start} onChange=${setStart} /><//>`}
          <${Field} label="노출분"><input type="number" value=${dur} onInput=${(e) => setDur(e.target.value)} class=${inputCls} placeholder="예: 20" /><//>
        </div>
        <${Field} label="팀명">
          <select value=${team} onChange=${(e) => setTeam(e.target.value)} class=${inputCls}>
            ${teams.map((t) => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
          </select>
        <//>
        <div class="text-[12px] text-ink-soft">${orderMode ? '부(1부·2부·3부)에 편성됩니다. 방송시간은 날짜 옆에서 수정하세요.' : '시간을 입력하면 해당 시간대(시작~시작+노출분)로 자동 반영됩니다.'} 구성·가격 등은 최종편성안에서 보강하세요.</div>
      <//>`;
  }

  function AddSlotModal({ day, onClose }) {
    const [start, setStart] = useState('20:45');
    const [end, setEnd] = useState('21:45');
    function save() {
      if (!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) { alert('시간 형식 HH:MM 으로 입력하세요.'); return; }
      store.addSlot(day.id, { start: start.trim(), end: end.trim() }); onClose();
    }
    return html`
      <${Modal} title=${`${fmtDay(day)} · 시간대 추가`} onClose=${onClose} onSave=${save}>
        <div class="grid grid-cols-2 gap-3">
          <${Field} label="시작 시간 (24시간)"><${TimeInput} value=${start} onChange=${setStart} /><//>
          <${Field} label="종료 시간 (24시간)"><${TimeInput} value=${end} onChange=${setEnd} /><//>
        </div>
        <div class="text-[12px] text-ink-soft">24시간제로 입력하세요 (예: 20:45). 특별편성 등으로 앞뒤 시간대를 추가할 수 있습니다.</div>
      <//>`;
  }

  /* =====================================================================
   *  입찰 풀 (PD 편성표 좌측 사이드바)
   * ===================================================================== */
  function BidPool({ state }) {
    const [team, setTeam] = useState('all');
    const [q, setQ] = useState('');
    const [detail, setDetail] = useState(null);
    const [over, setOver] = useState(false);
    const placedBidIds = new Set(state.placements.map((p) => p.sourceBidId).filter(Boolean));
    // 미편성 입찰 풀 = 지난달 + 이번달 (편성이 월간 이동이 잦아 두 달치 함께 봄)
    const prevKey = monthKey(shiftMonth(state.view, -1));
    const curKey = monthKey(state.view);
    const poolDayIds = new Set(state.days
      .filter((d) => d.programId === state.activeProgram && (d.date.slice(0, 7) === prevKey || d.date.slice(0, 7) === curKey))
      .map((d) => d.id));
    // 편성표에 올라가지 않은(미편성) 입찰만 풀에 표시
    let bids = state.bids.filter((b) => poolDayIds.has(b.dayId) && !placedBidIds.has(b.id));
    if (team !== 'all') bids = bids.filter((b) => b.teamId === team);
    if (q.trim()) bids = bids.filter((b) => (b.product.name || '').includes(q.trim()));
    // 지난달 입찰은 흐리게 구분 (dayId로 월 판별)
    const dayMonth = {};
    state.days.forEach((d) => { dayMonth[d.id] = d.date.slice(0, 7); });
    const prevMonthNum = shiftMonth(state.view, -1).month;

    function onPoolDrop(e) {
      e.preventDefault(); setOver(false);
      const pl = drag.read(e);
      if (pl && pl.kind === 'placement') store.removePlacement(pl.id); // 편성 카드를 풀로 → 미편성 복귀
    }

    return html`
      <aside class=${`w-full md:w-64 shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-slate-200 bg-white max-h-52 md:max-h-none ${over ? 'drop-active' : ''}`}
        onDragOver=${(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave=${(e) => { if (e.currentTarget === e.target) setOver(false); }}
        onDrop=${onPoolDrop}>
        <div class="px-3 py-2 border-b border-slate-200">
          <div class="text-sm font-bold text-ink">입찰 풀 <span class="text-[11px] font-normal text-ink-soft">${prevMonthNum}~${state.view.month}월 · ${bids.length}건</span></div>
          <div class="text-[11px] text-ink-soft mt-0.5">카드 클릭=상세 / 드래그=편성 · 편성카드를 여기로 끌면 미편성 복귀</div>
          <input value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="상품명 검색"
            class="mt-2 w-full text-xs px-2 py-1 rounded border border-slate-300 focus:border-brand outline-none" />
          <select value=${team} onChange=${(e) => setTeam(e.target.value)}
            class="mt-1.5 w-full text-xs px-2 py-1 rounded border border-slate-300 outline-none">
            <option value="all">전체 팀</option>
            ${programTeams(state).map((t) => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
          </select>
        </div>
        <div class="flex-1 overflow-y-auto p-2 space-y-1.5">
          ${bids.length === 0 && html`<div class="text-[12px] text-slate-400 text-center py-6">입찰이 없습니다</div>`}
          ${bids.map((b) => {
            const t = teamOf(state, b.teamId);
            const placed = placedBidIds.has(b.id);
            const slotInfo = U.slotLabel(b.slotId);
            const pr = b.product;
            const isPrev = dayMonth[b.dayId] === prevKey;
            return html`
              <div key=${b.id} draggable=${true} onDragStart=${(e) => drag.start(e, 'bid', b.id)}
                onClick=${() => setDetail(b)} title="클릭하면 상세 정보"
                class=${`card-drag rounded-md border px-2 py-1.5 ${placed ? 'bg-slate-100 opacity-70' : isPrev ? 'bg-amber-50/60' : 'bg-white'} hover:shadow-sm hover:border-brand`}
                style=${{ borderLeft: `4px solid ${t.color}` }}>
                <div class="text-[12px] font-semibold text-ink leading-tight">${pr.name}</div>
                <div class="mt-0.5 flex flex-wrap items-center gap-1">
                  <${Badge} color=${t.color}>${t.name}<//>
                  ${isPrev && html`<${Badge} color="#d97706">${prevMonthNum}월<//>`}
                  ${(pr.items && pr.items.length > 1) && html`<${Badge} color="#7c3aed">동시 ${pr.items.length}<//>`}
                  ${pr.durationMin && html`<${Badge}>${pr.durationMin}분<//>`}
                  ${pr.sme && html`<${Badge} color="#16a34a">중소<//>`}
                  ${pr.special && html`<${Badge} color="#da291c">특약<//>`}
                  ${placed && html`<${Badge} color="#0891b2">편성됨<//>`}
                </div>
                <div class="text-[10px] text-ink-soft mt-0.5">희망 ${slotInfo}</div>
              </div>`;
          })}
        </div>
        ${detail && html`<${BidDetailModal} state=${state} b=${detail} onClose=${() => setDetail(null)} />`}
      </aside>`;
  }

  /* =====================================================================
   *  입찰 상세 팝업 (읽기 — MD가 기입한 정보)
   * ===================================================================== */
  function BidDetailModal({ state, b, onClose }) {
    const t = teamOf(state, b.teamId);
    const pr = b.product;
    const items = pr.items || [];
    const rows = [
      ['희망 편성', U.slotLabel(b.slotId)],
      ['그룹코드', pr.groupCode],
      ['내용 / 타이틀', pr.note],
      ['이슈 / 특이사항', pr.issue],
      ['구성', pr.comp],
      ['준비물량', pr.prep],
      ['가격', pr.price],
      ['마진', pr.margin],
      ['최근 달성률', recentText(pr.recent)],
      ['방송 분량', pr.durationMin ? pr.durationMin + '분' : ''],
      ['마지막 수정', b.editedBy ? `${b.editedBy}${b.editedAt ? ' · ' + fmtTs(b.editedAt) : ''}` : ''],
    ].filter((r) => r[1]);
    return html`
      <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick=${onClose}>
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick=${(e) => e.stopPropagation()}>
          <div class="px-4 py-3 border-b border-slate-200 flex items-start justify-between"
            style=${{ borderTop: `4px solid ${t.color}` }}>
            <div>
              <div class="text-base font-bold text-ink">${pr.name}</div>
              <div class="mt-1 flex flex-wrap gap-1">
                <${Badge} color=${t.color}>${t.name}<//>
                ${items.length > 1 && html`<${Badge} color="#7c3aed">동시 ${items.length}착장<//>`}
                ${pr.isNew && html`<${Badge} color="#0891b2">신상품<//>`}
                ${pr.sme && html`<${Badge} color="#16a34a">중소기업<//>`}
                ${pr.special && html`<${Badge} color="#da291c">특약<//>`}
              </div>
            </div>
            <button onClick=${onClose} class="text-ink-soft hover:text-brand text-lg leading-none">✕</button>
          </div>
          <div class="px-4 py-3">
            ${items.length > 1 && html`
              <div class="mb-3">
                <div class="text-[12px] font-semibold text-violet-700 mb-1">동시 노출 착장 ${items.length}개</div>
                <ol class="list-decimal list-inside space-y-0.5 text-[13px] text-ink bg-violet-50 rounded-md p-2">
                  ${items.map((it, i) => html`<li key=${i}>${it}</li>`)}
                </ol>
              </div>`}
            <table class="w-full text-[13px]">
              <tbody>
                ${rows.map(([k, v]) => html`
                  <tr key=${k} class="border-b border-slate-100 last:border-0">
                    <td class="py-1.5 pr-3 text-ink-soft whitespace-nowrap align-top w-24">${k}</td>
                    <td class="py-1.5 text-ink whitespace-pre-line">${v}</td>
                  </tr>`)}
                ${rows.length === 0 && items.length === 0 && html`<tr><td class="py-3 text-slate-400 text-center">입력된 상세 정보가 없습니다.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  /* =====================================================================
   *  PD 편성표 뷰
   * ===================================================================== */
  function ScheduleView({ state, onSaved }) {
    const [editing, setEditing] = useState(null);
    const [snapOpen, setSnapOpen] = useState(false);
    const [addDayOpen, setAddDayOpen] = useState(false);
    const [memoOpen, setMemoOpen] = useState(false);
    const hasMemo = !!(state.castingMemo && state.castingMemo[`${state.activeProgram}|${state.view.year}-${String(state.view.month).padStart(2, '0')}`]);
    const { year, month } = state.view;
    const days = daysInView(state);
    const monthSlotIds = new Set(days.flatMap((d) => d.slots.map((s) => s.id)));
    const placedCount = state.placements.filter((p) => monthSlotIds.has(p.slotId)).length;
    const snaps = (state.snapshots || []).filter((s) => s.year === year && s.month === month);
    const lastSnap = snaps[0];
    const [saveOpen, setSaveOpen] = useState(false);
    function doSave(label) {
      store.saveSnapshot(year, month, (label || '').trim());
      setSaveOpen(false);
      onSaved && onSaved(); // 최종편성안 탭으로 이동
    }
    return html`
      <div class="flex flex-col md:flex-row flex-1 min-h-0">
        <${BidPool} state=${state} />
        <div class="flex-1 overflow-y-auto p-2 sm:p-4">
          <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h2 class="text-base font-bold text-ink">${year}년 ${month}월 편성표
              <span class="text-[12px] font-normal text-ink-soft">방송일 ${days.length}일 · 편성 ${placedCount}건 · +${shiftMonth(state.view, 1).month}월 첫주 포함</span>
              ${lastSnap
                ? html`<span class="text-[11px] font-normal text-emerald-600 ml-1">· 마지막 저장 ${fmtTs(lastSnap.ts)}</span>`
                : html`<span class="text-[11px] font-normal text-slate-400 ml-1">· 저장 안 됨</span>`}
            </h2>
            <div class="flex items-center gap-2 flex-wrap justify-end">
              <button onClick=${() => setMemoOpen(true)}
                class=${`text-xs px-2.5 py-1 rounded border whitespace-nowrap shrink-0 ${hasMemo ? 'border-amber-400 text-amber-700 bg-amber-50' : 'border-slate-300 bg-white hover:border-brand hover:text-brand'}`}
                title="PD·쇼호스트 캐스팅 특이사항(휴가·불가일 등)">📌 캐스팅 메모${hasMemo ? ' ●' : ''}</button>
              <button onClick=${() => setAddDayOpen(true)}
                class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand whitespace-nowrap shrink-0">+ 편성일 추가</button>
              <button onClick=${() => setSnapOpen(true)}
                class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand whitespace-nowrap shrink-0">저장본 ${snaps.length}</button>
              <button onClick=${() => setSaveOpen(true)}
                class="text-xs font-semibold px-3 py-1 rounded bg-brand text-white hover:bg-brand-dark whitespace-nowrap shrink-0">편성 저장</button>
            </div>
          </div>
          <div class="space-y-4">
            ${days.length === 0 && html`<div class="text-sm text-slate-400 py-10 text-center">이 달에는 편성일이 없습니다. “+ 편성일 추가”로 추가하세요.</div>`}
            ${groupByWeek(days).map(([wk, days]) => html`
              <div key=${wk} class="flex flex-wrap gap-3 items-start">
                ${days.map((d) => html`
                  <div class="w-full sm:flex-1 sm:min-w-[280px]">
                    <${DayBlock} state=${state} day=${d} onEdit=${setEditing} />
                  </div>`)}
              </div>`)}
          </div>
        </div>
        ${editing && html`<${MetaEditor} p=${editing} state=${state} onClose=${() => setEditing(null)} />`}
        ${snapOpen && html`<${SnapshotsModal} state=${state} onClose=${() => setSnapOpen(false)} />`}
        ${addDayOpen && html`<${AddDayModal} state=${state} onClose=${() => setAddDayOpen(false)} />`}
        ${memoOpen && html`<${CastingMemoModal} state=${state} onClose=${() => setMemoOpen(false)} />`}
        ${saveOpen && html`<${SaveSnapshotModal} year=${year} month=${month} count=${placedCount} onSave=${doSave} onClose=${() => setSaveOpen(false)} />`}
      </div>`;
  }

  function SaveSnapshotModal({ year, month, count, onSave, onClose }) {
    const [label, setLabel] = useState('');
    return html`
      <${Modal} title=${`${year}년 ${month}월 편성안 저장`} onClose=${onClose} onSave=${() => onSave(label)}>
        <div class="text-[13px] text-ink">편성 <b>${count}건</b>을 저장하고 <b>최종편성안</b>으로 이동합니다.</div>
        <${Field} label="메모 (선택)">
          <input value=${label} onInput=${(e) => setLabel(e.target.value)} class=${inputCls} placeholder="예: 7월 확정안 v1" autofocus />
        <//>
      <//>`;
  }

  // 인라인 편집 셀 (blur 시 커밋)
  function EditCell({ value, onCommit, placeholder, color, list }) {
    const [v, setV] = useState(value || '');
    useEffect(() => { setV(value || ''); }, [value]);
    return html`<input value=${v} list=${list || undefined}
      onInput=${(e) => setV(e.target.value)}
      onBlur=${() => { if (v !== (value || '')) onCommit(v); }}
      onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}
      placeholder=${placeholder || ''}
      class=${`w-full px-2 py-1.5 text-[12px] bg-transparent outline-none focus:bg-amber-50 ${color || ''}`} />`;
  }

  // 최근 3회 달성률: 3칸 분할, 숫자만 입력 → 뒤에 % 자동 표기
  function Recent3Cell({ value, onCommit, readOnly }) {
    const [a, setA] = useState(recent3(value));
    useEffect(() => { setA(recent3(value)); }, [JSON.stringify(recent3(value))]);
    if (readOnly) {
      return html`<div class="flex divide-x divide-slate-200 text-center">
        ${a.map((x, i) => html`<div key=${i} class="flex-1 px-0.5 py-1.5 text-[12px] tabular-nums">${x ? x + '%' : '·'}</div>`)}
      </div>`;
    }
    const commit = (arr) => onCommit(arr.some(Boolean) ? arr.slice() : ['', '', '']);
    return html`<div class="flex divide-x divide-slate-200">
      ${a.map((x, i) => html`
        <div key=${i} class="flex-1 flex items-center justify-center px-0.5">
          <input value=${x} inputmode="numeric" placeholder="-"
            onInput=${(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setA((p) => p.map((y, j) => (j === i ? v : y))); }}
            onBlur=${() => commit(a)}
            onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}
            class="w-7 py-1.5 text-[12px] tabular-nums text-right bg-transparent outline-none focus:bg-amber-50" />
          ${x && html`<span class="text-[10px] text-slate-400">%</span>`}
        </div>`)}
    </div>`;
  }

  /* =====================================================================
   *  최종편성안 (엑셀 레이아웃 표 · 직접 편집 가능)
   * ===================================================================== */
  function FinalScheduleView({ state, readOnly }) {
    const prog = activeProgramObj(state);
    const capRef = useRef(null);
    const [saving, setSaving] = useState(false);
    const { year, month } = state.view;
    const castOpts = (window.AUTH.casting && window.AUTH.casting[state.activeProgram]) || null;
    function saveExcel() {
      if (!window.XLSX) { alert('엑셀 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.'); return; }
      const header = ['방송일', '요일', '시간', '상태', '상품명', '내용/타이틀', '구성', '준비물량', '가격', '마진', '최근달성률', 'PD', '쇼호스트', '스튜디오', '비고(PD)'];
      const aoa = [header]; const merges = []; let ri = 1;
      rows.forEach((r) => {
        const p = r.p; const det = (p && p.detail) || {};
        const dnum = Number(r.day.date.slice(8)); const mm = Number(r.day.date.slice(5, 7));
        const items = (p && p.items && p.items.length > 1) ? '\n· ' + p.items.join('\n· ') : '';
        aoa.push([
          r.firstOfDay ? `${mm}/${dnum}` : '', r.firstOfDay ? U.WEEKDAY_KO[r.day.weekday] : '',
          slotName(r.slot), p ? (p.pending ? '미정' : '확정') : '',
          p ? ((p.productName || '') + items) : '', p ? (det.note || '') : '', p ? (det.comp || '') : '',
          p ? (det.prep || '') : '', p ? (det.price || '') : '', p ? (det.margin || '') : '',
          p ? recentText(det.recent) : '', p ? (p.pd || '') : '', p ? (p.host || '') : '',
          p ? (p.studio || '') : '', p ? (p.memo || '') : '',
        ]);
        if (r.firstOfDay) {
          const span = dayCount[r.day.date];
          if (span > 1) { merges.push({ s: { r: ri, c: 0 }, e: { r: ri + span - 1, c: 0 } }); merges.push({ s: { r: ri, c: 1 }, e: { r: ri + span - 1, c: 1 } }); }
        }
        ri++;
      });
      const ws = window.XLSX.utils.aoa_to_sheet(aoa);
      ws['!merges'] = merges;
      ws['!cols'] = [{ wch: 7 }, { wch: 5 }, { wch: 12 }, { wch: 6 }, { wch: 26 }, { wch: 24 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 22 }];
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, `${year}년${month}월`);
      window.XLSX.writeFile(wb, `${prog.name}_${year}-${String(month).padStart(2, '0')}_최종편성안.xlsx`);
    }
    async function saveImage() {
      const el = capRef.current;
      if (!window.html2canvas || !el) { alert('이미지 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.'); return; }
      setSaving(true);
      let clone = null;
      try {
        // 화면 밖에 복제본을 만들어 "컴팩트 모드"로 캡처 (원본 표·편집은 그대로)
        const liveFields = el.querySelectorAll('input, textarea');
        clone = el.cloneNode(true);
        clone.id = '';
        // 입력칸 → 정적 텍스트(세로 잘림 방지) + 본문 글자 키움
        clone.querySelectorAll('input, textarea').forEach((cf, i) => {
          const div = document.createElement('div');
          div.textContent = liveFields[i] ? liveFields[i].value : '';
          div.className = cf.className;
          div.style.whiteSpace = 'pre-wrap';
          div.style.lineHeight = '1.3';
          div.style.fontSize = '14px';
          div.style.padding = '0';
          cf.parentNode.replaceChild(div, cf);
        });
        // 표를 내용 폭으로(불필요한 가로 여백 제거) + 글자 키움 + 행 여백 축소
        clone.style.width = 'max-content';
        clone.style.maxWidth = 'none';
        const table = clone.querySelector('table');
        if (table) table.style.width = 'auto';
        const thead = clone.querySelector('thead');
        if (thead) thead.style.position = 'static';
        clone.querySelectorAll('th').forEach((c) => { c.style.padding = '5px 9px'; c.style.fontSize = '13.5px'; });
        clone.querySelectorAll('td').forEach((c) => {
          c.style.padding = '4px 9px'; c.style.lineHeight = '1.3'; c.style.fontSize = '14px';
          c.style.maxWidth = '260px'; // 긴 문장 칸은 적당히 줄바꿈해 폭 제한
        });
        clone.style.position = 'fixed';
        clone.style.left = '-100000px';
        clone.style.top = '0';
        document.body.appendChild(clone);
        const canvas = await window.html2canvas(clone, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
        const a = document.createElement('a');
        a.download = `${prog.name}_${year}-${String(month).padStart(2, '0')}_최종편성안.png`;
        a.href = canvas.toDataURL('image/png');
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { alert('이미지 저장 실패: ' + e.message); }
      finally { if (clone && clone.parentNode) clone.parentNode.removeChild(clone); setSaving(false); }
    }
    const days = daysInView(state).slice().sort((a, b) => a.date.localeCompare(b.date));
    const slotStart = (s) => (s.start ? U.toMin(s.start) : 9999);
    // 행 구성: 날짜 → 슬롯(시간순) → 편성(placement)
    const rows = [];
    days.forEach((d) => {
      const slots = d.slots.slice().sort((a, b) => slotStart(a) - slotStart(b));
      let firstOfDay = true;
      slots.forEach((s) => {
        const pls = state.placements.filter((p) => p.slotId === s.id);
        if (pls.length === 0) {
          rows.push({ day: d, slot: s, p: null, firstOfDay }); firstOfDay = false;
        } else {
          pls.forEach((p) => { rows.push({ day: d, slot: s, p, firstOfDay, compete: pls.length > 1 }); firstOfDay = false; });
        }
      });
    });
    const total = rows.filter((r) => r.p).length;
    const dayCount = {};
    rows.forEach((r) => { dayCount[r.day.date] = (dayCount[r.day.date] || 0) + 1; });
    const th = 'px-2 py-1.5 text-left font-semibold border border-slate-300 bg-brand text-white whitespace-nowrap';
    const td = 'px-2 py-1.5 border border-slate-200 align-top';
    const tdMerge = 'px-2 py-1.5 border border-slate-200 align-middle text-center bg-slate-50';
    // 셀: 읽기전용이면 텍스트, 아니면 인라인 편집
    const Cell = (value, onCommit, o) => {
      o = o || {};
      return readOnly
        ? html`<div class=${`px-2 py-1.5 text-[12px] whitespace-pre-wrap ${o.color || ''}`}>${value || ''}</div>`
        : html`<${EditCell} value=${value} onCommit=${onCommit} placeholder=${o.ph || ''} color=${o.color || ''} />`;
    };
    // 캐스팅(PD/쇼호스트/스튜디오): 추천목록(datalist) + 자유입력 통일
    const castCell = (p, field) => {
      const v = p[field] || '';
      if (readOnly) return html`<div class="px-2 py-1.5 text-[12px]">${v}</div>`;
      return html`<${EditCell} value=${v} list=${castOpts && castOpts[field] ? 'cast-' + field + '-dl' : undefined}
        onCommit=${(val) => store.updatePlacementMeta(p.id, { [field]: val })} />`;
    };

    return html`
      <div class="flex-1 overflow-auto p-4 bg-slate-100">
        ${['pd', 'host', 'studio'].map((fld) => html`<datalist key=${fld} id=${'cast-' + fld + '-dl'}>${((castOpts && castOpts[fld]) || []).map((o) => html`<option key=${o} value=${o}></option>`)}</datalist>`)}
        <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 class="text-base font-bold text-ink">${prog.name} · ${year}년 ${month}월 최종편성안
            <span class="text-[12px] font-normal text-ink-soft">총 ${total}편성${readOnly ? ' · 조회 전용' : ' · 셀을 클릭해 직접 수정'}</span></h2>
          <div class="flex items-center gap-2">
            <button onClick=${saveExcel}
              class="text-xs px-2.5 py-1 rounded border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50 whitespace-nowrap shrink-0">📊 엑셀 저장 (XLSX)</button>
            <button onClick=${saveImage} disabled=${saving}
              class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand disabled:opacity-50 whitespace-nowrap shrink-0">
              ${saving ? '이미지 생성 중…' : '🖼 이미지 저장 (PNG)'}</button>
          </div>
        </div>
        <div ref=${capRef} id="final-capture" class="bg-white rounded-lg shadow-sm overflow-x-auto">
          <div class="px-3 py-2 border-b-2 border-brand text-[13px] font-bold text-ink">
            ${prog.name} · ${year}년 ${month}월 최종편성안 <span class="font-normal text-ink-soft">(총 ${total}편성)</span>
          </div>
          <table class="w-full min-w-[820px] text-[12px] border-collapse">
            <thead class="sticky top-0">
              <tr>
                <th class=${th} style=${{ width: '70px' }}>방송일</th>
                <th class=${th} style=${{ width: '36px' }}>요일</th>
                <th class=${th} style=${{ width: '104px' }}>시간</th>
                <th class=${th} style=${{ width: '58px' }}>상태</th>
                <th class=${th}>상품명</th>
                <th class=${th}>내용 / 타이틀</th>
                <th class=${th}>구성</th>
                <th class=${th} style=${{ width: '78px' }}>준비물량</th>
                <th class=${th} style=${{ width: '88px' }}>가격</th>
                <th class=${th} style=${{ width: '64px' }}>마진</th>
                <th class=${th} style=${{ width: '128px' }}>최근 3회 달성률</th>
                <th class=${th} style=${{ width: '74px' }}>PD</th>
                <th class=${th} style=${{ width: '74px' }}>쇼호스트</th>
                <th class=${th} style=${{ width: '64px' }}>스튜디오</th>
                <th class=${th}>비고 (PD)</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length === 0 && html`<tr><td class=${td} colspan="15"><div class="text-center text-slate-400 py-8">이 달 편성이 없습니다.</div></td></tr>`}
              ${rows.map((r, i) => {
                const p = r.p; const det = (p && p.detail) || {};
                const dnum = Number(r.day.date.slice(8));
                const m = Number(r.day.date.slice(5, 7));
                const wd = U.WEEKDAY_KO[r.day.weekday];
                const wdColor = r.day.weekday === 6 ? 'text-blue-600' : r.day.weekday === 0 ? 'text-red-500' : 'text-ink';
                const pend = p && p.pending;
                return html`
                  <tr key=${i} class=${`${r.firstOfDay ? 'border-t-2 border-t-slate-300' : ''} ${pend ? 'bg-amber-100' : 'hover:bg-amber-50'}`}>
                    ${r.firstOfDay && html`
                      <td class=${`${tdMerge} font-semibold tabular-nums text-ink`} rowSpan=${dayCount[r.day.date]}>${m}/${dnum}${r.day.airTime ? html`<div class="text-[10px] font-normal text-ink-soft mt-0.5 whitespace-nowrap">${r.day.airTime}</div>` : ''}</td>
                      <td class=${`${tdMerge} font-semibold ${wdColor}`} rowSpan=${dayCount[r.day.date]}>${wd}</td>`}
                    <td class=${`${td} tabular-nums font-medium ${r.compete ? 'text-amber-700' : ''}`}>
                      ${slotName(r.slot)} ${r.compete && html`<span class="text-[10px] text-amber-600">●경쟁</span>`}
                    </td>
                    <td class=${`${td} text-center`}>
                      ${p ? (readOnly
                        ? (pend ? html`<${Badge} color="#d97706">미정<//>` : html`<span class="text-[11px] text-emerald-600">확정</span>`)
                        : html`<label class="flex items-center justify-center gap-1 text-[11px] cursor-pointer ${pend ? 'text-amber-700 font-semibold' : 'text-ink-soft'}">
                            <input type="checkbox" checked=${!!pend} onChange=${(e) => store.updatePlacementContent(p.id, { pending: e.target.checked })} /> 미정</label>`)
                        : ''}
                    </td>
                    <td class=${`${td} p-0`}>
                      ${p ? html`<div>
                          <div class="flex items-center gap-1 pr-2">
                            ${Cell(p.productName, (val) => store.updatePlacementContent(p.id, { productName: val }), { color: 'font-semibold text-ink' })}
                            ${(p.items && p.items.length > 1) && html`<span class="shrink-0 text-[10px] text-violet-600">동시 ${p.items.length}착장</span>`}
                            ${det.isNew && html`<span class="shrink-0 text-[10px] text-cyan-600">新</span>`}
                          </div>
                          ${(p.items && p.items.length > 1) && html`<ul class="px-2 pb-1 text-[11px] text-ink-soft">${p.items.map((it, k) => html`<li key=${k}>· ${it}</li>`)}</ul>`}
                          <div class="px-2 pb-1 text-[10px] text-slate-400">${teamOf(state, p.teamId).name}</div>
                        </div>`
                        : html`<span class="px-2 text-slate-300">—</span>`}
                    </td>
                    <td class=${`${td} p-0`}>${p ? html`${Cell(det.note, (val) => store.updatePlacementContent(p.id, { detail: { note: val } }), { ph: '내용/타이틀…' })}
                      <div class="border-t border-dashed border-rose-200">${Cell(det.issue, (val) => store.updatePlacementContent(p.id, { detail: { issue: val } }), { ph: '이슈/특이사항…', color: 'text-rose-500' })}</div>` : ''}</td>
                    <td class=${`${td} p-0`}>${p ? Cell(det.comp, (val) => store.updatePlacementContent(p.id, { detail: { comp: val } }), { ph: '구성…' }) : ''}</td>
                    <td class=${`${td} p-0`}>${p ? Cell(det.prep, (val) => store.updatePlacementContent(p.id, { detail: { prep: val } }), { ph: '00억…', color: 'tabular-nums' }) : ''}</td>
                    <td class=${`${td} p-0`}>${p ? Cell(det.price, (val) => store.updatePlacementContent(p.id, { detail: { price: val } }), { ph: '가격…', color: 'tabular-nums' }) : ''}</td>
                    <td class=${`${td} p-0`}>${p ? Cell(det.margin, (val) => store.updatePlacementContent(p.id, { detail: { margin: val } }), { ph: '마진…', color: 'tabular-nums' }) : ''}</td>
                    <td class=${`${td} p-0`}>${p ? html`<${Recent3Cell} value=${det.recent} readOnly=${readOnly}
                      onCommit=${(val) => store.updatePlacementContent(p.id, { detail: { recent: val } })} />` : ''}</td>
                    <td class=${`${td} p-0`}>${p ? castCell(p, 'pd') : ''}</td>
                    <td class=${`${td} p-0`}>${p ? castCell(p, 'host') : ''}</td>
                    <td class=${`${td} p-0`}>${p ? castCell(p, 'studio') : ''}</td>
                    <td class=${`${td} p-0`}>${p ? Cell(p.memo, (val) => store.updatePlacementContent(p.id, { memo: val }), { ph: 'PD 코멘트…', color: 'text-violet-700' }) : ''}</td>
                  </tr>`;
              })}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  /* =====================================================================
   *  편성일 추가 모달 (prompt 대신 인앱 모달)
   * ===================================================================== */
  function AddDayModal({ state, onClose }) {
    const [date, setDate] = useState(monthKey(state.view) + '-15');
    const wdName = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? U.WEEKDAY_KO[new Date(date + 'T00:00:00').getDay()] : '';
    function save() {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { alert('날짜를 선택하세요.'); return; }
      const exists = state.days.some((d) => d.programId === state.activeProgram && d.date === date);
      if (exists) { alert('이미 있는 편성일입니다.'); return; }
      store.addDay(date);
      onClose();
    }
    return html`
      <${Modal} title=${`${activeProgramObj(state).name} · 편성일 추가`} onClose=${onClose} onSave=${save}>
        <${Field} label="방송일">
          <input type="date" value=${date} onInput=${(e) => setDate(e.target.value)} class=${inputCls} />
        <//>
        ${wdName && html`<div class="text-[12px] text-ink-soft">${date} (${wdName}요일)에 편성일을 추가합니다. 추가 후 각 칸의 “+ 시간대”로 방송 시간을 입력하세요.</div>`}
      <//>`;
  }

  /* =====================================================================
   *  저장본(편성안 스냅샷) 목록
   * ===================================================================== */
  function SnapshotsModal({ state, onClose }) {
    const snaps = state.snapshots || [];
    const progName = (id) => (((state.programs || []).find((p) => p.id === id)) || {}).name || '(삭제된 프로그램)';
    function restore(s) {
      if (!confirm(`[${progName(s.programId)}] ${s.year}년 ${s.month}월 — ${fmtTs(s.ts)} 저장본으로 되돌립니다.\n${progName(s.programId)}의 ${s.month}월 편성만 이 저장본 내용으로 교체됩니다. (다른 프로그램/월은 그대로) 계속할까요?`)) return;
      const r = store.restoreSnapshot(s.id);
      store.setView(s.year, s.month);
      alert(`복원 완료: ${r.restored}건${r.missing ? ` (시간대 변경으로 ${r.missing}건 누락)` : ''}`);
      onClose();
    }
    return html`
      <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick=${onClose}>
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick=${(e) => e.stopPropagation()}>
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h3 class="font-bold text-ink">저장된 편성안 <span class="text-[12px] font-normal text-ink-soft">(${snaps.length})</span></h3>
            <button onClick=${onClose} class="text-ink-soft hover:text-brand text-lg leading-none">✕</button>
          </div>
          <div class="flex-1 overflow-y-auto">
            ${snaps.length === 0
              ? html`<div class="text-center text-slate-400 py-10 text-sm">저장된 편성안이 없습니다.<br/>편성표에서 “편성 저장”을 누르면 이 시점의 편성안이 기록됩니다.</div>`
              : html`<table class="w-full text-[13px]">
                  <thead class="sticky top-0 bg-slate-50 text-ink-soft text-left">
                    <tr>
                      <th class="px-4 py-2 font-medium">저장 시각</th>
                      <th class="px-3 py-2 font-medium">프로그램</th>
                      <th class="px-3 py-2 font-medium">대상 월</th>
                      <th class="px-3 py-2 font-medium">편성</th>
                      <th class="px-3 py-2 font-medium">메모 / 저장자</th>
                      <th class="px-3 py-2 font-medium text-right">동작</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${snaps.map((s) => html`
                      <tr key=${s.id} class="border-t border-slate-100 hover:bg-slate-50">
                        <td class="px-4 py-2 tabular-nums whitespace-nowrap">${fmtTs(s.ts)}</td>
                        <td class="px-3 py-2 whitespace-nowrap font-medium text-ink">${progName(s.programId)}</td>
                        <td class="px-3 py-2 whitespace-nowrap">${s.year}.${s.month}월</td>
                        <td class="px-3 py-2"><${Badge} color="#16a34a">${s.count}건<//></td>
                        <td class="px-3 py-2 text-ink-soft">${s.label || '—'} <span class="text-[11px]">· ${s.user}</span></td>
                        <td class="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick=${() => restore(s)} class="text-[12px] text-brand hover:underline">되돌리기</button>
                          <button onClick=${() => confirm('이 저장본을 삭제할까요?') && store.deleteSnapshot(s.id)}
                            class="text-[12px] text-ink-soft hover:text-brand ml-2">삭제</button>
                        </td>
                      </tr>`)}
                  </tbody>
                </table>`}
          </div>
        </div>
      </div>`;
  }

  /* =====================================================================
   *  배정 편집 모달 (PD / 쇼호스트 / 스튜디오)
   * ===================================================================== */
  function MetaEditor({ p, onClose, state }) {
    const [pd, setPd] = useState(p.pd || '');
    const [host, setHost] = useState(p.host || '');
    const [studio, setStudio] = useState(p.studio || '');
    const [dur, setDur] = useState(p.durationMin || '');
    const castOpts = (window.AUTH.casting && window.AUTH.casting[p.programId]) || null;
    const memoYm = state ? `${state.view.year}-${String(state.view.month).padStart(2, '0')}` : '';
    const memo = (state && state.castingMemo && state.castingMemo[p.programId + '|' + memoYm]) || '';
    function save() {
      store.updatePlacementMeta(p.id, {
        pd, host, studio, durationMin: dur ? parseInt(dur, 10) : null,
      });
      onClose();
    }
    // 캐스팅: 목록에서 선택 또는 직접 입력 (드롭다운 + 수기입력 통일)
    const castField = (field, val, setVal, ph) => html`
      <input value=${val} onInput=${(e) => setVal(e.target.value)} list=${castOpts && castOpts[field] ? 'meta-' + field + '-dl' : undefined} class=${inputCls} placeholder=${ph} />
      ${castOpts && castOpts[field] ? html`<datalist id=${'meta-' + field + '-dl'}>${castOpts[field].map((o) => html`<option key=${o} value=${o}></option>`)}</datalist>` : ''}`;
    return html`
      <${Modal} title=${`배정 편집 · ${p.productName}`} onClose=${onClose} onSave=${save}>
        ${memo && html`<div class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800 whitespace-pre-line">
          <div class="font-semibold mb-0.5">📌 캐스팅 특이사항 (${state.view.month}월)</div>${memo}</div>`}
        <${Field} label="담당 PD (선택/직접입력)">${castField('pd', pd, setPd, '예: 강성현')}<//>
        <${Field} label="쇼호스트 (선택/직접입력)">${castField('host', host, setHost, '예: 홍성보')}<//>
        <${Field} label="스튜디오 (선택/직접입력)">${castField('studio', studio, setStudio, '예: 250')}<//>
        <${Field} label="방송 분량(분)">
          <input type="number" value=${dur} onInput=${(e) => setDur(e.target.value)} class=${inputCls} placeholder="예: 30" />
        <//>
      <//>`;
  }

  // 캐스팅 특이사항 메모 (PD/관리자 전용 — 휴가·특정일 불가 등)
  function CastingMemoModal({ state, onClose }) {
    const pid = state.activeProgram;
    const ym = `${state.view.year}-${String(state.view.month).padStart(2, '0')}`;
    const [text, setText] = useState((state.castingMemo && state.castingMemo[pid + '|' + ym]) || '');
    function save() { store.setCastingMemo(pid, ym, text); onClose(); }
    return html`
      <${Modal} title=${`${activeProgramObj(state).name} · ${state.view.year}년 ${state.view.month}월 캐스팅 특이사항`} onClose=${onClose} onSave=${save}>
        <div class="text-[12px] text-ink-soft"><b>이 달(${state.view.month}월) 전용</b> 메모입니다 — PD·쇼호스트 배정 시 참고. (예: “강성현 ${state.view.month}/15 휴가”, “홍성보 ${state.view.month}/20~25 불가”) 월·프로그램별로 분리 저장되며 PD·관리자만 보고 수정합니다.</div>
        <textarea value=${text} onInput=${(e) => setText(e.target.value)} rows="8" class=${`${inputCls} leading-relaxed`}
          placeholder=${'예)\n· 강성현 PD: 7/15(목) 휴가\n· 홍성보: 7/20~7/25 불가\n· 250스튜디오: 7/10 점검'}></textarea>
      <//>`;
  }

  /* =====================================================================
   *  MD 입찰 보드
   * ===================================================================== */
  function BidBoard({ state }) {
    const teams = programTeams(state);
    const schema = programSchema(state);
    const fashion = schema === 'fashion';
    const isMain = state.activeProgram === U.MAIN_PROGRAM;
    const [teamSel, setTeamSel] = useState(null);
    const team = (teamSel && teams.some((t) => t.id === teamSel)) ? teamSel : (teams[0] && teams[0].id);
    const [modal, setModal] = useState(null); // {dayId, slotId, bid?}
    const [addDayOpen, setAddDayOpen] = useState(false);
    const [slotModalDay, setSlotModalDay] = useState(null);
    const days = daysInView(state);
    const monthDayIds = new Set(days.map((d) => d.id));
    const teamBids = state.bids.filter((b) => b.teamId === team && monthDayIds.has(b.dayId));

    return html`
      <div class="flex-1 overflow-y-auto">
        <div class="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-2">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-bold text-ink mr-1">${activeProgramObj(state).name} · 입찰팀</span>
            ${teams.map((t) => html`
              <button key=${t.id} onClick=${() => setTeamSel(t.id)}
                class=${`text-xs px-2.5 py-1 rounded-full border transition ${team === t.id ? 'text-white border-transparent' : 'bg-white text-ink-soft border-slate-300 hover:border-slate-400'}`}
                style=${team === t.id ? { background: t.color } : {}}>
                <${TeamDot} color=${t.color} /> <span class="ml-1">${t.name}</span>
              </button>`)}
          </div>
        </div>
        <div class="p-4 space-y-3 max-w-[1100px]">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-bold text-ink">${teamOf(state, team).name} 입찰 · ${state.view.year}년 ${state.view.month}월 — 총 ${teamBids.length}건</h2>
            <button onClick=${() => setAddDayOpen(true)}
              class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand">+ 편성일 추가</button>
          </div>
          ${days.length === 0 && html`<div class="text-sm text-slate-400 py-8 text-center">이 달에는 편성일이 없습니다. 위 “+ 편성일 추가”로 추가하세요.</div>`}
          ${days.map((day) => {
            const shownSlots = day.slots.filter((slot) => !isMain || slot.std || slot.manual || state.bids.some((b) => b.slotId === slot.id));
            return html`
            <div key=${day.id} class="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div class="flex items-center justify-between px-3 py-1.5 bg-slate-100">
                <span class="flex items-center gap-2">
                  <span class="font-semibold text-[13px] text-ink">${fmtDay(day)}</span>
                  ${fashion && html`<${AirTimeButton} day=${day} />`}
                </span>
                <div class="flex items-center gap-2 text-[11px] text-ink-soft">
                  ${!fashion && html`<button onClick=${() => setSlotModalDay(day.id)} class="hover:text-brand">+ 시간대</button>`}
                  ${!fashion && html`<button onClick=${() => store.addSlot(day.id, { order: true })} class="hover:text-brand">+ 순번</button>`}
                  <button onClick=${() => confirm(`${fmtDay(day)} 편성일을 삭제할까요? (입찰·편성 포함)`) && store.removeDay(day.id)}
                    class="hover:text-brand">편성일 삭제</button>
                </div>
              </div>
              ${fashion ? html`
                <div class="px-3 py-2.5">
                  <div class="flex flex-wrap gap-1.5 items-start">
                    ${teamBids.filter((b) => b.dayId === day.id).map((b) => html`<${BidChip} key=${b.id} state=${state} b=${b}
                        onEdit=${() => setModal({ dayId: day.id, bid: b })} />`)}
                    <button onClick=${() => setModal({ dayId: day.id })}
                      class="text-[12px] px-2 py-1 rounded border border-dashed border-slate-300 text-ink-soft hover:border-brand hover:text-brand self-start">
                      + 입찰
                    </button>
                  </div>
                </div>`
              : html`
              <div class="divide-y divide-slate-100">
                ${shownSlots.length === 0 && html`<div class="text-[12px] text-slate-400 text-center py-3">시간대가 없습니다. “+ 시간대” 또는 “+ 순번”으로 추가하세요.</div>`}
                ${shownSlots.map((slot) => {
                  const bids = teamBids.filter((b) => b.slotId === slot.id);
                  return html`
                    <div key=${slot.id} class="flex gap-3 px-3 py-2">
                      <div class="w-28 shrink-0 pt-0.5">
                        <div class="flex items-center gap-1">
                          <${SlotTimeButton} slot=${slot} className="text-[13px] font-bold tabular-nums" />
                          <button title="이 시간대 삭제" onClick=${() => confirm(`${slotName(slot)} 삭제할까요?`) && store.removeSlot(slot.id)}
                            class="text-slate-300 hover:text-brand text-[11px] leading-none">✕</button>
                        </div>
                        ${slot.start && slot.end && html`<div class="text-[11px] text-ink-soft">${U.slotDuration(slot)}분</div>`}
                      </div>
                      <div class="flex-1 flex flex-wrap gap-1.5 items-start">
                        ${bids.map((b) => html`<${BidChip} key=${b.id} state=${state} b=${b}
                            onEdit=${() => setModal({ dayId: day.id, slotId: slot.id, bid: b })} />`)}
                        <button onClick=${() => setModal({ dayId: day.id, slotId: slot.id })}
                          class="text-[12px] px-2 py-1 rounded border border-dashed border-slate-300 text-ink-soft hover:border-brand hover:text-brand self-start">
                          + 입찰
                        </button>
                      </div>
                    </div>`;
                })}
              </div>`}
            </div>`;
          })}
        </div>
        ${modal && html`<${BidModal} state=${state} team=${team} schema=${schema} ctx=${modal} onClose=${() => setModal(null)} />`}
        ${addDayOpen && html`<${AddDayModal} state=${state} onClose=${() => setAddDayOpen(false)} />`}
        ${slotModalDay && html`<${AddSlotModal} day=${state.days.find((d) => d.id === slotModalDay)} onClose=${() => setSlotModalDay(null)} />`}
      </div>`;
  }

  function BidChip({ state, b, onEdit }) {
    const t = teamOf(state, b.teamId);
    const pr = b.product;
    const items = pr.items || [];
    const isGroup = items.length > 1;
    const tip = [pr.note && '내용:' + pr.note, pr.issue && '이슈:' + pr.issue, pr.comp && '구성:' + pr.comp,
                 pr.price && '가격:' + pr.price, pr.margin && '마진:' + pr.margin,
                 pr.sme && '중소', pr.special && '특약'].filter(Boolean).join(' / ');
    return html`
      <button onClick=${onEdit} title=${tip}
        class=${`text-left rounded-md border bg-white px-2 py-1 hover:shadow-sm ${isGroup ? 'min-w-[220px]' : ''}`}
        style=${{ borderLeft: `4px solid ${t.color}` }}>
        <div class="flex items-center gap-1">
          ${isGroup && html`<${Badge} color="#7c3aed" title="동시 노출 묶음">동시 ${items.length}<//>`}
          <span class="text-[12px] font-semibold text-ink leading-tight">${pr.name}</span>
        </div>
        ${isGroup && html`
          <ul class="mt-1 space-y-0.5">
            ${items.slice(0, 6).map((it, i) => html`<li key=${i} class="text-[11px] text-ink-soft leading-tight flex gap-1">
              <span class="text-violet-400">·</span><span class="truncate">${it}</span></li>`)}
            ${items.length > 6 && html`<li class="text-[11px] text-violet-500">외 ${items.length - 6}개 …</li>`}
          </ul>`}
        <div class="mt-0.5 flex flex-wrap gap-1">
          ${pr.durationMin && html`<${Badge}>${pr.durationMin}분<//>`}
          ${pr.sme && html`<${Badge} color="#16a34a">중소<//>`}
          ${pr.special && html`<${Badge} color="#da291c">특약<//>`}
          ${pr.groupCode && html`<${Badge} title="그룹코드">${pr.groupCode}<//>`}
        </div>
      </button>`;
  }

  /* =====================================================================
   *  입찰 등록/수정 모달
   * ===================================================================== */
  function BidModal({ state, team, schema, ctx, onClose }) {
    const fashion = schema === 'fashion';
    const b = ctx.bid;
    const init = b ? b.product : {};
    const [f, setF] = useState({
      name: init.name || '', note: init.note || '', issue: init.issue || '',
      comp: init.comp || '', prep: init.prep || '', price: init.price || '', margin: init.margin || '',
      durationMin: init.durationMin || '', sme: !!init.sme, special: !!init.special, isNew: !!init.isNew,
      groupCode: init.groupCode || '', recent: recent3(init.recent),
      items: (init.items || []).join('\n'), // 동시 묶음 상품 목록
    });
    const setRecent = (i) => (e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setF((s) => ({ ...s, recent: s.recent.map((x, j) => (j === i ? v : x)) })); };
    const itemLines = f.items.split('\n').map((s) => s.trim()).filter(Boolean);
    const initSlot = state.days.flatMap((d) => d.slots).find((s) => s.id === ctx.slotId);
    const orderMode = !!(initSlot && initSlot.label && !initSlot.start);
    const [slotId, setSlotId] = useState(ctx.slotId);
    const [dayId, setDayId] = useState(ctx.dayId);
    const [start, setStart] = useState((initSlot && initSlot.start) || '20:45');
    const [end, setEnd] = useState((initSlot && initSlot.end) || '21:45');
    const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
    const setChk = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.checked }));

    const monthDays = daysInView(state);
    const day = state.days.find((d) => d.id === dayId) || monthDays[0];
    const durMin = (start && end) ? (U.toMin(end) - U.toMin(start) + 1440) % 1440 : 0;
    const bands = (day ? day.slots : []).filter((s) => s.start && s.end);

    function save() {
      const items = f.items.split('\n').map((s) => s.trim()).filter(Boolean);
      let name = f.name.trim();
      if (!name && items.length) name = `(동시) ${items[0]}${items.length > 1 ? ` 외 ${items.length - 1}` : ''}`;
      if (!name) { alert('상품명을 입력하거나 동시 묶음 상품을 입력하세요.'); return; }
      const product = {
        name, note: f.note, issue: f.issue, comp: f.comp, prep: f.prep,
        price: f.price, margin: f.margin, sme: f.sme, special: f.special, isNew: f.isNew,
        groupCode: f.groupCode, recent: f.recent.some(Boolean) ? f.recent : undefined,
        durationMin: (fashion || orderMode) ? (f.durationMin ? parseInt(f.durationMin, 10) : null) : durMin,
        items: items.length ? items : undefined,
        dongsi: items.length > 1,
      };
      if (fashion) {
        // 패션팀: 1·2부 구분 없이 날짜에만 입찰 (부 배정은 PD)
        if (b) store.updateBid(b.id, { product });
        else store.addBid({ teamId: team, dayId, product, bucket: true });
      } else if (orderMode) {
        if (b) store.updateBid(b.id, { product, slotId });
        else store.addBid({ teamId: team, dayId, slotId, product });
      } else {
        if (!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) { alert('시작/종료 시간을 입력하세요.'); return; }
        if (durMin <= 0) { alert('종료 시간이 시작보다 늦어야 합니다.'); return; }
        if (b) store.updateBid(b.id, { product, start, end });
        else store.addBid({ teamId: team, dayId, start, end, product });
      }
      onClose();
    }
    function del() {
      if (b && confirm('이 입찰을 삭제할까요?')) { store.deleteBid(b.id); onClose(); }
    }

    return html`
      <${Modal} title=${`${teamOf(state, team).name} ${b ? '입찰 수정' : '입찰 등록'}`}
        onClose=${onClose} onSave=${save} extra=${b && html`<button onClick=${del}
          class="text-xs text-brand hover:underline mr-auto">삭제</button>`}>
        <div class="grid grid-cols-2 gap-3">
          <${Field} label=${itemLines.length > 1 ? '대표명 / 묶음명 (비우면 자동)' : '상품명 *'}>
            <input value=${f.name} onInput=${set('name')} class=${inputCls} autofocus placeholder=${itemLines.length > 1 ? '예: (동시) 필립림 25FW' : ''} /><//>
          <${Field} label="그룹코드"><input value=${f.groupCode} onInput=${set('groupCode')} class=${inputCls} placeholder="예: 12345678" /><//>
        </div>
        <${Field} label=${`동시 묶음 상품 (한 줄에 하나씩 · 여러 개 붙여넣기 가능)${itemLines.length ? ` — ${itemLines.length}개` : ''}`}>
          <textarea value=${f.items} onInput=${set('items')} rows="3" class=${`${inputCls} font-mono text-[12px]`}
            placeholder=${'[동시] 필립림 그래픽 티셔츠 3종 (여성)\n[동시] 필립림 그래픽 티셔츠 3종 (남성)\n[동시] 필립림 워싱 데님 팬츠\n[동시] 필립림 보머자켓(세일)'}></textarea>
        <//>
        <div class="text-[11px] text-ink-soft -mt-1">패션 등 한 번에 여러 상품을 제안할 때: 위 칸에 줄바꿈으로 붙여넣으면 ‘동시 노출’ 묶음으로 한 카드에 묶여 한눈에 보입니다. 단일 상품이면 상품명만 입력하세요.</div>
        <div class="grid grid-cols-2 gap-3">
          <${Field} label="희망 편성일">
            <select value=${dayId} onChange=${(e) => { setDayId(e.target.value);
                const nd = state.days.find((d) => d.id === e.target.value); if (nd && nd.slots[0]) setSlotId(nd.slots[0].id); }}
              class=${inputCls}>
              ${monthDays.map((d) => html`<option key=${d.id} value=${d.id}>${fmtDay(d)}</option>`)}
            </select>
          <//>
          ${fashion
            ? html`<${Field} label="시간/순번">
                <div class="text-[12px] text-ink-soft px-2 py-1.5 rounded bg-slate-50 border border-slate-200">날짜 단위로 입찰합니다.</div><//>`
            : orderMode
            ? html`<${Field} label="희망 슬롯(순번)">
                <select value=${slotId} onChange=${(e) => setSlotId(e.target.value)} class=${inputCls}>
                  ${day.slots.map((s) => html`<option key=${s.id} value=${s.id}>${slotName(s)}</option>`)}
                </select><//>`
            : html`<${Field} label=${`방송 시간 (24시간) — ${durMin}분`}>
                <div class="flex items-center gap-1.5">
                  <${TimeInput} value=${start} onChange=${setStart} />
                  <span class="text-ink-soft">~</span>
                  <${TimeInput} value=${end} onChange=${setEnd} />
                </div><//>`}
        </div>
        ${!fashion && !orderMode && bands.length > 0 && html`
          <div class="-mt-1 flex flex-wrap items-center gap-1">
            <span class="text-[11px] text-ink-soft">큰 띠:</span>
            ${bands.map((s) => html`<button type="button" key=${s.id}
              onClick=${() => { setStart(s.start); setEnd(s.end); }}
              class="text-[11px] px-1.5 py-0.5 rounded border border-slate-300 hover:border-brand hover:text-brand tabular-nums">${s.start}~${s.end}</button>`)}
            <span class="text-[11px] text-slate-400">→ 시작/종료를 직접 조정 (예: 20:45~21:05 = 20분)</span>
          </div>`}
        <${Field} label="내용 / 타이틀"><input value=${f.note} onInput=${set('note')} class=${inputCls} /><//>
        <${Field} label="이슈사항 / 특이사항"><textarea value=${f.issue} onInput=${set('issue')} rows="2" class=${inputCls}></textarea><//>
        <div class="grid grid-cols-2 gap-3">
          <${Field} label="구성"><input value=${f.comp} onInput=${set('comp')} class=${inputCls} placeholder="예: 6개월분" /><//>
          <${Field} label="준비물량"><input value=${f.prep} onInput=${set('prep')} class=${inputCls} placeholder="예: 5억 / 3,000세트" /><//>
          <${Field} label="가격"><input value=${f.price} onInput=${set('price')} class=${inputCls} placeholder="예: 179,000원" /><//>
          <${Field} label="마진"><input value=${f.margin} onInput=${set('margin')} class=${inputCls} placeholder="예: 50T / 46%" /><//>
          <${Field} label="최근 3회 달성률 (숫자만, % 자동)">
            <div class="flex items-center gap-1.5">
              ${[0, 1, 2].map((i) => html`
                <div key=${i} class="flex-1 flex items-center rounded border border-slate-300 focus-within:border-brand px-2">
                  <input value=${f.recent[i]} onInput=${setRecent(i)} inputmode="numeric" placeholder=${`${i + 1}회`}
                    class="w-full py-1.5 text-[13px] tabular-nums text-right bg-transparent outline-none" />
                  <span class="text-[12px] text-ink-soft pl-0.5">%</span>
                </div>`)}
            </div>
          <//>
          ${(fashion || orderMode) && html`<${Field} label="방송 분량(분)"><input type="number" value=${f.durationMin} onInput=${set('durationMin')} class=${inputCls} placeholder="예: 30" /><//>`}
        </div>
        <div class="flex items-center gap-5 pt-1">
          <label class="flex items-center gap-1.5 text-[13px] cursor-pointer">
            <input type="checkbox" checked=${f.sme} onChange=${setChk('sme')} /> 중소기업 상품</label>
          <label class="flex items-center gap-1.5 text-[13px] cursor-pointer">
            <input type="checkbox" checked=${f.special} onChange=${setChk('special')} /> 특약 여부</label>
          <label class="flex items-center gap-1.5 text-[13px] cursor-pointer">
            <input type="checkbox" checked=${f.isNew} onChange=${setChk('isNew')} /> 신상품 여부</label>
        </div>
      <//>`;
  }

  /* =====================================================================
   *  팀 관리 (관리자) — 조직개편 대응: 추가 / 이름·부문 수정 / 삭제
   * ===================================================================== */
  function TeamManagerModal({ state, onClose }) {
    const [newName, setNewName] = useState('');
    const [newDiv, setNewDiv] = useState('');
    const [newDivName, setNewDivName] = useState('');
    const teams = state.teams || [];
    const divisions = state.divisions || [];
    // store가 state를 제자리 변경(참조 유지)하므로 useMemo 대신 매 렌더 계산
    const byDiv = (() => {
      const g = {};
      teams.forEach((t) => { const d = t.div || '기타'; (g[d] = g[d] || []).push(t); });
      return g;
    })();
    // 부문 표시 순서 = state.divisions 순 + 목록에 없는 부문(기타 등) 뒤에
    const divOrder = (() => {
      const o = divisions.slice();
      Object.keys(byDiv).forEach((d) => { if (!o.includes(d)) o.push(d); });
      return o.filter((d) => byDiv[d] || divisions.includes(d));
    })();
    const usage = (() => {
      const u = {};
      (state.bids || []).forEach((b) => { u[b.teamId] = u[b.teamId] || { b: 0, p: 0 }; u[b.teamId].b++; });
      (state.placements || []).forEach((p) => { u[p.teamId] = u[p.teamId] || { b: 0, p: 0 }; u[p.teamId].p++; });
      return u;
    })();
    function add() {
      if (!newName.trim()) { alert('팀명을 입력하세요.'); return; }
      const r = store.addTeam({ name: newName.trim(), div: newDiv || (divisions[0] || '') });
      if (r && r.error) { alert(r.error); return; }
      setNewName('');
    }
    function rename(t) {
      const nm = prompt('팀명 수정', t.name);
      if (nm === null) return;
      const r = store.updateTeam(t.id, { name: nm });
      if (r && r.error) alert(r.error);
    }
    function del(t) {
      const u = store.teamUsage(t.id);
      const warn = (u.bids || u.placements)
        ? `\n\n※ 이 팀에 입찰 ${u.bids}건 · 편성 ${u.placements}건이 연결돼 있습니다.\n삭제하면 그 데이터의 팀 표시가 사라집니다. (병합을 권장)` : '';
      if (!confirm(`[${t.name}] 팀을 삭제할까요?${warn}`)) return;
      store.removeTeam(t.id);
    }
    function mergeInto(t, targetId) {
      if (!targetId) return;
      const to = teams.find((x) => x.id === targetId);
      const u = store.teamUsage(t.id);
      if (!confirm(`[${t.name}] → [${to.name}]로 병합합니다.\n${t.name}의 입찰 ${u.bids}건·편성 ${u.placements}건이 ${to.name}으로 옮겨지고 ${t.name}은 삭제됩니다. 계속할까요?`)) return;
      const r = store.mergeTeam(t.id, targetId);
      if (r && r.error) alert(r.error);
    }
    function autoMerge2026() {
      if (!confirm('같은 이름의 중복 팀을 2026 표준 팀으로 병합하고 부문을 지정합니다.\n(입찰·편성 데이터는 표준 팀으로 이관됩니다. "기타"는 그대로) 계속할까요?')) return;
      const r = store.mergeTeams2026();
      alert(`정리 완료: 중복 ${r.merged}팀 병합 · 데이터 ${r.reassigned}건 이관`);
    }
    function delDivision(d) {
      if (!confirm(`부문 [${d}]을(를) 삭제할까요?\n소속 팀은 "기타"로 이동합니다. (팀·데이터는 유지)`)) return;
      store.removeDivision(d);
    }
    function renameDivision(d) {
      const nm = prompt('부문명 수정', d);
      if (nm === null || !nm.trim()) return;
      store.renameDivision(d, nm.trim());
    }
    const divSelCls = 'text-[12px] px-1 py-1 rounded border border-slate-200 bg-white outline-none';
    return html`
      <${Modal} title="팀 · 부문 관리 (조직개편)" onClose=${onClose} onSave=${onClose} extra=${html`<button onClick=${autoMerge2026} class="text-[12px] px-2.5 py-1.5 rounded border border-violet-300 text-violet-700 bg-white hover:bg-violet-50">🧹 2026 표준 자동정리</button>`}>
        <div class="flex items-end gap-2 flex-wrap">
          <${Field} label="새 팀명"><input value=${newName} onInput=${(e) => setNewName(e.target.value)} class=${inputCls} placeholder="예: 무형상품팀" /><//>
          <${Field} label="부문">
            <select value=${newDiv} onChange=${(e) => setNewDiv(e.target.value)} class=${inputCls}>
              <option value="">(미지정)</option>
              ${divisions.map((d) => html`<option key=${d} value=${d}>${d}</option>`)}
            </select>
          <//>
          <button onClick=${add} class="shrink-0 text-[13px] px-3 py-1.5 rounded bg-brand text-white hover:bg-brand-dark">+ 팀 추가</button>
        </div>
        <div class="flex items-end gap-2">
          <${Field} label="새 부문 추가"><input value=${newDivName} onInput=${(e) => setNewDivName(e.target.value)} class=${inputCls} placeholder="예: 신설부문" /><//>
          <button onClick=${() => { if (newDivName.trim()) { const r = store.addDivision(newDivName.trim()); if (r && r.error) alert(r.error); else setNewDivName(''); } }}
            class="shrink-0 text-[13px] px-3 py-1.5 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand">+ 부문</button>
        </div>
        <div class="space-y-3 mt-1">
          ${divOrder.map((div) => html`
            <div key=${div}>
              <div class="flex items-center gap-2 mb-1">
                <span class="text-[12px] font-bold text-ink">${div}</span>
                <span class="text-[11px] text-slate-400">${(byDiv[div] || []).length}팀</span>
                ${div !== '기타' && html`<button onClick=${() => renameDivision(div)} class="text-[11px] text-ink-soft hover:text-brand">부문명</button>
                  <button onClick=${() => delDivision(div)} class="text-[11px] text-rose-400 hover:underline">부문삭제</button>`}
              </div>
              <div class="space-y-1">
                ${(byDiv[div] || []).map((t) => html`
                  <div key=${t.id} class="flex items-center gap-2 text-[13px] border border-slate-100 rounded px-2 py-1">
                    <input type="color" value=${t.color || '#64748b'} onInput=${(e) => store.updateTeam(t.id, { color: e.target.value })}
                      class="w-6 h-6 rounded cursor-pointer border border-slate-200 shrink-0" title="색상" />
                    <span class="flex-1 font-medium text-ink truncate">${t.name}</span>
                    ${(() => { const u = usage[t.id]; const n = u ? u.b + u.p : 0;
                      return html`<span class=${`text-[11px] px-1.5 rounded shrink-0 ${n ? 'bg-slate-100 text-ink-soft' : 'bg-emerald-50 text-emerald-600'}`} title="입찰+편성 사용 건수">${n ? n + '건' : '미사용'}</span>`; })()}
                    <select value=${t.div || ''} onChange=${(e) => store.updateTeam(t.id, { div: e.target.value })} class=${divSelCls} title="부문 이동">
                      <option value="">(미지정)</option>
                      ${divOrder.map((d) => html`<option key=${d} value=${d}>${d}</option>`)}
                    </select>
                    <select value="" onChange=${(e) => { mergeInto(t, e.target.value); e.target.value = ''; }} class=${divSelCls} title="다른 팀으로 병합">
                      <option value="">병합→</option>
                      ${teams.filter((x) => x.id !== t.id).map((x) => html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}
                    </select>
                    <button onClick=${() => rename(t)} class="text-[12px] text-ink-soft hover:text-brand shrink-0">이름</button>
                    <button onClick=${() => del(t)} class="text-[12px] text-rose-500 hover:underline shrink-0">삭제</button>
                  </div>`)}
              </div>
            </div>`)}
        </div>
        <div class="text-[12px] text-ink-soft">중복/구팀은 <b>병합→</b>으로 표준 팀에 합치면 데이터가 이관됩니다. <b>2026 표준 자동정리</b>는 같은 이름 중복을 한 번에 정리합니다.</div>
      <//>`;
  }

  /* =====================================================================
   *  변경 이력 팝업
   * ===================================================================== */
  function HistoryModal({ state, onClose, isAdmin }) {
    const curYm = `${state.view.year}-${String(state.view.month).padStart(2, '0')}`;
    const [q, setQ] = useState('');
    const [action, setAction] = useState('all');
    const [prog, setProg] = useState(state.activeProgram);
    const [ym, setYm] = useState(curYm);
    const progName = (id) => { const p = (state.programs || []).find((x) => x.id === id); return p ? p.name : id; };
    const ymList = Array.from(new Set(state.changeLog.map((l) => l.ym).filter(Boolean))).sort().reverse();
    let logs = state.changeLog;
    if (prog !== 'all') logs = logs.filter((l) => l.programId === prog);
    if (ym !== 'all') logs = logs.filter((l) => l.ym === ym);
    if (action !== 'all') logs = logs.filter((l) => l.action === action);
    if (q.trim()) logs = logs.filter((l) => (l.productName || '').includes(q.trim()) || (l.teamName || '').includes(q.trim()) || (l.user || '').includes(q.trim()));
    function clearAll() {
      if (!confirm('변경 이력을 모두 삭제합니다. (편성·입찰 데이터는 그대로) 계속할까요?')) return;
      store.clearChangeLog();
    }

    // 상품별 이동 횟수 요약
    const moveSummary = useMemo(() => {
      const m = {};
      state.placements.forEach((p) => { if (p.moveCount > 0) m[p.productName] = (m[p.productName] || 0) + p.moveCount; });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    }, [state.placements]);

    const actions = ['all', ...Array.from(new Set(state.changeLog.map((l) => l.action)))];
    const actionColor = { 편성: '#16a34a', 이동: '#da291c', 편성제외: '#64748b', 입찰등록: '#0891b2',
      입찰수정: '#0891b2', 입찰삭제: '#64748b', 배정변경: '#7c3aed', 시간분할: '#d97706',
      시간추가: '#d97706', 시간삭제: '#64748b', 편성일추가: '#2563eb', 편성일삭제: '#64748b' };

    return html`
      <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick=${onClose}>
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick=${(e) => e.stopPropagation()}>
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h3 class="font-bold text-ink">변경 이력 추적</h3>
            <button onClick=${onClose} class="text-ink-soft hover:text-brand text-lg leading-none">✕</button>
          </div>

          ${moveSummary.length > 0 && html`
            <div class="px-4 py-2 bg-brand-light/60 border-b border-slate-200">
              <div class="text-[12px] font-semibold text-brand-dark mb-1">상품별 편성 이동 횟수</div>
              <div class="flex flex-wrap gap-1.5">
                ${moveSummary.map(([name, cnt]) => html`
                  <span key=${name} class="text-[12px] bg-white border border-brand/30 rounded px-2 py-0.5">
                    ${name} <b class="text-brand">${cnt}회</b></span>`)}
              </div>
            </div>`}

          <div class="flex items-center gap-2 px-4 py-2 border-b border-slate-200 flex-wrap">
            <select value=${prog} onChange=${(e) => setProg(e.target.value)} class="text-xs px-2 py-1 rounded border border-slate-300">
              <option value="all">전체 프로그램</option>
              ${(state.programs || []).map((p) => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
            </select>
            <select value=${ym} onChange=${(e) => setYm(e.target.value)} class="text-xs px-2 py-1 rounded border border-slate-300">
              <option value="all">전체 월</option>
              ${ymList.map((y) => html`<option key=${y} value=${y}>${y.replace('-', '년 ')}월</option>`)}
              ${!ymList.includes(curYm) ? html`<option value=${curYm}>${curYm.replace('-', '년 ')}월</option>` : ''}
            </select>
            <input value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="상품/팀/작성자 검색"
              class="text-xs px-2 py-1 rounded border border-slate-300 outline-none w-40" />
            <select value=${action} onChange=${(e) => setAction(e.target.value)} class="text-xs px-2 py-1 rounded border border-slate-300">
              ${actions.map((a) => html`<option key=${a} value=${a}>${a === 'all' ? '전체 동작' : a}</option>`)}
            </select>
            <span class="text-[11px] text-ink-soft ml-auto">${logs.length}건</span>
            ${isAdmin && html`<button onClick=${clearAll}
              class="text-[11px] px-2 py-1 rounded border border-rose-300 text-rose-600 bg-white hover:bg-rose-50 whitespace-nowrap" title="관리자 전용">이력 초기화 🔒</button>`}
          </div>

          <div class="flex-1 overflow-y-auto">
            <table class="w-full text-[12px]">
              <thead class="sticky top-0 bg-slate-50 text-ink-soft">
                <tr class="text-left">
                  <th class="px-3 py-1.5 font-medium w-32">시각</th>
                  <th class="px-3 py-1.5 font-medium w-24">수정자</th>
                  <th class="px-3 py-1.5 font-medium w-20">동작</th>
                  <th class="px-3 py-1.5 font-medium">상품 / 내용</th>
                  <th class="px-3 py-1.5 font-medium">이동 (from → to)</th>
                </tr>
              </thead>
              <tbody>
                ${logs.length === 0 && html`<tr><td colspan="5" class="text-center text-slate-400 py-8">이력이 없습니다</td></tr>`}
                ${logs.map((l) => html`
                  <tr key=${l.id} class="border-t border-slate-100 hover:bg-slate-50 align-top">
                    <td class="px-3 py-1.5 text-ink-soft tabular-nums whitespace-nowrap">${fmtTs(l.ts)}</td>
                    <td class="px-3 py-1.5 whitespace-nowrap font-medium ${l.user === 'system' || l.user === '익명' ? 'text-slate-400' : 'text-ink'}">${l.user || '—'}</td>
                    <td class="px-3 py-1.5"><${Badge} color=${actionColor[l.action]}>${l.action}<//></td>
                    <td class="px-3 py-1.5">
                      <div class="font-medium text-ink">${l.productName || l.detail}</div>
                      ${l.teamName && html`<div class="text-[11px] text-ink-soft">${l.teamName}${l.detail && l.productName ? ' · ' + l.detail : ''}</div>`}
                    </td>
                    <td class="px-3 py-1.5 text-ink-soft">
                      ${(l.from || l.to) && html`<span>${l.from || '—'}</span><span class="mx-1 text-brand">→</span><span>${l.to || '—'}</span>`}
                    </td>
                  </tr>`)}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  /* =====================================================================
   *  백업 / 복원
   * ===================================================================== */
  function BackupModal({ onClose, isAdmin }) {
    const [items, setItems] = useState(null);
    const [busy, setBusy] = useState('');
    const [msg, setMsg] = useState('');
    async function refresh() {
      const r = await store.listBackups();
      setItems(r.items || []);
      if (r.error) setMsg('목록 오류: ' + r.error);
    }
    useEffect(() => { refresh(); }, []);
    async function backupNow() {
      setBusy('now'); setMsg('');
      const r = await store.backupNow();
      setBusy('');
      setMsg(r.ok ? '✓ 백업 완료' : '백업 실패: ' + (r.error || ''));
      refresh();
    }
    async function restore(id) {
      if (!confirm('이 시점으로 전체 데이터(입찰·편성·시간대·이력)를 되돌립니다.\n현재 상태는 복원 직전 자동 백업되니 안심하세요. 계속할까요?')) return;
      setBusy(id); setMsg('');
      const r = await store.restoreBackup(id);
      setBusy('');
      if (r.ok) { onClose(); } else setMsg('복원 실패: ' + (r.error || ''));
    }
    function download() {
      try {
        const blob = new Blob([store.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `scheduler-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } catch (e) { setMsg('내보내기 실패: ' + e.message); }
    }
    return html`
      <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick=${onClose}>
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick=${(e) => e.stopPropagation()}>
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h3 class="font-bold text-ink">백업 / 복원</h3>
            <button onClick=${onClose} class="text-ink-soft hover:text-brand text-lg leading-none">✕</button>
          </div>
          <div class="px-4 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
            <button onClick=${backupNow} disabled=${busy === 'now'}
              class="text-[13px] font-semibold px-3 py-1.5 rounded bg-brand text-white hover:bg-brand-dark disabled:opacity-50">
              ${busy === 'now' ? '백업 중…' : '지금 백업'}</button>
            <button onClick=${download}
              class="text-[13px] px-3 py-1.5 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand">JSON 내보내기</button>
            <button onClick=${refresh}
              class="text-[13px] px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand">새로고침</button>
            ${msg && html`<span class="text-[12px] ${msg.startsWith('✓') ? 'text-emerald-600' : 'text-brand'}">${msg}</span>`}
          </div>
          <div class="px-4 py-2 text-[11px] text-ink-soft border-b border-slate-100 bg-slate-50">
            변경이 있으면 <b>최대 1시간마다 자동 백업</b>되고, 복원 직전에도 자동 백업됩니다. 최근 60개 보관(이전 것은 자동 삭제).
          </div>
          <div class="flex-1 overflow-y-auto">
            ${items === null
              ? html`<div class="text-center text-slate-400 py-10 text-sm">불러오는 중…</div>`
              : items.length === 0
                ? html`<div class="text-center text-slate-400 py-10 text-sm">백업이 없습니다. “지금 백업”을 눌러 첫 백업을 만드세요.</div>`
                : html`<table class="w-full text-[13px]">
                    <thead class="sticky top-0 bg-slate-50 text-ink-soft text-left">
                      <tr><th class="px-4 py-2 font-medium">백업 시각</th><th class="px-3 py-2 font-medium">종류</th><th class="px-3 py-2 font-medium text-right">동작</th></tr>
                    </thead>
                    <tbody>
                      ${items.map((b) => html`
                        <tr key=${b.id} class="border-t border-slate-100 hover:bg-slate-50">
                          <td class="px-4 py-2 tabular-nums whitespace-nowrap">${fmtTs(b.ts)}</td>
                          <td class="px-3 py-2"><${Badge} color=${b.kind === 'manual' ? '#da291c' : '#0891b2'}>${b.kind === 'manual' ? '수동' : '자동'}<//></td>
                          <td class="px-3 py-2 text-right">
                            ${isAdmin
                              ? html`<button onClick=${() => restore(b.id)} disabled=${busy === b.id}
                                  class="text-[12px] text-brand hover:underline disabled:opacity-50">${busy === b.id ? '복원 중…' : '이 시점으로 복원'}</button>`
                              : html`<span class="text-[11px] text-slate-400" title="복원은 관리자만 가능합니다">🔒 관리자 전용</span>`}
                          </td>
                        </tr>`)}
                    </tbody>
                  </table>`}
          </div>
        </div>
      </div>`;
  }

  /* =====================================================================
   *  공용 모달 / 폼 요소
   * ===================================================================== */
  const inputCls = 'w-full text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none';
  // 24시간제 시간 입력 (오전/오후 없이 HH:MM) — type=time 의 로케일 12시간 표기 회피
  function normTime(v) {
    v = String(v == null ? '' : v).replace(/[^\d:]/g, '');
    if (v.indexOf(':') === -1 && v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2, 4);
    const i = v.indexOf(':');
    if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/:/g, '');
    return v.slice(0, 5);
  }
  function TimeInput({ value, onChange, className }) {
    return html`<input type="text" inputmode="numeric" maxlength="5" value=${value || ''}
      onInput=${(e) => onChange(normTime(e.target.value))}
      placeholder="20:45" class=${`${className || inputCls} tabular-nums`} />`;
  }
  function Field({ label, children }) {
    return html`<label class="block"><div class="text-[12px] font-medium text-ink-soft mb-1">${label}</div>${children}</label>`;
  }
  function Modal({ title, children, onClose, onSave, extra }) {
    useEffect(() => {
      const h = (e) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, []);
    return html`
      <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
        onClick=${(e) => e.stopPropagation()} onDoubleClick=${(e) => e.stopPropagation()}>
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col">
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h3 class="font-bold text-ink text-sm">${title}</h3>
            <button onClick=${onClose} class="text-ink-soft hover:text-brand text-lg leading-none" title="닫기">✕</button>
          </div>
          <div class="flex-1 overflow-y-auto px-4 py-3 space-y-3">${children}</div>
          <div class="flex items-center gap-2 px-4 py-3 border-t border-slate-200">
            ${extra}
            <button onClick=${onClose} class="ml-auto text-[13px] px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">취소</button>
            <button onClick=${onSave} class="text-[13px] px-4 py-1.5 rounded bg-brand text-white hover:bg-brand-dark">저장</button>
          </div>
        </div>
      </div>`;
  }

  const fmtTs = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  /* =====================================================================
   *  프로그램 탭 (엑셀/크롬 탭처럼)
   * ===================================================================== */
  function ProgramTabs({ state, isAdmin }) {
    const [addOpen, setAddOpen] = useState(false);
    // 배지 = 현재 보는 월의 프로그램별 편성(상품 배치) 건수
    const ym = `${state.view.year}-${String(state.view.month).padStart(2, '0')}`;
    const counts = useMemo(() => {
      const slotMonth = {};
      state.days.forEach((d) => d.slots.forEach((s) => { slotMonth[s.id] = d.date.slice(0, 7); }));
      const byProg = {};
      state.placements.forEach((p) => { if (p.programId && slotMonth[p.slotId] === ym) byProg[p.programId] = (byProg[p.programId] || 0) + 1; });
      return byProg;
    }, [state.placements, state.days, ym]);
    const meta = state.programMeta || {};
    return html`
      <div class="flex items-stretch gap-0.5 px-2 pt-1.5 bg-slate-200/70 overflow-x-auto">
        ${(state.programs || []).map((p) => {
          const active = p.id === state.activeProgram;
          const custom = meta[p.id] && meta[p.id].custom;
          return html`
            <button key=${p.id} onClick=${() => store.setActiveProgram(p.id)}
              title=${`${p.name} · ${state.view.month}월 편성 ${counts[p.id] || 0}건`}
              class=${`group flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-t-lg text-[12.5px] border-t border-x transition
                ${active ? 'bg-white border-slate-300 font-bold text-ink -mb-px' : 'bg-slate-100 border-transparent text-ink-soft hover:bg-slate-50'}`}>
              <span class="inline-block w-2 h-2 rounded-full" style=${{ background: p.color }}></span>
              ${p.name}
              ${counts[p.id] ? html`<span class=${`text-[10px] px-1 rounded ${active ? 'bg-slate-100 text-ink-soft' : 'bg-slate-200 text-slate-500'}`}>${counts[p.id]}</span>` : ''}
              ${isAdmin && custom && html`<span role="button" title="이 프로그램 삭제(관리자)"
                onClick=${(e) => { e.stopPropagation(); if (confirm(`[${p.name}] 프로그램을 삭제할까요?\n이 프로그램의 편성일·편성·입찰이 모두 삭제됩니다.`)) store.removeProgram(p.id); }}
                class="ml-0.5 text-[11px] text-slate-400 hover:text-brand">✕</span>`}
            </button>`;
        })}
        ${isAdmin && html`<button onClick=${() => setAddOpen(true)} title="테마 프로그램 추가 (관리자)"
          class="ml-1 shrink-0 px-2.5 py-1.5 rounded-t-lg text-[12.5px] font-semibold text-brand bg-slate-100 border-t border-x border-transparent hover:bg-white">+ 프로그램</button>`}
        ${addOpen && html`<${AddProgramModal} state=${state} onClose=${() => setAddOpen(false)} />`}
      </div>`;
  }

  /* =====================================================================
   *  프로그램 생성 모달 (관리자) — 시간대/요일 선택 · 비정기(수기) 지원
   * ===================================================================== */
  function AddProgramModal({ state, onClose }) {
    const WD = ['일', '월', '화', '수', '목', '금', '토'];
    const [name, setName] = useState('');
    const [fashion, setFashion] = useState(false);
    const [irregular, setIrregular] = useState(false);
    const [wdSel, setWdSel] = useState({}); // { wd: {start,end} }
    const [teamSel, setTeamSel] = useState({}); // { teamId: true }
    const teamsByDiv = (() => {
      const g = {};
      (state.teams || []).forEach((t) => { const d = t.div || '기타'; (g[d] = g[d] || []).push(t); });
      return g;
    })();
    const toggleTeam = (id) => setTeamSel((p) => { const n = { ...p }; if (n[id]) delete n[id]; else n[id] = true; return n; });
    const toggleWd = (wd) => setWdSel((prev) => {
      const n = { ...prev };
      if (n[wd]) delete n[wd]; else n[wd] = { start: '', end: '' };
      return n;
    });
    const setTime = (wd, key, val) => setWdSel((prev) => ({ ...prev, [wd]: { ...prev[wd], [key]: val } }));
    function save() {
      if (!name.trim()) { alert('프로그램명을 입력하세요.'); return; }
      let schedule = [];
      if (!irregular) {
        const wds = Object.keys(wdSel);
        if (!wds.length) { alert('요일을 하나 이상 선택하거나 "비정기"를 체크하세요.'); return; }
        for (const wd of wds) {
          const { start, end } = wdSel[wd];
          if (!start || !end) { alert(`${WD[wd]}요일의 시작·종료 시간을 입력하세요.`); return; }
          schedule.push({ wd: Number(wd), slots: [[start, end]] });
        }
      }
      const teamIds = Object.keys(teamSel);
      if (!teamIds.length) { alert('대상 팀을 하나 이상 선택하세요.'); return; }
      const r = store.addProgram({ name: name.trim(), fashion, irregular, schedule, teamIds });
      if (r && r.error) { alert(r.error); return; }
      onClose();
    }
    return html`
      <${Modal} title="테마 프로그램 추가" onClose=${onClose} onSave=${save}>
        <${Field} label="프로그램명 *"><input value=${name} onInput=${(e) => setName(e.target.value)} class=${inputCls} placeholder="예: 새 특집쇼" autofocus /><//>
        <div class="flex flex-wrap gap-4">
          <label class="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked=${fashion} onChange=${(e) => setFashion(e.target.checked)} /> 패션형 (1부·2부 순번, 방송시간은 날짜 옆)</label>
          <label class="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked=${irregular} onChange=${(e) => setIrregular(e.target.checked)} /> 비정기 (요일 고정 없음 · 편성일 수기 추가)</label>
        </div>
        ${!irregular && html`
          <${Field} label="정기 방송 요일 · 시간">
            <div class="flex flex-wrap gap-1 mb-2">
              ${WD.map((w, wd) => html`<button key=${wd} type="button" onClick=${() => toggleWd(wd)}
                class=${`w-9 h-9 rounded text-[13px] border ${wdSel[wd] ? 'bg-brand text-white border-brand' : 'bg-white border-slate-300 text-ink-soft hover:border-brand'}`}>${w}</button>`)}
            </div>
            <div class="space-y-1.5">
              ${Object.keys(wdSel).sort().map((wd) => html`
                <div key=${wd} class="flex items-center gap-2 text-[13px]">
                  <span class="w-12 font-semibold text-ink">${WD[wd]}요일</span>
                  <${TimeInput} value=${wdSel[wd].start} onChange=${(v) => setTime(wd, 'start', v)} className="w-24 text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none" />
                  <span class="text-ink-soft">~</span>
                  <${TimeInput} value=${wdSel[wd].end} onChange=${(v) => setTime(wd, 'end', v)} className="w-24 text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none" />
                </div>`)}
              ${Object.keys(wdSel).length === 0 && html`<div class="text-[12px] text-slate-400">요일 버튼을 눌러 방송 요일을 선택하세요. (시간대는 편성표에서 추가로 나눌 수 있음)</div>`}
            </div>
          <//>`}
        <${Field} label=${`대상 입찰팀 * (선택 ${Object.keys(teamSel).length}팀)`}>
          <div class="space-y-2 max-h-56 overflow-y-auto border border-slate-200 rounded p-2">
            ${Object.keys(teamsByDiv).map((div) => html`
              <div key=${div}>
                <div class="text-[11px] font-semibold text-ink-soft mb-1">${div}</div>
                <div class="flex flex-wrap gap-1">
                  ${teamsByDiv[div].map((t) => html`<button key=${t.id} type="button" onClick=${() => toggleTeam(t.id)}
                    class=${`text-[12px] px-2 py-1 rounded-full border ${teamSel[t.id] ? 'text-white border-transparent' : 'bg-white text-ink-soft border-slate-300 hover:border-slate-400'}`}
                    style=${teamSel[t.id] ? { background: t.color } : {}}>${t.name}</button>`)}
                </div>
              </div>`)}
          </div>
        <//>
        <div class="text-[12px] text-ink-soft">비정기 프로그램은 요일 없이 만들고, 편성표에서 <b>+ 편성일 추가</b> / <b>+ 시간대</b>로 건바이건 편성합니다. 팀은 나중에 <b>팀 관리</b>에서 추가/수정할 수 있습니다.</div>
      <//>`;
  }

  /* =====================================================================
   *  월/연 네비게이션
   * ===================================================================== */
  function MonthNav({ view }) {
    const years = [];
    for (let y = 2026; y <= view.year + 1 && y <= 2030; y++) years.push(y);
    if (!years.includes(view.year)) years.unshift(view.year);
    return html`
      <div class="ml-3 flex items-center gap-1 bg-slate-100 rounded-lg px-1 py-0.5">
        <button onClick=${() => store.shiftView(-1)} title="이전 달"
          class="w-7 h-7 grid place-items-center rounded hover:bg-white text-ink-soft text-lg leading-none">‹</button>
        <select value=${view.year} onChange=${(e) => store.setView(Number(e.target.value), view.month)}
          class="bg-transparent text-sm font-bold text-ink outline-none cursor-pointer">
          ${years.map((y) => html`<option key=${y} value=${y}>${y}년</option>`)}
        </select>
        <select value=${view.month} onChange=${(e) => store.setView(view.year, Number(e.target.value))}
          class="bg-transparent text-sm font-bold text-ink outline-none cursor-pointer">
          ${Array.from({ length: 12 }, (_, i) => i + 1).map((m) => html`<option key=${m} value=${m}>${m}월</option>`)}
        </select>
        <button onClick=${() => store.shiftView(1)} title="다음 달"
          class="w-7 h-7 grid place-items-center rounded hover:bg-white text-ink-soft text-lg leading-none">›</button>
      </div>`;
  }

  /* =====================================================================
   *  로그인 게이트 (역할별 공용 비밀번호)
   * ===================================================================== */
  function loadAuth() {
    try {
      const raw = localStorage.getItem(window.AUTH.storageKey);
      if (raw) { const a = JSON.parse(raw); if (a && window.AUTH.roles[a.role]) return a; }
    } catch (e) {}
    return null;
  }
  function LoginGate({ onLogin, teams }) {
    const roles = window.AUTH.roles;
    const [role, setRole] = useState('pd');
    const [team, setTeam] = useState('');
    const [name, setName] = useState('');
    const [pw, setPw] = useState('');
    const [err, setErr] = useState('');
    const r = roles[role];
    // 팀 목록: MD = 앱 전체 팀, PD = 지정 PD 구분
    const teamList = role === 'md'
      ? (window.AUTH.mdTeams || Array.from(new Set((teams || []).map((t) => t.name))))
      : (window.AUTH.pdTeams || []);
    const needsTeam = role !== 'admin'; // 관리자는 비밀번호만 입력
    function submit(e) {
      e && e.preventDefault();
      if (needsTeam) {
        if (!team) { setErr('팀(소속)을 선택하세요.'); return; }
        if (!name.trim()) { setErr('이름을 입력하세요.'); return; }
      }
      if (pw !== r.password) { setErr('비밀번호가 올바르지 않습니다.'); return; }
      onLogin(needsTeam ? { role, team, name: name.trim() } : { role, team: '', name: '관리자' });
    }
    return html`
      <div class="min-h-screen grid place-items-center bg-slate-100 p-4">
        <form onSubmit=${submit} class="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
          <div class="flex items-center gap-2 mb-1">
            <div class="w-9 h-9 rounded-lg bg-brand text-white grid place-items-center font-black text-[11px] leading-none">PGM</div>
            <div>
              <div class="font-extrabold text-ink leading-tight">테마PGM 편성 스케줄러</div>
              <div class="text-[11px] text-ink-soft">롯데홈쇼핑 방송제작부문</div>
            </div>
          </div>
          <div class="text-[12px] font-medium text-ink-soft mt-4 mb-1.5">역할 선택</div>
          <div class="grid grid-cols-3 gap-2">
            ${Object.entries(roles).map(([key, cfg]) => html`
              <button type="button" key=${key} onClick=${() => { setRole(key); setTeam(''); setErr(''); }}
                class=${`rounded-lg border px-2 py-2 text-center transition ${role === key ? 'border-transparent text-white shadow' : 'border-slate-300 bg-white text-ink hover:border-slate-400'}`}
                style=${role === key ? { background: cfg.color } : {}}>
                <div class="font-bold text-sm">${cfg.label}</div>
                <div class=${`text-[10px] leading-tight mt-0.5 ${role === key ? 'text-white/85' : 'text-ink-soft'}`}>${cfg.desc}</div>
              </button>`)}
          </div>
          <div class="mt-4 space-y-2.5">
            ${needsTeam && html`
            <label class="block">
              <div class="text-[12px] font-medium text-ink-soft mb-1">팀 / 소속 <span class="text-brand">*</span></div>
              <select value=${team} onChange=${(e) => setTeam(e.target.value)} class=${inputCls}>
                <option value="">${role === 'md' ? '입찰 팀 선택' : 'PD 구분 선택'}</option>
                ${teamList.map((t) => html`<option key=${t} value=${t}>${t}</option>`)}
              </select>
            </label>
            <label class="block">
              <div class="text-[12px] font-medium text-ink-soft mb-1">이름 <span class="text-brand">*</span></div>
              <input value=${name} onInput=${(e) => setName(e.target.value)} class=${inputCls}
                placeholder="예: 홍길동" />
            </label>`}
            <label class="block">
              <div class="text-[12px] font-medium text-ink-soft mb-1">${r.label} 공용 비밀번호 <span class="text-brand">*</span></div>
              <input type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} class=${inputCls} placeholder="비밀번호" autofocus=${!needsTeam} />
            </label>
          </div>
          ${!needsTeam && html`<div class="mt-2 text-[12px] text-ink-soft">관리자는 비밀번호만 입력하면 입장합니다.</div>`}
          ${err && html`<div class="mt-2 text-[12px] text-brand">${err}</div>`}
          <button type="submit" class="mt-4 w-full py-2 rounded-lg bg-brand text-white font-semibold hover:bg-brand-dark">입장</button>
          <div class="mt-3 text-[11px] text-slate-400 leading-relaxed">
            팀·이름은 필수이며, 모든 수정 내역(변경 이력 · 카드 “마지막 수정”)에 자동 기록됩니다. 비밀번호 입력 후 Enter로도 입장됩니다.
          </div>
        </form>
      </div>`;
  }

  /* =====================================================================
   *  앱 루트
   * ===================================================================== */
  function App() {
    const state = useStore();
    const [auth, setAuth] = useState(loadAuth);
    // 접속 시 기본 탭 = 로그인한 역할의 첫 탭 (MD→입찰보드, PD/관리자→최종편성안)
    const [tab, setTab] = useState(() => {
      const a = loadAuth();
      const r = a && window.AUTH.roles[a.role];
      return r ? r.tabs[0] : 'schedule';
    }); // schedule | bids | final
    const [history, setHistory] = useState(false);
    const [backup, setBackup] = useState(false);
    const [teamMgr, setTeamMgr] = useState(false);
    const [sbStatus, setSbStatus] = useState(
      (window.SUPABASE && window.SUPABASE.enabled) ? 'connecting' : null);
    useEffect(() => {
      window.__SB_STATUS = (s) => setSbStatus(s);
      return () => { window.__SB_STATUS = null; };
    }, []);
    // 로그인 식별을 데이터 계층에 반영 → 이후 모든 변경이 이 이름으로 기록됨
    const displayName = (a) => `${a && a.team ? a.team + ' ' : ''}${(a && a.name) || ''}`.trim();
    useEffect(() => { if (auth) store.setUser(displayName(auth)); }, [auth]);
    // (고정 편성시간대는 월 이동·프로그램 선택 시 자동 생성 — 로드 직후 자동저장은 제거:
    //  하이드레이트 전 옛 로컬 상태가 서버로 되돌아가는 것을 방지)

    // Ctrl/Cmd+Z 되돌리기, Ctrl/Cmd+Shift+Z 또는 Ctrl+Y 다시
    useEffect(() => {
      const onKey = (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        const k = e.key.toLowerCase();
        if (k !== 'z' && k !== 'y') return;
        const t = e.target;
        // 입력칸/선택에서 타이핑 중이면 브라우저 기본 되돌리기에 맡김
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        e.preventDefault();
        if (k === 'y' || (k === 'z' && e.shiftKey)) store.redo();
        else store.undo();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);

    // 오래 방치된 화면 자동 리프레시: 30분간 조작이 없으면 새로고침 →
    // 초기 화면(최유라쇼 + 역할 기본 탭)으로 복귀 + 최신 데이터/버전 반영.
    // (모든 편집은 즉시 자동 저장되므로 새로고침으로 유실되지 않음)
    useEffect(() => {
      const IDLE_MS = 30 * 60 * 1000;
      let timer = null;
      const reset = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (document.visibilityState === 'visible') window.location.reload();
        }, IDLE_MS);
      };
      const evs = ['mousedown', 'keydown', 'touchstart', 'scroll'];
      evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
      reset();
      return () => {
        if (timer) clearTimeout(timer);
        evs.forEach((e) => window.removeEventListener(e, reset));
      };
    }, []);

    function doLogin(a) {
      try { localStorage.setItem(window.AUTH.storageKey, JSON.stringify({ ...a, ts: Date.now() })); } catch (e) {}
      store.setUser(displayName(a));
      setTab(window.AUTH.roles[a.role].tabs[0]);
      setAuth(a);
    }
    function logout() {
      if (!confirm('로그아웃할까요?')) return;
      try { localStorage.removeItem(window.AUTH.storageKey); } catch (e) {}
      store.setUser(null);
      setAuth(null);
    }

    // 미로그인 → 로그인 화면 (이 아래의 훅 없음: 훅 순서 유지)
    if (!auth) return html`<${LoginGate} onLogin=${doLogin} teams=${state.teams} />`;

    const roleCfg = window.AUTH.roles[auth.role] || { tabs: ['schedule'], canManage: true, label: '', color: '#64748b' };
    const allowed = roleCfg.tabs;
    const curTab = allowed.includes(tab) ? tab : allowed[0];

    return html`
      <div class="flex flex-col h-screen">
        <header class="shrink-0 bg-white border-b border-slate-200">
          <div class="flex items-center gap-x-3 gap-y-2 px-4 py-2 flex-wrap">
            <div class="flex items-center gap-2 shrink-0">
              <div class="w-8 h-8 rounded-lg bg-brand text-white grid place-items-center font-black text-[11px] leading-none shrink-0">PGM</div>
              <div class="min-w-0">
                <div class="font-extrabold text-ink leading-tight whitespace-nowrap">테마PGM 편성 스케줄러</div>
                <div class="text-[11px] text-ink-soft flex items-center gap-1 whitespace-nowrap">
                  롯데홈쇼핑
                  ${sbStatus && (() => {
                    const warn = sbStatus === 'connecting' || sbStatus === 'local';
                    const txt = sbStatus === 'connecting' ? '서버 연결 중…'
                      : sbStatus === 'local' ? '로컬 저장 (서버 대기)'
                      : sbStatus === 'saved' ? '서버 저장됨' : '서버 연결됨';
                    return html`<span class=${`ml-1 inline-flex items-center gap-1 px-1.5 rounded ${warn ? 'text-amber-600' : 'text-emerald-600'}`}>
                      <span class=${`w-1.5 h-1.5 rounded-full ${warn ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>${txt}</span>`;
                  })()}
                </div>
              </div>
            </div>
            <div class="shrink-0"><${MonthNav} view=${state.view} /></div>
            <nav class="flex items-center gap-1 shrink-0">
              ${allowed.includes('bids') && html`<button onClick=${() => setTab('bids')}
                class=${tabCls(curTab === 'bids')}>MD 입찰보드</button>`}
              ${allowed.includes('schedule') && html`<button onClick=${() => setTab('schedule')}
                class=${tabCls(curTab === 'schedule')}>PD 편성표</button>`}
              ${allowed.includes('final') && html`<button onClick=${() => setTab('final')}
                class=${tabCls(curTab === 'final')}>최종편성안</button>`}
              ${allowed.includes('finalview') && html`<button onClick=${() => setTab('finalview')}
                class=${tabCls(curTab === 'finalview')}>최종편성안 조회</button>`}
            </nav>
            <div class="ml-auto flex items-center gap-2 flex-wrap justify-end">
              <span class="flex items-center gap-1 text-[12px] px-2 py-1 rounded-full whitespace-nowrap shrink-0"
                style=${{ background: roleCfg.color + '18', color: roleCfg.color }} title="현재 로그인 — 모든 수정이 이 이름으로 기록됩니다">
                <span class="w-1.5 h-1.5 rounded-full" style=${{ background: roleCfg.color }}></span>
                <b>${roleCfg.label}</b><span class="opacity-80">· ${displayName(auth)}</span>
              </span>
              <div class="flex items-center rounded border border-slate-300 bg-white overflow-hidden shrink-0">
                <button onClick=${() => store.undo()} disabled=${!store.canUndo()}
                  class="px-2 py-1.5 text-[13px] hover:bg-slate-100 disabled:opacity-30 disabled:cursor-default"
                  title="되돌리기 (Ctrl/Cmd+Z)">↶</button>
                <button onClick=${() => store.redo()} disabled=${!store.canRedo()}
                  class="px-2 py-1.5 text-[13px] border-l border-slate-200 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-default"
                  title="다시 (Ctrl/Cmd+Shift+Z)">↷</button>
              </div>
              <button onClick=${() => setHistory(true)}
                class="text-[13px] px-3 py-1.5 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand whitespace-nowrap shrink-0">
                변경 이력 <span class="text-[11px] text-ink-soft">(${state.changeLog.length})</span>
              </button>
              ${roleCfg.isAdmin && html`<button onClick=${() => setTeamMgr(true)}
                class="text-[13px] px-3 py-1.5 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand whitespace-nowrap shrink-0"
                title="입찰팀 추가/수정/삭제 (조직개편)">🏷 팀 관리</button>`}
              ${roleCfg.canManage && html`<button onClick=${() => setBackup(true)}
                class="text-[13px] px-3 py-1.5 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand whitespace-nowrap shrink-0"
                title="자동 백업 목록 / 특정 시점으로 복원">백업/복원</button>`}
              <button onClick=${logout}
                class="text-[12px] px-2 py-1.5 rounded border border-slate-300 text-ink-soft hover:border-brand hover:text-brand whitespace-nowrap shrink-0" title="로그아웃">로그아웃</button>
            </div>
          </div>
        </header>

        <${ProgramTabs} state=${state} isAdmin=${!!roleCfg.isAdmin} />

        <main class="flex-1 min-h-0 flex flex-col border-t border-slate-300">
          ${curTab === 'schedule' ? html`<${ScheduleView} state=${state} onSaved=${() => setTab('final')} />`
            : curTab === 'final' ? html`<${FinalScheduleView} state=${state} />`
            : curTab === 'finalview' ? html`<${FinalScheduleView} state=${state} readOnly=${true} />`
            : html`<${BidBoard} state=${state} />`}
        </main>

        ${history && html`<${HistoryModal} state=${state} isAdmin=${roleCfg.isAdmin} onClose=${() => setHistory(false)} />`}
        ${backup && html`<${BackupModal} isAdmin=${roleCfg.isAdmin} onClose=${() => setBackup(false)} />`}
        ${teamMgr && html`<${TeamManagerModal} state=${state} onClose=${() => setTeamMgr(false)} />`}
      </div>`;
  }
  const tabCls = (active) =>
    `text-[13px] font-semibold px-3 py-1.5 rounded-lg transition whitespace-nowrap shrink-0 ${active ? 'bg-brand text-white' : 'text-ink-soft hover:bg-slate-100'}`;

  ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
})();
