/* Supabase 연결 설정
 * publishable 키는 브라우저에 노출되어도 안전한 공개키입니다(RLS로 보호).
 * 아직 백엔드 미연결 상태: window.SUPABASE.enabled=false 면 localStorage(LocalStore) 사용.
 * 스키마(schema.sql)를 Supabase SQL Editor에 실행한 뒤 enabled=true 로 전환합니다.
 */
window.SUPABASE = {
  enabled: true,
  url: 'https://qmfaqiryboviuzljzpvn.supabase.co',
  key: 'sb_publishable__qVvYiSDvoVfvP-uYxkb-Q_UhhavxPQ',
};
