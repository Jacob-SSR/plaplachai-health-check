import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { actorFromToken,cookieName } from '@/src/server/auth';
import { Workspace } from '@/components/workspace';
export const dynamic='force-dynamic';
export default async function Admin(){
  const actor=await actorFromToken((await cookies()).get(cookieName)?.value).catch(error=>{if(error.status===401)return null;throw error;});
  if(!actor)redirect('/login');
  if(!actor.roles.includes('ADMIN'))redirect('/');
  return <Workspace actor={actor}/>;
}
