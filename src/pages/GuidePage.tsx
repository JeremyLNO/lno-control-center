import React from 'react'
const { useMemo } = React;
import {
  PERMISSIONS, ROLE_OPTIONS, ROLE_PERMS as ROLE_DEFAULTS, Icon, Card, SectionTitle, Btn, PageHead, useApp, hasPerm, navVisible,
  MAIN_NAV, TOOLS_NAV, ADMIN_NAV
} from '../ui'

/* ============================================================
   GUIDE — what the Control Center does, and who can do it
   ============================================================ */
// Shown once on first sign-in, then only from the header. Its job is to answer "what is in
// here and am I allowed to use it" without anyone having to click through 19 pages to find
// out.
//
// The feature list is hand-written — it describes intent, which no amount of introspection
// can produce. The PERMISSIONS TABLE at the end is NOT: it is derived from the same constants
// the app enforces with, so it can never drift into describing rights the app doesn't grant.

type Feature = { icon: string; key: string; path?: string; perm?: string | string[] | null };
type Group = { key: string; features: Feature[] };

const GROUPS: Group[] = [
  { key: 'monitor', features: [
    { icon: 'activity', key: 'activity', path: '/activity', perm: 'view_activity' },
    { icon: 'radio', key: 'live', path: '/realtime', perm: 'view_realtime' },
    { icon: 'briefcase', key: 'positions', path: '/trades', perm: 'view_trades' },
    { icon: 'trendup', key: 'prices', path: '/prices', perm: 'view_activity' },
    { icon: 'database', key: 'status', path: '/status', perm: 'view_activity' },
  ]},
  { key: 'analyse', features: [
    { icon: 'activity', key: 'analysis', path: '/analysis', perm: 'view_trades' },
    { icon: 'clock', key: 'calendar', path: '/calendar', perm: 'view_trades' },
    { icon: 'briefcase', key: 'position', path: undefined, perm: 'view_trades' },
    { icon: 'shield', key: 'playbook', path: '/playbook', perm: 'view_trades' },
  ]},
  { key: 'watch', features: [
    { icon: 'triangle', key: 'anomalies', path: '/anomalies', perm: 'view_trades' },
    { icon: 'msg', key: 'comments', path: undefined, perm: 'manage_comments' },
    { icon: 'bell', key: 'alerts', path: undefined, perm: null },
    { icon: 'filetext', key: 'reports', path: '/admin/reports', perm: ['view_reports_daily', 'view_reports_weekly', 'view_reports_monthly'] },
  ]},
  { key: 'run', features: [
    { icon: 'link', key: 'exchanges', path: '/admin/exchanges', perm: 'view_exchanges' },
    { icon: 'layers', key: 'funds', path: '/funds', perm: 'view_trades' },
    { icon: 'dollar', key: 'equity', path: '/equity', perm: null },
    { icon: 'users', key: 'users', path: '/admin/users', perm: undefined },
    { icon: 'shield', key: 'rules', path: '/admin/rules', perm: undefined },
    { icon: 'filetext', key: 'audit', path: '/admin/audit', perm: 'view_audit' },
  ]},
];

// Where each permission is spent, so the matrix reads as "this unlocks X" rather than as a
// list of internal keys. Derived labels come from the i18n `perm.*` entries the Rules page
// already uses — one label per permission, not two that could disagree.
const PERM_UNLOCKS: Record<string, string> = {
  view_activity: 'guide.unlock.view_activity',
  view_realtime: 'guide.unlock.view_realtime',
  view_trades: 'guide.unlock.view_trades',
  view_reports_daily: 'guide.unlock.view_reports_daily',
  view_reports_weekly: 'guide.unlock.view_reports_weekly',
  view_reports_monthly: 'guide.unlock.view_reports_monthly',
  view_exchanges: 'guide.unlock.view_exchanges',
  export_data: 'guide.unlock.export_data',
  view_audit: 'guide.unlock.view_audit',
  manage_exchanges: 'guide.unlock.manage_exchanges',
  manage_whatsapp: 'guide.unlock.manage_whatsapp',
  manage_funds: 'guide.unlock.manage_funds',
  manage_strategies: 'guide.unlock.manage_strategies',
  manage_comments: 'guide.unlock.manage_comments',
};

