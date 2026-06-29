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
  const daysInView = (state) => state.days.filter((d) =>
    d.programId === state.activeProgram && d.date.slice(0, 7) === monthKey(state.view));
  const activeProgramObj = (state) =>
    (state.programs || []).find((p) => p.id === state.activeProgram) || { name: '', color: '#da291c' };

  // 프로그램별 입찰팀 / 작성항목 스키마 (window.PROGRAM_CONFIG)
  const PCONF = () => (typeof window !== 'undefined' && window.PROGRAM_CONFIG) || { teams: [], programs: {} };
  const programCfg = (state) => PCONF().programs[state.activeProgram] || null;
  const programTeams = (state) => {
    const cfg = programCfg(state);
    const ids = cfg ? cfg.teamIds : state.teams.map((t) => t.id);
    return ids.map((id) => state.teams.find((t) => t.id === id)).filter(Boolean);
  };
  const programSchema = (state) => (programCfg(state) || {}).schema || 'lifestyle';
  // 시간 슬롯 표시: 시간이 있으면 HH:MM~HH:MM, 순번형이면 label
  const slotName = (s) => (s.start && s.end) ? `${s.start}~${s.end}` : (s.label || '슬롯');

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
    const rows = [
      ['편성 시간', U.slotLabel(p.slotId)],
      ['그룹코드', det.groupCode],
      ['내용 / 타이틀', det.note],
      ['이슈 / 특이사항', det.issue],
      ['구성', det.comp],
      ['준비물량', det.prep],
      ['가격', det.price],
      ['마진', det.margin],
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
            <button onClick=${(e) => { e.stopPropagation(); onClose(); }} class="text-ink-soft hover:text-brand text-lg leading-none">✕</button>
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
          ? html`<${Field} label=${`방송 시간 — ${dur}분`}>
              <div class="flex items-center gap-1.5">
                <input type="time" value=${s} onInput=${(ev) => setS(ev.target.value)} class=${inputCls} />
                <span class="text-ink-soft">~</span>
                <input type="time" value=${e} onInput=${(ev) => setE(ev.target.value)} class=${inputCls} />
              </div>
              <div class="text-[11px] text-ink-soft mt-1">큰 띠 안에서 자유롭게 (예: 20:45~21:05 = 20분)</div>
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
    const dur = U.slotDuration(slot);
    const placements = state.placements.filter((p) => p.slotId === slot.id);
    const teamsIn = new Set(placements.map((p) => p.teamId));
    // 경쟁: 같은 시간대에 2팀 이상 → 노란불, 3팀+ → 빨간불
    const compete = teamsIn.size;
    const compColor = compete >= 3 ? '#dc2626' : compete === 2 ? '#f59e0b' : null;

    function onDrop(e) {
      e.preventDefault(); setOver(false);
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
        <div class="flex flex-col gap-1.5 p-1.5 min-h-[52px]">
          ${placements.length === 0
            ? html`<div class="text-[11px] text-slate-400 text-center py-2 select-none">입찰 카드를 끌어다 놓으세요</div>`
            : placements.map((p) => html`<${PlacementCard} key=${p.id} state=${state} p=${p} onEdit=${onEdit} />`)}
        </div>
        ${splitOpen && html`<${SplitModal} slot=${slot} dur=${dur} onClose=${() => setSplitOpen(false)} />`}
      </div>`;
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
  function DayBlock({ state, day, onEdit }) {
    const isThu = day.weekday === 4, isSat = day.weekday === 6;
    const accent = isThu ? '#da291c' : isSat ? '#2563eb' : '#7c3aed';
    const [addOpen, setAddOpen] = useState(false);
    return html`
      <div class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2 text-white" style=${{ background: accent }}>
          <div class="font-bold text-sm">${fmtDay(day)}</div>
          <div class="flex items-center gap-2 text-[11px]">
            <button onClick=${() => setAddOpen(true)} class="hover:underline">+ 시간대</button>
            <button onClick=${() => store.addSlot(day.id, { order: true })} class="hover:underline">+ 순번</button>
            <button onClick=${() => confirm(`${fmtDay(day)} 편성일을 삭제할까요?`) && store.removeDay(day.id)}
              class="hover:underline opacity-80">삭제</button>
          </div>
        </div>
        <div class="p-2 grid gap-2" style=${{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          ${day.slots.length === 0
            ? html`<div class="text-[12px] text-slate-400 py-3 text-center col-span-full">시간대가 없습니다. “+ 시간대”로 추가하세요.</div>`
            : day.slots.map((s) => html`<${SlotCell} key=${s.id} state=${state} day=${day} slot=${s} onEdit=${onEdit} />`)}
        </div>
        ${addOpen && html`<${AddSlotModal} day=${day} onClose=${() => setAddOpen(false)} />`}
      </div>`;
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
          <${Field} label="시작 시간"><input type="time" value=${start} onInput=${(e) => setStart(e.target.value)} class=${inputCls} /><//>
          <${Field} label="종료 시간"><input type="time" value=${end} onInput=${(e) => setEnd(e.target.value)} class=${inputCls} /><//>
        </div>
        <div class="text-[12px] text-ink-soft">특별편성 등으로 앞뒤 시간대를 추가할 수 있습니다.</div>
      <//>`;
  }

  /* =====================================================================
   *  입찰 풀 (PD 편성표 좌측 사이드바)
   * ===================================================================== */
  function BidPool({ state }) {
    const [team, setTeam] = useState('all');
    const [q, setQ] = useState('');
    const [detail, setDetail] = useState(null);
    const placedBidIds = new Set(state.placements.map((p) => p.sourceBidId).filter(Boolean));
    const monthDayIds = new Set(daysInView(state).map((d) => d.id));
    // 편성표에 올라가지 않은(미편성) 입찰만 풀에 표시
    let bids = state.bids.filter((b) => monthDayIds.has(b.dayId) && !placedBidIds.has(b.id));
    if (team !== 'all') bids = bids.filter((b) => b.teamId === team);
    if (q.trim()) bids = bids.filter((b) => (b.product.name || '').includes(q.trim()));

    return html`
      <aside class="w-64 shrink-0 flex flex-col border-r border-slate-200 bg-white">
        <div class="px-3 py-2 border-b border-slate-200">
          <div class="text-sm font-bold text-ink">입찰 풀 <span class="text-[11px] font-normal text-ink-soft">${state.view.month}월 · ${bids.length}건</span></div>
          <div class="text-[11px] text-ink-soft mt-0.5">카드 클릭=상세 / 드래그=편성</div>
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
            return html`
              <div key=${b.id} draggable=${true} onDragStart=${(e) => drag.start(e, 'bid', b.id)}
                onClick=${() => setDetail(b)} title="클릭하면 상세 정보"
                class=${`card-drag rounded-md border px-2 py-1.5 ${placed ? 'bg-slate-100 opacity-70' : 'bg-white'} hover:shadow-sm hover:border-brand`}
                style=${{ borderLeft: `4px solid ${t.color}` }}>
                <div class="text-[12px] font-semibold text-ink leading-tight">${pr.name}</div>
                <div class="mt-0.5 flex flex-wrap items-center gap-1">
                  <${Badge} color=${t.color}>${t.name}<//>
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
    function fillFromBids() {
      if (!confirm(`${year}년 ${month}월 — 기존 편성을 지우고, 입찰보드의 입찰을 편성표에 일괄 반영합니다.\n계속할까요?`)) return;
      const r = store.fillScheduleFromBids(year, month);
      alert(`완료: 기존 ${r.removed}건 삭제 · 입찰 ${r.placed}건을 편성표에 반영했습니다.`);
    }
    return html`
      <div class="flex flex-1 min-h-0">
        <${BidPool} state=${state} />
        <div class="flex-1 overflow-y-auto p-4">
          <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h2 class="text-base font-bold text-ink">${year}년 ${month}월 편성표
              <span class="text-[12px] font-normal text-ink-soft">방송일 ${days.length}일 · 편성 ${placedCount}건</span>
              ${lastSnap
                ? html`<span class="text-[11px] font-normal text-emerald-600 ml-1">· 마지막 저장 ${fmtTs(lastSnap.ts)}</span>`
                : html`<span class="text-[11px] font-normal text-slate-400 ml-1">· 저장 안 됨</span>`}
            </h2>
            <div class="flex items-center gap-2">
              <button onClick=${fillFromBids}
                class="text-xs px-2.5 py-1 rounded border border-cyan-300 text-cyan-700 bg-white hover:bg-cyan-50"
                title="이 달의 입찰을 편성표에 일괄 반영 (기존 편성은 교체)">입찰 일괄 편성</button>
              <button onClick=${() => setAddDayOpen(true)}
                class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand">+ 편성일 추가</button>
              <button onClick=${() => setSnapOpen(true)}
                class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand">저장본 ${snaps.length}</button>
              <button onClick=${() => setSaveOpen(true)}
                class="text-xs font-semibold px-3 py-1 rounded bg-brand text-white hover:bg-brand-dark">편성 저장</button>
            </div>
          </div>
          <div class="space-y-4">
            ${days.length === 0 && html`<div class="text-sm text-slate-400 py-10 text-center">이 달에는 편성일이 없습니다. “+ 편성일 추가”로 추가하세요.</div>`}
            ${groupByWeek(days).map(([wk, days]) => html`
              <div key=${wk} class="flex flex-wrap gap-3 items-start">
                ${days.map((d) => html`
                  <div class="flex-1 min-w-[300px]">
                    <${DayBlock} state=${state} day=${d} onEdit=${setEditing} />
                  </div>`)}
              </div>`)}
          </div>
        </div>
        ${editing && html`<${MetaEditor} p=${editing} onClose=${() => setEditing(null)} />`}
        ${snapOpen && html`<${SnapshotsModal} state=${state} onClose=${() => setSnapOpen(false)} />`}
        ${addDayOpen && html`<${AddDayModal} state=${state} onClose=${() => setAddDayOpen(false)} />`}
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
  function EditCell({ value, onCommit, placeholder, color }) {
    const [v, setV] = useState(value || '');
    useEffect(() => { setV(value || ''); }, [value]);
    return html`<input value=${v}
      onInput=${(e) => setV(e.target.value)}
      onBlur=${() => { if (v !== (value || '')) onCommit(v); }}
      onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}
      placeholder=${placeholder || ''}
      class=${`w-full px-2 py-1.5 text-[12px] bg-transparent outline-none focus:bg-amber-50 ${color || ''}`} />`;
  }

  /* =====================================================================
   *  최종편성안 (엑셀 레이아웃 표 · 직접 편집 가능)
   * ===================================================================== */
  function FinalScheduleView({ state }) {
    const prog = activeProgramObj(state);
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

    return html`
      <div class="flex-1 overflow-auto p-4 bg-slate-100">
        <div class="flex items-center justify-between mb-3 max-w-[1500px]">
          <h2 class="text-base font-bold text-ink">${prog.name} · ${state.view.year}년 ${state.view.month}월 최종편성안
            <span class="text-[12px] font-normal text-ink-soft">총 ${total}편성 · 셀을 클릭해 직접 수정</span></h2>
          <button onClick=${() => window.print()}
            class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand">🖨 인쇄 / PDF</button>
        </div>
        <div class="bg-white rounded-lg shadow-sm overflow-hidden max-w-[1500px]">
          <table class="w-full text-[12px] border-collapse">
            <thead class="sticky top-0">
              <tr>
                <th class=${th} style=${{ width: '90px' }}>방송일</th>
                <th class=${th} style=${{ width: '40px' }}>요일</th>
                <th class=${th} style=${{ width: '110px' }}>시간</th>
                <th class=${th}>상품명</th>
                <th class=${th}>내용 / 타이틀</th>
                <th class=${th}>구성</th>
                <th class=${th} style=${{ width: '80px' }}>준비물량</th>
                <th class=${th} style=${{ width: '90px' }}>가격</th>
                <th class=${th} style=${{ width: '70px' }}>마진</th>
                <th class=${th}>비고 (PD)</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length === 0 && html`<tr><td class=${td} colspan="10"><div class="text-center text-slate-400 py-8">이 달 편성이 없습니다.</div></td></tr>`}
              ${rows.map((r, i) => {
                const p = r.p; const det = (p && p.detail) || {};
                const dnum = Number(r.day.date.slice(8));
                const m = Number(r.day.date.slice(5, 7));
                const wd = U.WEEKDAY_KO[r.day.weekday];
                const wdColor = r.day.weekday === 6 ? 'text-blue-600' : r.day.weekday === 0 ? 'text-red-500' : 'text-ink';
                return html`
                  <tr key=${i} class=${`${r.firstOfDay ? 'border-t-2 border-t-slate-300' : ''} hover:bg-amber-50`}>
                    ${r.firstOfDay && html`
                      <td class=${`${tdMerge} font-semibold tabular-nums text-ink`} rowSpan=${dayCount[r.day.date]}>${m}/${dnum}</td>
                      <td class=${`${tdMerge} font-semibold ${wdColor}`} rowSpan=${dayCount[r.day.date]}>${wd}</td>`}
                    <td class=${`${td} tabular-nums font-medium ${r.compete ? 'text-amber-700' : ''}`}>
                      ${slotName(r.slot)} ${r.compete && html`<span class="text-[10px] text-amber-600">●경쟁</span>`}
                    </td>
                    <td class=${`${td} p-0`}>
                      ${p ? html`<div>
                          <div class="flex items-center gap-1 pr-2">
                            <${EditCell} value=${p.productName} color="font-semibold text-ink"
                              onCommit=${(val) => store.updatePlacementContent(p.id, { productName: val })} />
                            ${(p.items && p.items.length > 1) && html`<span class="shrink-0 text-[10px] text-violet-600">동시 ${p.items.length}착장</span>`}
                            ${det.isNew && html`<span class="shrink-0 text-[10px] text-cyan-600">新</span>`}
                          </div>
                          ${(p.items && p.items.length > 1) && html`<ul class="px-2 pb-1 text-[11px] text-ink-soft">${p.items.map((it, k) => html`<li key=${k}>· ${it}</li>`)}</ul>`}
                          <div class="px-2 pb-1 text-[10px] text-slate-400">${teamOf(state, p.teamId).name}</div>
                        </div>`
                        : html`<span class="px-2 text-slate-300">—</span>`}
                    </td>
                    <td class=${`${td} p-0`}>${p ? html`<${EditCell} value=${det.note}
                      onCommit=${(val) => store.updatePlacementContent(p.id, { detail: { note: val } })} placeholder="내용/타이틀…" />
                      ${det.issue ? html`<div class="px-2 pb-1 text-[11px] text-rose-500">${det.issue}</div>` : ''}` : ''}</td>
                    <td class=${`${td} p-0`}>${p ? html`<${EditCell} value=${det.comp}
                      onCommit=${(val) => store.updatePlacementContent(p.id, { detail: { comp: val } })} placeholder="구성…" />` : ''}</td>
                    <td class=${`${td} p-0`}>${p ? html`<${EditCell} value=${det.prep} color="tabular-nums"
                      onCommit=${(val) => store.updatePlacementContent(p.id, { detail: { prep: val } })} placeholder="00억…" />` : ''}</td>
                    <td class=${`${td} p-0`}>${p ? html`<${EditCell} value=${det.price} color="tabular-nums"
                      onCommit=${(val) => store.updatePlacementContent(p.id, { detail: { price: val } })} placeholder="가격…" />` : ''}</td>
                    <td class=${`${td} p-0`}>${p ? html`<${EditCell} value=${det.margin} color="tabular-nums"
                      onCommit=${(val) => store.updatePlacementContent(p.id, { detail: { margin: val } })} placeholder="마진…" />` : ''}</td>
                    <td class=${`${td} p-0`}>${p ? html`<${EditCell} value=${p.memo} color="text-violet-700"
                      onCommit=${(val) => store.updatePlacementContent(p.id, { memo: val })} placeholder="PD 코멘트…" />` : ''}</td>
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
    function restore(s) {
      if (!confirm(`${s.year}년 ${s.month}월 — ${fmtTs(s.ts)} 저장본으로 되돌립니다.\n현재 ${s.month}월 편성은 이 저장본 내용으로 교체됩니다. 계속할까요?`)) return;
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
  function MetaEditor({ p, onClose }) {
    const [pd, setPd] = useState(p.pd || '');
    const [host, setHost] = useState(p.host || '');
    const [studio, setStudio] = useState(p.studio || '');
    const [dur, setDur] = useState(p.durationMin || '');
    function save() {
      store.updatePlacementMeta(p.id, {
        pd, host, studio, durationMin: dur ? parseInt(dur, 10) : null,
      });
      onClose();
    }
    return html`
      <${Modal} title=${`배정 편집 · ${p.productName}`} onClose=${onClose} onSave=${save}>
        <${Field} label="담당 PD">
          <input list="pd-list" value=${pd} onInput=${(e) => setPd(e.target.value)} class=${inputCls} placeholder="예: 김PD" />
        <//>
        <${Field} label="쇼호스트">
          <input list="host-list" value=${host} onInput=${(e) => setHost(e.target.value)} class=${inputCls} placeholder="예: 최유라" />
        <//>
        <${Field} label="스튜디오">
          <input list="studio-list" value=${studio} onInput=${(e) => setStudio(e.target.value)} class=${inputCls} placeholder="예: A스튜디오" />
        <//>
        <${Field} label="방송 분량(분)">
          <input type="number" value=${dur} onInput=${(e) => setDur(e.target.value)} class=${inputCls} placeholder="예: 30" />
        <//>
        <datalist id="pd-list"><option value="김PD"/><option value="이PD"/><option value="박PD"/></datalist>
        <datalist id="host-list"><option value="최유라"/><option value="게스트MC"/></datalist>
        <datalist id="studio-list"><option value="A스튜디오"/><option value="B스튜디오"/><option value="야외"/></datalist>
      <//>`;
  }

  /* =====================================================================
   *  MD 입찰 보드
   * ===================================================================== */
  function BidBoard({ state }) {
    const teams = programTeams(state);
    const schema = programSchema(state);
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
            const shownSlots = day.slots.filter((slot) => !isMain || slot.std || state.bids.some((b) => b.slotId === slot.id));
            return html`
            <div key=${day.id} class="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div class="flex items-center justify-between px-3 py-1.5 bg-slate-100">
                <span class="font-semibold text-[13px] text-ink">${fmtDay(day)}</span>
                <div class="flex items-center gap-2 text-[11px] text-ink-soft">
                  <button onClick=${() => setSlotModalDay(day.id)} class="hover:text-brand">+ 시간대</button>
                  <button onClick=${() => store.addSlot(day.id, { order: true })} class="hover:text-brand">+ 순번</button>
                  <button onClick=${() => confirm(`${fmtDay(day)} 편성일을 삭제할까요? (입찰·편성 포함)`) && store.removeDay(day.id)}
                    class="hover:text-brand">편성일 삭제</button>
                </div>
              </div>
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
              </div>
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
      groupCode: init.groupCode || '',
      items: (init.items || []).join('\n'), // 동시 묶음 상품 목록
    });
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
        groupCode: f.groupCode,
        durationMin: orderMode ? (f.durationMin ? parseInt(f.durationMin, 10) : null) : durMin,
        items: items.length ? items : undefined,
        dongsi: items.length > 1,
      };
      if (orderMode) {
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
          ${orderMode
            ? html`<${Field} label="희망 슬롯(순번)">
                <select value=${slotId} onChange=${(e) => setSlotId(e.target.value)} class=${inputCls}>
                  ${day.slots.map((s) => html`<option key=${s.id} value=${s.id}>${slotName(s)}</option>`)}
                </select><//>`
            : html`<${Field} label=${`방송 시간 — ${durMin}분`}>
                <div class="flex items-center gap-1.5">
                  <input type="time" value=${start} onInput=${(e) => setStart(e.target.value)} class=${inputCls} />
                  <span class="text-ink-soft">~</span>
                  <input type="time" value=${end} onInput=${(e) => setEnd(e.target.value)} class=${inputCls} />
                </div><//>`}
        </div>
        ${!orderMode && bands.length > 0 && html`
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
          ${orderMode && html`<${Field} label="방송 분량(분)"><input type="number" value=${f.durationMin} onInput=${set('durationMin')} class=${inputCls} placeholder="예: 30" /><//>`}
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
   *  변경 이력 팝업
   * ===================================================================== */
  function HistoryModal({ state, onClose }) {
    const [q, setQ] = useState('');
    const [action, setAction] = useState('all');
    let logs = state.changeLog;
    if (action !== 'all') logs = logs.filter((l) => l.action === action);
    if (q.trim()) logs = logs.filter((l) => (l.productName || '').includes(q.trim()) || (l.teamName || '').includes(q.trim()) || (l.user || '').includes(q.trim()));

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

          <div class="flex items-center gap-2 px-4 py-2 border-b border-slate-200">
            <input value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="상품/팀/작성자 검색"
              class="text-xs px-2 py-1 rounded border border-slate-300 outline-none w-48" />
            <select value=${action} onChange=${(e) => setAction(e.target.value)} class="text-xs px-2 py-1 rounded border border-slate-300">
              ${actions.map((a) => html`<option key=${a} value=${a}>${a === 'all' ? '전체 동작' : a}</option>`)}
            </select>
            <span class="text-[11px] text-ink-soft ml-auto">${logs.length}건</span>
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
   *  공용 모달 / 폼 요소
   * ===================================================================== */
  const inputCls = 'w-full text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none';
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
      <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick=${onClose}>
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col" onClick=${(e) => e.stopPropagation()}>
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h3 class="font-bold text-ink text-sm">${title}</h3>
            <button onClick=${onClose} class="text-ink-soft hover:text-brand text-lg leading-none">✕</button>
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
  function ProgramTabs({ state }) {
    const counts = useMemo(() => {
      const byProg = {};
      const dayProg = {};
      state.days.forEach((d) => { dayProg[d.id] = d.programId; d.slots.forEach((s) => { dayProg['s_' + s.id] = d.programId; }); });
      state.placements.forEach((p) => { const pid = p.programId; if (pid) byProg[pid] = (byProg[pid] || 0) + 1; });
      return byProg;
    }, [state.placements, state.days]);
    return html`
      <div class="flex items-stretch gap-0.5 px-2 pt-1.5 bg-slate-200/70 overflow-x-auto">
        ${(state.programs || []).map((p) => {
          const active = p.id === state.activeProgram;
          return html`
            <button key=${p.id} onClick=${() => store.setActiveProgram(p.id)}
              class=${`group flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-t-lg text-[12.5px] border-t border-x transition
                ${active ? 'bg-white border-slate-300 font-bold text-ink -mb-px' : 'bg-slate-100 border-transparent text-ink-soft hover:bg-slate-50'}`}>
              <span class="inline-block w-2 h-2 rounded-full" style=${{ background: p.color }}></span>
              ${p.name}
              ${counts[p.id] ? html`<span class=${`text-[10px] px-1 rounded ${active ? 'bg-slate-100 text-ink-soft' : 'bg-slate-200 text-slate-500'}`}>${counts[p.id]}</span>` : ''}
            </button>`;
        })}
      </div>`;
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
  function LoginGate({ onLogin }) {
    const roles = window.AUTH.roles;
    const [role, setRole] = useState('pd');
    const [name, setName] = useState('');
    const [pw, setPw] = useState('');
    const [err, setErr] = useState('');
    const r = roles[role];
    function submit(e) {
      e && e.preventDefault();
      if (!name.trim()) { setErr('이름을 입력하세요. (변경 이력에 기록됩니다)'); return; }
      if (pw !== r.password) { setErr('비밀번호가 올바르지 않습니다.'); return; }
      onLogin({ role, name: name.trim() });
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
          <div class="grid grid-cols-2 gap-2">
            ${Object.entries(roles).map(([key, cfg]) => html`
              <button type="button" key=${key} onClick=${() => { setRole(key); setErr(''); }}
                class=${`rounded-lg border px-3 py-2 text-left transition ${role === key ? 'border-transparent text-white shadow' : 'border-slate-300 bg-white text-ink hover:border-slate-400'}`}
                style=${role === key ? { background: cfg.color } : {}}>
                <div class="font-bold text-sm">${cfg.label}</div>
                <div class=${`text-[11px] ${role === key ? 'text-white/85' : 'text-ink-soft'}`}>${cfg.desc}</div>
              </button>`)}
          </div>
          <div class="mt-4 space-y-2.5">
            <label class="block">
              <div class="text-[12px] font-medium text-ink-soft mb-1">이름 <span class="font-normal text-slate-400">(팀+이름 권장)</span></div>
              <input value=${name} onInput=${(e) => setName(e.target.value)} class=${inputCls}
                placeholder=${role === 'md' ? '예: 리빙팀 홍길동' : '예: 김피디'} autofocus />
            </label>
            <label class="block">
              <div class="text-[12px] font-medium text-ink-soft mb-1">${r.label} 공용 비밀번호</div>
              <input type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} class=${inputCls} placeholder="비밀번호" />
            </label>
          </div>
          ${err && html`<div class="mt-2 text-[12px] text-brand">${err}</div>`}
          <button type="submit" class="mt-4 w-full py-2 rounded-lg bg-brand text-white font-semibold hover:bg-brand-dark">입장</button>
          <div class="mt-3 text-[11px] text-slate-400 leading-relaxed">
            역할별 공용 비밀번호로 입장합니다. 입력하신 이름은 모든 수정 내역(변경 이력 · 카드 “마지막 수정”)에 자동 기록됩니다.
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
    const [tab, setTab] = useState('schedule'); // schedule | bids | final
    const [history, setHistory] = useState(false);
    const [sbStatus, setSbStatus] = useState(
      (window.SUPABASE && window.SUPABASE.enabled) ? 'connecting' : null);
    useEffect(() => {
      window.__SB_STATUS = (s) => setSbStatus(s);
      return () => { window.__SB_STATUS = null; };
    }, []);
    // 로그인 식별을 데이터 계층에 반영 → 이후 모든 변경이 이 이름으로 기록됨
    useEffect(() => { if (auth) store.setUser(auth.name); }, [auth]);

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

    function importAll() {
      const seed = window.BID_SEED;
      if (!seed || !seed.length) { alert('시드 데이터(bidSeed.js)를 찾을 수 없습니다.'); return; }
      if (!confirm(`엑셀에서 추출한 2026년 입찰 ${seed.length}건을 불러옵니다.\n(이미 있는 입찰은 중복 제외)\n계속할까요?`)) return;
      const r = store.importBids(seed);
      alert(`완료: 입찰 ${r.added}건 추가` +
        (r.newSlots ? `, 시간대 ${r.newSlots}개 생성` : '') +
        (r.dup ? `, 중복 ${r.dup}건 제외` : ''));
    }
    function doLogin(a) {
      try { localStorage.setItem(window.AUTH.storageKey, JSON.stringify({ ...a, ts: Date.now() })); } catch (e) {}
      store.setUser(a.name);
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
    if (!auth) return html`<${LoginGate} onLogin=${doLogin} />`;

    const roleCfg = window.AUTH.roles[auth.role] || { tabs: ['schedule'], canManage: true, label: '', color: '#64748b' };
    const allowed = roleCfg.tabs;
    const curTab = allowed.includes(tab) ? tab : allowed[0];

    return html`
      <div class="flex flex-col h-screen">
        <header class="shrink-0 bg-white border-b border-slate-200">
          <div class="flex items-center gap-4 px-4 py-2">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-lg bg-brand text-white grid place-items-center font-black text-[11px] leading-none">PGM</div>
              <div>
                <div class="font-extrabold text-ink leading-tight">방송제작부문 · 테마PGM 편성 스케줄러</div>
                <div class="text-[11px] text-ink-soft flex items-center gap-1">
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
            <${MonthNav} view=${state.view} />
            <nav class="ml-2 flex items-center gap-1">
              ${allowed.includes('bids') && html`<button onClick=${() => setTab('bids')}
                class=${tabCls(curTab === 'bids')}>MD 입찰보드</button>`}
              ${allowed.includes('schedule') && html`<button onClick=${() => setTab('schedule')}
                class=${tabCls(curTab === 'schedule')}>PD 편성표</button>`}
              ${allowed.includes('final') && html`<button onClick=${() => setTab('final')}
                class=${tabCls(curTab === 'final')}>최종편성안</button>`}
            </nav>
            <div class="ml-auto flex items-center gap-2">
              <span class="flex items-center gap-1 text-[12px] px-2 py-1 rounded-full whitespace-nowrap"
                style=${{ background: roleCfg.color + '18', color: roleCfg.color }} title="현재 로그인 — 모든 수정이 이 이름으로 기록됩니다">
                <span class="w-1.5 h-1.5 rounded-full" style=${{ background: roleCfg.color }}></span>
                <b>${roleCfg.label}</b><span class="opacity-80">· ${auth.name}</span>
              </span>
              <div class="flex items-center rounded border border-slate-300 bg-white overflow-hidden">
                <button onClick=${() => store.undo()} disabled=${!store.canUndo()}
                  class="px-2 py-1.5 text-[13px] hover:bg-slate-100 disabled:opacity-30 disabled:cursor-default"
                  title="되돌리기 (Ctrl/Cmd+Z)">↶</button>
                <button onClick=${() => store.redo()} disabled=${!store.canRedo()}
                  class="px-2 py-1.5 text-[13px] border-l border-slate-200 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-default"
                  title="다시 (Ctrl/Cmd+Shift+Z)">↷</button>
              </div>
              ${roleCfg.canManage && html`<button onClick=${importAll}
                class="text-[13px] px-3 py-1.5 rounded border border-cyan-300 text-cyan-700 bg-white hover:bg-cyan-50"
                title="엑셀에서 추출한 2026년 전체 입찰을 불러옵니다">엑셀 2026 불러오기</button>`}
              <button onClick=${() => setHistory(true)}
                class="text-[13px] px-3 py-1.5 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand">
                변경 이력 <span class="text-[11px] text-ink-soft">(${state.changeLog.length})</span>
              </button>
              ${roleCfg.canManage && html`<button onClick=${() => confirm('모든 데이터를 초기화할까요?') && store.resetAll()}
                class="text-[12px] px-2 py-1.5 rounded text-ink-soft hover:text-brand" title="초기화">초기화</button>`}
              <button onClick=${logout}
                class="text-[12px] px-2 py-1.5 rounded border border-slate-300 text-ink-soft hover:border-brand hover:text-brand" title="로그아웃">로그아웃</button>
            </div>
          </div>
        </header>

        <${ProgramTabs} state=${state} />

        <main class="flex-1 min-h-0 flex flex-col border-t border-slate-300">
          ${curTab === 'schedule' ? html`<${ScheduleView} state=${state} onSaved=${() => setTab('final')} />`
            : curTab === 'final' ? html`<${FinalScheduleView} state=${state} />`
            : html`<${BidBoard} state=${state} />`}
        </main>

        ${history && html`<${HistoryModal} state=${state} onClose=${() => setHistory(false)} />`}
      </div>`;
  }
  const tabCls = (active) =>
    `text-[13px] font-semibold px-3 py-1.5 rounded-lg transition ${active ? 'bg-brand text-white' : 'text-ink-soft hover:bg-slate-100'}`;

  ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
})();
