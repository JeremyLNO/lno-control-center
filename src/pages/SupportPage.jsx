import React from 'react'
const { useState, useEffect, useMemo, useRef, useCallback, useId, createContext, useContext } = React;
import {
  Icon, Card, PageHead
} from '../ui.jsx'

/* ============================================================
   SUPPORT
   ============================================================ */
function SupportPage(){
  return <div className="max-w-2xl">
    <PageHead title="Support" subtitle="Contact LNO support for technical issues or production incidents"/>
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-5"><span className="w-12 h-12 rounded-xl bg-gold/15 text-gold grid place-items-center"><Icon name="lifebuoy" className="w-6 h-6"/></span>
        <div><div className="font-semibold text-navy">LNO Support</div><div className="text-sm text-slate-400">Technical issues · account questions · incidents</div></div></div>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-3"><Icon name="mail" className="w-4 h-4 text-slate-400"/><a href="mailto:support@lno.company" className="text-navy hover:text-gold font-medium">support@lno.company</a></div>
        <div className="flex items-center gap-3"><Icon name="clock" className="w-4 h-4 text-slate-400"/><span className="text-slate-600">Response time: within 4 business hours</span></div>
        <div className="flex items-start gap-3"><Icon name="triangle" className="w-4 h-4 text-amber-500 mt-0.5"/><span className="text-slate-600">For urgent incidents, include <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">[URGENT]</span> in the email subject line for priority handling.</span></div>
      </div>
    </Card>
  </div>;
}

export { SupportPage };
