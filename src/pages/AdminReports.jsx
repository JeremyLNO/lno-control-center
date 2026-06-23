import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, clsPnl, fmtDT, downloadBlob, b64ToBlob, api, toast, Icon, Card, Btn, useApp,
  hasPerm, PageHead, Denied
} from '../ui.jsx'

/* ============================================================
   ADMIN — REPORT ARCHIVE
   ============================================================ */
function AdminReports(){
  const {user}=useApp();
  const isAdmin=user.role==='admin';
  const [reports,setReports]=useState(null); const [busy,setBusy]=useState(false); const [dl,setDl]=useState(null);
  const load=()=>api('snapshots?reports=list').then(r=>setReports(r.reports||[])).catch(()=>setReports([]));
  useEffect(()=>{ if(hasPerm(user,'view_reports')) load(); },[]);
  if(!hasPerm(user,'view_reports')) return <Denied/>;
  async function generate(){ setBusy(true); try{ await api('snapshots',{method:'POST',body:{action:'generateReport'}}); toast.success('Report generated & archived'); load(); }catch(e){ toast.error(e.message); } finally{ setBusy(false); } }
  async function download(rep){ setDl(rep.id); try{ const r=await api('snapshots?report='+rep.id); downloadBlob(b64ToBlob(r.pdfBase64), r.filename||('lno-report-'+rep.periodLabel+'.pdf')); toast.success('Report downloaded'); }catch(e){ toast.error(e.message); } finally{ setDl(null); } }
  return <div>
    <PageHead title="Reports" subtitle={isAdmin?'Archive of generated portfolio reports — re-download any as PDF':'Download past portfolio reports'}
      actions={isAdmin&&<Btn onClick={generate} disabled={busy}><Icon name="filetext" className="w-4 h-4"/>{busy?'Generating…':'Generate report now'}</Btn>}/>
    {reports==null? <Card className="p-10 text-center text-slate-400 text-sm">Loading…</Card>
    : reports.length===0? <Card className="p-10 text-center text-slate-400 text-sm"><Icon name="filetext" className="w-10 h-10 mx-auto text-slate-200 mb-2"/>{isAdmin?'No reports yet. Generate one now, or wait for the monthly cron (1st of each month).':'No reports available yet.'}</Card>
    : <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
          <th className="px-4 py-2.5 text-left font-medium">Kind</th>
          <th className="px-4 py-2.5 text-left font-medium">Period</th>
          <th className="px-4 py-2.5 text-right font-medium">Equity</th>
          <th className="px-4 py-2.5 text-right font-medium">PnL 30d</th>
          <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">Generated</th>
          <th className="px-4 py-2.5"></th>
        </tr></thead>
        <tbody>
          {reports.map(r=><tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
            <td className="px-4 py-2.5 capitalize"><span className="inline-flex items-center gap-1.5"><Icon name="filetext" className="w-4 h-4 text-gold"/>{r.kind}</span></td>
            <td className="px-4 py-2.5 font-mono text-xs">{r.periodLabel}</td>
            <td className="px-4 py-2.5 text-right tnum">{fmtUSD(r.equity)}</td>
            <td className={`px-4 py-2.5 text-right tnum ${clsPnl(r.pnl)}`}>{fmtSigned(r.pnl)}</td>
            <td className="px-4 py-2.5 text-slate-500 hidden sm:table-cell">{fmtDT(r.createdAt)}</td>
            <td className="px-4 py-2.5 text-right"><Btn size="sm" variant="outline" disabled={dl===r.id} onClick={()=>download(r)}><Icon name="download" className="w-4 h-4"/>{dl===r.id?'…':'PDF'}</Btn></td>
          </tr>)}
        </tbody>
      </table></div></Card>}
  </div>;
}

export { AdminReports };
