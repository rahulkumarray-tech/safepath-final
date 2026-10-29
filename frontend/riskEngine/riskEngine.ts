import type { BlockedStatus, CoverageInfo, CriticalWarning, DataQuality, FactorSummary, GeoPoint, HazardContribution, HazardInput, HazardSource, NearbyHazard, NormalizedHazard, RejectedHazard, RiskCategory, RiskEngineConfig, RiskEngineOptions, RouteInput, RouteRiskResult, RouteSummary, VerificationStatus } from './types';
import { boundingBoxOf, boxContains, clamp, distanceToPolyline, expandBox, haversineDistanceM, isValidLatLng, polylineLengthM } from './geo';
const DAY = 86_400_000;
export const RISK_DISCLAIMER = 'This is a relative, prototype hazard score computed from reported incidents. It is not a probability of harm, its weights have not been scientifically validated, and the absence of reports does not mean a road is safe.';
export const DEFAULT_RISK_CONFIG: RiskEngineConfig = {
  corridorM: 50, coreDistanceM: 15, minProximityWeight: 0.3, severityWeights: [0.1, 0.25, 0.45, 0.7, 1], defaultSeverity: 2,
  recencyHalfLifeDays: 14, minRecencyWeight: 0.15, unknownTimestampWeight: 0.5,
  verificationWeights: { verified: 1, unverified: 0.6, unknown: 0.6, disputed: 0.25, resolved: 0 },
  sourceWeights: { official: 1, community: 0.85, unknown: 0.7, demo: 0.6 }, impactScale: 0.8, duplicateClusterRadiusM: 25,
  categoryThresholds: { moderate: 25, high: 50, veryHigh: 75 }, criticalTypes: ['road_closure','road_blocked','bridge_closed','bridge_collapse','impassable_flood'],
  criticalSeverity: 5, criticalCategoryFloor: 'High', blockingTypes: ['road_closure','road_blocked','bridge_closed','bridge_collapse'],
  blockingMaxDistanceM: 25, blockingMaxAgeDays: 30, reliableEvidenceMin: 0.8, confirmedBlockingHazardIds: [], coverageRadiusM: 3000, coverageFreshDays: 30, coverageHint: null, nowMs: null,
};
function defined<T extends object>(o: T): Partial<T> { return Object.fromEntries(Object.entries(o).filter(([,v]) => v !== undefined)) as Partial<T>; }
function positive(v: number, fallback: number): number { return Number.isFinite(v) && v > 0 ? v : fallback; }
export function resolveRiskConfig(options: RiskEngineOptions = {}): RiskEngineConfig {
  const { verificationWeights, sourceWeights, categoryThresholds, ...rest } = options;
  const d = DEFAULT_RISK_CONFIG, m: RiskEngineConfig = { ...d, ...defined(rest), verificationWeights: { ...d.verificationWeights, ...defined(verificationWeights ?? {}) }, sourceWeights: { ...d.sourceWeights, ...defined(sourceWeights ?? {}) }, categoryThresholds: { ...d.categoryThresholds, ...defined(categoryThresholds ?? {}) } };
  const corridorM = positive(m.corridorM, d.corridorM);
  return { ...m, corridorM, coreDistanceM: clamp(Number.isFinite(m.coreDistanceM) ? m.coreDistanceM : 0, 0, corridorM), minProximityWeight: clamp(m.minProximityWeight, 0, 1), recencyHalfLifeDays: positive(m.recencyHalfLifeDays, d.recencyHalfLifeDays), impactScale: clamp(m.impactScale, 0.01, 1), severityWeights: m.severityWeights.length === 5 ? m.severityWeights : d.severityWeights, coverageHint: m.coverageHint === null || !Number.isFinite(m.coverageHint) ? null : clamp(m.coverageHint, 0, 1) };
}
interface Clean { points: GeoPoint[]; received: number; dropped: number }
function cleanRoute(input: unknown): Clean {
  const list = Array.isArray(input) ? input as unknown[] : [], points: GeoPoint[] = [];
  for (const x of list) { if (typeof x === 'object' && x !== null) { const p = x as Partial<GeoPoint>; if (isValidLatLng(p.lat, p.lng)) points.push({ lat: p.lat as number, lng: p.lng as number }); } }
  return { points, received: list.length, dropped: list.length - points.length };
}
function routeSummary(route: RouteInput, id: string, points: GeoPoint[]): RouteSummary {
  const d = route?.distanceM, t = route?.durationS, validD = typeof d === 'number' && Number.isFinite(d) && d > 0, validT = typeof t === 'number' && Number.isFinite(t) && t > 0;
  return { id, distanceM: validD ? d as number : points.length > 1 ? polylineLengthM(points) : null, durationS: validT ? t as number : null, distanceSource: validD ? 'provided' : points.length > 1 ? 'geometry' : 'none', validPointCount: points.length };
}
const severityWords: Record<string,number> = { minor:1, low:2, moderate:3, medium:3, high:4, severe:5, critical:5 };
function normalize(hazards: ReadonlyArray<HazardInput>, cfg: RiskEngineConfig, now: number) {
  const rejected: RejectedHazard[] = [], byId = new Map<string,NormalizedHazard>(); let duplicateIdsRemoved = 0;
  for (const rawValue of hazards) {
    if (typeof rawValue !== 'object' || rawValue === null) { rejected.push({ id:null, reason:'record is not an object' }); continue; }
    const raw = rawValue as unknown as Record<string,unknown>, id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : typeof raw.id === 'number' && Number.isFinite(raw.id) ? String(raw.id) : null;
    if (!id) { rejected.push({ id:null, reason:'missing or invalid id' }); continue; }
    if (!isValidLatLng(raw.lat, raw.lng) || (raw.lat === 0 && raw.lng === 0)) { rejected.push({ id, reason:'invalid or missing coordinates' }); continue; }
    const verifyText = typeof raw.verification === 'string' ? raw.verification.toLowerCase().trim() : '';
    const verification: VerificationStatus = ['verified','unverified','disputed','resolved'].includes(verifyText) ? verifyText as VerificationStatus : 'unknown';
    if (verification === 'resolved') { rejected.push({ id, reason:'hazard marked as resolved' }); continue; }
    let timestampMs: number | null = null;
    if (raw.timestamp !== undefined && raw.timestamp !== null && raw.timestamp !== '') {
      const val = raw.timestamp, n = val instanceof Date ? val.getTime() : typeof val === 'number' ? (Math.abs(val) < 1e11 ? val * 1000 : val) : typeof val === 'string' ? Date.parse(val) : NaN;
      if (!Number.isFinite(n)) { rejected.push({ id, reason:'malformed timestamp' }); continue; }
      if (n > now + DAY) { rejected.push({ id, reason:'timestamp is in the future' }); continue; }
      if (n < Date.UTC(2000,0,1)) { rejected.push({ id, reason:'timestamp before year 2000' }); continue; }
      timestampMs = n;
    }
    let severity = cfg.defaultSeverity, severityWasMissing = true;
    if (typeof raw.severity === 'number' && Number.isFinite(raw.severity)) { severity = clamp(Math.round(raw.severity),1,5); severityWasMissing = false; }
    else if (typeof raw.severity === 'string' && raw.severity.trim()) { const text = raw.severity.trim().toLowerCase(), n = Number(text); if (Number.isFinite(n)) { severity=clamp(Math.round(n),1,5); severityWasMissing=false; } else if (severityWords[text] !== undefined) { severity=severityWords[text] as number; severityWasMissing=false; } }
    const sourceText = typeof raw.source === 'string' ? raw.source.trim().toLowerCase() : '';
    const source: HazardSource = ['official','community','demo'].includes(sourceText) ? sourceText as HazardSource : 'unknown';
    const type = typeof raw.type === 'string' ? raw.type.trim().toLowerCase().replace(/[\s-]+/g,'_') || 'other' : 'other';
    const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : null;
    const item: NormalizedHazard = { id, type, lat:raw.lat as number, lng:raw.lng as number, severity, severityWasMissing, description:typeof raw.description === 'string' ? raw.description.trim() : '', timestampMs, source, verification, confidence };
    const old = byId.get(id); if (!old) byId.set(id,item); else { duplicateIdsRemoved++; if ((item.timestampMs ?? -Infinity) > (old.timestampMs ?? -Infinity)) byId.set(id,item); }
  }
  return { valid:[...byId.values()], rejected, duplicateIdsRemoved };
}
function locate(points: GeoPoint[], hazards: NormalizedHazard[], radius: number): NearbyHazard[] {
  const box = boundingBoxOf(points); if (!box) return []; const search = expandBox(box,radius), found: NearbyHazard[] = [];
  for (const hazard of hazards) { if (!boxContains(search,hazard)) continue; const p = distanceToPolyline(hazard,points); if (p && p.distanceM <= radius) found.push({ hazard, distanceToRouteM:p.distanceM, nearestSegmentIndex:p.segmentIndex, nearestPoint:p.nearestPoint }); }
  return found;
}
function round(n: number): number { return Math.round(n*10)/10; }
function contribution(n: NearbyHazard, cfg: RiskEngineConfig, now: number): HazardContribution {
  const h=n.hazard, ageDays=h.timestampMs===null?null:Math.max(0,(now-h.timestampMs)/DAY);
  const severity=cfg.severityWeights[h.severity-1] ?? 0, recency=ageDays===null?cfg.unknownTimestampWeight:Math.max(cfg.minRecencyWeight,Math.pow(.5,ageDays/cfg.recencyHalfLifeDays));
  const span=cfg.corridorM-cfg.coreDistanceM, fraction=span<=0?0:clamp((n.distanceToRouteM-cfg.coreDistanceM)/span,0,1), proximity=n.distanceToRouteM<=cfg.coreDistanceM?1:1-(1-cfg.minProximityWeight)*fraction;
  const evidence=clamp((cfg.verificationWeights[h.verification]??0)*(cfg.sourceWeights[h.source]??0)*(h.confidence===null?1:.5+.5*h.confidence),0,1), impact=clamp(severity*recency*proximity*evidence,0,1);
  const forced=cfg.confirmedBlockingHazardIds.includes(h.id), reliable=forced || (cfg.blockingTypes.includes(h.type)&&h.verification==='verified'&&evidence>=cfg.reliableEvidenceMin&&n.distanceToRouteM<=cfg.blockingMaxDistanceM&&ageDays!==null&&ageDays<=cfg.blockingMaxAgeDays);
  return { hazardId:h.id,type:h.type,description:h.description,location:{lat:h.lat,lng:h.lng},severityLevel:h.severity,severityAssumed:h.severityWasMissing,distanceToRouteM:n.distanceToRouteM,ageDays,source:h.source,verification:h.verification,factors:{severity,recency,proximity,evidence},contribution:impact,standalonePoints:round(100*cfg.impactScale*impact),corroboratingReports:0,mergedHazardIds:[],isCritical:forced||cfg.criticalTypes.includes(h.type)||h.severity>=cfg.criticalSeverity,hasReliableBlockingEvidence:reliable };
}
function merge(items: HazardContribution[], radius: number) {
  const kept: HazardContribution[]=[]; let mergedCount=0;
  for (const item of items) { const twin=kept.find(k=>k.type===item.type&&haversineDistanceM(k.location,item.location)<=radius); if (!twin) kept.push(item); else { twin.corroboratingReports++; twin.mergedHazardIds.push(item.hazardId); twin.isCritical ||= item.isCritical; twin.hasReliableBlockingEvidence ||= item.hasReliableBlockingEvidence; mergedCount++; } }
  return {kept,mergedCount};
}
const categories: RiskCategory[]=['Low','Moderate','High','Very High'];
function category(score:number,cfg:RiskEngineConfig):RiskCategory { return score>=cfg.categoryThresholds.veryHigh?'Very High':score>=cfg.categoryThresholds.high?'High':score>=cfg.categoryThresholds.moderate?'Moderate':'Low'; }
function coverage(located:NearbyHazard[],cfg:RiskEngineConfig,now:number):CoverageInfo {
  const regional=located.filter(x=>x.distanceToRouteM<=cfg.coverageRadiusM), recent=regional.filter(x=>x.hazard.timestampMs!==null&&(now-(x.hazard.timestampMs as number))/DAY<=cfg.coverageFreshDays), nonDemo=regional.filter(x=>x.hazard.source!=='demo');
  let score=cfg.coverageHint??(0.6*Math.min(1,recent.length/3)+0.4*Math.min(1,regional.length/5)); if(cfg.coverageHint===null&&regional.length>0&&nonDemo.length===0)score=Math.min(score,.4);
  const level=score>=.7?'adequate':score>=.35?'limited':'insufficient';
  return {level,score:Math.round(score*100)/100,basedOn:cfg.coverageHint===null?'nearby-report-density':'caller-hint',regionalReports:regional.length,recentRegionalReports:recent.length,nonDemoRegionalReports:nonDemo.length,note:cfg.coverageHint===null?`Estimated from ${regional.length} valid report(s) within ${cfg.coverageRadiusM} m of the route (${recent.length} recent). This is a rough proxy, not a real coverage map.`:`Coverage level "${level}" was supplied by the application.`};
}
function emptyQuality(received:number,clean:Clean,n:{valid:NormalizedHazard[];rejected:RejectedHazard[];duplicateIdsRemoved:number}):DataQuality { return {hazardsReceived:received,hazardsUsed:n.valid.length,rejected:n.rejected,duplicateIdsRemoved:n.duplicateIdsRemoved,nearDuplicatesMerged:0,unknownTimestamps:0,missingSeverity:0,demoHazardsCounted:0,routePointsReceived:clean.received,routePointsDropped:clean.dropped}; }
function label(c:RiskCategory|null,has:boolean,cov:CoverageInfo,b:BlockedStatus,w:number):string { if(!c)return 'Risk unknown (no usable route geometry)'; if(b.isBlocked)return 'Blocked: closure reported with reliable evidence'; if(w)return `${c} estimated hazard risk (critical hazard reported)`; if(!has)return cov.level==='adequate'?'No reported hazards on this route (not a guarantee of safety)':cov.level==='limited'?'No reported hazards found, but data is limited (risk uncertain)':'Risk unknown: insufficient hazard data for this route'; return `${c} estimated hazard risk`; }
export function getHazardsNearRoute(route:RouteInput,hazards:ReadonlyArray<HazardInput>,options:RiskEngineOptions={}):NearbyHazard[] { const cfg=resolveRiskConfig(options), now=cfg.nowMs??Date.now(), clean=cleanRoute(route?.coordinates), n=normalize(Array.isArray(hazards)?hazards:[],cfg,now); return locate(clean.points,n.valid,cfg.corridorM).filter(x=>x.distanceToRouteM<=cfg.corridorM).sort((a,b)=>a.distanceToRouteM-b.distanceToRouteM||a.hazard.id.localeCompare(b.hazard.id)); }
export function scoreRouteRisk(route:RouteInput,hazards:ReadonlyArray<HazardInput>,options:RiskEngineOptions={}):RouteRiskResult {
  const cfg=resolveRiskConfig(options), now=cfg.nowMs??Date.now(), id=typeof route?.id==='string'?route.id:String(route?.id??'unknown-route'), clean=cleanRoute(route?.coordinates), list=Array.isArray(hazards)?hazards:[], normalized=normalize(list,cfg,now), summary=routeSummary(route??({} as RouteInput),id,clean.points), noBlock:BlockedStatus={isBlocked:false,hazardIds:[],reason:null};
  if(!clean.points.length){const cov:CoverageInfo={level:'unknown',score:0,basedOn:'no-route-geometry',regionalReports:0,recentRegionalReports:0,nonDemoRegionalReports:0,note:'The route has no valid coordinates, so hazards cannot be matched to it.'};return {routeId:id,route:summary,assessment:'not-assessable',score:0,category:null,displayLabel:label(null,false,cov,noBlock,0),nearbyHazards:[],factorSummary:{severity:null,recency:null,proximity:null,evidence:null},scoreComponents:{strongestHazardPoints:0,accumulationPoints:0},criticalWarnings:[],blocked:noBlock,coverage:cov,dataQuality:emptyQuality(list.length,clean,normalized),explanations:['The route has no usable geometry, so its hazard risk could not be assessed. This is not a sign that it is safe.'],disclaimer:RISK_DISCLAIMER};}
  const located=locate(clean.points,normalized.valid,Math.max(cfg.coverageRadiusM,cfg.corridorM)), inCorridor=located.filter(x=>x.distanceToRouteM<=cfg.corridorM);
  const sorted=inCorridor.map(x=>contribution(x,cfg,now)).sort((a,b)=>b.contribution-a.contribution||a.distanceToRouteM-b.distanceToRouteM||a.hazardId.localeCompare(b.hazardId)), merged=merge(sorted,cfg.duplicateClusterRadiusM), kept=merged.kept;
  let remaining=1; for(const h of kept)remaining*=1-cfg.impactScale*h.contribution; const score=round(clamp(100*(1-remaining),0,100)), strongest=kept.length?Math.max(...kept.map(x=>x.contribution)):0, strongestPoints=round(100*cfg.impactScale*strongest);
  const mean=(key:keyof HazardContribution['factors']):number|null=>kept.length?Math.round(kept.reduce((s,x)=>s+x.factors[key],0)/kept.length*1000)/1000:null;
  const factorSummary:FactorSummary={severity:mean('severity'),recency:mean('recency'),proximity:mean('proximity'),evidence:mean('evidence')};
  const warnings:CriticalWarning[]=kept.filter(x=>x.isCritical).map(x=>{const reliable=x.hasReliableBlockingEvidence||x.factors.evidence>=cfg.reliableEvidenceMin;return {hazardId:x.hazardId,type:x.type,description:x.description,distanceToRouteM:x.distanceToRouteM,evidenceLevel:reliable?'reliable':'unconfirmed',message:`Critical: ${x.type.replace(/_/g,' ')} reported about ${Math.round(x.distanceToRouteM)} m from the route (${reliable?'reliable':'not confirmed'} evidence).`};});
  const blockers=kept.filter(x=>x.hasReliableBlockingEvidence), blocked:BlockedStatus=blockers.length?{isBlocked:true,hazardIds:blockers.map(x=>x.hazardId),reason:`Closure reported with reliable evidence (${blockers.map(x=>x.hazardId).join(', ')}).`}:noBlock;
  let cat=category(score,cfg); if(warnings.length&&cfg.criticalCategoryFloor&&categories.indexOf(cat)<categories.indexOf(cfg.criticalCategoryFloor))cat=cfg.criticalCategoryFloor;
  const cov=coverage(located,cfg,now), dq={...emptyQuality(list.length,clean,normalized),nearDuplicatesMerged:merged.mergedCount,unknownTimestamps:kept.filter(x=>x.ageDays===null).length,missingSeverity:kept.filter(x=>x.severityAssumed).length,demoHazardsCounted:kept.filter(x=>x.source==='demo').length};
  const explanations=[`Estimated hazard risk: ${score}/100 (${cat}). This is a relative score from reported incidents, not a probability of harm.`];
  for(const x of kept.slice(0,3)) explanations.push(`${x.type.replace(/_/g,' ')}: about ${Math.round(x.distanceToRouteM)} m from the route, severity ${x.severityLevel}/5${x.severityAssumed?' (assumed, not provided)':''}. On its own this would score about ${x.standalonePoints}/100.`);
  if(!kept.length) explanations.push(cov.level==='adequate'?'No reported hazards were found, but this is not a guarantee of safety.':`No reported hazards were found, but coverage is ${cov.level}; this does not mean the route is safe.`);
  if(cov.level!=='adequate'&&kept.length)explanations.push(`Hazard data coverage is ${cov.level}; there may be unreported hazards.`);
  for(const w of warnings)explanations.push(w.message); if(blocked.reason)explanations.push(blocked.reason);
  if(dq.rejected.length)explanations.push(`${dq.rejected.length} hazard record(s) were ignored because they were invalid or resolved.`);
  return {routeId:id,route:summary,assessment:'assessed',score,category:cat,displayLabel:label(cat,kept.length>0,cov,blocked,warnings.length),nearbyHazards:kept,factorSummary,scoreComponents:{strongestHazardPoints:strongestPoints,accumulationPoints:round(Math.max(0,score-strongestPoints))},criticalWarnings:warnings,blocked,coverage:cov,dataQuality:dq,explanations,disclaimer:RISK_DISCLAIMER};
}
