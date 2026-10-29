import type { CriticalWarning, RiskCategory, RouteRiskResult } from './types';
import { clamp } from './geo';
export type RoutePreference = 'quickest' | 'balanced' | 'lower-risk';
interface Weights { time:number; risk:number }
export interface CompareOptions {
  weights?: Partial<Record<RoutePreference,Weights>>;
  uncertaintyPenaltyPoints?: Partial<{limited:number;insufficient:number;unknown:number}>;
  demoteBlockedRoutes?:boolean; fallbackSpeedKmh?:number; minTimeRangeS?:number; minTimeRangeRatio?:number;
}
export type TravelTimeSource='provided'|'estimated-from-distance'|'unavailable';
export interface RankedRoute {
  routeId:string; rank:number; rankValue:number; travelTimeS:number|null; travelTimeSource:TravelTimeSource;
  timeDeltaVsFastestS:number|null; normalizedTime:number; riskScore:number; effectiveRisk:number;
  riskCategory:RiskCategory|null; uncertain:boolean; blocked:boolean; criticalWarnings:CriticalWarning[];
  explanation:string[]; result:RouteRiskResult;
}
export interface RouteComparison { preference:RoutePreference; ranked:RankedRoute[]; recommendedRouteId:string|null; notes:string[] }
const defaults:Record<RoutePreference,Weights>={quickest:{time:1,risk:0},balanced:{time:.5,risk:.5},'lower-risk':{time:.15,risk:.85}};
const penalties={limited:4,insufficient:10,unknown:10};
function dur(s:number):string { if(s<60)return `${Math.round(s)} s`;const m=Math.round(s/60);return m<60?`${m} min`:`${Math.floor(m/60)} h ${m%60?`${m%60} min`:''}`.trim(); }
export function compareRoutes(results:ReadonlyArray<RouteRiskResult>,preference:RoutePreference,options:CompareOptions={}):RouteComparison {
 if(!results.length)return {preference,ranked:[],recommendedRouteId:null,notes:['No routes were provided to compare.']};
 const w={...defaults[preference],...options.weights?.[preference]}, p={...penalties,...options.uncertaintyPenaltyPoints}, speed=Math.max(1,options.fallbackSpeedKmh??30)/3.6;
 const entries=results.map((result,index)=>{const time=result.route.durationS&&result.route.durationS>0?result.route.durationS:result.route.distanceM&&result.route.distanceM>0?result.route.distanceM/speed:null;const timeSource:TravelTimeSource=result.route.durationS&&result.route.durationS>0?'provided':time===null?'unavailable':'estimated-from-distance';const penalty=result.coverage.level==='adequate'?0:p[result.coverage.level];return {result,index,time,timeSource,penalty,effectiveRisk:clamp(result.score+penalty,0,100),blocked:result.blocked.isBlocked,demoted:result.blocked.isBlocked&&(options.demoteBlockedRoutes??true),normalizedTime:.5,rankValue:0};});
 const times=entries.flatMap(x=>x.time===null?[]:[x.time]), min=times.length?Math.min(...times):0,max=times.length?Math.max(...times):0,denom=Math.max(max-min,min*(options.minTimeRangeRatio??.05),options.minTimeRangeS??60);
 for(const e of entries){e.normalizedTime=e.time===null?.5:clamp((e.time-min)/denom,0,1);e.rankValue=w.time*e.normalizedTime+w.risk*e.effectiveRisk/100;}
 const sorted=[...entries].sort((a,b)=>Number(a.demoted)-Number(b.demoted)||a.rankValue-b.rankValue||a.normalizedTime-b.normalizedTime||a.effectiveRisk-b.effectiveRisk||a.index-b.index), fastest=times.length?min:null;
 const ranked=sorted.map((e,i)=>{const r=e.result,rank=i+1,explanation=[`Ranked #${rank} of ${sorted.length} for the "${preference}" preference.`];if(e.time===null)explanation.push('Travel time is unavailable for this route, so it was treated as average on time.');else explanation.push(`Estimated travel time ${dur(e.time)}${e.timeSource==='estimated-from-distance'?' (estimated from distance)':''}${e.time-min<1?', the fastest candidate.':`, ${dur(e.time-min)} slower than the fastest.`}`);if(r.assessment==='not-assessable')explanation.push('Hazard risk could not be assessed; this is not a sign of safety.');else explanation.push(`Estimated hazard risk ${r.score}/100 (${r.category}).`);if(r.coverage.level!=='adequate')explanation.push(`Hazard data here is ${r.coverage.level}; a low score means little was reported, not that the route is safe.${e.penalty&&w.risk?` ${e.penalty} uncertainty points were added for ranking.`:''}`);for(const warning of r.criticalWarnings)explanation.push(warning.message);if(e.blocked)explanation.push(e.demoted?'Ranked below routes without a reliably reported closure.':'A closure with reliable evidence is reported on this route.');if(rank===1&&!e.demoted)explanation.push(preference==='quickest'?'Chosen mainly because it is the quickest; any critical warnings still apply.':preference==='balanced'?'Chosen for combined travel time and estimated risk.':'Chosen for its lowest adjusted hazard risk.');else if(rank>1)explanation.push('Ranked below the top route based on the selected time and risk preference.');return {routeId:r.routeId,rank,rankValue:Math.round(e.rankValue*1000)/1000,travelTimeS:e.time,travelTimeSource:e.timeSource,timeDeltaVsFastestS:e.time!==null&&fastest!==null?e.time-fastest:null,normalizedTime:Math.round(e.normalizedTime*1000)/1000,riskScore:r.score,effectiveRisk:e.effectiveRisk,riskCategory:r.category,uncertain:r.coverage.level!=='adequate',blocked:e.blocked,criticalWarnings:r.criticalWarnings,explanation,result:r};});
 const notes:string[]=[];if(ranked.every(x=>x.uncertain))notes.push('Hazard data is limited for every candidate. Ranking is not a safety judgment.');if(ranked.some(x=>x.criticalWarnings.length))notes.push('At least one route has a critical hazard warning.');notes.push('Rankings reflect reported hazards and travel time only. No route is guaranteed safe.');const top=ranked[0];const recommended=top&&top.blocked&&(options.demoteBlockedRoutes??true)?null:top?.routeId??null;if(recommended===null)notes.push('Every route has a reliably reported closure; no route is recommended.');return {preference,ranked,recommendedRouteId:recommended,notes};
}
