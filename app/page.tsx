import { cookies } from 'next/headers';
import { actorFromToken,cookieName } from '@/src/server/auth';
import { PublicCalendar } from '@/components/public-calendar';
export const dynamic='force-dynamic';
export default async function Home(){
  // Authentication failure must not hide the public calendar, even with an old cookie.
  // Protected routes still authenticate independently; no personal data is rendered here.
  const actor=await actorFromToken((await cookies()).get(cookieName)?.value).catch(()=>null);
  return <PublicCalendar account={actor?{admin:actor.roles.includes('ADMIN'),name:actor.displayName,csrf:actor.csrf}:null}/>;
}
