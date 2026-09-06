import test from 'node:test';
import assert from 'node:assert/strict';
import { TourvisorPublicProvider } from '../src/providers/tourvisorPublicProvider.ts';
import { Worker } from '../src/worker.ts';
import { bookingLinkFromRaw, TelegramNotifier } from '../src/telegram.ts';

const preset = {id:'test',enabled:true,title:'test',departureCity:'Minsk',departureId:57,countries:['Vietnam'],countryId:16,resorts:[],dateFrom:'2026-09-06',dateTo:'2026-10-25',nightsFrom:12,nightsTo:18,adults:2,children:0,meal:'BB',hotelStarsMin:3,budget:{amount:2700,currency:'USD'}};
const offer = (id, amount) => ({source:'tourvisor',externalId:id,title:id,url:'https://tourvisor.ru/t/1',price:{amount,currency:'USD'},meal:'BB - Только завтрак',hotelStars:3,dateStart:'2026-09-15',nights:14});
const provider = () => new TourvisorPublicProvider({modsearchUrl:'https://tourvisor.ru/xml/modsearch.php',modresultUrl:'https://search3.tourvisor.ru/modresult.php',pollIntervalMs:0,verificationRetryDelayMs:0});

test('polls full snapshots until finished and includes late block five', async () => {
  const p=provider();let calls=0;
  p.fetchWithSession=async url=>{
    assert.equal(url.searchParams.has('lastblock'),false);
    calls++;
    return Response.json({data:{status:{progress:calls<3?'86':'100'},block:Array.from({length:calls<3?4:5},(_,id)=>({id}))}});
  };
  const result=await p.pollResults('123');
  assert.equal(calls,3);assert.equal(result.data.block.length,5);
});

test('missing operator retry preserves first search and adds cheaper offers', async () => {
  const p=provider();let calls=0;
  p.startSearch=async()=>String(++calls);
  p.pollResults=async id=>({data:{status:{finished:1},operators:id==='1'?[{name:'late',status:4}]:[],offers:id==='1'?[{id:'1',price:2600,hotel:'First'}]:[{id:'2',price:2352,hotel:'Second'}]}});
  const result=await p.search(preset);
  assert.equal(calls,2);assert.deepEqual(result.map(d=>d.price.amount),[2352,2600]);
});

function mockAvailability(p, detail, {sold=false, short=true}={}) {
  let detailedCalls=0;
  p.fetchWithSession=async url=>{
    if(url.searchParams.has('detailed')) {detailedCalls++;return Response.json(detail);}
    if(url.searchParams.has('shortid')&&!short) return Response.json({data:{}});
    return Response.json({data:{sold,tour:{tourid:'123',shortid:'456',price:'2352',currency:'USD',hotelname:'Crown'},client:{showrequest:1}}});
  };
  return ()=>detailedCalls;
}

test('GetDatabaseFail retries then retains a card with confirmed booking controls and explicit warning', async()=>{
  const p=provider();const count=mockAvailability(p,{data:{error:{code:5,reason:'Не удалось получить дополнительные сведения (GetDatabaseFail)'}}});
  const d=await p.resolveDealLink(offer('tourvisor:123',2352));
  assert.equal(count(),2);assert.equal(d.isAvailable,true);assert.match(d.availabilityText,/не подтверждены/);
});

test('technical failure without short-card confirmation stays unknown',async()=>{
  const p=provider();mockAvailability(p,{data:{error:{code:5,reason:'GetDatabaseFail'}}},{short:false});
  assert.equal((await p.resolveDealLink(offer('tourvisor:123',2352))).isAvailable,undefined);
});

test('explicit sold and obsolete tours remain excluded',async()=>{
  const p=provider();mockAvailability(p,{data:{error:false}},{sold:true});
  assert.equal((await p.resolveDealLink(offer('tourvisor:123',2352))).isAvailable,false);
  const q=provider();mockAvailability(q,{error:{errormessage:'Wrong (obsolete) TourID'}});
  assert.equal((await q.resolveDealLink(offer('tourvisor:123',2352))).isAvailable,false);
});

