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

  // 프로그램별 캐스팅(PD·쇼호스트·스튜디오) 추천 목록 — state.casting(관리자 편집) 우선, 없으면 AUTH.casting 폴백
  const castingOf = (state, pid) => {
    const c = (state.casting && state.casting[pid]) || (window.AUTH.casting && window.AUTH.casting[pid]) || null;
    if (!c) return null;
    return { pd: c.pd || [], host: c.host || [], studio: c.studio || [] };
  };

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
  // 전체 팀을 부문별로 그룹핑 (순서: state.divisions → 목록에 없는 부문). 팀 드롭다운/칩 공통.
  const teamsGrouped = (state) => {
    const teams = state.teams || [];
    const byDiv = {};
    teams.forEach((t) => { const d = t.div || '기타'; (byDiv[d] = byDiv[d] || []).push(t); });
    const order = (state.divisions || []).slice();
    Object.keys(byDiv).forEach((d) => { if (!order.includes(d)) order.push(d); });
    return order.filter((d) => byDiv[d]).map((d) => [d, byDiv[d]]);
  };
  // <select> 내부 optgroup 옵션 (전체 팀, 부문별 카테고리)
  const teamOptions = (state) => teamsGrouped(state).map(([div, ts]) => html`
    <optgroup key=${div} label=${div}>
      ${ts.map((t) => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
    </optgroup>`);
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
  function PlacementCard({ state, p, subTime, subSlot, simple }) {
    const team = teamOf(state, p.teamId);
    const [info, setInfo] = useState(false);
    const [startEdit, setStartEdit] = useState(false);
    const [subEdit, setSubEdit] = useState(false);   // 세부 시간(⏱) 클릭 → 시간 조정
    const [castOpen, setCastOpen] = useState(false); // 🎤 빠른 캐스팅 입력
    const det = p.detail || {};
    const items = p.items || [];
    return html`
      <div draggable=${true}
        onDragStart=${(e) => drag.start(e, 'placement', p.id)}
        onClick=${() => { setStartEdit(false); setInfo(true); }} title="클릭하면 상세 정보 · ✎ 로 바로 수정"
        class=${`card-drag group relative ${simple ? 'w-[168px]' : 'w-[152px]'} rounded-md border border-slate-200 bg-white px-1.5 py-1 shadow-sm hover:shadow hover:border-brand transition`}
        style=${{ borderLeft: `4px solid ${team.color}` }}>
        <div class="flex items-start justify-between gap-0.5">
          <div class="min-w-0 flex-1">
            <div class=${`${simple ? 'text-[14px]' : 'text-[12.5px]'} font-bold text-ink leading-snug break-words`}>${p.productName}</div>
            ${!simple && subTime && (subSlot
              ? html`<button onClick=${(e) => { e.stopPropagation(); setSubEdit(true); }}
                  class="text-[10px] font-semibold text-amber-700 tabular-nums hover:underline decoration-dotted"
                  title="MD 입찰의 세부 시간 — 클릭해 시간 조정">⏱ ${subTime}</button>`
              : html`<div class="text-[10px] font-semibold text-amber-700 tabular-nums" title="MD 입찰의 세부 시간 (고정 띠 안에 자동 귀속)">⏱ ${subTime}</div>`)}
            <div class="mt-0.5 flex flex-wrap items-center gap-1">
              <${Badge} color=${team.color}>${team.name}<//>
              ${!simple && items.length > 1 && html`<${Badge} color="#7c3aed" title="동시 노출 착장 수">동시 ${items.length}착장<//>`}
              ${!simple && det.isNew && html`<${Badge} color="#0891b2">신상품<//>`}
              ${!simple && det.special && html`<${Badge} color="#da291c">특약${det.specialNote ? ' ' + det.specialNote : ''}<//>`}
              ${!simple && p.moveCount > 0 && html`<${Badge} color="#da291c" title="편성 이동 횟수">↔ ${p.moveCount}회<//>`}
              ${p.durationMin && html`<${Badge}>${p.durationMin}분<//>`}
            </div>
            ${!simple && (p.pd || p.host || p.studio) && html`
              <div class="mt-1 text-[11px] text-ink-soft leading-tight">
                ${p.pd && html`<span>PD ${p.pd}</span>`}
                ${p.host && html`<span class="ml-1.5">MC ${p.host}</span>`}
                ${p.studio && html`<span class="ml-1.5">ST ${p.studio}</span>`}
              </div>`}
          </div>
          <div class="flex flex-col items-center gap-1 opacity-0 group-hover:opacity-100 transition">
            <button title="수정" onClick=${(e) => { e.stopPropagation(); setStartEdit(true); setInfo(true); }}
              class="text-ink-soft hover:text-brand text-xs leading-none p-0.5">✎</button>
            ${!simple && html`<button title="캐스팅 입력 (PD·쇼호스트·스튜디오)" onClick=${(e) => { e.stopPropagation(); setCastOpen(true); }}
              class="text-ink-soft hover:text-brand text-xs leading-none p-0.5">🎤</button>`}
            <button title="편성 제외" onClick=${(e) => { e.stopPropagation(); store.removePlacement(p.id); }}
              class="text-ink-soft hover:text-brand text-xs leading-none p-0.5">✕</button>
          </div>
        </div>
        ${info && html`<${PlacementDetailModal} state=${state} p=${p} startEdit=${startEdit} onClose=${(e) => { e && e.stopPropagation && e.stopPropagation(); setInfo(false); }} />`}
        ${subEdit && subSlot && html`<${EditSlotTimeModal} slot=${subSlot} placement=${p} rippleDefault=${true} onClose=${() => setSubEdit(false)} />`}
        ${castOpen && html`<${CastQuickModal} state=${state} p=${p} onClose=${() => setCastOpen(false)} />`}
      </div>`;
  }

  /* =====================================================================
   *  빠른 캐스팅 입력 (PD 캐스팅 탭 — 카드의 🎤 버튼)
   * ===================================================================== */
  function CastQuickModal({ state, p, onClose }) {
    const castOpts = castingOf(state, p.programId);
    const [pd, setPd] = useState(p.pd || '');
    const [host, setHost] = useState(p.host || '');
    const [studio, setStudio] = useState(p.studio || '');
    function save() { store.updatePlacementMeta(p.id, { pd, host, studio }); onClose(); }
    const fld = (field, val, setVal, ph) => html`
      <input value=${val} onInput=${(e) => setVal(e.target.value)} list=${castOpts && castOpts[field] ? 'cq-' + field + '-dl' : undefined} class=${inputCls} placeholder=${ph} />
      ${castOpts && castOpts[field] ? html`<datalist id=${'cq-' + field + '-dl'}>${castOpts[field].map((o) => html`<option key=${o} value=${o}></option>`)}</datalist>` : ''}`;
    return html`
      <${Modal} title=${`캐스팅 · ${p.productName}`} onClose=${onClose} onSave=${save}>
        <div class="grid grid-cols-3 gap-3">
          <${Field} label="담당 PD">${fld('pd', pd, setPd, 'PD')}<//>
          <${Field} label="쇼호스트">${fld('host', host, setHost, 'MC')}<//>
          <${Field} label="스튜디오">${fld('studio', studio, setStudio, 'ST')}<//>
        </div>
        <div class="text-[12px] text-ink-soft">최종편성안의 PD·쇼호스트·스튜디오 열에 바로 반영됩니다.</div>
      <//>`;
  }

  /* =====================================================================
   *  편성 상세 팝업 (입찰보드에 입력한 정보)
   * ===================================================================== */
  function PlacementDetailModal({ state, p, onClose, startEdit }) {
    const t = teamOf(state, p.teamId);
    const det = p.detail || {};
    const items = p.items || [];
    // 이 팝업은 PD·관리자 전용 편성표(ScheduleView)에서만 뜨므로 수정 허용
    // startEdit=true(✎ 바로가기)면 상세 없이 수정 폼으로 바로 진입
    const [edit, setEdit] = useState(!!startEdit);
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
    const castOpts = castingOf(state, p.programId);
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
    const memoYm = `${state.view.year}-${String(state.view.month).padStart(2, '0')}`;
    const castMemo = (state.castingMemo && state.castingMemo[p.programId + '|' + memoYm]) || '';
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
        ${castMemo && html`<div class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800 whitespace-pre-line">
          <div class="font-semibold mb-0.5">📌 캐스팅 특이사항 (${state.view.month}월)</div>${castMemo}</div>`}
        <${Field} label="상품명 *"><input value=${name} onInput=${(e) => setName(e.target.value)} class=${inputCls} autofocus /><//>
        <div class="grid grid-cols-2 gap-3">
          <${Field} label="팀명">
            <select value=${team} onChange=${(e) => setTeam(e.target.value)} class=${inputCls}>
              ${teamOptions(state)}
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
  function SlotTimeButton({ slot, className, placement, rippleDefault }) {
    const [open, setOpen] = useState(false);
    return html`
      <button onClick=${(e) => { e.stopPropagation(); setOpen(true); }}
        title="클릭해 시간 수정" class=${`${className || ''} hover:text-brand hover:underline decoration-dotted`}>${slotName(slot)}</button>
      ${open && html`<${EditSlotTimeModal} slot=${slot} placement=${placement} rippleDefault=${rippleDefault} onClose=${() => setOpen(false)} />`}`;
  }
  function EditSlotTimeModal({ slot, placement, rippleDefault, onClose }) {
    const isOrder = !!(slot.label && !slot.start);
    const [s, setS] = useState(slot.start || '20:45');
    const [e, setE] = useState(slot.end || '21:45');
    const [label, setLabel] = useState(slot.label || '');
    const [mode, setMode] = useState(isOrder ? 'order' : 'time');
    const dur = (mode === 'time' && s && e) ? (U.toMin(e) - U.toMin(s) + 1440) % 1440 : 0;
    // 행(상품) 컨텍스트: 같은 시간대에 다른 상품이 함께 있으면 이 상품만 분리해 시간 적용
    const sharers = placement ? store.getState().placements.filter((x) => x.slotId === slot.id) : [];
    const shared = !!placement && sharers.length > 1;
    const [ripple, setRipple] = useState(rippleDefault !== undefined ? !!rippleDefault : false);
    // 노출분 ↔ 시작/종료 자동 연동 (입찰 등록 팝업과 동일)
    const [durStr, setDurStr] = useState(() => {
      const d = (slot.start && slot.end) ? (U.toMin(slot.end) - U.toMin(slot.start) + 1440) % 1440 : 0;
      return d > 0 ? String(d) : '';
    });
    const onDurChange = (ev) => {
      const v = ev.target.value.replace(/[^\d]/g, '');
      setDurStr(v);
      const n = parseInt(v, 10);
      if (/^\d{1,2}:\d{2}$/.test(s) && n > 0) setE(U.toHHMM((U.toMin(s) + n) % 1440)); // 노출분 → 종료 자동
    };
    const onStartChange = (v) => {
      setS(v);
      const n = parseInt(durStr, 10);
      if (/^\d{1,2}:\d{2}$/.test(v) && n > 0) setE(U.toHHMM((U.toMin(v) + n) % 1440)); // 시작 이동 → 노출분 유지
    };
    const onEndChange = (v) => {
      setE(v);
      if (/^\d{1,2}:\d{2}$/.test(s) && /^\d{1,2}:\d{2}$/.test(v)) {
        const d = (U.toMin(v) - U.toMin(s) + 1440) % 1440;
        if (d > 0) setDurStr(String(d)); // 종료 수정 → 노출분 재계산
      }
    };
    function save() {
      if (mode === 'time') {
        if (!/^\d{1,2}:\d{2}$/.test(s) || !/^\d{1,2}:\d{2}$/.test(e)) { alert('시작/종료 시간을 입력하세요.'); return; }
        if (dur <= 0) { alert('종료가 시작보다 늦어야 합니다.'); return; }
        if (shared) store.updatePlacementTime(placement.id, { start: s, end: e }); // 이 상품만 분리
        else if (placement && store.updatePlacementTime) store.updatePlacementTime(placement.id, { start: s, end: e, ripple });
        else store.updateSlotTime(slot.id, { start: s, end: e, ripple });
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
          ? html`<${Field} label=${`방송 시간 (24시간) * — ${dur}분`}>
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-2">
                  <span class="text-[12px] text-ink-soft w-10 shrink-0">노출분</span>
                  <div class="flex items-center rounded border border-slate-300 focus-within:border-brand px-2" title="노출분을 넣으면 종료시간이 자동 계산됩니다">
                    <input value=${durStr} onInput=${onDurChange} inputmode="numeric" placeholder="예: 35"
                      class="w-16 py-1.5 text-[13px] tabular-nums text-right bg-transparent outline-none" />
                    <span class="text-[12px] text-ink-soft pl-0.5">분</span>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-[12px] text-ink-soft w-10 shrink-0">시간</span>
                  <${TimeInput} value=${s} onChange=${onStartChange} className="w-20 text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none" />
                  <span class="text-ink-soft shrink-0">~</span>
                  <${TimeInput} value=${e} onChange=${onEndChange} className="w-20 text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none" />
                </div>
              </div>
              <div class="text-[11px] text-ink-soft mt-1">노출분 입력 → 종료시간 자동 · 시작을 바꾸면 노출분(${dur || '-'}분)에 맞춰 종료도 이동</div>
              ${shared
                ? html`<div class="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[12px] text-amber-800">
                    이 시간대에 상품 <b>${sharers.length}개</b>가 함께 있습니다 — 저장하면 <b>${placement.productName}</b>만 새 시간으로 분리되고, 나머지 상품의 시간은 그대로 유지됩니다.</div>`
                : html`<label class="mt-2 flex items-center gap-1.5 text-[12px] text-ink cursor-pointer">
                    <input type="checkbox" checked=${ripple} onChange=${(ev) => setRipple(ev.target.checked)} />
                    종료에 <b>이어져 있던 뒤 시간대만 함께 밀기</b> <span class="text-ink-soft">(어긋난 시간대·고정 띠는 그대로)</span></label>`}
            <//>`
          : html`<${Field} label="순번명 *"><input value=${label} onInput=${(ev) => setLabel(ev.target.value)} class=${inputCls} placeholder="예: 1부" /><//>`}
      <//>`;
  }

  /* =====================================================================
   *  시간띠(밴드) 시간 조정 — 해당 날짜에만 적용, 최종편성안에도 그대로 반영
   * ===================================================================== */
  function BandTimeModal({ day, idx, start, end, hasOverride, onClose }) {
    const [s, setS] = useState(start);
    const [e, setE] = useState(end);
    const dur = (s && e) ? (U.toMin(e) - U.toMin(s) + 1440) % 1440 : 0;
    // 노출분 ↔ 시작/종료 자동 연동 (입찰 등록·시간대 수정 팝업과 동일)
    const [durStr, setDurStr] = useState(() => {
      const d = (start && end) ? (U.toMin(end) - U.toMin(start) + 1440) % 1440 : 0;
      return d > 0 ? String(d) : '';
    });
    const onDurChange = (ev) => {
      const v = ev.target.value.replace(/[^\d]/g, '');
      setDurStr(v);
      const n = parseInt(v, 10);
      if (/^\d{1,2}:\d{2}$/.test(s) && n > 0) setE(U.toHHMM((U.toMin(s) + n) % 1440));
    };
    const onStartChange = (v) => {
      setS(v);
      const n = parseInt(durStr, 10);
      if (/^\d{1,2}:\d{2}$/.test(v) && n > 0) setE(U.toHHMM((U.toMin(v) + n) % 1440));
    };
    const onEndChange = (v) => {
      setE(v);
      if (/^\d{1,2}:\d{2}$/.test(s) && /^\d{1,2}:\d{2}$/.test(v)) {
        const d = (U.toMin(v) - U.toMin(s) + 1440) % 1440;
        if (d > 0) setDurStr(String(d));
      }
    };
    function save() {
      if (!/^\d{1,2}:\d{2}$/.test(s) || !/^\d{1,2}:\d{2}$/.test(e)) { alert('시작/종료 시간을 입력하세요.'); return; }
      if (dur <= 0) { alert('종료가 시작보다 늦어야 합니다.'); return; }
      store.updateDayBand(day.id, idx, { start: s, end: e });
      onClose();
    }
    return html`
      <${Modal} title=${`${fmtDay(day)} · 시간띠 조정`} onClose=${onClose} onSave=${save}
        extra=${hasOverride ? html`<button onClick=${() => { if (confirm('이 날짜의 시간띠를 프로그램 기본 시간으로 되돌릴까요?\n(띠 시간 그대로 편성된 상품의 시간은 유지됩니다)')) { store.resetDayBands(day.id); onClose(); } }}
          class="text-[12px] text-ink-soft hover:text-brand mr-auto">기본 시간으로 복원</button>` : undefined}>
        <${Field} label=${`띠 시간 (24시간) * — ${dur}분`}>
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2">
              <span class="text-[12px] text-ink-soft w-10 shrink-0">노출분</span>
              <div class="flex items-center rounded border border-slate-300 focus-within:border-brand px-2" title="노출분을 넣으면 종료시간이 자동 계산됩니다">
                <input value=${durStr} onInput=${onDurChange} inputmode="numeric" placeholder="예: 60"
                  class="w-16 py-1.5 text-[13px] tabular-nums text-right bg-transparent outline-none" />
                <span class="text-[12px] text-ink-soft pl-0.5">분</span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[12px] text-ink-soft w-10 shrink-0">시간</span>
              <${TimeInput} value=${s} onChange=${onStartChange} className="w-20 text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none" />
              <span class="text-ink-soft shrink-0">~</span>
              <${TimeInput} value=${e} onChange=${onEndChange} className="w-20 text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none" />
            </div>
          </div>
        <//>
        <div class="text-[12px] text-ink-soft leading-relaxed">
          <b>${fmtDay(day)} 하루에만</b> 적용됩니다 (다른 주 같은 요일은 그대로).<br/>
          띠 시간(${start}~${end}) 그대로 편성된 상품은 새 시간으로 함께 이동하고, 최종편성안에도 반영됩니다.<br/>
          <b>시간을 줄이면 남는 구간은 자동으로 별도 띠</b>로 생성됩니다 (예: 65분 → 35분이면 남은 30분 띠 생성).
        </div>
      <//>`;
  }

  /* =====================================================================
   *  고정 시간띠 행 — MD가 잘게 쪼갠 시간대도 이 띠 아래에 자동 귀속 표시
   * ===================================================================== */
  function BandRow({ state, day, band, onQuickAdd, onExtBid, onExtMove, onEditBand, onCtxMenu, simple }) {
    const [over, setOver] = useState(false);
    const isExt = !!band.ext;
    const slots = band.slots || [];
    const slotIds = new Set(slots.map((sl) => sl.id));
    const placements = state.placements.filter((p) => slotIds.has(p.slotId))
      .sort((a, b) => {
        const sa = slots.find((sl) => sl.id === a.slotId), sb = slots.find((sl) => sl.id === b.slotId);
        return U.toMin((sa && sa.start) || '00:00') - U.toMin((sb && sb.start) || '00:00');
      });
    const teamsIn = new Set(placements.map((p) => p.teamId));
    const compete = teamsIn.size;
    const compColor = compete >= 3 ? '#dc2626' : compete === 2 ? '#f59e0b' : null;
    const dur = isExt ? 0 : (U.toMin(band.end) - U.toMin(band.start) + 1440) % 1440;
    // 카드에 표시할 세부 시간 (띠와 완전히 같으면 생략)
    const subTimeOf = (p) => {
      const sl = slots.find((x) => x.id === p.slotId);
      if (!sl || !sl.start) return '';
      if (!isExt && sl.start === band.start && sl.end === band.end) return '';
      return `${sl.start}~${sl.end}`;
    };
    function onDrop(e) {
      e.preventDefault(); e.stopPropagation(); setOver(false);
      const pl = drag.read(e);
      if (!pl) return;
      if (isExt) { // 확장 띠: 정확한 시간을 팝업으로 지정
        if (pl.kind === 'bid' && onExtBid) onExtBid(pl.id);
        else if (pl.kind === 'placement' && onExtMove) onExtMove(pl.id);
        return;
      }
      // 고정 띠에 놓으면 띠 시간대로 편성 (PD 수기 조정은 카드 이동/수정으로)
      if (pl.kind === 'bid') store.assignBidToDay(pl.id, day.id, { start: band.start, end: band.end });
      else if (pl.kind === 'placement') store.movePlacementToSlotSpec(pl.id, day.id, { start: band.start, end: band.end });
    }
    return html`
      <div class=${`flex rounded-lg border overflow-hidden ${isExt ? 'bg-slate-50/70' : 'bg-white'} ${over ? 'drop-active' : ''}`}
        style=${compColor && !over ? { borderColor: compColor, boxShadow: `0 0 0 1px ${compColor}` } : (over ? {} : { borderColor: '#e2e8f0', borderStyle: isExt ? 'dashed' : 'solid' })}
        onDragOver=${(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave=${() => setOver(false)}
        onDrop=${onDrop}
        onContextMenu=${(!isExt && onCtxMenu) ? ((e) => { e.preventDefault(); e.stopPropagation(); onCtxMenu(e.clientX, e.clientY); }) : undefined}>
        <div class=${`w-[104px] shrink-0 px-1.5 py-1.5 border-r border-slate-200 flex flex-col gap-0.5 ${isExt ? 'bg-slate-100/70' : 'bg-slate-50'}`}>
          ${isExt
            ? html`<span class="text-[12px] font-bold text-ink-soft leading-tight">확장<br/>${band.label}</span>`
            : html`${onEditBand
                ? html`<button onClick=${(e) => { e.stopPropagation(); onEditBand(); }}
                    class="text-[13.5px] font-extrabold text-ink tabular-nums leading-tight text-left whitespace-nowrap hover:text-brand hover:underline decoration-dotted"
                    title="클릭해 이 날짜의 시간띠 시간 조정">${band.start}~${band.end}</button>`
                : html`<span class="text-[13.5px] font-extrabold text-ink tabular-nums leading-tight whitespace-nowrap">${band.start}~${band.end}</span>`}
              <span class="text-[11px] font-semibold text-ink-soft">${dur}분</span>`}
          ${compColor && html`<span class="inline-flex items-center gap-1 text-[10px] font-bold px-1 rounded whitespace-nowrap self-start" style=${{ background: compColor + '22', color: compColor }}>
            <span class="w-1.5 h-1.5 rounded-full shrink-0" style=${{ background: compColor }}></span>경쟁 ${compete}팀</span>`}
        </div>
        <div class=${`flex-1 flex flex-wrap items-stretch content-start gap-1 p-1.5 min-h-[56px] ${placements.length === 0 ? 'cursor-copy' : ''}`}
          onDoubleClick=${placements.length === 0 && !isExt && onQuickAdd ? (() => onQuickAdd(band.start)) : undefined}
          title=${placements.length === 0 && !isExt ? '더블클릭하면 상품 추가' : ''}>
          ${placements.length === 0
            ? html`<div class="text-[11px] text-slate-300 self-center px-2 select-none">${isExt ? '확장 시간대 — 카드를 놓으면 시간 지정 팝업' : '입찰 카드를 끌어다 놓거나 더블클릭해 추가'}</div>`
            : placements.map((p) => html`
              <div key=${p.id} onDrop=${(e) => {
                  // 같은 띠·같은 시간 카드 위에 놓으면 → 그 카드 앞으로 순서 변경
                  // (시간이 다르면 시간순 정렬이 우선이므로 기존 띠 드롭 동작에 맡김)
                  const pl = drag.read(e);
                  if (!pl || pl.kind !== 'placement' || pl.id === p.id) return;
                  const dragged = state.placements.find((x) => x.id === pl.id);
                  if (!dragged || !slotIds.has(dragged.slotId)) return;
                  const sa = slots.find((x) => x.id === dragged.slotId), sb = slots.find((x) => x.id === p.slotId);
                  if (!sa || !sb || (sa.start || '') !== (sb.start || '')) return;
                  e.preventDefault(); e.stopPropagation(); setOver(false);
                  store.reorderPlacement(pl.id, p.id);
                }}>
                <${PlacementCard} state=${state} p=${p} subTime=${subTimeOf(p)}
                  subSlot=${slots.find((x) => x.id === p.slotId)} simple=${simple} />
              </div>`)}
        </div>
      </div>`;
  }

  /* =====================================================================
   *  슬롯 셀 (드롭 타깃)
   * ===================================================================== */
  function SlotCell({ state, day, slot, simple, onCtxMenu }) {
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
      <div class=${`flex rounded-lg border bg-white overflow-hidden ${over ? 'drop-active' : ''}`}
        style=${compColor && !over ? { borderColor: compColor, boxShadow: `0 0 0 1px ${compColor}` } : (over ? {} : { borderColor: '#e2e8f0' })}
        onDragOver=${(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave=${() => setOver(false)}
        onDrop=${onDrop}
        onContextMenu=${onCtxMenu ? ((e) => { e.preventDefault(); e.stopPropagation(); onCtxMenu(e.clientX, e.clientY); }) : undefined}>
        <div class="w-[104px] shrink-0 px-1.5 py-1.5 bg-slate-50 border-r border-slate-200 flex flex-col gap-0.5">
          <${SlotTimeButton} slot=${slot} rippleDefault=${true} className="text-[13.5px] font-extrabold text-ink tabular-nums leading-tight text-left whitespace-nowrap" />
          ${slot.start && slot.end && html`<span class="text-[11px] font-semibold text-ink-soft">${dur}분</span>`}
          ${compColor && html`<span class="inline-flex items-center gap-1 text-[10px] font-bold px-1 rounded whitespace-nowrap self-start" style=${{ background: compColor + '22', color: compColor }}>
            <span class="w-1.5 h-1.5 rounded-full shrink-0" style=${{ background: compColor }}></span>경쟁 ${compete}팀</span>`}
          <div class="mt-auto flex items-center gap-0.5 text-ink-soft">
            ${slot.start && slot.end && html`<button title="시간 분할" onClick=${() => setSplitOpen(true)} class="hover:text-brand text-xs px-0.5">⊟</button>`}
            <button title="시간대 삭제" onClick=${() => { const n = state.placements.filter((x) => x.slotId === slot.id).length;
              if (confirm(`이 시간대를 삭제할까요?${n ? `\n배정된 상품 ${n}개는 삭제되지 않고 입찰 풀(미편성)로 돌아갑니다.` : ''}`)) store.removeSlot(slot.id); }}
              class="hover:text-brand text-xs px-0.5">✕</button>
          </div>
        </div>
        <div class=${`flex-1 flex flex-wrap items-stretch content-start gap-1 p-1.5 min-h-[56px] ${placements.length === 0 ? 'cursor-copy' : ''}`}
          onDoubleClick=${placements.length === 0 ? (() => setAddOpen(true)) : undefined} title=${placements.length === 0 ? '더블클릭하면 상품 추가' : ''}>
          ${placements.length === 0
            ? html`<div class="text-[11px] text-slate-400 self-center px-2 select-none hover:text-brand">입찰 카드를 끌어다 놓거나 더블클릭해 추가</div>`
            : placements.map((p) => html`<${PlacementCard} key=${p.id} state=${state} p=${p} simple=${simple} />`)}
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
              ${teamOptions(state)}
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

  function DayBlock({ state, day, simple }) {
    const fashion = programSchema(state) === 'fashion';
    // 슬롯 정렬: 시간대는 시작시간순, 순번(1부…)은 번호순으로 뒤에
    const slotOrder = (sl) => sl.start ? U.toMin(sl.start)
      : 100000 + (parseInt(((sl.label || '').match(/\d+/) || [99])[0], 10) || 99);
    const sortedSlots = day.slots.slice().sort((x, y) => slotOrder(x) - slotOrder(y));
    // ----- 고정 시간띠(밴드): 프로그램 스케줄 기반 + 날짜별 조정(day.bands) 우선. MD가 쪼갠 시간도 자동 귀속 -----
    const sched = store.getSchedule ? store.getSchedule(day.programId) : null;
    const schedEntry = !fashion && sched ? sched.find((sc) => sc.wd === day.weekday) : null;
    const bandDefs = !fashion
      ? ((day.bands && day.bands.length) ? day.bands : (schedEntry && schedEntry.slots))
      : null;
    const useBands = !!(bandDefs && bandDefs.length);
    const [showExt, setShowExt] = useState(false);
    const [bandEdit, setBandEdit] = useState(null); // {idx,start,end} — 시간띠 조정 팝업
    const [ctxMenu, setCtxMenu] = useState(null);   // 우클릭 메뉴 {x,y,kind:'band'|'slot',band?,idx?,slot?}
    const [slotAddFor, setSlotAddFor] = useState(null); // 우클릭: 이 시간대에 상품 추가
    const [splitFor, setSplitFor] = useState(null);     // 우클릭: 시간 분할
    let bands = [], extBefore = null, extAfter = null, labelSlots = [];
    if (useBands) {
      bands = bandDefs.map(([bs, be]) => ({ start: bs, end: be, slots: [] }));
      extBefore = { ext: 'before', label: `~${bands[0].start}`, slots: [] };
      extAfter = { ext: 'after', label: `${bands[bands.length - 1].end}~`, slots: [] };
      const firstStart = U.toMin(bands[0].start);
      const rel = (m) => (m - firstStart + 1440) % 1440; // 첫 띠 시작 기준 상대분(자정 넘김 대응)
      const lastEndR = (() => { let r = rel(U.toMin(bands[bands.length - 1].end)); return r === 0 ? 1440 : r; })();
      day.slots.forEach((sl) => {
        if (!sl.start) { labelSlots.push(sl); return; } // 순번/버킷 슬롯은 밴드 아래 별도 표시
        const smR = rel(U.toMin(sl.start));
        const hit = bands.find((bd) => {
          let bsR = rel(U.toMin(bd.start)), beR = rel(U.toMin(bd.end));
          if (beR <= bsR) beR += 1440;
          return smR >= bsR && smR < beR;
        });
        if (hit) { hit.slots.push(sl); return; }
        if (smR >= lastEndR && smR - lastEndR <= 720) extAfter.slots.push(sl);
        else extBefore.slots.push(sl);
      });
      labelSlots.sort((x, y) => slotOrder(x) - slotOrder(y));
    }
    const [addOpen, setAddOpen] = useState(false);
    const [quickOpen, setQuickOpen] = useState(false);
    const [quickInit, setQuickInit] = useState('');
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
        <div class="flex items-center justify-between px-3 py-1.5 bg-slate-100 border-b border-slate-200">
          <div class="flex items-center gap-2">
            <div class="font-extrabold text-[15px] text-ink">${fmtDay(day)}</div>
            ${fashion && html`<${AirTimeButton} day=${day} />`}
          </div>
          <div class="flex items-center gap-2 text-[11px] text-ink-soft">
            <button onClick=${() => { setQuickInit(''); setQuickOpen(true); }} class="font-semibold text-brand bg-white border border-brand/40 hover:bg-brand hover:text-white px-1.5 py-0.5 rounded">+ 상품</button>
            ${useBands && html`<button onClick=${() => setShowExt(!showExt)} class="hover:text-brand" title="고정 시간띠 앞뒤의 확장 시간대 보기/숨기기">확장 ${showExt ? '▴' : '▾'}</button>`}
            <button onClick=${() => setAddOpen(true)} class="hover:text-brand">+ 시간대</button>
            <button onClick=${() => store.addSlot(day.id, { order: true })} class="hover:text-brand">+ 순번</button>
            <button onClick=${() => {
                const nP = state.placements.filter((x) => day.slots.some((sl) => sl.id === x.slotId)).length;
                const placedIds = new Set(state.placements.map((x) => x.sourceBidId).filter(Boolean));
                const nB = state.bids.filter((b) => b.dayId === day.id && !placedIds.has(b.id)).length; // 미편성 입찰만(중복 집계 방지)
                const n = nP + nB;
              if (confirm(`${fmtDay(day)} 편성일을 삭제할까요?${n ? `\n이 날의 상품·입찰 ${n}건은 삭제되지 않고 입찰 풀로 돌아갑니다(희망일은 가까운 다른 날짜로 표시).` : ''}`)) store.removeDay(day.id); }}
              class="hover:text-brand">삭제</button>
          </div>
        </div>
        <div class="p-1.5 flex flex-col gap-1">
          ${useBands ? html`
            ${(showExt || extBefore.slots.length > 0) && html`<${BandRow} state=${state} day=${day} band=${extBefore} simple=${simple}
              onExtBid=${setBidTimeFor} onExtMove=${setMoveTimeFor} />`}
            ${bands.map((bd, bi) => html`<${BandRow} key=${bi} state=${state} day=${day} band=${bd} simple=${simple}
              onQuickAdd=${(st) => { setQuickInit(st); setQuickOpen(true); }}
              onEditBand=${() => setBandEdit({ idx: bi, start: bd.start, end: bd.end })}
              onCtxMenu=${(x, y) => setCtxMenu({ x, y, kind: 'band', band: bd, idx: bi })} />`)}
            ${(showExt || extAfter.slots.length > 0) && html`<${BandRow} state=${state} day=${day} band=${extAfter} simple=${simple}
              onExtBid=${setBidTimeFor} onExtMove=${setMoveTimeFor} />`}
            ${labelSlots.map((s) => html`<${SlotCell} key=${s.id} state=${state} day=${day} slot=${s} simple=${simple}
              onCtxMenu=${(x, y) => setCtxMenu({ x, y, kind: 'slot', slot: s })} />`)}`
          : (sortedSlots.length === 0
            ? html`<div class="text-[12px] text-slate-400 py-3 text-center">시간대가 없습니다. “+ 상품” 또는 “+ 시간대”로 추가하세요.</div>`
            : sortedSlots.map((s) => html`<${SlotCell} key=${s.id} state=${state} day=${day} slot=${s} simple=${simple}
              onCtxMenu=${(x, y) => setCtxMenu({ x, y, kind: 'slot', slot: s })} />`))}
        </div>
        ${addOpen && html`<${AddSlotModal} day=${day} onClose=${() => setAddOpen(false)} />`}
        ${bandEdit && html`<${BandTimeModal} day=${day} idx=${bandEdit.idx} start=${bandEdit.start} end=${bandEdit.end}
          hasOverride=${!!(day.bands && day.bands.length)} onClose=${() => setBandEdit(null)} />`}
        ${slotAddFor && html`<${SlotAddModal} state=${state} slot=${slotAddFor} onClose=${() => setSlotAddFor(null)} />`}
        ${splitFor && html`<${SplitModal} slot=${splitFor} dur=${U.slotDuration(splitFor)} onClose=${() => setSplitFor(null)} />`}
        ${ctxMenu && (() => {
          const close = () => setCtxMenu(null);
          const item = (label, fn, danger) => html`
            <button onClick=${() => { close(); fn(); }}
              class=${`w-full text-left px-3 py-1.5 hover:bg-slate-100 ${danger ? 'text-rose-600' : 'text-ink'}`}>${label}</button>`;
          const head = ctxMenu.kind === 'band'
            ? `${fmtDay(day)} · 띠 ${ctxMenu.band.start}~${ctxMenu.band.end}`
            : `${fmtDay(day)} · ${slotName(ctxMenu.slot)}`;
          return html`
            <div class="fixed inset-0 z-50" onClick=${close} onContextMenu=${(e) => { e.preventDefault(); close(); }}>
              <div class="absolute bg-white rounded-lg shadow-xl border border-slate-200 py-1 w-60 text-[13px]"
                style=${{ left: Math.min(ctxMenu.x, window.innerWidth - 256) + 'px', top: Math.min(ctxMenu.y, window.innerHeight - 190) + 'px' }}
                onClick=${(e) => e.stopPropagation()}>
                <div class="px-3 py-1 text-[11px] text-ink-soft border-b border-slate-100">${head}</div>
                ${ctxMenu.kind === 'band' ? html`
                  ${item('➕ 상품 추가 (이 띠 시간)', () => { setQuickInit(ctxMenu.band.start); setQuickOpen(true); })}
                  ${item('⏱ 시간띠 조정 — 줄이면 남는 구간 자동 띠', () => setBandEdit({ idx: ctxMenu.idx, start: ctxMenu.band.start, end: ctxMenu.band.end }))}
                  ${item('🗑 이 시간띠 삭제 (이 날짜만)', () => {
                    if (!confirm(`${ctxMenu.band.start}~${ctxMenu.band.end} 시간띠를 삭제할까요?\n이 구간의 상품은 삭제되지 않고 입찰 풀로 돌아갑니다.`)) return;
                    const r = store.removeDayBand(day.id, ctxMenu.idx);
                    if (r && r.error) alert(r.error);
                  }, true)}`
                : html`
                  ${item('➕ 이 시간대에 상품 추가', () => setSlotAddFor(ctxMenu.slot))}
                  ${ctxMenu.slot.start && ctxMenu.slot.end && item('⊟ 시간 분할', () => setSplitFor(ctxMenu.slot))}
                  ${item('✕ 시간대 삭제', () => {
                    const n = state.placements.filter((x) => x.slotId === ctxMenu.slot.id).length;
                    if (confirm(`이 시간대를 삭제할까요?${n ? `\n배정된 상품 ${n}개는 삭제되지 않고 입찰 풀(미편성)로 돌아갑니다.` : ''}`)) store.removeSlot(ctxMenu.slot.id);
                  }, true)}`}
              </div>
            </div>`;
        })()}
        ${quickOpen && html`<${QuickAddModal} state=${state} day=${day} initStart=${quickInit} onClose=${() => setQuickOpen(false)} />`}
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
        <${Field} label="편성할 시작 시간 (24시간) *"><${TimeInput} value=${start} onChange=${setStart} /><//>
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
        <${Field} label="이동할 시작 시간 (24시간) *"><${TimeInput} value=${start} onChange=${setStart} /><//>
        <div class="text-[12px] text-ink-soft">${dur ? `노출분 ${dur}분 → 시작~시작+${dur}분 시간대로 생성됩니다.` : '입력한 시각으로 새 시간대가 생성되어 이동합니다.'}</div>
      <//>`;
  }

  // 수기 상품 추가 — 날짜가 시간대형이면 시간 입력, 순번(1·2·3부)형이면 부 입력
  function QuickAddModal({ state, day, onClose, initStart }) {
    const teams = programTeams(state);
    // 순번형: 패션 프로그램이거나, 이 날짜에 순번 슬롯(1부 등)이 있으면
    const orderMode = programSchema(state) === 'fashion' || day.slots.some((s) => s.label && !s.start);
    const [name, setName] = useState('');
    const [dur, setDur] = useState('');
    const [start, setStart] = useState(initStart || '');
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
            ${teamOptions(state)}
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
          <${Field} label="시작 시간 (24시간) *"><${TimeInput} value=${start} onChange=${setStart} /><//>
          <${Field} label="종료 시간 (24시간) *"><${TimeInput} value=${end} onChange=${setEnd} /><//>
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
            ${teamOptions(state)}
          </select>
        </div>
        <div class="flex-1 overflow-y-auto p-2 space-y-1.5">
          ${bids.length === 0 && html`<div class="text-[12px] text-slate-400 text-center py-6">입찰이 없습니다</div>`}
          ${bids.map((b) => {
            const t = teamOf(state, b.teamId);
            const placed = placedBidIds.has(b.id);
            const slotInfo = b.slotId ? U.slotLabel(b.slotId)
              : (() => { const d = state.days.find((x) => x.id === b.dayId);
                  return d ? `${Number(d.date.slice(8))}일(${U.WEEKDAY_KO[d.weekday]}) 시간 미정` : '시간 미정'; })();
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
  function ScheduleView({ state, onSaved, simple }) {
    const [snapOpen, setSnapOpen] = useState(false);
    const [addDayOpen, setAddDayOpen] = useState(false);
    const [memoOpen, setMemoOpen] = useState(false);
    const hasMemo = !!(state.castingMemo && state.castingMemo[`${state.activeProgram}|${state.view.year}-${String(state.view.month).padStart(2, '0')}`]);
    const { year, month } = state.view;
    const days = daysInView(state);
    const monthSlotIds = new Set(days.flatMap((d) => d.slots.map((s) => s.id)));
    const placedCount = state.placements.filter((p) => monthSlotIds.has(p.slotId)).length;
    const snaps = (state.snapshots || []).filter((s) => s.year === year && s.month === month && s.programId === state.activeProgram);
    const lastSnap = snaps[0];
    const [saveOpen, setSaveOpen] = useState(false);
    function doSave(label) {
      store.saveSnapshot(year, month, (label || '').trim());
      if (store.flushDraft) store.flushDraft(); // 보류된 초안을 서버에 일괄 반영
      setSaveOpen(false);
      onSaved && onSaved(); // 최종편성안 탭으로 이동
    }
    return html`
      <div class="flex flex-col md:flex-row flex-1 min-h-0">
        <${BidPool} state=${state} />
        <div class="flex-1 overflow-y-auto p-2 sm:p-4">
          <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h2 class="text-base font-bold text-ink">${year}년 ${month}월 ${simple ? '입찰 보드' : '편성표 (상세)'}
              <span class="text-[12px] font-normal text-ink-soft">방송일 ${days.length}일 · 편성 ${placedCount}건 · +${shiftMonth(state.view, 1).month}월 첫주 포함</span>
              ${lastSnap
                ? html`<span class="text-[11px] font-normal text-emerald-600 ml-1">· 마지막 저장 ${fmtTs(lastSnap.ts)}</span>`
                : html`<span class="text-[11px] font-normal text-slate-400 ml-1">· 저장 안 됨</span>`}
            </h2>
            <div class="flex items-center gap-2 flex-wrap justify-end">
              ${!simple && html`<button onClick=${() => setMemoOpen(true)}
                class=${`text-xs px-2.5 py-1 rounded border whitespace-nowrap shrink-0 ${hasMemo ? 'border-amber-400 text-amber-700 bg-amber-50' : 'border-slate-300 bg-white hover:border-brand hover:text-brand'}`}
                title="PD·쇼호스트 캐스팅 특이사항(휴가·불가일 등)">📌 캐스팅 메모${hasMemo ? ' ●' : ''}</button>`}
              <button onClick=${() => setAddDayOpen(true)}
                class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand whitespace-nowrap shrink-0">+ 편성일 추가</button>
              <button onClick=${() => setSnapOpen(true)}
                class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand whitespace-nowrap shrink-0">저장본 ${snaps.length}</button>
              <button onClick=${() => setSaveOpen(true)}
                title="현재 편성을 저장본(되돌리기 지점)으로 기록하고 최종편성안으로 이동 — 수정은 이미 실시간 반영됩니다"
                class="text-xs font-semibold px-3 py-1 rounded bg-brand text-white hover:bg-brand-dark whitespace-nowrap shrink-0">편성 저장</button>
            </div>
          </div>
          ${simple && html`<div class="mb-2 text-[12px] text-ink-soft bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
            상품명·팀명·노출분만 간결하게 표시합니다. 드래그로 <b>순서·시간띠를 조정</b>하면 <b>실시간으로 모두에게 반영</b>됩니다. “편성 저장”은 저장본(되돌리기 지점)을 남기고 <b>최종편성안</b>으로 이동합니다.</div>`}
          <div class="space-y-4">
            ${days.length === 0 && html`<div class="text-sm text-slate-400 py-10 text-center">이 달에는 편성일이 없습니다. “+ 편성일 추가”로 추가하세요.</div>`}
            ${groupByWeek(days).map(([wk, days]) => html`
              <div key=${wk} class="flex flex-wrap gap-3 items-start">
                ${days.map((d) => html`
                  <div class="w-full sm:flex-1 sm:min-w-[280px]">
                    <${DayBlock} state=${state} day=${d} simple=${simple} />
                  </div>`)}
              </div>`)}
          </div>
        </div>
        ${snapOpen && html`<${SnapshotsModal} state=${state} onClose=${() => setSnapOpen(false)} />`}
        ${addDayOpen && html`<${AddDayModal} state=${state} onClose=${() => setAddDayOpen(false)} />`}
        ${memoOpen && html`<${CastingMemoModal} state=${state} onClose=${() => setMemoOpen(false)} />`}
        ${saveOpen && html`<${SaveSnapshotModal} year=${year} month=${month} count=${placedCount} onSave=${doSave} onClose=${() => setSaveOpen(false)} />`}
      </div>`;
  }

  function SaveSnapshotModal({ year, month, count, next, onSave, onClose }) {
    const [label, setLabel] = useState('');
    return html`
      <${Modal} title=${`${year}년 ${month}월 편성안 저장`} onClose=${onClose} onSave=${() => onSave(label)}>
        <div class="text-[13px] text-ink">현재 편성 <b>${count}건</b>을 <b>저장본(되돌리기 지점)</b>으로 기록하고 <b>${next || '최종편성안'}</b>으로 이동합니다.</div>
        <div class="text-[12px] text-ink-soft -mt-1">수정 내용은 이미 실시간으로 반영되어 있습니다 — 저장본은 이 시점으로 되돌리기 위한 기록입니다.</div>
        <${Field} label="메모 (선택)">
          <input value=${label} onInput=${(e) => setLabel(e.target.value)} class=${inputCls} placeholder="예: 7월 확정안 v1" autofocus />
        <//>
      <//>`;
  }

  // 인라인 편집 셀 (blur 시 커밋)
  function EditCell({ value, onCommit, placeholder, color, list }) {
    const [v, setV] = useState(value || '');
    const ref = useRef(null);
    useEffect(() => { setV(value || ''); }, [value]);
    // 긴 텍스트 자동 줄바꿈: textarea 높이를 내용에 맞춰 자동 조절 (잘림 방지)
    const fit = (el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } };
    useEffect(() => { fit(ref.current); }, [v]);
    // 표 레이아웃이 정착하며 칸 너비가 바뀌면 재계산 (초기 좁은 폭 기준으로 높이가 부풀지 않게)
    useEffect(() => {
      const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return;
      let lastW = el.offsetWidth;
      const ro = new ResizeObserver(() => {
        const w = el.offsetWidth;
        if (w !== lastW) { lastW = w; fit(el); }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    // datalist(추천목록)가 필요한 칸은 input 유지 (textarea는 datalist 미지원 — 짧은 값이라 잘림 없음)
    if (list) {
      return html`<input value=${v} list=${list}
        onInput=${(e) => setV(e.target.value)}
        onBlur=${() => { if (v !== (value || '')) onCommit(v); }}
        onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }}
        placeholder=${placeholder || ''}
        class=${`w-full px-2 py-1.5 text-[12px] bg-transparent outline-none focus:bg-amber-50 ${color || ''}`} />`;
    }
    return html`<textarea ref=${ref} value=${v} rows="1"
      onInput=${(e) => setV(e.target.value)}
      onBlur=${() => { if (v !== (value || '')) onCommit(v); }}
      onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
      placeholder=${placeholder || ''}
      class=${`block w-full px-2 py-1.5 text-[12px] leading-snug bg-transparent outline-none focus:bg-amber-50 resize-none overflow-hidden ${color || ''}`}></textarea>`;
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
   *  이미지 저장 — 포함할 항목 선택 (선택한 열만 PNG로)
   * ===================================================================== */
  function ImgColsModal({ slim, onClose, onSave }) {
    const ALL = [
      ['time', '시간'], ['dur', '노출분'], ['status', '상태'], ['product', '상품명'], ['group', '그룹코드'],
      ['note', '내용/이슈'], ['comp', '구성'], ['prep', '준비물량'], ['price', '가격'], ['margin', '마진'],
      ['recent', '최근 달성률'], ['pd', 'PD'], ['host', '쇼호스트'], ['studio', '스튜디오'], ['memo', '비고(PD)'],
    ].filter(([k]) => !slim || ['time', 'dur', 'product', 'group', 'pd', 'host', 'studio'].includes(k));
    const [sel, setSel] = useState(() => {
      try {
        const raw = localStorage.getItem('img-cols-v1');
        if (raw) { const arr = JSON.parse(raw); const st = new Set(arr.filter((k) => ALL.some(([kk]) => kk === k))); if (st.size) return st; }
      } catch (e) {}
      return new Set(ALL.map(([k]) => k));
    });
    const toggle = (k) => setSel((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    function go() {
      if (sel.size === 0) { alert('한 개 이상 선택하세요.'); return; }
      try { localStorage.setItem('img-cols-v1', JSON.stringify([...sel])); } catch (e) {}
      onSave(new Set(sel));
      onClose();
    }
    return html`
      <${Modal} title="이미지 저장 — 포함할 항목 선택" onClose=${onClose} onSave=${go}
        extra=${html`<div class="flex gap-2 mr-auto">
          <button onClick=${() => setSel(new Set(ALL.map(([k]) => k)))} class="text-[12px] text-ink-soft hover:text-brand">전체 선택</button>
          <button onClick=${() => setSel(new Set(['time', 'dur', 'product', 'pd', 'host'].filter((k) => ALL.some(([kk]) => kk === k))))}
            class="text-[12px] text-ink-soft hover:text-brand">기본 (시간·상품·캐스팅)</button>
        </div>`}>
        <div class="text-[12px] text-ink-soft -mt-1">방송일·요일은 항상 포함됩니다. 체크한 항목만 이미지(PNG)에 담깁니다. (선택은 기억됩니다)</div>
        <div class="grid grid-cols-3 gap-2">
          ${ALL.map(([k, label]) => html`
            <label key=${k} class=${`flex items-center gap-1.5 text-[13px] cursor-pointer border rounded px-2 py-1.5 ${sel.has(k) ? 'bg-brand-light/50 border-brand/40' : 'border-slate-200'}`}>
              <input type="checkbox" checked=${sel.has(k)} onChange=${() => toggle(k)} /> ${label}</label>`)}
        </div>
      <//>`;
  }

  /* =====================================================================
   *  최종편성안 (엑셀 레이아웃 표 · 직접 편집 가능)
   * ===================================================================== */
  function FinalScheduleView({ state, readOnly, full, onOpenSchedule }) {
    // slim: MD 조회용(민감 열 숨김). full+readOnly: 편성팀 — PD와 동일한 전체 열, 편집만 불가
    const slim = readOnly && !full;
    const prog = activeProgramObj(state);
    const [snapOpen, setSnapOpen] = useState(false);
    const [imgColsOpen, setImgColsOpen] = useState(false);
    const [memoOpen, setMemoOpen] = useState(false); // 캐스팅 특이사항 메모 (PD·관리자)
    const hasMemo = !!(state.castingMemo && state.castingMemo[`${state.activeProgram}|${state.view.year}-${String(state.view.month).padStart(2, '0')}`]);
    const [moveFor, setMoveFor] = useState(null); // 드래그 이동 대상 {pid, day} → 시간 지정 팝업
    const [ctxMenu, setCtxMenu] = useState(null); // 우클릭 메뉴 {x, y, r(행)}
    const [quickAddDay, setQuickAddDay] = useState(null); // 행 추가(시간·상품)
    const [addSlotDay, setAddSlotDay] = useState(null);   // 시간대만 추가
    const [slotAddFor, setSlotAddFor] = useState(null);   // 빈 시간대에 상품 추가
    const snapCount = (state.snapshots || []).filter((s) =>
      s.year === state.view.year && s.month === state.view.month && s.programId === state.activeProgram).length;
    const capRef = useRef(null);
    const [saving, setSaving] = useState(false);
    const { year, month } = state.view;
    const castOpts = castingOf(state, state.activeProgram);
    function saveExcel() {
      if (!window.XLSX) { alert('엑셀 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.'); return; }
      // MD(조회 전용)는 민감 항목(구성·준비물량·가격·마진·달성률·비고) 제외한 축약본으로 출력
      const header = slim
        ? ['방송일', '요일', '시간', '상품명', '그룹코드', 'PD', '쇼호스트', '스튜디오']
        : ['방송일', '요일', '시간', '상태', '상품명', '그룹코드', 'PD', '쇼호스트', '스튜디오', '내용/타이틀', '구성', '준비물량', '가격', '마진', '최근달성률', '비고(PD)'];
      const aoa = [header]; const merges = []; let ri = 1;
      rows.forEach((r) => {
        const p = r.p; const det = (p && p.detail) || {};
        const dnum = Number(r.day.date.slice(8)); const mm = Number(r.day.date.slice(5, 7));
        const items = (p && p.items && p.items.length > 1) ? '\n· ' + p.items.join('\n· ') : '';
        aoa.push(slim
          ? [
            r.firstOfDay ? `${mm}/${dnum}` : '', r.firstOfDay ? U.WEEKDAY_KO[r.day.weekday] : '',
            slotName(r.slot) + (r.slot.start && r.slot.end ? ` (${U.slotDuration(r.slot)}분)` : ''), p ? ((p.productName || '') + items) : '', p ? (det.groupCode || '') : '',
            p ? (p.pd || '') : '', p ? (p.host || '') : '', p ? (p.studio || '') : '',
          ]
          : [
            r.firstOfDay ? `${mm}/${dnum}` : '', r.firstOfDay ? U.WEEKDAY_KO[r.day.weekday] : '',
            slotName(r.slot) + (r.slot.start && r.slot.end ? ` (${U.slotDuration(r.slot)}분)` : ''), p ? (p.pending ? '미정' : '확정') : '',
            p ? ((p.productName || '') + items) : '', p ? (det.groupCode || '') : '',
            p ? (p.pd || '') : '', p ? (p.host || '') : '', p ? (p.studio || '') : '',
            p ? (det.note || '') : '', p ? (det.comp || '') : '',
            p ? (det.prep || '') : '', p ? (det.price || '') : '', p ? (det.margin || '') : '',
            p ? recentText(det.recent) : '', p ? (p.memo || '') : '',
          ]);
        if (r.firstOfDay) {
          const span = dayCount[r.day.date];
          if (span > 1) { merges.push({ s: { r: ri, c: 0 }, e: { r: ri + span - 1, c: 0 } }); merges.push({ s: { r: ri, c: 1 }, e: { r: ri + span - 1, c: 1 } }); }
        }
        ri++;
      });
      const ws = window.XLSX.utils.aoa_to_sheet(aoa);
      ws['!merges'] = merges;
      ws['!cols'] = slim
        ? [{ wch: 7 }, { wch: 5 }, { wch: 12 }, { wch: 30 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }]
        : [{ wch: 7 }, { wch: 5 }, { wch: 12 }, { wch: 6 }, { wch: 26 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 24 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 22 }];
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, `${year}년${month}월`);
      window.XLSX.writeFile(wb, `${prog.name}_${year}-${String(month).padStart(2, '0')}_최종편성안.xlsx`);
    }
    async function saveImage(picked) {
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
          // textarea/input에서 온 overflow-hidden·고정폭·고정높이 제거 → 내용 전체가 보이도록
          div.style.overflow = 'visible';
          div.style.height = 'auto';
          div.style.minHeight = '0';
          div.style.maxHeight = 'none';
          div.style.width = 'auto';
          div.style.maxWidth = '100%';
          div.style.wordBreak = 'break-word';
          cf.parentNode.replaceChild(div, cf);
        });
        // 화면 전용 요소(드래그 손잡이 등)는 이미지에서 제외
        clone.querySelectorAll('.no-capture').forEach((el) => el.remove());
        // 선택한 항목만 남김 (방송일·요일은 항상 포함)
        if (picked) clone.querySelectorAll('[data-col]').forEach((cel) => {
          if (!picked.has(cel.getAttribute('data-col'))) cel.remove();
        });
        // 표를 내용 폭으로(불필요한 가로 여백 제거) + 글자 키움 + 행 여백 축소
        clone.style.width = 'max-content';
        clone.style.maxWidth = 'none';
        const table = clone.querySelector('table');
        if (table) table.style.width = 'auto';
        const thead = clone.querySelector('thead');
        if (thead) thead.style.position = 'static';
        clone.querySelectorAll('th').forEach((c) => { c.style.padding = '5px 9px'; c.style.fontSize = '13.5px'; c.style.width = 'auto'; c.style.minWidth = '0'; c.style.whiteSpace = 'nowrap'; });
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
      const hasContent = (sid) => state.placements.some((p) => p.slotId === sid);
      const ovl = (a, b) => a.start && a.end && b.start && b.end
        && U.toMin(a.start) < U.toMin(b.end) && U.toMin(b.start) < U.toMin(a.end);
      slots.forEach((s) => {
        const pls = state.placements.filter((p) => p.slotId === s.id);
        if (pls.length === 0) {
          // 빈 행은 고정 띠(std)·수기(manual)·순번(label) 슬롯만 표시 —
          // MD 입찰이 참조만 하는 조각 슬롯(상품 이동 후 잔여물)은 빈 행으로 노출하지 않음
          if (!(s.std || s.manual || s.label)) return;
          if (s.start && s.start === s.end) return; // 0분 잔재 슬롯은 빈 행으로 표시하지 않음
          // 그 시간 구간에 이미 상품이 편성된 시간대가 겹쳐 있으면(예: 65분 띠를 2행으로 분할) 빈 행 숨김
          if (slots.some((o) => o.id !== s.id && hasContent(o.id) && ovl(s, o))) return;
          rows.push({ day: d, slot: s, p: null, firstOfDay }); firstOfDay = false;
        } else {
          pls.forEach((p) => { rows.push({ day: d, slot: s, p, firstOfDay, compete: pls.length > 1 }); firstOfDay = false; });
        }
      });
    });
    const total = rows.filter((r) => r.p).length;
    const dayCount = {};
    rows.forEach((r) => { dayCount[r.day.date] = (dayCount[r.day.date] || 0) + 1; });
    // PD·쇼호스트별 이 달 캐스팅 횟수 (콤마 등으로 여러 명 기입 시 각각 집계)
    const castCounts = (field) => {
      const map = new Map();
      rows.forEach((r) => {
        if (!r.p || !r.p[field]) return;
        String(r.p[field]).split(/[,/·+&]/).map((s) => s.trim()).filter(Boolean)
          .forEach((n) => map.set(n, (map.get(n) || 0) + 1));
      });
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };
    const pdCounts = castCounts('pd');
    const hostCounts = castCounts('host');
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
            <span class="text-[12px] font-normal text-ink-soft">총 ${total}편성${readOnly ? ' · 조회 전용' : ' · 셀 클릭=수정 · 행 우클릭=추가/삭제 · ⠿ 드래그=이동'}</span></h2>
          <div class="flex items-center gap-2">
            ${!readOnly && html`<button onClick=${() => setMemoOpen(true)}
              class=${`text-xs px-2.5 py-1 rounded border whitespace-nowrap shrink-0 ${hasMemo ? 'border-amber-400 text-amber-700 bg-amber-50' : 'border-slate-300 bg-white hover:border-brand hover:text-brand'}`}
              title="PD·쇼호스트 캐스팅 특이사항(휴가·불가일 등) — 월·프로그램별 메모">📌 캐스팅 메모${hasMemo ? ' ●' : ''}</button>`}
            ${!readOnly && html`<button onClick=${() => setSnapOpen(true)}
              class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand whitespace-nowrap shrink-0"
              title="이 프로그램·월의 저장본(편성 저장 이력) 목록">저장본 ${snapCount}</button>`}
            <button onClick=${saveExcel}
              class="text-xs px-2.5 py-1 rounded border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50 whitespace-nowrap shrink-0">📊 엑셀 저장 (XLSX)</button>
            <button onClick=${() => setImgColsOpen(true)} disabled=${saving}
              class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand disabled:opacity-50 whitespace-nowrap shrink-0"
              title="포함할 항목을 선택해 이미지로 저장">
              ${saving ? '이미지 생성 중…' : '🖼 이미지 저장 (PNG)'}</button>
            ${onOpenSchedule && html`<button onClick=${onOpenSchedule}
              class="text-[12px] text-slate-300 hover:text-brand px-1 shrink-0"
              title="상세 편성표(구 PD 캐스팅 화면) 열기 — 시간띠·카드 상세 편집">⚙</button>`}
          </div>
        </div>
        ${snapOpen && html`<${SnapshotsModal} state=${state} onClose=${() => setSnapOpen(false)} />`}
        ${memoOpen && html`<${CastingMemoModal} state=${state} onClose=${() => setMemoOpen(false)} />`}
        ${moveFor && html`<${MoveTimeModal} state=${state} day=${moveFor.day} placementId=${moveFor.pid} onClose=${() => setMoveFor(null)} />`}
        ${quickAddDay && html`<${QuickAddModal} state=${state} day=${quickAddDay} onClose=${() => setQuickAddDay(null)} />`}
        ${addSlotDay && html`<${AddSlotModal} day=${addSlotDay} onClose=${() => setAddSlotDay(null)} />`}
        ${slotAddFor && html`<${SlotAddModal} state=${state} slot=${slotAddFor} onClose=${() => setSlotAddFor(null)} />`}
        ${ctxMenu && (() => {
          const r = ctxMenu.r; const p = r.p;
          const close = () => setCtxMenu(null);
          const item = (label, fn, danger) => html`
            <button onClick=${() => { close(); fn(); }}
              class=${`w-full text-left px-3 py-1.5 hover:bg-slate-100 ${danger ? 'text-rose-600' : 'text-ink'}`}>${label}</button>`;
          const dnum = Number(r.day.date.slice(8));
          return html`
            <div class="fixed inset-0 z-50" onClick=${close} onContextMenu=${(e) => { e.preventDefault(); close(); }}>
              <div class="absolute bg-white rounded-lg shadow-xl border border-slate-200 py-1 w-56 text-[13px]"
                style=${{ left: Math.min(ctxMenu.x, window.innerWidth - 240) + 'px', top: Math.min(ctxMenu.y, window.innerHeight - 230) + 'px' }}
                onClick=${(e) => e.stopPropagation()}>
                <div class="px-3 py-1 text-[11px] text-ink-soft border-b border-slate-100">
                  ${month}/${dnum}(${U.WEEKDAY_KO[r.day.weekday]}) ${slotName(r.slot)}${p ? ' · ' + p.productName : ''}</div>
                ${item(`➕ ${month}/${dnum}에 행 추가 (시간·상품)`, () => setQuickAddDay(r.day))}
                ${item('⏱ 시간대만 추가', () => setAddSlotDay(r.day))}
                ${!p && item('📦 이 시간대에 상품 추가', () => setSlotAddFor(r.slot))}
                ${p && item('🚫 상품 편성 제외 (입찰 풀로)', () => {
                  if (confirm(`'${p.productName}'을(를) 편성에서 제외할까요?\n상품은 삭제되지 않고 입찰 풀(미편성)로 돌아갑니다.`)) store.removePlacement(p.id);
                }, true)}
                ${item('🗑 이 행(시간대) 삭제', () => {
                  const n = state.placements.filter((x) => x.slotId === r.slot.id).length;
                  if (confirm(`${slotName(r.slot)} 시간대를 삭제할까요?${n ? `\n배정된 상품 ${n}개는 삭제되지 않고 입찰 풀(미편성)로 돌아갑니다.` : ''}`)) store.removeSlot(r.slot.id);
                }, true)}
              </div>
            </div>`;
        })()}
        ${(pdCounts.length > 0 || hostCounts.length > 0) && html`
          <div class="mb-3 bg-white rounded-lg shadow-sm border border-slate-200 px-3 py-2 flex flex-col gap-1.5"
            title="이 달(${month}월) ${prog.name} 캐스팅 횟수 — PD·쇼호스트 열 기준 자동 집계">
            ${pdCounts.length > 0 && html`<div class="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span class="font-semibold text-ink-soft w-[52px] shrink-0">PD</span>
              ${pdCounts.map(([n, c]) => html`<span key=${n} class="px-1.5 py-0.5 rounded bg-slate-100 whitespace-nowrap">${n} <b class="text-brand tabular-nums">${c}</b></span>`)}
            </div>`}
            ${hostCounts.length > 0 && html`<div class="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span class="font-semibold text-ink-soft w-[52px] shrink-0">쇼호스트</span>
              ${hostCounts.map(([n, c]) => html`<span key=${n} class="px-1.5 py-0.5 rounded bg-slate-100 whitespace-nowrap">${n} <b class="text-brand tabular-nums">${c}</b></span>`)}
            </div>`}
          </div>`}
        ${imgColsOpen && html`<${ImgColsModal} slim=${slim} onClose=${() => setImgColsOpen(false)} onSave=${(pk) => saveImage(pk)} />`}
        <div ref=${capRef} id="final-capture" class="bg-white rounded-lg shadow-sm overflow-x-auto">
          <div class="px-3 py-2 border-b-2 border-brand text-[13px] font-bold text-ink">
            ${prog.name} · ${year}년 ${month}월 최종편성안 <span class="font-normal text-ink-soft">(총 ${total}편성)</span>
          </div>
          <table class=${`w-full ${slim ? 'min-w-[830px]' : 'min-w-[1610px]'} text-[12px] border-collapse`}>
            <thead class="sticky top-0">
              <tr>
                <th class=${th} style=${{ minWidth: '70px' }}>방송일</th>
                <th class=${th} style=${{ minWidth: '36px' }}>요일</th>
                <th class=${th} style=${{ minWidth: '104px' }} data-col="time">시간</th>
                ${!slim && html`<th class=${th} style=${{ minWidth: '58px' }} data-col="status">상태</th>`}
                <th class=${th} style=${{ minWidth: '150px' }} data-col="product">상품명</th>
                <th class=${th} style=${{ minWidth: '92px' }} data-col="group">그룹코드</th>
                <th class=${th} style=${{ minWidth: '100px' }} data-col="pd">PD</th>
                <th class=${th} style=${{ minWidth: '100px' }} data-col="host">쇼호스트</th>
                <th class=${th} style=${{ minWidth: '80px' }} data-col="studio">스튜디오</th>
                ${!slim && html`
                  <th class=${th} style=${{ minWidth: '170px' }} data-col="note">내용 / 타이틀</th>
                  <th class=${th} style=${{ minWidth: '130px' }} data-col="comp">구성</th>
                  <th class=${th} style=${{ minWidth: '78px' }} data-col="prep">준비물량</th>
                  <th class=${th} style=${{ minWidth: '100px' }} data-col="price">가격</th>
                  <th class=${th} style=${{ minWidth: '64px' }} data-col="margin">마진</th>
                  <th class=${th} style=${{ minWidth: '128px' }} data-col="recent">최근 3회 달성률</th>
                  <th class=${th} style=${{ minWidth: '140px' }} data-col="memo">비고 (PD)</th>`}
              </tr>
            </thead>
            <tbody>
              ${rows.length === 0 && html`<tr><td class=${td} colspan=${slim ? 8 : 16}><div class="text-center text-slate-400 py-8">이 달 편성이 없습니다.</div></td></tr>`}
              ${rows.map((r, i) => {
                const p = r.p; const det = (p && p.detail) || {};
                const dnum = Number(r.day.date.slice(8));
                const m = Number(r.day.date.slice(5, 7));
                const wd = U.WEEKDAY_KO[r.day.weekday];
                const wdColor = r.day.weekday === 6 ? 'text-blue-600' : r.day.weekday === 0 ? 'text-red-500' : 'text-ink';
                const pend = p && p.pending;
                return html`
                  <tr key=${i} class=${`${r.firstOfDay ? 'border-t-2 border-t-slate-300' : ''} ${pend ? 'bg-amber-100' : 'hover:bg-amber-50'}`}
                    onDragOver=${readOnly ? undefined : ((e) => e.preventDefault())}
                    onDrop=${readOnly ? undefined : ((e) => {
                      const pl = drag.read(e);
                      if (!pl || pl.kind !== 'placement') return;
                      e.preventDefault(); e.stopPropagation();
                      setMoveFor({ pid: pl.id, day: r.day }); // 놓은 행의 날짜로 이동 → 시간 지정 팝업
                    })}
                    onContextMenu=${readOnly ? undefined : ((e) => {
                      e.preventDefault(); // 우클릭 → 행 추가/삭제 메뉴
                      setCtxMenu({ x: e.clientX, y: e.clientY, r });
                    })}>
                    ${r.firstOfDay && html`
                      <td class=${`${tdMerge} font-semibold tabular-nums text-ink`} rowSpan=${dayCount[r.day.date]}>${m}/${dnum}${r.day.airTime ? html`<div class="text-[10px] font-normal text-ink-soft mt-0.5 whitespace-nowrap">${r.day.airTime}</div>` : ''}</td>
                      <td class=${`${tdMerge} font-semibold ${wdColor}`} rowSpan=${dayCount[r.day.date]}>${wd}</td>`}
                    <td class=${`${td} tabular-nums font-medium ${r.compete ? 'text-amber-700' : ''}`} data-col="time">
                      ${readOnly ? slotName(r.slot) : html`<${SlotTimeButton} slot=${r.slot} placement=${r.p} rippleDefault=${true} className="tabular-nums font-medium text-left" />`}
                      ${r.compete && html`<span class="text-[10px] text-amber-600">●경쟁</span>`}
                      ${r.slot.start && r.slot.end && html`<div class="text-[11px] text-ink-soft font-normal" data-col="dur">${U.slotDuration(r.slot)}분</div>`}
                    </td>
                    ${!slim && html`<td class=${`${td} text-center`} data-col="status">
                      ${p ? (readOnly
                        ? (pend ? html`<${Badge} color="#d97706">미정<//>` : html`<span class="text-[11px] text-emerald-600">확정</span>`)
                        : html`<label class="flex items-center justify-center gap-1 text-[11px] cursor-pointer ${pend ? 'text-amber-700 font-semibold' : 'text-ink-soft'}">
                            <input type="checkbox" checked=${!!pend} onChange=${(e) => store.updatePlacementContent(p.id, { pending: e.target.checked })} /> 미정</label>`)
                        : ''}
                    </td>`}
                    <td class=${`${td} p-0`} data-col="product">
                      ${p ? html`<div>
                          <div class="flex items-center gap-1 pr-2">
                            ${!readOnly && html`<span draggable=${true} onDragStart=${(e) => drag.start(e, 'placement', p.id)}
                              class="no-capture cursor-grab text-slate-300 hover:text-brand pl-1 select-none shrink-0 text-[13px] leading-none"
                              title="드래그해서 다른 날짜/행에 놓으면 시간 지정 팝업으로 이동">⠿</span>`}
                            ${Cell(p.productName, (val) => store.updatePlacementContent(p.id, { productName: val }), { color: 'font-semibold text-ink' })}
                            ${(p.items && p.items.length > 1) && html`<span class="shrink-0 text-[10px] text-violet-600">동시 ${p.items.length}착장</span>`}
                            ${det.isNew && html`<span class="shrink-0 text-[10px] text-cyan-600">新</span>`}
                            ${slim && pend && html`<${Badge} color="#d97706">미정<//>`}
                          </div>
                          ${(p.items && p.items.length > 1) && html`<ul class="px-2 pb-1 text-[11px] text-ink-soft">${p.items.map((it, k) => html`<li key=${k}>· ${it}</li>`)}</ul>`}
                          <div class="px-2 pb-1 text-[10px] text-slate-400">${teamOf(state, p.teamId).name}</div>
                        </div>`
                        : html`<span class="px-2 text-slate-300">—</span>`}
                    </td>
                    <td class=${`${td} p-0`} data-col="group">${p ? Cell(det.groupCode, (val) => store.updatePlacementContent(p.id, { detail: { groupCode: val } }), { ph: '그룹코드', color: 'tabular-nums' }) : ''}</td>
                    <td class=${`${td} p-0`} data-col="pd">${p ? castCell(p, 'pd') : ''}</td>
                    <td class=${`${td} p-0`} data-col="host">${p ? castCell(p, 'host') : ''}</td>
                    <td class=${`${td} p-0`} data-col="studio">${p ? castCell(p, 'studio') : ''}</td>
                    ${!slim && html`
                    <td class=${`${td} p-0`} data-col="note">${p ? html`${Cell(det.note, (val) => store.updatePlacementContent(p.id, { detail: { note: val } }), { ph: '내용/타이틀…' })}
                      <div class="border-t border-dashed border-rose-200">${Cell(det.issue, (val) => store.updatePlacementContent(p.id, { detail: { issue: val } }), { ph: '이슈/특이사항…', color: 'text-rose-500' })}</div>` : ''}</td>
                    <td class=${`${td} p-0`} data-col="comp">${p ? Cell(det.comp, (val) => store.updatePlacementContent(p.id, { detail: { comp: val } }), { ph: '구성…' }) : ''}</td>
                    <td class=${`${td} p-0`} data-col="prep">${p ? Cell(det.prep, (val) => store.updatePlacementContent(p.id, { detail: { prep: val } }), { ph: '00억…', color: 'tabular-nums' }) : ''}</td>
                    <td class=${`${td} p-0`} data-col="price">${p ? Cell(det.price, (val) => store.updatePlacementContent(p.id, { detail: { price: val } }), { ph: '가격…', color: 'tabular-nums' }) : ''}</td>
                    <td class=${`${td} p-0`} data-col="margin">${p ? Cell(det.margin, (val) => store.updatePlacementContent(p.id, { detail: { margin: val } }), { ph: '마진…', color: 'tabular-nums' }) : ''}</td>
                    <td class=${`${td} p-0`} data-col="recent">${p ? html`<${Recent3Cell} value=${det.recent} readOnly=${readOnly}
                      onCommit=${(val) => store.updatePlacementContent(p.id, { detail: { recent: val } })} />` : ''}</td>
                    <td class=${`${td} p-0`} data-col="memo">${p ? Cell(p.memo, (val) => store.updatePlacementContent(p.id, { memo: val }), { ph: 'PD 코멘트…', color: 'text-violet-700' }) : ''}</td>`}
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
        <${Field} label="방송일 *">
          <input type="date" value=${date} onInput=${(e) => setDate(e.target.value)} class=${inputCls} />
        <//>
        ${wdName && html`<div class="text-[12px] text-ink-soft">${date} (${wdName}요일)에 편성일을 추가합니다. 추가 후 각 칸의 “+ 시간대”로 방송 시간을 입력하세요.</div>`}
      <//>`;
  }

  /* =====================================================================
   *  저장본(편성안 스냅샷) 목록
   * ===================================================================== */
  function SnapshotsModal({ state, onClose }) {
    const all = state.snapshots || [];
    const progName = (id) => (((state.programs || []).find((p) => p.id === id)) || {}).name || '(삭제된 프로그램)';
    // 프로그램별 · 월별 필터 — 기본값은 지금 보고 있는 프로그램/월
    const [fProg, setFProg] = useState(state.activeProgram || 'all');
    const [fYm, setFYm] = useState(`${state.view.year}-${String(state.view.month).padStart(2, '0')}`);
    const ymKey = (s) => `${s.year}-${String(s.month).padStart(2, '0')}`;
    const ymList = Array.from(new Set(all.map(ymKey))).sort().reverse();
    const curYm = `${state.view.year}-${String(state.view.month).padStart(2, '0')}`;
    if (!ymList.includes(curYm)) ymList.unshift(curYm);
    const snaps = all.filter((s) =>
      (fProg === 'all' || s.programId === fProg) && (fYm === 'all' || ymKey(s) === fYm));
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
            <h3 class="font-bold text-ink">저장된 편성안</h3>
            <button onClick=${onClose} class="text-ink-soft hover:text-brand text-lg leading-none">✕</button>
          </div>
          <div class="flex items-center gap-2 px-4 py-2 border-b border-slate-200 flex-wrap">
            <select value=${fProg} onChange=${(e) => setFProg(e.target.value)} class="text-xs px-2 py-1 rounded border border-slate-300">
              <option value="all">전체 프로그램</option>
              ${(state.programs || []).map((pg) => html`<option key=${pg.id} value=${pg.id}>${pg.name}</option>`)}
            </select>
            <select value=${fYm} onChange=${(e) => setFYm(e.target.value)} class="text-xs px-2 py-1 rounded border border-slate-300">
              <option value="all">전체 월</option>
              ${ymList.map((y) => html`<option key=${y} value=${y}>${y.replace('-', '년 ')}월</option>`)}
            </select>
            <span class="text-[12px] font-semibold text-ink ml-1">
              ${fProg === 'all' ? '전체' : progName(fProg)} · ${fYm === 'all' ? '전체 월' : fYm.replace('-', '년 ') + '월'}
              — 저장 ${snaps.length}회</span>
          </div>
          <div class="flex-1 overflow-y-auto">
            ${snaps.length === 0
              ? html`<div class="text-center text-slate-400 py-10 text-sm">이 프로그램·월에 저장된 편성안이 없습니다.<br/>편성표에서 “편성 저장”을 누르면 이 시점의 편성안이 기록됩니다.</div>`
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
   *  지난 입찰 가져오기 (2차 편성) — 다른 프로그램/월의 내 팀 입찰을 현재 달로 복사
   * ===================================================================== */
  function ImportBidsModal({ state, team, onClose }) {
    const programs = state.programs || [];
    const dayById = (id) => state.days.find((d) => d.id === id);
    // 원본: 프로그램 + 월 (기본값 = 현재 프로그램의 지난달)
    const prev = shiftMonth(state.view, -1);
    const [srcPid, setSrcPid] = useState(state.activeProgram);
    const ymOf = (d) => d.date.slice(0, 7);
    // 이 팀의 입찰이 있는 월 목록 (선택한 원본 프로그램 기준, 최신순)
    const ymList = (() => {
      const set = new Set();
      state.bids.forEach((b) => {
        if (b.teamId !== team) return;
        const d = dayById(b.dayId);
        if (d && d.programId === srcPid) set.add(ymOf(d));
      });
      return Array.from(set).sort().reverse();
    })();
    const prevYm = `${prev.year}-${String(prev.month).padStart(2, '0')}`;
    const [srcYm, setSrcYm] = useState(() => (ymList.includes(prevYm) ? prevYm : (ymList[0] || prevYm)));
    useEffect(() => { setSrcYm(ymList.includes(prevYm) ? prevYm : (ymList[0] || prevYm)); }, [srcPid]);
    // 원본 입찰 목록
    const srcBids = state.bids.filter((b) => {
      if (b.teamId !== team) return false;
      const d = dayById(b.dayId);
      return d && d.programId === srcPid && ymOf(d) === srcYm;
    }).slice().sort((a, b2) => {
      const da = dayById(a.dayId), db = dayById(b2.dayId);
      return (da ? da.date : '').localeCompare(db ? db.date : '');
    });
    const [sel, setSel] = useState(() => new Set());
    const toggle = (id) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    // 대상: 현재 보고 있는 프로그램·월의 편성일
    const targetDays = daysInView(state).slice().sort((a, b2) => a.date.localeCompare(b2.date))
      .filter((d) => d.date.startsWith(`${state.view.year}-${String(state.view.month).padStart(2, '0')}`));
    const [targetDayId, setTargetDayId] = useState(targetDays[0] ? targetDays[0].id : '');
    function doImport() {
      if (sel.size === 0) { alert('가져올 입찰을 선택하세요.'); return; }
      if (!targetDayId) { alert('희망 편성일을 선택하세요.'); return; }
      const r = store.copyBids([...sel], targetDayId);
      alert(`${r.copied}건을 가져왔습니다.\n각 입찰을 클릭해 날짜·시간을 조정하세요.`);
      onClose();
    }
    const progName = (id) => (programs.find((p) => p.id === id) || {}).name || id;
    return html`
      <${Modal} title=${`📋 지난 입찰 가져오기 — ${teamOf(state, team).name}`} onClose=${onClose} onSave=${doImport}
        extra=${html`<div class="flex gap-2 mr-auto">
          <button onClick=${() => setSel(new Set(srcBids.map((b) => b.id)))} class="text-[12px] text-ink-soft hover:text-brand">전체 선택</button>
          <button onClick=${() => setSel(new Set())} class="text-[12px] text-ink-soft hover:text-brand">선택 해제</button>
        </div>`}>
        <div class="text-[12px] text-ink-soft -mt-1">
          다른 프로그램/지난 달에 올렸던 입찰을 <b>${progName(state.activeProgram)} ${state.view.month}월</b>로 복사합니다 (2차 편성).
          복사 후 각 입찰을 클릭해 날짜·시간을 조정하세요.
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[12px] font-semibold text-ink shrink-0">원본</span>
          <select value=${srcPid} onChange=${(e) => { setSrcPid(e.target.value); setSel(new Set()); }}
            class="text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none">
            ${programs.map((pg) => html`<option key=${pg.id} value=${pg.id}>${pg.name}</option>`)}
          </select>
          <select value=${srcYm} onChange=${(e) => { setSrcYm(e.target.value); setSel(new Set()); }}
            class="text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none">
            ${(ymList.length ? ymList : [srcYm]).map((y) => html`<option key=${y} value=${y}>${y.replace('-', '년 ')}월</option>`)}
          </select>
          <span class="text-[11px] text-ink-soft">— 내 팀 입찰 ${srcBids.length}건</span>
        </div>
        <div class="rounded-lg border border-slate-200 max-h-56 overflow-y-auto divide-y divide-slate-100">
          ${srcBids.length === 0
            ? html`<div class="text-[12px] text-slate-400 text-center py-4">이 프로그램·월에 내 팀 입찰이 없습니다.</div>`
            : srcBids.map((b) => {
              const d = dayById(b.dayId);
              const sl = d && d.slots.find((s) => s.id === b.slotId);
              const t = sl && sl.start ? `${sl.start}~${sl.end}` : (sl && sl.label) || '';
              return html`
                <label key=${b.id} class=${`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-[13px] ${sel.has(b.id) ? 'bg-brand-light/40' : 'hover:bg-slate-50'}`}>
                  <input type="checkbox" checked=${sel.has(b.id)} onChange=${() => toggle(b.id)} />
                  <span class="text-[11px] text-ink-soft tabular-nums shrink-0 w-24">${d ? d.date.slice(5).replace('-', '/') : ''}(${d ? U.WEEKDAY_KO[d.weekday] : ''}) ${t}</span>
                  <span class="font-medium text-ink min-w-0 truncate">${b.product && b.product.name}</span>
                  ${b.product && b.product.durationMin && html`<span class="text-[11px] text-ink-soft shrink-0">${b.product.durationMin}분</span>`}
                </label>`;
            })}
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[12px] font-semibold text-ink shrink-0">희망 편성일</span>
          <select value=${targetDayId} onChange=${(e) => setTargetDayId(e.target.value)}
            class="text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none">
            ${targetDays.map((d) => html`<option key=${d.id} value=${d.id}>${d.date.slice(5).replace('-', '/')} (${U.WEEKDAY_KO[d.weekday]})</option>`)}
          </select>
          <span class="text-[11px] text-ink-soft">선택한 ${sel.size}건이 이 날짜의 기본 시간대로 들어갑니다</span>
        </div>
      <//>`;
  }

  /* =====================================================================
   *  MD 입찰 보드
   * ===================================================================== */
  function BidBoard({ state, readOnly, lockTeam }) {
    const teams = state.teams || []; // MD 입찰은 전체 팀 대상(부문별 그룹 표시)
    const [detailBid, setDetailBid] = useState(null); // 조회 전용: 칩 클릭 → 읽기 상세
    const [importOpen, setImportOpen] = useState(false); // 지난 입찰 가져오기(2차 편성)
    const schema = programSchema(state);
    const fashion = schema === 'fashion';
    const [teamSel, setTeamSel] = useState(null);
    // MD 로그인: 자기 팀으로 고정 (팀 선택 없이 내 팀 입찰만 표시) — 팀명이 목록에 없으면 기존 방식 유지
    const lockedTeam = lockTeam ? teams.find((t) => t.name === lockTeam) : null;
    const team = lockedTeam ? lockedTeam.id
      : ((teamSel && teams.some((t) => t.id === teamSel)) ? teamSel : (teams[0] && teams[0].id));
    const [modal, setModal] = useState(null); // {dayId, slotId, bid?}
    const [addDayOpen, setAddDayOpen] = useState(false);
    const [slotModalDay, setSlotModalDay] = useState(null);
    const days = daysInView(state);
    const monthDayIds = new Set(days.map((d) => d.id));
    const teamBids = state.bids.filter((b) => b.teamId === team && monthDayIds.has(b.dayId));

    return html`
      <div class="flex-1 overflow-y-auto">
        <div class="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-2">
          <div class="flex items-baseline gap-2 flex-wrap">
            <span class="text-sm font-bold text-ink mr-1 shrink-0">${activeProgramObj(state).name} · 입찰팀</span>
            ${lockedTeam
              ? html`<span class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full text-white"
                  style=${{ background: lockedTeam.color }} title="로그인한 팀의 입찰만 표시됩니다">
                  <${TeamDot} color="#fff" /> ${lockedTeam.name}</span>
                <span class="text-[11px] text-ink-soft">내 팀 입찰만 표시</span>`
              : teamsGrouped(state).map(([div, ts]) => html`
              <span key=${div} class="inline-flex items-center gap-1 flex-wrap">
                <span class="text-[11px] font-semibold text-slate-400 ml-1">${div}</span>
                ${ts.map((t) => html`
                  <button key=${t.id} onClick=${() => setTeamSel(t.id)}
                    class=${`text-xs px-2.5 py-1 rounded-full border transition ${team === t.id ? 'text-white border-transparent' : 'bg-white text-ink-soft border-slate-300 hover:border-slate-400'}`}
                    style=${team === t.id ? { background: t.color } : {}}>
                    <${TeamDot} color=${t.color} /> <span class="ml-1">${t.name}</span>
                  </button>`)}
              </span>`)}
          </div>
        </div>
        <div class="p-4 space-y-3 max-w-[1100px]">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <h2 class="text-base font-bold text-ink">${teamOf(state, team).name} 입찰 · ${state.view.year}년 ${state.view.month}월 — 총 ${teamBids.length}건</h2>
            ${!readOnly && html`<div class="flex items-center gap-2">
              <button onClick=${() => setImportOpen(true)}
                class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand"
                title="다른 프로그램/지난 달에 올렸던 입찰을 이 달로 복사 (2차 편성)">📋 지난 입찰 가져오기</button>
              <button onClick=${() => setAddDayOpen(true)}
                class="text-xs px-2.5 py-1 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand">+ 편성일 추가</button>
            </div>`}
          </div>
          ${readOnly
            ? html`<div class="text-[11px] text-ink-soft -mt-1">🔎 조회 전용 — 입찰 카드를 클릭하면 상세 정보를 볼 수 있습니다.</div>`
            : html`<div class="text-[11px] text-ink-soft -mt-1">💡 날짜 변경: 입찰 카드를 <b>드래그해 다른 날짜 칸에 놓거나</b>, 카드 클릭 → <b>희망 편성일</b>을 바꿔 저장하면 이동됩니다.</div>`}
          ${days.length === 0 && html`<div class="text-sm text-slate-400 py-8 text-center">이 달에는 편성일이 없습니다. 위 “+ 편성일 추가”로 추가하세요.</div>`}
          ${days.map((day) => {
            // 시간대 표시를 팀별로 분리: 고정 띠(std)·수기 추가(manual)·순번(label)은 공통으로 보이고,
            // 잘게 쪼갠 시간대는 "지금 보는 팀의 입찰이 있는 것"만 표시 — 다른 팀이 쪼갠 시간이 내 화면을 어지럽히지 않음
            const baseSlots = day.slots.filter((slot) => slot.std || slot.manual || slot.label || teamBids.some((b) => b.slotId === slot.id));
            // 프로그램 고정 스케줄 띠는 항상 기준으로 표시: 실제 슬롯이 없어도(다른 팀이 쪼개 흡수된 경우) 가상 띠 행으로 노출
            const schedB = store.getSchedule ? store.getSchedule(day.programId) : null;
            const entryB = !fashion && schedB ? schedB.find((sc) => sc.wd === day.weekday) : null;
            const bandDefs = (day.bands && day.bands.length) ? day.bands : ((entryB && entryB.slots) || null);
            let rowSlots = bandDefs ? baseSlots.slice() : (baseSlots.length ? baseSlots : day.slots);
            if (bandDefs) bandDefs.forEach(([bs, be]) => {
              if (!day.slots.some((s) => s.start === bs && s.end === be))
                rowSlots.push({ id: 'virt_' + day.id + '_' + bs, start: bs, end: be, virtual: true });
            });
            const slotOrd = (sl) => sl.start ? U.toMin(sl.start)
              : 100000 + (parseInt(((sl.label || '').match(/\d+/) || [99])[0], 10) || 99);
            const shownSlots = rowSlots.sort((x, y) => slotOrd(x) - slotOrd(y));
            return html`
            <div key=${day.id} class="rounded-xl border border-slate-200 bg-white overflow-hidden"
              onDragOver=${(e) => { e.preventDefault(); e.currentTarget.classList.add('drop-active'); }}
              onDragLeave=${(e) => { if (e.currentTarget === e.target) e.currentTarget.classList.remove('drop-active'); }}
              onDrop=${(e) => {
                e.preventDefault(); e.currentTarget.classList.remove('drop-active');
                if (readOnly) return;
                const pl = drag.read(e);
                if (!pl || pl.kind !== 'bidmove') return;
                const bid = state.bids.find((x) => x.id === pl.id);
                if (!bid || bid.dayId === day.id) return;
                const fromDay = state.days.find((d) => d.id === bid.dayId);
                if (confirm(`[${bid.product.name}] 입찰을 ${fromDay ? fmtDay(fromDay) + ' → ' : ''}${fmtDay(day)}(으)로 이동할까요?`))
                  store.moveBidToDay(bid.id, day.id);
              }}>
              <div class="flex items-center justify-between px-3 py-1.5 bg-slate-100">
                <span class="flex items-center gap-2">
                  <span class="font-semibold text-[13px] text-ink">${fmtDay(day)}</span>
                  ${fashion && (readOnly
                    ? html`<span class="text-[11px] text-ink-soft">${day.airTime || ''}</span>`
                    : html`<${AirTimeButton} day=${day} />`)}
                </span>
                ${!readOnly && html`<div class="flex items-center gap-2 text-[11px] text-ink-soft">
                  ${!fashion && html`<button onClick=${() => setSlotModalDay(day.id)} class="hover:text-brand">+ 시간대</button>`}
                  ${!fashion && html`<button onClick=${() => store.addSlot(day.id, { order: true })} class="hover:text-brand">+ 순번</button>`}
                  <button onClick=${() => { const n = state.bids.filter((b) => b.dayId === day.id).length;
                    if (confirm(`${fmtDay(day)} 편성일을 삭제할까요?${n ? `\n이 날의 입찰 ${n}건은 삭제되지 않고 가까운 다른 날짜로 옮겨집니다.` : ''}`)) store.removeDay(day.id); }}
                    class="hover:text-brand">편성일 삭제</button>
                </div>`}
              </div>
              ${fashion ? html`
                <div class="px-3 py-2.5">
                  <div class="flex flex-wrap gap-1.5 items-start">
                    ${teamBids.filter((b) => b.dayId === day.id).map((b) => html`<${BidChip} key=${b.id} state=${state} b=${b} readOnly=${readOnly}
                        onEdit=${() => (readOnly ? setDetailBid(b) : setModal({ dayId: day.id, bid: b }))} />`)}
                    ${!readOnly && html`<button onClick=${() => setModal({ dayId: day.id })}
                      class="text-[12px] px-2 py-1 rounded border border-dashed border-slate-300 text-ink-soft hover:border-brand hover:text-brand self-start">
                      + 입찰
                    </button>`}
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
                          ${(readOnly || slot.virtual)
                            ? html`<span class="text-[13px] font-bold tabular-nums">${slotName(slot)}</span>`
                            : html`<${SlotTimeButton} slot=${slot} className="text-[13px] font-bold tabular-nums" />
                              <button title="이 시간대 삭제" onClick=${() => { const n = state.bids.filter((b) => b.slotId === slot.id).length;
                                if (confirm(`${slotName(slot)} 삭제할까요?${n ? `\n이 시간대의 입찰 ${n}건은 유지됩니다(다른 시간대/시간 미정으로 표시).` : ''}`)) store.removeSlot(slot.id); }}
                                class="text-slate-300 hover:text-brand text-[11px] leading-none">✕</button>`}
                        </div>
                        ${slot.start && slot.end && html`<div class="text-[11px] text-ink-soft">${U.slotDuration(slot)}분</div>`}
                      </div>
                      <div class="flex-1 flex flex-wrap gap-1.5 items-start">
                        ${bids.map((b) => html`<${BidChip} key=${b.id} state=${state} b=${b} readOnly=${readOnly}
                            onEdit=${() => (readOnly ? setDetailBid(b) : setModal({ dayId: day.id, slotId: slot.id, bid: b }))} />`)}
                        ${!readOnly && html`<button onClick=${() => setModal(slot.virtual
                            ? { dayId: day.id, start: slot.start, end: slot.end }
                            : { dayId: day.id, slotId: slot.id })}
                          class="text-[12px] px-2 py-1 rounded border border-dashed border-slate-300 text-ink-soft hover:border-brand hover:text-brand self-start">
                          + 입찰
                        </button>`}
                      </div>
                    </div>`;
                })}
                ${(() => {
                  // 슬롯이 삭제되어 시간 미정 상태가 된 입찰 — 잃어버리지 않게 별도 행으로 노출
                  const un = teamBids.filter((b) => b.dayId === day.id && !day.slots.some((sl) => sl.id === b.slotId));
                  if (!un.length) return '';
                  return html`<div class="flex gap-3 px-3 py-2 bg-amber-50/60">
                    <div class="w-28 shrink-0 pt-0.5 text-[12px] font-bold text-amber-700">시간 미정</div>
                    <div class="flex-1 flex flex-wrap gap-1.5 items-start">
                      ${un.map((b) => html`<${BidChip} key=${b.id} state=${state} b=${b} readOnly=${readOnly}
                        onEdit=${() => (readOnly ? setDetailBid(b) : setModal({ dayId: day.id, slotId: day.slots[0] && day.slots[0].id, bid: b }))} />`)}
                    </div>
                  </div>`;
                })()}
              </div>`}
            </div>`;
          })}
        </div>
        ${modal && html`<${BidModal} state=${state} team=${team} schema=${schema} ctx=${modal} onClose=${() => setModal(null)} />`}
        ${importOpen && html`<${ImportBidsModal} state=${state} team=${team} onClose=${() => setImportOpen(false)} />`}
        ${detailBid && html`<${BidDetailModal} state=${state} b=${detailBid} onClose=${() => setDetailBid(null)} />`}
        ${addDayOpen && html`<${AddDayModal} state=${state} onClose=${() => setAddDayOpen(false)} />`}
        ${slotModalDay && html`<${AddSlotModal} day=${state.days.find((d) => d.id === slotModalDay)} onClose=${() => setSlotModalDay(null)} />`}
      </div>`;
  }

  function BidChip({ state, b, onEdit, readOnly }) {
    const t = teamOf(state, b.teamId);
    const pr = b.product;
    const items = pr.items || [];
    const isGroup = items.length > 1;
    const tip = [pr.note && '내용:' + pr.note, pr.issue && '이슈:' + pr.issue, pr.comp && '구성:' + pr.comp,
                 pr.price && '가격:' + pr.price, pr.margin && '마진:' + pr.margin,
                 pr.sme && '중소', pr.special && ('특약' + (pr.specialNote ? ' ' + pr.specialNote : ''))].filter(Boolean).join(' / ');
    return html`
      <button onClick=${onEdit} title=${tip}
        draggable=${!readOnly} onDragStart=${(e) => (readOnly ? undefined : drag.start(e, 'bidmove', b.id))}
        class=${`card-drag text-left rounded-md border bg-white px-2 py-1 hover:shadow-sm ${isGroup ? 'min-w-[220px]' : ''}`}
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
          ${pr.special && html`<${Badge} color="#da291c">특약${pr.specialNote ? ' ' + pr.specialNote : ''}<//>`}
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
      specialNote: init.specialNote || '',
      groupCode: init.groupCode || '', recent: recent3(init.recent),
      items: (init.items || []).join('\n'), // 동시 묶음 상품 목록
    });
    const setRecent = (i) => (e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setF((s) => ({ ...s, recent: s.recent.map((x, j) => (j === i ? v : x)) })); };
    // 그룹코드: 기본 3칸, 필요 시 칸 추가 (저장 시 ' / '로 합쳐 기존 데이터와 호환)
    const [codes, setCodes] = useState(() => {
      const parts = String(init.groupCode || '').split(/[\/,\s]+/).filter(Boolean);
      while (parts.length < 3) parts.push('');
      return parts;
    });
    const setCode = (i) => (e) => setCodes((p) => p.map((c, j) => (j === i ? e.target.value : c)));
    const itemLines = f.items.split('\n').map((s) => s.trim()).filter(Boolean);
    const initSlot = state.days.flatMap((d) => d.slots).find((s) => s.id === ctx.slotId);
    const orderMode = !!(initSlot && initSlot.label && !initSlot.start);
    const [slotId, setSlotId] = useState(ctx.slotId);
    const [dayId, setDayId] = useState(ctx.dayId);
    const [start, setStart] = useState((initSlot && initSlot.start) || ctx.start || '20:45');
    const [end, setEnd] = useState((initSlot && initSlot.end) || ctx.end || '21:45');
    const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
    const setChk = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.checked }));
    // 노출분 ↔ 시작/종료 시간 자동 연동
    const [durStr, setDurStr] = useState(() => {
      const st = (initSlot && initSlot.start) || ctx.start || '', en = (initSlot && initSlot.end) || ctx.end || '';
      const d = (st && en) ? (U.toMin(en) - U.toMin(st) + 1440) % 1440 : 0;
      return d > 0 ? String(d) : '';
    });
    const onDurChange = (e) => {
      const v = e.target.value.replace(/[^\d]/g, '');
      setDurStr(v);
      const n = parseInt(v, 10);
      if (/^\d{1,2}:\d{2}$/.test(start) && n > 0) setEnd(U.toHHMM((U.toMin(start) + n) % 1440)); // 노출분 입력 → 종료 자동
    };
    const onStartChange = (v) => {
      setStart(v);
      const n = parseInt(durStr, 10);
      if (/^\d{1,2}:\d{2}$/.test(v) && n > 0) setEnd(U.toHHMM((U.toMin(v) + n) % 1440)); // 시작 변경 → 노출분 유지한 채 종료 이동
    };
    const onEndChange = (v) => {
      setEnd(v);
      if (/^\d{1,2}:\d{2}$/.test(start) && /^\d{1,2}:\d{2}$/.test(v)) {
        const d = (U.toMin(v) - U.toMin(start) + 1440) % 1440;
        if (d > 0) setDurStr(String(d));
      }
    };
    // 준비물량: 금액(억)·수량(세트) 분리 입력, 저장 시 "N억 / N세트"로 합침 (기존 텍스트는 보존)
    const prepStr0 = String(init.prep || '');
    const pm0 = prepStr0.match(/([\d.,]+)\s*억/);
    const pq0 = prepStr0.match(/([\d.,]+)\s*세트/);
    const [prepAmt, setPrepAmt] = useState(pm0 ? pm0[1] : '');
    const [prepQty, setPrepQty] = useState(pq0 ? pq0[1].replace(/,/g, '') : '');
    const prepFallback = (!pm0 && !pq0) ? prepStr0 : '';
    // 마진: 숫자만 입력하면 % 자동
    const marginBlur = () => setF((st) => (/^\d+(\.\d+)?$/.test((st.margin || '').trim()) ? { ...st, margin: st.margin.trim() + '%' } : st));

    const monthDays = daysInView(state);
    const day = state.days.find((d) => d.id === dayId) || monthDays[0];
    const durMin = (start && end) ? (U.toMin(end) - U.toMin(start) + 1440) % 1440 : 0;
    // 큰 띠 빠른 선택: 프로그램 고정 스케줄 기준 (다른 팀이 쪼갠 시간대가 아니라 항상 원래 띠를 제시)
    const bands = (() => {
      const sc = store.getSchedule ? store.getSchedule(day && day.programId) : null;
      const e2 = sc && day ? sc.find((x) => x.wd === day.weekday) : null;
      const defs = (day && day.bands && day.bands.length) ? day.bands : (e2 && e2.slots);
      if (defs && defs.length) return defs.map(([s2, e3]) => ({ id: 'band_' + s2, start: s2, end: e3 }));
      return (day ? day.slots : []).filter((s) => s.start && s.end);
    })();

    function save() {
      const items = f.items.split('\n').map((s) => s.trim()).filter(Boolean);
      let name = f.name.trim();
      if (!name && items.length) name = `(동시) ${items[0]}${items.length > 1 ? ` 외 ${items.length - 1}` : ''}`;
      if (!name) { alert('상품명을 입력하거나 동시 묶음 상품을 입력하세요.'); return; }
      // 수정 중 희망 편성일을 바꿨으면 → 해당 일자로 입찰 이동 (이후 시간/슬롯 갱신은 새 날짜 기준)
      if (b && dayId && dayId !== b.dayId) store.moveBidToDay(b.id, dayId);
      const prep = [
        prepAmt.trim() && prepAmt.trim() + '억',
        prepQty.trim() && Number(prepQty.trim().replace(/,/g, '')).toLocaleString() + '세트',
      ].filter(Boolean).join(' / ') || prepFallback;
      const product = {
        name, note: f.note, issue: f.issue, comp: f.comp, prep,
        // 마진: 숫자만 넣었으면 % 자동 부착 (blur 미발동 케이스 보정)
        price: f.price, margin: /^\d+(\.\d+)?$/.test((f.margin || '').trim()) ? f.margin.trim() + '%' : f.margin,
        sme: f.sme, special: f.special, isNew: f.isNew,
        specialNote: f.special ? f.specialNote.trim() : '',
        groupCode: codes.map((c) => c.trim()).filter(Boolean).join(' / '), recent: f.recent.some(Boolean) ? f.recent : undefined,
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
        <${Field} label=${itemLines.length > 1 ? '대표명 / 묶음명 (비우면 자동)' : '상품명 *'}>
          <input value=${f.name} onInput=${set('name')} class=${inputCls} autofocus placeholder=${itemLines.length > 1 ? '예: (동시) 필립림 25FW' : ''} /><//>
        <${Field} label=${`그룹코드 (${codes.filter((c) => c.trim()).length ? codes.filter((c) => c.trim()).length + '개' : '최대 ' + codes.length + '칸'})`}>
          <div class="flex flex-wrap items-center gap-1.5">
            ${codes.map((c, i) => html`<input key=${i} value=${c} onInput=${setCode(i)}
              class="w-28 text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none tabular-nums" placeholder=${'코드' + (i + 1)} />`)}
            <button type="button" onClick=${() => setCodes((p) => [...p, ''])}
              class="text-[12px] px-2 py-1.5 rounded border border-dashed border-slate-300 text-ink-soft hover:border-brand hover:text-brand" title="그룹코드 칸 추가">+ 칸 추가</button>
          </div>
        <//>
        <${Field} label=${`동시 묶음 상품 (한 줄에 하나씩 · 여러 개 붙여넣기 가능)${itemLines.length ? ` — ${itemLines.length}개` : ''}`}>
          <textarea value=${f.items} onInput=${set('items')} rows="3" class=${`${inputCls} font-mono text-[12px]`}
            placeholder=${'[동시] 필립림 그래픽 티셔츠 3종 (여성)\n[동시] 필립림 그래픽 티셔츠 3종 (남성)\n[동시] 필립림 워싱 데님 팬츠\n[동시] 필립림 보머자켓(세일)'}></textarea>
        <//>
        <div class="text-[11px] text-ink-soft -mt-1">패션 등 한 번에 여러 상품을 제안할 때: 위 칸에 줄바꿈으로 붙여넣으면 ‘동시 노출’ 묶음으로 한 카드에 묶여 한눈에 보입니다. 단일 상품이면 상품명만 입력하세요.</div>
        <div class="grid grid-cols-2 gap-3">
          <${Field} label="희망 편성일">
            <select value=${dayId} onChange=${(e) => { setDayId(e.target.value);
                const nd = state.days.find((d) => d.id === e.target.value); if (nd && nd.slots[0]) setSlotId(nd.slots[0].id); }}
              class=${`${inputCls} ${b && dayId !== b.dayId ? 'border-amber-400 bg-amber-50' : ''}`}>
              ${monthDays.map((d) => html`<option key=${d.id} value=${d.id}>${fmtDay(d)}</option>`)}
            </select>
            ${b && html`<div class=${`mt-1 text-[11px] ${dayId !== b.dayId ? 'text-amber-700 font-semibold' : 'text-ink-soft'}`}>
              ${dayId !== b.dayId ? '💡 저장하면 이 날짜로 입찰이 이동합니다' : '날짜를 바꿔 저장하면 해당 일자로 이동됩니다'}</div>`}
          <//>
          ${fashion
            ? html`<${Field} label="시간/순번">
                <div class="text-[12px] text-ink-soft px-2 py-1.5 rounded bg-slate-50 border border-slate-200">날짜 단위로 입찰합니다.</div><//>`
            : orderMode
            ? html`<${Field} label="희망 슬롯(순번)">
                <select value=${slotId} onChange=${(e) => setSlotId(e.target.value)} class=${inputCls}>
                  ${day.slots.map((s) => html`<option key=${s.id} value=${s.id}>${slotName(s)}</option>`)}
                </select><//>`
            : html`<${Field} label="방송 시간 (24시간) *">
                <div class="flex flex-col gap-1.5">
                  <div class="flex items-center gap-2">
                    <span class="text-[12px] text-ink-soft w-10 shrink-0">노출분</span>
                    <div class="flex items-center rounded border border-slate-300 focus-within:border-brand px-2" title="노출분을 넣으면 종료시간이 자동 계산됩니다">
                      <input value=${durStr} onInput=${onDurChange} inputmode="numeric" placeholder="예: 40"
                        class="w-16 py-1.5 text-[13px] tabular-nums text-right bg-transparent outline-none" />
                      <span class="text-[12px] text-ink-soft pl-0.5">분</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-[12px] text-ink-soft w-10 shrink-0">시간</span>
                    <${TimeInput} value=${start} onChange=${onStartChange} className="w-20 text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none" />
                    <span class="text-ink-soft shrink-0">~</span>
                    <${TimeInput} value=${end} onChange=${onEndChange} className="w-20 text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none" />
                  </div>
                </div>
                <div class="mt-1 text-[11px] text-ink-soft">노출분 입력 → 종료시간 자동 · 시작시간을 바꾸면 노출분(${durMin || '-'}분)에 맞춰 종료도 이동</div><//>`}
        </div>
        ${!fashion && !orderMode && bands.length > 0 && html`
          <div class="-mt-1 flex flex-wrap items-center gap-1">
            <span class="text-[11px] text-ink-soft">큰 띠:</span>
            ${bands.map((s) => html`<button type="button" key=${s.id}
              onClick=${() => { setStart(s.start); setEnd(s.end); setDurStr(String((U.toMin(s.end) - U.toMin(s.start) + 1440) % 1440)); }}
              class="text-[11px] px-1.5 py-0.5 rounded border border-slate-300 hover:border-brand hover:text-brand tabular-nums">${s.start}~${s.end}</button>`)}
            <span class="text-[11px] text-slate-400">→ 시작/종료를 직접 조정 (예: 20:45~21:05 = 20분)</span>
          </div>`}
        <${Field} label="내용 / 타이틀"><input value=${f.note} onInput=${set('note')} class=${inputCls} /><//>
        <${Field} label="이슈사항 / 특이사항"><textarea value=${f.issue} onInput=${set('issue')} rows="2" class=${inputCls}></textarea><//>
        <div class="grid grid-cols-2 gap-3">
          <${Field} label="구성"><input value=${f.comp} onInput=${set('comp')} class=${inputCls} placeholder="예: 6개월분" /><//>
          <${Field} label="준비물량 (숫자만 — 억·세트 자동)">
            <div class="flex items-center gap-1.5">
              <div class="flex-1 flex items-center rounded border border-slate-300 focus-within:border-brand px-2">
                <input value=${prepAmt} onInput=${(e) => setPrepAmt(e.target.value.replace(/[^\d.]/g, ''))} inputmode="decimal"
                  placeholder=${prepFallback || '금액'} class="w-full py-1.5 text-[13px] tabular-nums text-right bg-transparent outline-none" />
                <span class="text-[12px] text-ink-soft pl-0.5">억</span>
              </div>
              <div class="flex-1 flex items-center rounded border border-slate-300 focus-within:border-brand px-2">
                <input value=${prepQty} onInput=${(e) => setPrepQty(e.target.value.replace(/[^\d]/g, ''))} inputmode="numeric"
                  placeholder="수량" class="w-full py-1.5 text-[13px] tabular-nums text-right bg-transparent outline-none" />
                <span class="text-[12px] text-ink-soft pl-0.5">세트</span>
              </div>
            </div>
          <//>
          <${Field} label="가격"><input value=${f.price} onInput=${set('price')} class=${inputCls} placeholder="예: 179,000원" /><//>
          <${Field} label="마진 (숫자만 — % 자동)"><input value=${f.margin} onInput=${set('margin')} onBlur=${marginBlur} class=${inputCls} placeholder="예: 46" /><//>
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
          ${f.special && html`<input value=${f.specialNote} onInput=${set('specialNote')}
            placeholder="특약 조건 예: 50T·100T (50=50%)" class="w-52 text-[12px] px-2 py-1 rounded border border-amber-300 bg-amber-50 outline-none focus:border-brand" />`}
          <label class="flex items-center gap-1.5 text-[13px] cursor-pointer">
            <input type="checkbox" checked=${f.isNew} onChange=${setChk('isNew')} /> 신상품 여부</label>
        </div>
      <//>`;
  }

  /* =====================================================================
   *  캐스팅 관리 (관리자) — 프로그램별 PD·쇼호스트·스튜디오 추천 목록 편집
   *  → PD 캐스팅 입력 시 추천값으로 사용됨
   * ===================================================================== */
  function CastingManagerModal({ state, onClose }) {
    const programs = state.programs || [];
    const [pid, setPid] = useState(state.activeProgram || (programs[0] && programs[0].id) || '');
    const cur = castingOf(state, pid) || { pd: [], host: [], studio: [] };
    // 로컬 편집 상태 (프로그램 바뀌면 리셋)
    const [pd, setPd] = useState(cur.pd.slice());
    const [host, setHost] = useState(cur.host.slice());
    const [studio, setStudio] = useState(cur.studio.slice());
    useEffect(() => {
      const c = castingOf(state, pid) || { pd: [], host: [], studio: [] };
      setPd(c.pd.slice()); setHost(c.host.slice()); setStudio(c.studio.slice());
    }, [pid]);
    function save() {
      store.setCasting(pid, { pd, host, studio });
      onClose();
    }
    // 재사용 리스트 편집기: 항목 인라인 수정 + 삭제 + 추가
    const ListEditor = ({ label, color, items, setItems, ph }) => {
      const [add, setAdd] = useState('');
      const doAdd = () => { const v = add.trim(); if (!v) return; if (!items.includes(v)) setItems([...items, v]); setAdd(''); };
      return html`
        <div class="rounded-lg border border-slate-200 p-2.5 min-w-0">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[13px] font-bold" style=${{ color }}>${label}</span>
            <span class="text-[11px] text-ink-soft shrink-0">${items.length}명</span>
          </div>
          <div class="flex flex-col gap-1 max-h-40 overflow-y-auto">
            ${items.length === 0 && html`<div class="text-[12px] text-slate-400 py-1">등록된 항목이 없습니다.</div>`}
            ${items.map((it, i) => html`
              <div key=${i} class="flex items-center gap-1">
                <input value=${it} onInput=${(e) => setItems(items.map((x, j) => (j === i ? e.target.value : x)))}
                  class="flex-1 min-w-0 px-2 py-1 text-[13px] rounded border border-slate-300 focus:border-brand outline-none" />
                <button onClick=${() => setItems(items.filter((_, j) => j !== i))}
                  title="삭제" class="text-ink-soft hover:text-brand px-1 py-1 text-xs shrink-0">✕</button>
              </div>`)}
          </div>
          <div class="flex items-center gap-1 mt-1.5">
            <input value=${add} onInput=${(e) => setAdd(e.target.value)} placeholder=${ph}
              onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } }}
              class="flex-1 min-w-0 px-2 py-1 text-[13px] rounded border border-slate-300 focus:border-brand outline-none" />
            <button onClick=${doAdd} class="text-[12px] font-semibold px-2 py-1 rounded bg-brand text-white hover:bg-brand-dark shrink-0 whitespace-nowrap">추가</button>
          </div>
        </div>`;
    };
    return html`
      <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick=${onClose}>
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col" onClick=${(e) => e.stopPropagation()}>
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h3 class="font-bold text-ink">🎤 캐스팅 관리 <span class="text-[12px] font-normal text-ink-soft">— 프로그램별 PD·쇼호스트·스튜디오</span></h3>
            <button onClick=${onClose} class="text-ink-soft hover:text-brand text-lg leading-none">✕</button>
          </div>
          <div class="px-4 py-3 overflow-y-auto">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-[13px] font-semibold text-ink">프로그램</span>
              <select value=${pid} onChange=${(e) => setPid(e.target.value)} class="text-[13px] px-2 py-1.5 rounded border border-slate-300 focus:border-brand outline-none">
                ${programs.map((pg) => html`<option key=${pg.id} value=${pg.id}>${pg.name}</option>`)}
              </select>
            </div>
            <div class="text-[12px] text-ink-soft mb-3">여기서 관리하는 목록이 <b>PD 캐스팅 입력 시 추천값</b>으로 나타납니다. (직접 입력도 가능) 변경 후 <b>저장</b>을 누르세요.</div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              ${ListEditor({ label: '담당 PD', color: '#da291c', items: pd, setItems: setPd, ph: 'PD 이름' })}
              ${ListEditor({ label: '쇼호스트', color: '#0891b2', items: host, setItems: setHost, ph: '쇼호스트 이름' })}
              ${ListEditor({ label: '스튜디오', color: '#7c3aed', items: studio, setItems: setStudio, ph: '예: 250' })}
            </div>
          </div>
          <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200">
            <button onClick=${onClose} class="text-[13px] px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">취소</button>
            <button onClick=${save} class="text-[13px] font-semibold px-4 py-1.5 rounded bg-brand text-white hover:bg-brand-dark">저장</button>
          </div>
        </div>
      </div>`;
  }

  /* =====================================================================
   *  팀 관리 (관리자) — 조직개편 대응: 추가 / 이름·부문 수정 / 삭제
   * ===================================================================== */
  function TeamManagerModal({ state, onClose }) {
    const [newName, setNewName] = useState('');
    const [newDiv, setNewDiv] = useState('');
    const [newDivName, setNewDivName] = useState('');
    const [newPdTeam, setNewPdTeam] = useState('');
    const teams = state.teams || [];
    const divisions = state.divisions || [];
    const pdTeams = state.pdTeams || [];
    function addPd() {
      if (!newPdTeam.trim()) return;
      const r = store.addPdTeam(newPdTeam.trim());
      if (r && r.error) alert(r.error); else setNewPdTeam('');
    }
    function renamePd(d) { const nm = prompt('PD팀명 수정', d); if (nm === null) return; const r = store.renamePdTeam(d, nm.trim()); if (r && r.error) alert(r.error); }
    function delPd(d) { if (confirm(`PD 편성팀 [${d}]을(를) 삭제할까요?\n(로그인 선택지에서만 사라지며, 기존 기록은 유지)`)) store.removePdTeam(d); }
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
          <${Field} label="새 팀명 *"><input value=${newName} onInput=${(e) => setNewName(e.target.value)} class=${inputCls} placeholder="예: 무형상품팀" /><//>
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
        <div class="border border-slate-200 rounded-lg p-2 bg-slate-50/50">
          <div class="text-[12px] font-bold text-ink mb-1.5">PD 편성팀 <span class="font-normal text-ink-soft">(PD 로그인 소속 선택지)</span></div>
          <div class="flex flex-wrap gap-1.5 mb-2">
            ${pdTeams.length === 0 && html`<span class="text-[12px] text-slate-400">등록된 PD팀이 없습니다.</span>`}
            ${pdTeams.map((d) => html`
              <span key=${d} class="inline-flex items-center gap-1 text-[13px] bg-white border border-slate-200 rounded-full pl-3 pr-1.5 py-1">
                <span class="font-medium text-ink">${d}</span>
                <button onClick=${() => renamePd(d)} class="text-[11px] text-ink-soft hover:text-brand px-1">수정</button>
                <button onClick=${() => delPd(d)} class="text-[12px] text-rose-400 hover:text-rose-600">✕</button>
              </span>`)}
          </div>
          <div class="flex items-center gap-2">
            <input value=${newPdTeam} onInput=${(e) => setNewPdTeam(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') addPd(); }}
              class="flex-1 min-w-0 ${inputCls}" placeholder="예: 리빙PD팀" />
            <button onClick=${addPd} class="shrink-0 text-[13px] px-3 py-1.5 rounded bg-brand text-white hover:bg-brand-dark">+ PD팀</button>
          </div>
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
                    <span class="flex-1 min-w-0 font-medium text-ink truncate">${t.name}</span>
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
    const [prog, setProg] = useState('all');
    const [ym, setYm] = useState('all');
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

    // 상품별 이동 횟수 요약 (선택한 프로그램/월로 필터 — store 제자리변경이라 매 렌더 계산)
    const slotMonth = (() => { const m = {}; state.days.forEach((d) => d.slots.forEach((s) => { m[s.id] = d.date.slice(0, 7); })); return m; })();
    const moveSummary = (() => {
      const m = {};
      state.placements.forEach((p) => {
        if (!(p.moveCount > 0)) return;
        if (prog !== 'all' && p.programId !== prog) return;
        if (ym !== 'all' && slotMonth[p.slotId] !== ym) return;
        m[p.productName] = (m[p.productName] || 0) + p.moveCount;
      });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    })();
    function resetMoves() {
      const scope = (prog === 'all' ? '전체 프로그램' : progName(prog)) + ' / ' + (ym === 'all' ? '전체 월' : ym.slice(5) + '월');
      if (!confirm(`상품별 편성 이동횟수를 초기화합니다. (${scope})\n이동 기록만 0으로 리셋되며 편성 자체는 그대로입니다. 계속할까요?`)) return;
      store.resetMoveCounts({ programId: prog, ym });
    }

    const actions = ['all', ...Array.from(new Set(state.changeLog.map((l) => l.action)))];
    const actionColor = { 편성: '#16a34a', 이동: '#da291c', 편성제외: '#64748b', 입찰등록: '#0891b2',
      입찰수정: '#0891b2', 입찰삭제: '#64748b', 배정변경: '#7c3aed', 시간분할: '#d97706',
      시간추가: '#d97706', 시간삭제: '#64748b', 편성일추가: '#2563eb', 편성일삭제: '#64748b',
      편성수정: '#16a34a', 편성저장: '#0d9488', 편성복원: '#0d9488', 저장본삭제: '#64748b',
      팀추가: '#2563eb', 팀수정: '#7c3aed', 팀삭제: '#64748b', 팀병합: '#7c3aed', 팀정리: '#7c3aed',
      프로그램생성: '#2563eb', 프로그램삭제: '#64748b', 백업복원: '#da291c' };

    return html`
      <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick=${onClose}>
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick=${(e) => e.stopPropagation()}>
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h3 class="font-bold text-ink">변경 이력 추적</h3>
            <button onClick=${onClose} class="text-ink-soft hover:text-brand text-lg leading-none">✕</button>
          </div>

          ${moveSummary.length > 0 && html`
            <div class="px-4 py-2 bg-brand-light/60 border-b border-slate-200">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-[12px] font-semibold text-brand-dark">상품별 편성 이동 횟수
                  <span class="font-normal text-ink-soft">· ${prog === 'all' ? '전체' : progName(prog)} / ${ym === 'all' ? '전체 월' : ym.slice(5) + '월'}</span></span>
                ${isAdmin && html`<button onClick=${resetMoves}
                  class="text-[11px] px-2 py-0.5 rounded border border-rose-300 text-rose-600 bg-white hover:bg-rose-50 whitespace-nowrap" title="관리자 전용">이동횟수 초기화 🔒</button>`}
              </div>
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
                  <th class="px-3 py-1.5 font-medium w-24">프로그램</th>
                  <th class="px-3 py-1.5 font-medium w-16">월</th>
                  <th class="px-3 py-1.5 font-medium w-24">수정자</th>
                  <th class="px-3 py-1.5 font-medium w-20">동작</th>
                  <th class="px-3 py-1.5 font-medium">상품 / 내용</th>
                  <th class="px-3 py-1.5 font-medium">이동 (from → to)</th>
                </tr>
              </thead>
              <tbody>
                ${logs.length === 0 && html`<tr><td colspan="7" class="text-center text-slate-400 py-8">이력이 없습니다</td></tr>`}
                ${logs.map((l) => html`
                  <tr key=${l.id} class="border-t border-slate-100 hover:bg-slate-50 align-top">
                    <td class="px-3 py-1.5 text-ink-soft tabular-nums whitespace-nowrap">${fmtTs(l.ts)}</td>
                    <td class="px-3 py-1.5 whitespace-nowrap text-ink">${l.programId ? progName(l.programId) : '—'}</td>
                    <td class="px-3 py-1.5 whitespace-nowrap tabular-nums text-ink-soft">${l.ym ? l.ym.slice(5) + '월' : '—'}</td>
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
            백업은 <b>전체 데이터(모든 프로그램·입찰·편성)의 시점 스냅샷</b>입니다 — 사고 시 그 시각으로 통째로 되돌리는 안전망.
            변경이 있으면 <b>최대 1시간마다 자동 백업</b>되고, 복원 직전에도 자동 백업됩니다. 최근 60개 보관(이전 것은 자동 삭제).
            프로그램·월별 편성 이력은 여기가 아니라 <b>편성표/최종편성안의 “저장본”</b>에서 확인하세요.
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
    // 라벨에 '*'가 있으면 필수 항목 — 빨간 별표 + (필수) 로 표시
    let lab = label;
    if (typeof label === 'string' && label.includes('*')) {
      const t = label.replace(/\s*\*/g, '').trim();
      lab = html`${t} <span class="text-red-500 font-bold">*</span> <span class="text-[10px] text-red-400 font-normal">(필수)</span>`;
    }
    return html`<label class="block"><div class="text-[12px] font-medium text-ink-soft mb-1">${lab}</div>${children}</label>`;
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
          <${Field} label="정기 방송 요일 · 시간 *">
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
  function LoginGate({ onLogin, teams, pdTeams }) {
    const roles = window.AUTH.roles;
    const [role, setRole] = useState('pd');
    const [team, setTeam] = useState('');
    const [name, setName] = useState('');
    const [pw, setPw] = useState('');
    const [err, setErr] = useState('');
    const r = roles[role];
    // 팀 목록: MD = 관리되는 전체 입찰팀(팀 관리 반영), PD = 관리되는 PD 편성팀
    const teamList = role === 'md'
      ? Array.from(new Set((teams || []).map((t) => t.name)))
      : ((pdTeams && pdTeams.length) ? pdTeams : (window.AUTH.pdTeams || []));
    const fixedTeam = r.fixedTeam || '';           // 편성팀 등: 소속 고정 → 이름만 입력
    const needsTeam = role !== 'admin' && !fixedTeam;
    const needsName = role !== 'admin';
    function submit(e) {
      e && e.preventDefault();
      if (needsTeam && !team) { setErr('팀(소속)을 선택하세요.'); return; }
      if (needsName && !name.trim()) { setErr('이름을 입력하세요.'); return; }
      if (pw !== r.password) { setErr('비밀번호가 올바르지 않습니다.'); return; }
      onLogin(needsName
        ? { role, team: fixedTeam || team, name: name.trim() }
        : { role, team: '', name: '관리자' });
    }
    return html`
      <div class="min-h-screen flex flex-col bg-slate-100">
        <div class="flex-1 grid place-items-center p-4">
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
            </label>`}
            ${needsName && html`
            <label class="block">
              <div class="text-[12px] font-medium text-ink-soft mb-1">이름 <span class="text-brand">*</span></div>
              <input value=${name} onInput=${(e) => setName(e.target.value)} class=${inputCls}
                placeholder="예: 홍길동" />
            </label>`}
            <label class="block">
              <div class="text-[12px] font-medium text-ink-soft mb-1">${r.label} 공용 비밀번호 <span class="text-brand">*</span></div>
              <input type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} class=${inputCls} placeholder="비밀번호" autofocus=${!needsName} />
            </label>
          </div>
          ${!needsName && html`<div class="mt-2 text-[12px] text-ink-soft">관리자는 비밀번호만 입력하면 입장합니다.</div>`}
          ${fixedTeam && html`<div class="mt-2 text-[12px] text-ink-soft">${r.label}은 조회 전용입니다 — 이름과 비밀번호만 입력하면 입장합니다.</div>`}
          ${err && html`<div class="mt-2 text-[12px] text-brand">${err}</div>`}
          <button type="submit" class="mt-4 w-full py-2 rounded-lg bg-brand text-white font-semibold hover:bg-brand-dark">입장</button>
          <div class="mt-3 text-[11px] text-slate-400 leading-relaxed">
            팀·이름은 필수이며, 모든 수정 내역(변경 이력 · 카드 “마지막 수정”)에 자동 기록됩니다. 비밀번호 입력 후 Enter로도 입장됩니다.
          </div>
        </form>
        </div>
        <${MakerFooter} />
      </div>`;
  }

  /* =====================================================================
   *  저장 안 된 편성 초안 — 탭 이동 확인 팝업
   * ===================================================================== */
  function LeaveGuardModal({ count, onSave, onDiscard, onStay }) {
    return html`
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick=${(e) => e.stopPropagation()}>
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-5">
          <div class="text-base font-bold text-ink mb-1">⚠️ 저장되지 않은 편성 변경이 있습니다</div>
          <div class="text-[13px] text-ink-soft mb-4 leading-relaxed">
            편성표에서 수정한 <b class="text-brand">${count}건</b>이 아직 저장되지 않았습니다.<br/>
            저장하지 않고 이동하면 변경 내용이 다른 사람에게 반영되지 않습니다.
          </div>
          <div class="flex flex-col gap-2">
            <button onClick=${onSave} class="w-full text-[13px] font-semibold px-3 py-2 rounded bg-brand text-white hover:bg-brand-dark">저장하고 이동</button>
            <button onClick=${onDiscard} class="w-full text-[13px] px-3 py-2 rounded border border-slate-300 text-rose-600 hover:bg-rose-50">저장 안 함 — 변경을 취소하고 이동</button>
            <button onClick=${onStay} class="w-full text-[13px] px-3 py-2 rounded border border-slate-300 hover:bg-slate-50">계속 편집</button>
          </div>
        </div>
      </div>`;
  }

  /* =====================================================================
   *  제작자 고지 푸터 (전 화면 하단 고정)
   * ===================================================================== */
  function MakerFooter() {
    return html`
      <footer class="shrink-0 border-t border-slate-200 bg-white px-4 py-1.5 text-[11px] text-ink-soft flex items-center justify-center gap-x-2 gap-y-0.5 flex-wrap text-center">
        <span>제작 · 문의: <b class="text-ink">방송제작부문 식품PD팀 강성현</b></span>
        <span class="text-slate-300 hidden sm:inline">·</span>
        <span>수정·개선 요청은 제작자에게 연락 바랍니다</span>
      </footer>`;
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
    const [castMgr, setCastMgr] = useState(false);
    const [sbStatus, setSbStatus] = useState(
      (window.SUPABASE && window.SUPABASE.enabled) ? 'connecting' : null);
    useEffect(() => {
      window.__SB_STATUS = (s) => setSbStatus(s);
      return () => { window.__SB_STATUS = null; };
    }, []);
    // 로그인 식별을 데이터 계층에 반영 → 이후 모든 변경이 이 이름으로 기록됨
    const displayName = (a) => `${a && a.team ? a.team + ' ' : ''}${(a && a.name) || ''}`.trim();
    useEffect(() => { if (auth) store.setUser(displayName(auth), auth.role); }, [auth]);
    // 동시 접속자 목록 (Realtime Presence)
    const [presence, setPresence] = useState([]);
    useEffect(() => {
      window.__PRESENCE_UPDATE = (list) => setPresence(list || []);
      return () => { window.__PRESENCE_UPDATE = null; };
    }, []);
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
    // (편성표 초안이 저장 전이면 새로고침하지 않고 대기)
    useEffect(() => {
      const IDLE_MS = 30 * 60 * 1000;
      let timer = null;
      const reset = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (store.draftCount && store.draftCount() > 0) { reset(); return; } // 저장 안 된 초안 보호
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

    const roleCfg = auth ? (window.AUTH.roles[auth.role] || { tabs: ['schedule'], canManage: true, label: '', color: '#64748b' }) : null;
    const allowed = roleCfg ? roleCfg.tabs : [];
    const curTab = roleCfg ? (allowed.includes(tab) ? tab : allowed[0]) : null;

    // 초안(보류) 모드 제거 — 모든 수정은 즉시 서버에 반영(실시간 공유).
    // '편성 저장' 버튼은 저장본(되돌리기 지점) 기록 + 최종편성안 이동 용도로만 사용.
    useEffect(() => { if (store.endHold) store.endHold(); }, []);
    function guardTab(next) { setTab(next); }

    function doLogin(a) {
      try { localStorage.setItem(window.AUTH.storageKey, JSON.stringify({ ...a, ts: Date.now() })); } catch (e) {}
      store.setUser(displayName(a), a.role);
      setTab(window.AUTH.roles[a.role].tabs[0]);
      setAuth(a);
    }
    function logout() {
      const n = store.draftCount ? store.draftCount() : 0;
      if (!confirm(n > 0 ? `저장하지 않은 편성 변경 ${n}건이 사라집니다.\n그래도 로그아웃할까요?` : '로그아웃할까요?')) return;
      if (n > 0 && store.discardDraft) store.discardDraft();
      try { localStorage.removeItem(window.AUTH.storageKey); } catch (e) {}
      store.setUser(null);
      setAuth(null);
    }

    // 미로그인 → 로그인 화면 (훅은 모두 위에서 실행됨 — 순서 유지)
    if (!auth) return html`<${LoginGate} onLogin=${doLogin} teams=${state.teams} pdTeams=${state.pdTeams} />`;

    return html`
      <div class="flex flex-col min-h-screen md:h-screen">
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
                      : sbStatus === 'rows' ? '서버 연결됨 · 행동기화'
                      : sbStatus === 'saved' ? '서버 저장됨' : '서버 연결됨';
                    return html`<span class=${`ml-1 inline-flex items-center gap-1 px-1.5 rounded ${warn ? 'text-amber-600' : 'text-emerald-600'}`}>
                      <span class=${`w-1.5 h-1.5 rounded-full ${warn ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>${txt}</span>`;
                  })()}
                </div>
              </div>
            </div>
            <div class="shrink-0"><${MonthNav} view=${state.view} /></div>
            <nav class="flex items-center gap-1 shrink-0">
              ${allowed.includes('bids') && html`<button onClick=${() => guardTab('bids')}
                class=${tabCls(curTab === 'bids')}>MD 입찰</button>`}
              ${allowed.includes('board') && html`<button onClick=${() => guardTab('board')}
                class=${tabCls(curTab === 'board')}>입찰 보드</button>`}
              ${/* PD 캐스팅(상세 편성표) 탭은 내비에서 숨김 — 최종편성안 우측 하단 '편성표' 버튼으로 진입 가능 */''}
              ${curTab === 'schedule' && html`<button class=${tabCls(true)}>편성표 (상세)</button>`}
              ${allowed.includes('final') && html`<button onClick=${() => guardTab('final')}
                class=${tabCls(curTab === 'final')}>최종편성안</button>`}
              ${allowed.includes('finalview') && html`<button onClick=${() => guardTab('finalview')}
                class=${tabCls(curTab === 'finalview')}>최종편성안 조회</button>`}
              ${allowed.includes('finalpgm') && html`<button onClick=${() => guardTab('finalpgm')}
                class=${tabCls(curTab === 'finalpgm')}>최종편성안</button>`}
            </nav>
            <div class="ml-auto flex items-center gap-2 flex-wrap justify-end">
              <span class="flex items-center gap-1 text-[12px] px-2 py-1 rounded-full whitespace-nowrap shrink-0"
                style=${{ background: roleCfg.color + '18', color: roleCfg.color }} title="현재 로그인 — 모든 수정이 이 이름으로 기록됩니다">
                <span class="w-1.5 h-1.5 rounded-full" style=${{ background: roleCfg.color }}></span>
                <b>${roleCfg.label}</b><span class="opacity-80">· ${displayName(auth)}</span>
              </span>
              ${(() => {
                // 동시 접속자 아바타 (이름+역할 기준 중복 제거, 최대 5명 + 나머지 +N)
                const seen = new Set(); const uniq = [];
                presence.forEach((u) => {
                  if (!u || !u.name) return;
                  const k = (u.role || '') + '|' + u.name;
                  if (!seen.has(k)) { seen.add(k); uniq.push(u); }
                });
                if (uniq.length === 0) return '';
                const shown = uniq.slice(0, 5);
                const extra = uniq.length - shown.length;
                const initialOf = (n) => { const parts = String(n).trim().split(/\s+/); return (parts[parts.length - 1] || '?').charAt(0); };
                const colorOf = (r) => (window.AUTH.roles[r] && window.AUTH.roles[r].color) || '#64748b';
                return html`<span class="flex items-center -space-x-1.5 shrink-0"
                  title=${`동시 접속 ${uniq.length}명: ` + uniq.map((u) => `${u.name}(${(window.AUTH.roles[u.role] || {}).label || '?'})`).join(', ')}>
                  ${shown.map((u, i) => html`<span key=${i}
                    class="w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold text-white border-2 border-white shadow-sm"
                    style=${{ background: colorOf(u.role) }}>${initialOf(u.name)}</span>`)}
                  ${extra > 0 && html`<span class="w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold bg-slate-400 text-white border-2 border-white shadow-sm">+${extra}</span>`}
                </span>`;
              })()}
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
              ${roleCfg.isAdmin && html`<button onClick=${() => setCastMgr(true)}
                class="text-[13px] px-3 py-1.5 rounded border border-slate-300 bg-white hover:border-brand hover:text-brand whitespace-nowrap shrink-0"
                title="프로그램별 PD·쇼호스트·스튜디오 목록 관리 (캐스팅 추천값)">🎤 캐스팅 관리</button>`}
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
          ${curTab === 'board' ? html`<${ScheduleView} state=${state} simple=${true} onSaved=${() => setTab('final')} />`
            : curTab === 'schedule' ? html`<${ScheduleView} state=${state} onSaved=${() => setTab('final')} />`
            : curTab === 'final' ? html`<${FinalScheduleView} state=${state} onOpenSchedule=${allowed.includes('schedule') ? (() => guardTab('schedule')) : undefined} />`
            : curTab === 'finalview' ? html`<${FinalScheduleView} state=${state} readOnly=${true} />`
            : curTab === 'finalpgm' ? html`<${FinalScheduleView} state=${state} readOnly=${true} full=${true} />`
            : html`<${BidBoard} state=${state} readOnly=${!!roleCfg.viewOnly}
                lockTeam=${auth.role === 'md' ? (auth.team || '') : ''} />`}
        </main>

        ${history && html`<${HistoryModal} state=${state} isAdmin=${roleCfg.isAdmin} onClose=${() => setHistory(false)} />`}
        ${backup && html`<${BackupModal} isAdmin=${roleCfg.isAdmin} onClose=${() => setBackup(false)} />`}
        ${teamMgr && html`<${TeamManagerModal} state=${state} onClose=${() => setTeamMgr(false)} />`}
        ${castMgr && html`<${CastingManagerModal} state=${state} onClose=${() => setCastMgr(false)} />`}
        <${MakerFooter} />
      </div>`;
  }
  const tabCls = (active) =>
    `text-[13px] font-semibold px-3 py-1.5 rounded-lg transition whitespace-nowrap shrink-0 ${active ? 'bg-brand text-white' : 'text-ink-soft hover:bg-slate-100'}`;

  ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
})();
