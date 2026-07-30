import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  fmtUSD, fmtSigned, clsPnl, fmtDT, downloadBlob, b64ToBlob, api, toast, Icon, Card, Btn, Select, Confirm, useApp,
  hasPerm, PageHead, Denied, Loader
} from '../ui'

/* ============================================================
   ADMIN — REPORT ARCHIVE (verification workflow, item 15)
   ============================================================ */
// The preview window is written to with document.write, so anything interpolated into it
// must be escaped — these strings are ours, but the habit is what keeps it true later.
const escapeForWindow=(s: string)=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] as string));

function AdminReports(){
  const {user,route,t}=useApp();
  const isAdmin=user.role==='admin';
  const [reports,setReports]=useState(null); const [busy,setBusy]=useState(false); const [dl,setDl]=useState(null); const [verifying,setVerifying]=useState(null);
  const [testingEmail,setTestingEmail]=useState(false); const [testingWa,setTestingWa]=useState(false);
  const [genKind,setGenKind]=useState('monthly');
  const [del,setDel]=useState(null); const [deleting,setDeleting]=useState(false);
  const [kindFilter,setKindFilter]=useState('all');
  const [statusFilter,setStatusFilter]=useState(()=>route.params?.status==='not_verified'?'not_verified':route.params?.status==='verified'?'verified':'all');
  const REPORT_KINDS=['daily','weekly','monthly'];
  const allowedKinds=REPORT_KINDS.filter(k=>hasPerm(user,'view_reports_'+k));
  const canView=allowedKinds.length>0;
  const load=()=>api('snapshots?reports=list').then(r=>setReports(r.reports||[])).catch(()=>setReports([]));
  useEffect(()=>{ if(canView) load(); },[]);
  if(!canView) return <Denied/>;
  async function generate(){ setBusy(true); try{ await api('snapshots',{method:'POST',body:{action:'generateReport',kind:genKind}}); toast.success(t('reports.generatedArchived')); load(); }catch(e){ toast.error(e.message); } finally{ setBusy(false); } }
  // Preview opens the stored email body in its own window. The window is opened SYNCHRONOUSLY
  // on the click and filled once the fetch resolves — opening it inside the promise would be
  // a pop-up not triggered by a user gesture, which browsers block.
  //
  // NO 'noopener' in the feature list: it makes window.open return null while still opening
  // the window, so the handle is lost and the report is never written — an empty window every
  // time. It buys nothing here anyway; the window loads our own document, not a foreign page.
  async function preview(rep){
    const w=window.open('','_blank','width=680,height=900');
    if(!w){ toast.error(t('reports.popupBlocked')); return; }
    w.document.write('<title>'+rep.kind+' — '+rep.periodLabel+'</title><body style="margin:0;font-family:sans-serif;color:#64748B;padding:24px">…</body>');
    try{
      const r=await api('snapshots?format=html&report='+rep.id);
      w.document.open(); w.document.write(r.html); w.document.close();
      w.document.title=rep.kind+' — '+rep.periodLabel;
    }catch(e){
      // A report archived before the body was stored has nothing faithful to show. Say that,
      // rather than rendering an approximation of what recipients supposedly received.
      w.document.open();
      w.document.write(`<body style="margin:0;font-family:-apple-system,sans-serif;padding:40px;max-width:520px;color:#0B1F3A">
        <h2 style="margin:0 0 8px;font-size:17px">${escapeForWindow(t('reports.noPreviewTitle'))}</h2>
        <p style="color:#64748B;font-size:14px;line-height:1.5">${escapeForWindow(t('reports.noPreviewBody'))}</p>
      </body>`);
      w.document.close();
    }
  }
  async function download(rep){ setDl(rep.id); try{ const r=await api('snapshots?report='+rep.id); downloadBlob(b64ToBlob(r.pdfBase64), r.filename||('lno-report-'+rep.periodLabel+'.pdf')); toast.success(t('reports.downloaded')); }catch(e){ toast.error(e.message); } finally{ setDl(null); } }
  async function verify(rep){ setVerifying(rep.id); try{ await api('snapshots',{method:'POST',body:{action:'verifyReport',id:rep.id}}); toast.success(t('reports.verified')); load(); }catch(e){ toast.error(e.message); } finally{ setVerifying(null); } }
  async function unverify(rep){ setVerifying(rep.id); try{ await api('snapshots',{method:'POST',body:{action:'unverifyReport',id:rep.id}}); toast.success(t('reports.unverified')); load(); }catch(e){ toast.error(e.message); } finally{ setVerifying(null); } }
  async function doDelete(){ setDeleting(true); try{ await api('snapshots',{method:'POST',body:{action:'deleteReport',id:del.id}}); toast.success(t('reports.deleted')); setDel(null); load(); }catch(e){ toast.error(e.message); } finally{ setDeleting(false); } }
  async function testEmail(){ setTestingEmail(true); try{ const r=await api('snapshots',{method:'POST',body:{action:'testEmail'}}); toast.success(t('reports.testEmailSent',{email:r.email})); }catch(e){ toast.error(e.message); } finally{ setTestingEmail(false); } }
  async function testWhatsApp(){ setTestingWa(true); try{ const r=await api('snapshots',{method:'POST',body:{action:'testWhatsApp'}}); toast.success(t('reports.testWhatsAppSent',{phone:r.phone})); }catch(e){ toast.error(e.message); } finally{ setTestingWa(false); } }
  const visible=(reports||[]).filter(r=>allowedKinds.includes(r.kind));
  const filtered=visible.filter(r=>(kindFilter==='all'||r.kind===kindFilter)&&(statusFilter==='all'||r.status===statusFilter));
  return <div>
    <PageHead title={t('reports.title')} subtitle={isAdmin?t('reports.subtitleAdmin'):t('reports.subtitleOther')}
      actions={isAdmin&&<>
        <Btn variant="outline" onClick={testEmail} disabled={testingEmail}><Icon name="mail" className="w-4 h-4"/>{testingEmail?t('reports.testing'):t('reports.testEmail')}</Btn>
        <Btn variant="outline" onClick={testWhatsApp} disabled={testingWa}><Icon name="msg" className="w-4 h-4"/>{testingWa?t('reports.testing'):t('reports.testWhatsApp')}</Btn>
        <Select value={genKind} onChange={setGenKind} className="w-32" options={[{value:'daily',label:t('reports.kindDaily')},{value:'weekly',label:t('reports.kindWeekly')},{value:'monthly',label:t('reports.kindMonthly')}]}/>
        <Btn onClick={generate} disabled={busy}><Icon name="filetext" className="w-4 h-4"/>{busy?t('reports.generating'):t('reports.generateNow')}</Btn>
      </>}/>
    {visible.length>0&&<div className="flex items-center gap-2 mb-3">
      <Select value={kindFilter} onChange={setKindFilter} className="w-36" options={[{value:'all',label:t('reports.allKinds')},...allowedKinds.map(k=>({value:k,label:t('reports.kind'+k.charAt(0).toUpperCase()+k.slice(1))}))]}/>
      <Select value={statusFilter} onChange={setStatusFilter} className="w-40" options={[{value:'all',label:t('reports.allStatuses')},{value:'verified',label:t('reports.statusVerified')},{value:'not_verified',label:t('reports.statusNotVerified')}]}/>
    </div>}
    {reports==null? <Card className="p-10 text-center text-slate-400 text-sm"><Loader/></Card>
    : visible.length===0? <Card className="p-10 text-center text-slate-400 text-sm"><Icon name="filetext" className="w-10 h-10 mx-auto text-slate-200 mb-2"/>{isAdmin?t('reports.noReportsAdmin'):t('reports.noReportsOther')}</Card>
    : filtered.length===0? <Card className="p-10 text-center text-slate-400 text-sm">{t('reports.noReportsMatch')}</Card>
    : <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-xs"><tr className="border-b border-slate-100 text-slate-500">
          <th className="px-4 py-2.5 text-left font-medium">{t('reports.kind')}</th>
          <th className="px-4 py-2.5 text-left font-medium">{t('reports.period')}</th>
          <th className="px-4 py-2.5 text-right font-medium">{t('activity.equity')}</th>
          <th className="px-4 py-2.5 text-right font-medium">{t('reports.pnl')}</th>
          <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">{t('reports.generated')}</th>
          <th className="px-4 py-2.5 text-left font-medium">{t('reports.status')}</th>
          <th className="px-4 py-2.5"></th>
        </tr></thead>
        <tbody>
          {filtered.map(r=><tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
            <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5"><Icon name="filetext" className="w-4 h-4 text-gold"/>{t('reports.kind'+r.kind.charAt(0).toUpperCase()+r.kind.slice(1))}</span></td>
            <td className="px-4 py-2.5 font-mono text-xs">{r.periodLabel}</td>
            <td className="px-4 py-2.5 text-right tnum">{fmtUSD(r.equity)}</td>
            <td className={`px-4 py-2.5 text-right tnum ${clsPnl(r.pnl)}`}>{fmtSigned(r.pnl)}</td>
            <td className="px-4 py-2.5 text-slate-500 hidden sm:table-cell">{fmtDT(r.createdAt)}</td>
            <td className="px-4 py-2.5">{r.status==='verified'
              ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success bg-success/10 px-1.5 py-0.5 rounded" title={r.verifiedBy?t('reports.verifiedByOn',{who:r.verifiedBy,when:fmtDT(r.verifiedAt)}):undefined}><Icon name="check" className="w-3 h-3"/>{t('reports.statusVerified')}</span>
              : <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded"><Icon name="clock" className="w-3 h-3"/>{t('reports.statusNotVerified')}</span>}</td>
            <td className="px-4 py-2.5 text-right whitespace-nowrap">
              {isAdmin&&r.status!=='verified'&&<Btn size="sm" variant="outline" className="mr-1.5" disabled={verifying===r.id} onClick={()=>verify(r)}><Icon name="check" className="w-3.5 h-3.5"/>{verifying===r.id?'…':t('reports.verify')}</Btn>}
              {isAdmin&&r.status==='verified'&&<Btn size="sm" variant="outline" className="mr-1.5" disabled={verifying===r.id} onClick={()=>unverify(r)}><Icon name="clock" className="w-3.5 h-3.5"/>{verifying===r.id?'…':t('reports.unverify')}</Btn>}
              <Btn size="sm" variant="outline" className={`mr-1.5${r.hasHtml?'':' opacity-50'}`} onClick={()=>preview(r)}
                title={t(r.hasHtml?'reports.previewHint':'reports.noPreviewHint')}><Icon name="eye" className="w-4 h-4"/>HTML</Btn>
              <Btn size="sm" variant="outline" className={isAdmin?'mr-1.5':''} disabled={dl===r.id} onClick={()=>download(r)}><Icon name="download" className="w-4 h-4"/>{dl===r.id?'…':'PDF'}</Btn>
              {isAdmin&&<Btn size="sm" variant="outline" onClick={()=>setDel(r)}><Icon name="trash" className="w-3.5 h-3.5"/></Btn>}
            </td>
          </tr>)}
        </tbody>
      </table></div></Card>}
    <Confirm open={!!del} title={t('reports.deleteTitle')} message={t('reports.deleteConfirm',{period:del?.periodLabel})} confirmLabel={deleting?'…':t('reports.delete')} onCancel={()=>setDel(null)} onConfirm={doDelete}/>
  </div>;
}

export { AdminReports };