test('worker ranks updated prices, excludes mismatches and keeps history beyond send limit',async()=>{
  const sent=[],observed=[],prices=[];
  const storage={getMaxAlertsPerCheck:()=>1,savePrice:(id,d,price)=>prices.push([d.externalId,price]),recordDealObservation:(id,d,price)=>observed.push([d.externalId,price]),markAlertSent:()=>{},getLastBestDigestAt:()=>new Date().toISOString()};
  const rules={evaluate:(_p,d)=>({isGood:d.price.amount<=2700,priceRub:d.price.amount*90,reasons:[String(d.price.amount)]})};
  const deals=[offer('A',2300),offer('B',2400),offer('C',2500),offer('D',2400),offer('E',2500)];
  const p={search:async()=>deals,resolveDealLink:async d=>({...d,isAvailable:true,price:{amount:({A:2650,B:2352,C:2800,D:2400,E:2500})[d.externalId],currency:'USD'},meal:d.externalId==='D'?'Без питания':d.meal})};
  const notifier={sendDeal:async(_p,d,reasons)=>sent.push([d.externalId,reasons])};
  await new Worker([preset],p,storage,rules,notifier,1800).checkPreset(preset);
  assert.deepEqual(sent,[['B',['2352']]]);
  assert.deepEqual(observed.map(x=>x[0]),['B','E','A']);
  assert.equal(prices.length,5);
});

test('status-only final reply preserves earlier blocks and decoder tables',async()=>{
  const p=provider();let call=0;
  p.fetchResult=async()=>++call===1?{data:{status:{progress:50},block:[{id:1}],decode:{hotels:{'7':{name:'Crown'}}}}}:{data:{status:{finished:1}}};
  const result=await p.pollResults('123');
  assert.equal(result.data.block.length,1);assert.equal(result.data.decode.hotels['7'].name,'Crown');
});

test('timeout returns received blocks as partial results',async()=>{
  const p=new TourvisorPublicProvider({modsearchUrl:'https://example.com',modresultUrl:'https://example.com',searchTimeoutMs:0,pollIntervalMs:0});
  p.fetchResult=async()=>({data:{status:{progress:50},block:[{id:1}]}});
  const result=await p.pollResults('123');assert.equal(result.data.block.length,1);assert.equal(result.data.status.progress,50);
});


test('explicit operator refusal is unavailable even with booking controls',async()=>{
  const p=provider();
  mockAvailability(p,{data:{error:{reason:'Нет дополнительных сведений по запрошенному туру. Оператор сообщил о невозможности обслуживания запрошенного тура'}}});
  assert.equal((await p.resolveDealLink(offer('tourvisor:123',2307))).isAvailable,false);
});


test('relative booking links fall back to an absolute booking-center URL',()=>{
  assert.equal(bookingLinkFromRaw({share:{operatorlink:'/Basket?tour=1'},client:{bookcenters:[{link:'https://tourvisor.ru/book'}]}}),'https://tourvisor.ru/book');
  assert.equal(bookingLinkFromRaw({share:{operatorlink:'/Basket'},client:{operatorlink:'javascript:alert(1)',bookcenters:[{link:'/relative'}]}}),undefined);
});

test('Telegram delivery counts successes, not failed attempts',async()=>{
  const fake={dealSubscriberChatIds:()=>['one','two'],bot:{telegram:{sendMessage:async id=>{if(id==='one')throw {response:{error_code:400}};}}},storage:{deactivateSubscriber:()=>{}}};
  assert.equal(await TelegramNotifier.prototype.sendToDealSubscribers.call(fake,'test',{}),1);
  fake.dealSubscriberChatIds=()=>['one'];
  assert.equal(await TelegramNotifier.prototype.sendToDealSubscribers.call(fake,'test',{}),0);
});