export default function GuidePage(){
  const {user,navigate,t}=useApp();

  // Every nav entry the app knows about, so "is this reachable for me" is answered by the
  // same predicate the sidebar uses rather than by a second, hand-kept list.
  const reachable=useMemo(()=>{
    const m=new Map<string,boolean>();
    MAIN_NAV.forEach((r: any)=>m.set(r[2],hasPerm(user,r[4])));
    TOOLS_NAV.forEach((r: any)=>m.set(r[2],hasPerm(user,r[4])));
    ADMIN_NAV.forEach((r: any)=>m.set(r[2],navVisible(user,r[4])));
    return m;
  },[user]);

  const allowed=(f: Feature)=>{
    if(f.perm===null) return true;              // signed in is enough
    if(f.perm===undefined) return user.role==='admin';
    return hasPerm(user,f.perm);
  };

  return <div className="fadein">
    <PageHead title={t('guide.title')} subtitle={t('guide.subtitle')}
      actions={<Btn variant="outline" onClick={()=>navigate('/activity')}>{t('guide.toDashboard')}</Btn>}/>

    <Card className="p-4 mb-4 border border-gold/30 bg-gold/[.04]">
      <div className="flex items-start gap-3">
        <Icon name="info" className="w-5 h-5 text-gold shrink-0 mt-0.5"/>
        <div>
          <p className="text-sm text-navy">{t('guide.intro')}</p>
          <p className="text-xs text-slate-500 mt-1">{t('guide.reopen')}</p>
        </div>
      </div>
    </Card>

    {GROUPS.map(g=><Card key={g.key} className="p-4 mb-4">
      <SectionTitle>{t('guide.group.'+g.key)}</SectionTitle>
      <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
        {g.features.map(f=>{
          const ok=allowed(f);
          const reach=f.path? (reachable.get(f.path)??ok) : ok;
          return <div key={f.key} className="flex items-start gap-3">
            <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${ok?'bg-navy/5 text-navy':'bg-slate-100 text-slate-300'}`}>
              <Icon name={f.icon} className="w-4 h-4"/>
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Only linked when the reader can actually open it — a link that lands on
                    "Access denied" teaches nothing. */}
                {f.path&&reach
                  ? <button onClick={()=>navigate(f.path!)} className="text-sm font-semibold text-navy hover:underline">{t('guide.f.'+f.key+'.title')}</button>
                  : <span className={`text-sm font-semibold ${ok?'text-navy':'text-slate-400'}`}>{t('guide.f.'+f.key+'.title')}</span>}
                {!ok&&<span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t('guide.noAccess')}</span>}
              </div>
              <p className="text-sm text-slate-500 mt-0.5">{t('guide.f.'+f.key+'.desc')}</p>
            </div>
          </div>;
        })}
      </div>
    </Card>)}

    {/* The rights table is a map of who can do what across the whole desk — org-structure
        information, not something a viewer needs to use the product. Admins only. */}
    {user.role==='admin'&&<PermissionMatrix/>}
  </div>;
}

// The rights recap. Built from PERMISSIONS + ROLE_PERMS — the very constants the server
// enforces with — so this table cannot describe a right the app does not actually grant.
// It shows the DEFAULTS; an admin may have edited a role since, which is what the note says.
function PermissionMatrix(){
  const {t,navigate,user}=useApp();
  const roles=ROLE_OPTIONS.map((r: any)=>typeof r==='string'?r:r.value).filter((r: string)=>r!=='admin');
  return <Card className="p-4">
    <SectionTitle right={user.role==='admin'&&
      <button onClick={()=>navigate('/admin/rules')} className="text-xs text-gold hover:underline">{t('guide.editRules')}</button>}>
      {t('guide.matrixTitle')}
    </SectionTitle>
    <p className="text-sm text-slate-500 mb-3">{t('guide.matrixHint')}</p>
    <table className="w-full text-sm">
      {/* Sticky header: 14 rows of ticks are unreadable once the column names scroll away. */}
      <thead className="sticky top-0 bg-white z-10"><tr className="border-b border-slate-200 text-slate-500">
        <th className="px-3 py-2 text-left font-medium">{t('guide.capability')}</th>
        <th className="px-3 py-2 text-center font-medium">{t('role.admin')}</th>
        {roles.map((r: string)=><th key={r} className="px-3 py-2 text-center font-medium">{t('role.'+r)}</th>)}
      </tr></thead>
      <tbody>
        {PERMISSIONS.map(([key,fallback]: any)=><tr key={key} className="border-b border-slate-100 last:border-0">
          <td className="px-3 py-2">
            <div className="text-navy">{t('perm.'+key)}</div>
            <div className="text-xs text-slate-400">{t(PERM_UNLOCKS[key]||'perm.'+key)}</div>
          </td>
          {/* Admin holds every permission implicitly, server-side — it is not a row anyone
              can edit, so it is rendered as a constant rather than looked up. */}
          <td className="px-3 py-2 text-center"><Yes/></td>
          {roles.map((r: string)=><td key={r} className="px-3 py-2 text-center">
            {(ROLE_DEFAULTS[r]||[]).includes(key)? <Yes/> : <No/>}
          </td>)}
        </tr>)}
      </tbody>
    </table>
  </Card>;
}

const Yes=()=><Icon name="check" className="w-4 h-4 text-success inline"/>;
const No=()=><span className="text-slate-300">—</span>;

