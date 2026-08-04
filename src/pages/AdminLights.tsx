import React from 'react'
const { useState, useEffect } = React;
import {
  api, toast, Icon, Card, SectionTitle, Btn, Toggle, Select, Field, Input, useApp, PageHead, Denied, Loader, fmtSigned
} from '../ui'

/* ============================================================
   ADMIN — SMART LIGHTS
   ============================================================ */
// An ambient display of the open book: the lamp is green in profit, red in loss, and the
// desk's colour on a flat book. Driven by the cron, so it follows the book whether or not
// anyone has the dashboard open.
//
// The two brands are NOT reachable the same way, and the page says so rather than pretending
// they are — see api/_lib/lights.js. Govee is a plain cloud API; Hue's bridge sits on a
// private network the server cannot reach, so it goes through Philips' remote API, which
// costs an OAuth app registration.

const HUE_AUTH = 'https://api.meethue.com/v2/oauth2/authorize';

export default function AdminLights(){
  const {user,t}=useApp();
  const [cfg,setCfg]=useState<any>(null);
  const [busy,setBusy]=useState(false); const [saved,setSaved]=useState(false);
  const [devices,setDevices]=useState<any[]>([]); const [hueList,setHueList]=useState<any[]>([]);
  const [goveeKey,setGoveeKey]=useState(''); const [hueSecret,setHueSecret]=useState('');
  const [test,setTest]=useState<any>(null);

  const load=()=>api('openwa?lights=1').then(r=>setCfg(r.lights)).catch(e=>toast.error(e.message));
  useEffect(()=>{ if(user.role==='admin') load(); },[]);

  // Hue sends the admin back here with ?code=… — finish the link before anything else, then
  // clean the URL so a refresh can't try to redeem an already-spent code.
  useEffect(()=>{
    const p=new URLSearchParams(window.location.search);
    const code=p.get('code');
    if(!code||p.get('state')!=='lno-hue'||user.role!=='admin') return;
    api('openwa',{method:'POST',body:{action:'hueExchange',code}})
      .then(r=>{ setCfg(r.lights); toast.success(t('lights.hueLinked')); })
      .catch(e=>toast.error(e.message))
      .finally(()=>window.history.replaceState({},'',window.location.pathname+window.location.hash));
  },[]);

  if(user.role!=='admin') return <Denied/>;
  if(!cfg) return <Loader/>;

  const set=(patch: any)=>setCfg((c: any)=>({...c,...patch}));
  const setGovee=(patch: any)=>setCfg((c: any)=>({...c,govee:{...c.govee,...patch}}));
  const setHue=(patch: any)=>setCfg((c: any)=>({...c,hue:{...c.hue,...patch}}));

  async function save(){
    setBusy(true);
    try{
      const body: any={lights:{...cfg}};
      // A blank secret means "keep the stored one" — sending '' would wipe it.
      if(goveeKey.trim()) body.lights.govee={...body.lights.govee,apiKey:goveeKey.trim()};
      if(hueSecret.trim()) body.lights.hue={...body.lights.hue,clientSecret:hueSecret.trim()};
      const r=await api('openwa',{method:'PUT',body});
      setCfg(r.lights); setGoveeKey(''); setHueSecret('');
      setSaved(true); setTimeout(()=>setSaved(false),1800);
    }catch(e: any){ toast.error(e.message); } finally{ setBusy(false); }
  }
  async function loadDevices(){
    try{ const r=await api('openwa',{method:'POST',body:{action:'goveeDevices',apiKey:goveeKey.trim()||undefined}}); setDevices(r.devices||[]);
      if(!r.devices?.length) toast.error(t('lights.noDevices'));
      else toast.success(t('lights.devicesFound',{n:r.devices.length}));
    }catch(e: any){ toast.error(e.message); }
  }
  async function loadHueLights(){
    try{ const r=await api('openwa',{method:'POST',body:{action:'hueLights'}}); setHueList(r.lights||[]); }
    catch(e: any){ toast.error(e.message); }
  }
  async function runGoveeTest(){
    setTest({state:'running'});
    try{ const r=await api('openwa',{method:'POST',body:{action:'goveeTest'}}); setTest({state:'selftest',...r}); }
    catch(e: any){ setTest({state:'err',msg:e.message}); }
  }
  async function runTest(){
    setTest({state:'running'});
    try{ const r=await api('openwa',{method:'POST',body:{action:'lightsTest'}}); setTest({state:'ok',...r}); }
    catch(e: any){ setTest({state:'err',msg:e.message}); }
  }

  // The bare origin, deliberately: Hue appends ?code= to whatever is registered, and this
  // app routes on the hash — a callback carrying a '#' would bury the code. routeHueCallback()
  // in main.tsx picks it up from there and sends it here.
  const hueRedirect=window.location.origin+'/';
  const hueAuthUrl=`${HUE_AUTH}?client_id=${encodeURIComponent(cfg.hue.clientId||'')}&response_type=code&state=lno-hue`;

  return <div className="max-w-2xl fadein">
    <PageHead title={t('lights.title')} subtitle={t('lights.subtitle')}/>

    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-navy">{t('lights.enable')}</div>
          <div className="text-sm text-slate-500">{t('lights.enableHint')}</div>
        </div>
        <Toggle checked={cfg.enabled} onChange={(v: boolean)=>set({enabled:v})}/>
      </div>
    </Card>

    <Card className="p-4 mb-4">
      <SectionTitle>{t('lights.colors')}</SectionTitle>
      <div className="grid sm:grid-cols-3 gap-3">
        <Swatch label={t('lights.profit')} value={cfg.profit} onChange={(v: string)=>set({profit:v})}/>
        <Swatch label={t('lights.loss')} value={cfg.loss} onChange={(v: string)=>set({loss:v})}/>
        <Swatch label={t('lights.flat')} value={cfg.flat} onChange={(v: string)=>set({flat:v})}/>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Field label={t('lights.deadband')} hint={t('lights.deadbandHint')}>
          <Input type="number" value={cfg.deadband} onChange={(e: any)=>set({deadband:e.target.value})}/>
        </Field>
        <Field label={t('lights.brightness')}>
          <Input type="number" min={1} max={100} value={cfg.brightness} onChange={(e: any)=>set({brightness:e.target.value})}/>
        </Field>
      </div>
    </Card>

    {/* GOVEE */}
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <SectionTitle>Govee</SectionTitle>
        <Toggle checked={cfg.govee.enabled} onChange={(v: boolean)=>setGovee({enabled:v})}/>
      </div>
      <p className="text-sm text-slate-500 mb-3">{t('lights.goveeHint')}</p>
      <Field label={t('lights.apiKey')} hint={cfg.govee.hasApiKey?t('lights.keyStored',{mask:cfg.govee.apiKeyMasked}):undefined}>
        <Input type="password" value={goveeKey} onChange={(e: any)=>setGoveeKey(e.target.value)} placeholder={cfg.govee.hasApiKey?'••••••••':''}/>
      </Field>
      <div className="flex items-end gap-2 mt-3">
        <div className="flex-1">
          <Field label={t('lights.device')}>
            <Select value={cfg.govee.device} onChange={(e: any)=>{
              const d=devices.find(x=>x.device===e.target.value);
              setGovee({device:e.target.value,model:d?d.model:cfg.govee.model});
            }} options={[
              {value:cfg.govee.device||'',label:cfg.govee.device?cfg.govee.device:t('lights.pickDevice')},
              // Every device the account owns, colour-capable or not: Govee's capability
              // naming varies by product line, and silently hiding the ones this app doesn't
              // recognise is how a lamp that would have worked becomes unselectable.
              ...devices.map(d=>({value:d.device,label:d.name+' · '+d.model+(d.colorCapable?'':' '+t('lights.noColor'))})),
            ]}/>
          </Field>
        </div>
        <Btn variant="outline" onClick={loadDevices}>{t('lights.loadDevices')}</Btn>
      </div>
      {/* A test that cannot be mistaken for the book: blue then yellow, neither of which this
          feature ever uses. Only offered once Govee is actually switched on and pointed at a
          device — a button that can only fail is not a button. */}
      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100">
        <Btn variant="outline" size="sm" onClick={runGoveeTest}
          disabled={!cfg.govee.enabled||!cfg.govee.device||(!cfg.govee.hasApiKey&&!goveeKey.trim())}>
          {t('lights.goveeSelfTest')}
        </Btn>
        <span className="text-xs text-slate-400">{t('lights.goveeSelfTestHint')}</span>
      </div>
    </Card>

    {/* HUE */}
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <SectionTitle>Philips Hue</SectionTitle>
        <Toggle checked={cfg.hue.enabled} onChange={(v: boolean)=>setHue({enabled:v})}/>
      </div>
      {/* Stated plainly: this is the one real constraint of the feature, and hiding it would
          only turn into "why doesn't it see my bridge". */}
      <div className="text-sm text-slate-500 mb-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
        <div className="flex gap-2">
          <Icon name="info" className="w-4 h-4 shrink-0 mt-0.5 text-slate-400"/>
          <div>{t('lights.hueWhyRemote')}</div>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={t('lights.hueClientId')}>
          <Input value={cfg.hue.clientId||''} onChange={(e: any)=>setHue({clientId:e.target.value})}/>
        </Field>
        <Field label={t('lights.hueClientSecret')} hint={cfg.hue.hasSecret?t('lights.secretStored'):undefined}>
          <Input type="password" value={hueSecret} onChange={(e: any)=>setHueSecret(e.target.value)} placeholder={cfg.hue.hasSecret?'••••••••':''}/>
        </Field>
      </div>
      <div className="text-xs text-slate-400 mt-2">{t('lights.hueRedirect')} <code className="text-navy">{hueRedirect}</code></div>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {cfg.hue.linked
          ? <span className="text-sm text-success flex items-center gap-1.5"><Icon name="check" className="w-4 h-4"/>{t('lights.hueIsLinked')}</span>
          : <a href={hueAuthUrl} className={`text-sm ${cfg.hue.clientId?'text-gold hover:underline':'text-slate-300 pointer-events-none'}`}>{t('lights.hueLink')} →</a>}
        <div className="flex-1"/>
        <Btn variant="outline" size="sm" onClick={loadHueLights} disabled={!cfg.hue.linked}>{t('lights.loadLights')}</Btn>
      </div>
      <div className="mt-3">
        <Field label={t('lights.light')}>
          <Select value={cfg.hue.lightId} onChange={(e: any)=>setHue({lightId:e.target.value})} options={[
            {value:cfg.hue.lightId||'',label:cfg.hue.lightId||t('lights.pickLight')},
            ...hueList.map(l=>({value:l.id,label:l.name})),
          ]}/>
        </Field>
      </div>
    </Card>

    <div className="flex items-center gap-3">
      <Btn onClick={save} disabled={busy}>{busy?t('common.saving'):t('common.save')}</Btn>
      <Btn variant="outline" onClick={runTest} disabled={!cfg.enabled}>{t('lights.test')}</Btn>
      {saved&&<span className="text-sm text-success flex items-center gap-1"><Icon name="check" className="w-4 h-4"/>{t('common.saved')}</span>}
    </div>

    {test&&<Card className="p-4 mt-4">
      {test.state==='running'&&<Loader/>}
      {test.state==='err'&&<div className="text-sm text-danger">{test.msg}</div>}
      {test.state==='selftest'&&<div className="text-sm space-y-1">
        {(test.steps||[]).map((st: any,i: number)=><div key={i} className="flex items-center gap-2">
          <span className="w-4 h-4 rounded-full border border-slate-200" style={{background:st.color}}/>
          <span className={st.ok?'text-success':'text-danger'}>{st.ok?t('lights.stepOk',{step:st.step}):st.error}</span>
        </div>)}
        <div className="text-slate-500 pt-1">{t('lights.restored',{color:test.restored?.color||'—'})}</div>
      </div>}
      {test.state==='ok'&&<div className="text-sm space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded-full border border-slate-200" style={{background:test.expected}}/>
          <span className="text-navy">{t('lights.testResult',{pnl:fmtSigned(test.openPnl)})}</span>
        </div>
        {/* Per brand, because one unplugged lamp must not read as a total failure. */}
        {test.govee&&<div className={test.govee==='ok'?'text-success':'text-danger'}>Govee: {test.govee}</div>}
        {test.hue&&<div className={test.hue==='ok'?'text-success':'text-danger'}>Hue: {test.hue}</div>}
        {test.skipped&&<div className="text-slate-500">{test.skipped}</div>}
      </div>}
    </Card>}
  </div>;
}

function Swatch({label,value,onChange}: any){
  return <div>
    <div className="text-xs text-slate-500 mb-1">{label}</div>
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={e=>onChange(e.target.value)}
        className="w-9 h-9 rounded-lg border border-slate-200 bg-white cursor-pointer p-0.5"/>
      <Input value={value} onChange={(e: any)=>onChange(e.target.value)} className="flex-1"/>
    </div>
  </div>;
}
