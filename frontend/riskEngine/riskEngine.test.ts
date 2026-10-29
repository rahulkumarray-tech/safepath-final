import type { GeoPoint, HazardInput, RouteInput } from './types';
import { scoreRouteRisk, getHazardsNearRoute } from './riskEngine';
import { compareRoutes } from './compareRoutes';
import { distanceToPolyline, haversineDistanceM } from './geo';
import { adaptHazardSnapshot } from './integration';
import {
	FIXTURE_NOW_MS,
	SAMPLE_DISTANT_HAZARD,
	SAMPLE_MISSING_COORDINATES_HAZARD,
	SAMPLE_NEARBY_SEVERE_HAZARD,
	SAMPLE_ROUTE_ALTERNATIVE,
	SAMPLE_ROUTE_EXPOSED,
	SAMPLE_UNVERIFIED_HAZARD,
} from './fixtures/syntheticRiskFixtures';
const tests:Array<{name:string;fn:()=>void}> = [];
function test(name:string,fn:()=>void){tests.push({name,fn});}
function check(value:boolean,message:string):asserts value {if(!value)throw new Error(message);}
const NOW=Date.UTC(2026,9,29,12), OPTS={nowMs:NOW}, LAT=22.5726,LNG=88.3639,M=111195,dLat=(m:number)=>m/M;
const ago=(days:number)=>new Date(NOW-days*86_400_000).toISOString();
function route(id:string,opts:{latOffsetM?:number;durationS?:number;distanceM?:number}={}):RouteInput {const coordinates:GeoPoint[]=[];for(let i=0;i<=10;i++)coordinates.push({lat:LAT+dLat(opts.latOffsetM??0),lng:LNG+i*.0009});return {id,coordinates,distanceM:opts.distanceM??920,durationS:opts.durationS??120};}
function hazard(over:Partial<HazardInput>&{id:string}):HazardInput{return {type:'accident',lat:LAT+dLat(10),lng:LNG+.0045,severity:3,description:'test hazard',timestamp:ago(1),source:'community',verification:'verified',...over};}
test('1. no hazards + adequate coverage is not called safe',()=>{const off=[1,2,3,4,5].map(i=>hazard({id:`f${i}`,lat:LAT+dLat(600),lng:LNG+i*.0008}));const r=scoreRouteRisk(route('R'),off,{...OPTS,coverageHint:.9});check(r.score===0&&r.nearbyHazards.length===0,'no nearby hazards');check(r.coverage.level==='adequate','adequate hint');check(r.displayLabel.includes('not a guarantee'),'cautious label');});
test('2. one severe nearby hazard scores high with warning',()=>{const r=scoreRouteRisk(route('R'),[hazard({id:'h',severity:5,source:'official'})],OPTS);check(r.score>=60,'score >=60');check(r.criticalWarnings.length===1&&!r.blocked.isBlocked,'critical, not blocked');});
test('3. multiple hazards accumulate and saturate',()=>{const hs=[hazard({id:'a',severity:4,lng:LNG+.001}),hazard({id:'b',type:'pothole',severity:3,lng:LNG+.003}),hazard({id:'c',type:'flooding',severity:2,lng:LNG+.006})];const r=scoreRouteRisk(route('R'),hs,OPTS), singles=hs.map(h=>scoreRouteRisk(route('R'),[h],OPTS).score);check(r.nearbyHazards.length===3&&r.score>Math.max(...singles),'accumulates');check(r.score<singles.reduce((a,b)=>a+b,0)&&r.score<=100,'saturates');check(singles[0]>singles[1]&&singles[1]>singles[2],'severity ordering');});
test('4. distant hazards do not count',()=>{const h=hazard({id:'far',severity:5,lat:LAT+dLat(200)});check(scoreRouteRisk(route('R'),[h],OPTS).score===0,'far score');check(getHazardsNearRoute(route('R'),[h],OPTS).length===0,'far nearby');check(getHazardsNearRoute(route('R'),[hazard({id:'out',lat:LAT+dLat(60)})],OPTS).length===0,'outside corridor');check(getHazardsNearRoute(route('R'),[hazard({id:'in',lat:LAT+dLat(45)})],OPTS).length===1,'inside corridor');});
test('5. verified scores higher than unverified',()=>{const v=scoreRouteRisk(route('R'),[hazard({id:'x',verification:'verified'})],OPTS).score,u=scoreRouteRisk(route('R'),[hazard({id:'x',verification:'unverified'})],OPTS).score;check(v>u&&u>0,'verification weighting');});
test('6. recent reports score higher than old reports',()=>{const r=scoreRouteRisk(route('R'),[hazard({id:'x',timestamp:ago(1)})],OPTS).score,o=scoreRouteRisk(route('R'),[hazard({id:'x',timestamp:ago(200)})],OPTS).score;check(r>o&&o>0,'recency decay with floor');});
test('7. duplicate ids and nearby reports are not double counted',()=>{const a=hazard({id:'dup'}),one=scoreRouteRisk(route('R'),[a],OPTS),same=scoreRouteRisk(route('R'),[a,hazard({id:'dup'})],OPTS);check(same.nearbyHazards.length===1&&same.dataQuality.duplicateIdsRemoved===1&&same.score===one.score,'duplicate id');const near=scoreRouteRisk(route('R'),[hazard({id:'a'}),hazard({id:'b',lat:LAT+dLat(15)})],OPTS);check(near.nearbyHazards.length===1&&near.dataQuality.nearDuplicatesMerged===1&&near.nearbyHazards[0]?.corroboratingReports===1,'near duplicate');});
test('8. malformed coordinates are rejected',()=>{const bad=[hazard({id:'nan',lat:NaN}),hazard({id:'lat',lat:91}),hazard({id:'lng',lng:181}),{id:'nolng',type:'accident',lat:LAT} as unknown as HazardInput,hazard({id:'zero',lat:0,lng:0}),hazard({id:'string',lat:'x' as unknown as number}),null as unknown as HazardInput];const r=scoreRouteRisk(route('R'),bad,OPTS);check(r.score===0&&r.dataQuality.rejected.length===7,'bad records rejected');});
test('9. missing timestamps are reduced and malformed dates rejected',()=>{const recent=scoreRouteRisk(route('R'),[hazard({id:'x',timestamp:ago(.1)})],OPTS),missing=scoreRouteRisk(route('R'),[hazard({id:'x',timestamp:undefined})],OPTS);check(missing.dataQuality.unknownTimestamps===1&&missing.score>0&&missing.score<recent.score,'unknown date weighting');const invalid=scoreRouteRisk(route('R'),[hazard({id:'a',timestamp:'invalid'}),hazard({id:'b',timestamp:ago(-5)})],OPTS);check(invalid.score===0&&invalid.dataQuality.rejected.length===2,'invalid dates');});
test('10. empty and malformed route geometries are handled',()=>{const empty=scoreRouteRisk({id:'E',coordinates:[]},[hazard({id:'x'})],OPTS);check(empty.assessment==='not-assessable'&&empty.category===null&&empty.coverage.level==='unknown','empty route');const bad=scoreRouteRisk({id:'W',coordinates:[[LAT,LNG]] as unknown as GeoPoint[]},[],OPTS);check(bad.assessment==='not-assessable'&&bad.dataQuality.routePointsDropped===1,'wrong point shape');const single=scoreRouteRisk({id:'P',coordinates:[{lat:LAT,lng:LNG+.0045}]},[hazard({id:'x'})],OPTS);check(single.assessment==='assessed'&&single.nearbyHazards.length===1,'single point');});
test('11. comparisons follow the selected preference',()=>{const hint={...OPTS,coverageHint:.9},a=scoreRouteRisk(route('A',{durationS:600,distanceM:4000}),[hazard({id:'h',severity:4})],hint),b=scoreRouteRisk(route('B',{latOffsetM:1500,durationS:900,distanceM:5000}),[],hint);check(compareRoutes([a,b],'quickest').ranked[0]?.routeId==='A','quickest');check(compareRoutes([a,b],'lower-risk').ranked[0]?.routeId==='B','risk preference');check(compareRoutes([a,b],'balanced').ranked[0]?.routeId==='A','balanced');const severe=scoreRouteRisk(route('A2',{durationS:600}),[hazard({id:'h',severity:5,source:'official'})],hint),clean=scoreRouteRisk(route('B2',{latOffsetM:1500,durationS:630}),[],hint);check(compareRoutes([severe,clean],'balanced').ranked[0]?.routeId==='B2','small time gap favors lower risk');});
test('12. closure warnings and blocking are evidence-aware',()=>{const c=hazard({id:'c',type:'road_closure',severity:5,source:'official',verification:'verified',timestamp:ago(.5)}),r=scoreRouteRisk(route('R'),[c],OPTS);check(r.criticalWarnings.length===1&&r.criticalWarnings[0]?.evidenceLevel==='reliable'&&r.blocked.isBlocked,'confirmed closure');const weak=scoreRouteRisk(route('R'),[hazard({id:'w',type:'road_closure',severity:5,source:'demo',verification:'unverified'})],OPTS);check(weak.criticalWarnings[0]?.evidenceLevel==='unconfirmed'&&!weak.blocked.isBlocked&&weak.score<50&&weak.category==='High','weak closure warning');const hint={...OPTS,coverageHint:.9},fast=scoreRouteRisk(route('F',{durationS:600}),[c],hint),slow=scoreRouteRisk(route('S',{latOffsetM:1500,durationS:900}),[],hint);check(compareRoutes([fast,slow],'quickest').ranked[0]?.routeId==='S','blocked route demoted');});
test('13. empty coverage is unknown, not safe',()=>{const r=scoreRouteRisk(route('R'),[],OPTS);check(r.score===0&&r.coverage.level==='insufficient'&&r.displayLabel.toLowerCase().includes('unknown'),'unknown label');check(r.explanations.some(x=>x.includes('does not mean')),'caution');const clean=scoreRouteRisk(route('Y',{latOffsetM:1500}),[hazard({id:'minor',type:'pothole',severity:1,lat:LAT+dLat(1510)})],{...OPTS,coverageHint:.9}),unknown=scoreRouteRisk(route('X'),[],OPTS);check(compareRoutes([unknown,clean],'lower-risk').ranked[0]?.routeId==='Y','uncertainty penalty');});
test('14. geographic helpers return accurate distances',()=>{const d=haversineDistanceM({lat:0,lng:0},{lat:1,lng:0});check(Math.abs(d-111195)<200,'degree distance');const line=[{lat:22.5,lng:88},{lat:22.5,lng:88.01}],p=distanceToPolyline({lat:22.5+dLat(100),lng:88.005},line);check(p!==null&&Math.abs(p.distanceM-100)<1,'perpendicular distance');const beyond=distanceToPolyline({lat:22.5,lng:88.02},line),end=haversineDistanceM({lat:22.5,lng:88.02},{lat:22.5,lng:88.01});check(beyond!==null&&Math.abs(beyond.distanceM-end)<2,'endpoint clamp');});
test('15. hazards nearer the road score higher',()=>{const near=scoreRouteRisk(route('R'),[hazard({id:'x',lat:LAT+dLat(5)})],OPTS).score,edge=scoreRouteRisk(route('R'),[hazard({id:'x',lat:LAT+dLat(48)})],OPTS).score;check(near>edge&&edge>0,'proximity weight');});
test('16. scoring is deterministic and does not mutate input',()=>{const hs=[hazard({id:'a'}),hazard({id:'b',type:'pothole',lng:LNG+.002})],before=JSON.stringify(hs),one=JSON.stringify(scoreRouteRisk(route('R'),hs,OPTS));check(one===JSON.stringify(scoreRouteRisk(route('R'),hs,OPTS))&&JSON.stringify(hs)===before,'deterministic and immutable');});
test('17. isolated fixtures distinguish route exposure and explain the difference',()=>{
	const options={nowMs:FIXTURE_NOW_MS};
	const exposed=scoreRouteRisk(SAMPLE_ROUTE_EXPOSED,[SAMPLE_NEARBY_SEVERE_HAZARD],options);
	const alternative=scoreRouteRisk(SAMPLE_ROUTE_ALTERNATIVE,[SAMPLE_NEARBY_SEVERE_HAZARD],options);
	const clear=scoreRouteRisk(SAMPLE_ROUTE_EXPOSED,[],options);
	check(exposed.score>alternative.score,'route near severe report should score higher than the offset alternative');
	check(alternative.score===0&&alternative.nearbyHazards.length===0,'distant report should not contribute to alternative route');
	check(exposed.explanations.some(text=>text.toLowerCase().includes('obstruction')),'exposed route explanation names the hazard');
	check(!alternative.explanations.some(text=>text.toLowerCase().includes('obstruction')),'alternative explanation must not claim exposure');
	check(exposed.score>clear.score&&exposed.explanations[0]!==clear.explanations[0],'score and lead explanation change when exposure changes');
});
test('18. fixtures cover distant and missing-coordinate hazard records',()=>{
	const options={nowMs:FIXTURE_NOW_MS};
	const distant=scoreRouteRisk(SAMPLE_ROUTE_EXPOSED,[SAMPLE_DISTANT_HAZARD],options);
	const malformed=scoreRouteRisk(SAMPLE_ROUTE_EXPOSED,[SAMPLE_MISSING_COORDINATES_HAZARD as HazardInput],options);
	check(distant.score===0&&distant.nearbyHazards.length===0,'synthetic distant hazard is excluded');
	check(malformed.score===0&&malformed.dataQuality.rejected.length===1,'missing coordinates are reported as rejected');
});
test('19. unverified fixture has lower score than verified equivalent',()=>{
	const options={nowMs:FIXTURE_NOW_MS};
	const verified=scoreRouteRisk(SAMPLE_ROUTE_EXPOSED,[SAMPLE_NEARBY_SEVERE_HAZARD],options);
	const unverified=scoreRouteRisk(SAMPLE_ROUTE_EXPOSED,[SAMPLE_UNVERIFIED_HAZARD],options);
	check(verified.score>unverified.score&&unverified.score>0,'unverified evidence is down-weighted but not discarded');
});
test('20. generic integration adapter maps provider records without defining their schema',()=>{
	const snapshot=adaptHazardSnapshot({records:[{key:'adapter-test',y:LAT,x:LNG,kind:'sample'}],asOf:FIXTURE_NOW_MS},{toHazardInput:(raw)=>({id:raw.key,type:raw.kind,lat:raw.y,lng:raw.x,source:'unknown',verification:'unknown'})});
	check(snapshot.hazards.length===1&&snapshot.hazards[0]?.id==='adapter-test','raw provider data mapped');
	check(snapshot.coverageHint===null&&snapshot.asOf===FIXTURE_NOW_MS,'missing coverage remains unknown; snapshot timestamp retained');
});
let failed=0;for(const t of tests){try{t.fn();console.log(`PASS  ${t.name}`);}catch(e){failed++;console.log(`FAIL  ${t.name}\n      ${e instanceof Error?e.message:String(e)}`);}}console.log(`\n${tests.length-failed}/${tests.length} tests passed`);if(failed)throw new Error(`${failed} test(s) failed`);
