/* 사내 서버(Flask) 연결 설정
 * 저장소 기본값은 꺼짐(Netlify/Supabase 운영 유지). 사내 서버가 이 파일을 대신 서빙하면서
 * enabled:true 로 주입하므로, 서버 배포에서는 이 파일을 수정할 필요가 없습니다. */
window.LOCAL_SERVER = { enabled: false, base: '' };
