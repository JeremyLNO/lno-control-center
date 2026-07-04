import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  Icon, Card, PageHead, useApp
} from '../ui'

/* ============================================================
   SUPPORT
   ============================================================ */
function SupportPage(){
  const {t}=useApp();
  return <div className="max-w-2xl">
    <PageHead title={t('support.title')} subtitle={t('support.subtitle')}/>
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-5"><span className="w-12 h-12 rounded-xl bg-gold/15 text-gold grid place-items-center"><Icon name="lifebuoy" className="w-6 h-6"/></span>
        <div><div className="font-semibold text-navy">{t('support.lnoSupport')}</div><div className="text-sm text-slate-400">{t('support.subLine')}</div></div></div>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-3"><Icon name="mail" className="w-4 h-4 text-slate-400"/><a href="mailto:support@lno.company" className="text-navy hover:text-gold font-medium">support@lno.company</a></div>
        <div className="flex items-start gap-3"><Icon name="triangle" className="w-4 h-4 text-amber-500 mt-0.5"/><span className="text-slate-600">{t('support.urgentHint')}</span></div>
      </div>
    </Card>
  </div>;
}

export { SupportPage };
