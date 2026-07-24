/* =====================================================================
 * dataStore.js  —  데이터 계층 추상화
 * ---------------------------------------------------------------------
 * 모든 화면(편성표/입찰보드/이력)은 이 인터페이스만 통해 데이터를 읽고 씁니다.
 * 1단계: LocalStore (브라우저 localStorage)
 * 2단계: 동일한 인터페이스의 SupabaseStore 로 교체하면 멀티유저/서버저장 전환.
 *
 *   store.getState()            -> 현재 전체 상태 (읽기전용 스냅샷)
 *   store.subscribe(fn)         -> 변경 구독, 해제 함수 반환
 *   store.<mutation>(...)       -> 상태 변경 + changeLog 기록 + 구독자 통지
 * ===================================================================== */

(function (global) {
  'use strict';

  const STORAGE_KEY = 'choiyura-scheduler-v3';
  const uid = () => Math.random().toString(36).slice(2, 10);
  const nowISO = () => new Date().toISOString();

  /* ---------- 도메인 상수 ---------- */
  const TEAMS = [
    { id: 'home_app',  name: '가전팀',   color: '#2563eb' },
    { id: 'living',    name: '리빙팀',   color: '#0891b2' },
    { id: 'beauty1',   name: '뷰티1팀',  color: '#db2777' },
    { id: 'beauty2',   name: '뷰티2팀',  color: '#e11d48' },
    { id: 'health1',   name: '건식1팀',  color: '#16a34a' },
    { id: 'health2',   name: '건식2팀',  color: '#65a30d' },
    { id: 'food',      name: '식품팀',   color: '#ea580c' },
    { id: 'kitchen',   name: '주방팀',   color: '#d97706' },
    { id: 'fashion',   name: '패션잡화', color: '#7c3aed' },
    { id: 'etc',       name: '기타',     color: '#64748b' },
  ];

  // 2026 조직 표준 팀 (부문별) — 접속 시 1회 시드(teamsSeed2026 플래그), 이후 관리자가 추가/수정/삭제
  const TEAMS_2026 = [
    { name: '패션상품개발팀', div: '패션부문' }, { name: '트렌드패션팀', div: '패션부문' },
    { name: '잡화명품팀', div: '잡화레포츠부문' }, { name: '레포츠팀', div: '잡화레포츠부문' }, { name: '캐주얼팀', div: '잡화레포츠부문' },
    { name: '뷰티1팀', div: 'H&B부문' }, { name: '뷰티2팀', div: 'H&B부문' }, { name: '건식1팀', div: 'H&B부문' }, { name: '건식2팀', div: 'H&B부문' }, { name: '식품팀', div: 'H&B부문' },
    { name: '가전팀', div: '리빙부문' }, { name: '리빙팀', div: '리빙부문' }, { name: '주방팀', div: '리빙부문' }, { name: '무형상품팀', div: '리빙부문' },
    { name: '패션DT팀', div: '그로스비즈부문' }, { name: '해외DT팀', div: '그로스비즈부문' }, { name: '국내DT팀', div: '그로스비즈부문' },
  ];
  const DIVISIONS_2026 = ['패션부문', '잡화레포츠부문', 'H&B부문', '리빙부문', '그로스비즈부문', '기타'];
  // 부문 목록 기본값 보강 (없을 때만)
  function ensureDivisions(s) {
    if (!s) return s;
    if (!s.divisions) s.divisions = DIVISIONS_2026.slice();
    return s;
  }
  // PD 편성팀 목록 기본값 보강 (없을 때만) — 관리자가 추가/수정/삭제
  function ensurePdTeams(s) {
    if (!s) return s;
    if (!s.pdTeams) {
      const seed = (typeof window !== 'undefined' && window.AUTH && window.AUTH.pdTeams) || ['리빙PD팀', '식품PD팀', '잡화뷰티PD팀', '패션레포츠PD팀'];
      s.pdTeams = seed.slice();
    }
    return s;
  }
  // 프로그램별 캐스팅(PD·쇼호스트·스튜디오) 목록 기본값 보강 — 최초 1회만 AUTH.casting에서 이관.
  // 이후 관리자가 추가/수정/삭제 → state.casting 에 저장(서버 공유).
  function ensureCasting(s) {
    if (!s) return s;
    if (!s.casting) s.casting = {};
    if (!s.castingSeed) {
      const src = (typeof window !== 'undefined' && window.AUTH && window.AUTH.casting) || {};
      Object.keys(src).forEach((pid) => {
        if (!s.casting[pid]) {
          const c = src[pid] || {};
          s.casting[pid] = { pd: (c.pd || []).slice(), host: (c.host || []).slice(), studio: (c.studio || []).slice() };
        }
      });
      s.castingSeed = true;
    }
    return s;
  }
  // 이름 기준 병합(같은 이름이면 기존 팀 재사용 → 기존 입찰 데이터 매핑 유지), 없으면 추가. 1회만.
  function ensureTeams2026(s) {
    ensureDivisions(s);
    ensurePdTeams(s);
    ensureCasting(s);
    if (!s || s.teamsSeed2026) return s;
    s.teams = s.teams || [];
    const byName = new Map(s.teams.map((t) => [t.name, t]));
    let ci = s.teams.length;
    TEAMS_2026.forEach((t) => {
      const ex = byName.get(t.name);
      if (ex) { if (!ex.div) ex.div = t.div; }
      else { s.teams.push({ id: 'tm_' + t.name, name: t.name, color: PROGRAM_COLORS[ci % PROGRAM_COLORS.length], div: t.div }); ci++; }
    });
    s.teamsSeed2026 = true;
    return s;
  }

  // 표준 편성 시간대 템플릿
  const THU_SLOTS = [
    { start: '20:45', end: '21:45' }, // 60분
    { start: '21:45', end: '22:50' }, // 65분
  ];
  const SAT_SLOTS = [
    { start: '08:20', end: '09:20' },
    { start: '09:20', end: '10:20' },
    { start: '10:20', end: '10:35' }, // 15분
  ];
  const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

  /* ---------- 시간 유틸 ---------- */
  function toMin(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }
  function toHHMM(min) {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function slotDuration(slot) {
    let d = toMin(slot.end) - toMin(slot.start);
    if (d < 0) d += 24 * 60;
    return d;
  }
  function nextMonthOf(year, month) {
    let y = year, m = month + 1;
    if (m > 12) { m = 1; y += 1; }
    return { year: y, month: m };
  }
  // 두 시간대 슬롯이 겹치는지 (자정 넘김 고려)
  function slotOverlap(a, b) {
    if (!a.start || !a.end || !b.start || !b.end) return false;
    let as = toMin(a.start), ae = toMin(a.end); if (ae <= as) ae += 1440;
    let bs = toMin(b.start), be = toMin(b.end); if (be <= bs) be += 1440;
    return as < be && bs < ae;
  }

  /* ---------- 프로그램(테마PGM) ---------- */
  const MAIN_PROGRAM = 'pgm_최유라쇼';
  // 프로그램별 고정 편성 시간대 (요일 wd: 0=일..6=토, slots=[start,end]) — 매월 자동 생성
  const PROGRAM_SCHEDULE = {
    // extBefore = 앞 확장의 시작시간(종료는 첫 띠 시작에 물림) / extAfter = 뒤 확장의 종료시간(시작은 마지막 띠 종료에 물림)
    // 확장은 고정띠가 아님 — 접혀 있다가 펼치거나 상품이 있을 때만 표시
    'pgm_최유라쇼':  [{ wd: 4, slots: [['20:45', '21:45'], ['21:45', '22:50']], extBefore: '19:35' }, { wd: 6, slots: [['08:20', '09:20'], ['09:20', '10:20'], ['10:20', '10:35']], extAfter: '11:40' }],
    'pgm_유난희':    [{ wd: 4, slots: [['09:25', '10:25']] }],
    'pgm_엘쇼':      [{ wd: 6, slots: [['22:30', '01:00']] }],
    'pgm_룩앳미':    [{ wd: 4, slots: [['07:15', '09:25']] }],
    'pgm_최희히트템': [{ wd: 4, slots: [['18:30', '19:35']] }, { wd: 6, slots: [['17:30', '18:35']] }],
    'pgm_유리네':    [{ wd: 3, slots: [['19:35', '20:45']] }, { wd: 0, slots: [['08:50', '10:00']] }],
    'pgm_영스타일':  [{ wd: 3, slots: [['21:45', '22:55']] }, { wd: 5, slots: [['08:15', '10:25']] }],
    'pgm_쇼핑리스트': [{ wd: 0, slots: [['15:00', '16:10']] }],
  };
  // 패션 프로그램 (날짜 단위 입찰 → 고정 시간대 슬롯에 담김)
  const FASHION_PROGRAMS = new Set(['pgm_엘쇼', 'pgm_룩앳미', 'pgm_영스타일', 'pgm_최희히트템']);
  const PROGRAM_COLORS = ['#da291c', '#2563eb', '#0891b2', '#db2777', '#16a34a', '#ea580c',
    '#7c3aed', '#d97706', '#0d9488', '#e11d48', '#4f46e5', '#65a30d', '#9333ea', '#475569'];
  // 영스타일 수/금 → 하나로 병합, 리빙통합/패션통합 탭 제외
  const PROGRAM_MERGE = { 'pgm_영스타일수': 'pgm_영스타일', 'pgm_영스타일금': 'pgm_영스타일' };
  const EXCLUDE_PROGRAMS = new Set(['pgm_리빙통합', 'pgm_패션통합', 'pgm_레포츠PGM텐션업']);
  const normProgId = (id) => PROGRAM_MERGE[id] || id;
  // 겹치는 빈 고정(std) 슬롯 자동 정리 (더블링 방지 — 로드/동기화 시 항상 실행)
  function cleanupSlots(s) {
    if (!s || !s.days) return s;
    const bidSlot = new Set((s.bids || []).map((b) => b.slotId));
    const plSlot = new Set((s.placements || []).map((p) => p.slotId));
    const has = (sl) => bidSlot.has(sl.id) || plSlot.has(sl.id);
    s.days.forEach((day) => {
      const snap = day.slots.slice();
      day.slots = day.slots.filter((x) => {
        // 고아 조각 슬롯 제거: 고정(std)·수기(manual)·순번(label)·버킷이 아닌 시간 슬롯이
        // 입찰·편성 어디서도 참조되지 않으면 잔여물이므로 정리 (상품 이동 후 남는 빈 껍데기)
        if (!x.std && !x.manual && !x.label && !x.bucket && !has(x)) return false;
        if (!x.std || has(x)) return true;
        // 빈 고정슬롯이 다른 '내용 있는' 슬롯과 시간 겹치면 제거
        return !snap.some((o) => o.id !== x.id && has(o) && slotOverlap(x, o));
      });
    });
    repairOrphanPlacements(s); // 슬롯 소실로 화면에서 사라진 편성 복구
    return s;
  }
  // 고아 조각 슬롯만 빠르게 청소 (변경 때마다 호출 — std 로직은 건드리지 않음)
  function gcOrphanSlots(s) {
    if (!s || !s.days) return s;
    const bidSlot = new Set((s.bids || []).map((b) => b.slotId));
    const plSlot = new Set((s.placements || []).map((p) => p.slotId));
    s.days.forEach((day) => {
      day.slots = day.slots.filter((sl) =>
        sl.std || sl.manual || sl.label || sl.bucket || bidSlot.has(sl.id) || plSlot.has(sl.id));
    });
    return s;
  }
  // 고아 편성 복구: placement.slotId가 어느 날짜에도 없으면(동기화 경합 등으로 슬롯 소실)
  // 화면에서 상품이 통째로 사라지므로, 원본 입찰의 슬롯(살아있으면) 또는 해당 날짜 고정 띠로 재귀속
  function repairOrphanPlacements(s) {
    if (!s || !s.placements) return s;
    const slotSet = new Set((s.days || []).flatMap((d) => d.slots.map((x) => x.id)));
    (s.placements || []).forEach((p) => {
      if (slotSet.has(p.slotId)) return;
      const bid = p.sourceBidId && (s.bids || []).find((b) => b.id === p.sourceBidId);
      if (!bid) return; // 수기 편성은 날짜를 특정할 수 없음 — 유지
      if (slotSet.has(bid.slotId)) { p.slotId = bid.slotId; return; }
      const day = (s.days || []).find((d) => d.id === bid.dayId);
      if (day) {
        const t = day.slots.find((x) => x.std) || day.slots[0];
        if (t) p.slotId = t.id;
      }
    });
    return s;
  }
  // 제외 프로그램(텐션업 등)의 잔여 데이터를 상태에서 정리
  function pruneExcluded(s) {
    if (!s) return s;
    if (s.programs) s.programs = s.programs.filter((p) => !EXCLUDE_PROGRAMS.has(p.id));
    if (s.days) s.days = s.days.filter((d) => !EXCLUDE_PROGRAMS.has(d.programId));
    if (s.placements) s.placements = s.placements.filter((p) => !EXCLUDE_PROGRAMS.has(p.programId));
    if (s.snapshots) s.snapshots = s.snapshots.filter((x) => !EXCLUDE_PROGRAMS.has(x.programId));
    if (s.bids && s.days) { const ids = new Set(s.days.map((d) => d.id)); s.bids = s.bids.filter((b) => ids.has(b.dayId)); }
    if (s.activeProgram && EXCLUDE_PROGRAMS.has(s.activeProgram)) s.activeProgram = MAIN_PROGRAM;
    return s;
  }

  function mergedTeams() {
    const base = TEAMS.slice();
    const extra = (typeof window !== 'undefined' && window.PROGRAM_CONFIG && window.PROGRAM_CONFIG.teams) || [];
    const byId = new Set(base.map((t) => t.id));
    extra.forEach((t) => { if (!byId.has(t.id)) { base.push(t); byId.add(t.id); } });
    return base;
  }

  function parseDur(name) {
    const m = String(name || '').match(/\((\d{1,3})\s*분?\)/);
    return m ? parseInt(m[1], 10) : null;
  }

  /* ---------- 초기 시드 (2026년 목/토 표준 편성) ---------- */
  function buildSeedDays(year, month, programId) {
    const days = [];
    const last = new Date(year, month, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const date = new Date(year, month - 1, d);
      const wd = date.getDay(); // 0=일 ... 4=목 ... 6=토
      let template = null;
      if (wd === 4) template = THU_SLOTS;
      else if (wd === 6) template = SAT_SLOTS;
      if (!template) continue;
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        id: 'day_' + programId + '_' + dateStr,
        programId, date: dateStr, weekday: wd,
        slots: template.map((s) => ({ id: 'slot_' + uid(), start: s.start, end: s.end, std: true })),
      });
    }
    return days;
  }

  function buildYearDays(year, programId) {
    let days = [];
    for (let m = 1; m <= 12; m++) days = days.concat(buildSeedDays(year, m, programId));
    return days;
  }

  function seedPrograms() {
    const seed = (typeof window !== 'undefined' && window.PROGRAM_SEED);
    let list = (seed && seed.programs) ? seed.programs.slice() : [{ id: MAIN_PROGRAM, name: '최유라쇼' }];
    const out = []; const seen = new Set();
    list.forEach((p) => {
      if (EXCLUDE_PROGRAMS.has(p.id)) return;
      const id = normProgId(p.id);
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id, name: id === 'pgm_영스타일' ? '영스타일' : p.name });
    });
    out.sort((a, b) => (a.id === MAIN_PROGRAM ? -1 : b.id === MAIN_PROGRAM ? 1 : 0));
    return out.map((p, i) => ({ ...p, color: PROGRAM_COLORS[i % PROGRAM_COLORS.length] }));
  }

  function seedState() {
    return {
      meta: { title: '롯데홈쇼핑 테마PGM' },
      view: { year: 2026, month: 7 },
      programs: seedPrograms(),
      activeProgram: MAIN_PROGRAM,
      teams: mergedTeams(),
      days: buildYearDays(2026, MAIN_PROGRAM), // 최유라쇼 표준 목/토 (입찰용)
      bids: [],         // MD 입찰
      placements: [],   // PD 편성 (확정): + programId, detail{}, memo(PD 비고)
      snapshots: [],
      changeLog: [],
      hiddenDays: [], // 사용자가 삭제한 고정 스케줄 날짜 키('programId|YYYY-MM-DD') — ensureMonth 재생성 방지
      programSchedules: {}, // 관리자 생성 프로그램의 고정 스케줄 { pid: [{wd, slots:[[s,e]]}] }
      programMeta: {},      // 프로그램 부가정보 { pid: { fashion, custom, irregular } }
      programTeamIds: {},   // 프로그램별 대상 팀 { pid: [teamId,...] } — 없으면 PROGRAM_CONFIG/전체
    };
  }

  /* ===================================================================
   *  LocalStore
   * =================================================================== */
  function LocalStore() {
    let saveBackend = null; // 설정 시 localStorage 대신 이 함수로 저장 (Supabase 등)
    let rowMode = false;    // bids/placements를 개별 행 테이블로 동기화(활성 시) → 하이드레이트가 이들을 덮어쓰지 않음
    let currentUser = null; // 로그인한 사용자 표시명 — 이 브라우저 한정(서버 동기화 안 함)
    // ----- 편성표 초안(draft) 모드: 서버 반영 보류, '편성 저장' 시 일괄 반영 -----
    let holdSync = false;      // true면 변경을 로컬에만 저장(서버 업로드 보류)
    let draftDirty = 0;        // 보류 중 실제 변경 건수
    let serverBase = null;     // 보류 시작/마지막 반영 시점 상태(JSON) — '변경 취소' 복원용
    let pendingHydrate = null; // 보류 중 도착한 서버 상태(최신 1개) — 취소 시 이걸로 복원
    let suppressDirty = false; // 월/프로그램 이동 등 자동 생성은 변경 건수로 세지 않음
    let backupAPI = null;   // Supabase 백업/복원 구현 (connectSupabase 에서 주입)
    let snapAPI = null;
    let logArchive = null; // 변경 이력 아카이브 훅 (connectSupabase에서 주입)     // 편성 저장본 본문 분리 저장(app_state snap_* 행) — 메인 문서 비대화 방지
    let hydratedOnce = false; // 첫 서버 로드 이후에는 화면 이동(탭·월)을 로컬 유지
    // 접속(첫 로드) 시 초기 화면 = 최유라쇼 + 현재 월 (오늘 기준)
    function defaultView() {
      const d = new Date();
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    }
    // 같은 탭에서의 새로고침은 보던 화면(프로그램·월)을 유지 — sessionStorage(탭 닫으면 사라짐)
    // 새 탭/새 접속이면 저장이 없으므로 초기 화면으로 시작 (기존 '접속 시 초기화면' 규칙 유지)
    const NAV_KEY = 'scheduler-nav-v1';
    function savedNav() {
      try { const raw = sessionStorage.getItem(NAV_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    }
    function saveNav() {
      try {
        const prev = savedNav() || {};
        sessionStorage.setItem(NAV_KEY, JSON.stringify({ ...prev, pid: state.activeProgram, view: state.view }));
      } catch (e) {}
    }
    function initialNav(programs) {
      const nav = savedNav();
      const pidOk = nav && nav.pid && (!programs || programs.some((p) => p.id === nav.pid));
      return {
        pid: pidOk ? nav.pid : MAIN_PROGRAM,
        view: (nav && nav.view && nav.view.year) ? nav.view : defaultView(),
      };
    }
    // 화면 이동(activeProgram·view)은 클라이언트별 로컬 — 다른 접속자 변경이 내 화면을 바꾸지 않도록
    function keepLocalNav(newState, prev) {
      if (hydratedOnce && prev) {
        // 이후 하이드레이트(다른 접속자의 데이터 변경)는 내 화면 이동을 그대로 유지
        if (prev.activeProgram) newState.activeProgram = prev.activeProgram;
        if (prev.view) newState.view = prev.view;
      } else {
        // 첫 로드: 새로고침이면 보던 화면 복원, 새 접속이면 초기 화면
        const nav = initialNav(newState.programs);
        newState.activeProgram = nav.pid;
        newState.view = nav.view;
      }
      hydratedOnce = true;
      return newState;
    }
    // 프로그램 편성 스케줄 조회 — 기본(PROGRAM_SCHEDULE) + 관리자가 만든 커스텀(state.programSchedules)
    function progSchedule(pid) {
      return PROGRAM_SCHEDULE[pid] || ((state.programSchedules || {})[pid]) || null;
    }
    function allScheduledPids() {
      return Array.from(new Set([...Object.keys(PROGRAM_SCHEDULE), ...Object.keys(state.programSchedules || {})]));
    }
    function isFashionProgram(pid) {
      return FASHION_PROGRAMS.has(pid) || !!((state.programMeta || {})[pid] && state.programMeta[pid].fashion);
    }
    // 내장 프로그램(PROGRAM_CONFIG)의 대상팀을 state로 구체화 → 병합 시 팀 id 교체가 반영되도록
    function materializeProgramTeams() {
      state.programTeamIds = state.programTeamIds || {};
      const progCfg = (typeof window !== 'undefined' && window.PROGRAM_CONFIG && window.PROGRAM_CONFIG.programs) || {};
      Object.keys(progCfg).forEach((pid) => {
        if (!state.programTeamIds[pid]) state.programTeamIds[pid] = (progCfg[pid].teamIds || []).slice();
      });
    }
    // 한 팀(fromId)의 입찰·편성·프로그램 대상팀 참조를 toId로 이관
    function reassignTeam(fromId, toId) {
      (state.bids || []).forEach((b) => { if (b.teamId === fromId) b.teamId = toId; });
      (state.placements || []).forEach((p) => { if (p.teamId === fromId) p.teamId = toId; });
      if (state.programTeamIds) Object.keys(state.programTeamIds).forEach((pid) => {
        const arr = state.programTeamIds[pid] || [];
        state.programTeamIds[pid] = arr.map((id) => (id === fromId ? toId : id)).filter((id, i, a) => a.indexOf(id) === i);
      });
    }
    let state = load();
    // 첫 화면: 새로고침(같은 탭)이면 보던 화면 복원, 새 접속이면 초기 화면(최유라쇼+이번 달)
    {
      const nav0 = initialNav(state.programs);
      state.activeProgram = nav0.pid;
      state.view = nav0.view;
    }
    const subs = new Set();

    function load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return ensureTeams2026(cleanupSlots(pruneExcluded(JSON.parse(raw))));
      } catch (e) { /* ignore */ }
      const s = seedState();
      applyProgramSeed(s); // 14개 프로그램 확정편성안 자동 적재
      applySeedBids(s);    // 최유라쇼 MD 입찰 자동 적재
      ensureTeams2026(s);  // 2026 표준팀 + 부문 시드
      persist(s);
      return s;
    }
    // 프로그램 확정편성(window.PROGRAM_SEED)을 placements로 적재
    function applyProgramSeed(s) {
      const seed = (typeof window !== 'undefined' && window.PROGRAM_SEED);
      if (!seed || !seed.rows) return;
      seed.rows.forEach((row) => {
        if (EXCLUDE_PROGRAMS.has(row.programId)) return;
        const programId = normProgId(row.programId);
        let day = s.days.find((d) => d.programId === programId && d.date === row.date);
        if (!day) {
          const dt = new Date(row.date + 'T00:00:00');
          day = { id: 'day_' + programId + '_' + row.date, programId,
                  date: row.date, weekday: dt.getDay(), slots: [] };
          s.days.push(day);
        }
        let slot;
        if (row.label) { // 순번형 슬롯 (시간 없음)
          slot = day.slots.find((x) => x.label === row.label);
          if (!slot) { slot = { id: 'slot_' + uid(), start: '', end: '', label: row.label }; day.slots.push(slot); }
        } else {
          slot = day.slots.find((x) => x.start === row.start && x.end === row.end);
          if (!slot) {
            slot = { id: 'slot_' + uid(), start: row.start, end: row.end };
            day.slots.push(slot);
            day.slots.sort((a, b) => toMin(a.start) - toMin(b.start));
          }
        }
        const dt = row.detail || {};
        s.placements.push({
          id: uid(), slotId: slot.id, programId, sourceBidId: null, teamId: 'etc',
          productName: row.name, detail: dt, memo: '',
          note: dt.note || '', durationMin: parseDur(row.name),
          pd: '', host: '', studio: '', moveCount: 0, createdAt: nowISO(),
        });
      });
      s.days.sort((a, b) => a.date.localeCompare(b.date));
      s.changeLog.unshift({ id: uid(), ts: nowISO(), user: 'system', action: '초기적재',
        productName: '', teamName: '', from: '', to: '', detail: `테마PGM 확정편성 ${seed.rows.length}건 자동 적재` });
    }
    // 시드 입찰(window.BID_SEED)을 최유라쇼에 채움 (이력 없이)
    function applySeedBids(s) {
      const seed = (typeof window !== 'undefined' && window.BID_SEED) || [];
      if (!seed.length) return;
      seed.forEach((row) => {
        let day = s.days.find((d) => d.programId === MAIN_PROGRAM && d.date === row.date);
        if (!day) {
          const dt = new Date(row.date + 'T00:00:00');
          day = { id: 'day_' + MAIN_PROGRAM + '_' + row.date, programId: MAIN_PROGRAM,
                  date: row.date, weekday: dt.getDay(), slots: [] };
          s.days.push(day);
        }
        let slot = day.slots.find((x) => x.start === row.start && x.end === row.end);
        if (!slot) {
          slot = { id: 'slot_' + uid(), start: row.start, end: row.end };
          day.slots.push(slot);
          day.slots.sort((a, b) => toMin(a.start) - toMin(b.start));
        }
        s.bids.push({ id: uid(), teamId: row.teamId, dayId: day.id, slotId: slot.id,
                      product: row.product, createdAt: nowISO() });
      });
      s.days.sort((a, b) => a.date.localeCompare(b.date));
      s.changeLog.unshift({ id: uid(), ts: nowISO(), user: 'system', action: '초기적재',
        productName: '', teamName: '', from: '', to: '', detail: `최유라쇼 MD 입찰 ${seed.length}건 자동 적재` });
    }
    function persist(s, force) {
      // holdSync(초안 모드) 중에는 서버 반영을 보류(로컬만) — force=true(편성 저장)면 즉시 반영
      if (saveBackend) { saveBackend(s, holdSync && !force); return; }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
    }
    // ----- 되돌리기(undo)/다시(redo) 이력 -----
    const MAX_UNDO = 30;
    let undoStack = [];
    let redoStack = [];
    let baseline = null; // 마지막 커밋 시점 상태(JSON)
    function recordHistory() {
      const next = JSON.stringify(state);
      const changed = baseline !== null && next !== baseline;
      if (changed) {
        undoStack.push(baseline);
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        redoStack = [];
      }
      baseline = next;
      return changed;
    }
    function notify() { persist(state); subs.forEach((fn) => fn(state)); }
    function emit() {
      repairOrphanPlacements(state); // 슬롯 소실로 사라진 편성 즉시 복구
      gcOrphanSlots(state);          // 상품 이동 후 남은 빈 조각 슬롯 즉시 청소
      const changed = recordHistory();
      if (holdSync && changed && !suppressDirty) draftDirty++;
      notify();
    }
    function log(entry) {
      const v = state.view || {};
      state.changeLog.unshift({
        id: uid(), ts: nowISO(), user: currentUser || '익명',
        programId: state.activeProgram || null,
        ym: v.year ? `${v.year}-${String(v.month).padStart(2, '0')}` : null,
        action: '', productName: '', teamName: '', from: '', to: '', detail: '',
        ...entry,
      });
      // 하이브리드 이력: 문서에는 최근 200건만(팝업 즉시 표시·실시간 유지), 넘친 이력은 서버 아카이브 행으로 이동
      const MAXL = logArchive ? 200 : 1000; // 아카이브 미연결(로컬 모드)에서는 기존 상한 유지
      if (state.changeLog.length > MAXL) {
        const overflow = state.changeLog.splice(MAXL);
        if (logArchive) logArchive.push(overflow);
      }
    }
    // 변경 주체/시각 기록 (카드 "마지막 수정" 표시용)
    function stamp(o) { if (o) { o.editedBy = currentUser || ''; o.editedAt = nowISO(); } return o; }

    /* --- 조회 헬퍼 --- */
    function findSlot(slotId) {
      for (const day of state.days) {
        const s = day.slots.find((x) => x.id === slotId);
        if (s) return { day, slot: s };
      }
      return null;
    }
    function slotLabel(slotId) {
      const f = findSlot(slotId);
      if (!f) return '(삭제됨)';
      const dnum = Number(f.day.date.slice(8));
      const t = (f.slot.start && f.slot.end) ? `${f.slot.start}~${f.slot.end}` : (f.slot.label || '슬롯');
      return `${dnum}일(${WEEKDAY_KO[f.day.weekday]}) ${t}`;
    }
    function teamName(teamId) {
      const t = state.teams.find((x) => x.id === teamId);
      return t ? t.name : '';
    }
    // 같은 시간대 슬롯이 있으면 재사용, 없으면 생성
    function ensureSlotOnDay(day, start, end) {
      let slot = day.slots.find((x) => x.start === start && x.end === end);
      if (!slot) {
        slot = { id: 'slot_' + uid(), start, end };
        day.slots.push(slot);
        day.slots.sort((a, b) => (toMin(a.start || '00:00')) - (toMin(b.start || '00:00')));
      }
      return slot;
    }
    function detailOf(pr) {
      return { note: pr.note, issue: pr.issue, comp: pr.comp, prep: pr.prep, price: pr.price,
               margin: pr.margin, sme: pr.sme, special: pr.special, specialNote: pr.specialNote,
               isNew: pr.isNew, groupCode: pr.groupCode, recent: pr.recent };
    }
    // 날짜 단위 입찰용 슬롯:
    //  · 패션 프로그램 → '1부' 순번 슬롯 (방송시간은 day.airTime 에 별도 표기, 부는 PD가 나눔)
    //  · 라이프스타일(스케줄 有) → 고정 시간대 슬롯
    //  · 그 외 → '미정' 버킷
    function ensureBucketSlotOnDay(day) {
      const sched = progSchedule(day.programId);
      const entry = sched && sched.find((s) => s.wd === day.weekday);
      if (isFashionProgram(day.programId)) {
        if (entry && !day.airTime) day.airTime = entry.slots[0][0] + '~' + entry.slots[0][1];
        let slot = day.slots.find((x) => x.label && !x.start);
        if (!slot) { slot = { id: 'slot_' + uid(), start: '', end: '', label: '1부' }; day.slots.push(slot); }
        return slot;
      }
      if (entry && entry.slots.length) {
        const [s, e] = entry.slots[0];
        let slot = day.slots.find((x) => x.start === s && x.end === e);
        if (!slot) {
          slot = { id: 'slot_' + uid(), start: s, end: e, std: true };
          day.slots.push(slot);
          day.slots.sort((a, b) => (toMin(a.start || '00:00')) - (toMin(b.start || '00:00')));
        }
        return slot;
      }
      let slot = day.slots.find((x) => x.bucket);
      if (!slot) {
        slot = { id: 'slot_' + uid(), start: '', end: '', label: '미정', bucket: true, manual: true };
        day.slots.unshift(slot);
      }
      return slot;
    }
    function placementFromBid(bid, slotId, programId) {
      const pr = bid.product || {};
      return {
        id: uid(), slotId, programId, sourceBidId: bid.id, teamId: bid.teamId,
        productName: pr.name, note: pr.note || '', memo: '', detail: detailOf(pr),
        items: pr.items, durationMin: pr.durationMin || null,
        pd: '', host: '', studio: '', moveCount: 0, createdAt: nowISO(),
      };
    }

    /* =============================================================
     *  변이 (mutations)
     * ============================================================= */
    const api = {
      getState: () => state,
      subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
      // 로그인 식별 — 이 브라우저에서만 유지(서버 미동기화), 이후 모든 변경에 이름 기록
      setUser(name) { currentUser = name || null; },
      getUser: () => currentUser,

      // ----- 저장 백엔드(Supabase) 연동 훅 -----
      _snapshot: () => state,
      _useBackend(saveFn) { saveBackend = saveFn; },
      _hydrate(newState) { // 서버(메인 문서)에서 받은 상태로 교체 (재저장 안 함, 이력 초기화)
        // 초안 편집 중이면 서버 상태로 덮어쓰지 않고 보관 → 저장/취소 시 처리
        if (holdSync && draftDirty > 0) { pendingHydrate = newState; return; }
        // 행 동기화 모드: bids/placements는 개별 행 테이블이 소스이므로 메인 문서 값으로 덮어쓰지 않음
        if (rowMode) { newState.bids = state.bids; newState.placements = state.placements; }
        state = ensureTeams2026(cleanupSlots(keepLocalNav(pruneExcluded(newState), state)));
        baseline = JSON.stringify(state); undoStack = []; redoStack = [];
        serverBase = JSON.stringify(state);
        subs.forEach((fn) => fn(state));
      },
      // ----- 개별 행 동기화(bids/placements) 훅 -----
      _setRowMode(on) { rowMode = !!on; },
      _rowMode() { return rowMode; },
      // 초기 로드: 테이블에서 받은 행으로 교체(저장 안 함)
      _setRows(kind, arr) { state[kind] = arr || []; subs.forEach((fn) => fn(state)); },
      // 원격 행 변경 병합: upserts=[{...}], removedIds=[id] → 상태 반영 후 렌더(저장·이력 없음)
      _mergeRemote(kind, upserts, removedIds) {
        if (holdSync && draftDirty > 0) return; // 초안 편집 중엔 원격 변경으로 덮지 않음
        const arr = state[kind] || (state[kind] = []);
        (upserts || []).forEach((row) => {
          const i = arr.findIndex((x) => x.id === row.id);
          if (i >= 0) arr[i] = row; else arr.push(row);
        });
        if (removedIds && removedIds.length) {
          const rm = new Set(removedIds);
          state[kind] = arr.filter((x) => !rm.has(x.id));
        }
        subs.forEach((fn) => fn(state));
      },

      // ----- 편성표 초안(draft) 모드 API -----
      beginHold() { holdSync = true; draftDirty = 0; pendingHydrate = null; serverBase = JSON.stringify(state); },
      endHold() { holdSync = false; },
      isHolding() { return holdSync; },
      draftCount() { return holdSync ? draftDirty : 0; },
      // '편성 저장': 보류 중 변경을 서버에 일괄 반영
      flushDraft() {
        draftDirty = 0; pendingHydrate = null;
        serverBase = JSON.stringify(state);
        persist(state, true);
      },
      // '변경 취소': 보류 중 변경을 버리고 서버(또는 보류 직전) 상태로 복원
      discardDraft() {
        const src = pendingHydrate || (serverBase ? JSON.parse(serverBase) : null);
        pendingHydrate = null; draftDirty = 0;
        if (src) {
          state = ensureTeams2026(cleanupSlots(keepLocalNav(pruneExcluded(src), state)));
          baseline = JSON.stringify(state); undoStack = []; redoStack = [];
          serverBase = JSON.stringify(state);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
          subs.forEach((fn) => fn(state));
        }
      },

      // ----- 백업 / 복원 -----
      _setBackupAPI(api) { backupAPI = api; },
      backupNow() { return backupAPI ? backupAPI.now('manual') : Promise.resolve({ error: '서버 연결 시에만 백업할 수 있습니다.' }); },
      listBackups() { return backupAPI ? backupAPI.list() : Promise.resolve({ items: [], error: '서버 미연결' }); },
      restoreBackup(id) { return backupAPI ? backupAPI.restore(id) : Promise.resolve({ error: '서버 미연결' }); },
      exportJSON() { return JSON.stringify(state, null, 2); },
      // 백업 시점 데이터로 전체 교체 → notify() 가 서버('main')에도 저장하여 다른 접속자에 전파
      _applyRestore(data) {
        state = keepLocalNav(data, state);
        state.changeLog = state.changeLog || [];
        state.changeLog.unshift({ id: uid(), ts: nowISO(), user: currentUser || '익명',
          action: '백업복원', productName: '', teamName: '', from: '', to: '', detail: '백업 시점으로 전체 복원' });
        baseline = JSON.stringify(state); undoStack = []; redoStack = [];
        notify();
      },

      // ----- 되돌리기 / 다시 -----
      undo() {
        if (!undoStack.length) return false;
        redoStack.push(JSON.stringify(state));
        const prev = undoStack.pop();
        state = JSON.parse(prev);
        baseline = prev;
        notify();
        return true;
      },
      redo() {
        if (!redoStack.length) return false;
        undoStack.push(JSON.stringify(state));
        const next = redoStack.pop();
        state = JSON.parse(next);
        baseline = next;
        notify();
        return true;
      },
      canUndo: () => undoStack.length,
      canRedo: () => redoStack.length,

      // ----- 유틸 노출 -----
      util: { toMin, toHHMM, slotDuration, slotLabel, teamName, findSlot, WEEKDAY_KO, MAIN_PROGRAM },
      // 프로그램 고정 편성 스케줄 조회 (PD 편성표 시간띠 UI용 — 기본+커스텀)
      getSchedule(programId) { return progSchedule(programId); },

      /* ---------- 프로그램 ---------- */
      setActiveProgram(programId) {
        state.activeProgram = programId;
        saveNav(); // 새로고침 시 보던 화면 복원용
        this.ensureMonth(state.view.year, state.view.month, programId);
        // 다음 달 첫째주도 함께 보므로 다음 달 방송일도 미리 생성
        const nm = nextMonthOf(state.view.year, state.view.month);
        this.ensureMonth(nm.year, nm.month, programId);
        suppressDirty = true; try { emit(); } finally { suppressDirty = false; } // 이동은 초안 변경으로 세지 않음
      },

      /* ---------- 월/연 이동 ---------- */
      // 프로그램별 고정 편성 스케줄로 해당 월의 방송일 + 시간대를 미리 생성 (중복 없이)
      ensureMonth(year, month, programId) {
        const pid = programId || state.activeProgram || MAIN_PROGRAM;
        const sched = progSchedule(pid);
        if (!sched) return; // 스케줄 미정의(비정기) 프로그램은 수기 편성일만 사용
        const mm = String(month).padStart(2, '0');
        const last = new Date(year, month, 0).getDate();
        for (let dnum = 1; dnum <= last; dnum++) {
          const wd = new Date(year, month - 1, dnum).getDay();
          const entry = sched.find((s) => s.wd === wd);
          if (!entry) continue;
          const dateStr = `${year}-${mm}-${String(dnum).padStart(2, '0')}`;
          // 사용자가 삭제한 날짜는 재생성하지 않음
          if ((state.hiddenDays || []).includes(pid + '|' + dateStr)) continue;
          let day = state.days.find((d) => d.programId === pid && d.date === dateStr);
          // 기존 날짜는 절대 건드리지 않음 (편집된 슬롯 위에 고정슬롯 재생성 → 더블링 방지)
          if (day) continue;
          day = { id: 'day_' + pid + '_' + dateStr, programId: pid, date: dateStr, weekday: wd, slots: [] };
          state.days.push(day);
          if (isFashionProgram(pid)) {
            // 패션: 방송시간은 날짜 옆(airTime)에 표기, 슬롯은 '1부' 순번 (부는 PD가 나눔)
            day.airTime = entry.slots[0][0] + '~' + entry.slots[0][1];
            day.slots.push({ id: 'slot_' + uid(), start: '', end: '', label: '1부' });
          } else {
            entry.slots.forEach(([s, e]) => day.slots.push({ id: 'slot_' + uid(), start: s, end: e, std: true }));
          }
        }
        state.days.sort((a, b) => a.date.localeCompare(b.date));
      },
      // 모든 스케줄 프로그램에 대해 해당 월의 고정 시간대를 미리 생성
      ensureScheduleAll(year, month) {
        allScheduledPids().forEach((pid) => this.ensureMonth(year, month, pid));
      },
      setView(year, month) {
        this.ensureScheduleAll(year, month);
        // 다음 달 첫째주도 함께 노출 → 다음 달 방송일도 미리 생성
        const nm = nextMonthOf(year, month);
        this.ensureScheduleAll(nm.year, nm.month);
        state.view = { year, month };
        saveNav(); // 새로고침 시 보던 화면 복원용
        suppressDirty = true; try { emit(); } finally { suppressDirty = false; } // 이동은 초안 변경으로 세지 않음
      },
      shiftView(delta) {
        let { year, month } = state.view;
        month += delta;
        while (month > 12) { month -= 12; year += 1; }
        while (month < 1) { month += 12; year -= 1; }
        this.setView(year, month);
      },

      /* ---------- 입찰 (MD) — 입력 즉시 편성표에 자동 반영 ---------- */
      // {teamId, dayId, slotId?|(start,end), product, autoPlace=true}
      addBid({ teamId, dayId, slotId, start, end, part, product, autoPlace = true, bucket = false }) {
        const day = state.days.find((d) => d.id === dayId);
        if (!day) return;
        let slot = slotId ? day.slots.find((s) => s.id === slotId) : null;
        if (!slot && bucket) slot = ensureBucketSlotOnDay(day);
        if (!slot && start && end) slot = ensureSlotOnDay(day, start, end);
        if (!slot) return;
        const bid = stamp({ id: uid(), teamId, dayId, slotId: slot.id, part: part || null, product, createdAt: nowISO() });
        state.bids.push(bid);
        if (autoPlace) {
          state.placements.push(stamp(placementFromBid(bid, slot.id, day.programId)));
          log({ action: '입찰', productName: product.name, teamName: teamName(teamId),
                to: slotLabel(slot.id), detail: `${teamName(teamId)} 입찰 → 편성표 자동반영` });
        } else {
          log({ action: '입찰등록', productName: product.name, teamName: teamName(teamId), to: slotLabel(slot.id) });
        }
        emit();
        return bid;
      },
      // 지난 입찰 가져오기(2차 편성): 다른 프로그램/월의 입찰을 현재 보기의 날짜로 복사
      // 복사본은 대상 날짜의 고정 첫 띠(또는 미정/1부)에 담기며, 이후 자유롭게 시간·날짜 조정
      copyBids(bidIds, targetDayId) {
        const day = state.days.find((d) => d.id === targetDayId);
        if (!day) return { copied: 0, skipped: 0 };
        let copied = 0; let skipped = 0; let tid = null;
        // 중복 방지: 같은 원본을 이미 가져왔거나(copiedFrom), 대상 날짜에 같은 상품명 입찰이 있으면 건너뜀
        const dayBids = state.bids.filter((b) => b.dayId === day.id);
        const copiedFromIds = new Set(dayBids.map((b) => b.copiedFrom).filter(Boolean));
        const dayNames = new Set(dayBids.map((b) => (b.product && b.product.name) || '').filter(Boolean));
        (bidIds || []).forEach((id) => {
          const src = state.bids.find((b) => b.id === id);
          if (!src) return;
          const nm = (src.product && src.product.name) || '';
          if (copiedFromIds.has(src.id) || (nm && dayNames.has(nm))) { skipped++; return; }
          const product = JSON.parse(JSON.stringify(src.product || {}));
          const slot = ensureBucketSlotOnDay(day);
          const bid = stamp({ id: uid(), teamId: src.teamId, dayId: day.id, slotId: slot.id, product, copiedFrom: src.id, createdAt: nowISO() });
          state.bids.push(bid);
          state.placements.push(stamp(placementFromBid(bid, slot.id, day.programId)));
          copiedFromIds.add(src.id); if (nm) dayNames.add(nm);
          tid = src.teamId; copied++;
        });
        if (copied) {
          const pn = ((state.programs || []).find((p) => p.id === day.programId) || {}).name || '';
          log({ action: '입찰복사', teamName: teamName(tid),
                detail: `지난 입찰 ${copied}건 복사 → ${pn} ${day.date} (2차 편성)${skipped ? ` · 중복 ${skipped}건 제외` : ''}` });
          emit();
        }
        return { copied, skipped };
      },
      updateBid(bidId, patch) {
        const b = state.bids.find((x) => x.id === bidId);
        if (!b) return;
        if (patch.product) b.product = { ...b.product, ...patch.product };
        if (patch.part !== undefined) b.part = patch.part || null;
        const day = state.days.find((d) => d.id === b.dayId);
        const oldSlotId = b.slotId;
        if (patch.start && patch.end && day) {
          b.slotId = ensureSlotOnDay(day, patch.start, patch.end).id;
        } else if (patch.slotId) b.slotId = patch.slotId;
        // 연결된 편성(placement) 동기화 — 내용은 항상, 위치는 실제로 시간/슬롯이 바뀐 경우에만
        // (상품 정보만 고쳤는데 PD가 세분화해 둔 편성 위치가 원래 슬롯으로 튕기는 것 방지)
        const pl = state.placements.find((p) => p.sourceBidId === bidId);
        if (pl) {
          if (b.slotId !== oldSlotId) pl.slotId = b.slotId;
          pl.productName = b.product.name;
          pl.detail = detailOf(b.product); pl.items = b.product.items;
          pl.durationMin = b.product.durationMin || null;
          stamp(pl);
        }
        stamp(b);
        log({ action: '입찰수정', productName: b.product.name, teamName: teamName(b.teamId),
              to: slotLabel(b.slotId) });
        emit();
      },
      // MD 입찰 전용: 입찰을 고정 띠·부(순번)로 재배치 — 편성(placement) 위치는 건드리지 않음
      setBidBand(bidId, { start, end, part, durationMin }) {
        const b = state.bids.find((x) => x.id === bidId);
        if (!b) return;
        const day = state.days.find((d) => d.id === b.dayId);
        if (start && end && day) b.slotId = ensureSlotOnDay(day, start, end).id;
        if (part !== undefined) b.part = part || null;
        if (durationMin !== undefined && b.product) b.product.durationMin = durationMin || null;
        stamp(b);
        log({ action: '입찰띠정리', productName: (b.product && b.product.name) || '', teamName: teamName(b.teamId),
              to: `${start || ''}~${end || ''}${b.part ? ' · ' + b.part + '부' : ''}` });
        emit();
      },
      deleteBid(bidId) {
        const b = state.bids.find((x) => x.id === bidId);
        if (!b) return;
        state.bids = state.bids.filter((x) => x.id !== bidId);
        state.placements = state.placements.filter((p) => p.sourceBidId !== bidId);
        log({ action: '입찰삭제', productName: b.product.name, teamName: teamName(b.teamId) });
        emit();
      },
      // 입찰을 다른 날짜로 이동 — 시간대는 같은 시간, 순번은 같은 라벨로 새 날짜에 재배정
      moveBidToDay(bidId, newDayId) {
        const b = state.bids.find((x) => x.id === bidId);
        const day = state.days.find((d) => d.id === newDayId);
        if (!b || !day || b.dayId === newDayId) return;
        const oldDay = state.days.find((d) => d.id === b.dayId);
        const oldSlot = oldDay && oldDay.slots.find((s) => s.id === b.slotId);
        b.dayId = newDayId;
        let slot;
        if (oldSlot && oldSlot.start && oldSlot.end) slot = ensureSlotOnDay(day, oldSlot.start, oldSlot.end);
        else if (oldSlot && oldSlot.label) {
          slot = day.slots.find((s) => s.label === oldSlot.label && !s.start) || ensureBucketSlotOnDay(day);
        } else slot = ensureBucketSlotOnDay(day);
        b.slotId = slot.id;
        // 연결된 편성(placement)도 함께 이동
        const pl = state.placements.find((p) => p.sourceBidId === bidId);
        if (pl) { pl.slotId = slot.id; stamp(pl); }
        stamp(b);
        const fmt = (d) => d ? `${Number(d.date.slice(8))}일(${WEEKDAY_KO[d.weekday]})` : '';
        log({ action: '입찰이동', productName: b.product && b.product.name, teamName: teamName(b.teamId),
              from: fmt(oldDay), to: fmt(day) });
        emit();
        return { ok: true };
      },

      // 엑셀 일괄 가져오기: [{teamId, date, start, end, product}] → 날짜·시간대로 슬롯 매핑
      importBids(list) {
        let added = 0, newSlots = 0, newDays = 0, dup = 0;
        (list || []).forEach((row) => {
          let day = state.days.find((d) => d.programId === MAIN_PROGRAM && d.date === row.date);
          if (!day) {
            const dt = new Date(row.date + 'T00:00:00');
            day = { id: 'day_' + MAIN_PROGRAM + '_' + row.date, programId: MAIN_PROGRAM,
                    date: row.date, weekday: dt.getDay(), slots: [] };
            state.days.push(day);
            state.days.sort((a, b) => a.date.localeCompare(b.date));
            newDays++;
          }
          let slot = day.slots.find((s) => s.start === row.start && s.end === row.end);
          if (!slot) {
            slot = { id: 'slot_' + uid(), start: row.start, end: row.end };
            day.slots.push(slot);
            day.slots.sort((a, b) => toMin(a.start) - toMin(b.start));
            newSlots++;
          }
          const exists = state.bids.some((b) => b.teamId === row.teamId && b.slotId === slot.id &&
            b.product && b.product.name === row.product.name);
          if (exists) { dup++; return; }
          state.bids.push({ id: uid(), teamId: row.teamId, dayId: day.id, slotId: slot.id,
                            product: row.product, createdAt: nowISO() });
          added++;
        });
        log({ action: '엑셀가져오기', detail: `입찰 ${added}건 추가` +
              (newSlots ? ` · 시간대 ${newSlots}개 생성` : '') +
              (newDays ? ` · 편성일 ${newDays}개 생성` : '') +
              (dup ? ` · 중복 ${dup}건 제외` : '') });
        emit();
        return { added, newSlots, newDays, dup };
      },

      /* ---------- 편성 (PD) ---------- */
      // 입찰을 슬롯에 편성
      assignBid(bidId, slotId) {
        const b = state.bids.find((x) => x.id === bidId);
        if (!b) return;
        const f = findSlot(slotId);
        const pr = b.product || {};
        const p = {
          id: uid(), slotId, programId: f ? f.day.programId : MAIN_PROGRAM,
          sourceBidId: bidId, teamId: b.teamId,
          productName: pr.name, note: pr.note || '', memo: '',
          detail: { note: pr.note, issue: pr.issue, comp: pr.comp, price: pr.price, margin: pr.margin, sme: pr.sme },
          durationMin: pr.durationMin || null,
          pd: '', host: '', studio: '', moveCount: 0, createdAt: nowISO(),
        };
        stamp(p);
        state.placements.push(p);
        log({ action: '편성', productName: p.productName, teamName: teamName(b.teamId),
              from: '입찰풀', to: slotLabel(slotId) });
        emit();
        return p;
      },
      // 입찰카드를 (슬롯이 아닌) 날짜 영역에 놓았을 때: 부/시간대 슬롯 자동 생성 후 편성
      //  · part 지정 → 순번(1부…) 슬롯 / start 지정 → 시간대 슬롯 / 그 외 → 요일 고정(미정) 버킷
      assignBidToDay(bidId, dayId, { part, start, end, durationMin } = {}) {
        const b = state.bids.find((x) => x.id === bidId);
        const day = state.days.find((d) => d.id === dayId);
        if (!b || !day) return;
        let slot;
        if (part) {
          slot = day.slots.find((s) => s.label === part && !s.start);
          if (!slot) { slot = { id: 'slot_' + uid(), start: '', end: '', label: part, manual: true }; day.slots.push(slot); }
        } else if (start) {
          const dur = durationMin ? Number(durationMin) : ((b.product && b.product.durationMin) || null);
          // 노출분을 함께 지정하면 입찰 상품 정보에도 반영 (편성 카드에 희망 노출분 표시)
          if (durationMin) { b.product = b.product || {}; b.product.durationMin = Number(durationMin); }
          const e = end || toHHMM(toMin(start) + (dur || 60)); // 0분 슬롯 방지 — 기본 60분
          slot = ensureSlotOnDay(day, start, e); slot.manual = true;
        } else {
          slot = ensureBucketSlotOnDay(day);
        }
        return api.assignBid(bidId, slot.id);
      },
      // 수기 상품 추가 (PD 편성표): 시간 입력 → 해당 시간대 슬롯 자동 생성 후 편성
      addQuickPlacement({ dayId, start, end, durationMin, productName, teamId, part }) {
        const day = state.days.find((d) => d.id === dayId);
        if (!day) return;
        const dur = durationMin ? Number(durationMin) : null;
        let slot;
        if (part) {
          // 순번(1부/2부/3부) 슬롯: 있으면 재사용, 없으면 생성
          slot = day.slots.find((s) => s.label === part && !s.start);
          if (!slot) { slot = { id: 'slot_' + uid(), start: '', end: '', label: part, manual: true }; day.slots.push(slot); }
        } else {
          if (!start) return;
          const e = end || toHHMM(toMin(start) + (dur || 60)); // 0분 슬롯 방지 — 기본 60분
          slot = ensureSlotOnDay(day, start, e);
          slot.manual = true;
        }
        const p = stamp({
          id: uid(), slotId: slot.id, programId: day.programId, sourceBidId: null,
          teamId: teamId || 'etc', productName: productName || '(미정)', note: '', memo: '',
          detail: {}, durationMin: dur,
          pd: '', host: '', studio: '', moveCount: 0, createdAt: nowISO(),
        });
        state.placements.push(p);
        log({ action: '편성', productName: p.productName, teamName: teamName(p.teamId),
              from: '수기추가', to: slotLabel(slot.id) });
        emit();
        return p;
      },
      // 8월 프로그램별 입찰 일괄 가져오기 (엑셀 추출 데이터) — 해당 프로그램 8월 기존 입찰은 교체
      importAugBids(list) {
        if (!list || !list.length) return { added: 0 };
        const progs = new Set(list.map((x) => x.programId));
        const prefix = '2026-08';
        // 1) 대상 프로그램의 8월 기존 입찰 제거 (중복 방지)
        const augDayIds = new Set(state.days
          .filter((d) => progs.has(d.programId) && d.date.startsWith(prefix)).map((d) => d.id));
        state.bids = state.bids.filter((b) => !augDayIds.has(b.dayId));
        let added = 0, newDays = 0;
        list.forEach((it) => {
          let day = state.days.find((d) => d.programId === it.programId && d.date === it.date);
          if (!day) {
            const dt = new Date(it.date + 'T00:00:00');
            day = { id: 'day_' + it.programId + '_' + it.date, programId: it.programId,
                    date: it.date, weekday: dt.getDay(), slots: [] };
            state.days.push(day); newDays++;
          }
          let slot;
          if (it.bucket || !it.start) {
            // 날짜 단위 입찰 → 해당 요일 고정 시간대 슬롯에 담김 (없으면 미정 버킷)
            slot = ensureBucketSlotOnDay(day);
          } else {
            slot = day.slots.find((s) => s.start === it.start && s.end === it.end);
            if (!slot) {
              slot = { id: 'slot_' + uid(), start: it.start, end: it.end, manual: true };
              day.slots.push(slot);
              day.slots.sort((a, b) => (toMin(a.start || '00:00')) - (toMin(b.start || '00:00')));
            }
          }
          const product = it.product || { name: it.name };
          if (it.durationMin && !product.durationMin) product.durationMin = it.durationMin;
          state.bids.push(stamp({ id: uid(), teamId: it.teamId, dayId: day.id, slotId: slot.id, product, createdAt: nowISO() }));
          added++;
        });
        state.days.sort((a, b) => a.date.localeCompare(b.date));
        log({ action: '엑셀가져오기', detail: `8월 입찰 ${added}건 가져오기 (프로그램 ${progs.size}개)` + (newDays ? ` · 편성일 ${newDays}개 생성` : '') });
        emit();
        return { added, newDays, programs: progs.size };
      },
      // MD 입찰 잠금(프리징): 전체 프로그램·전체 월 일괄 — PD·관리자 편성 조정 중 MD 기입 차단
      setBidLock(locked) {
        if (locked) state.bidLockAll = { by: currentUser || '', ts: nowISO() };
        else delete state.bidLockAll;
        log({ action: locked ? '입찰잠금' : '입찰잠금해제',
              detail: locked ? '전체 MD 입찰 잠금 (편성 조정 중)' : '전체 MD 입찰 잠금 해제' });
        emit();
      },
      // 편성 잠금(관리자 전용): 잠그면 입찰보드·최종편성안 조정을 관리자만 할 수 있음 (전체 프로그램·전체 월)
      setBoardLock(locked) {
        if (locked) state.boardLockAll = { by: currentUser || '', ts: nowISO() };
        else delete state.boardLockAll;
        log({ action: locked ? '편성잠금' : '편성잠금해제',
              detail: locked ? '입찰보드·최종편성안 잠금 (관리자만 조정 가능)' : '입찰보드·최종편성안 잠금 해제' });
        emit();
      },
      // 날짜 운영 상태: null(정상) | 'off'(미운영·결방) | 'general'(테마PGM 대신 일반프로그램 운영)
      // 'off' 표기 시 이 날의 편성 상품은 입찰 풀(미편성)로 복귀 (수기추가 상품은 입찰로 변환해 보존)
      setDayStatus(dayId, { status, reason }) {
        const day = state.days.find((d) => d.id === dayId);
        if (!day) return;
        const st = status || null;
        if (st === 'off') {
          const slotIds = new Set(day.slots.map((s) => s.id));
          state.placements.filter((p) => slotIds.has(p.slotId)).forEach((p) => {
            if (!p.sourceBidId) {
              const product = { name: p.productName, ...(p.detail || {}), durationMin: p.durationMin, items: p.items };
              state.bids.push(stamp({ id: uid(), teamId: p.teamId, dayId: day.id, slotId: p.slotId, product, createdAt: nowISO() }));
            }
          });
          state.placements = state.placements.filter((p) => !slotIds.has(p.slotId));
        }
        if (st) { day.status = st; day.statusReason = (reason || '').trim(); }
        else { delete day.status; delete day.statusReason; }
        log({ action: '운영상태', from: day.date,
              detail: `${st === 'off' ? '미운영(결방)' : st === 'general' ? '일반프로그램 운영' : '정상 운영으로 해제'}${reason ? ' · ' + reason : ''}` });
        emit();
      },
      // 날짜별 방송시간(패션: 날짜 옆 표기) 수정
      setDayAirTime(dayId, text) {
        const day = state.days.find((d) => d.id === dayId);
        if (!day) return;
        day.airTime = (text || '').trim();
        log({ action: '방송시간수정', detail: `${day.date} 방송시간 ${day.airTime}` });
        emit();
      },
      // 편성시간 정리: 패션=1부 순번+airTime으로 통합 / 라이프스타일=미정버킷→고정슬롯, 잘못된 빈슬롯·빈날짜 제거
      fixScheduleSlots() {
        let merged = 0, removedSlots = 0, removedDays = 0;
        state.days.forEach((day) => {
          const sched = progSchedule(day.programId);
          if (!sched) return;
          const entry = sched.find((s) => s.wd === day.weekday);
          if (isFashionProgram(day.programId)) {
            // 방송시간: 기존 시간슬롯 or 스케줄 창 → day.airTime
            if (!day.airTime) {
              const ts = day.slots.find((x) => x.start && x.end);
              day.airTime = ts ? `${ts.start}~${ts.end}` : (entry ? `${entry.slots[0][0]}~${entry.slots[0][1]}` : '');
            }
            // '1부' 순번 슬롯 확보 후 모든 입찰/편성을 1부로 이동, 나머지 슬롯 제거
            let first = day.slots.find((x) => x.label === '1부');
            if (!first) { first = { id: 'slot_' + uid(), start: '', end: '', label: '1부' }; day.slots.push(first); }
            day.slots.forEach((s) => {
              if (s.id !== first.id) {
                state.bids.forEach((b) => { if (b.slotId === s.id) b.slotId = first.id; });
                state.placements.forEach((p) => { if (p.slotId === s.id) p.slotId = first.id; });
                merged++;
              }
            });
            day.slots = [first];
            return;
          }
          // 라이프스타일 (스케줄 슬롯을 재생성하지 않음 — 재생성이 더블링 원인)
          const validKeys = entry ? entry.slots.map(([s, e]) => s + '~' + e) : [];
          const hasContent = (sl) => state.bids.some((b) => b.slotId === sl.id) || state.placements.some((p) => p.slotId === sl.id);
          // 미정 버킷 → 그 날의 시간슬롯(없으면 스케줄 첫 슬롯 생성)에 병합
          let target = day.slots.find((x) => x.start && x.end && !x.bucket);
          if (!target && entry) { target = { id: 'slot_' + uid(), start: entry.slots[0][0], end: entry.slots[0][1], std: true }; day.slots.push(target); }
          if (target) {
            day.slots.filter((x) => x.bucket).forEach((b) => {
              state.bids.forEach((bd) => { if (bd.slotId === b.id) bd.slotId = target.id; });
              state.placements.forEach((p) => { if (p.slotId === b.id) p.slotId = target.id; });
              merged++;
            });
            day.slots = day.slots.filter((x) => !x.bucket);
          }
          // 빈 고정(std) 슬롯 제거: 스케줄에 없거나, 다른 '내용 있는' 슬롯과 시간이 겹치면
          const snapshot = day.slots.slice();
          day.slots = day.slots.filter((x) => {
            if (!x.std || hasContent(x)) return true;
            const key = (x.start || '') + '~' + (x.end || '');
            const notInSched = !validKeys.includes(key);
            const overlapsFilled = snapshot.some((o) => o.id !== x.id && hasContent(o) && slotOverlap(x, o));
            if (notInSched || overlapsFilled) { removedSlots++; return false; }
            return true;
          });
          day.slots.sort((a, b) => (toMin(a.start || '00:00')) - (toMin(b.start || '00:00')));
        });
        state.days = state.days.filter((d) => {
          if (!progSchedule(d.programId) || d.slots.length > 0) return true;
          removedDays++; return false;
        });
        log({ action: '편성정리', detail: `1부/고정 통합 ${merged}건 · 빈슬롯 ${removedSlots}개 · 빈날짜 ${removedDays}개 정리` });
        emit();
        return { merged, removedSlots, removedDays };
      },
      // 캐스팅 특이사항 메모 (PD/쇼호스트 휴가·불가일 등) — 프로그램별 + 월별 분리
      setCastingMemo(programId, ym, text) {
        if (!state.castingMemo) state.castingMemo = {};
        state.castingMemo[programId + '|' + ym] = text;
        log({ action: '캐스팅메모', detail: `${ym} 캐스팅 특이사항 수정` });
        emit();
      },
      // 빈 카드(입찰 없이) 직접 편성 (슬롯 더블클릭 등)
      addPlacement(slotId, { productName, teamId, note, durationMin }) {
        const f = findSlot(slotId);
        const p = {
          id: uid(), slotId, programId: f ? f.day.programId : state.activeProgram,
          sourceBidId: null, teamId: teamId || 'etc',
          productName: productName || '(미정)', note: note || '', memo: '', detail: {},
          durationMin: durationMin ? Number(durationMin) : null,
          pd: '', host: '', studio: '', moveCount: 0, createdAt: nowISO(),
        };
        stamp(p);
        state.placements.push(p);
        log({ action: '편성', productName: p.productName, teamName: teamName(p.teamId),
              from: '신규', to: slotLabel(slotId) });
        emit();
        return p;
      },
      movePlacement(placementId, toSlotId) {
        const p = state.placements.find((x) => x.id === placementId);
        if (!p || p.slotId === toSlotId) return;
        const fromLabel = slotLabel(p.slotId);
        p.slotId = toSlotId;
        p.moveCount = (p.moveCount || 0) + 1;
        stamp(p);
        log({ action: '이동', productName: p.productName, teamName: teamName(p.teamId),
              from: fromLabel, to: slotLabel(toSlotId), detail: `${p.moveCount}회차 이동` });
        emit();
      },
      // 다른 날짜로 이동: 원래 슬롯의 시간/순번을 대상 날짜에 자동 생성 후 편성
      movePlacementToDay(placementId, dayId) {
        const p = state.placements.find((x) => x.id === placementId);
        const day = state.days.find((d) => d.id === dayId);
        if (!p || !day) return;
        const cur = findSlot(p.slotId);
        if (cur && cur.day.id === dayId) return; // 같은 날이면 무시
        let slot;
        if (cur && cur.slot.start && cur.slot.end) {
          slot = ensureSlotOnDay(day, cur.slot.start, cur.slot.end); slot.manual = true;
        } else if (cur && cur.slot.label) {
          slot = day.slots.find((s) => s.label === cur.slot.label && !s.start);
          if (!slot) { slot = { id: 'slot_' + uid(), start: '', end: '', label: cur.slot.label, manual: true }; day.slots.push(slot); }
        } else {
          slot = ensureBucketSlotOnDay(day);
        }
        const fromLabel = slotLabel(p.slotId);
        p.slotId = slot.id;
        p.moveCount = (p.moveCount || 0) + 1;
        stamp(p);
        log({ action: '이동', productName: p.productName, teamName: teamName(p.teamId),
              from: fromLabel, to: slotLabel(slot.id), detail: '다른 날짜로 이동(시간대 자동생성)' });
        emit();
      },
      // 같은 날짜 내에서 새 부(순번) 또는 새 시간대로 이동 (드롭 시 자동 분할)
      movePlacementToSlotSpec(placementId, dayId, { part, start, end, durationMin }) {
        const p = state.placements.find((x) => x.id === placementId);
        const day = state.days.find((d) => d.id === dayId);
        if (!p || !day) return;
        let slot;
        if (part) {
          slot = day.slots.find((s) => s.label === part && !s.start);
          if (!slot) { slot = { id: 'slot_' + uid(), start: '', end: '', label: part, manual: true }; day.slots.push(slot); }
        } else if (start) {
          const dur = durationMin ? Number(durationMin) : (p.durationMin || null);
          const e = end || toHHMM(toMin(start) + (dur || 60)); // 0분 슬롯 방지 — 기본 60분
          slot = ensureSlotOnDay(day, start, e); slot.manual = true;
        } else return;
        const fromLabel = slotLabel(p.slotId);
        // 노출분을 함께 지정하면 편성·원본 입찰에 반영 (띠 안 시간 배분 참고용)
        if (durationMin) {
          p.durationMin = Number(durationMin);
          if (p.sourceBidId) {
            const b = state.bids.find((x) => x.id === p.sourceBidId);
            if (b) { b.product = b.product || {}; b.product.durationMin = Number(durationMin); stamp(b); }
          }
        }
        if (p.slotId === slot.id) { if (durationMin) { stamp(p); emit(); } return; }
        p.slotId = slot.id;
        p.moveCount = (p.moveCount || 0) + 1;
        stamp(p);
        log({ action: '이동', productName: p.productName, teamName: teamName(p.teamId),
              from: fromLabel, to: slotLabel(slot.id), detail: '같은 날짜 내 이동' });
        emit();
      },
      // 고아 편성 복구 — 슬롯이 사라져 화면에서 안 보이는 편성을 원본 입찰의 슬롯/날짜로 재부착.
      // (v155 행모드 이후 메인 문서에 placements가 없어 하이드레이트 시점의 repair가 잡지 못함 → 행 로드 후 호출)
      repairOrphans() {
        const slotSet = new Set(state.days.flatMap((d) => d.slots.map((x) => x.id)));
        let fixed = 0;
        const names = [];
        state.placements.forEach((p) => {
          if (slotSet.has(p.slotId)) return;
          const bid = p.sourceBidId && state.bids.find((b) => b.id === p.sourceBidId);
          if (!bid) return; // 수기 편성은 날짜 특정 불가 — 유지
          if (slotSet.has(bid.slotId)) { p.slotId = bid.slotId; stamp(p); fixed++; names.push((p.productName || '').slice(0, 12)); return; }
          const day = state.days.find((d) => d.id === bid.dayId);
          if (day) {
            let t = day.slots.find((x) => x.std) || day.slots[0];
            if (!t) { // 슬롯이 하나도 없는 날 — 프로그램 스케줄 첫 띠(없으면 시간 미정 버킷)로 복구
              const sc = progSchedule(day.programId);
              const en = sc && sc.find((x2) => x2.wd === day.weekday);
              t = (en && en.slots && en.slots[0]) ? ensureSlotOnDay(day, en.slots[0][0], en.slots[0][1])
                : ensureBucketSlotOnDay(day);
            }
            // manual 표시 필수: 행모드 하이드레이트의 슬롯 청소가 (문서에 bids/placements가 없어)
            // 참조를 못 보고 무표식 슬롯을 지워버림 → 복구가 접속마다 반복되는 루프 방지
            if (t && !t.std && !t.bucket) t.manual = true;
            if (t) { p.slotId = t.id; stamp(p); fixed++; names.push((p.productName || '').slice(0, 12)); }
          }
        });
        if (fixed) { log({ action: '편성복구', detail: `사라진 편성 ${fixed}건 자동 복구: ${names.slice(0, 3).join(', ')}${fixed > 3 ? ` 외 ${fixed - 3}건` : ''}` }); emit(); }
        return fixed;
      },
      removePlacement(placementId) {
        const p = state.placements.find((x) => x.id === placementId);
        if (!p) return;
        // 원본 입찰의 희망일이 과거 월이면 풀(전월+당월 필터)에서 안 보이므로, 편성돼 있던 날짜로 당겨줌
        if (p.sourceBidId) {
          const b = state.bids.find((x) => x.id === p.sourceBidId);
          const f0 = findSlot(p.slotId);
          if (b && f0 && b.dayId !== f0.day.id) { b.dayId = f0.day.id; b.slotId = p.slotId; stamp(b); }
        }
        // 입찰 없이 직접 편성(수기추가 등)한 상품은 삭제 대신 입찰풀로 되돌림
        if (!p.sourceBidId) {
          const f = findSlot(p.slotId);
          const product = { name: p.productName, ...(p.detail || {}), durationMin: p.durationMin, items: p.items };
          state.bids.push(stamp({ id: uid(), teamId: p.teamId, dayId: f ? f.day.id : null, slotId: p.slotId, product, createdAt: nowISO() }));
        }
        state.placements = state.placements.filter((x) => x.id !== placementId);
        log({ action: '편성제외', productName: p.productName, teamName: teamName(p.teamId),
              from: slotLabel(p.slotId), detail: p.sourceBidId ? '입찰풀로 복귀' : '입찰풀로 복귀(수기추가)' });
        emit();
      },
      // 완전 삭제 — 입찰 풀로 돌려보내지 않고 상품(과 원본 입찰)을 지움 (수기추가 정리용)
      deletePlacement(placementId) {
        const p = state.placements.find((x) => x.id === placementId);
        if (!p) return;
        state.placements = state.placements.filter((x) => x.id !== placementId);
        if (p.sourceBidId) state.bids = state.bids.filter((b) => b.id !== p.sourceBidId);
        log({ action: '상품삭제', productName: p.productName, teamName: teamName(p.teamId),
              from: slotLabel(p.slotId), detail: p.sourceBidId ? '원본 입찰 포함 완전 삭제' : '완전 삭제(수기추가)' });
        emit();
      },
      // 편성 카드의 부(순번) 지정/해제 — PD·관리자용. 원본 입찰이 있으면 함께 동기화
      setPlacementPart(placementId, part) {
        const p = state.placements.find((x) => x.id === placementId);
        if (!p) return;
        p.part = part || null;
        stamp(p);
        if (p.sourceBidId) {
          const b = state.bids.find((x) => x.id === p.sourceBidId);
          if (b) { b.part = part || null; stamp(b); }
        }
        log({ action: '부지정', productName: p.productName, teamName: teamName(p.teamId),
              detail: part ? `${part}부로 지정` : '부(순번) 지정 해제' });
        emit();
      },
      updatePlacementMeta(placementId, patch) {
        const p = state.placements.find((x) => x.id === placementId);
        if (!p) return;
        Object.assign(p, patch);
        stamp(p);
        // 노출분 변경 → 단독 편성된 시간대 띠를 그 길이에 맞춰 자동 조정
        let timeMsg = '';
        if (patch.durationMin) {
          const f = findSlot(p.slotId);
          const inSlot = state.placements.filter((x) => x.slotId === p.slotId);
          if (f && f.slot.start && inSlot.length === 1) {
            f.slot.end = toHHMM(toMin(f.slot.start) + Number(patch.durationMin));
            timeMsg = ` · 시간대 ${f.slot.start}~${f.slot.end}(${patch.durationMin}분)로 조정`;
          }
        }
        log({ action: '배정변경', productName: p.productName, teamName: teamName(p.teamId),
              detail: `PD:${p.pd||'-'} / 쇼호스트:${p.host||'-'} / 스튜디오:${p.studio||'-'}${timeMsg}` });
        emit();
      },
      // 최종편성안 직접 수정: { productName?, items?, detail:{note,comp,prep,price,margin,...} }
      updatePlacementContent(placementId, patch) {
        const p = state.placements.find((x) => x.id === placementId);
        if (!p) return;
        if (patch.productName !== undefined) p.productName = patch.productName;
        if (patch.items !== undefined) p.items = patch.items;
        if (patch.memo !== undefined) p.memo = patch.memo;
        if (patch.pending !== undefined) p.pending = patch.pending;
        if (patch.detail) p.detail = { ...(p.detail || {}), ...patch.detail };
        stamp(p);
        // 원본 입찰(입찰보드)에도 반영 → 최종편성안·편성표·입찰보드 모두 동기화
        if (p.sourceBidId) {
          const b = state.bids.find((x) => x.id === p.sourceBidId);
          if (b) {
            b.product = b.product || {};
            if (patch.productName !== undefined) b.product.name = patch.productName;
            if (patch.items !== undefined) b.product.items = patch.items;
            if (patch.detail) Object.assign(b.product, patch.detail);
            stamp(b);
          }
        }
        log({ action: '편성수정', productName: p.productName, teamName: teamName(p.teamId),
              detail: (patch.pending !== undefined ? (patch.pending ? '미정 표시' : '확정 표시') : '최종편성안 직접수정')
                + (p.sourceBidId ? ' (입찰정보 동기화)' : '') });
        emit();
      },
      // PD 편성표 상세 팝업에서 통합 수정: 상품/배정/구성 등 한번에 수정하고
      // 원본 입찰(sourceBid)에도 반영 → 최종편성안·입찰정보 모두 동기화
      updatePlacementFull(placementId, patch) {
        const p = state.placements.find((x) => x.id === placementId);
        if (!p) return;
        if (patch.productName !== undefined) p.productName = patch.productName;
        if (patch.teamId !== undefined) p.teamId = patch.teamId;
        if (patch.durationMin !== undefined) p.durationMin = patch.durationMin;
        if (patch.pd !== undefined) p.pd = patch.pd;
        if (patch.host !== undefined) p.host = patch.host;
        if (patch.studio !== undefined) p.studio = patch.studio;
        if (patch.memo !== undefined) p.memo = patch.memo;
        if (patch.detail) p.detail = { ...(p.detail || {}), ...patch.detail };
        // 노출분 변경 → 단독 편성된 시간대 띠 자동 조정
        if (patch.durationMin) {
          const f = findSlot(p.slotId);
          const inSlot = state.placements.filter((x) => x.slotId === p.slotId);
          if (f && f.slot.start && inSlot.length === 1) {
            f.slot.end = toHHMM(toMin(f.slot.start) + Number(patch.durationMin));
          }
        }
        stamp(p);
        // 원본 입찰정보에도 반영 (입찰풀·입찰보드에서 동일하게 보이도록)
        if (p.sourceBidId) {
          const b = state.bids.find((x) => x.id === p.sourceBidId);
          if (b) {
            b.product = b.product || {};
            if (patch.productName !== undefined) b.product.name = patch.productName;
            if (patch.durationMin !== undefined) b.product.durationMin = patch.durationMin;
            if (patch.teamId !== undefined) b.teamId = patch.teamId;
            if (patch.detail) Object.assign(b.product, patch.detail);
            stamp(b);
          }
        }
        log({ action: '편성수정', productName: p.productName, teamName: teamName(p.teamId),
              detail: '상세 통합수정' + (p.sourceBidId ? ' (입찰정보 동기화)' : '') });
        emit();
      },

      // 부 나누기(패션): 한 날짜의 상품들을 1부·2부…로 일괄 배분 — [{placementId, part}]
      assignParts(dayId, list) {
        const day = state.days.find((d) => d.id === dayId);
        if (!day) return { moved: 0 };
        let moved = 0;
        (list || []).forEach(({ placementId, part }) => {
          if (!part) return;
          const p = state.placements.find((x) => x.id === placementId);
          if (!p) return;
          let slot = day.slots.find((s) => s.label === part && !s.start);
          if (!slot) {
            slot = { id: 'slot_' + uid(), start: '', end: '', label: part, manual: true };
            day.slots.push(slot);
          }
          if (p.slotId !== slot.id) { p.slotId = slot.id; stamp(p); moved++; }
        });
        if (moved) log({ action: '부배분', detail: `${day.date} 부 나누기 — ${moved}건 이동` });
        emit();
        return { moved };
      },

      // 같은 시간띠 안에서 카드 순서 변경 (dragId 카드를 beforeId 카드 앞으로)
      // 띠 안 앞뒤 순서 이동: 시간이 다른 두 상품은 시간대(슬롯)와 부(순번)를 맞바꿈
      swapPlacementSlots(aId, bId) {
        const a = state.placements.find((x) => x.id === aId);
        const b = state.placements.find((x) => x.id === bId);
        if (!a || !b) return;
        const t = a.slotId; a.slotId = b.slotId; b.slotId = t;
        const pa = a.part || null, pb = b.part || null;
        if (pa || pb) { a.part = pb; b.part = pa; }
        // 원본 입찰의 부(순번)도 함께 맞바꿈 (표시 순서 일관성)
        const ba = a.sourceBidId ? state.bids.find((x) => x.id === a.sourceBidId) : null;
        const bb = b.sourceBidId ? state.bids.find((x) => x.id === b.sourceBidId) : null;
        const bpa = (ba && ba.part) || null, bpb = (bb && bb.part) || null;
        if (bpa || bpb) { if (ba) { ba.part = bpb; stamp(ba); } if (bb) { bb.part = bpa; stamp(bb); } }
        stamp(a); stamp(b);
        log({ action: '순서변경', productName: a.productName, teamName: teamName(a.teamId),
              detail: `'${b.productName}'와(과) 시간 순서 맞바꿈` });
        emit();
      },
      reorderPlacement(dragId, beforeId) {
        const i = state.placements.findIndex((p) => p.id === dragId);
        if (i < 0 || dragId === beforeId) return;
        const [p] = state.placements.splice(i, 1);
        const j = state.placements.findIndex((x) => x.id === beforeId);
        state.placements.splice(j < 0 ? state.placements.length : j, 0, p);
        log({ action: '순서변경', productName: p.productName, teamName: teamName(p.teamId), detail: '시간띠 내 순서 변경' });
        emit();
      },

      /* ---------- 슬롯/요일 편집 ---------- */
      // 슬롯 시간 직접 수정 (입찰보드·편성표 인라인)
      // ripple: 종료시간 변경분만큼 같은 날짜(원래 종료시간 이후 시작)의 시간대들을 함께 밀기 — 고정 띠(std)는 제외
      updateSlotTime(slotId, { start, end, ripple }) {
        const f = findSlot(slotId);
        if (!f) return;
        const oldEnd = f.slot.end;
        const old = (f.slot.start && f.slot.end) ? `${f.slot.start}~${f.slot.end}` : (f.slot.label || '슬롯');
        f.slot.start = start; f.slot.end = end;
        delete f.slot.label;
        let moved = 0;
        if (ripple && oldEnd && /^\d{1,2}:\d{2}$/.test(oldEnd)) {
          const delta = toMin(end) - toMin(oldEnd);
          const wrap = (m) => toHHMM(((m % 1440) + 1440) % 1440);
          if (delta !== 0) {
            // 체인 방식: "원래 종료시간에 딱 이어져 있던" 시간대만 따라 밀고, 그 뒤로도 이어진 것만 연쇄.
            // 어긋나 있던(간격/무관한) 시간대는 건드리지 않음 — 이미 매칭돼 있으면 밀 것도 없음.
            // 고정 띠의 시작 시간은 앵커: 체인이 여기서 멈춤 (확장 시간 수정이 본방 띠 안을 끌고 가지 않도록)
            const schedR = progSchedule(f.day.programId);
            const entryR = schedR && schedR.find((sc) => sc.wd === f.day.weekday);
            const bandDefsR = (f.day.bands && f.day.bands.length) ? f.day.bands : ((entryR && entryR.slots) || []);
            const anchors = new Set(bandDefsR.map((b) => toMin(b[0])));
            anchors.delete(toMin(f.slot.start)); // 지금 수정 중인 슬롯이 띠 시작이라면 그 앵커는 무시
            const chain = new Set([toMin(oldEnd)]);
            f.day.slots
              .filter((sl) => sl.id !== f.slot.id && sl.start && !sl.std)
              .sort((a, b) => toMin(a.start) - toMin(b.start))
              .forEach((sl) => {
                const s0 = toMin(sl.start);
                if (!chain.has(s0) || anchors.has(s0)) return; // 이어져 있지 않거나 띠 시작(앵커)이면 불변
                if (sl.end) chain.add(toMin(sl.end)); // 이 슬롯의 원래 종료에 이어진 것도 연쇄 대상
                sl.start = wrap(s0 + delta);
                if (sl.end) sl.end = wrap(toMin(sl.end) + delta);
                moved++;
              });
          }
        }
        f.day.slots.sort((a, b) => (toMin(a.start || '00:00')) - (toMin(b.start || '00:00')));
        // 확장 창 역방향 연동: 날짜별 확장 시간이 지정된 날은 확장 구간 슬롯의 시간 변경을 창 정의에도 반영
        // (최종편성안에서 확장 시간을 고치면 입찰보드 확장 띠 헤더도 같이 바뀜)
        {
          const schedE = progSchedule(f.day.programId);
          const entryE = schedE && schedE.find((sc) => sc.wd === f.day.weekday);
          const defsE = (f.day.bands && f.day.bands.length) ? f.day.bands : ((entryE && entryE.slots) || []);
          if (defsE.length) {
            if (f.day.extAfter && f.day.extAfter !== 'off') {
              const lastEnd = toMin(defsE[defsE.length - 1][1]);
              const region = f.day.slots.filter((sl) => sl.start && sl.end && toMin(sl.start) >= lastEnd);
              if (region.length) f.day.extAfter = toHHMM(Math.max(...region.map((sl) => toMin(sl.end))));
            }
            if (f.day.extBefore && f.day.extBefore !== 'off') {
              const firstStart = toMin(defsE[0][0]);
              const region = f.day.slots.filter((sl) => sl.start && sl.end && toMin(sl.end) <= firstStart);
              if (region.length) f.day.extBefore = toHHMM(Math.min(...region.map((sl) => toMin(sl.start))));
            }
          }
        }
        log({ action: '시간수정', from: old, to: `${start}~${end}`,
              detail: `${f.day.date} 시간 수정${moved ? ` · 뒤 시간대 ${moved}개 함께 이동` : ''}` });
        emit();
      },
      // 행 단위 시간 수정: 여러 상품이 한 시간대를 공유 중이면 이 상품만 새 시간대로 분리
      // (한 행을 고쳤는데 같은 시간대의 다른 상품까지 바뀌는 문제 방지)
      updatePlacementTime(placementId, { start, end, ripple }) {
        const p = state.placements.find((x) => x.id === placementId);
        if (!p) return;
        const f = findSlot(p.slotId);
        if (!f) return;
        const sharers = state.placements.filter((x) => x.slotId === f.slot.id);
        if (sharers.length <= 1) { api.updateSlotTime(f.slot.id, { start, end, ripple }); return; }
        const day = f.day;
        const oldS = f.slot.start, oldE = f.slot.end;
        const findOrMake = (s2, e2) => {
          let sl = day.slots.find((x) => x.id !== f.slot.id && x.start === s2 && x.end === e2);
          if (!sl) { sl = { id: 'slot_' + uid(), start: s2, end: e2, manual: true }; day.slots.push(sl); }
          return sl;
        };
        const ns = findOrMake(start, end);
        p.slotId = ns.id;
        stamp(p);
        // 남은 상품 시간 자동 보정: 분리한 상품이 시간대의 앞부분을 가져가면 남은 상품은 뒤(끝~원래끝)로,
        // 뒷부분을 가져가면 남은 상품은 앞(원래시작~시작)으로 이어붙임
        let restNote = '';
        if (oldS && oldE) {
          let rs = null, re = null;
          if (start === oldS && toMin(end) < toMin(oldE)) { rs = end; re = oldE; }
          else if (end === oldE && toMin(start) > toMin(oldS)) { rs = oldS; re = start; }
          if (rs) {
            const rest = sharers.filter((x) => x.id !== p.id);
            if (f.slot.std) {
              // 고정 띠 슬롯은 시간을 건드리지 않고, 남은 상품들을 나머지 구간 슬롯으로 이동
              const rSlot = findOrMake(rs, re);
              rest.forEach((x) => { x.slotId = rSlot.id; stamp(x); });
            } else {
              f.slot.start = rs; f.slot.end = re;
            }
            restNote = ` · 남은 상품 ${rest.length}개 → ${rs}~${re}`;
          }
        }
        day.slots.sort((a, b) => (toMin(a.start || '00:00')) - (toMin(b.start || '00:00')));
        log({ action: '시간수정', productName: p.productName, teamName: teamName(p.teamId),
              from: `${oldS}~${oldE}`, to: `${start}~${end}`,
              detail: `${day.date} 이 상품만 시간 분리${restNote}` });
        emit();
      },
      updateSlotLabel(slotId, label) {
        const f = findSlot(slotId);
        if (!f) return;
        const old = f.slot.label || '';
        f.slot.label = label;
        log({ action: '슬롯명수정', from: old, to: label });
        emit();
      },
      // 고정 시간띠(밴드) 시간 조정 — 해당 날짜에만 적용. 띠 시간 그대로 편성된 슬롯도 함께 이동.
      // 시간을 줄이면 남는 앞/뒤 구간은 자동으로 별도 띠로 생성 (예: 65분 띠를 35분으로 → 남은 30분 띠 생성)
      updateDayBand(dayId, idx, { start, end }) {
        const day = state.days.find((d) => d.id === dayId);
        if (!day) return;
        const sched = progSchedule(day.programId);
        const entry = sched && sched.find((sc) => sc.wd === day.weekday);
        const base = (day.bands && day.bands.length) ? day.bands.map((b) => b.slice())
          : ((entry && entry.slots) || []).map((b) => b.slice());
        if (!base[idx]) return;
        const [oldS, oldE] = base[idx];
        base[idx] = [start, end];
        const made = [];
        if (toMin(end) < toMin(oldE)) { base.splice(idx + 1, 0, [end, oldE]); made.push(`${end}~${oldE}`); }   // 뒤 잔여 띠
        if (toMin(start) > toMin(oldS)) { base.splice(idx, 0, [oldS, start]); made.push(`${oldS}~${start}`); } // 앞 잔여 띠
        // 시간을 늘려 이웃 띠와 겹치면 이웃을 잘라내거나(부분 겹침) 흡수(완전 겹침) — 겹침 띠가 남으면
        // 슬롯 귀속이 꼬여 '빈 띠 삭제 시 위 띠 상품까지 삭제'되는 사고가 나므로 정의 단계에서 차단
        const cut = [];
        const meIdx = base.findIndex((b) => b[0] === start && b[1] === end);
        for (let k = base.length - 1; k >= 0; k--) {
          if (k === meIdx) continue;
          const [s2, e2] = base[k];
          if (!(toMin(s2) < toMin(end) && toMin(start) < toMin(e2))) continue; // 안 겹침
          if (toMin(s2) >= toMin(start) && toMin(e2) <= toMin(end)) { cut.push(`${s2}~${e2} 흡수`); base.splice(k, 1); }
          else if (toMin(s2) < toMin(start)) { cut.push(`${s2}~${e2}→${s2}~${start}`); base[k] = [s2, start]; }
          else { cut.push(`${s2}~${e2}→${end}~${e2}`); base[k] = [end, e2]; }
        }
        day.bands = base;
        day.slots.forEach((sl) => {
          if (sl.start === oldS && sl.end === oldE) { sl.start = start; sl.end = end; }
        });
        day.slots.sort((a, b) => (toMin(a.start || '00:00')) - (toMin(b.start || '00:00')));
        log({ action: '시간띠조정', from: `${oldS}~${oldE}`, to: `${start}~${end}`,
              detail: `${day.date} 시간띠 조정(이 날짜만)${made.length ? ` · 남는 구간 띠 생성: ${made.join(', ')}` : ''}${cut.length ? ` · 겹친 띠 정리: ${cut.join(', ')}` : ''}` });
        emit();
      },
      // 확장 시간 수기 조정(이 날짜만) — before: 앞 확장 시작(HH:MM)·null=기본, after: 뒤 확장 종료·null=기본
      // 반대쪽 경계는 인접 고정띠에 물려 있으므로 저장하지 않음
      setDayExt(dayId, patch) {
        const day = state.days.find((d) => d.id === dayId);
        if (!day) return;
        // 확장 창을 조정하면 그 구간의 편성 시간대도 함께 이동 — 최종편성안과 연동
        const sched = progSchedule(day.programId);
        const entry = sched && sched.find((sc) => sc.wd === day.weekday);
        const defs = (day.bands && day.bands.length) ? day.bands : ((entry && entry.slots) || []);
        let adj = 0;
        if (patch.before !== undefined && defs.length) {
          const firstStart = defs[0][0];
          const oldStart = (day.extBefore && day.extBefore !== 'off') ? day.extBefore : ((entry && entry.extBefore) || null);
          const newStart = patch.before;
          if (newStart) {
            const region = day.slots.filter((sl) => sl.start && sl.end && toMin(sl.end) <= toMin(firstStart));
            const minStart = region.length ? Math.min(...region.map((sl) => toMin(sl.start))) : null;
            region.forEach((sl) => {
              const bound = (oldStart && sl.start === oldStart) || (!oldStart && toMin(sl.start) === minStart) || toMin(sl.start) < toMin(newStart);
              if (bound && toMin(newStart) < toMin(sl.end)) { sl.start = newStart; adj++; }
            });
          }
        }
        if (patch.after !== undefined && defs.length) {
          const lastEnd = defs[defs.length - 1][1];
          const oldEnd = (day.extAfter && day.extAfter !== 'off') ? day.extAfter : ((entry && entry.extAfter) || null);
          const newEnd = patch.after;
          if (newEnd) {
            const region = day.slots.filter((sl) => sl.start && sl.end && toMin(sl.start) >= toMin(lastEnd));
            const maxEnd = region.length ? Math.max(...region.map((sl) => toMin(sl.end))) : null;
            region.forEach((sl) => {
              const bound = (oldEnd && sl.end === oldEnd) || (!oldEnd && toMin(sl.end) === maxEnd) || toMin(sl.end) > toMin(newEnd);
              if (bound && toMin(newEnd) > toMin(sl.start)) { sl.end = newEnd; adj++; }
            });
          }
        }
        if (patch.before !== undefined) { if (patch.before) day.extBefore = patch.before; else delete day.extBefore; }
        if (patch.after !== undefined) { if (patch.after) day.extAfter = patch.after; else delete day.extAfter; }
        log({ action: '확장조정', detail: `${day.date} 확장 ${patch.before !== undefined ? `시작 ${patch.before || '기본값'}` : ''}${patch.after !== undefined ? `종료 ${patch.after || '기본값'}` : ''} (이 날짜만)${adj ? ` · 확장 구간 시간대 ${adj}개 함께 조정` : ''}` });
        emit();
      },
      // 확장 삭제(이 날짜만) — 확장 구간의 상품은 삭제하지 않고 입찰 풀로 복귀.
      // 프로그램 기본 확장이 있는 요일은 'off'로 숨김(다시 시간을 지정하면 되살아남)
      removeDayExt(dayId, kind) {
        const day = state.days.find((d) => d.id === dayId);
        if (!day) return { error: '날짜를 찾을 수 없습니다.' };
        const sched = progSchedule(day.programId);
        const entry = sched && sched.find((sc) => sc.wd === day.weekday);
        const defs = (day.bands && day.bands.length) ? day.bands : ((entry && entry.slots) || []);
        if (!defs.length) return { error: '고정 시간띠가 없는 날짜입니다.' };
        // 확장 구간 판정: 첫 띠 시작 기준 상대분(자정 넘김 대응) — 띠 밖 앞/뒤 구분
        const firstStart = toMin(defs[0][0]);
        const rel = (m) => (m - firstStart + 1440) % 1440;
        const lastEndR = (() => { const r = rel(toMin(defs[defs.length - 1][1])); return r === 0 ? 1440 : r; })();
        const inExt = (sl) => {
          if (!sl.start) return false;
          const r = rel(toMin(sl.start));
          const inBand = defs.some(([bs, be]) => { let b1 = rel(toMin(bs)), b2 = rel(toMin(be)); if (b2 <= b1) b2 += 1440; return r >= b1 && r < b2; });
          if (inBand) return false;
          const isAfter = r >= lastEndR && r - lastEndR <= 720;
          return kind === 'after' ? isAfter : !isAfter;
        };
        const gone = day.slots.filter(inExt);
        let saved = 0;
        gone.forEach((sl) => {
          state.placements.filter((p) => p.slotId === sl.id).forEach((p) => {
            if (!p.sourceBidId) {
              const product = { name: p.productName, ...(p.detail || {}), durationMin: p.durationMin, items: p.items };
              state.bids.push(stamp({ id: uid(), teamId: p.teamId, dayId: day.id, slotId: null, product, createdAt: nowISO() }));
            }
            saved++;
          });
          state.placements = state.placements.filter((p) => p.slotId !== sl.id);
        });
        const goneIds = new Set(gone.map((s) => s.id));
        day.slots = day.slots.filter((s) => !goneIds.has(s.id));
        const fb = day.slots[0] ? day.slots[0].id : null;
        state.bids.forEach((b) => { if (goneIds.has(b.slotId)) b.slotId = fb; });
        // 'off' = 이 날짜의 확장을 완전히 숨김 (확장 펼침 상태에서도 행이 사라짐 — 복원 버튼으로 되살림)
        if (kind === 'before') day.extBefore = 'off'; else day.extAfter = 'off';
        log({ action: '확장삭제', detail: `${day.date} ${kind === 'before' ? '앞' : '뒤'} 확장 삭제(이 날짜만)${saved ? ` · 상품 ${saved}건 입찰 풀로 복귀` : ''}` });
        emit();
        return { ok: true, saved };
      },
      // 시간띠 삭제(이 날짜만) — 이 띠 구간의 상품은 삭제하지 않고 입찰 풀로 복귀
      removeDayBand(dayId, idx) {
        const day = state.days.find((d) => d.id === dayId);
        if (!day) return { error: '날짜를 찾을 수 없습니다.' };
        const sched = progSchedule(day.programId);
        const entry = sched && sched.find((sc) => sc.wd === day.weekday);
        const base = (day.bands && day.bands.length) ? day.bands.map((b) => b.slice())
          : ((entry && entry.slots) || []).map((b) => b.slice());
        if (!base[idx]) return { error: '시간띠를 찾을 수 없습니다.' };
        if (base.length <= 1) return { error: '마지막 시간띠는 삭제할 수 없습니다. 대신 편성일 삭제를 사용하세요.' };
        const [bs, be] = base[idx];
        base.splice(idx, 1);
        day.bands = base;
        // 이 띠 구간(시작시간 기준)의 슬롯 제거 + 상품 보존(removeSlot과 동일 규칙)
        // 단, 남은 다른 띠에 귀속되는 슬롯은 유지 — 겹친 띠 삭제 시 위 띠에 표시 중인 상품까지 지워지는 사고 방지
        const inRemaining = (sl) => base.some(([s2, e2]) => toMin(sl.start) >= toMin(s2) && toMin(sl.start) < toMin(e2));
        const inBand = (sl) => sl.start && toMin(sl.start) >= toMin(bs) && toMin(sl.start) < toMin(be) && !inRemaining(sl);
        const gone = day.slots.filter(inBand);
        let saved = 0;
        gone.forEach((sl) => {
          state.placements.filter((p) => p.slotId === sl.id).forEach((p) => {
            if (!p.sourceBidId) {
              const product = { name: p.productName, ...(p.detail || {}), durationMin: p.durationMin, items: p.items };
              state.bids.push(stamp({ id: uid(), teamId: p.teamId, dayId: day.id, slotId: null, product, createdAt: nowISO() }));
            }
            saved++;
          });
          state.placements = state.placements.filter((p) => p.slotId !== sl.id);
        });
        const goneIds = new Set(gone.map((s) => s.id));
        day.slots = day.slots.filter((s) => !goneIds.has(s.id));
        const fb = day.slots[0] ? day.slots[0].id : null;
        state.bids.forEach((b) => { if (goneIds.has(b.slotId)) b.slotId = fb; });
        log({ action: '시간띠삭제', from: `${bs}~${be}`,
              detail: `${day.date} 시간띠 삭제(이 날짜만)${saved ? ` · 상품 ${saved}건 입찰 풀로 복귀` : ''}` });
        emit();
        return { ok: true, saved };
      },
      // 시간띠 조정을 기본(프로그램 고정 스케줄)으로 되돌리기
      resetDayBands(dayId) {
        const day = state.days.find((d) => d.id === dayId);
        if (!day || !day.bands) return;
        delete day.bands;
        log({ action: '시간띠조정', to: '기본 시간으로 복원', detail: `${day.date} 시간띠 기본값 복원` });
        emit();
      },
      splitSlot(slotId, firstMinutes) {
        const f = findSlot(slotId);
        if (!f) return;
        const total = slotDuration(f.slot);
        if (!firstMinutes || firstMinutes <= 0 || firstMinutes >= total) return;
        const startMin = toMin(f.slot.start);
        const mid = toHHMM(startMin + firstMinutes);
        // 분할 후반부는 PD가 의도적으로 만든 칸 — manual 승계로 고아 슬롯 청소(gc) 대상에서 제외
        const second = { id: 'slot_' + uid(), start: mid, end: f.slot.end, std: f.slot.std, manual: true };
        f.slot.end = mid;
        const idx = f.day.slots.findIndex((s) => s.id === slotId);
        f.day.slots.splice(idx + 1, 0, second);
        log({ action: '시간분할', to: `${f.slot.start}~${mid} / ${mid}~${second.end}`,
              detail: `${slotLabel(slotId)} 분할` });
        emit();
      },
      // 시간대 추가({start,end}) 또는 순번 추가({order:true} → 다음 N부 자동)
      addSlot(dayId, opts) {
        const day = state.days.find((d) => d.id === dayId);
        if (!day) return;
        if (opts && opts.order) {
          const n = day.slots.filter((s) => s.label).length + 1;
          const label = (opts.label || '').trim() || `${n}부`; // 이름 지정 가능 — 예: '아침 1부', '2차 방송'
          // 같은 이름 중복 방지 — 시간 회차(time)는 시각까지 같아야 중복 (본방 '1부'와 '20:45 1부' 공존 허용)
          if (day.slots.some((s) => s.label === label && !s.start && (s.time || '') === ((opts.time || '') + ''))) return;
          const slot = { id: 'slot_' + uid(), start: '', end: '', label, manual: true };
          if (opts.time && /^\d{1,2}:\d{2}$/.test(opts.time)) slot.time = opts.time; // 회차 방송 시각(표시·정렬용)
          day.slots.push(slot);
          log({ action: '순번추가', to: (slot.time ? slot.time + ' ' : '') + slot.label, detail: `${day.date} ${(slot.time ? slot.time + ' ' : '')}${slot.label} 추가` });
        } else {
          const { start, end } = opts;
          const slot = { id: 'slot_' + uid(), start, end, manual: true };
          day.slots.push(slot);
          day.slots.sort((a, b) => (toMin(a.start || '00:00')) - (toMin(b.start || '00:00')));
          log({ action: '시간추가', to: `${start}~${end}`, detail: `${day.date} 시간대 추가` });
        }
        emit();
      },
      removeSlot(slotId) {
        const f = findSlot(slotId);
        if (!f) return;
        const day = f.day;
        const placed = state.placements.filter((p) => p.slotId === slotId);
        // 상품 보존: 수기 편성은 입찰로 변환해 풀로 복귀, 입찰 연결 편성은 편성만 해제(입찰이 풀에 남음)
        placed.forEach((p) => {
          if (!p.sourceBidId) {
            const product = { name: p.productName, ...(p.detail || {}), durationMin: p.durationMin, items: p.items };
            state.bids.push(stamp({ id: uid(), teamId: p.teamId, dayId: day.id, slotId: null, product, createdAt: nowISO() }));
          }
        });
        state.placements = state.placements.filter((p) => p.slotId !== slotId);
        const lbl = (f.slot.start && f.slot.end) ? `${f.slot.start}~${f.slot.end}` : (f.slot.label || '슬롯');
        day.slots = day.slots.filter((s) => s.id !== slotId);
        // 이 슬롯을 희망슬롯으로 가진 입찰은 같은 날의 남은 첫 슬롯으로 재지정(없으면 시간 미정)
        const fb = day.slots[0] ? day.slots[0].id : null;
        state.bids.forEach((b) => { if (b.slotId === slotId) b.slotId = fb; });
        log({ action: '슬롯삭제', from: lbl,
              detail: placed.length ? `상품 ${placed.length}건 입찰 풀로 복귀` : '' });
        emit();
      },
      // opts.allowDup: 같은 날짜에 추가 방송(별도 편성일 행) 생성 — airTime으로 구분 (예: 8/8 08:20~10:25 + 8/8 22:30~01:00)
      addDay(dateStr, opts = {}) {
        const pid = state.activeProgram || MAIN_PROGRAM;
        const dups = state.days.filter((d) => d.programId === pid && d.date === dateStr);
        if (dups.length && !opts.allowDup) return;
        const dt = new Date(dateStr);
        const wd = dt.getDay();
        const id = 'day_' + pid + '_' + dateStr + (dups.length ? '_' + (dups.length + 1) : '');
        const day = { id, programId: pid, date: dateStr, weekday: wd, slots: [] };
        if (opts.airTime) day.airTime = opts.airTime;
        state.days.push(day);
        state.days.sort((a, b) => a.date.localeCompare(b.date));
        // 삭제했던 날짜를 다시 추가하면 숨김 해제(이후 nav 시 재삭제되지 않도록)
        state.hiddenDays = (state.hiddenDays || []).filter((k) => k !== pid + '|' + dateStr);
        log({ action: '편성일추가', to: `${dateStr}(${WEEKDAY_KO[wd]})${opts.airTime ? ' ' + opts.airTime : ''}${dups.length ? ' · 같은 날짜 추가 방송' : ''}` });
        emit();
        return day;
      },
      removeDay(dayId) {
        const day = state.days.find((d) => d.id === dayId);
        if (!day) return;
        const slotIds = new Set(day.slots.map((s) => s.id));
        // 옮겨갈 가장 가까운 같은 프로그램의 다른 날짜 (상품 보존용)
        const others = state.days.filter((d) => d.programId === day.programId && d.id !== dayId);
        let target = null;
        if (others.length) {
          const t0 = new Date(day.date + 'T00:00:00').getTime();
          target = others.reduce((best, d) => {
            const diff = Math.abs(new Date(d.date + 'T00:00:00').getTime() - t0);
            return (!best || diff < best.diff) ? { d, diff } : best;
          }, null).d;
        }
        // 수기 편성(입찰 없음)은 입찰로 변환해 보존 (대체 날짜가 있을 때)
        state.placements.filter((p) => slotIds.has(p.slotId)).forEach((p) => {
          if (!p.sourceBidId && target) {
            const product = { name: p.productName, ...(p.detail || {}), durationMin: p.durationMin, items: p.items };
            state.bids.push(stamp({ id: uid(), teamId: p.teamId, dayId: target.id, slotId: null, product, createdAt: nowISO() }));
          }
        });
        state.placements = state.placements.filter((p) => !slotIds.has(p.slotId));
        // 이 날을 희망일로 가진 입찰 → 가까운 날짜로 이동해 풀에 보존 (대체 날짜 없으면 함께 삭제)
        let moved = 0;
        if (target) {
          const fb = target.slots[0] ? target.slots[0].id : null;
          state.bids.forEach((b) => { if (b.dayId === dayId) { b.dayId = target.id; b.slotId = fb; moved++; } });
        } else {
          state.bids = state.bids.filter((b) => b.dayId !== dayId);
        }
        state.days = state.days.filter((d) => d.id !== dayId);
        // 고정 스케줄 날짜였다면 재생성 방지용으로 숨김 목록에 기록
        state.hiddenDays = state.hiddenDays || [];
        const key = day.programId + '|' + day.date;
        if (!state.hiddenDays.includes(key)) state.hiddenDays.push(key);
        log({ action: '편성일삭제', from: day.date,
              detail: moved ? `상품 ${moved}건 입찰 풀로 복귀 (희망일 ${target.date}로 이동)` : '' });
        emit();
      },

      // 입찰보드의 입찰을 편성표로 일괄 반영 (해당 월 기존 편성은 지우고 입찰로 채움)
      fillScheduleFromBids(year, month, programId) {
        const pid = programId || state.activeProgram;
        const ids = this.monthSlotIds(year, month, pid);
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        const monthDayIds = new Set(state.days
          .filter((d) => d.programId === pid && d.date.startsWith(prefix)).map((d) => d.id));
        // 1) 해당 월의 기존 편성 삭제
        const removed = state.placements.filter((p) => ids.has(p.slotId)).length;
        state.placements = state.placements.filter((p) => !ids.has(p.slotId));
        // 2) 해당 월의 입찰을 편성으로 생성
        let placed = 0;
        state.bids.filter((b) => monthDayIds.has(b.dayId)).forEach((b) => {
          state.placements.push(placementFromBid(b, b.slotId, pid));
          placed++;
        });
        // 3) 입찰·편성이 없는 비표준 빈 슬롯 정리 (옛 확정편성 잔여 슬롯 제거)
        state.days.filter((d) => monthDayIds.has(d.id)).forEach((d) => {
          d.slots = d.slots.filter((s) => s.std
            || state.bids.some((b) => b.slotId === s.id)
            || state.placements.some((p) => p.slotId === s.id));
        });
        log({ action: '입찰일괄편성', detail: `${year}년 ${month}월 — 기존 ${removed}건 삭제 · 입찰 ${placed}건 편성반영` });
        emit();
        return { removed, placed };
      },

      /* ---------- 편성안 저장(스냅샷) ---------- */
      monthSlotIds(year, month, programId) {
        const pid = programId || state.activeProgram;
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        const ids = new Set();
        state.days.filter((d) => d.programId === pid && d.date.startsWith(prefix))
          .forEach((d) => d.slots.forEach((s) => ids.add(s.id)));
        return ids;
      },
      // 현재 월의 편성을 스냅샷으로 저장
      saveSnapshot(year, month, label) {
        if (!state.snapshots) state.snapshots = [];
        const programId = state.activeProgram;
        const ids = this.monthSlotIds(year, month, programId);
        const pls = state.placements.filter((p) => ids.has(p.slotId)).map((p) => ({ ...p }));
        const snap = {
          id: uid(), ts: nowISO(), year, month, programId, label: label || '',
          user: currentUser || '익명', placements: pls, count: pls.length,
        };
        if (snapAPI) { // 서버 연결 시: 본문(placements)은 별도 행에, 메인 문서에는 메타만
          snapAPI.put(snap.id, { placements: pls });
          const meta = { ...snap, ext: true }; delete meta.placements;
          state.snapshots.unshift(meta);
        } else state.snapshots.unshift(snap);
        log({ action: '편성저장',
              detail: `${year}년 ${month}월 편성 ${pls.length}건 저장${label ? ' · ' + label : ''}` });
        emit();
        return snap;
      },
      restoreSnapshot(id) {
        const snap = (state.snapshots || []).find((s) => s.id === id);
        if (!snap) return Promise.resolve({ error: '저장본을 찾을 수 없습니다.' });
        const apply = (pls) => {
          const ids = this.monthSlotIds(snap.year, snap.month, snap.programId);
          state.placements = state.placements.filter((p) => !ids.has(p.slotId));
          let restored = 0, missing = 0;
          (pls || []).forEach((p) => {
            if (ids.has(p.slotId)) { state.placements.push({ ...p, id: uid() }); restored++; }
            else missing++;
          });
          log({ action: '편성복원',
                detail: `${snap.year}년 ${snap.month}월 ${restored}건 복원${missing ? ` · ${missing}건 누락(시간대 변경)` : ''}` });
          emit();
          return { restored, missing };
        };
        if (snap.placements) return Promise.resolve(apply(snap.placements));
        if (snap.ext && snapAPI) return snapAPI.get(id).then((d) =>
          (d && d.placements) ? apply(d.placements) : { error: '저장본 본문을 불러오지 못했습니다.' });
        return Promise.resolve({ error: '저장본 본문이 없습니다.' });
      },
      deleteSnapshot(id) {
        const snap = (state.snapshots || []).find((s) => s.id === id);
        if (!snap) return;
        state.snapshots = state.snapshots.filter((s) => s.id !== id);
        if (snap.ext && snapAPI) snapAPI.remove(id);
        log({ action: '저장본삭제', detail: `${snap.year}년 ${snap.month}월 저장본 삭제` });
        emit();
      },
      // 인라인 본문을 가진 기존 저장본을 분리 저장으로 이관한 뒤 메타로 축소 (connectSupabase 1회)
      _setSnapAPI(api) { snapAPI = api; },
      _setLogArchive(h) { logArchive = h; },
      // 접속 직후 1회: 문서에 쌓인 초과 이력을 아카이브로 이동 (멱등)
      _archiveOverflowLogs() {
        if (!logArchive || state.changeLog.length <= 200) return;
        const overflow = state.changeLog.splice(200);
        logArchive.push(overflow);
        emit();
      },
      _externalizeSnapshots(ids) {
        const set = new Set(ids); let n = 0;
        (state.snapshots || []).forEach((s) => { if (set.has(s.id) && s.placements) { delete s.placements; s.ext = true; n++; } });
        if (n) emit();
        return n;
      },

      /* ---------- 변경이력 초기화 ---------- */
      clearChangeLog() {
        if (logArchive && logArchive.clear) logArchive.clear();
        state.changeLog = [];
        emit();
      },
      // 상품별 편성 이동횟수 초기화 (범위: programId/ym 지정 시 해당 프로그램·월만, 아니면 전체)
      resetMoveCounts({ programId, ym } = {}) {
        const slotMonth = {};
        state.days.forEach((d) => d.slots.forEach((s) => { slotMonth[s.id] = d.date.slice(0, 7); }));
        let n = 0;
        state.placements.forEach((p) => {
          if (!(p.moveCount > 0)) return;
          if (programId && programId !== 'all' && p.programId !== programId) return;
          if (ym && ym !== 'all' && slotMonth[p.slotId] !== ym) return;
          p.moveCount = 0; n++;
        });
        const scope = [(programId && programId !== 'all') ? programId : '', (ym && ym !== 'all') ? ym : ''].filter(Boolean).join(' · ');
        log({ action: '이동초기화', detail: `이동횟수 초기화 ${n}건${scope ? ' · ' + scope : ' · 전체'}` });
        emit();
        return { reset: n };
      },

      /* ---------- 프로그램 생성 (관리자) ---------- */
      // opts: { name, fashion, irregular, schedule:[{wd, slots:[[s,e]]}] }
      addProgram({ name, fashion, irregular, schedule, teamIds } = {}) {
        const nm = (name || '').trim();
        if (!nm) return { error: '프로그램명을 입력하세요.' };
        // 고유 pid 생성
        let base = 'pgm_' + nm.replace(/\s+/g, '');
        let pid = base, n = 2;
        while ((state.programs || []).some((p) => p.id === pid)) { pid = base + '_' + n; n++; }
        state.programs = state.programs || [];
        const color = PROGRAM_COLORS[state.programs.length % PROGRAM_COLORS.length];
        state.programs.push({ id: pid, name: nm, color });
        state.programMeta = state.programMeta || {};
        state.programMeta[pid] = { fashion: !!fashion, custom: true, irregular: !!irregular };
        if (teamIds && teamIds.length) {
          state.programTeamIds = state.programTeamIds || {};
          state.programTeamIds[pid] = teamIds.slice();
        }
        if (!irregular && schedule && schedule.length) {
          state.programSchedules = state.programSchedules || {};
          state.programSchedules[pid] = schedule;
          // 이번 달 + 다음 달 방송일 생성
          this.ensureMonth(state.view.year, state.view.month, pid);
          const nmn = nextMonthOf(state.view.year, state.view.month);
          this.ensureMonth(nmn.year, nmn.month, pid);
        }
        state.activeProgram = pid; // 새 프로그램으로 이동
        log({ action: '프로그램생성', detail: `${nm}${irregular ? ' (비정기)' : ''}${fashion ? ' · 패션형' : ''}` });
        emit();
        return { ok: true, pid };
      },
      /* ---------- 프로그램 삭제 (탭 + 관련 데이터 제거) ---------- */
      removeProgram(programId) {
        const slotIds = new Set();
        state.days.filter((d) => d.programId === programId).forEach((d) => d.slots.forEach((s) => slotIds.add(s.id)));
        state.days = state.days.filter((d) => d.programId !== programId);
        state.placements = state.placements.filter((p) => p.programId !== programId && !slotIds.has(p.slotId));
        state.bids = state.bids.filter((b) => !slotIds.has(b.slotId));
        state.programs = (state.programs || []).filter((p) => p.id !== programId);
        state.snapshots = (state.snapshots || []).filter((s) => s.programId !== programId);
        if (state.programSchedules) delete state.programSchedules[programId];
        if (state.programMeta) delete state.programMeta[programId];
        if (state.programTeamIds) delete state.programTeamIds[programId];
        if (state.activeProgram === programId) state.activeProgram = MAIN_PROGRAM;
        log({ action: '프로그램삭제', detail: `${programId} 삭제` });
        emit();
      },

      /* ---------- 팀 관리 (관리자, 조직개편 대응) ---------- */
      addTeam({ name, color, div } = {}) {
        const nm = (name || '').trim();
        if (!nm) return { error: '팀명을 입력하세요.' };
        state.teams = state.teams || [];
        if (state.teams.some((t) => t.name === nm)) return { error: '이미 있는 팀명입니다.' };
        let base = 'tm_' + nm.replace(/\s+/g, ''), id = base, n = 2;
        while (state.teams.some((t) => t.id === id)) { id = base + '_' + n; n++; }
        state.teams.push({ id, name: nm, color: color || PROGRAM_COLORS[state.teams.length % PROGRAM_COLORS.length], div: div || '' });
        log({ action: '팀추가', detail: nm });
        emit();
        return { ok: true, id };
      },
      updateTeam(id, patch) {
        const t = (state.teams || []).find((x) => x.id === id);
        if (!t) return { error: '팀을 찾을 수 없습니다.' };
        if (patch.name !== undefined) {
          const nm = patch.name.trim();
          if (!nm) return { error: '팀명을 비울 수 없습니다.' };
          if (state.teams.some((x) => x.id !== id && x.name === nm)) return { error: '이미 있는 팀명입니다.' };
          t.name = nm;
        }
        if (patch.color !== undefined) t.color = patch.color;
        if (patch.div !== undefined) t.div = patch.div;
        log({ action: '팀수정', detail: t.name });
        emit();
        return { ok: true };
      },
      // 팀 삭제 — 이 팀 입찰/편성 건수 반환(호출부에서 확인). 참조 데이터는 남으나 팀명 미표시.
      teamUsage(id) {
        const bids = (state.bids || []).filter((b) => b.teamId === id).length;
        const pls = (state.placements || []).filter((p) => p.teamId === id).length;
        return { bids, placements: pls };
      },
      removeTeam(id) {
        const t = (state.teams || []).find((x) => x.id === id);
        if (!t) return;
        state.teams = state.teams.filter((x) => x.id !== id);
        // 프로그램별 대상 팀 목록에서도 제거
        if (state.programTeamIds) Object.keys(state.programTeamIds).forEach((pid) => {
          state.programTeamIds[pid] = (state.programTeamIds[pid] || []).filter((x) => x !== id);
        });
        log({ action: '팀삭제', detail: t.name });
        emit();
      },
      // 팀 병합: fromId의 입찰·편성·프로그램대상팀을 toId로 이관 후 fromId 삭제
      mergeTeam(fromId, toId) {
        if (fromId === toId) return { error: '같은 팀입니다.' };
        const to = (state.teams || []).find((x) => x.id === toId);
        if (!to) return { error: '대상 팀이 없습니다.' };
        materializeProgramTeams();
        reassignTeam(fromId, toId);
        state.teams = state.teams.filter((x) => x.id !== fromId);
        log({ action: '팀병합', detail: `→ ${to.name}` });
        emit();
        return { ok: true };
      },
      // 2026 표준팀으로 일괄 정리: 같은 이름 중복팀을 표준 id로 병합 + 부문 지정 (기타는 그대로)
      mergeTeams2026() {
        materializeProgramTeams();
        let merged = 0, reassigned = 0;
        TEAMS_2026.forEach(({ name, div }) => {
          const same = (state.teams || []).filter((t) => t.name === name);
          if (!same.length) return;
          // 표준 id 우선(tm_<name>), 없으면 첫 팀을 대표로
          const canon = same.find((t) => t.id === 'tm_' + name) || same[0];
          canon.div = div;
          same.filter((t) => t.id !== canon.id).forEach((dup) => {
            const u = (state.bids || []).filter((b) => b.teamId === dup.id).length
              + (state.placements || []).filter((p) => p.teamId === dup.id).length;
            reassignTeam(dup.id, canon.id);
            reassigned += u;
            state.teams = state.teams.filter((x) => x.id !== dup.id);
            merged++;
          });
        });
        log({ action: '팀정리', detail: `2026 표준 병합 ${merged}팀 · 데이터 ${reassigned}건 이관` });
        emit();
        return { merged, reassigned };
      },

      /* ---------- 부문(division) 관리 ---------- */
      addDivision(name) {
        const nm = (name || '').trim();
        if (!nm) return { error: '부문명을 입력하세요.' };
        state.divisions = state.divisions || [];
        if (state.divisions.includes(nm)) return { error: '이미 있는 부문입니다.' };
        state.divisions.push(nm);
        emit();
        return { ok: true };
      },
      renameDivision(oldName, newName) {
        const nm = (newName || '').trim();
        if (!nm) return { error: '부문명을 비울 수 없습니다.' };
        state.divisions = (state.divisions || []).map((d) => (d === oldName ? nm : d));
        (state.teams || []).forEach((t) => { if (t.div === oldName) t.div = nm; });
        emit();
        return { ok: true };
      },
      // 부문 삭제 — 소속 팀은 '기타'로 이동(팀·데이터는 보존)
      removeDivision(name) {
        state.divisions = (state.divisions || []).filter((d) => d !== name);
        (state.teams || []).forEach((t) => { if (t.div === name) t.div = '기타'; });
        emit();
      },

      /* ---------- PD 편성팀 관리 (관리자) ---------- */
      addPdTeam(name) {
        const nm = (name || '').trim();
        if (!nm) return { error: 'PD팀명을 입력하세요.' };
        state.pdTeams = state.pdTeams || [];
        if (state.pdTeams.includes(nm)) return { error: '이미 있는 PD팀입니다.' };
        state.pdTeams.push(nm);
        log({ action: 'PD팀추가', detail: nm });
        emit();
        return { ok: true };
      },
      renamePdTeam(oldName, newName) {
        const nm = (newName || '').trim();
        if (!nm) return { error: 'PD팀명을 비울 수 없습니다.' };
        state.pdTeams = state.pdTeams || [];
        if (state.pdTeams.some((d) => d !== oldName && d === nm)) return { error: '이미 있는 PD팀입니다.' };
        state.pdTeams = state.pdTeams.map((d) => (d === oldName ? nm : d));
        log({ action: 'PD팀수정', detail: `${oldName} → ${nm}` });
        emit();
        return { ok: true };
      },
      removePdTeam(name) {
        state.pdTeams = (state.pdTeams || []).filter((d) => d !== name);
        log({ action: 'PD팀삭제', detail: name });
        emit();
      },

      /* ---------- 프로그램별 캐스팅(PD·쇼호스트·스튜디오) 관리 (관리자) ----------
       * PD 캐스팅 입력 시 추천 목록으로 사용. 프로그램별로 관리자가 추가/수정/삭제. */
      setCasting(programId, obj) {
        ensureCasting(state);
        const clean = (a) => Array.from(new Set((a || []).map((s) => (s || '').trim()).filter(Boolean)));
        state.casting[programId] = {
          pd: clean(obj.pd), host: clean(obj.host), studio: clean(obj.studio),
        };
        const pn = ((state.programs || []).find((p) => p.id === programId) || {}).name || programId;
        log({ action: '캐스팅수정', detail: `${pn} 캐스팅 목록 수정 (PD ${state.casting[programId].pd.length} · 쇼호스트 ${state.casting[programId].host.length})` });
        emit();
      },
      castingOf(programId) {
        ensureCasting(state);
        return state.casting[programId] || { pd: [], host: [], studio: [] };
      },

      /* ---------- 전체 초기화 ---------- */
      resetAll() {
        state = seedState();
        applyProgramSeed(state);
        applySeedBids(state);
        emit();
      },
    };

    return api;
  }

  /* ===================================================================
   *  Supabase 연결 (단일 문서 동기화 + Realtime)
   *  - 앱 상태 전체를 app_state(id='main') 한 행에 jsonb로 저장
   *  - 변경 시 디바운스 업서트, 다른 접속자에는 Realtime으로 즉시 반영
   * =================================================================== */
  function connectSupabase(store, cfg) {
    const client = global.supabase.createClient(cfg.url, cfg.key);
    let ready = false;
    let serverOk = true;   // 테이블 미생성 등으로 실패하면 false → 로컬 모드
    let timer = null;
    const myRevs = new Set(); // 내가 보낸 저장의 nonce (echo 식별용)
    let lastServerRev = null; // 마지막으로 서버에서 반영(하이드레이트/저장)한 문서 rev — 낡은 세션 덮어쓰기 가드용
    const status = (s) => global.__SB_STATUS && global.__SB_STATUS(s);
    // ----- 개별 행 동기화(bids/placements) -----
    const ROW_TABLES = ['bids', 'placements'];
    let rowMode = false; // 테이블 감지되면 true
    const lastRows = { bids: new Map(), placements: new Map() }; // id → JSON(마지막 동기화 값), echo/변경 판별
    async function syncRows(kind, arr) {
      const cur = new Map((arr || []).map((o) => [o.id, JSON.stringify(o)]));
      const last = lastRows[kind];
      const upserts = [];
      cur.forEach((json, id) => { if (last.get(id) !== json) upserts.push({ id, data: JSON.parse(json), updated_at: new Date().toISOString() }); });
      const removed = [];
      last.forEach((_, id) => { if (!cur.has(id)) removed.push(id); });
      try {
        if (upserts.length) { const { error } = await client.from(kind).upsert(upserts); if (error) throw error; }
        if (removed.length) { const { error } = await client.from(kind).delete().in('id', removed); if (error) throw error; }
        lastRows[kind] = cur; // 성공 시에만 기준 갱신(실패하면 다음 저장 때 재시도)
      } catch (e) { console.warn('[supabase] ' + kind + ' 행 동기화 실패:', e.message || e); }
    }
    function disableServer(reason) {
      if (!serverOk) return;
      serverOk = false;
      console.warn('[supabase] 서버 저장 비활성화 → 로컬(localStorage) 모드. 이유:', reason,
        '\napp_state 테이블 생성 SQL 실행 후 새로고침하면 서버 동기화가 켜집니다.');
      status('local');
    }

    store._useBackend((state, hold) => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {} // 로컬 폴백
      if (hold) return; // 편성표 초안 보류 중 — '편성 저장' 전까지 서버 반영 안 함
      if (!ready || !serverOk) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          // 행 모드: bids/placements는 개별 행으로 동기화, 메인 문서에서는 비움(문서 비대화 방지)
          if (rowMode) { syncRows('bids', state.bids); syncRows('placements', state.placements); }
          // ── 낡은 세션 가드 ──────────────────────────────────────────────
          // 절전/네트워크 단절 등으로 실시간 하이드레이트를 놓친 세션이 옛 상태로
          // 메인 문서(날짜·시간대)를 통째로 덮어쓰는 사고 방지: 저장 직전에 서버 rev를
          // 확인해 내가 못 본 최신 문서가 있으면 저장을 버리고 서버 상태를 먼저 반영.
          try {
            const { data: head } = await client.from('app_state').select('data->_rev').eq('id', 'main').maybeSingle();
            const srvRev = head ? head._rev : null;
            if (srvRev && srvRev !== lastServerRev && !myRevs.has(srvRev)) {
              const { data: full } = await client.from('app_state').select('data').eq('id', 'main').maybeSingle();
              if (full && full.data) { lastServerRev = full.data._rev || lastServerRev; store._hydrate(full.data); }
              console.warn('[guard] 낡은 화면의 저장 차단 → 서버 최신으로 갱신');
              status(rowMode ? 'rows' : 'connected');
              alert('다른 접속자가 먼저 저장한 최신 편성이 있어 화면을 최신으로 갱신했습니다.\n방금 하신 수정이 반영됐는지 확인 후 필요하면 다시 시도해주세요.');
              return;
            }
          } catch (e) {}
          const rev = uid() + uid();
          state._rev = rev; // 데이터 안에 nonce → realtime echo 식별
          myRevs.add(rev);
          if (myRevs.size > 20) myRevs.delete(myRevs.values().next().value);
          // 행 모드: bids/placements는 개별 행 테이블이 소스 — 메인 문서에는 싣지 않음(문서 ~1MB → 수십 KB).
          // (모든 클라이언트가 행 모드 대응 버전으로 전환 완료되어 이중저장 종료 — 2026-07-21)
          const doc = rowMode ? { ...state, bids: [], placements: [] } : state;
          const { error } = await client.from('app_state')
            .upsert({ id: 'main', data: doc, updated_at: new Date().toISOString() });
          if (error) disableServer(error.message);
          else { lastServerRev = rev; status('saved'); maybeAutoBackup(); }
        } catch (e) { disableServer(e.message); }
      }, 600);
    });

    /* ----- 백업/복원 (app_state 테이블에 id='backup_...' 행으로 보관) ----- */
    const BK_PREFIX = 'backup_';
    const AUTO_MIN = 60; // 변경이 있으면 최대 N분마다 1회 자동 백업
    const lastAutoTs = () => Number(localStorage.getItem('sched-last-autobackup') || 0);
    const setLastAutoTs = (t) => { try { localStorage.setItem('sched-last-autobackup', String(t)); } catch (e) {} };
    async function doBackup(kind) {
      try {
        const snap = JSON.parse(JSON.stringify(store._snapshot()));
        delete snap._rev;
        const id = BK_PREFIX + new Date().toISOString().replace(/[:.]/g, '-') + '_' + (kind || 'auto');
        const { error } = await client.from('app_state')
          .upsert({ id, data: snap, updated_at: new Date().toISOString() });
        if (error) return { error: error.message };
        if (kind === 'auto') setLastAutoTs(Date.now());
        pruneBackups();
        return { ok: true, id };
      } catch (e) { return { error: e.message }; }
    }
    let autoBackupBusy = false;
    function maybeAutoBackup() {
      if (!serverOk || autoBackupBusy) return;
      if (Date.now() - lastAutoTs() >= AUTO_MIN * 60000) {
        // 시작 시점에 먼저 기록 + 진행 플래그 → 연속 저장 레이스로 같은 분에 백업 여러 개 생기는 것 방지
        autoBackupBusy = true;
        setLastAutoTs(Date.now());
        Promise.resolve(doBackup('auto')).finally(() => { autoBackupBusy = false; });
      }
    }
    async function listBackups() {
      try {
        const { data, error } = await client.from('app_state')
          .select('id,updated_at').like('id', BK_PREFIX + '%')
          .order('updated_at', { ascending: false }).limit(80);
        if (error) return { items: [], error: error.message };
        return { items: (data || []).map((r) => ({ id: r.id, ts: r.updated_at,
          kind: r.id.endsWith('_manual') ? 'manual' : 'auto' })) };
      } catch (e) { return { items: [], error: e.message }; }
    }
    async function restoreBackup(id) {
      try {
        const { data, error } = await client.from('app_state').select('data').eq('id', id).maybeSingle();
        if (error || !data || !data.data) return { error: (error && error.message) || '백업을 찾을 수 없습니다.' };
        await doBackup('auto'); // 복원 직전 현재 상태도 자동 백업(되돌리기 안전망)
        const d = data.data; delete d._rev;
        store._applyRestore(d);
        return { ok: true };
      } catch (e) { return { error: e.message }; }
    }
    async function pruneBackups(keep = 60) {
      try {
        const { data } = await client.from('app_state').select('id').like('id', BK_PREFIX + '%')
          .order('updated_at', { ascending: false });
        if (!data || data.length <= keep) return;
        const old = data.slice(keep).map((r) => r.id);
        if (old.length) await client.from('app_state').delete().in('id', old);
      } catch (e) {}
    }
    store._setBackupAPI({ now: doBackup, list: listBackups, restore: restoreBackup });

    /* ----- 편성 저장본 본문 분리 저장 (app_state snap_* 행 — 메인 문서 비대화 방지) ----- */
    const SNAP_PREFIX = 'snap_';
    // ── 변경 이력 아카이브: 문서에서 넘친 이력을 log_c_<ts> 행으로 보관 ──
    let logBuf = [];
    let logFlushTimer = null;
    async function flushLogBuf() {
      if (!logBuf.length || !serverOk) return;
      const batch = logBuf; logBuf = [];
      const id = 'log_c_' + new Date().toISOString().replace(/[-:.TZ]/g, '') + '_' + Math.random().toString(36).slice(2, 6);
      try {
        const { error } = await client.from('app_state').upsert({ id, data: { entries: batch }, updated_at: new Date().toISOString() });
        if (error) throw error;
      } catch (e) { logBuf = batch.concat(logBuf); console.warn('[supabase] 이력 아카이브 실패(다음에 재시도):', e.message || e); }
    }
    store._setLogArchive({
      push(entries) {
        logBuf.push(...entries);
        clearTimeout(logFlushTimer);
        logFlushTimer = setTimeout(flushLogBuf, 5000);
      },
      async clear() { // 관리자 '이력 초기화' — 아카이브 행도 함께 삭제
        try {
          const { data } = await client.from('app_state').select('id').like('id', 'log_c_%');
          const ids = (data || []).map((r) => r.id);
          if (ids.length) await client.from('app_state').delete().in('id', ids);
        } catch (e) { console.warn('[supabase] 이력 아카이브 삭제 실패:', e.message || e); }
      },
    });
    // 이력 팝업 '이전 이력 더 보기' — 아카이브 행을 최신순으로 3개씩
    store._logFetch = async (excludeIds) => {
      try {
        const { data, error } = await client.from('app_state').select('id').like('id', 'log_c_%').order('id', { ascending: false });
        if (error || !data) return [];
        const next = data.map((r) => r.id).filter((id) => !(excludeIds || []).includes(id)).slice(0, 3);
        if (!next.length) return [];
        const { data: rows } = await client.from('app_state').select('id,data').in('id', next);
        return (rows || []).sort((a, b) => b.id.localeCompare(a.id))
          .map((r) => ({ id: r.id, entries: (r.data && r.data.entries) || [] }));
      } catch (e) { return []; }
    };
    store._setSnapAPI({
      put: async (id, data) => { try {
        await client.from('app_state').upsert({ id: SNAP_PREFIX + id, data, updated_at: new Date().toISOString() });
      } catch (e) {} },
      get: async (id) => { try {
        const { data } = await client.from('app_state').select('data').eq('id', SNAP_PREFIX + id).maybeSingle();
        return data && data.data;
      } catch (e) { return null; } },
      remove: async (id) => { try {
        await client.from('app_state').delete().eq('id', SNAP_PREFIX + id);
      } catch (e) {} },
    });
    // 기존 인라인 저장본 → 분리 행으로 1회 이관 (멱등: 같은 id upsert)
    async function migrateSnapshots() {
      try {
        const inline = (store.getState().snapshots || []).filter((s) => s.placements && s.placements.length >= 0 && !s.ext);
        if (!inline.length) return;
        for (const s of inline) {
          await client.from('app_state').upsert({ id: SNAP_PREFIX + s.id, data: { placements: s.placements }, updated_at: new Date().toISOString() });
        }
        const n = store._externalizeSnapshots(inline.map((s) => s.id));
        if (n) console.info('[supabase] 편성 저장본 ' + n + '개 본문 분리 이관 완료 (메인 문서 축소)');
      } catch (e) {}
    }

    // bids/placements 개별 행 테이블이 있는지 감지 → 있으면 행 모드 활성(없으면 기존 단일문서 그대로)
    async function detectRowTables() {
      try {
        // 반드시 올바른 스키마(id + data jsonb)를 가진 테이블만 인정 → 구스키마/부재 시 단일문서로 폴백
        const b = await client.from('bids').select('id,data').limit(1);
        const p = await client.from('placements').select('id,data').limit(1);
        if (b.error || p.error) return false;
        return true;
      } catch (e) { return false; }
    }
    // 행 모드 초기화: 테이블 행을 소스로 채택. 테이블이 비었고 로컬(메인문서)에 데이터가 있으면 1회 이관.
    async function initRows() {
      const local = store._snapshot();
      const b = await client.from('bids').select('id,data');
      const p = await client.from('placements').select('id,data');
      const bidRows = (b.data || []).map((r) => r.data);
      const plRows = (p.data || []).map((r) => r.data);
      const empty = bidRows.length === 0 && plRows.length === 0;
      const localHas = (local.bids && local.bids.length) || (local.placements && local.placements.length);
      if (empty && localHas) {
        // 최초 이관: 로컬 bids/placements를 테이블로 업로드
        const now = new Date().toISOString();
        if (local.bids && local.bids.length) await client.from('bids').upsert(local.bids.map((o) => ({ id: o.id, data: o, updated_at: now })));
        if (local.placements && local.placements.length) await client.from('placements').upsert(local.placements.map((o) => ({ id: o.id, data: o, updated_at: now })));
        (local.bids || []).forEach((o) => lastRows.bids.set(o.id, JSON.stringify(o)));
        (local.placements || []).forEach((o) => lastRows.placements.set(o.id, JSON.stringify(o)));
        console.info('[supabase] 행 모드: 로컬 데이터 이관 완료 (bids ' + (local.bids || []).length + ' · placements ' + (local.placements || []).length + ')');
      } else {
        // 테이블을 소스로 채택
        store._setRows('bids', bidRows);
        store._setRows('placements', plRows);
        bidRows.forEach((o) => lastRows.bids.set(o.id, JSON.stringify(o)));
        plRows.forEach((o) => lastRows.placements.set(o.id, JSON.stringify(o)));
      }
    }
    // 행 테이블 realtime → 개별 변경만 병합(전체 교체 아님)
    function subscribeRows(kind) {
      client.channel('rows_' + kind)
        .on('postgres_changes', { event: '*', schema: 'public', table: kind }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = payload.old && payload.old.id;
            if (id == null || !lastRows[kind].has(id)) return;
            lastRows[kind].delete(id);
            store._mergeRemote(kind, [], [id]);
          } else {
            const row = payload.new; if (!row || !row.data) return;
            const json = JSON.stringify(row.data);
            if (lastRows[kind].get(row.id) === json) return; // 내가 보낸 변경(echo) 또는 동일값 → 무시
            lastRows[kind].set(row.id, json);
            store._mergeRemote(kind, [row.data], []);
          }
        }).subscribe();
    }

    /* ----- 동시 접속자 표시 (Realtime Presence) ----- */
    let presenceChannel = null, presenceReady = false, me = null;
    function trackPresence() {
      if (!presenceChannel || !presenceReady) return;
      try {
        if (me && me.name) presenceChannel.track(me);
        else presenceChannel.untrack();
      } catch (e) {}
    }
    function setupPresence() {
      if (presenceChannel) return;
      try {
        presenceChannel = client.channel('online_users', { config: { presence: { key: uid() + uid() } } });
        presenceChannel.on('presence', { event: 'sync' }, () => {
          try {
            const st = presenceChannel.presenceState();
            const list = Object.values(st).flat().map((m) => ({ name: m.name, role: m.role }));
            global.__PRESENCE_UPDATE && global.__PRESENCE_UPDATE(list);
          } catch (e) {}
        }).subscribe((status) => {
          if (status === 'SUBSCRIBED') { presenceReady = true; trackPresence(); }
        });
      } catch (e) {}
    }
    // setUser 확장: 로그인 이름/역할을 presence로 공유 (로그아웃 시 목록에서 제거)
    const origSetUser = store.setUser.bind(store);
    store.setUser = (name, role) => {
      origSetUser(name);
      me = name ? { name, role: role || null } : null;
      setupPresence();
      trackPresence();
    };

    (async () => {
      try {
        const { data, error } = await client.from('app_state')
          .select('data').eq('id', 'main').maybeSingle();
        if (error) { disableServer(error.message); ready = true; return; }
        const rowTablesExist = await detectRowTables();
        // 1) 먼저 메인 문서를 그대로 하이드레이트(권위 있는 bids/placements 채택 — 아직 행모드 OFF)
        if (data && data.data) { lastServerRev = data.data._rev || null; store._hydrate(data.data); }
        else await client.from('app_state').upsert({ id: 'main', data: store._snapshot(), updated_at: new Date().toISOString() });
        // 2) 행 테이블이 있으면: 테이블 채택 or 최초 이관 → 이후 행 모드 ON
        if (rowTablesExist) {
          await initRows();
          rowMode = true; store._setRowMode(true);
          status('rows');
        } else { status('connected'); }
        ready = true;
        if (rowMode) { try { store.repairOrphans(); } catch (e) {} } // 행 로드 후 고아 편성 자동 복구
        try { store._archiveOverflowLogs(); } catch (e) {} // 문서 초과 이력 → 아카이브 (멱등)
        maybeAutoBackup(); // 접속 시 마지막 자동백업이 오래됐으면 1회 백업
        migrateSnapshots(); // 인라인 저장본이 남아 있으면 분리 행으로 이관(1회·멱등)
        client.channel('app_state_main')
          .on('postgres_changes',
            { event: '*', schema: 'public', table: 'app_state', filter: 'id=eq.main' },
            (payload) => {
              const incoming = payload.new && payload.new.data;
              if (!incoming) return;
              if (incoming._rev) lastServerRev = incoming._rev; // 에코 포함 — 서버의 최신 rev 추적
              if (incoming._rev && myRevs.has(incoming._rev)) return; // 내가 보낸 변경(echo) 무시
              store._hydrate(incoming);
            })
          .subscribe();
        if (rowMode) ROW_TABLES.forEach(subscribeRows);
        // 절전·오프라인 복귀 시: 놓친 변경을 서버에서 먼저 당겨와 반영 (낡은 화면 방지)
        const refreshFromServer = async () => {
          try {
            const { data: cur } = await client.from('app_state').select('data').eq('id', 'main').maybeSingle();
            if (cur && cur.data && cur.data._rev !== lastServerRev) {
              lastServerRev = cur.data._rev || lastServerRev;
              if (!(cur.data._rev && myRevs.has(cur.data._rev))) store._hydrate(cur.data);
            }
            if (rowMode) await initRows();
          } catch (e) {}
        };
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshFromServer(); });
        window.addEventListener('online', refreshFromServer);
      } catch (e) { disableServer(e.message); ready = true; }
    })();
    return store;
  }

  global.createDataStore = function () {
    const store = LocalStore();
    const cfg = global.SUPABASE;
    if (cfg && cfg.enabled && global.supabase && global.supabase.createClient) {
      return connectSupabase(store, cfg);
    }
    return store;
  };
  global.SchedulerConstants = { TEAMS, WEEKDAY_KO };
})(window);
